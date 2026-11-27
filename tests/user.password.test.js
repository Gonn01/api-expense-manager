import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserController } from "../controller/user.controller.js";
import { UserService } from "../services/user.service.js";

vi.mock("../config/env.js", () => ({
    JWT_SECRET: "secreto-de-test",
    DATABASE_URL: "postgres://no-usar",
    DATABASE_SSL: undefined,
    BEAMS_INSTANCE_ID: undefined,
    BEAMS_SECRET_KEY: undefined,
    FIREBASE_PROJECT_ID: undefined,
    FIREBASE_WEB_API_KEY: undefined,
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
}));
vi.mock("../utils/pusher.js", () => ({
    userChannel: (userId) => `private-notificaciones-${userId}`,
    authorizePusherChannel: vi.fn(),
}));

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe("contraseña del usuario", () => {
    let userRepository;
    let rateLimitService;
    let service;

    beforeEach(() => {
        userRepository = {
            getPasswordInfo: vi.fn(),
            updatePassword: vi.fn().mockResolvedValue([{ id: 1, token_version: 4 }]),
            revokeSessions: vi.fn().mockResolvedValue([{ id: 1 }]),
        };
        rateLimitService = { consume: vi.fn().mockResolvedValue(), reset: vi.fn().mockResolvedValue() };
        service = new UserService({ userRepository, rateLimitService });
    });

    it("informa si la cuenta tiene contraseña sin exponer el hash", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: "hash" }]);

        await expect(service.getPasswordStatus(1)).resolves.toEqual({ has_password: true });
    });

    it("una cuenta de Google define su contraseña sin la actual", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: null }]);

        await expect(service.updatePassword(1, undefined, "nueva123")).resolves.toEqual({
            has_password: true,
            token: expect.any(String),
        });

        const savedHash = userRepository.updatePassword.mock.calls[0][1];
        expect(await bcrypt.compare("nueva123", savedHash)).toBe(true);
    });

    it("exige la contraseña actual si ya tiene una", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);

        await expect(service.updatePassword(1, undefined, "nueva123")).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
        await expect(service.updatePassword(1, "mal", "nueva123")).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
        expect(userRepository.updatePassword).not.toHaveBeenCalled();
    });

    it("cambia la contraseña con la actual correcta", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);

        await service.updatePassword(1, "actual", "nueva123");

        expect(userRepository.updatePassword).toHaveBeenCalledTimes(1);
    });

    it("devuelve un token nuevo con la versión de sesión actualizada", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);

        const { token } = await service.updatePassword(1, "actual", "nueva123");

        expect(jwt.decode(token)).toMatchObject({ userId: 1, tokenVersion: 4 });
    });

    it("limita los intentos con la contraseña actual", async () => {
        userRepository.getPasswordInfo.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);
        rateLimitService.consume.mockRejectedValue(Object.assign(new Error("limite"), { code: "DEMASIADOS_INTENTOS" }));

        await expect(service.updatePassword(1, "actual", "nueva123")).rejects.toMatchObject({ code: "DEMASIADOS_INTENTOS" });

        expect(userRepository.updatePassword).not.toHaveBeenCalled();
    });

    it("cierra todas las sesiones del usuario", async () => {
        await expect(service.revokeSessions(1)).resolves.toEqual({ revoked: true });

        expect(userRepository.revokeSessions).toHaveBeenCalledWith(1);
    });

    it("el controller rechaza una contraseña corta", async () => {
        const userService = { updatePassword: vi.fn() };
        const controller = new UserController(userService);
        const res = makeRes();

        await controller.updatePassword({ body: { new_password: "123" }, session: { userId: 1 } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(userService.updatePassword).not.toHaveBeenCalled();
    });

    describe("con Firebase configurado", () => {
        let identity;

        beforeEach(() => {
            userRepository.moveToFirebasePassword = vi.fn().mockResolvedValue([{ id: 1, token_version: 5 }]);
            identity = {
                isConfigured: true,
                hasPasswordProvider: vi.fn().mockResolvedValue(true),
                signInWithPassword: vi.fn().mockResolvedValue({ idToken: "tok", uid: "fb1" }),
                setPassword: vi.fn().mockResolvedValue("fb1"),
            };
            service = new UserService({ userRepository, rateLimitService, identity });
            userRepository.getPasswordInfo.mockResolvedValue([
                { password: null, firebase_user_id: "fb1", email: "ana@test.com", name: "Ana" },
            ]);
        });

        it("informa la contraseña guardada en Firebase", async () => {
            await expect(service.getPasswordStatus(1)).resolves.toEqual({ has_password: true });
            expect(identity.hasPasswordProvider).toHaveBeenCalledWith({ uid: "fb1", email: "ana@test.com" });
        });

        it("valida la actual contra Firebase y guarda la nueva ahí", async () => {
            const { token } = await service.updatePassword(1, "actual", "nueva123");

            expect(identity.signInWithPassword).toHaveBeenCalledWith("ana@test.com", "actual");
            expect(identity.setPassword).toHaveBeenCalledWith({
                uid: "fb1",
                email: "ana@test.com",
                name: "Ana",
                password: "nueva123",
            });
            expect(userRepository.moveToFirebasePassword).toHaveBeenCalledWith(1, "fb1");
            expect(userRepository.updatePassword).not.toHaveBeenCalled();
            expect(jwt.decode(token)).toMatchObject({ userId: 1, tokenVersion: 5 });
        });

        it("rechaza una contraseña actual que Firebase no reconoce", async () => {
            identity.signInWithPassword.mockResolvedValue(null);

            await expect(service.updatePassword(1, "mal", "nueva123")).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
            expect(identity.setPassword).not.toHaveBeenCalled();
        });

        it("valida la contraseña que todavía está en la base y la pasa a Firebase", async () => {
            identity.hasPasswordProvider.mockResolvedValue(false);
            userRepository.getPasswordInfo.mockResolvedValue([
                { password: await bcrypt.hash("actual", 4), firebase_user_id: null, email: "ana@test.com", name: "Ana" },
            ]);

            await service.updatePassword(1, "actual", "nueva123");

            expect(identity.signInWithPassword).not.toHaveBeenCalled();
            expect(identity.setPassword).toHaveBeenCalledWith(expect.objectContaining({ uid: null, password: "nueva123" }));
        });

        it("una cuenta solo de Google define su contraseña sin la actual", async () => {
            identity.hasPasswordProvider.mockResolvedValue(false);

            await service.updatePassword(1, undefined, "nueva123");

            expect(rateLimitService.consume).not.toHaveBeenCalled();
            expect(identity.setPassword).toHaveBeenCalled();
        });
    });

    it("el controller toma el usuario de la sesión", async () => {
        const userService = { updatePassword: vi.fn().mockResolvedValue({ has_password: true }) };
        const controller = new UserController(userService);
        const res = makeRes();

        await controller.updatePassword(
            { body: { user_id: 99, current_password: "actual", new_password: "nueva123" }, session: { userId: 1 } },
            res,
        );

        expect(userService.updatePassword).toHaveBeenCalledWith(1, "actual", "nueva123");
    });
});
