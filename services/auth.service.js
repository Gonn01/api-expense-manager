import bcrypt from "bcrypt";
import { AuthRateLimits } from "../utils/auth-rate-limits.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { verifyFirebaseIdToken } from "../utils/firebase-token.js";
import { normalizeEmail } from "../utils/normalize-email.js";
import { signSessionToken } from "../utils/session-token.js";

const UNIQUE_VIOLATION = "23505";
const PLACEHOLDER_PASSWORD_HASH = "$2b$12$ArIUFnyhsSHg5gE/cmrshetAZGE5LxKSkFzmg2.1O/V7QyfMWhLNW";

const isUniqueViolation = (err) => err?.code === UNIQUE_VIOLATION;

export class AuthService {
    constructor({
        authRepository,
        rateLimitService,
        verifyIdToken = verifyFirebaseIdToken,
        identity = null,
    }) {
        this.authRepository = authRepository;
        this.rateLimitService = rateLimitService;
        this.verifyIdToken = verifyIdToken;
        this.identity = identity;
    }

    get #usesFirebase() {
        return Boolean(this.identity?.isConfigured);
    }

    #requireFirebase() {
        if (!this.#usesFirebase) throw customError(ErrorCode.AUTH_EMAIL_NO_CONFIGURADO);
    }

    #session(account) {
        const user = { ...account };
        delete user.password;
        delete user.token_version;
        return { user, token: signSessionToken(account) };
    }

    async #legacyPasswordMatches(account, password) {
        const match = await bcrypt.compare(password, account?.password ?? PLACEHOLDER_PASSWORD_HASH);
        return Boolean(account?.password) && match;
    }

    async login(email, password, { clientIp } = {}) {
        const normalizedEmail = normalizeEmail(email);
        const rules = AuthRateLimits.login(normalizedEmail, clientIp);
        await this.rateLimitService.consume(rules);

        const account = this.#usesFirebase
            ? await this.#loginWithFirebase(normalizedEmail, password)
            : await this.#loginWithLegacyPassword(normalizedEmail, password);

        await this.rateLimitService.reset(rules.slice(0, 1));
        return this.#session(account);
    }

    async #loginWithLegacyPassword(email, password) {
        const [account] = await this.authRepository.findUserWithPasswordByEmail(email);
        if (!(await this.#legacyPasswordMatches(account, password))) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }
        return account;
    }

    async #loginWithFirebase(email, password) {
        const signIn = await this.identity.signInWithPassword(email, password);
        if (!signIn) return this.#migrateLegacyPassword(email, password);

        const identity = await this.identity.verify(signIn.idToken);
        if (!identity.emailVerified) throw customError(ErrorCode.EMAIL_NO_VERIFICADO);
        return this.#resolvePasswordAccount(identity, email);
    }

    async #migrateLegacyPassword(email, password) {
        const [account] = await this.authRepository.findUserWithPasswordByEmail(email);
        const matches = await this.#legacyPasswordMatches(account, password);
        if (!matches) throw customError(ErrorCode.CREDENCIALES_INVALIDAS);

        const firebaseHasPassword = await this.identity.hasPasswordProvider({
            uid: account.firebase_user_id,
            email: account.email,
        });
        if (firebaseHasPassword) {
            await this.authRepository.moveToFirebase(account.id, account.firebase_user_id);
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        const firebaseId = await this.identity.setPassword({
            uid: account.firebase_user_id,
            email: account.email,
            name: account.name,
            password,
        });
        const [migrated] = await this.authRepository.moveToFirebase(account.id, firebaseId);
        return migrated;
    }

    async #resolvePasswordAccount(identity, email, canRetry = true) {
        const [byFirebaseId] = await this.authRepository.findUserWithPasswordByFirebaseId(identity.firebaseId);
        if (byFirebaseId) {
            if (!byFirebaseId.password) return byFirebaseId;
            const [cleared] = await this.authRepository.moveToFirebase(byFirebaseId.id, identity.firebaseId);
            return cleared;
        }

        const [byEmail] = await this.authRepository.findUserWithPasswordByEmail(email);
        if (byEmail) {
            const [linked] = await this.authRepository.moveToFirebase(byEmail.id, identity.firebaseId);
            return linked;
        }

        try {
            const [created] = await this.authRepository.createUser(
                identity.name ?? email.split("@")[0],
                email,
                null,
                identity.firebaseId,
                identity.avatar,
            );
            return created;
        } catch (err) {
            if (canRetry && isUniqueViolation(err)) return this.#resolvePasswordAccount(identity, email, false);
            throw err;
        }
    }

    async firebaseLogin(idToken, linkOptions = {}, { clientIp } = {}) {
        await this.rateLimitService.consume(AuthRateLimits.googleLogin(clientIp));
        const identity = await this.verifyIdToken(idToken);
        const user = await this.#resolveGoogleAccount(identity, linkOptions);
        return this.#session(user);
    }

    async #resolveGoogleAccount(identity, linkOptions, canRetry = true) {
        if (!identity.email || !identity.emailVerified) {
            throw customError(ErrorCode.GOOGLE_EMAIL_NO_VERIFICADO);
        }

        const byFirebaseId = await this.authRepository.findUserByFirebaseId(identity.firebaseId);
        if (byFirebaseId.length > 0) return byFirebaseId[0];

        const email = normalizeEmail(identity.email);
        const byEmail = await this.authRepository.findUserWithPasswordByEmail(email);

        if (byEmail.length > 0) {
            return this.#linkGoogle(byEmail[0], identity, linkOptions);
        }

        try {
            const inserted = await this.authRepository.createUser(
                identity.name,
                email,
                null,
                identity.firebaseId,
                identity.avatar
            );
            return inserted[0];
        } catch (err) {
            if (canRetry && isUniqueViolation(err)) {
                return this.#resolveGoogleAccount(identity, linkOptions, false);
            }
            throw err;
        }
    }

    async #linkGoogle(account, identity, { password, discardPassword = false }) {
        const shouldDiscard = Boolean(account.password) && discardPassword === true;

        if (account.password && !shouldDiscard) {
            if (typeof password !== "string" || password.length === 0) {
                throw customError(ErrorCode.VINCULACION_REQUIERE_CONTRASENA);
            }
            const rules = AuthRateLimits.password(account.id);
            await this.rateLimitService.consume(rules);
            if (!(await bcrypt.compare(password, account.password))) {
                throw customError(ErrorCode.CONTRASENA_INCORRECTA);
            }
            await this.rateLimitService.reset(rules);
        }

        const linked = await this.authRepository.linkFirebaseId(account.id, {
            firebaseId: identity.firebaseId,
            name: identity.name,
            avatar: identity.avatar,
            discardPassword: shouldDiscard,
        });
        return linked[0];
    }

    async register(name, email, password, { clientIp, language } = {}) {
        await this.rateLimitService.consume(AuthRateLimits.register(clientIp));
        const normalizedEmail = normalizeEmail(email);
        const existing = await this.authRepository.findUserWithPasswordByEmail(normalizedEmail);

        if (existing.length > 0) {
            const hasPassword =
                Boolean(existing[0].password) ||
                (this.#usesFirebase &&
                    (await this.identity.hasPasswordProvider({
                        uid: existing[0].firebase_user_id,
                        email: normalizedEmail,
                    })));
            throw customError(hasPassword ? ErrorCode.EMAIL_YA_REGISTRADO : ErrorCode.EMAIL_REGISTRADO_CON_GOOGLE);
        }

        if (!this.#usesFirebase) {
            await this.#createAccount(name, normalizedEmail, await bcrypt.hash(password, 12), null);
            return { verification_sent: false };
        }

        const { idToken, uid } = await this.identity.signUp(normalizedEmail, password, name);
        await this.identity.sendVerificationEmail(idToken, language);
        await this.#createAccount(name, normalizedEmail, null, uid);
        return { verification_sent: true };
    }

    async #createAccount(name, email, hash, firebaseId) {
        try {
            await this.authRepository.createUser(name, email, hash, firebaseId);
        } catch (err) {
            if (isUniqueViolation(err)) {
                throw customError(ErrorCode.EMAIL_YA_REGISTRADO);
            }
            throw err;
        }
    }

    async resendVerification(email, password, { clientIp, language } = {}) {
        this.#requireFirebase();
        const normalizedEmail = normalizeEmail(email);
        await this.rateLimitService.consume(AuthRateLimits.verificationEmail(normalizedEmail, clientIp));

        const signIn = await this.identity.signInWithPassword(normalizedEmail, password);
        if (!signIn) throw customError(ErrorCode.CREDENCIALES_INVALIDAS);

        const identity = await this.identity.verify(signIn.idToken);
        if (identity.emailVerified) return { verification_sent: false, already_verified: true };

        await this.identity.sendVerificationEmail(signIn.idToken, language);
        return { verification_sent: true, already_verified: false };
    }

    async requestPasswordReset(email, { clientIp, language } = {}) {
        this.#requireFirebase();
        const normalizedEmail = normalizeEmail(email);
        await this.rateLimitService.consume(AuthRateLimits.passwordReset(normalizedEmail, clientIp));

        const [account] = await this.authRepository.findUserWithPasswordByEmail(normalizedEmail);
        if (account) {
            const firebaseId = await this.identity.ensureRecoverableUser({
                uid: account.firebase_user_id,
                email: account.email,
                name: account.name,
            });
            if (account.password || account.firebase_user_id !== firebaseId) {
                await this.authRepository.moveToFirebase(account.id, firebaseId);
            }
        }

        await this.identity.sendPasswordResetEmail(normalizedEmail, language);
        return { sent: true };
    }
}
