import { executeQuery } from "../db.js";

export class SettlementRepository {
    // `forUpdate` bloquea la fila hasta el fin de la transacción en curso (solo
    // tiene efecto dentro de withTransaction): lo usa el cierre de la sesión.
    async getOpenSession(userId, { forUpdate = false } = {}) {
        const rows = await executeQuery(
            `SELECT id, user_id, status, started_at, finished_at
             FROM settlement_sessions
             WHERE user_id = $1 AND status = 'OPEN'
             LIMIT 1
             ${forUpdate ? "FOR UPDATE" : ""}`,
            [userId],
        );
        return rows[0] ?? null;
    }

    async createSession(userId) {
        const rows = await executeQuery(
            `INSERT INTO settlement_sessions (user_id, status)
             VALUES ($1, 'OPEN')
             RETURNING id, user_id, status, started_at, finished_at`,
            [userId],
        );
        return rows[0];
    }

    async getSessionItems(sessionId) {
        return await executeQuery(
            `SELECT purchase_id, quota_number, checked_at
             FROM settlement_session_items
             WHERE session_id = $1
             ORDER BY checked_at ASC`,
            [sessionId],
        );
    }

    async upsertItem(sessionId, purchaseId) {
        return await this.upsertItems(sessionId, [purchaseId]);
    }

    /**
     * Marca varios gastos en la sesión en una sola consulta.
     * quota_number = cuotas pagadas de cada gasto en este momento (si se llama
     * tras pagar, ya incluye la recién pagada). Los ids tienen que llegar ya
     * validados como enteros (el service verifica la pertenencia antes).
     */
    async upsertItems(sessionId, purchaseIds) {
        // Sin repetidos: ON CONFLICT no puede tocar la misma fila dos veces.
        const ids = [...new Set(purchaseIds.map(Number))];
        if (!ids.length) return [];
        const values = ids.map((_, i) => `($${i + 2}::int)`).join(", ");
        return await executeQuery(
            `INSERT INTO settlement_session_items (session_id, purchase_id, quota_number)
             SELECT $1::int, v.id,
                    (SELECT COUNT(*)::int FROM purchases_movements m
                     WHERE m.purchase_id = v.id AND m.movement_type = 'PAYMENT')
             FROM (VALUES ${values}) AS v(id)
             ON CONFLICT (session_id, purchase_id)
             DO UPDATE SET
                 quota_number = GREATEST(
                     COALESCE(settlement_session_items.quota_number, 0),
                     COALESCE(EXCLUDED.quota_number, 0)
                 )`,
            [sessionId, ...ids],
        );
    }

    async removeItem(sessionId, purchaseId) {
        return await executeQuery(
            `DELETE FROM settlement_session_items
             WHERE session_id = $1 AND purchase_id = $2`,
            [sessionId, purchaseId],
        );
    }

    async removeItems(sessionId, purchaseIds) {
        if (!purchaseIds.length) return [];
        const placeholders = purchaseIds.map((_, i) => `$${i + 2}`).join(", ");
        return await executeQuery(
            `DELETE FROM settlement_session_items
             WHERE session_id = $1 AND purchase_id IN (${placeholders})`,
            [sessionId, ...purchaseIds],
        );
    }

    async addItems(sessionId, purchaseIds) {
        return await this.upsertItems(sessionId, purchaseIds);
    }

    async getSnapshotSourceItems(sessionId) {
        return await executeQuery(
            `SELECT
                i.purchase_id,
                i.checked_at,
                i.quota_number,
                p.name,
                p.currency_type,
                p.type,
                p.fixed_expense,
                p.number_of_quotas,
                CASE WHEN p.number_of_quotas > 0
                     THEN p.amount::numeric / p.number_of_quotas
                     ELSE p.amount END AS amount_per_quota,
                fe.id   AS entity_id,
                fe.name AS entity_name
             FROM settlement_session_items i
             JOIN purchases p ON p.id = i.purchase_id
             LEFT JOIN financial_entities fe ON fe.id = p.financial_entity_id
             WHERE i.session_id = $1
             ORDER BY fe.name NULLS LAST, p.name`,
            [sessionId],
        );
    }

    async finishSession(sessionId) {
        return await executeQuery(
            `UPDATE settlement_sessions
             SET status = 'FINISHED', finished_at = NOW()
             WHERE id = $1`,
            [sessionId],
        );
    }

    // Al cerrar una sesión, los gastos postergados del usuario vuelven a estar
    // disponibles para la próxima.
    async releasePostponedForUser(userId) {
        return await executeQuery(
            `UPDATE purchases p
             SET is_postponed = false
             FROM financial_entities fe
             WHERE p.financial_entity_id = fe.id
               AND fe.user_id = $1
               AND p.is_postponed = true
               AND p.deleted = false`,
            [userId],
        );
    }

    async deleteSession(sessionId) {
        return await executeQuery(
            `DELETE FROM settlement_sessions WHERE id = $1`,
            [sessionId],
        );
    }

    async insertSnapshot({ userId, sessionId, month, startedAt, finishedAt, totals, items }) {
        const rows = await executeQuery(
            `INSERT INTO settlement_snapshots
                (user_id, session_id, month, started_at, finished_at, totals, items)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
             RETURNING *`,
            [
                userId,
                sessionId,
                month,
                startedAt,
                finishedAt,
                JSON.stringify(totals),
                JSON.stringify(items),
            ],
        );
        return rows[0];
    }

    async listSnapshots(userId) {
        return await executeQuery(
            `SELECT id, month, started_at, finished_at, totals, created_at
             FROM settlement_snapshots
             WHERE user_id = $1
             ORDER BY finished_at DESC`,
            [userId],
        );
    }

    async getSnapshot(userId, id) {
        const rows = await executeQuery(
            `SELECT * FROM settlement_snapshots WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [id, userId],
        );
        return rows[0] ?? null;
    }
}
