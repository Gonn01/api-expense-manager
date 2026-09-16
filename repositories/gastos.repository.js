import { executeQuery } from "../db.js";
import { Currency, ExpenseType, ExpenseStatus } from "../utils/enums.js";

const CALCULATED_FIELDS = `
  (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT')::int AS payed_quotas,
  (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PENDING_PAYMENT')::int AS pending_quotas,
  CASE WHEN p.number_of_quotas > 0 THEN p.amount::numeric / p.number_of_quotas ELSE p.amount END AS amount_per_quota,
  (SELECT payment_date FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT' ORDER BY payment_date ASC NULLS LAST LIMIT 1) AS first_quota_date,
  (SELECT MAX(payment_date) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT') AS last_payment_date,
  CASE WHEN p.fixed_expense = false AND (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT') >= p.number_of_quotas
       THEN (SELECT MAX(payment_date) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT')
       ELSE NULL END AS finalization_date,
  (SELECT lnk.financial_entity_id FROM purchases lnk WHERE lnk.id = p.linked_purchase_id) AS linked_financial_entity_id,
  (SELECT lnk.name FROM purchases lnk WHERE lnk.id = p.linked_purchase_id) AS linked_name,
  (SELECT lnk.type FROM purchases lnk WHERE lnk.id = p.linked_purchase_id) AS linked_type
`;

export class GastosRepository {
  async getById(id) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS}
       FROM purchases p
       WHERE p.id = $1 AND p.deleted = false`,
      [id], true
    );
  }

  // Igual que getById pero sin filtrar por `deleted` (para restaurar).
  async getByIdIncludingDeleted(id) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS}
       FROM purchases p
       WHERE p.id = $1`,
      [id], true
    );
  }

  async getGastosByEntidad(entidadId) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS},
          COALESCE(
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
             FROM purchases_categories pc
             JOIN user_categories c ON c.id = pc.category_id
             WHERE pc.purchase_id = p.id),
            '[]'::json
          ) AS categories
       FROM purchases p
       WHERE p.financial_entity_id = $1 AND p.deleted = false AND p.status = 'ACTIVE'
       ORDER BY p.created_at DESC`,
      [entidadId], true
    );
  }

  async getPendingByEntidad(entidadId) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS},
          COALESCE(
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
             FROM purchases_categories pc
             JOIN user_categories c ON c.id = pc.category_id
             WHERE pc.purchase_id = p.id),
            '[]'::json
          ) AS categories
       FROM purchases p
       WHERE p.financial_entity_id = $1 AND p.deleted = false AND p.status = 'PENDING_APPROVAL'
       ORDER BY p.created_at DESC`,
      [entidadId], true
    );
  }

  // Gastos eliminados (soft-delete) de una entidad, cualquier estado.
  async getDeletedByEntidad(entidadId) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS},
          COALESCE(
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
             FROM purchases_categories pc
             JOIN user_categories c ON c.id = pc.category_id
             WHERE pc.purchase_id = p.id),
            '[]'::json
          ) AS categories
       FROM purchases p
       WHERE p.financial_entity_id = $1 AND p.deleted = true
       ORDER BY p.created_at DESC`,
      [entidadId], true
    );
  }

  // Restaura un gasto eliminado. Devuelve la fila o vacío si no estaba eliminado.
  async restore(id) {
    return await executeQuery(
      `UPDATE purchases SET deleted = false WHERE id = $1 AND deleted = true RETURNING id`,
      [id], true
    );
  }

  async countPendingByEntidad(entidadId) {
    const rows = await executeQuery(
      `SELECT COUNT(*)::int AS count
       FROM purchases
       WHERE financial_entity_id = $1 AND deleted = false AND status = 'PENDING_APPROVAL'`,
      [entidadId], true
    );
    return rows[0]?.count ?? 0;
  }

  async pagarCuota(id) {
    return await executeQuery(
      `SELECT p.*, ${CALCULATED_FIELDS}
       FROM purchases p
       WHERE p.id = $1 AND p.deleted = false`,
      [id], true
    );
  }

  async pagarCuotasLote(ids) {
    const updated = [];
    for (const id of ids) {
      const result = await executeQuery(
        `SELECT p.*, ${CALCULATED_FIELDS}
         FROM purchases p
         WHERE p.id = $1 AND p.deleted = false`,
        [id], true
      );
      if (result.length > 0) updated.push(result[0]);
    }
    return updated;
  }

  async update(id, name, amount, image_url, fixed_expense, type) {
    const dbType = type ? String(type).toUpperCase() : null;
    return await executeQuery(
      `UPDATE purchases
       SET name = $1, amount = $2, image_url = $3, fixed_expense = $4, type = $5
       WHERE id = $6
       RETURNING *,
           (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = $6 AND movement_type = 'PAYMENT')::int AS payed_quotas,
           CASE WHEN number_of_quotas > 0 THEN amount::numeric / number_of_quotas ELSE amount END AS amount_per_quota,
           (SELECT payment_date FROM purchases_movements WHERE purchase_id = $6 AND movement_type = 'PAYMENT' ORDER BY payment_date ASC NULLS LAST LIMIT 1) AS first_quota_date,
           (SELECT MAX(payment_date) FROM purchases_movements WHERE purchase_id = $6 AND movement_type = 'PAYMENT') AS last_payment_date,
           CASE WHEN fixed_expense = false AND (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = $6 AND movement_type = 'PAYMENT') >= number_of_quotas
                THEN (SELECT MAX(payment_date) FROM purchases_movements WHERE purchase_id = $6 AND movement_type = 'PAYMENT')
                ELSE NULL END AS finalization_date`,
      [name, amount, image_url || null, fixed_expense || false, dbType, id], true
    );
  }

  async delete(id) {
    return await executeQuery(
      `UPDATE purchases SET deleted = true WHERE id = $1 RETURNING id`,
      [id], true
    );
  }

  // Vincula dos compras entre sí (relación mutua): a.linked = b y b.linked = a.
  async linkPurchases(aId, bId) {
    return await executeQuery(
      `UPDATE purchases
       SET linked_purchase_id = CASE id WHEN $1 THEN $2 WHEN $2 THEN $1 END
       WHERE id IN ($1, $2)`,
      [aId, bId], true
    );
  }

  // Rompe el vínculo tanto desde la compra $1 como desde la que la apuntaba.
  async unlink(id) {
    return await executeQuery(
      `UPDATE purchases SET linked_purchase_id = NULL
       WHERE id = $1 OR linked_purchase_id = $1`,
      [id], true
    );
  }

  async create({
    financial_entity_id,
    name,
    amount,
    number_of_quotas,
    currency_type,
    fixed_expense,
    image_url,
    type,
    status = ExpenseStatus.ACTIVE,
    shared_from_id = null,
    receiver_user_id = null,
    linked_purchase_id = null,
  }) {
    const dbType = type && Object.values(ExpenseType).includes(String(type).toUpperCase())
      ? String(type).toUpperCase()
      : null;
    const dbCurrency = currency_type && Object.values(Currency).includes(String(currency_type).toUpperCase())
      ? String(currency_type).toUpperCase()
      : null;

    return await executeQuery(
      `INSERT INTO purchases (
        financial_entity_id, name, amount, number_of_quotas,
        currency_type, fixed_expense, deleted, image_url, created_at, type,
        status, shared_from_id, receiver_user_id, linked_purchase_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,false,$7,now(),$8,$9,$10,$11,$12)
      RETURNING *,
          0::int AS payed_quotas,
          CASE WHEN $4 > 0 THEN $3::numeric / $4 ELSE $3 END AS amount_per_quota,
          NULL::timestamptz AS first_quota_date,
          NULL::timestamptz AS finalization_date`,
      [
        financial_entity_id ?? null,
        name,
        amount,
        number_of_quotas,
        dbCurrency,
        fixed_expense || false,
        image_url || null,
        dbType,
        status,
        shared_from_id,
        receiver_user_id,
        linked_purchase_id,
      ], true
    );
  }

  async updateStatus(id, status) {
    return await executeQuery(
      `UPDATE purchases SET status = $2 WHERE id = $1 AND deleted = false RETURNING *`,
      [id, status], true
    );
  }

  // Marca / desmarca un gasto como "postergado" (fuera del alcance de la
  // sesión de cuentas actual o de la próxima que se abra).
  async setPostponed(id, value) {
    return await executeQuery(
      `UPDATE purchases p
       SET is_postponed = $2
       WHERE p.id = $1 AND p.deleted = false
       RETURNING p.*, ${CALCULATED_FIELDS}`,
      [id, value], true
    );
  }

  async setFavorite(id, value) {
    return await executeQuery(
      `UPDATE purchases p
       SET is_favorite = $2
       WHERE p.id = $1 AND p.deleted = false
       RETURNING p.*, ${CALCULATED_FIELDS}`,
      [id, value], true
    );
  }

  // Un gasto en cuotas que quedó totalmente pagado deja de ser favorito.
  async clearFavoriteIfFinalized(purchaseId) {
    return await executeQuery(
      `UPDATE purchases
       SET is_favorite = false
       WHERE id = $1
         AND is_favorite = true
         AND fixed_expense = false
         AND number_of_quotas > 0
         AND (SELECT COUNT(*) FROM purchases_movements
              WHERE purchase_id = $1 AND movement_type = 'PAYMENT') >= number_of_quotas`,
      [purchaseId], true
    );
  }


  async aprobarGasto(id, financialEntityId) {
    return await executeQuery(
      `UPDATE purchases
       SET status = 'ACTIVE', financial_entity_id = $2
       WHERE id = $1 AND deleted = false
       RETURNING *, ${CALCULATED_FIELDS.replace(/p\./g, '')}`,
      [id, financialEntityId], true
    );
  }

  async getEntityOwnerByPurchaseId(purchaseId) {
    return await executeQuery(
      `SELECT fe.user_id
       FROM purchases p
       JOIN financial_entities fe ON fe.id = p.financial_entity_id
       WHERE p.id = $1 AND p.deleted = false
       LIMIT 1`,
      [purchaseId], true
    );
  }

  async getApprovalNotificationData(copyId) {
    return await executeQuery(
      `SELECT
          fe_sender.user_id AS sender_user_id,
          fe_sender.id      AS sender_entity_id,
          original.name     AS gasto_name,
          receiver.name     AS receiver_name
       FROM purchases copy
       JOIN purchases original ON original.id = copy.shared_from_id AND original.deleted = false
       JOIN financial_entities fe_sender ON fe_sender.id = original.financial_entity_id
       JOIN users receiver ON receiver.id = copy.receiver_user_id
       WHERE copy.id = $1 AND copy.deleted = false
       LIMIT 1`,
      [copyId], true
    );
  }

  async getUserName(userId) {
    return await executeQuery(
      `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      [userId], true
    );
  }

  async getSharedCopyByOriginalId(originalId) {
    return await executeQuery(
      `SELECT * FROM purchases WHERE shared_from_id = $1 AND deleted = false LIMIT 1`,
      [originalId], true
    );
  }

  /**
   * Dada una compra que forma parte de un par compartido (original <-> copia),
   * devuelve el id de la compra hermana ACTIVA y el id del usuario del otro lado
   * (el que debe confirmar los pagos). Devuelve [] si la compra no está compartida
   * o la hermana no está activa.
   */
  async getSharedSibling(purchaseId) {
    return await executeQuery(
      `SELECT
          sib.id AS sibling_id,
          CASE WHEN p.shared_from_id IS NULL THEN sib.receiver_user_id
               ELSE fe.user_id END AS counterparty_user_id
       FROM purchases p
       JOIN purchases sib
         ON ((p.shared_from_id IS NULL AND sib.shared_from_id = p.id)
          OR (p.shared_from_id IS NOT NULL AND sib.id = p.shared_from_id))
        AND sib.deleted = false
        AND sib.status = 'ACTIVE'
       LEFT JOIN financial_entities fe ON fe.id = sib.financial_entity_id
       WHERE p.id = $1 AND p.deleted = false
       LIMIT 1`,
      [purchaseId], true
    );
  }

  /**
   * Pagos pendientes de confirmación relacionados con el usuario.
   *  - porConfirmar: los registró la otra persona y este usuario debe confirmarlos.
   *  - esperando: los registró este usuario y espera confirmación del otro.
   */
  async getPagosCompartidos(userId) {
    return await executeQuery(
      `WITH pend AS (
          SELECT
             m.id AS movement_id,
             m.amount,
             m.payment_date,
             m.created_at,
             m.purchase_id,
             m.created_by_user_id,
             p.name AS gasto_name,
             p.currency_type,
             p.number_of_quotas,
             (SELECT COUNT(*) FROM purchases_movements pm
               WHERE pm.purchase_id = p.id AND pm.movement_type = 'PAYMENT')::int AS payed_quotas,
             CASE WHEN p.shared_from_id IS NULL THEN sib.receiver_user_id
                  ELSE fe.user_id END AS counterparty_user_id
          FROM purchases_movements m
          JOIN purchases p ON p.id = m.purchase_id AND p.deleted = false
          JOIN purchases sib
            ON ((p.shared_from_id IS NULL AND sib.shared_from_id = p.id)
             OR (p.shared_from_id IS NOT NULL AND sib.id = p.shared_from_id))
           AND sib.deleted = false
          LEFT JOIN financial_entities fe ON fe.id = sib.financial_entity_id
          WHERE m.movement_type = 'PENDING_PAYMENT'
       )
       SELECT pend.*,
              registrar.name AS registrar_name,
              counterparty.name AS counterparty_name
       FROM pend
       JOIN users registrar ON registrar.id = pend.created_by_user_id
       JOIN users counterparty ON counterparty.id = pend.counterparty_user_id
       WHERE pend.created_by_user_id = $1 OR pend.counterparty_user_id = $1
       ORDER BY pend.created_at DESC`,
      [userId], true
    );
  }

  async getCompartidosRecibidos(userId) {
    return await executeQuery(
      `SELECT
          p.id, p.name, p.amount, p.number_of_quotas, p.currency_type, p.type,
          p.fixed_expense, p.status, p.created_at, p.shared_from_id, p.financial_entity_id,
          (SELECT COUNT(*) FROM purchases_movements WHERE purchase_id = p.id AND movement_type = 'PAYMENT')::int AS payed_quotas,
          CASE WHEN p.number_of_quotas > 0 THEN p.amount::numeric / p.number_of_quotas ELSE p.amount END AS amount_per_quota,
          u_sender.id AS sender_id,
          u_sender.name AS sender_name,
          u_sender.email AS sender_email,
          fe_original.name AS sender_entity_name,
          fe_assigned.id AS assigned_entity_id,
          fe_assigned.name AS assigned_entity_name,
          (SELECT fe_sug.id FROM financial_entities fe_sug
           WHERE fe_sug.user_id = $1
             AND fe_sug.linked_user_id = fe_original.user_id
             AND fe_sug.deleted = false
           LIMIT 1) AS suggested_entity_id
       FROM purchases p
       JOIN purchases p_original ON p_original.id = p.shared_from_id AND p_original.deleted = false
       JOIN financial_entities fe_original ON fe_original.id = p_original.financial_entity_id
       JOIN users u_sender ON u_sender.id = fe_original.user_id
       LEFT JOIN financial_entities fe_assigned ON fe_assigned.id = p.financial_entity_id
       WHERE p.receiver_user_id = $1 AND p.deleted = false
       ORDER BY p.created_at DESC`,
      [userId], true
    );
  }

  async getCompartidosEmitidos(userId) {
    return await executeQuery(
      `SELECT
          p.id, p.name, p.amount, p.number_of_quotas, p.currency_type, p.type,
          p.fixed_expense, p.created_at, p.financial_entity_id,
          fe.name AS entity_name,
          copy.id AS copy_id,
          copy.status AS copy_status,
          copy.financial_entity_id AS copy_entity_id,
          fe_copy.name AS copy_entity_name,
          u_receiver.id AS receiver_id,
          u_receiver.name AS receiver_name,
          u_receiver.email AS receiver_email
       FROM purchases p
       JOIN financial_entities fe ON fe.id = p.financial_entity_id AND fe.user_id = $1
       JOIN purchases copy ON copy.shared_from_id = p.id AND copy.deleted = false
       LEFT JOIN financial_entities fe_copy ON fe_copy.id = copy.financial_entity_id
       JOIN users u_receiver ON u_receiver.id = copy.receiver_user_id
       WHERE p.deleted = false AND p.status = 'ACTIVE'
       ORDER BY p.created_at DESC`,
      [userId], true
    );
  }
}
