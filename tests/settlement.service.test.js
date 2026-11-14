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
        ]);

        const snapshot = await service.getSnapshot(USER, 1);

        expect(snapshot.items.map((it) => it.payment_status)).toEqual([
            "pendiente", "aprobado", "rechazado", "retirado", "reversion_pendiente", "revertido", "revertido", null,
        ]);
        expect(snapshot.totals.confirmed.items).toBe(3);
    });
});
