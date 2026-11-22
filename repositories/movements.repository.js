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
            `SELECT id, created_at, movement_type, amount, payment_date, detail,
                    created_by_user_id, paired_movement_id,
                    reversal_requested_by_user_id, reversal_requested_at
             FROM purchases_movements
             WHERE purchase_id = $1
             ORDER BY created_at DESC, id DESC`,
            [gastoId]
        );
    }

    async getReceivedPayments(siblingId, userId, includePending) {
        return await executeQuery(
            `SELECT req.id, req.created_at, 'PAYMENT_RECEIVED' AS movement_type, req.amount, req.payment_date,
                    NULL AS detail, req.created_by_user_id, resolved.paired_movement_id,
                    NULL AS reversal_requested_by_user_id, NULL AS reversal_requested_at
             FROM purchases_movements req
             LEFT JOIN purchases_movements resolved
               ON req.movement_type = 'PAYMENT_REQUESTED' AND resolved.id = req.paired_movement_id
             WHERE req.purchase_id = $1
               AND req.created_by_user_id <> $2
               AND ((req.movement_type = 'PENDING_PAYMENT' AND $3::boolean)
                 OR (req.movement_type = 'PAYMENT_REQUESTED'
                     AND resolved.movement_type IN ('PAYMENT', 'PAYMENT_REVERTED')))`,
            [siblingId, userId, includePending]
        );
    }

    async getSharedSentEvent(purchaseId) {
        return await executeQuery(
            `SELECT -m.id AS id, m.created_at, 'SHARED_SENT' AS movement_type, NULL AS amount,
                    NULL AS payment_date, NULL AS detail, fe.user_id AS created_by_user_id,
                    NULL AS paired_movement_id, NULL AS reversal_requested_by_user_id,
                    NULL AS reversal_requested_at
             FROM purchases copia
             JOIN purchases_movements m ON m.purchase_id = copia.id AND m.movement_type = 'CREATION'
             JOIN purchases original ON original.id = copia.shared_from_id
             LEFT JOIN financial_entities fe ON fe.id = original.financial_entity_id
             WHERE copia.id = $1 OR copia.shared_from_id = $1
             ORDER BY m.created_at ASC, m.id ASC
             LIMIT 1`,
            [purchaseId]
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

    async createGastoLog(gastoId, movementType, amount = null, paymentDate = null, createdByUserId = null, detail = null) {
        return await executeQuery(
            `INSERT INTO purchases_movements (created_at, purchase_id, movement_type, amount, payment_date, created_by_user_id, detail)
             VALUES (NOW(), $1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [gastoId, movementType, amount, paymentDate, createdByUserId, detail]
        );
    }

    async createGastoLogs(logs) {
        if (!logs.length) return [];
        const values = [];
        const rows = logs.map((log, i) => {
            const b = i * 7;
            values.push(
                log.gastoId,
                log.movementType,
                log.amount ?? null,
                log.paymentDate ?? null,
                log.createdByUserId ?? null,
                log.detail ?? null,
                log.pairedMovementId ?? null,
            );
            return `(NOW(), $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
        });
        return await executeQuery(
            `INSERT INTO purchases_movements
                 (created_at, purchase_id, movement_type, amount, payment_date, created_by_user_id, detail, paired_movement_id)
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
        return await this.closePendingPayment(movementId, "PAYMENT");
    }

    async confirmPendingPayments(movementIds) {
        return await this.closePendingPayments(movementIds, "PAYMENT");
    }

    async closePendingPayment(movementId, movementType) {
        return await this.closePendingPayments([movementId], movementType);
    }

    async closePendingPayments(movementIds, movementType) {
        if (!movementIds.length) return [];
        const placeholders = movementIds.map((_, i) => `$${i + 2}`).join(", ");
        return await executeQuery(
            `WITH original AS (
                 SELECT *
                 FROM purchases_movements
                 WHERE id IN (${placeholders}) AND movement_type = 'PENDING_PAYMENT'
                 FOR UPDATE
             ),
             resolved AS (
                 UPDATE purchases_movements pm
                 SET movement_type = $1, created_at = NOW()
                 FROM original
                 WHERE pm.id = original.id
                 RETURNING pm.*
             ),
             requested AS (
                 INSERT INTO purchases_movements
                     (created_at, purchase_id, movement_type, amount, payment_date,
                      created_by_user_id, detail, paired_movement_id)
                 SELECT created_at, purchase_id, 'PAYMENT_REQUESTED'::movement_type, amount, payment_date,
                        created_by_user_id, detail, id
                 FROM original
             )
             SELECT * FROM resolved`,
            [movementType, ...movementIds]
        );
    }

    async logPaymentEvent(movementIds, movementType, userId) {
        const ids = movementIds.filter((id) => id != null);
        if (!ids.length) return [];
        const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
        return await executeQuery(
            `INSERT INTO purchases_movements
                 (created_at, purchase_id, movement_type, created_by_user_id, paired_movement_id)
             SELECT NOW(), purchase_id, $1::movement_type, $2::integer, id
             FROM purchases_movements
             WHERE id IN (${placeholders})
             RETURNING *`,
            [movementType, userId, ...ids]
        );
    }

    async getPaymentById(movementId) {
        return await executeQuery(
            `SELECT id, purchase_id, movement_type, amount, payment_date, created_by_user_id,
                    paired_movement_id, reversal_requested_by_user_id, reversal_requested_at
             FROM purchases_movements
             WHERE id = $1 AND movement_type IN ('PAYMENT', 'PENDING_PAYMENT')`,
            [movementId]
        );
    }

    async getMovementsByIds(ids) {
        const unique = [...new Set(ids.map(Number))].filter(Number.isFinite);
        if (!unique.length) return [];
        const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `SELECT id, purchase_id, movement_type, reversal_requested_by_user_id
             FROM purchases_movements
             WHERE id IN (${placeholders})`,
            unique
        );
    }

    async getPendingPaymentsByPurchases(purchaseIds) {
        const unique = [...new Set(purchaseIds.map(Number))].filter(Number.isFinite);
        if (!unique.length) return [];
        const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `SELECT id, purchase_id, movement_type, amount, payment_date, created_by_user_id
             FROM purchases_movements
             WHERE purchase_id IN (${placeholders}) AND movement_type = 'PENDING_PAYMENT'
             ORDER BY created_at ASC, id ASC`,
            unique
        );
    }

    async getPendingReversalIds(purchaseIds) {
        const unique = [...new Set(purchaseIds.map(Number))].filter(Number.isFinite);
        if (!unique.length) return [];
        const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `SELECT id
             FROM purchases_movements
             WHERE purchase_id IN (${placeholders})
               AND movement_type = 'PAYMENT'
               AND reversal_requested_by_user_id IS NOT NULL`,
            unique
        );
    }

    async setPairedMovement(movementId, pairedId) {
        return await executeQuery(
            `UPDATE purchases_movements SET paired_movement_id = $2 WHERE id = $1`,
            [movementId, pairedId]
        );
    }

    async setPairedMovements(pairs) {
        if (!pairs.length) return [];
        const rows = pairs.map((_, i) => `($${i * 2 + 1}::integer, $${i * 2 + 2}::integer)`);
        return await executeQuery(
            `UPDATE purchases_movements pm
             SET paired_movement_id = v.paired_id
             FROM (VALUES ${rows.join(", ")}) AS v(id, paired_id)
             WHERE pm.id = v.id`,
            pairs.flat()
        );
    }

    async setReversalRequest(movementIds, userId) {
        const ids = movementIds.filter((id) => id != null);
        if (!ids.length) return [];
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
        return await executeQuery(
            `UPDATE purchases_movements
             SET reversal_requested_by_user_id = $1, reversal_requested_at = NOW()
             WHERE id IN (${placeholders}) AND movement_type = 'PAYMENT'
             RETURNING *`,
            [userId, ...ids]
        );
    }

    async clearReversalRequest(movementIds) {
        const ids = movementIds.filter((id) => id != null);
        if (!ids.length) return [];
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `UPDATE purchases_movements
             SET reversal_requested_by_user_id = NULL, reversal_requested_at = NULL
             WHERE id IN (${placeholders})
             RETURNING *`,
            ids
        );
    }

    async revertPaymentsByIds(movementIds) {
        const ids = movementIds.filter((id) => id != null);
        if (!ids.length) return [];
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `UPDATE purchases_movements
             SET movement_type = 'PAYMENT_REVERTED',
                 reversal_requested_by_user_id = NULL,
                 reversal_requested_at = NULL
             WHERE id IN (${placeholders}) AND movement_type = 'PAYMENT'
             RETURNING *`,
            ids
        );
    }
}
