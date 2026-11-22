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

const googleIdentity = {
    firebaseId: "fb123",
    email: "Juan@Test.com",
    emailVerified: true,
    name: "Juan",
    avatar: "https://avatar.url",
};

describe("AuthService", () => {
    let authRepository;
    let verifyIdToken;
    let service;

    beforeEach(() => {
        authRepository = {
            findUserByEmail: vi.fn(),
            findUserWithPasswordByEmail: vi.fn(),
            findUserByFirebaseId: vi.fn().mockResolvedValue([]),
            createUser: vi.fn(),
            linkFirebaseId: vi.fn(),
        };
        verifyIdToken = vi.fn().mockResolvedValue(googleIdentity);
        service = new AuthService({ authRepository, verifyIdToken });
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

        it("busca el correo normalizado", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);

            await expect(service.login(" Juan@Test.COM ", "1234")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });

            expect(authRepository.findUserWithPasswordByEmail).toHaveBeenCalledWith("juan@test.com");
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

    describe("register", () => {
        it("crea la cuenta con el correo normalizado y sin identidad de Google", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
            authRepository.createUser.mockResolvedValue([publicUser]);

            await service.register("Juan", " Juan@Test.com ", "123456");

            expect(authRepository.createUser).toHaveBeenCalledWith("Juan", "juan@test.com", expect.any(String), null);
        });

        it("rechaza un correo que ya tiene contraseña", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: "hash" }]);

            await expect(service.register("Juan", "juan@test.com", "123456")).rejects.toMatchObject({ code: "EMAIL_YA_REGISTRADO" });
            expect(authRepository.createUser).not.toHaveBeenCalled();
        });

        it("no agrega una contraseña a una cuenta creada con Google", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: null }]);

            await expect(service.register("Juan", "juan@test.com", "123456")).rejects.toMatchObject({ code: "EMAIL_REGISTRADO_CON_GOOGLE" });
            expect(authRepository.createUser).not.toHaveBeenCalled();
            expect(authRepository.linkFirebaseId).not.toHaveBeenCalled();
        });

        it("traduce un alta simultánea al error de correo registrado", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
            authRepository.createUser.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));

            await expect(service.register("Juan", "juan@test.com", "123456")).rejects.toMatchObject({ code: "EMAIL_YA_REGISTRADO" });
        });
    });

    describe("firebaseLogin", () => {
        it("no consulta la base si el token es inválido", async () => {
            verifyIdToken.mockRejectedValue(Object.assign(new Error("invalid"), { code: "GOOGLE_TOKEN_INVALIDO" }));

            await expect(service.firebaseLogin("falso")).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALIDO" });

            expect(authRepository.findUserByFirebaseId).not.toHaveBeenCalled();
            expect(authRepository.findUserWithPasswordByEmail).not.toHaveBeenCalled();
        });

        it("entra directo si la identidad de Google ya está vinculada", async () => {
            authRepository.findUserByFirebaseId.mockResolvedValue([publicUser]);

            const { user } = await service.firebaseLogin("id-token");

            expect(user).toEqual(publicUser);
            expect(authRepository.linkFirebaseId).not.toHaveBeenCalled();
        });

        it("crea la cuenta con los datos del token y el correo normalizado", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
            authRepository.createUser.mockResolvedValue([publicUser]);

            const { user } = await service.firebaseLogin("id-token");

            expect(authRepository.createUser).toHaveBeenCalledWith("Juan", "juan@test.com", null, "fb123", "https://avatar.url");
            expect(user.avatar).toBe("https://avatar.url");
        });

        it("reintenta como vinculación si otro pedido creó la cuenta al mismo tiempo", async () => {
            authRepository.findUserWithPasswordByEmail
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ ...publicUser, firebase_user_id: null, password: null }]);
            authRepository.createUser.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));
            authRepository.linkFirebaseId.mockResolvedValue([publicUser]);

            const { user } = await service.firebaseLogin("id-token");

            expect(user).toEqual(publicUser);
        });

        it("rechaza un correo sin verificar sin crear ni vincular", async () => {
            verifyIdToken.mockResolvedValue({ ...googleIdentity, emailVerified: false });

            await expect(service.firebaseLogin("id-token")).rejects.toMatchObject({ code: "GOOGLE_EMAIL_NO_VERIFICADO" });

            expect(authRepository.createUser).not.toHaveBeenCalled();
            expect(authRepository.linkFirebaseId).not.toHaveBeenCalled();
        });

        it("vincula sin pedir contraseña a una cuenta que no tiene", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, firebase_user_id: null, password: null }]);
            authRepository.linkFirebaseId.mockResolvedValue([publicUser]);

            await service.firebaseLogin("id-token");

            expect(authRepository.linkFirebaseId).toHaveBeenCalledWith(1, {
                firebaseId: "fb123",
                name: "Juan",
                avatar: "https://avatar.url",
                discardPassword: false,
            });
        });

        describe("cuenta existente con contraseña", () => {
            let hash;

            beforeEach(async () => {
                hash = await bcrypt.hash("secreta", 4);
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, firebase_user_id: null, password: hash }]);
                authRepository.linkFirebaseId.mockResolvedValue([publicUser]);
            });

            it("pide la contraseña antes de vincular", async () => {
                await expect(service.firebaseLogin("id-token")).rejects.toMatchObject({ code: "VINCULACION_REQUIERE_CONTRASENA" });
                expect(authRepository.linkFirebaseId).not.toHaveBeenCalled();
            });

            it("rechaza una contraseña incorrecta", async () => {
                await expect(service.firebaseLogin("id-token", { password: "otra" })).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
                expect(authRepository.linkFirebaseId).not.toHaveBeenCalled();
            });

            it("vincula y conserva la contraseña si es correcta", async () => {
                await service.firebaseLogin("id-token", { password: "secreta" });

                expect(authRepository.linkFirebaseId).toHaveBeenCalledWith(1, expect.objectContaining({ discardPassword: false }));
            });

            it("vincula y descarta la contraseña si la persona no la recuerda", async () => {
                await service.firebaseLogin("id-token", { discardPassword: true });

                expect(authRepository.linkFirebaseId).toHaveBeenCalledWith(1, expect.objectContaining({ discardPassword: true }));
            });

            it("no descarta con un valor que no sea true", async () => {
                await expect(service.firebaseLogin("id-token", { discardPassword: "true" })).rejects.toMatchObject({ code: "VINCULACION_REQUIERE_CONTRASENA" });
            });
        });
    });
});
