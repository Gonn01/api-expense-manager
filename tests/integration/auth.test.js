import { beforeEach, describe, expect, it } from "vitest";
import { executeQuery } from "../../db.js";
import { AuthRepository } from "../../repositories/auth.repository.js";
import { UserRepository } from "../../repositories/user.repository.js";
import { AuthService } from "../../services/auth.service.js";
import { UserService } from "../../services/user.service.js";
import { resetDatabase } from "./support/harness.js";

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
        auth = new AuthService({
            authRepository: new AuthRepository(),
            verifyIdToken: async () => identity,
        });
        users = new UserService({ userRepository: new UserRepository() });
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
