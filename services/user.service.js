import bcrypt from "bcrypt";
import { AuthRateLimits } from "../utils/auth-rate-limits.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { signSessionToken } from "../utils/session-token.js";
import { generatePushToken, isPushConfigured } from "../utils/push-notifications.js";
import { authorizePusherChannel, userChannel } from "../utils/pusher.js";

export class UserService {
    constructor({
        userRepository,
        rateLimitService,
        authorizeChannel = authorizePusherChannel,
        identity = null,
    }) {
        this.userRepository = userRepository;
        this.rateLimitService = rateLimitService;
        this.authorizeChannel = authorizeChannel;
        this.identity = identity;
    }

    get #usesFirebase() {
        return Boolean(this.identity?.isConfigured);
    }

    async updatePreferredCurrency(userId, preferredCurrency) {
        const rows = await this.userRepository.updatePreferredCurrency(
            userId,
            preferredCurrency
        );

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0];
    }

    async updateSueldo(userId, sueldo, sueldoCurrency) {
        const rows = await this.userRepository.updateSueldo(userId, sueldo, sueldoCurrency);

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0];
    }

    async #passwordInfo(userId) {
        const rows = await this.userRepository.getPasswordInfo(userId);

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0];
    }

    async #firebaseHasPassword(info) {
        if (!this.#usesFirebase) return false;
        return this.identity.hasPasswordProvider({ uid: info.firebase_user_id, email: info.email });
    }

    async getPasswordStatus(userId) {
        const info = await this.#passwordInfo(userId);
        const hasPassword = Boolean(info.password) || (await this.#firebaseHasPassword(info));
        return { has_password: hasPassword };
    }

    async #checkCurrentPassword(userId, info, currentPassword) {
        const firebaseHasPassword = await this.#firebaseHasPassword(info);
        if (!firebaseHasPassword && !info.password) return;

        const rules = AuthRateLimits.password(userId);
        await this.rateLimitService.consume(rules);
        const provided = typeof currentPassword === "string" && currentPassword.length > 0;
        const matches = !provided
            ? false
            : firebaseHasPassword
              ? Boolean(await this.identity.signInWithPassword(info.email, currentPassword))
              : await bcrypt.compare(currentPassword, info.password);
        if (!matches) {
            throw customError(ErrorCode.CONTRASENA_INCORRECTA);
        }
        await this.rateLimitService.reset(rules);
    }

    async updatePassword(userId, currentPassword, newPassword) {
        const info = await this.#passwordInfo(userId);
        await this.#checkCurrentPassword(userId, info, currentPassword);

        const [updated] = this.#usesFirebase
            ? await this.userRepository.moveToFirebasePassword(
                  userId,
                  await this.identity.setPassword({
                      uid: info.firebase_user_id,
                      email: info.email,
                      name: info.name,
                      password: newPassword,
                  }),
              )
            : await this.userRepository.updatePassword(userId, await bcrypt.hash(newPassword, 12));
        if (!updated) throw customError(ErrorCode.USUARIO_NOT_FOUND);
        return { has_password: true, token: signSessionToken(updated) };
    }

    async revokeSessions(userId) {
        const rows = await this.userRepository.revokeSessions(userId);
        if (rows.length === 0) throw customError(ErrorCode.USUARIO_NOT_FOUND);
        return { revoked: true };
    }

    getPushToken(userId, requestedUserId) {
        if (String(requestedUserId) !== String(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
        if (!isPushConfigured()) {
            throw customError(ErrorCode.PUSH_NO_CONFIGURADO);
        }
        return generatePushToken(userId);
    }

    authorizeRealtimeChannel(userId, socketId, channelName) {
        if (channelName !== userChannel(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
        return this.authorizeChannel(socketId, channelName);
    }

    async updatePushLanguage(userId, language) {
        const rows = await this.userRepository.updatePushLanguage(userId, language);

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0];
    }
}
