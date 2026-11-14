import { customError, ErrorCode } from "../utils/errors.js";
import { MovementType } from "../utils/enums.js";
import { withTransaction } from "../db.js";

const ESTADOS_CONFIRMADOS = new Set(["aprobado", "pagado", "reversion_pendiente"]);

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

function paymentStatus(item, movement) {
    if (item.movement_id == null) return null;
    if (!movement) return "revertido";
    switch (movement.movement_type) {
        case MovementType.PENDING_PAYMENT:
            return "pendiente";
        case MovementType.PAYMENT_REJECTED:
            return "rechazado";
        case MovementType.PAYMENT_WITHDRAWN:
            return "retirado";
        case MovementType.PAYMENT:
            if (movement.reversal_requested_by_user_id != null) return "reversion_pendiente";
            return item.shared ? "aprobado" : "pagado";
        default:
            return null;
    }
}

export class SettlementService {
    constructor({ settlementRepository, gastosService, movementsRepository, runInTransaction = withTransaction }) {
        this.settlementRepository = settlementRepository;
        this.gastosService = gastosService;
        this.movementsRepository = movementsRepository;
        this.tx = runInTransaction;
    }

    async #withPaymentStatus(snapshot) {
        const items = Array.isArray(snapshot.items) ? snapshot.items : [];
        const ids = items.map((it) => it.movement_id).filter((id) => id != null);
        if (!ids.length || !this.movementsRepository) return snapshot;

        const movements = await this.movementsRepository.getMovementsByIds(ids);
        const byId = new Map(movements.map((m) => [String(m.id), m]));

        const withStatus = items.map((it) => ({
            ...it,
            payment_status: paymentStatus(it, byId.get(String(it.movement_id))),
        }));

        const confirmed = buildTotals(
            withStatus.filter((it) => it.payment_status == null || ESTADOS_CONFIRMADOS.has(it.payment_status)),
        );

        return {
            ...snapshot,
            items: withStatus,
            totals: { ...snapshot.totals, confirmed: { byCurrency: confirmed.byCurrency, items: confirmed.items } },
        };
    }

    async #assertMarcables(ids, userId) {
        if (!this.gastosService.errorDeMarcado) return;
        const errores = await this.gastosService.errorDeMarcado(ids, userId);
        const [primero] = errores.values();
        if (primero) throw customError(primero);
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
            await this.gastosService.assertOwnedAll([purchaseId], userId);
            await this.#assertMarcables([purchaseId], userId);
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
                const errores = this.gastosService.errorDeMarcado
                    ? await this.gastosService.errorDeMarcado(ids, userId)
                    : new Map();
                const marcables = ids.filter((id) => !errores.has(id));
                if (marcables.length) await this.settlementRepository.addItems(session.id, marcables);
            } else {
                await this.settlementRepository.removeItems(session.id, ids);
            }
        }
        const items = await this.settlementRepository.getSessionItems(session.id);
        return { session, items };
    }

    async finishSession(userId) {
        return this.tx(async () => {
            const session = await this.settlementRepository.getOpenSession(userId, { forUpdate: true });
            if (!session) throw customError(ErrorCode.NO_OPEN_SESSION);

            const payments = await this.#effectMarkedPayments(userId, session.id);

            const src = await this.settlementRepository.getSnapshotSourceItems(session.id);
            if (src.length === 0) throw customError(ErrorCode.SETTLEMENT_EMPTY);

            const items = src.map((r) => {
                const payment = payments[r.purchase_id] ?? null;
                return {
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
                    movement_id: payment?.movement_id ?? null,
                    shared: payment?.shared ?? false,
                    payment_role: payment?.role ?? null,
                    counterparty_name: payment?.counterparty_name ?? null,
                };
            });

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
                this.settlementRepository.releasePostponedForUser(userId),
            ]);
            return this.#withPaymentStatus(normalizeSnapshot(snapshot));
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
        return this.#withPaymentStatus(normalizeSnapshot(snapshot));
    }

    async #requireOpenSession(userId) {
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) throw customError(ErrorCode.SETTLEMENT_REQUIRED, { message: "No hay una sesión de cuentas abierta" });
        return session;
    }

    async #effectMarkedPayments(userId, sessionId) {
        if (!this.gastosService) return {};

        const items = await this.settlementRepository.getSessionItems(sessionId);
        if (!items.length) return {};

        const { kept, discarded, payments = {} } = await this.gastosService.effectSettlementBatch(
            items.map((it) => it.purchase_id),
            userId,
            new Date(),
        );

        await Promise.all([
            this.settlementRepository.removeItems(sessionId, discarded),
            this.settlementRepository.upsertItems(sessionId, kept),
        ]);
        return payments;
    }
}
