import bcrypt from "bcrypt";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeQuery } from "../../db.js";
import { AuthRateLimitRepository } from "../../repositories/auth-rate-limit.repository.js";
import { AuthRepository } from "../../repositories/auth.repository.js";
import { UserRepository } from "../../repositories/user.repository.js";
import { AuthRateLimitService } from "../../services/auth-rate-limit.service.js";
import { AuthService } from "../../services/auth.service.js";
import { UserService } from "../../services/user.service.js";
import { requestWithToken, resetDatabase, startApi, stopApi } from "./support/harness.js";

const identity = {
    firebaseId: "google-uid",
    email: "Gonza@Test.com",
    emailVerified: true,
    name: "Gonza Google",
    avatar: "https://avatar.url",
};

const accounts = () =>
    executeQuery("SELECT id, email, firebase_user_id, password IS NOT NULL AS has_password FROM users");

describe("una sola cuenta por email", () => {
    let auth;
    let users;

    beforeEach(async () => {
        await resetDatabase();
        const rateLimitService = new AuthRateLimitService({ rateLimitRepository: new AuthRateLimitRepository() });
        auth = new AuthService({
            authRepository: new AuthRepository(),
            rateLimitService,
            verifyIdToken: async () => identity,
        });
        users = new UserService({ userRepository: new UserRepository(), rateLimitService });
    });

    it("registrarse primero con email y después entrar con Google deja una cuenta con los dos métodos", async () => {
        await auth.register("Gonza", "gonza@test.com", "secreta1");

        await expect(auth.firebaseLogin("id-token")).rejects.toMatchObject({
            code: "VINCULACION_REQUIERE_CONTRASENA",
        });
        const google = await auth.firebaseLogin("id-token", { password: "secreta1" });
        const again = await auth.firebaseLogin("id-token");
        const byPassword = await auth.login("GONZA@test.com", "secreta1");

        expect(await accounts()).toHaveLength(1);
        expect(again.user.id).toBe(google.user.id);
        expect(byPassword.user.id).toBe(google.user.id);
        expect(byPassword.user.firebase_user_id).toBe("google-uid");
        expect(byPassword.user.name).toBe("Gonza");
        expect(byPassword.user.avatar).toBe("https://avatar.url");
    });

    it("entrar primero con Google y después definir la contraseña deja una cuenta con los dos métodos", async () => {
        const google = await auth.firebaseLogin("id-token");

        await expect(auth.register("Otro", "gonza@test.com", "intruso1")).rejects.toMatchObject({
            code: "EMAIL_REGISTRADO_CON_GOOGLE",
        });
        await expect(auth.login("gonza@test.com", "intruso1")).rejects.toMatchObject({
            code: "CREDENCIALES_INVALIDAS",
        });

        await users.updatePassword(google.user.id, undefined, "secreta1");
        const byPassword = await auth.login("gonza@test.com", "secreta1");

        expect(await accounts()).toHaveLength(1);
        expect(byPassword.user.id).toBe(google.user.id);
        expect(byPassword.user.email).toBe("gonza@test.com");
    });

    it("quien no recuerda la contraseña vincula y la contraseña anterior deja de servir", async () => {
        await auth.register("Intruso", "gonza@test.com", "intruso1");

        await auth.firebaseLogin("id-token", { discardPassword: true });

        await expect(auth.login("gonza@test.com", "intruso1")).rejects.toMatchObject({
            code: "CREDENCIALES_INVALIDAS",
        });
        const [account] = await accounts();
        expect(account.has_password).toBe(false);
        expect(account.firebase_user_id).toBe("google-uid");
    });

    it("la base rechaza un email repetido aunque cambien las mayúsculas", async () => {
        await executeQuery("INSERT INTO users (name, email) VALUES ('A', 'gonza@test.com')");

        await expect(
            executeQuery("INSERT INTO users (name, email) VALUES ('B', 'GONZA@test.com')"),
        ).rejects.toMatchObject({ code: "23505" });
    });

    it("la base rechaza una identidad de Google repetida y admite varias cuentas sin Google", async () => {
        await executeQuery("INSERT INTO users (name, email, firebase_user_id) VALUES ('A', 'a@test.com', 'uid')");
        await executeQuery("INSERT INTO users (name, email) VALUES ('C', 'c@test.com')");
        await executeQuery("INSERT INTO users (name, email) VALUES ('D', 'd@test.com')");

        await expect(
            executeQuery("INSERT INTO users (name, email, firebase_user_id) VALUES ('B', 'b@test.com', 'uid')"),
        ).rejects.toMatchObject({ code: "23505" });
    });
});

describe("protección de la autenticación", () => {
    const CLIENT = { clientIp: "10.0.0.1" };
    let auth;
    let rateLimitService;

    beforeEach(async () => {
        await resetDatabase();
        rateLimitService = new AuthRateLimitService({ rateLimitRepository: new AuthRateLimitRepository() });
        auth = new AuthService({
            authRepository: new AuthRepository(),
            rateLimitService,
            verifyIdToken: async () => identity,
        });
        await executeQuery(
            "INSERT INTO users (name, email, password) VALUES ('Gonza', 'gonza@test.com', $1)",
            [await bcrypt.hash("secreta1", 4)],
        );
    });

    const failLogin = (client = CLIENT) => auth.login("gonza@test.com", "incorrecta", client).catch((err) => err.code);

    it("bloquea el sexto intento, incluso con la contraseña correcta", async () => {
        const codes = [];
        for (let i = 0; i < 5; i += 1) codes.push(await failLogin());

        expect(codes).toEqual(Array(5).fill("CREDENCIALES_INVALIDAS"));
        await expect(auth.login("gonza@test.com", "secreta1", CLIENT)).rejects.toMatchObject({
            code: "DEMASIADOS_INTENTOS",
            status: 429,
            details: { retry_after_seconds: expect.any(Number) },
        });
    });

    it("intentos simultáneos no superan el límite", async () => {
        const codes = await Promise.all(Array.from({ length: 12 }, () => failLogin()));

        expect(codes.filter((code) => code === "CREDENCIALES_INVALIDAS")).toHaveLength(5);
        expect(codes.filter((code) => code === "DEMASIADOS_INTENTOS")).toHaveLength(7);
    });

    it("el bloqueo de una IP no afecta a la misma cuenta desde otra", async () => {
        for (let i = 0; i < 6; i += 1) await failLogin();

        const session = await auth.login("gonza@test.com", "secreta1", { clientIp: "10.0.0.2" });

        expect(session.token).toEqual(expect.any(String));
    });

    it("un acceso correcto reinicia el contador", async () => {
        for (let i = 0; i < 4; i += 1) await failLogin();
        await auth.login("gonza@test.com", "secreta1", CLIENT);
        for (let i = 0; i < 4; i += 1) await failLogin();

        await expect(auth.login("gonza@test.com", "secreta1", CLIENT)).resolves.toBeDefined();
    });

    it("la ventana vencida vuelve a permitir intentos", async () => {
        for (let i = 0; i < 6; i += 1) await failLogin();
        await executeQuery("UPDATE auth_rate_limits SET window_started_at = NOW() - interval '16 minutes'");

        await expect(auth.login("gonza@test.com", "secreta1", CLIENT)).resolves.toBeDefined();
    });

    it("no guarda el email ni la IP en texto plano", async () => {
        await failLogin();

        const rows = await executeQuery("SELECT key FROM auth_rate_limits");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every(({ key }) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    });

    describe("sesiones por HTTP", () => {
        beforeAll(startApi);
        afterAll(stopApi);

        const dashboard = (token) => requestWithToken("GET", "/dashboard", token);

        it("cambiar la contraseña invalida los tokens anteriores y el nuevo sigue funcionando", async () => {
            const anterior = await auth.login("gonza@test.com", "secreta1", CLIENT);
            expect((await dashboard(anterior.token)).status).toBe(200);

            const response = await requestWithToken("PUT", "/user/password", anterior.token, {
                current_password: "secreta1",
                new_password: "secreta2",
            });
            const { data } = await response.json();

            expect(response.status).toBe(200);
            expect((await dashboard(anterior.token)).status).toBe(401);
            expect((await dashboard(data.token)).status).toBe(200);
        });

        it("cerrar todas las sesiones invalida todos los tokens", async () => {
            const primera = await auth.login("gonza@test.com", "secreta1", CLIENT);
            const segunda = await auth.login("gonza@test.com", "secreta1", { clientIp: "10.0.0.2" });

            const response = await requestWithToken("POST", "/user/sessions/revoke", primera.token, {});

            expect(response.status).toBe(200);
            expect((await dashboard(primera.token)).status).toBe(401);
            expect((await dashboard(segunda.token)).status).toBe(401);
        });

        it("descartar la contraseña al vincular Google invalida las sesiones anteriores", async () => {
            const anterior = await auth.login("gonza@test.com", "secreta1", CLIENT);

            const google = await auth.firebaseLogin("id-token", { discardPassword: true }, CLIENT);

            expect((await dashboard(anterior.token)).status).toBe(401);
            expect((await dashboard(google.token)).status).toBe(200);
        });
    });
});
