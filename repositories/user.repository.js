import { executeQuery } from '../db.js';
import { USER_PUBLIC_COLUMNS } from './user-columns.js';

export class UserRepository {
    async updatePreferredCurrency(userId, preferredCurrency) {
        return await executeQuery(
            `UPDATE users
             SET preferred_currency = $2
             WHERE id = $1
             RETURNING ${USER_PUBLIC_COLUMNS}`,
            [userId, preferredCurrency]
        );
    }

    async updateSueldo(userId, sueldo, sueldoCurrency) {
        return await executeQuery(
            `UPDATE users
             SET sueldo = $2,
                 sueldo_currency = COALESCE($3, sueldo_currency)
             WHERE id = $1
             RETURNING ${USER_PUBLIC_COLUMNS}`,
            [userId, sueldo, sueldoCurrency ?? null]
        );
    }

    async getPasswordHash(userId) {
        return await executeQuery(
            `SELECT password FROM users WHERE id = $1`,
            [userId]
        );
    }

    async updatePassword(userId, hash) {
        return await executeQuery(
            `UPDATE users
             SET password = $2, token_version = token_version + 1
             WHERE id = $1
             RETURNING id, token_version`,
            [userId, hash]
        );
    }

    async getTokenVersion(userId) {
        return await executeQuery(`SELECT token_version FROM users WHERE id = $1`, [userId]);
    }

    async revokeSessions(userId) {
        return await executeQuery(
            `UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING id`,
            [userId]
        );
    }

    async getPushLanguage(userId) {
        return await executeQuery(
            `SELECT push_language FROM users WHERE id = $1`,
            [userId]
        );
    }

    async updatePushLanguage(userId, language) {
        return await executeQuery(
            `UPDATE users
             SET push_language = $2
             WHERE id = $1
             RETURNING push_language`,
            [userId, language]
        );
    }
}
