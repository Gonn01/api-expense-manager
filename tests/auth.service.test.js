import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { AuthService } from "../services/auth.service.js";

const publicUser = {
    id: 1,
    name: "Juan",
    email: "juan@test.com",
    avatar: "https://avatar.url",
    firebase_user_id: "fb123",
    preferred_currency: "ARS",
    sueldo: null,
    sueldo_currency: null,
};

describe("AuthService", () => {
    let authRepository;
    let service;

    beforeEach(() => {
        authRepository = {
            findUserByEmail: vi.fn(),
            findUserWithPasswordByEmail: vi.fn(),
            findUserByFirebaseId: vi.fn(),
            createUser: vi.fn(),
            linkFirebaseId: vi.fn(),
        };
        service = new AuthService({ authRepository });
    });

    describe("login", () => {
        it("devuelve el usuario sin el hash de la contraseña", async () => {
            const hash = await bcrypt.hash("1234", 4);
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: hash }]);

            const { user, token } = await service.login("juan@test.com", "1234");

            expect(user).toEqual(publicUser);
            expect(user).not.toHaveProperty("password");
            expect(token).toEqual(expect.any(String));
        });

        it("rechaza con credenciales inválidas si la contraseña no coincide", async () => {
            const hash = await bcrypt.hash("1234", 4);
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: hash }]);

            await expect(service.login("juan@test.com", "otra")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });
        });

        it("rechaza con credenciales inválidas si el usuario solo entra con Google", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: null }]);

            await expect(service.login("juan@test.com", "1234")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });
        });

        it("rechaza con credenciales inválidas si el email no existe", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);

            await expect(service.login("nadie@test.com", "1234")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });
        });
    });

    describe("firebaseLogin", () => {
        it("devuelve el usuario creado con su avatar", async () => {
            authRepository.findUserByFirebaseId.mockResolvedValue([]);
            authRepository.findUserByEmail.mockResolvedValue([]);
            authRepository.createUser.mockResolvedValue([publicUser]);

            const { user } = await service.firebaseLogin("Juan", "juan@test.com", "https://avatar.url", "fb123");

            expect(user.avatar).toBe("https://avatar.url");
        });

        it("devuelve el usuario vinculado con su avatar", async () => {
            authRepository.findUserByFirebaseId.mockResolvedValue([]);
            authRepository.findUserByEmail.mockResolvedValue([{ ...publicUser, firebase_user_id: null }]);
            authRepository.linkFirebaseId.mockResolvedValue([publicUser]);

            const { user } = await service.firebaseLogin("Juan", "juan@test.com", "https://avatar.url", "fb123");

            expect(authRepository.linkFirebaseId).toHaveBeenCalledWith(1, "fb123", "https://avatar.url");
            expect(user.avatar).toBe("https://avatar.url");
        });
    });
});
