import bcrypt from "bcrypt";
import { customError, ErrorCode } from "../utils/errors.js";
import { generatePushToken, isPushConfigured } from "../utils/push-notifications.js";
import { authorizePusherChannel, userChannel } from "../utils/pusher.js";

export class UserService {
    constructor({
        userRepository,
        authorizeChannel = authorizePusherChannel,
    }) {
        this.userRepository = userRepository;
        this.authorizeChannel = authorizeChannel;
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

    async #currentPasswordHash(userId) {
        const rows = await this.userRepository.getPasswordHash(userId);

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0].password;
    }

    async getPasswordStatus(userId) {
        const hash = await this.#currentPasswordHash(userId);
        return { has_password: Boolean(hash) };
    }

    async updatePassword(userId, currentPassword, newPassword) {
        const hash = await this.#currentPasswordHash(userId);

        if (hash) {
            const matches =
                typeof currentPassword === "string" && (await bcrypt.compare(currentPassword, hash));
            if (!matches) {
                throw customError(ErrorCode.CONTRASENA_INCORRECTA);
            }
        }

        await this.userRepository.updatePassword(userId, await bcrypt.hash(newPassword, 12));
        return { has_password: true };
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
