import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));

import { GastosService } from "../services/gastos.service.js";

const OWNER = 1;
const INTRUSO = 2;

// Gasto en cuotas de la entidad 7, que es del usuario OWNER.
function makeGasto(overrides = {}) {
    return {
        id: 10,
        name: "Netflix",
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
            // Los gastos 10 y 11 son de OWNER; cualquier otro, no.
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
            clearFavoriteIfFinalized: vi.fn(),
        };
        movementsRepository = {
            getMovementsByGasto: vi.fn(async () => []),
            createGastoLog: vi.fn(),
            createEntidadLog: vi.fn(),
            deletePayments: vi.fn(),
            deleteLastPayment: vi.fn(async () => [{ amount: 100 }]),
        };
        // La entidad 7 solo existe para OWNER.
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
        };

        service = new GastosService({
            gastosRepository,
            movementsRepository,
            entidadesFinancierasRepository,
            categoriasRepository,
            settlementRepository,
        });
    });

    // ─── Verificación de dueño ────────────────────────────────────────────────

    describe("verificación de dueño", () => {
        const operaciones = {
            getById: (userId) => service.getById(10, userId),
            update: (userId) => service.update(10, userId, "Otro", 500, null, false, "EGRESO", [1], 0),
            delete: (userId) => service.delete(10, userId),
            restaurar: (userId) => service.restaurar(10, userId),
            postergarGasto: (userId) => service.postergarGasto(10, userId, true),
            marcarFavorito: (userId) => service.marcarFavorito(10, userId, true),
            actualizarCategorias: (userId) => service.actualizarCategorias(10, userId, [1]),
            settleQuota: (userId) => service.settleQuota(10, userId),
            "settleQuota directo": (userId) => service.settleQuota(10, userId, { direct: true }),
            refundCuota: (userId) => service.refundCuota(10, userId),
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
                expect(movementsRepository.deleteLastPayment).not.toHaveBeenCalled();
                expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
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
            expect(settlementRepository.upsertItem).not.toHaveBeenCalled();
        });
    });

    // ─── assertOwnedAll ───────────────────────────────────────────────────────

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

    // ─── Cuotas restantes ─────────────────────────────────────────────────────

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
});
