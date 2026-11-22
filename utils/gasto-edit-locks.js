import { ExpenseStatus } from "./enums.js";

const ESTADOS_SIN_ACEPTAR = new Set([ExpenseStatus.PENDING_APPROVAL, ExpenseStatus.REJECTED]);
const ESTRUCTURA = ["amount", "currency_type", "type", "mode", "number_of_quotas", "financial_entity_id"];

export function computeEditLocks(gasto, { hasSibling = false, marked = false, ignoreShared = false } = {}) {
    const paid = Number(gasto.payed_quotas) || 0;
    const pending = Number(gasto.pending_quotas) || 0;
    const quotas = Math.max(Number(gasto.number_of_quotas) || 0, 1);
    const finalized = !gasto.fixed_expense && paid >= quotas;
    const shared =
        !ignoreShared &&
        (hasSibling || Boolean(gasto.shared_from_id) || ESTADOS_SIN_ACEPTAR.has(gasto.status));
    const conContraparte = !ignoreShared && (hasSibling || ESTADOS_SIN_ACEPTAR.has(gasto.status));

    const locks = {};
    const lock = (fields, reason) => {
        for (const f of fields) if (!locks[f]) locks[f] = reason;
    };

    lock(["payed_quotas"], "Los pagos se registran con Pagar y se deshacen con Revertir.");
    if (finalized) {
        lock(ESTRUCTURA, "El gasto está finalizado: solo se pueden cambiar el nombre y las categorías.");
    }
    if (shared) {
        lock(ESTRUCTURA, "El gasto está compartido con otro usuario: el cambio no llegaría a su copia.");
    }
    if (conContraparte) {
        lock(["name"], "El gasto está compartido con otro usuario: el cambio de nombre necesita su aprobación.");
    }
    if (ignoreShared) {
        lock(["financial_entity_id"], "Cada persona elige la entidad de su copia del gasto compartido.");
    }
    if (marked) {
        lock(
            ["amount", "currency_type", "type"],
            "El gasto está marcado en la sesión de cuentas abierta. Desmarcalo o terminá la sesión para cambiarlo.",
        );
    }
    if (paid + pending > 0) {
        lock(["currency_type", "type", "mode"], "El gasto ya tiene pagos registrados.");
    }
    return locks;
}
