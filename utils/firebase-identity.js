import { randomBytes } from "node:crypto";
import { FIREBASE_WEB_API_KEY } from "../config/env.js";
import { customError, ErrorCode } from "./errors.js";
import { firebaseAdminAuth, hasFirebaseAdminCredentials } from "./firebase-app.js";
import { verifyFirebaseIdToken } from "./firebase-token.js";

const IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const INVALID_CREDENTIALS = new Set(["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "USER_DISABLED"]);
const SUPPORTED_LANGUAGES = new Set(["es", "en"]);
const MIN_PASSWORD_LENGTH = 6;

export const emailLanguage = (language) => (SUPPORTED_LANGUAGES.has(language) ? language : "es");

const weakPassword = () =>
    customError(ErrorCode.VALIDATION_ERROR, {
        message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
        details: { field: "password" },
    });

const restErrorCode = (body) => String(body?.error?.message ?? "").split(/[\s:]/)[0];

const isAdminError = (err, code) => (err?.code ?? err?.errorInfo?.code) === code;

export class FirebaseIdentity {
    constructor({
        apiKey = FIREBASE_WEB_API_KEY,
        adminConfigured = hasFirebaseAdminCredentials(),
        adminAuth = () => firebaseAdminAuth(),
        verifyIdToken = verifyFirebaseIdToken,
        fetchImpl = (...args) => fetch(...args),
    } = {}) {
        this.apiKey = apiKey;
        this.adminConfigured = adminConfigured;
        this.adminAuth = adminAuth;
        this.verifyIdToken = verifyIdToken;
        this.fetchImpl = fetchImpl;
    }

    get isConfigured() {
        return Boolean(this.apiKey && this.adminConfigured);
    }

    async #call(method, body, language) {
        const headers = { "Content-Type": "application/json" };
        if (language) headers["X-Firebase-Locale"] = emailLanguage(language);
        const response = await this.fetchImpl(`${IDENTITY_TOOLKIT_URL}:${method}?key=${this.apiKey}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, data };
        return { ok: false, code: restErrorCode(data) };
    }

    #unexpected(method, code) {
        return new Error(`Firebase ${method} respondió ${code || "sin código"}`);
    }

    async signInWithPassword(email, password) {
        const result = await this.#call("signInWithPassword", { email, password, returnSecureToken: true });
        if (result.ok) return { idToken: result.data.idToken, uid: result.data.localId };
        if (INVALID_CREDENTIALS.has(result.code)) return null;
        if (result.code === "TOO_MANY_ATTEMPTS_TRY_LATER") throw customError(ErrorCode.DEMASIADOS_INTENTOS);
        throw this.#unexpected("signInWithPassword", result.code);
    }

    async verify(idToken) {
        return this.verifyIdToken(idToken);
    }

    async signUp(email, password, name) {
        const result = await this.#call("signUp", { email, password, displayName: name, returnSecureToken: true });
        if (result.ok) return { idToken: result.data.idToken, uid: result.data.localId };
        if (result.code === "EMAIL_EXISTS") throw customError(ErrorCode.EMAIL_YA_REGISTRADO);
        if (result.code === "WEAK_PASSWORD") throw weakPassword();
        if (result.code === "INVALID_EMAIL") {
            throw customError(ErrorCode.VALIDATION_ERROR, { message: "El email no es válido.", details: { field: "email" } });
        }
        throw this.#unexpected("signUp", result.code);
    }

    async sendVerificationEmail(idToken, language) {
        const result = await this.#call("sendOobCode", { requestType: "VERIFY_EMAIL", idToken }, language);
        if (result.ok) return;
        if (result.code === "TOO_MANY_ATTEMPTS_TRY_LATER") throw customError(ErrorCode.DEMASIADOS_INTENTOS);
        throw this.#unexpected("sendOobCode VERIFY_EMAIL", result.code);
    }

    async sendPasswordResetEmail(email, language) {
        const result = await this.#call("sendOobCode", { requestType: "PASSWORD_RESET", email }, language);
        if (result.ok || result.code === "EMAIL_NOT_FOUND") return;
        if (result.code === "TOO_MANY_ATTEMPTS_TRY_LATER") throw customError(ErrorCode.DEMASIADOS_INTENTOS);
        throw this.#unexpected("sendOobCode PASSWORD_RESET", result.code);
    }

    async #findUser({ uid, email }) {
        const auth = this.adminAuth();
        for (const lookup of [uid && (() => auth.getUser(uid)), email && (() => auth.getUserByEmail(email))]) {
            if (!lookup) continue;
            try {
                return await lookup();
            } catch (err) {
                if (!isAdminError(err, "auth/user-not-found")) throw err;
            }
        }
        return null;
    }

    async hasPasswordProvider({ uid, email }) {
        const user = await this.#findUser({ uid, email });
        return Boolean(user?.providerData?.some((p) => p.providerId === "password"));
    }

    async #withPasswordErrors(fn) {
        try {
            return await fn();
        } catch (err) {
            if (isAdminError(err, "auth/invalid-password")) throw weakPassword();
            throw err;
        }
    }

    async setPassword({ uid, email, name, password }) {
        const auth = this.adminAuth();
        const existing = await this.#findUser({ uid, email });
        return this.#withPasswordErrors(async () => {
            if (existing) {
                await auth.updateUser(existing.uid, { password, emailVerified: true });
                return existing.uid;
            }
            const created = await auth.createUser({ email, password, emailVerified: true, displayName: name || undefined });
            return created.uid;
        });
    }

    async ensureRecoverableUser({ uid, email, name }) {
        const auth = this.adminAuth();
        const existing = await this.#findUser({ uid, email });
        const randomPassword = randomBytes(24).toString("base64url");
        if (!existing) {
            const created = await auth.createUser({
                email,
                password: randomPassword,
                emailVerified: true,
                displayName: name || undefined,
            });
            return created.uid;
        }
        const hasPassword = existing.providerData?.some((p) => p.providerId === "password");
        if (!hasPassword) await auth.updateUser(existing.uid, { password: randomPassword });
        return existing.uid;
    }
}
