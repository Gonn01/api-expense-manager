import { executeQuery } from '../db.js';

export class UserRepository {
    async updatePreferredCurrency(userId, preferredCurrency) {
        return await executeQuery(
            `UPDATE users
             SET preferred_currency = $2
             WHERE id = $1
             RETURNING id, name, email, avatar, firebase_user_id, preferred_currency, sueldo, sueldo_currency`,
            [userId, preferredCurrency]
        );
    }

    async updateSueldo(userId, sueldo, sueldoCurrency) {
        return await executeQuery(
            `UPDATE users
             SET sueldo = $2,
                 sueldo_currency = COALESCE($3, sueldo_currency)
             WHERE id = $1
             RETURNING id, name, email, avatar, firebase_user_id, preferred_currency, sueldo, sueldo_currency`,
            [userId, sueldo, sueldoCurrency ?? null]
        );
    }
}
