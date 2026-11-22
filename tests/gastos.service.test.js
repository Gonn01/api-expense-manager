import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));

import { GastosService } from "../services/gastos.service.js";
import { triggerCompartidos } from "../utils/pusher.js";

const OWNER = 1;
const INTRUSO = 2;

function makeGasto(overrides = {}) {
    return {
        id: 10,
        name: "Netflix",
        amount: 300,
        type: "EGRESO",
        currency_type: "ARS",
        image_url: "img.png",
        financial_entity_id: 7,
        receiver_user_id: null,
        linked_purchase_id: null,
        fixed_expense: false,
        number_of_quotas: 3,
        payed_quotas: 1,
        pending_quotas: 0,
        amount_per_quota: 100,
        is_postponed: false,
        ...overrides,
    };
}

describe("GastosService", () => {
    let gastosRepository;
    let movementsRepository;
    let entidadesFinancierasRepository;
    let categoriasRepository;
    let settlementRepository;
    let service;
    let gasto;

    beforeEach(() => {
        gasto = makeGasto();

        gastosRepository = {
            getById: vi.fn(async () => [gasto]),
            getByIdsWithOwner: vi.fn(async (ids, userId) =>
                ids.map(String).includes(String(gasto.id))
                    ? [{ ...gasto, owned: userId === OWNER && gasto.financial_entity_id === 7 }]
                    : [],
            ),
            getOwnedIds: vi.fn(async (ids, userId) =>
                userId === OWNER ? ids.filter((id) => ["10", "11"].includes(id)).map((id) => ({ id: Number(id) })) : [],
            ),
            getByIdIncludingDeleted: vi.fn(async () => [gasto]),
            update: vi.fn(async () => [gasto]),
            delete: vi.fn(async () => [{ id: gasto.id }]),
            restore: vi.fn(async () => [{ id: gasto.id }]),
            unlink: vi.fn(),
            setPostponed: vi.fn(async () => [gasto]),
            setFavorite: vi.fn(async () => [gasto]),
            getSharedSibling: vi.fn(async () => []),
            getSharedSiblings: vi.fn(async () => []),
            getSharedState: vi.fn(async () => [{ was_shared: false, sibling_id: null }]),
            updateStatus: vi.fn(async () => [gasto]),
            create: vi.fn(async (data) => [{ id: 11, ...data }]),
            clearFavoriteIfFinalized: vi.fn(),
            clearFavoritesIfFinalized: vi.fn(),
            lockPurchases: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Ana" }]),
        };
        movementsRepository = {
            getMovementsByGasto: vi.fn(async () => [
                { id: 500, movement_type: "PAYMENT", amount: 100, payment_date: "2026-10-01", created_at: "2026-10-01" },
            ]),
            getReceivedPayments: vi.fn(async () => []),
            getSharedSentEvent: vi.fn(async () => []),
            createGastoLog: vi.fn(async (gastoId, movementType) => [{ id: 800, purchase_id: gastoId, movement_type: movementType }]),
            setPairedMovement: vi.fn(),
            setPairedMovements: vi.fn(),
            createGastoLogs: vi.fn(async (logs) =>
                logs.map((l, i) => ({
                    id: 900 + i,
                    purchase_id: l.gastoId,
                    movement_type: l.movementType,
                    paired_movement_id: l.pairedMovementId ?? null,
                })),
            ),
            createEntidadLog: vi.fn(),
            revertPaymentsByIds: vi.fn(async (ids) => ids.map((id) => ({ id, amount: 100, purchase_id: 10 }))),
            getPaymentById: vi.fn(async (id) => [{ id: Number(id), purchase_id: 10, movement_type: "PAYMENT", amount: 100 }]),
            getPendingPaymentsByPurchases: vi.fn(async () => []),
        };
        entidadesFinancierasRepository = {
            getById: vi.fn(async (entidadId, userId) =>
                entidadId === 7 && userId === OWNER ? [{ id: 7, user_id: OWNER }] : [],
            ),
        };
        categoriasRepository = {
            getCategoriasByGasto: vi.fn(async () => []),
            setCategoriasForGasto: vi.fn(),
        };
        settlementRepository = {
            getOpenSession: vi.fn(async () => null),
            upsertItem: vi.fn(),
            removeItem: vi.fn(),
            hasItem: vi.fn(async () => false),
            upsertItems: vi.fn(),
        };

        service = new GastosService({
            gastosRepository,
            movementsRepository,
            entidadesFinancierasRepository,
            categoriasRepository,
            settlementRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    describe("verificación de dueño", () => {
        const operaciones = {
            getById: (userId) => service.getById(10, userId),
            update: (userId) => service.update(10, userId, { name: "Otro", amount: 500, fixed_expense: false, type: "EGRESO", category_ids: [1] }),
            delete: (userId) => service.delete(10, userId),
            restaurar: (userId) => service.restaurar(10, userId),
            postergarGasto: (userId) => service.postergarGasto(10, userId, true),
            marcarFavorito: (userId) => service.marcarFavorito(10, userId, true),
            actualizarCategorias: (userId) => service.actualizarCategorias(10, userId, [1]),
            settleQuota: (userId) => service.settleQuota(10, userId),
            "settleQuota directo": (userId) => service.settleQuota(10, userId, { direct: true }),
            refundCuota: (userId) => service.refundCuota(10, userId),
            revertirPago: (userId) => service.revertirPago(10, 500, userId),
        };

        for (const [nombre, operar] of Object.entries(operaciones)) {
            it(`${nombre} rechaza con NO_AUTORIZADO un gasto ajeno y no modifica nada`, async () => {
                await expect(operar(INTRUSO)).rejects.toMatchObject({ code: "NO_AUTORIZADO", status: 403 });

                expect(gastosRepository.update).not.toHaveBeenCalled();
                expect(gastosRepository.delete).not.toHaveBeenCalled();
                expect(gastosRepository.restore).not.toHaveBeenCalled();
                expect(gastosRepository.setPostponed).not.toHaveBeenCalled();
                expect(gastosRepository.setFavorite).not.toHaveBeenCalled();
                expect(categoriasRepository.setCategoriasForGasto).not.toHaveBeenCalled();
                expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
                expect(movementsRepository.revertPaymentsByIds).not.toHaveBeenCalled();
                expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
                expect(settlementRepository.upsertItems).not.toHaveBeenCalled();
            });

            it(`${nombre} funciona para el dueño`, async () => {
                await expect(operar(OWNER)).resolves.toBeDefined();
            });

            it(`${nombre} rechaza si no llega el usuario`, async () => {
                await expect(operar(undefined)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            });
        }

        it("responde GASTO_NOT_FOUND si el gasto no existe", async () => {
            gastosRepository.getById.mockResolvedValue([]);

            await expect(service.getById(99, OWNER)).rejects.toMatchObject({ code: "GASTO_NOT_FOUND" });
        });

        it("el receptor puede ver la copia compartida que todavía no tiene entidad", async () => {
            gasto = makeGasto({ financial_entity_id: null, receiver_user_id: INTRUSO });

            await expect(service.getById(10, INTRUSO)).resolves.toMatchObject({ id: 10 });
            await expect(service.getById(10, OWNER)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
        });

        it("el receptor no puede modificar la copia compartida sin entidad", async () => {
            gasto = makeGasto({ financial_entity_id: null, receiver_user_id: INTRUSO });

            await expect(service.delete(10, INTRUSO)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            await expect(service.settleQuota(10, INTRUSO)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
        });

        it("el pago en lote deja afuera los gastos ajenos sin marcarlos", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            const { updated, failed } = await service.settleQuotasLote([10], INTRUSO);

            expect(updated).toEqual([]);
            expect(failed).toEqual([{ id: 10, reason: "No autorizado" }]);
            expect(settlementRepository.upsertItems).not.toHaveBeenCalled();
        });

        it("el pago en lote marca todos los gastos válidos en una sola llamada", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            const { updated, failed } = await service.settleQuotasLote([10, 10, 99, "x"], OWNER);

            expect(gastosRepository.getByIdsWithOwner).toHaveBeenCalledTimes(1);
            expect(gastosRepository.getByIdsWithOwner).toHaveBeenCalledWith(["10", "99"], OWNER);
            expect(settlementRepository.upsertItems).toHaveBeenCalledTimes(1);
            expect(updated.map((g) => g.id)).toEqual([10, 10]);
            expect(updated[0]).not.toHaveProperty("owned");
            expect(failed).toEqual([
                { id: 99, reason: "Gasto no encontrado" },
                { id: "x", reason: "Gasto no encontrado" },
            ]);
        });

        it("el pago en lote no marca gastos postergados ni saldados", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });
            gasto = makeGasto({ is_postponed: true });

            const { updated, failed } = await service.settleQuotasLote([10], OWNER);

            expect(updated).toEqual([]);
            expect(failed).toEqual([{ id: 10, reason: "Gasto postergado para la próxima sesión" }]);
            expect(settlementRepository.upsertItems).not.toHaveBeenCalled();
        });
    });

    describe("assertOwnedAll", () => {
        it("pasa si todos los gastos son del usuario", async () => {
            await expect(service.assertOwnedAll([10, 11], OWNER)).resolves.toBeUndefined();
        });

        it("rechaza si alguno de los gastos es ajeno o no existe", async () => {
            await expect(service.assertOwnedAll([10, 99], OWNER)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            await expect(service.assertOwnedAll([10], INTRUSO)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
        });

        it("rechaza ids que no son enteros sin consultar la base", async () => {
            await expect(service.assertOwnedAll([NaN], OWNER)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            await expect(service.assertOwnedAll(["10 OR 1=1"], OWNER)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            expect(gastosRepository.getOwnedIds).not.toHaveBeenCalled();
        });

        it("rechaza si no llega el usuario", async () => {
            await expect(service.assertOwnedAll([10], undefined)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
        });
    });

    describe("gasto compartido rechazado", () => {
        beforeEach(() => {
            gasto = makeGasto({ status: "REJECTED" });
        });

        it("no admite un pago directo", async () => {
            await expect(service.settleQuota(10, OWNER, { direct: true })).rejects.toMatchObject({
                code: "GASTO_NO_ACTIVO",
                status: 409,
            });
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
        });

        it("no se marca en la sesión abierta", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await expect(service.settleQuota(10, OWNER)).rejects.toMatchObject({ code: "GASTO_NO_ACTIVO" });
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });

        it("el pago en lote lo deja afuera", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            const { updated, failed } = await service.settleQuotasLote([10], OWNER);

            expect(updated).toEqual([]);
            expect(failed).toEqual([{ id: 10, reason: "El gasto no está activo" }]);
        });

        it("el cierre de la sesión lo descarta sin registrar un pago", async () => {
            const { kept, discarded } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([]);
            expect(discarded).toEqual([10]);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([]);
        });

        it("informa el error al intentar marcarlo", async () => {
            const errores = await service.errorDeMarcado([10], OWNER);

            expect(errores.get(10)).toBe("GASTO_NO_ACTIVO");
        });

        it("bloquea cambiar el monto", async () => {
            await expect(service.update(10, OWNER, { amount: 500 })).rejects.toMatchObject({
                code: "GASTO_CAMPO_NO_EDITABLE",
                details: { field: "amount" },
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });
    });

    describe("gasto compartido que la otra persona todavía no aprobó", () => {
        const COPIA_PENDIENTE = { sibling_id: 20, counterparty_user_id: INTRUSO, sibling_status: "PENDING_APPROVAL" };

        beforeEach(() => {
            gasto = makeGasto({ status: "PENDING_APPROVAL" });
            gastosRepository.getSharedSibling.mockResolvedValue([COPIA_PENDIENTE]);
            gastosRepository.getSharedSiblings.mockResolvedValue([{ purchase_id: 10, ...COPIA_PENDIENTE }]);
        });

        it("explica que el nombre no se puede cambiar hasta que el gasto esté aceptado", async () => {
            await expect(service.update(10, OWNER, { name: "Otro nombre" })).rejects.toMatchObject({
                code: "GASTO_CAMPO_NO_EDITABLE",
                message: expect.stringMatching(/todavía no está aceptado/),
                details: { field: "name" },
            });
        });

        it("no toma como cambio de nombre un guardado que no lo toca aunque tenga espacios al final", async () => {
            gasto = makeGasto({ status: "PENDING_APPROVAL", name: "Alquiler " });

            await expect(service.update(10, OWNER, { image_url: null })).resolves.toBeDefined();
        });

        it("el pago directo busca también la copia pendiente y queda como pago pendiente", async () => {
            await service.settleQuota(10, OWNER, { direct: true });

            expect(gastosRepository.getSharedSibling).toHaveBeenCalledWith(10, { includePendingApproval: true });
            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
                10, "PENDING_PAYMENT", expect.anything(), expect.any(Date), OWNER,
            );
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalledWith(
                10, "PAYMENT", expect.anything(), expect.anything(),
            );
        });

        it("se marca en la sesión abierta", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await service.settleQuota(10, OWNER);

            expect(settlementRepository.upsertItem).toHaveBeenCalledWith(5, 10);
        });

        it("el pago en lote no lo deja afuera", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            const { failed } = await service.settleQuotasLote([10], OWNER);

            expect(failed).toEqual([]);
        });

        it("el cierre de la sesión lo registra como pago pendiente", async () => {
            const { kept } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([10]);
            expect(gastosRepository.getSharedSiblings).toHaveBeenCalledWith(["10"], { includePendingApproval: true });
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
                expect.objectContaining({ gastoId: 10, movementType: "PENDING_PAYMENT", createdByUserId: OWNER }),
            ]);
        });

        it("no informa error al intentar marcarlo", async () => {
            const errores = await service.errorDeMarcado([10], OWNER);

            expect(errores.has(10)).toBe(false);
        });

        it("bloquea cambiar el monto", async () => {
            await expect(service.update(10, OWNER, { amount: 500 })).rejects.toMatchObject({
                code: "GASTO_CAMPO_NO_EDITABLE",
                details: { field: "amount" },
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });
    });

    describe("settleQuota: cuotas restantes", () => {
        it("pago directo: registra el pago si quedan cuotas", async () => {
            await service.settleQuota(10, OWNER, { direct: true });

            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
                10, "PAYMENT", 100, expect.any(Date),
            );
        });

        it("pago directo: rechaza con GASTO_YA_SALDADO si todas las cuotas están pagas", async () => {
            gasto = makeGasto({ payed_quotas: 3 });

            await expect(service.settleQuota(10, OWNER, { direct: true })).rejects.toMatchObject({
                code: "GASTO_YA_SALDADO",
                status: 409,
            });
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
        });

        it("sin sesión abierta: rechaza un gasto saldado", async () => {
            gasto = makeGasto({ payed_quotas: 3 });

            await expect(service.settleQuota(10, OWNER)).rejects.toMatchObject({ code: "GASTO_YA_SALDADO" });
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
        });

        it("con sesión abierta: no marca un gasto saldado", async () => {
            gasto = makeGasto({ payed_quotas: 3 });
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await expect(service.settleQuota(10, OWNER)).rejects.toMatchObject({ code: "GASTO_YA_SALDADO" });
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });

        it("con sesión abierta: marca el gasto sin registrar el pago", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await service.settleQuota(10, OWNER);

            expect(settlementRepository.upsertItem).toHaveBeenCalledWith(5, 10);
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
        });

        it("un gasto fijo admite pagos aunque supere su cantidad de cuotas", async () => {
            gasto = makeGasto({ fixed_expense: true, number_of_quotas: 0, payed_quotas: 8 });

            await service.settleQuota(10, OWNER, { direct: true });

            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
                10, "PAYMENT", 100, expect.any(Date),
            );
        });
    });

    describe("settleQuota: respuesta", () => {
        it("pago directo: devuelve el detalle completo sin volver a pedir el hermano compartido", async () => {
            const detalle = await service.settleQuota(10, OWNER, { direct: true });

            expect(detalle).toMatchObject({
                id: 10,
                movements: [expect.objectContaining({ id: 500 })],
                categories: [],
                shared_counterparty: null,
                edit_locks: expect.any(Object),
            });
            expect(gastosRepository.getSharedSibling).toHaveBeenCalledTimes(1);
            expect(gastosRepository.clearFavoriteIfFinalized).toHaveBeenCalledWith(10);
        });

        it("con sesión abierta: devuelve el detalle con el bloqueo de gasto marcado", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            const detalle = await service.settleQuota(10, OWNER);

            expect(detalle.edit_locks.amount).toMatch(/marcado en la sesión/);
            expect(settlementRepository.hasItem).not.toHaveBeenCalled();
        });
    });

    describe("effectSettlementBatch", () => {
        const PAGO = expect.objectContaining({ gastoId: 10, movementType: "PAYMENT", amount: 100 });

        it("registra todos los pagos en un solo INSERT", async () => {
            const { kept, discarded } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([10]);
            expect(discarded).toEqual([]);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledTimes(1);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([PAGO]);
            expect(gastosRepository.clearFavoritesIfFinalized).toHaveBeenCalledWith([10]);
        });

        it("descarta sin pagar los gastos ajenos, inexistentes, postergados o saldados", async () => {
            const casos = [
                [() => service.effectSettlementBatch([10], INTRUSO), [10]],
                [() => service.effectSettlementBatch([99, "x"], OWNER), [99, "x"]],
                [() => { gasto = makeGasto({ is_postponed: true }); return service.effectSettlementBatch([10], OWNER); }, [10]],
                [() => { gasto = makeGasto({ payed_quotas: 3 }); return service.effectSettlementBatch([10], OWNER); }, [10]],
            ];
            for (const [operar, esperado] of casos) {
                movementsRepository.createGastoLogs.mockClear();
                const { kept, discarded } = await operar();
                expect(kept).toEqual([]);
                expect(discarded).toEqual(esperado);
                expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([]);
            }
        });

        it("un gasto compartido queda como pago pendiente de la contraparte", async () => {
            gastosRepository.getSharedSiblings.mockResolvedValue([
                { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO },
            ]);

            const { kept } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([10]);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
                expect.objectContaining({ gastoId: 10, movementType: "PENDING_PAYMENT", createdByUserId: OWNER }),
            ]);
            expect(triggerCompartidos).toHaveBeenCalledWith(INTRUSO, "pago.pendiente", {
                purchaseId: 10,
                copyId: 20,
                actorName: "Ana",
            });
        });

        it("un compartido con todas las cuotas cubiertas sale del resumen sin sumar otro pendiente", async () => {
            gasto = makeGasto({ payed_quotas: 1, pending_quotas: 2 });
            gastosRepository.getSharedSiblings.mockResolvedValue([
                { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO },
            ]);

            const { kept, discarded } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([]);
            expect(discarded).toEqual([10]);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([]);
        });

        it("devuelve el movimiento de cada pago para el resumen", async () => {
            gastosRepository.getSharedSiblings.mockResolvedValue([
                { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO, counterparty_name: "Juan" },
            ]);

            const { payments } = await service.effectSettlementBatch([10], OWNER);

            expect(payments[10]).toEqual({ movement_id: 900, shared: true, role: "pago", counterparty_name: "Juan" });
        });

        it("bloquea el gasto y su copia antes de leerlos", async () => {
            gastosRepository.getSharedSiblings.mockResolvedValue([
                { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO },
            ]);

            await service.effectSettlementBatch([10], OWNER);

            expect(gastosRepository.lockPurchases).toHaveBeenCalledWith(["10", 20]);
        });

        describe("si la otra persona ya registró el pago", () => {
            const PEND = { id: 77, purchase_id: 20, created_by_user_id: INTRUSO };
            let pagosCompartidosService;

            beforeEach(() => {
                pagosCompartidosService = { confirmarDesdeCopia: vi.fn(), confirmarDesdeCopias: vi.fn() };
                service = new GastosService({
                    gastosRepository,
                    movementsRepository,
                    entidadesFinancierasRepository,
                    categoriasRepository,
                    settlementRepository,
                    pagosCompartidosService,
                    runInTransaction: (fn) => fn(),
                });
                gastosRepository.getSharedSiblings.mockResolvedValue([
                    { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO, counterparty_name: "Juan" },
                ]);
                movementsRepository.getPendingPaymentsByPurchases.mockResolvedValue([PEND]);
            });

            it("al cerrar la sesión confirma ese pago en vez de crear otro", async () => {
                const { kept, payments } = await service.effectSettlementBatch([10], OWNER);

                expect(kept).toEqual([10]);
                expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([]);
                expect(pagosCompartidosService.confirmarDesdeCopias).toHaveBeenCalledWith(
                    [{ pend: PEND, copiaId: 10 }],
                    OWNER,
                );
                expect(payments[10]).toEqual({ movement_id: 77, shared: true, role: "confirmacion", counterparty_name: "Juan" });
            });

            it("confirma aunque las cuotas propias estén cubiertas por pendientes propios", async () => {
                gasto = makeGasto({ payed_quotas: 1, pending_quotas: 2 });

                const { kept } = await service.effectSettlementBatch([10], OWNER);

                expect(kept).toEqual([10]);
                expect(pagosCompartidosService.confirmarDesdeCopias).toHaveBeenCalled();
            });

            it("el pago directo también confirma el pendiente de la otra persona", async () => {
                gastosRepository.getSharedSibling.mockResolvedValue([{ sibling_id: 20, counterparty_user_id: INTRUSO }]);

                await service.settleQuota(10, OWNER, { direct: true });

                expect(pagosCompartidosService.confirmarDesdeCopia).toHaveBeenCalledWith(PEND, 10, OWNER);
                expect(movementsRepository.createGastoLog).not.toHaveBeenCalledWith(
                    10, "PENDING_PAYMENT", expect.anything(), expect.anything(), expect.anything(),
                );
            });
        });
    });

    describe("cuotas cubiertas por pagos esperando confirmación", () => {
        it("no deja marcar ni pagar si las cuotas que quedan ya tienen pendientes", async () => {
            gasto = makeGasto({ payed_quotas: 1, pending_quotas: 2 });
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await expect(service.settleQuota(10, OWNER)).rejects.toMatchObject({ code: "GASTO_CUOTAS_CUBIERTAS", status: 409 });
            await expect(service.settleQuota(10, OWNER, { direct: true })).rejects.toMatchObject({ code: "GASTO_CUOTAS_CUBIERTAS" });
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });

        it("errorDeMarcado informa cada gasto que no se puede marcar", async () => {
            gasto = makeGasto({ payed_quotas: 1, pending_quotas: 2 });

            const errores = await service.errorDeMarcado([10], OWNER);

            expect(errores.get(10)).toBe("GASTO_CUOTAS_CUBIERTAS");
        });
    });

    describe("revertirPago", () => {
        it("en un gasto no compartido marca ese pago como revertido y registra el reembolso", async () => {
            const { resultado } = await service.revertirPago(10, 500, OWNER);

            expect(resultado).toBe("revertido");
            expect(movementsRepository.revertPaymentsByIds).toHaveBeenCalledWith([500]);
            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(10, "REFUND", 100, expect.any(Date));
        });

        it("rechaza un pago de otro gasto", async () => {
            movementsRepository.getPaymentById.mockResolvedValue([{ id: 500, purchase_id: 99, movement_type: "PAYMENT" }]);

            await expect(service.revertirPago(10, 500, OWNER)).rejects.toMatchObject({ code: "PAGO_NOT_FOUND" });
            expect(movementsRepository.revertPaymentsByIds).not.toHaveBeenCalled();
        });

        describe("en un gasto compartido", () => {
            let pagosCompartidosService;

            beforeEach(() => {
                pagosCompartidosService = { solicitarReversion: vi.fn(), retirar: vi.fn() };
                service = new GastosService({
                    gastosRepository,
                    movementsRepository,
                    entidadesFinancierasRepository,
                    categoriasRepository,
                    settlementRepository,
                    pagosCompartidosService,
                    runInTransaction: (fn) => fn(),
                });
                gastosRepository.getSharedSibling.mockResolvedValue([{ sibling_id: 20, counterparty_user_id: INTRUSO }]);
            });

            it("un pago confirmado pide la reversión a la otra persona", async () => {
                const { resultado } = await service.revertirPago(10, 500, OWNER);

                expect(resultado).toBe("solicitada");
                expect(pagosCompartidosService.solicitarReversion).toHaveBeenCalledWith(500, OWNER);
                expect(movementsRepository.revertPaymentsByIds).not.toHaveBeenCalled();
            });

            it("revertir el último pago también pide la reversión", async () => {
                await service.refundCuota(10, OWNER);

                expect(pagosCompartidosService.solicitarReversion).toHaveBeenCalledWith(500, OWNER);
            });

            it("un pago pendiente propio se retira", async () => {
                movementsRepository.getPaymentById.mockResolvedValue([
                    { id: 501, purchase_id: 10, movement_type: "PENDING_PAYMENT", created_by_user_id: OWNER },
                ]);

                const { resultado } = await service.revertirPago(10, 501, OWNER);

                expect(resultado).toBe("retirado");
                expect(pagosCompartidosService.retirar).toHaveBeenCalledWith(501, OWNER);
            });

            it("un pago pendiente de la otra persona no se puede revertir desde acá", async () => {
                movementsRepository.getPaymentById.mockResolvedValue([
                    { id: 501, purchase_id: 10, movement_type: "PENDING_PAYMENT", created_by_user_id: INTRUSO },
                ]);

                await expect(service.revertirPago(10, 501, OWNER)).rejects.toMatchObject({ code: "PAGO_REGISTRADO_POR_OTRO" });
            });
        });
    });

    describe("delete de un gasto compartido", () => {
        it("cierra el compartido antes de eliminar", async () => {
            const pagosCompartidosService = { cerrarCompartido: vi.fn() };
            service = new GastosService({
                gastosRepository,
                movementsRepository,
                entidadesFinancierasRepository,
                categoriasRepository,
                settlementRepository,
                pagosCompartidosService,
                runInTransaction: (fn) => fn(),
            });

            await service.delete(10, OWNER);

            expect(pagosCompartidosService.cerrarCompartido).toHaveBeenCalledWith(10, OWNER);
            expect(pagosCompartidosService.cerrarCompartido.mock.invocationCallOrder[0])
                .toBeLessThan(gastosRepository.delete.mock.invocationCallOrder[0]);
        });

        it("también cierra el compartido del espejo cuando se elimina", async () => {
            gasto = makeGasto({ linked_purchase_id: 12, linked_financial_entity_id: 8 });
            const pagosCompartidosService = { cerrarCompartido: vi.fn() };
            service = new GastosService({
                gastosRepository,
                movementsRepository,
                entidadesFinancierasRepository,
                categoriasRepository,
                settlementRepository,
                pagosCompartidosService,
                runInTransaction: (fn) => fn(),
            });

            await service.delete(10, OWNER, true);

            expect(pagosCompartidosService.cerrarCompartido).toHaveBeenCalledWith(12, OWNER);
        });
    });

    describe("restaurar un gasto que fue compartido", () => {
        it("lo impide y lo deja eliminado", async () => {
            gastosRepository.getSharedState.mockResolvedValue([{ was_shared: true, sibling_id: 20 }]);

            await expect(service.restaurar(10, OWNER)).rejects.toMatchObject({
                code: "GASTO_COMPARTIDO_NO_RESTAURABLE",
                status: 409,
            });
            expect(gastosRepository.restore).not.toHaveBeenCalled();
        });
    });

    describe("compartir", () => {
        beforeEach(() => {
            gasto = makeGasto({ status: "ACTIVE" });
            entidadesFinancierasRepository.getById.mockResolvedValue([
                { id: 7, user_id: OWNER, linked_user_id: INTRUSO, linked_user_name: "Beto" },
            ]);
        });

        it("crea la copia pendiente, copia los pagos vinculados y avisa al usuario vinculado", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });

            await service.compartir(10, OWNER);

            expect(gastosRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    financial_entity_id: null,
                    shared_from_id: 10,
                    receiver_user_id: INTRUSO,
                    status: "PENDING_APPROVAL",
                }),
            );
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
                expect.objectContaining({
                    gastoId: 11,
                    movementType: "PAYMENT",
                    amount: 100,
                    paymentDate: "2026-10-01",
                    detail: expect.any(String),
                    pairedMovementId: 500,
                }),
            ]);
            expect(movementsRepository.setPairedMovements).toHaveBeenCalledWith([[500, 900]]);
            expect(gastosRepository.updateStatus).toHaveBeenCalledWith(10, "PENDING_APPROVAL");
            expect(settlementRepository.removeItem).toHaveBeenCalledWith(5, 10);
            expect(triggerCompartidos).toHaveBeenCalledWith(INTRUSO, "compartido.nuevo", { gastoId: 10 });
        });

        it.each([
            ["la entidad no está vinculada", () => entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 7, user_id: OWNER }])],
            ["ya fue compartido", () => gastosRepository.getSharedState.mockResolvedValue([{ was_shared: true }])],
            ["no está activo", () => { gasto.status = "REJECTED"; }],
        ])("rechaza si %s", async (_, preparar) => {
            preparar();

            await expect(service.compartir(10, OWNER)).rejects.toMatchObject({ code: "GASTO_NO_COMPARTIBLE", status: 409 });
            expect(gastosRepository.create).not.toHaveBeenCalled();
        });

        it.each([
            ["EGRESO", "INGRESO"],
            ["INGRESO", "EGRESO"],
        ])("al compartir un %s de una entidad vinculada, la copia queda como %s", async (tipo, opuesto) => {
            gasto = makeGasto({ status: "ACTIVE", type: tipo });

            await service.compartir(10, OWNER);

            expect(gastosRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ shared_from_id: 10, type: opuesto }),
            );
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });

        it("el detalle indica si se puede compartir y con quién", async () => {
            const detalle = await service.getById(10, OWNER);

            expect(detalle).toMatchObject({ can_share: true, share_target_name: "Beto", was_shared: false });
        });
    });

    describe("crearGasto", () => {
        const crear = ({ number_of_quotas = 3, payed_quotas = 0, category_ids = [], postponed = false } = {}) =>
            service.crearGasto(7, "Netflix", 300, number_of_quotas, "ARS", false, null, "EGRESO", OWNER, payed_quotas, category_ids, null, postponed);

        beforeEach(() => {
            gastosRepository.create = vi.fn(async (data) => [{ id: 10, ...data }]);
            categoriasRepository.addCategoriasToNewGasto = vi.fn(async (_, ids) => ids.map((id) => ({ id, name: `c${id}` })));
        });

        const crearCon = ({ amount = 300, number_of_quotas = 3, fixed_expense = false } = {}) =>
            service.crearGasto(7, "Netflix", amount, number_of_quotas, "ARS", fixed_expense, null, "EGRESO", OWNER);

        it.each([
            [{ amount: 0 }, "amount"],
            [{ amount: -100 }, "amount"],
            [{ amount: "abc" }, "amount"],
            [{ amount: "  " }, "amount"],
            [{ amount: true }, "amount"],
            [{ amount: Number.POSITIVE_INFINITY }, "amount"],
            [{ number_of_quotas: 0 }, "number_of_quotas"],
            [{ number_of_quotas: -2 }, "number_of_quotas"],
            [{ number_of_quotas: 1.5 }, "number_of_quotas"],
            [{ number_of_quotas: "abc" }, "number_of_quotas"],
            [{ number_of_quotas: null }, "number_of_quotas"],
            [{ number_of_quotas: 361 }, "number_of_quotas"],
            [{ number_of_quotas: 0, fixed_expense: "false" }, "number_of_quotas"],
            [{ number_of_quotas: -1, fixed_expense: true }, "number_of_quotas"],
        ])("rechaza %o con 400 sin guardar nada", async (input, field) => {
            await expect(crearCon(input)).rejects.toMatchObject({
                code: "VALIDATION_ERROR",
                status: 400,
                details: { field },
            });

            expect(entidadesFinancierasRepository.getById).not.toHaveBeenCalled();
            expect(gastosRepository.create).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLogs).not.toHaveBeenCalled();
        });

        it("convierte a número el monto y las cuotas que llegan como texto", async () => {
            await crearCon({ amount: "300.50", number_of_quotas: "3" });

            expect(gastosRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 300.5, number_of_quotas: 3 }),
            );
        });

        it.each([
            [0, 0],
            [undefined, 1],
        ])("un gasto fijo con cuotas %s se guarda con %s", async (number_of_quotas, esperado) => {
            await service.crearGasto(7, "Netflix", 300, number_of_quotas, "ARS", true, null, "EGRESO", OWNER);

            expect(gastosRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ fixed_expense: true, number_of_quotas: esperado }),
            );
        });

        it("registra la creación y las cuotas pagas en una sola inserción", async () => {
            await crear({ payed_quotas: 2 });

            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledTimes(1);
            const [logs] = movementsRepository.createGastoLogs.mock.calls[0];
            expect(logs.map((l) => l.movementType)).toEqual(["CREATION", "PAYMENT", "PAYMENT"]);
            expect(logs[1]).toMatchObject({ gastoId: 10, amount: 100 });
        });

        it("al compartir, escribe un solo CREATION en la copia del receptor", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 7, user_id: OWNER, linked_user_id: INTRUSO }]);
            gastosRepository.create = vi.fn(async (data) => [{ id: data.shared_from_id ? 11 : 10, ...data }]);

            await crear();

            expect(gastosRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    shared_from_id: 10,
                    receiver_user_id: INTRUSO,
                    status: "PENDING_APPROVAL",
                    type: "INGRESO",
                }),
            );
            const creationsDeLaCopia = movementsRepository.createGastoLog.mock.calls.filter(
                ([gastoId, type]) => gastoId === 11 && type === "CREATION",
            );
            expect(creationsDeLaCopia).toHaveLength(1);
            const [logsDelOriginal] = movementsRepository.createGastoLogs.mock.calls[0];
            expect(logsDelOriginal.filter((l) => l.movementType === "CREATION")).toEqual([
                expect.objectContaining({ gastoId: 10 }),
            ]);
        });

        it("al compartir con cuotas ya pagas, las registra como pagos pendientes de confirmación", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 7, user_id: OWNER, linked_user_id: INTRUSO }]);
            gastosRepository.create = vi.fn(async (data) => [{ id: data.shared_from_id ? 11 : 10, ...data }]);

            const [creado] = await crear({ payed_quotas: 2 });

            const [logs] = movementsRepository.createGastoLogs.mock.calls[0];
            expect(logs.map((l) => l.movementType)).toEqual(["CREATION", "PENDING_PAYMENT", "PENDING_PAYMENT"]);
            expect(logs[1]).toMatchObject({ gastoId: 10, amount: 100, createdByUserId: OWNER });
            expect(creado).toMatchObject({ payed_quotas: 0, pending_quotas: 2, last_payment_date: null });
        });

        it("devuelve las cuotas pagas reales del gasto creado", async () => {
            const [creado] = await crear({ payed_quotas: 2 });

            expect(creado).toMatchObject({ payed_quotas: 2, pending_quotas: 0, finalization_date: null });
            expect(creado.last_payment_date).toBeInstanceOf(Date);
        });

        it("marca como finalizado el gasto creado con todas las cuotas pagas", async () => {
            const [creado] = await crear({ number_of_quotas: 2, payed_quotas: 2 });

            expect(creado.finalization_date).toBeInstanceOf(Date);
        });

        it("asigna las categorías y las devuelve en el gasto creado", async () => {
            const [creado] = await crear({ category_ids: [1, 2] });

            expect(categoriasRepository.addCategoriasToNewGasto).toHaveBeenCalledWith(10, [1, 2]);
            expect(categoriasRepository.setCategoriasForGasto).not.toHaveBeenCalled();
            expect(creado.categories).toEqual([{ id: 1, name: "c1" }, { id: 2, name: "c2" }]);
        });

        it("crea el gasto ya postergado sin una actualización aparte", async () => {
            const [creado] = await crear({ postponed: true });

            expect(gastosRepository.create).toHaveBeenCalledWith(expect.objectContaining({ is_postponed: true }));
            expect(gastosRepository.setPostponed).not.toHaveBeenCalled();
            expect(creado.is_postponed).toBe(true);
        });

        it("registra el historial de la entidad después de la transacción", async () => {
            const order = [];
            service.tx = async (fn) => {
                const result = await fn();
                order.push("commit");
                return result;
            };
            movementsRepository.createEntidadLog.mockImplementation(async () => order.push("entidad"));

            await crear();

            expect(order).toEqual(["commit", "entidad"]);
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(7, "PURCHASE_CREATED", 'Gasto creado: "Netflix"');
        });

        it("si falla el historial de la entidad, el gasto igual se crea", async () => {
            movementsRepository.createEntidadLog.mockRejectedValueOnce(new Error("db caída"));

            await expect(crear()).resolves.toHaveLength(1);
        });
    });

    describe("postergación de un gasto pagado", () => {
        const crear = ({ number_of_quotas = 1, payed_quotas = 0, fixed_expense = false, postponed = true }) =>
            service.crearGasto(7, "Netflix", 300, number_of_quotas, "ARS", fixed_expense, null, "EGRESO", OWNER, payed_quotas, [], null, postponed);

        it("no deja crear un gasto pagado y postergado", async () => {
            await expect(crear({ payed_quotas: 1 })).rejects.toMatchObject({ code: "GASTO_PAGADO_NO_POSTERGABLE", status: 409 });
            expect(entidadesFinancierasRepository.getById).not.toHaveBeenCalled();
        });

        it("no deja crear postergado un gasto en cuotas con todas pagas", async () => {
            await expect(crear({ number_of_quotas: 6, payed_quotas: 6 })).rejects.toMatchObject({ code: "GASTO_PAGADO_NO_POSTERGABLE" });
        });

        it("no deja crear un gasto con más de 360 cuotas", async () => {
            await expect(crear({ number_of_quotas: 361, postponed: false })).rejects.toMatchObject({
                code: "VALIDATION_ERROR",
                status: 400,
                message: "El máximo es de 360 cuotas.",
                details: { field: "number_of_quotas" },
            });
            expect(entidadesFinancierasRepository.getById).not.toHaveBeenCalled();
        });

        it("360 cuotas pasa la validación y sigue con la creación", async () => {
            await crear({ number_of_quotas: 360, postponed: false }).catch(() => {});
            expect(entidadesFinancierasRepository.getById).toHaveBeenCalledWith(7, OWNER);
        });

        it("el máximo de cuotas no aplica a un gasto fijo", async () => {
            await crear({ number_of_quotas: 361, fixed_expense: true, postponed: false }).catch(() => {});
            expect(entidadesFinancierasRepository.getById).toHaveBeenCalled();
        });

        it("no deja postergar un gasto con todas sus cuotas pagas", async () => {
            gasto = makeGasto({ number_of_quotas: 3, payed_quotas: 3 });

            await expect(service.postergarGasto(10, OWNER, true)).rejects.toMatchObject({ code: "GASTO_PAGADO_NO_POSTERGABLE", status: 409 });
            expect(gastosRepository.setPostponed).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
        });

        it("deja quitar la postergación de un gasto ya pagado", async () => {
            gasto = makeGasto({ number_of_quotas: 3, payed_quotas: 3, is_postponed: true });

            await expect(service.postergarGasto(10, OWNER, false)).resolves.toBeDefined();
            expect(gastosRepository.setPostponed).toHaveBeenCalledWith(10, false);
        });

        it("deja postergar un gasto con cuotas pendientes", async () => {
            await expect(service.postergarGasto(10, OWNER, true)).resolves.toBeDefined();
            expect(gastosRepository.setPostponed).toHaveBeenCalledWith(10, true);
        });

        it("registra la postergación en el historial del gasto y de la entidad", async () => {
            await service.postergarGasto(10, OWNER, true);

            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(10, "POSTPONED");
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(7, "POSTPONED", 'Postergación agregada: "Netflix"');
        });

        it("no escribe nada si el gasto ya estaba en ese estado", async () => {
            gasto = makeGasto({ is_postponed: true });

            await expect(service.postergarGasto(10, OWNER, true)).resolves.toMatchObject({ id: 10 });
            expect(gastosRepository.setPostponed).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
            expect(movementsRepository.createEntidadLog).not.toHaveBeenCalled();
        });

        it("si falla el historial de la entidad, la postergación se mantiene", async () => {
            movementsRepository.createEntidadLog.mockRejectedValueOnce(new Error("db caída"));

            await expect(service.postergarGasto(10, OWNER, true)).resolves.toBeDefined();
            expect(gastosRepository.setPostponed).toHaveBeenCalledWith(10, true);
        });

        it("un gasto fijo se puede postergar aunque tenga pagos", async () => {
            gasto = makeGasto({ fixed_expense: true, number_of_quotas: 1, payed_quotas: 5 });

            await expect(service.postergarGasto(10, OWNER, true)).resolves.toBeDefined();
        });
    });

    describe("update", () => {
        const rejectsLocked = async (input, field) => {
            await expect(service.update(10, OWNER, input)).rejects.toMatchObject({
                code: "GASTO_CAMPO_NO_EDITABLE",
                status: 409,
                details: { field },
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        };

        it("conserva los campos que no vienen en el pedido (imagen, moneda, cuotas, entidad)", async () => {
            await service.update(10, OWNER, { name: "Netflix 4K" });

            expect(gastosRepository.update).toHaveBeenCalledWith(10, expect.objectContaining({
                name: "Netflix 4K",
                amount: 300,
                type: "EGRESO",
                currency_type: "ARS",
                image_url: "img.png",
                number_of_quotas: 3,
                financial_entity_id: 7,
                fixed_expense: false,
            }));
        });

        it("sin pagos deja cambiar moneda, tipo, modo y cuotas", async () => {
            gasto = makeGasto({ payed_quotas: 0 });

            await service.update(10, OWNER, { currency_type: "usd", type: "ingreso", number_of_quotas: 1 });

            expect(gastosRepository.update).toHaveBeenCalledWith(10, expect.objectContaining({
                currency_type: "USD",
                type: "INGRESO",
                number_of_quotas: 1,
            }));
        });

        it.each([
            [{ name: "  " }, "name"],
            [{ amount: -5 }, "amount"],
            [{ amount: "abc" }, "amount"],
            [{ amount: 0 }, "amount"],
            [{ type: "OTRO" }, "type"],
            [{ currency_type: "XXX" }, "currency_type"],
            [{ number_of_quotas: 1.5 }, "number_of_quotas"],
            [{ number_of_quotas: 361 }, "number_of_quotas"],
            [{ number_of_quotas: 0 }, "number_of_quotas"],
            [{ number_of_quotas: -1 }, "number_of_quotas"],
        ])("rechaza %o con VALIDATION_ERROR sin modificar nada", async (input, field) => {
            await expect(service.update(10, OWNER, input)).rejects.toMatchObject({
                code: "VALIDATION_ERROR",
                status: 400,
                details: { field },
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });

        it("las cuotas pagadas no se editan: se pagan o se revierten", async () => {
            await rejectsLocked({ payed_quotas: 2 }, "payed_quotas");
        });

        it("acepta payed_quotas si llega con el mismo valor (clientes que mandan todo)", async () => {
            await service.update(10, OWNER, { name: "Otro", payed_quotas: 1 });

            expect(gastosRepository.update).toHaveBeenCalled();
            expect(movementsRepository.revertPaymentsByIds).not.toHaveBeenCalled();
        });

        describe("con pagos registrados", () => {
            it("no deja cambiar la moneda", () => rejectsLocked({ currency_type: "USD" }, "currency_type"));
            it("no deja cambiar el tipo", () => rejectsLocked({ type: "INGRESO" }, "type"));
            it("no deja pasar de cuotas a pago único", () => rejectsLocked({ number_of_quotas: 1 }, "mode"));
            it("no deja pasar a fijo", () => rejectsLocked({ fixed_expense: true }, "mode"));

            it("los pagos pendientes de un compartido también cuentan", async () => {
                gasto = makeGasto({ payed_quotas: 0, pending_quotas: 1 });
                await rejectsLocked({ currency_type: "USD" }, "currency_type");
            });

            it("deja cambiar monto y cantidad de cuotas", async () => {
                await service.update(10, OWNER, { amount: 900, number_of_quotas: 6 });

                expect(gastosRepository.update).toHaveBeenCalledWith(10, expect.objectContaining({
                    amount: 900,
                    number_of_quotas: 6,
                }));
            });

            it("no deja bajar las cuotas por debajo de las pagadas", async () => {
                gasto = makeGasto({ number_of_quotas: 6, payed_quotas: 3 });

                await expect(service.update(10, OWNER, { number_of_quotas: 2 })).rejects.toMatchObject({
                    code: "VALIDATION_ERROR",
                    details: { field: "number_of_quotas" },
                });
            });
        });

        describe("gasto finalizado", () => {
            beforeEach(() => {
                gasto = makeGasto({ number_of_quotas: 3, payed_quotas: 3 });
            });

            it("no deja cambiar el monto", () => rejectsLocked({ amount: 1 }, "amount"));
            it("no deja cambiar la entidad", () => rejectsLocked({ financial_entity_id: 8 }, "financial_entity_id"));

            it("deja cambiar nombre y categorías", async () => {
                await service.update(10, OWNER, { name: "Otro", category_ids: [1] });
                expect(gastosRepository.update).toHaveBeenCalled();
            });
        });

        describe("gasto compartido con otro usuario", () => {
            beforeEach(() => {
                gasto = makeGasto({ payed_quotas: 0 });
                gastosRepository.getSharedSibling.mockResolvedValue([{ sibling_id: 50, counterparty_user_id: 3 }]);
            });

            it("no deja cambiar el monto", () => rejectsLocked({ amount: 1 }, "amount"));
            it("no deja cambiar las cuotas", () => rejectsLocked({ number_of_quotas: 6 }, "number_of_quotas"));

            it("no deja cambiar el nombre sin aprobación", () => rejectsLocked({ name: "Otro" }, "name"));

            it("acepta el mismo nombre", async () => {
                await service.update(10, OWNER, { name: "Netflix", category_ids: [1] });
                expect(gastosRepository.update).toHaveBeenCalled();
            });
        });

        it("deja renombrar una copia que ya no tiene contraparte", async () => {
            gasto = makeGasto({ payed_quotas: 0, shared_from_id: 9 });

            await service.update(10, OWNER, { name: "Otro" });

            expect(gastosRepository.update).toHaveBeenCalled();
        });

        describe("gasto marcado en la sesión de cuentas abierta", () => {
            beforeEach(() => {
                gasto = makeGasto({ payed_quotas: 0 });
                settlementRepository.getOpenSession.mockResolvedValue({ id: 5 });
                settlementRepository.hasItem.mockResolvedValue(true);
            });

            it("no deja cambiar el monto", () => rejectsLocked({ amount: 1 }, "amount"));
            it("no deja cambiar la moneda", () => rejectsLocked({ currency_type: "USD" }, "currency_type"));

            it("deja cambiar las cuotas", async () => {
                await service.update(10, OWNER, { number_of_quotas: 6 });
                expect(gastosRepository.update).toHaveBeenCalled();
            });
        });

        it("getById devuelve los bloqueos para que los clientes deshabiliten los campos", async () => {
            const detalle = await service.getById(10, OWNER);

            expect(detalle.edit_locks).toMatchObject({
                payed_quotas: expect.any(String),
                currency_type: "El gasto ya tiene pagos registrados.",
                type: "El gasto ya tiene pagos registrados.",
                mode: "El gasto ya tiene pagos registrados.",
            });
            expect(detalle.edit_locks).not.toHaveProperty("amount");
            expect(detalle.edit_locks).not.toHaveProperty("name");
        });

        it("mueve el gasto a otra entidad del usuario y lo registra en las dos", async () => {
            entidadesFinancierasRepository.getById.mockImplementation(async (entidadId, userId) =>
                userId === OWNER && [7, 8].includes(Number(entidadId))
                    ? [{ id: Number(entidadId), name: `Entidad ${entidadId}`, linked_user_id: null }]
                    : [],
            );

            await service.update(10, OWNER, { financial_entity_id: 8 });

            expect(gastosRepository.update).toHaveBeenCalledWith(10, expect.objectContaining({ financial_entity_id: 8 }));
            const entidades = movementsRepository.createEntidadLog.mock.calls.map(([id]) => id);
            expect(entidades).toEqual(expect.arrayContaining([7, 8]));
        });

        it("rechaza mover el gasto a una entidad ajena", async () => {
            await expect(service.update(10, OWNER, { financial_entity_id: 99 })).rejects.toMatchObject({
                code: "ENTIDAD_FINANCIERA_NOT_FOUND",
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });

        it("rechaza mover el gasto a una entidad compartida con otro usuario", async () => {
            entidadesFinancierasRepository.getById.mockImplementation(async (entidadId, userId) =>
                userId === OWNER && [7, 8].includes(Number(entidadId))
                    ? [{ id: Number(entidadId), name: "E", linked_user_id: Number(entidadId) === 8 ? 3 : null }]
                    : [],
            );

            await expect(service.update(10, OWNER, { financial_entity_id: 8 })).rejects.toMatchObject({
                code: "GASTO_ENTIDAD_NO_EDITABLE",
                status: 409,
            });
            expect(gastosRepository.update).not.toHaveBeenCalled();
        });

        it("devuelve el detalle completo para que los clientes no tengan que volver a pedirlo", async () => {
            movementsRepository.getMovementsByGasto.mockResolvedValue([{ id: 1, movement_type: "EDITED" }]);
            categoriasRepository.getCategoriasByGasto.mockResolvedValue([{ id: 1, name: "Casa" }]);

            const detalle = await service.update(10, OWNER, { name: "Otro" });

            expect(detalle.movements).toEqual([{ id: 1, movement_type: "EDITED" }]);
            expect(detalle.categories).toEqual([{ id: 1, name: "Casa" }]);
            expect(detalle.edit_locks).toMatchObject({ payed_quotas: expect.any(String) });
        });

        it("suma al historial los pagos recibidos de la otra persona, ordenados por fecha", async () => {
            gasto = makeGasto({ status: "ACTIVE" });
            gastosRepository.getById.mockImplementation(async () => [gasto]);
            gastosRepository.getSharedSibling.mockResolvedValue([
                { sibling_id: 20, counterparty_user_id: 2, counterparty_name: "María", sibling_status: "ACTIVE" },
            ]);
            movementsRepository.getMovementsByGasto.mockResolvedValue([
                { id: 3, movement_type: "EDITED", created_at: "2026-11-03T10:00:00" },
                { id: 1, movement_type: "CREATION", created_at: "2026-11-01T10:00:00" },
            ]);
            movementsRepository.getReceivedPayments.mockResolvedValue([
                { id: 40, movement_type: "PAYMENT_RECEIVED", created_at: "2026-11-02T10:00:00" },
            ]);

            const detalle = await service.getById(10, OWNER);

            expect(movementsRepository.getReceivedPayments).toHaveBeenCalledWith(20, OWNER, true);
            expect(detalle.movements.map((m) => m.id)).toEqual([3, 40, 1]);
        });

        it("muestra el evento de compartido después de la creación y sin la línea vieja", async () => {
            gastosRepository.getSharedState.mockResolvedValue([{ was_shared: true, sibling_id: 20 }]);
            movementsRepository.getMovementsByGasto.mockResolvedValue([
                { id: 3, movement_type: "EDITED", detail: "Compartido con María", created_at: "2026-11-02T10:00:00" },
                { id: 1, movement_type: "CREATION", created_at: "2026-11-01T10:00:00" },
            ]);
            movementsRepository.getSharedSentEvent.mockResolvedValue([
                { id: -9, movement_type: "SHARED_SENT", created_at: "2026-11-01T10:00:00" },
            ]);

            const detalle = await service.getById(10, OWNER);

            expect(detalle.movements.map((m) => m.id)).toEqual([-9, 1]);
        });

        it("no busca pagos recibidos en un gasto sin contraparte", async () => {
            await service.getById(10, OWNER);

            expect(movementsRepository.getReceivedPayments).not.toHaveBeenCalled();
        });

        it("no reescribe las categorías si no cambiaron", async () => {
            categoriasRepository.getCategoriasByGasto.mockResolvedValue([{ id: 2 }, { id: 1 }]);

            await service.update(10, OWNER, { name: "Otro", category_ids: [1, 2] });

            expect(categoriasRepository.setCategoriasForGasto).not.toHaveBeenCalled();
        });

        it("responde GASTO_NOT_FOUND si el UPDATE no afecta ninguna fila", async () => {
            gastosRepository.update.mockResolvedValue([]);

            await expect(service.update(10, OWNER, { name: "Otro" })).rejects.toMatchObject({
                code: "GASTO_NOT_FOUND",
            });
        });

        it("el historial nombra bien la frecuencia de un pago único", async () => {
            gasto = makeGasto({ number_of_quotas: 1, payed_quotas: 0 });

            await service.update(10, OWNER, { fixed_expense: true });

            const edited = movementsRepository.createGastoLog.mock.calls.find(([, type]) => type === "EDITED");
            expect(edited[5]).toContain("Frecuencia: Pago único → Fijo");
        });

        describe("con apply_to_linked", () => {
            let mirror;
            beforeEach(() => {
                mirror = makeGasto({ id: 20, financial_entity_id: 9, type: "INGRESO", linked_purchase_id: 10 });
                gasto = makeGasto({ linked_purchase_id: 20, linked_financial_entity_id: 9 });
                gastosRepository.getById.mockImplementation(async (id) => [Number(id) === 20 ? mirror : gasto]);
            });

            it("aplica los cambios al espejo con el tipo opuesto y en su entidad", async () => {
                await service.update(10, OWNER, { name: "Compartido", amount: 600, apply_to_linked: true });

                expect(gastosRepository.update).toHaveBeenCalledWith(20, expect.objectContaining({
                    name: "Compartido",
                    amount: 600,
                    type: "INGRESO",
                    financial_entity_id: 9,
                }));
                const editedIds = movementsRepository.createGastoLog.mock.calls
                    .filter(([, type]) => type === "EDITED")
                    .map(([id]) => id);
                expect(editedIds).toEqual([10, 20]);
            });

            it("respeta los bloqueos del espejo", async () => {
                gasto = makeGasto({ payed_quotas: 0, linked_purchase_id: 20, linked_financial_entity_id: 9 });

                await expect(
                    service.update(10, OWNER, { currency_type: "USD", apply_to_linked: true }),
                ).rejects.toMatchObject({
                    code: "GASTO_CAMPO_NO_EDITABLE",
                    message: expect.stringContaining("Movimiento vinculado"),
                });
            });
        });
    });
});
