import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettlementService } from "../services/settlement.service.js";
import { customError, ErrorCode } from "../utils/errors.js";

const USER = 1;
const SESSION = { id: 5, user_id: USER, status: "OPEN" };

describe("SettlementService: marcar gastos en la sesión", () => {
    let settlementRepository;
    let gastosService;
    let service;

    beforeEach(() => {
        settlementRepository = {
            getOpenSession: vi.fn(async () => SESSION),
            getSessionItems: vi.fn(async () => []),
            upsertItem: vi.fn(),
            removeItem: vi.fn(),
            addItems: vi.fn(),
            removeItems: vi.fn(),
        };
        gastosService = { assertOwnedAll: vi.fn(async () => {}) };
        service = new SettlementService({ settlementRepository, gastosService, runInTransaction: (fn) => fn() });
    });

    const ajeno = () => gastosService.assertOwnedAll.mockRejectedValue(customError(ErrorCode.NO_AUTORIZADO));

    describe("setItem", () => {
        it("marca un gasto propio", async () => {
            await service.setItem(USER, 10, true);

            expect(gastosService.assertOwnedAll).toHaveBeenCalledWith([10], USER);
            expect(settlementRepository.upsertItem).toHaveBeenCalledWith(SESSION.id, 10);
        });

        it("no marca un gasto ajeno", async () => {
            ajeno();

            await expect(service.setItem(USER, 99, true)).rejects.toMatchObject({ code: "NO_AUTORIZADO", status: 403 });
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });

        it("desmarca sin verificar pertenencia", async () => {
            await service.setItem(USER, 10, false);

            expect(gastosService.assertOwnedAll).not.toHaveBeenCalled();
            expect(settlementRepository.removeItem).toHaveBeenCalledWith(SESSION.id, 10);
        });

        it("exige una sesión abierta", async () => {
            settlementRepository.getOpenSession.mockResolvedValue(null);

            await expect(service.setItem(USER, 10, true)).rejects.toMatchObject({ code: "SETTLEMENT_REQUIRED" });
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });
    });

    describe("setItemsBulk", () => {
        it("marca un lote de gastos propios", async () => {
            await service.setItemsBulk(USER, [10, "11"], true);

            expect(gastosService.assertOwnedAll).toHaveBeenCalledWith([10, 11], USER);
            expect(settlementRepository.addItems).toHaveBeenCalledWith(SESSION.id, [10, 11]);
        });

        it("no marca nada si el lote incluye un gasto ajeno", async () => {
            ajeno();

            await expect(service.setItemsBulk(USER, [10, 99], true)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            expect(settlementRepository.addItems).not.toHaveBeenCalled();
        });

        it("desmarca un lote sin verificar pertenencia", async () => {
            await service.setItemsBulk(USER, [10, 11], false);

            expect(gastosService.assertOwnedAll).not.toHaveBeenCalled();
            expect(settlementRepository.removeItems).toHaveBeenCalledWith(SESSION.id, [10, 11]);
        });
    });

    describe("finishSession", () => {
        beforeEach(() => {
            Object.assign(settlementRepository, {
                getSnapshotSourceItems: vi.fn(async () => []),
                insertSnapshot: vi.fn(async (data) => ({ id: 1, ...data })),
                finishSession: vi.fn(),
                releasePostponedForUser: vi.fn(),
            });
            Object.assign(settlementRepository, { upsertItems: vi.fn() });
            Object.assign(gastosService, {
                effectSettlementBatch: vi.fn(async (ids) => ({ kept: ids.map(Number), discarded: [] })),
            });
        });

        it("no guarda un resumen si no hay gastos marcados", async () => {
            await expect(service.finishSession(USER)).rejects.toMatchObject({ code: "SETTLEMENT_EMPTY", status: 409 });
            expect(settlementRepository.insertSnapshot).not.toHaveBeenCalled();
            expect(settlementRepository.finishSession).not.toHaveBeenCalled();
        });

        it("no guarda un resumen si la limpieza sacó todos los marcados", async () => {
            settlementRepository.getSessionItems.mockResolvedValue([{ purchase_id: 10 }]);
            gastosService.effectSettlementBatch.mockResolvedValue({ kept: [], discarded: [10] });

            await expect(service.finishSession(USER)).rejects.toMatchObject({ code: "SETTLEMENT_EMPTY" });
            expect(settlementRepository.removeItems).toHaveBeenCalledWith(SESSION.id, [10]);
            expect(settlementRepository.insertSnapshot).not.toHaveBeenCalled();
            expect(settlementRepository.finishSession).not.toHaveBeenCalled();
        });

        it("paga todos los marcados en una sola llamada y relee sus cuotas", async () => {
            settlementRepository.getSessionItems.mockResolvedValue([{ purchase_id: 10 }, { purchase_id: 11 }]);
            settlementRepository.getSnapshotSourceItems.mockResolvedValue([
                { purchase_id: 10, amount_per_quota: "100", currency_type: "ARS", type: "EGRESO", entity_id: 3 },
                { purchase_id: 11, amount_per_quota: "50", currency_type: "ARS", type: "EGRESO", entity_id: 3 },
            ]);

            await service.finishSession(USER);

            expect(gastosService.effectSettlementBatch).toHaveBeenCalledTimes(1);
            expect(gastosService.effectSettlementBatch).toHaveBeenCalledWith([10, 11], USER, expect.any(Date));
            expect(settlementRepository.upsertItems).toHaveBeenCalledWith(SESSION.id, [10, 11]);
        });

        it("guarda el resumen y cierra la sesión si hay gastos", async () => {
            settlementRepository.getSnapshotSourceItems.mockResolvedValue([
                { purchase_id: 10, amount_per_quota: "100", currency_type: "ARS", type: "EGRESO", entity_id: 3 },
            ]);

            const snapshot = await service.finishSession(USER);

            expect(snapshot.totals.items).toBe(1);
            expect(settlementRepository.finishSession).toHaveBeenCalledWith(SESSION.id);
        });

        it("exige una sesión abierta", async () => {
            settlementRepository.getOpenSession.mockResolvedValue(null);

            await expect(service.finishSession(USER)).rejects.toMatchObject({ code: "NO_OPEN_SESSION" });
        });
    });
});

describe("SettlementService: pagos compartidos en el resumen", () => {
    let settlementRepository;
    let gastosService;
    let movementsRepository;
    let service;

    beforeEach(() => {
        settlementRepository = {
            getOpenSession: vi.fn(async () => SESSION),
            getSessionItems: vi.fn(async () => [{ purchase_id: 10 }, { purchase_id: 11 }]),
            upsertItem: vi.fn(),
            addItems: vi.fn(),
            removeItems: vi.fn(),
            upsertItems: vi.fn(),
            getSnapshotSourceItems: vi.fn(async () => [
                { purchase_id: 10, amount_per_quota: "100", currency_type: "ARS", type: "EGRESO", entity_id: 3 },
                { purchase_id: 11, amount_per_quota: "50", currency_type: "ARS", type: "EGRESO", entity_id: 3 },
            ]),
            insertSnapshot: vi.fn(async (data) => ({ id: 1, ...data })),
            finishSession: vi.fn(),
            releasePostponedForUser: vi.fn(),
            getSnapshot: vi.fn(),
        };
        gastosService = {
            assertOwnedAll: vi.fn(async () => {}),
            errorDeMarcado: vi.fn(async () => new Map()),
            effectSettlementBatch: vi.fn(async () => ({
                kept: [10, 11],
                discarded: [],
                payments: {
                    10: { movement_id: 70, shared: false, role: "pago", counterparty_name: null },
                    11: { movement_id: 71, shared: true, role: "pago", counterparty_name: "Juan" },
                },
            })),
        };
        movementsRepository = {
            getMovementsByIds: vi.fn(async () => [
                { id: 70, movement_type: "PAYMENT" },
                { id: 71, movement_type: "PENDING_PAYMENT" },
            ]),
        };
        service = new SettlementService({
            settlementRepository,
            gastosService,
            movementsRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("no marca un gasto cuyas cuotas ya tienen pagos esperando confirmación", async () => {
        gastosService.errorDeMarcado.mockResolvedValue(new Map([[10, "GASTO_CUOTAS_CUBIERTAS"]]));

        await expect(service.setItem(USER, 10, true)).rejects.toMatchObject({ code: "GASTO_CUOTAS_CUBIERTAS" });
        expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
    });

    it("al marcar un lote deja afuera los que no se pueden marcar", async () => {
        gastosService.errorDeMarcado.mockResolvedValue(new Map([[10, "GASTO_CUOTAS_CUBIERTAS"]]));

        await service.setItemsBulk(USER, [10, 11], true);

        expect(settlementRepository.addItems).toHaveBeenCalledWith(SESSION.id, [11]);
    });

    it("cada ítem guarda su pago y el estado se calcula al leerlo", async () => {
        const snapshot = await service.finishSession(USER);

        const [luz, alquiler] = snapshot.items;
        expect(luz).toMatchObject({ movement_id: 70, shared: false, payment_status: "pagado" });
        expect(alquiler).toMatchObject({
            movement_id: 71,
            shared: true,
            payment_role: "pago",
            counterparty_name: "Juan",
            payment_status: "pendiente",
        });
        expect(snapshot.totals.byCurrency.ARS.egreso).toBe(150);
        expect(snapshot.totals.confirmed.byCurrency.ARS.egreso).toBe(100);
    });

    it("traduce cada movimiento a su estado", async () => {
        const item = (movement_id, shared = true) => ({
            movement_id, shared, amount_per_quota: 10, currency: "ARS", type: "EGRESO",
        });
        settlementRepository.getSnapshot.mockResolvedValue({
            id: 1,
            totals: { byCurrency: {} },
            items: [item(1), item(2), item(3), item(4), item(5), item(6), item(7, false), { ...item(null), movement_id: null }],
        });
        movementsRepository.getMovementsByIds.mockResolvedValue([
            { id: 1, movement_type: "PENDING_PAYMENT" },
            { id: 2, movement_type: "PAYMENT" },
            { id: 3, movement_type: "PAYMENT_REJECTED" },
            { id: 4, movement_type: "PAYMENT_WITHDRAWN" },
            { id: 5, movement_type: "PAYMENT", reversal_requested_by_user_id: 9 },
            { id: 6, movement_type: "PAYMENT_REVERTED" },
        ]);

        const snapshot = await service.getSnapshot(USER, 1);

        expect(snapshot.items.map((it) => it.payment_status)).toEqual([
            "pendiente", "aprobado", "rechazado", "retirado", "reversion_pendiente", "revertido", "revertido", null,
        ]);
        expect(snapshot.totals.confirmed.items).toBe(3);
    });
});

describe("SettlementService: historial para gráficos", () => {
    let settlementRepository;
    let movementsRepository;
    let service;

    const item = (overrides) => ({
        purchase_id: 1,
        name: "Gasto",
        entity_id: 7,
        entity_name: "Banco",
        amount_per_quota: 100,
        currency: "ARS",
        type: "EGRESO",
        fixed_expense: false,
        movement_id: null,
        ...overrides,
    });

    beforeEach(() => {
        settlementRepository = {
            listSnapshotsForCharts: vi.fn(async () => []),
            getCurrentCategories: vi.fn(async () => []),
        };
        movementsRepository = { getMovementsByIds: vi.fn(async () => []) };
        service = new SettlementService({ settlementRepository, movementsRepository, runInTransaction: (fn) => fn() });
    });

    it("pide una sesión más que la página para saber si hay anteriores", async () => {
        settlementRepository.listSnapshotsForCharts.mockResolvedValue([
            { id: 9, month: "2026-11", finished_at: "f9", items: [] },
            { id: 8, month: "2026-10", finished_at: "f8", items: [] },
            { id: 7, month: "2026-09", finished_at: "f7", items: [] },
        ]);

        const result = await service.getChartHistory(USER, { limit: 2, before: 10 });

        expect(settlementRepository.listSnapshotsForCharts).toHaveBeenCalledWith(USER, { limit: 3, before: 10 });
        expect(result.sessions.map((s) => s.id)).toEqual([9, 8]);
        expect(result.next_before).toBe(8);
    });

    it("no ofrece más páginas cuando no quedan sesiones", async () => {
        settlementRepository.listSnapshotsForCharts.mockResolvedValue([{ id: 3, month: "2026-11", finished_at: "f", items: [] }]);

        const result = await service.getChartHistory(USER);

        expect(settlementRepository.listSnapshotsForCharts).toHaveBeenCalledWith(USER, { limit: 7, before: null });
        expect(result.next_before).toBeNull();
    });

    it("cuenta solo los pagos confirmados", async () => {
        settlementRepository.listSnapshotsForCharts.mockResolvedValue([
            {
                id: 3,
                month: "2026-11",
                finished_at: "f",
                items: JSON.stringify([
                    item({ purchase_id: 1, movement_id: 11, categories: [] }),
                    item({ purchase_id: 2, movement_id: 12, categories: [] }),
                    item({ purchase_id: 3, movement_id: 13, shared: true, categories: [] }),
                    item({ purchase_id: 4, movement_id: 14, shared: true, categories: [] }),
                ]),
            },
        ]);
        movementsRepository.getMovementsByIds.mockResolvedValue([
            { id: 11, movement_type: "PAYMENT" },
            { id: 12, movement_type: "PAYMENT_REVERTED" },
            { id: 13, movement_type: "PENDING_PAYMENT" },
            { id: 14, movement_type: "PAYMENT_REJECTED" },
        ]);

        const { sessions } = await service.getChartHistory(USER);

        expect(sessions[0].items.map((it) => it.purchase_id)).toEqual([1]);
    });

    it("filtra por entidad", async () => {
        settlementRepository.listSnapshotsForCharts.mockResolvedValue([
            {
                id: 3,
                month: "2026-11",
                finished_at: "f",
                items: [item({ purchase_id: 1, entity_id: 7, categories: [] }), item({ purchase_id: 2, entity_id: 8, categories: [] })],
            },
        ]);

        const { sessions } = await service.getChartHistory(USER, { entityId: 8 });

        expect(sessions[0].items.map((it) => it.purchase_id)).toEqual([2]);
    });

    it("usa las categorías guardadas y completa con las actuales las de sesiones viejas", async () => {
        const guardada = [{ id: 1, name: "Hogar", color: "#000" }];
        const actual = [{ id: 2, name: "Ocio", color: "#fff" }];
        settlementRepository.listSnapshotsForCharts.mockResolvedValue([
            {
                id: 3,
                month: "2026-11",
                finished_at: "f",
                items: [item({ purchase_id: 1, categories: guardada }), item({ purchase_id: 2 })],
            },
        ]);
        settlementRepository.getCurrentCategories.mockResolvedValue([{ purchase_id: 2, categories: JSON.stringify(actual) }]);

        const { sessions } = await service.getChartHistory(USER);

        expect(settlementRepository.getCurrentCategories).toHaveBeenCalledWith([2]);
        expect(sessions[0].items.map((it) => it.categories)).toEqual([guardada, actual]);
    });

    it("limita el tamaño de la página", async () => {
        await service.getChartHistory(USER, { limit: 500 });

        expect(settlementRepository.listSnapshotsForCharts).toHaveBeenCalledWith(USER, { limit: 25, before: null });
    });
});
