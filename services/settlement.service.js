import { customError, ErrorCode } from "../utils/errors.js";
import { withTransaction } from "../db.js";

// El driver puede devolver columnas JSONB como string; normalizamos.
function parseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
}

function normalizeSnapshot(row) {
    if (!row) return row;
    return {
        ...row,
        totals: parseJson(row.totals, { byCurrency: {}, entities: 0, items: 0 }),
        items: parseJson(row.items, []),
    };
}

function buildTotals(items) {
    const byCurrency = {};
    const entities = new Set();

    for (const it of items) {
        if (it.entity_id != null) entities.add(it.entity_id);

        const bucket = (byCurrency[it.currency] ??= { egreso: 0, ingreso: 0, count: 0 });
        bucket.count += 1;
        if (it.type === "INGRESO") bucket.ingreso += it.amount_per_quota;
        else bucket.egreso += it.amount_per_quota;
    }

    return { byCurrency, entities: entities.size, items: items.length };
}

export class SettlementService {
    // `runInTransaction`: ver GastosService (los tests pasan una que solo ejecuta).
    constructor({ settlementRepository, gastosService, runInTransaction = withTransaction }) {
        this.settlementRepository = settlementRepository;
        this.gastosService = gastosService;
        this.tx = runInTransaction;
    }

    async getSession(userId) {
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) return null;
        const items = await this.settlementRepository.getSessionItems(session.id);
        return { session, items };
    }

    async startSession(userId) {
        const existing = await this.settlementRepository.getOpenSession(userId);
        if (existing) {
            const items = await this.settlementRepository.getSessionItems(existing.id);
            return { session: existing, items, alreadyOpen: true };
        }
        const session = await this.settlementRepository.createSession(userId);
        return { session, items: [], alreadyOpen: false };
    }

    async setItem(userId, purchaseId, checked) {
        const session = await this.#requireOpenSession(userId);
        if (checked) {
            // Solo se pueden marcar gastos propios. Desmarcar no se valida:
            // únicamente saca la marca de la sesión del propio usuario.
            await this.gastosService.assertOwnedAll([purchaseId], userId);
            await this.settlementRepository.upsertItem(session.id, purchaseId);
        } else {
            await this.settlementRepository.removeItem(session.id, purchaseId);
        }
        const items = await this.settlementRepository.getSessionItems(session.id);
        return { session, items };
    }

    async setItemsBulk(userId, purchaseIds, checked) {
        const session = await this.#requireOpenSession(userId);
        const ids = purchaseIds.map(Number).filter(Number.isFinite);
        if (ids.length) {
            if (checked) {
                await this.gastosService.assertOwnedAll(ids, userId);
                await this.settlementRepository.addItems(session.id, ids);
            } else {
                await this.settlementRepository.removeItems(session.id, ids);
            }
        }
        const items = await this.settlementRepository.getSessionItems(session.id);
        return { session, items };
    }

    async finishSession(userId) {
        // Todo el cierre es una transacción: pagos, snapshot y cierre de la sesión
        // se guardan juntos o no se guarda nada. La sesión se bloquea (FOR UPDATE)
        // para que dos cierres simultáneos no paguen dos veces: el segundo espera
        // y, cuando entra, la sesión ya no está abierta.
        return this.tx(async () => {
            const session = await this.settlementRepository.getOpenSession(userId, { forUpdate: true });
            if (!session) throw customError(ErrorCode.NO_OPEN_SESSION);

            // Pago diferido: marcar un gasto durante la sesión no lo paga. Recién al
            // cerrar la sesión se registran los pagos reales de todo lo marcado.
            await this.#effectMarkedPayments(userId, session.id);

            const src = await this.settlementRepository.getSnapshotSourceItems(session.id);
            // Sin gastos que registrar no se guarda un resumen vacío: la sesión queda
            // abierta para que el usuario marque algo o la descarte. Esto cubre también
            // el caso en que la limpieza de arriba sacó todos los marcados.
            if (src.length === 0) throw customError(ErrorCode.SETTLEMENT_EMPTY);

            const items = src.map((r) => ({
                purchase_id: r.purchase_id,
                name: r.name,
                entity_id: r.entity_id,
                entity_name: r.entity_name,
                amount_per_quota: Number(r.amount_per_quota ?? 0),
                currency: r.currency_type,
                type: r.type,
                fixed_expense: r.fixed_expense,
                number_of_quotas: r.number_of_quotas ?? null,
                quota_number: r.quota_number ?? null,
                checked_at: r.checked_at,
            }));

            const totals = buildTotals(items);
            const finishedAt = new Date();
            const month = finishedAt.toISOString().slice(0, 7);

            const snapshot = await this.settlementRepository.insertSnapshot({
                userId,
                sessionId: session.id,
                month,
                startedAt: session.started_at,
                finishedAt,
                totals,
                items,
            });

            await Promise.all([
                this.settlementRepository.finishSession(session.id),
                // Los gastos postergados vuelven a estar disponibles para la próxima sesión.
                this.settlementRepository.releasePostponedForUser(userId),
            ]);
            return normalizeSnapshot(snapshot);
        });
    }

    async discardSession(userId) {
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) return { discarded: false };
        await this.settlementRepository.deleteSession(session.id);
        return { discarded: true };
    }

    async listSnapshots(userId) {
        const rows = await this.settlementRepository.listSnapshots(userId);
        return rows.map((r) => ({ ...r, totals: parseJson(r.totals, { byCurrency: {}, entities: 0, items: 0 }) }));
    }

    async getSnapshot(userId, id) {
        const snapshot = await this.settlementRepository.getSnapshot(userId, id);
        if (!snapshot) throw customError(ErrorCode.SNAPSHOT_NOT_FOUND);
        return normalizeSnapshot(snapshot);
    }

    async #requireOpenSession(userId) {
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) throw customError(ErrorCode.SETTLEMENT_REQUIRED, { message: "No hay una sesión de cuentas abierta" });
        return session;
    }

    /**
     * Efectúa el pago real de cada gasto marcado en la sesión. Los gastos que
     * no se pueden pagar (borrados, ajenos, postergados o con todas las cuotas pagas)
     * se sacan de la sesión para que no ensucien el snapshot.
     */
    async #effectMarkedPayments(userId, sessionId) {
        if (!this.gastosService) return;

        const items = await this.settlementRepository.getSessionItems(sessionId);
        if (!items.length) return;

        // Todos los pagos de una vez (un solo INSERT: si falla, no se registra
        // ninguno y la sesión sigue abierta).
        const { kept, discarded } = await this.gastosService.effectSettlementBatch(
            items.map((it) => it.purchase_id),
            userId,
            new Date(),
        );

        await Promise.all([
            this.settlementRepository.removeItems(sessionId, discarded),
            // Releer quota_number ahora que los pagos quedaron registrados.
            this.settlementRepository.upsertItems(sessionId, kept),
        ]);
    }
}
