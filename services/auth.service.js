import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { verifyFirebaseIdToken } from "../utils/firebase-token.js";
import { normalizeEmail } from "../utils/normalize-email.js";

const UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (err) => err?.code === UNIQUE_VIOLATION;

export class AuthService {
    constructor({
        authRepository,
        verifyIdToken = verifyFirebaseIdToken,
    }) {
        this.authRepository = authRepository;
        this.verifyIdToken = verifyIdToken;
    }

    #session(user) {
        const token = jwt.sign(
            { userId: user.id, email: user.email, firebaseId: user.firebase_user_id },
            JWT_SECRET,
            { expiresIn: "7d" }
        );
        return { user, token };
    }

    async login(email, password) {
        const users = await this.authRepository.findUserWithPasswordByEmail(normalizeEmail(email));

        if (users.length === 0 || !users[0].password) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        const { password: hash, ...user } = users[0];

        const match = await bcrypt.compare(password, hash);

        if (!match) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        return this.#session(user);
    }

    async firebaseLogin(idToken, linkOptions = {}) {
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
            if (!(await bcrypt.compare(password, account.password))) {
                throw customError(ErrorCode.CONTRASENA_INCORRECTA);
            }
        }

        const linked = await this.authRepository.linkFirebaseId(account.id, {
            firebaseId: identity.firebaseId,
            name: identity.name,
            avatar: identity.avatar,
            discardPassword: shouldDiscard,
        });
        return linked[0];
    }

    async register(name, email, password) {
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
