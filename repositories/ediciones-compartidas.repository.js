import { executeQuery } from "../db.js";

const COLUMNS = `id, purchase_id, sibling_purchase_id, requested_by_user_id, counterparty_user_id,
                 changes, status, created_at, resolved_at, resolved_by_user_id`;

export class EdicionesCompartidasRepository {
    async getById(id) {
        return await executeQuery(`SELECT ${COLUMNS} FROM purchase_edit_requests WHERE id = $1`, [id]);
    }

    async getPendingByPurchase(purchaseId) {
        return await executeQuery(
            `SELECT ${COLUMNS}
             FROM purchase_edit_requests
             WHERE status = 'PENDING' AND (purchase_id = $1 OR sibling_purchase_id = $1)
             LIMIT 1`,
            [purchaseId],
        );
    }

    async getPendingByPurchases(purchaseIds) {
        if (!purchaseIds.length) return [];
        const placeholders = purchaseIds.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(
            `SELECT ${COLUMNS}
             FROM purchase_edit_requests
             WHERE status = 'PENDING'
               AND (purchase_id IN (${placeholders}) OR sibling_purchase_id IN (${placeholders}))`,
            purchaseIds,
        );
    }

    async create({ purchaseId, siblingPurchaseId, requestedByUserId, counterpartyUserId, changes }) {
        return await executeQuery(
            `INSERT INTO purchase_edit_requests
                 (purchase_id, sibling_purchase_id, requested_by_user_id, counterparty_user_id, changes)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING ${COLUMNS}`,
            [purchaseId, siblingPurchaseId, requestedByUserId, counterpartyUserId, JSON.stringify(changes)],
        );
    }

    async resolveMany(ids, status, userId) {
        if (!ids.length) return [];
        const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
        return await executeQuery(
            `UPDATE purchase_edit_requests
             SET status = $1, resolved_at = NOW(), resolved_by_user_id = $2
             WHERE id IN (${placeholders}) AND status = 'PENDING'
             RETURNING ${COLUMNS}`,
            [status, userId, ...ids],
        );
    }

    async resolve(id, status, userId) {
        return await executeQuery(
            `UPDATE purchase_edit_requests
             SET status = $2, resolved_at = NOW(), resolved_by_user_id = $3
             WHERE id = $1 AND status = 'PENDING'
             RETURNING ${COLUMNS}`,
            [id, status, userId],
        );
    }

    async getPendingForUser(userId) {
        return await executeQuery(
            `SELECT r.id, r.requested_by_user_id, r.counterparty_user_id, r.changes, r.created_at,
                    CASE WHEN r.requested_by_user_id = $1 THEN r.purchase_id
                         ELSE r.sibling_purchase_id END AS gasto_id,
                    p.name AS gasto_name,
                    p.amount,
                    p.currency_type,
                    p.type,
                    p.fixed_expense,
                    p.number_of_quotas,
                    requester.name AS requester_name,
                    counterparty.name AS counterparty_name
             FROM purchase_edit_requests r
             JOIN purchases p ON p.id = r.purchase_id AND p.deleted = false
             JOIN purchases sib ON sib.id = r.sibling_purchase_id AND sib.deleted = false
             JOIN users requester ON requester.id = r.requested_by_user_id
             JOIN users counterparty ON counterparty.id = r.counterparty_user_id
             WHERE r.status = 'PENDING'
               AND (r.requested_by_user_id = $1 OR r.counterparty_user_id = $1)
             ORDER BY r.created_at DESC`,
            [userId],
        );
    }
}
