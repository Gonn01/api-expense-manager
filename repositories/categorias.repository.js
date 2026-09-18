import { executeQuery } from "../db.js";

export class CategoriasRepository {
    async listar(userId) {
        return await executeQuery(
            `SELECT id, name, color, created_at
             FROM user_categories
             WHERE user_id = $1 AND deleted = false
             ORDER BY created_at DESC`,
            [userId]
        );
    }

    async getById(id, userId) {
        return await executeQuery(
            `SELECT id, name, color, created_at
             FROM user_categories
             WHERE id = $1 AND user_id = $2 AND deleted = false`,
            [id, userId]
        );
    }

    async create(name, color, userId) {
        return await executeQuery(
            `INSERT INTO user_categories (name, color, user_id, deleted, created_at)
             VALUES ($1, $2, $3, false, NOW())
             RETURNING id, name, color, created_at`,
            [name, color ?? '#52b788', userId]
        );
    }

    async update(id, name, color, userId) {
        return await executeQuery(
            `UPDATE user_categories
             SET name = $1, color = $2
             WHERE id = $3 AND user_id = $4 AND deleted = false
             RETURNING id, name, color, created_at`,
            [name, color ?? '#52b788', id, userId]
        );
    }

    async delete(id, userId) {
        return await executeQuery(
            `UPDATE user_categories
             SET deleted = true
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [id, userId]
        );
    }

    async getCategoriasByGasto(gastoId) {
        return await executeQuery(
            `SELECT uc.id, uc.name, uc.color
             FROM user_categories uc
             JOIN purchases_categories pc ON pc.category_id = uc.id
             WHERE pc.purchase_id = $1 AND uc.deleted = false`,
            [gastoId]
        );
    }

    async setCategoriasForGasto(gastoId, categoryIds) {
        await executeQuery(
            `DELETE FROM purchases_categories WHERE purchase_id = $1`,
            [gastoId]
        );

        if (!categoryIds || categoryIds.length === 0) return [];

        const values = categoryIds.map((_, i) => `($1, $${i + 2}, NOW())`).join(", ");
        return await executeQuery(
            `INSERT INTO purchases_categories (purchase_id, category_id, created_at)
             VALUES ${values}
             RETURNING category_id`,
            [gastoId, ...categoryIds]
        );
    }
}
