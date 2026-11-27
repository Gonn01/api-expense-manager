import { describe, it, expect, vi, beforeEach } from "vitest";
import { FirebaseIdentity, emailLanguage } from "../utils/firebase-identity.js";

vi.mock("../config/env.js", () => ({
    FIREBASE_PROJECT_ID: "proyecto",
    FIREBASE_WEB_API_KEY: "clave",
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
}));

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const firebaseError = (message) => reply(400, { error: { message } });
const notFound = () => Object.assign(new Error("no existe"), { code: "auth/user-not-found" });

describe("FirebaseIdentity", () => {
    let fetchImpl;
    let admin;
    let identity;

    beforeEach(() => {
        fetchImpl = vi.fn();
        admin = {
            getUser: vi.fn().mockRejectedValue(notFound()),
            getUserByEmail: vi.fn().mockRejectedValue(notFound()),
            createUser: vi.fn().mockResolvedValue({ uid: "nuevo" }),
            updateUser: vi.fn().mockResolvedValue({}),
        };
        identity = new FirebaseIdentity({ apiKey: "clave", adminConfigured: true, adminAuth: () => admin, fetchImpl });
    });

    it("solo está configurada con la clave web y las credenciales de administrador", () => {
        expect(new FirebaseIdentity({ apiKey: "clave", adminConfigured: false }).isConfigured).toBe(false);
        expect(new FirebaseIdentity({ apiKey: null, adminConfigured: true }).isConfigured).toBe(false);
        expect(identity.isConfigured).toBe(true);
    });

    it("devuelve el token y el uid al iniciar sesión", async () => {
        fetchImpl.mockResolvedValue(reply(200, { idToken: "tok", localId: "uid1" }));

        await expect(identity.signInWithPassword("a@b.com", "secreta")).resolves.toEqual({ idToken: "tok", uid: "uid1" });
        expect(fetchImpl.mock.calls[0][0]).toContain("accounts:signInWithPassword?key=clave");
    });

    it("devuelve null con credenciales inválidas", async () => {
        fetchImpl.mockResolvedValue(firebaseError("INVALID_LOGIN_CREDENTIALS"));

        await expect(identity.signInWithPassword("a@b.com", "mal")).resolves.toBeNull();
    });

    it("traduce el bloqueo de Firebase a demasiados intentos", async () => {
        fetchImpl.mockResolvedValue(firebaseError("TOO_MANY_ATTEMPTS_TRY_LATER : Access disabled"));

        await expect(identity.signInWithPassword("a@b.com", "x")).rejects.toMatchObject({ code: "DEMASIADOS_INTENTOS" });
    });

    it("traduce un email repetido y una contraseña débil al registrarse", async () => {
        fetchImpl.mockResolvedValueOnce(firebaseError("EMAIL_EXISTS"));
        await expect(identity.signUp("a@b.com", "secreta", "Ana")).rejects.toMatchObject({ code: "EMAIL_YA_REGISTRADO" });

        fetchImpl.mockResolvedValueOnce(firebaseError("WEAK_PASSWORD : Password should be at least 6 characters"));
        await expect(identity.signUp("a@b.com", "123", "Ana")).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            details: { field: "password" },
        });
    });

    it("manda los mails en el idioma pedido", async () => {
        fetchImpl.mockResolvedValue(reply(200, {}));

        await identity.sendVerificationEmail("tok", "en");
        await identity.sendPasswordResetEmail("a@b.com", "fr");

        expect(fetchImpl.mock.calls[0][1].headers["X-Firebase-Locale"]).toBe("en");
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ requestType: "VERIFY_EMAIL", idToken: "tok" });
        expect(fetchImpl.mock.calls[1][1].headers["X-Firebase-Locale"]).toBe("es");
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ requestType: "PASSWORD_RESET", email: "a@b.com" });
    });

    it("no revela si el email de recuperación no existe", async () => {
        fetchImpl.mockResolvedValue(firebaseError("EMAIL_NOT_FOUND"));

        await expect(identity.sendPasswordResetEmail("nadie@b.com", "es")).resolves.toBeUndefined();
    });

    it("crea el usuario verificado si no existe al definir la contraseña", async () => {
        await expect(identity.setPassword({ email: "a@b.com", name: "Ana", password: "secreta" })).resolves.toBe("nuevo");

        expect(admin.createUser).toHaveBeenCalledWith({
            email: "a@b.com",
            password: "secreta",
            emailVerified: true,
            displayName: "Ana",
        });
    });

    it("actualiza la contraseña del usuario que ya existe", async () => {
        admin.getUser.mockResolvedValue({ uid: "fb1", providerData: [{ providerId: "google.com" }] });

        await expect(identity.setPassword({ uid: "fb1", email: "a@b.com", password: "secreta" })).resolves.toBe("fb1");

        expect(admin.updateUser).toHaveBeenCalledWith("fb1", { password: "secreta", emailVerified: true });
        expect(admin.createUser).not.toHaveBeenCalled();
    });

    it("sabe si el usuario tiene contraseña en Firebase", async () => {
        admin.getUserByEmail.mockResolvedValue({ uid: "fb1", providerData: [{ providerId: "password" }] });

        await expect(identity.hasPasswordProvider({ email: "a@b.com" })).resolves.toBe(true);
        await expect(identity.hasPasswordProvider({ uid: null, email: null })).resolves.toBe(false);
    });

    it("prepara una cuenta de Google para recibir el mail de recuperación sin tocar la verificación", async () => {
        admin.getUser.mockResolvedValue({ uid: "fb1", providerData: [{ providerId: "google.com" }] });

        await expect(identity.ensureRecoverableUser({ uid: "fb1", email: "a@b.com" })).resolves.toBe("fb1");

        expect(admin.updateUser).toHaveBeenCalledWith("fb1", { password: expect.any(String) });
    });

    it("no cambia una cuenta que ya tiene contraseña al pedir la recuperación", async () => {
        admin.getUserByEmail.mockResolvedValue({ uid: "fb1", providerData: [{ providerId: "password" }] });

        await identity.ensureRecoverableUser({ email: "a@b.com" });

        expect(admin.updateUser).not.toHaveBeenCalled();
    });

    it("usa español si el idioma no es compatible", () => {
        expect(emailLanguage("en")).toBe("en");
        expect(emailLanguage("pt")).toBe("es");
        expect(emailLanguage(undefined)).toBe("es");
    });
});
