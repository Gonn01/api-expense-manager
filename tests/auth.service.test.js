import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthService } from "../services/auth.service.js";

vi.mock("../config/env.js", () => ({ JWT_SECRET: "secreto-de-test", FIREBASE_PROJECT_ID: "proyecto" }));

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
    let rateLimitService;
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
        rateLimitService = { consume: vi.fn().mockResolvedValue(), reset: vi.fn().mockResolvedValue() };
        service = new AuthService({ authRepository, rateLimitService, verifyIdToken });
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

        it("compara contra un hash aunque el email no exista", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
            const compare = vi.spyOn(bcrypt, "compare");

            await expect(service.login("nadie@test.com", "1234")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });

            expect(compare).toHaveBeenCalledWith("1234", expect.stringMatching(/^\$2b\$12\$/));
            compare.mockRestore();
        });

        it("no consulta la cuenta si se superó el límite de intentos", async () => {
            rateLimitService.consume.mockRejectedValue(Object.assign(new Error("limite"), { code: "DEMASIADOS_INTENTOS" }));

            await expect(service.login("juan@test.com", "1234", { clientIp: "1.1.1.1" })).rejects.toMatchObject({ code: "DEMASIADOS_INTENTOS" });

            expect(authRepository.findUserWithPasswordByEmail).not.toHaveBeenCalled();
        });

        it("limpia el contador de esa cuenta e IP solo al entrar bien", async () => {
            const hash = await bcrypt.hash("1234", 4);
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: hash }]);

            await expect(service.login("juan@test.com", "mal", { clientIp: "1.1.1.1" })).rejects.toBeDefined();
            expect(rateLimitService.reset).not.toHaveBeenCalled();

            await service.login("juan@test.com", "1234", { clientIp: "1.1.1.1" });

            expect(rateLimitService.reset).toHaveBeenCalledWith([expect.objectContaining({ key: "login:juan@test.com:1.1.1.1" })]);
        });

        it("incluye la versión de sesión en el token, pero no en el usuario", async () => {
            const hash = await bcrypt.hash("1234", 4);
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, token_version: 3, password: hash }]);

            const { user, token } = await service.login("juan@test.com", "1234");

            expect(user).not.toHaveProperty("token_version");
            expect(jwt.decode(token)).toMatchObject({ userId: 1, tokenVersion: 3 });
            expect(jwt.decode(token)).not.toHaveProperty("email");
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

        it("rechaza un correo sin verificar aunque la identidad ya esté vinculada", async () => {
            verifyIdToken.mockResolvedValue({ ...googleIdentity, emailVerified: false });
            authRepository.findUserByFirebaseId.mockResolvedValue([publicUser]);

            await expect(service.firebaseLogin("id-token")).rejects.toMatchObject({ code: "GOOGLE_EMAIL_NO_VERIFICADO" });
        });
    });

    describe("sin Firebase configurado", () => {
        it("no ofrece reenviar la verificación ni recuperar la contraseña", async () => {
            await expect(service.resendVerification("juan@test.com", "secreta")).rejects.toMatchObject({ code: "AUTH_EMAIL_NO_CONFIGURADO" });
            await expect(service.requestPasswordReset("juan@test.com")).rejects.toMatchObject({ code: "AUTH_EMAIL_NO_CONFIGURADO" });
        });

        it("el registro no manda verificación", async () => {
            authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
            authRepository.createUser.mockResolvedValue([publicUser]);

            await expect(service.register("Juan", "juan@test.com", "123456")).resolves.toEqual({ verification_sent: false });
        });
    });

    describe("con Firebase configurado", () => {
        let identity;
        const verified = { ...googleIdentity, email: "juan@test.com" };

        beforeEach(() => {
            authRepository.findUserWithPasswordByFirebaseId = vi.fn().mockResolvedValue([]);
            authRepository.moveToFirebase = vi.fn().mockImplementation(async (id, firebaseId) => [
                { ...publicUser, id, firebase_user_id: firebaseId, token_version: 0 },
            ]);
            identity = {
                isConfigured: true,
                signInWithPassword: vi.fn().mockResolvedValue({ idToken: "tok", uid: "fb123" }),
                verify: vi.fn().mockResolvedValue(verified),
                signUp: vi.fn().mockResolvedValue({ idToken: "tok-nuevo", uid: "fb-nuevo" }),
                sendVerificationEmail: vi.fn().mockResolvedValue(),
                sendPasswordResetEmail: vi.fn().mockResolvedValue(),
                hasPasswordProvider: vi.fn().mockResolvedValue(false),
                setPassword: vi.fn().mockResolvedValue("fb-migrado"),
                ensureRecoverableUser: vi.fn().mockResolvedValue("fb-recuperable"),
            };
            service = new AuthService({ authRepository, rateLimitService, verifyIdToken, identity });
        });

        describe("login", () => {
            it("entra con la cuenta vinculada a la identidad de Firebase", async () => {
                authRepository.findUserWithPasswordByFirebaseId.mockResolvedValue([{ ...publicUser, password: null }]);

                const { user } = await service.login(" Juan@Test.com ", "secreta");

                expect(identity.signInWithPassword).toHaveBeenCalledWith("juan@test.com", "secreta");
                expect(user).toEqual(publicUser);
                expect(authRepository.moveToFirebase).not.toHaveBeenCalled();
            });

            it("rechaza un email sin verificar sin tocar la base", async () => {
                identity.verify.mockResolvedValue({ ...verified, emailVerified: false });

                await expect(service.login("juan@test.com", "secreta")).rejects.toMatchObject({ code: "EMAIL_NO_VERIFICADO" });

                expect(authRepository.findUserWithPasswordByFirebaseId).not.toHaveBeenCalled();
                expect(rateLimitService.reset).not.toHaveBeenCalled();
            });

            it("borra la contraseña anterior de la base si la cuenta todavía la tenía", async () => {
                authRepository.findUserWithPasswordByFirebaseId.mockResolvedValue([{ ...publicUser, password: "hash" }]);

                await service.login("juan@test.com", "secreta");

                expect(authRepository.moveToFirebase).toHaveBeenCalledWith(1, "fb123");
            });

            it("vincula por email una cuenta que todavía no tenía la identidad", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, firebase_user_id: null }]);

                await service.login("juan@test.com", "secreta");

                expect(authRepository.moveToFirebase).toHaveBeenCalledWith(1, "fb123");
            });

            it("crea la cuenta si Firebase la conoce y la base no", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
                authRepository.createUser.mockResolvedValue([publicUser]);

                await service.login("juan@test.com", "secreta");

                expect(authRepository.createUser).toHaveBeenCalledWith("Juan", "juan@test.com", null, "fb123", "https://avatar.url");
            });

            describe("cuenta con la contraseña guardada en la base", () => {
                beforeEach(async () => {
                    identity.signInWithPassword.mockResolvedValue(null);
                    authRepository.findUserWithPasswordByEmail.mockResolvedValue([
                        { ...publicUser, firebase_user_id: null, password: await bcrypt.hash("secreta", 4) },
                    ]);
                });

                it("pasa la contraseña a Firebase y la borra de la base", async () => {
                    const { user } = await service.login("juan@test.com", "secreta");

                    expect(identity.setPassword).toHaveBeenCalledWith({
                        uid: null,
                        email: "juan@test.com",
                        name: "Juan",
                        password: "secreta",
                    });
                    expect(authRepository.moveToFirebase).toHaveBeenCalledWith(1, "fb-migrado");
                    expect(user.firebase_user_id).toBe("fb-migrado");
                });

                it("rechaza una contraseña incorrecta sin migrar", async () => {
                    await expect(service.login("juan@test.com", "otra")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });

                    expect(identity.setPassword).not.toHaveBeenCalled();
                });

                it("no acepta la contraseña vieja si Firebase ya tiene una", async () => {
                    identity.hasPasswordProvider.mockResolvedValue(true);

                    await expect(service.login("juan@test.com", "secreta")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });

                    expect(identity.setPassword).not.toHaveBeenCalled();
                    expect(authRepository.moveToFirebase).toHaveBeenCalledWith(1, null);
                });
            });

            it("rechaza si ni Firebase ni la base reconocen la contraseña", async () => {
                identity.signInWithPassword.mockResolvedValue(null);
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);

                await expect(service.login("juan@test.com", "secreta")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });
            });
        });

        describe("register", () => {
            it("crea la cuenta en Firebase, manda la verificación y guarda la identidad sin contraseña", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);
                authRepository.createUser.mockResolvedValue([publicUser]);

                const result = await service.register("Juan", " Juan@Test.com ", "123456", { language: "en" });

                expect(result).toEqual({ verification_sent: true });
                expect(identity.signUp).toHaveBeenCalledWith("juan@test.com", "123456", "Juan");
                expect(identity.sendVerificationEmail).toHaveBeenCalledWith("tok-nuevo", "en");
                expect(authRepository.createUser).toHaveBeenCalledWith("Juan", "juan@test.com", null, "fb-nuevo");
            });

            it("trata como registrada una cuenta con contraseña en Firebase", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: null }]);
                identity.hasPasswordProvider.mockResolvedValue(true);

                await expect(service.register("Juan", "juan@test.com", "123456")).rejects.toMatchObject({ code: "EMAIL_YA_REGISTRADO" });
                expect(identity.signUp).not.toHaveBeenCalled();
            });
        });

        describe("resendVerification", () => {
            it("manda otro mail si el email sigue sin verificar", async () => {
                identity.verify.mockResolvedValue({ ...verified, emailVerified: false });

                await expect(service.resendVerification("juan@test.com", "secreta", { language: "es" })).resolves.toEqual({
                    verification_sent: true,
                    already_verified: false,
                });
                expect(identity.sendVerificationEmail).toHaveBeenCalledWith("tok", "es");
            });

            it("no manda nada si ya está verificado", async () => {
                await expect(service.resendVerification("juan@test.com", "secreta")).resolves.toEqual({
                    verification_sent: false,
                    already_verified: true,
                });
                expect(identity.sendVerificationEmail).not.toHaveBeenCalled();
            });

            it("exige la contraseña correcta", async () => {
                identity.signInWithPassword.mockResolvedValue(null);

                await expect(service.resendVerification("juan@test.com", "otra")).rejects.toMatchObject({ code: "CREDENCIALES_INVALIDAS" });
            });

            it("limita los pedidos por correo", async () => {
                rateLimitService.consume.mockRejectedValue(Object.assign(new Error("limite"), { code: "DEMASIADOS_INTENTOS" }));

                await expect(service.resendVerification("juan@test.com", "secreta")).rejects.toMatchObject({ code: "DEMASIADOS_INTENTOS" });
                expect(identity.signInWithPassword).not.toHaveBeenCalled();
            });
        });

        describe("requestPasswordReset", () => {
            it("responde igual aunque el email no tenga cuenta", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([]);

                await expect(service.requestPasswordReset("nadie@test.com", { language: "en" })).resolves.toEqual({ sent: true });

                expect(identity.ensureRecoverableUser).not.toHaveBeenCalled();
                expect(identity.sendPasswordResetEmail).toHaveBeenCalledWith("nadie@test.com", "en");
            });

            it("prepara en Firebase una cuenta que todavía tenía la contraseña en la base", async () => {
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, firebase_user_id: null, password: "hash" }]);

                await service.requestPasswordReset("juan@test.com");

                expect(identity.ensureRecoverableUser).toHaveBeenCalledWith({ uid: null, email: "juan@test.com", name: "Juan" });
                expect(authRepository.moveToFirebase).toHaveBeenCalledWith(1, "fb-recuperable");
                expect(identity.sendPasswordResetEmail).toHaveBeenCalledWith("juan@test.com", undefined);
            });

            it("no toca la base si la cuenta ya está en Firebase", async () => {
                identity.ensureRecoverableUser.mockResolvedValue("fb123");
                authRepository.findUserWithPasswordByEmail.mockResolvedValue([{ ...publicUser, password: null }]);

                await service.requestPasswordReset("juan@test.com");

                expect(authRepository.moveToFirebase).not.toHaveBeenCalled();
            });
        });
    });
});
