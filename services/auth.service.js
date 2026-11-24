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
    }) {
        this.authRepository = authRepository;
        this.rateLimitService = rateLimitService;
        this.verifyIdToken = verifyIdToken;
    }

    #session(account) {
        const user = { ...account };
        delete user.password;
        delete user.token_version;
        return { user, token: signSessionToken(account) };
    }

    async login(email, password, { clientIp } = {}) {
        const normalizedEmail = normalizeEmail(email);
        const rules = AuthRateLimits.login(normalizedEmail, clientIp);
        await this.rateLimitService.consume(rules);

        const [account] = await this.authRepository.findUserWithPasswordByEmail(normalizedEmail);
        const match = await bcrypt.compare(password, account?.password ?? PLACEHOLDER_PASSWORD_HASH);

        if (!account?.password || !match) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        await this.rateLimitService.reset(rules.slice(0, 1));
        return this.#session(account);
    }

    async firebaseLogin(idToken, linkOptions = {}, { clientIp } = {}) {
        await this.rateLimitService.consume(AuthRateLimits.googleLogin(clientIp));
        const identity = await this.verifyIdToken(idToken);
        const user = await this.#resolveGoogleAccount(identity, linkOptions);
        return this.#session(user);
    }

    async #resolveGoogleAccount(identity, linkOptions, canRetry = true) {
        const byFirebaseId = await this.authRepository.findUserByFirebaseId(identity.firebaseId);
        if (byFirebaseId.length > 0) return byFirebaseId[0];

        if (!identity.email || !identity.emailVerified) {
            throw customError(ErrorCode.GOOGLE_EMAIL_NO_VERIFICADO);
        }

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

    async register(name, email, password, { clientIp } = {}) {
        await this.rateLimitService.consume(AuthRateLimits.register(clientIp));
        const normalizedEmail = normalizeEmail(email);
        const existing = await this.authRepository.findUserWithPasswordByEmail(normalizedEmail);

        if (existing.length > 0) {
            throw customError(
                existing[0].password ? ErrorCode.EMAIL_YA_REGISTRADO : ErrorCode.EMAIL_REGISTRADO_CON_GOOGLE
            );
        }

        const hash = await bcrypt.hash(password, 12);

        try {
            await this.authRepository.createUser(name, normalizedEmail, hash, null);
        } catch (err) {
            if (isUniqueViolation(err)) {
                throw customError(ErrorCode.EMAIL_YA_REGISTRADO);
            }
            throw err;
        }
    }
}
