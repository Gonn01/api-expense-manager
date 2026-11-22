import { executeQuery } from "../db.js";

export class NotificacionesRepository {
    async create(userId, event, data) {
        return await executeQuery(
            `INSERT INTO notifications (user_id, event, data)
             VALUES ($1, $2, $3::text::jsonb)
             RETURNING id`,
            [userId, event, JSON.stringify(data)],
        );
    }

    async getGastoContext(gastoId) {
        return await executeQuery(
            `SELECT p.name, owner.name AS owner_name
             FROM purchases p
             LEFT JOIN financial_entities fe ON fe.id = p.financial_entity_id
             LEFT JOIN users owner ON owner.id = fe.user_id
             WHERE p.id = $1
             LIMIT 1`,
            [gastoId],
        );
    }

    async listar(userId, limit, beforeId = null) {
        return await executeQuery(
            `SELECT id, event, data, read_at, created_at
             FROM notifications
             WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
             ORDER BY id DESC
             LIMIT $3`,
            [userId, beforeId, limit],
        );
    }

    async contarNoLeidas(userId) {
        const [row] = await executeQuery(
            `SELECT count(*)::int AS total
             FROM notifications
             WHERE user_id = $1 AND read_at IS NULL`,
            [userId],
        );
        return row.total;
    }

    async marcarLeida(id, userId) {
        return await executeQuery(
            `UPDATE notifications
             SET read_at = NOW()
             WHERE id = $1 AND user_id = $2 AND read_at IS NULL
             RETURNING id`,
            [id, userId],
        );
    }

    async marcarTodasLeidas(userId) {
        return await executeQuery(
            `UPDATE notifications
             SET read_at = NOW()
             WHERE user_id = $1 AND read_at IS NULL
             RETURNING id`,
            [userId],
        );
    }
}
