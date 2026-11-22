import { customError, ErrorCode } from "../utils/errors.js";
import { generatePushToken, isPushConfigured } from "../utils/push-notifications.js";

export class UserService {
    constructor({
        userRepository
    }) {
        this.userRepository = userRepository;
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

    getPushToken(userId, requestedUserId) {
        if (String(requestedUserId) !== String(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
        if (!isPushConfigured()) {
            throw customError(ErrorCode.PUSH_NO_CONFIGURADO);
        }
        return generatePushToken(userId);
    }

    async updatePushLanguage(userId, language) {
        const rows = await this.userRepository.updatePushLanguage(userId, language);

        if (rows.length === 0) {
            throw customError(ErrorCode.USUARIO_NOT_FOUND);
        }

        return rows[0];
    }
}
