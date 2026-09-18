import { executeQuery } from "../db.js";

export class EntidadesFinancierasRepository {
    // Listado con los contadores ya agregados en una sola query (antes era un
    // N+1: 1 query + 2 por entidad, secuenciales -> ~10s con la DB remota).
    //   cantidad      = compras ACTIVE no saldadas (o gasto fijo)
    //   pending_count = compras PENDING_APPROVAL
    async listar(userId) {
        return await executeQuery(
            `SELECT fe.id, fe.name, fe.linked_user_id, fe.is_favorite,
                    u.name AS linked_user_name, u.email AS linked_user_email,
                    COUNT(p.id) FILTER (
                        WHERE p.status = 'ACTIVE'
                          AND (p.fixed_expense OR COALESCE(pm.paid, 0) < p.number_of_quotas)
                    )::int AS cantidad,
                    COUNT(p.id) FILTER (WHERE p.status = 'PENDING_APPROVAL')::int AS pending_count
             FROM financial_entities fe
             LEFT JOIN users u ON u.id = fe.linked_user_id
             LEFT JOIN purchases p
                    ON p.financial_entity_id = fe.id
                   AND p.deleted = false
             LEFT JOIN (
                 SELECT purchase_id, COUNT(*) AS paid
                 FROM purchases_movements
                 WHERE movement_type = 'PAYMENT'
                 GROUP BY purchase_id
             ) pm ON pm.purchase_id = p.id
             WHERE fe.deleted = false AND fe.user_id = $1
             GROUP BY fe.id, u.name, u.email
             ORDER BY fe.is_favorite DESC, fe.created_at DESC`,
            [userId]
        );
    }

    async getById(id, userId) {
        return await executeQuery(
            `SELECT fe.id, fe.name, fe.user_id, fe.deleted, fe.created_at, fe.linked_user_id, fe.is_favorite,
                    u.name AS linked_user_name, u.email AS linked_user_email
             FROM financial_entities fe
             LEFT JOIN users u ON u.id = fe.linked_user_id
             WHERE fe.id = $1 AND fe.deleted = false AND fe.user_id = $2
             LIMIT 1`,
            [id, userId]
        );
    }

    async setFavorite(id, userId, value) {
        return await executeQuery(
            `UPDATE financial_entities
             SET is_favorite = $3
             WHERE id = $1 AND user_id = $2 AND deleted = false
             RETURNING id, name, user_id, deleted, created_at, linked_user_id, is_favorite`,
            [id, userId, value]
        );
    }

    async findByName(userId, name, excludeId = null) {
        if (excludeId) {
            return await executeQuery(
                `SELECT id, name FROM financial_entities
                 WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND deleted = false AND id != $3
                 LIMIT 1`,
                [userId, name, excludeId]
            );
        }

        return await executeQuery(
            `SELECT id, name FROM financial_entities
             WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND deleted = false
             LIMIT 1`,
            [userId, name]
        );
    }

    async create(name, userId) {
        return await executeQuery(
            `INSERT INTO financial_entities (name, user_id, deleted, created_at)
             VALUES ($1, $2, false, NOW())
             RETURNING id, name, user_id, deleted, created_at, linked_user_id`,
            [name, userId]
        );
    }

    async update(id, name, userId) {
        return await executeQuery(
            `UPDATE financial_entities
             SET name = $1
             WHERE id = $2 AND user_id = $3
             RETURNING id, name, user_id, deleted, created_at, linked_user_id`,
            [name, id, userId]
        );
    }

    async delete(id, userId) {
        return await executeQuery(
            `UPDATE financial_entities
             SET deleted = true
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [id, userId]
        );
    }

    async findByLinkedUser(userId, linkedUserId) {
        return await executeQuery(
            `SELECT id, name FROM financial_entities
             WHERE user_id = $1 AND linked_user_id = $2 AND deleted = false
             LIMIT 1`,
            [userId, linkedUserId]
        );
    }

    async vincularUsuario(id, userId, linkedUserId) {
        return await executeQuery(
            `UPDATE financial_entities
             SET linked_user_id = $3
             WHERE id = $1 AND user_id = $2 AND deleted = false
             RETURNING id, name, user_id, deleted, created_at, linked_user_id`,
            [id, userId, linkedUserId]
        );
    }

    async desvincularUsuario(id, userId) {
        return await executeQuery(
            `UPDATE financial_entities
             SET linked_user_id = NULL
             WHERE id = $1 AND user_id = $2 AND deleted = false
             RETURNING id, name, user_id, deleted, created_at, linked_user_id`,
            [id, userId]
        );
    }
}
