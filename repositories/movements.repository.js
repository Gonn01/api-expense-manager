import { executeQuery } from "../db.js";

export class MovementsRepository {
    async getMovementsByEntidad(entidadId) {
        return await executeQuery(
            `SELECT id, created_at, movement_type, detail
             FROM financial_entities_movements
             WHERE financial_entity_id = $1
             ORDER BY created_at DESC`,
            [entidadId]
        );
    }

    async getMovementsByGasto(gastoId) {
        return await executeQuery(
            `SELECT id, created_at, movement_type, amount, payment_date, detail
             FROM purchases_movements
             WHERE purchase_id = $1
             ORDER BY created_at DESC`,
            [gastoId]
        );
    }

    async createEntidadLog(entidadId, movementType, detail = null) {
        return await executeQuery(
            `INSERT INTO financial_entities_movements (created_at, financial_entity_id, movement_type, detail)
             VALUES (NOW(), $1, $2, $3)
             RETURNING *`,
            [entidadId, movementType, detail]
        );
    }

    async deletePayments(gastoId) {
        return await executeQuery(
            `DELETE FROM purchases_movements WHERE purchase_id = $1 AND movement_type = 'PAYMENT'`,
            [gastoId]
        );
    }

    async deleteLastPayment(gastoId) {
        return await executeQuery(
            `DELETE FROM purchases_movements
             WHERE id = (
                 SELECT id FROM purchases_movements
                 WHERE purchase_id = $1 AND movement_type = 'PAYMENT'
                 ORDER BY payment_date DESC, created_at DESC
                 LIMIT 1
             )
             RETURNING *`,
            [gastoId]
        );
    }

    async createGastoLog(gastoId, movementType, amount = null, paymentDate = null, createdByUserId = null, detail = null) {
        return await executeQuery(
            `INSERT INTO purchases_movements (created_at, purchase_id, movement_type, amount, payment_date, created_by_user_id, detail)
             VALUES (NOW(), $1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [gastoId, movementType, amount, paymentDate, createdByUserId, detail]
        );
    }

    /**
     * Inserta varios movimientos en una sola consulta (todo o nada).
     * @param {{ gastoId, movementType, amount?, paymentDate?, createdByUserId? }[]} logs
     */
    async createGastoLogs(logs) {
        if (!logs.length) return [];
        const values = [];
        const rows = logs.map((log, i) => {
            const b = i * 5;
            values.push(
                log.gastoId,
                log.movementType,
                log.amount ?? null,
                log.paymentDate ?? null,
                log.createdByUserId ?? null,
            );
            return `(NOW(), $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
        });
        return await executeQuery(
            `INSERT INTO purchases_movements (created_at, purchase_id, movement_type, amount, payment_date, created_by_user_id)
             VALUES ${rows.join(", ")}
             RETURNING *`,
            values
        );
    }

    async getPendingPaymentById(movementId) {
        return await executeQuery(
            `SELECT id, purchase_id, movement_type, amount, payment_date, created_by_user_id
             FROM purchases_movements
             WHERE id = $1 AND movement_type = 'PENDING_PAYMENT'`,
            [movementId]
        );
    }

    async confirmPendingPayment(movementId) {
        return await executeQuery(
            `UPDATE purchases_movements
             SET movement_type = 'PAYMENT'
             WHERE id = $1 AND movement_type = 'PENDING_PAYMENT'
             RETURNING *`,
            [movementId]
        );
    }

    async deletePendingPayment(movementId) {
        return await executeQuery(
            `DELETE FROM purchases_movements
             WHERE id = $1 AND movement_type = 'PENDING_PAYMENT'
             RETURNING *`,
            [movementId]
        );
    }
}
