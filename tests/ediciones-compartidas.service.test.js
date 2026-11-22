import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));
vi.mock("../db.js", () => ({ withTransaction: (fn) => fn(), bestEffort: (fn) => fn() }));

const { EdicionesCompartidasService, normalizarCambios } = await import(
    "../services/ediciones-compartidas.service.js"
);
const { triggerCompartidos } = await import("../utils/pusher.js");
const { PusherEvent } = await import("../utils/enums.js");

const EMISOR = 1;
const RECEPTOR = 2;
const base = {
    name: "Cena",
    amount: 1000,
    currency_type: "ARS",
    type: "EGRESO",
    fixed_expense: false,
    number_of_quotas: 2,
    payed_quotas: 0,
    pending_quotas: 0,
    status: "ACTIVE",
    financial_entity_id: 7,
};
const GASTO = { ...base, id: 10 };
const COPIA = { ...base, id: 20, shared_from_id: 10, financial_entity_id: 8 };
const PENDIENTE = {
    id: 5,
    purchase_id: 10,
    sibling_purchase_id: 20,
    requested_by_user_id: EMISOR,
    counterparty_user_id: RECEPTOR,
    changes: { amount: 1500 },
    status: "PENDING",
};

describe("EdicionesCompartidasService", () => {
    let edicionesRepository;
    let gastosRepository;
    let movementsRepository;
    let settlementRepository;
    let service;

    beforeEach(() => {
        vi.clearAllMocks();
        edicionesRepository = {
            getById: vi.fn(async () => [PENDIENTE]),
            getPendingByPurchase: vi.fn(async () => []),
            create: vi.fn(async ({ changes }) => [{ ...PENDIENTE, changes }]),
            resolve: vi.fn(async (id, status) => [{ ...PENDIENTE, status }]),
            getPendingForUser: vi.fn(async () => []),
        };
        gastosRepository = {
            getByIdsWithOwner: vi.fn(async () => [{ ...GASTO, owned: true }]),
            getSharedSibling: vi.fn(async () => [{ sibling_id: 20, counterparty_user_id: RECEPTOR }]),
            lockPurchases: vi.fn(),
            getById: vi.fn(async (id) => [Number(id) === 10 ? GASTO : COPIA]),
            update: vi.fn(async (id) => [{ id }]),
            getUserName: vi.fn(async () => [{ name: "Ana" }]),
        };
        movementsRepository = { createGastoLog: vi.fn(), createEntidadLog: vi.fn() };
        settlementRepository = { getOpenSession: vi.fn(async () => null), hasItem: vi.fn(async () => false) };
        service = new EdicionesCompartidasService({
            edicionesRepository,
            gastosRepository,
            movementsRepository,
            settlementRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("normalizarCambios devuelve solo lo que cambia", () => {
        expect(normalizarCambios({ amount: 1000, number_of_quotas: 3 }, GASTO)).toEqual({ number_of_quotas: 3 });
    });

    it("solicitar no modifica el gasto, registra en ambos y avisa a la otra persona", async () => {
        await service.solicitar(10, EMISOR, { amount: 1500 });

        expect(gastosRepository.update).not.toHaveBeenCalled();
        expect(movementsRepository.createGastoLog).toHaveBeenCalledTimes(2);
        expect(triggerCompartidos).toHaveBeenCalledWith(
            RECEPTOR,
            PusherEvent.EDICION_SOLICITADA,
            expect.objectContaining({ purchaseId: 20 }),
        );
    });

    it("no permite dos solicitudes pendientes", async () => {
        edicionesRepository.getPendingByPurchase.mockResolvedValue([PENDIENTE]);

        await expect(service.solicitar(10, EMISOR, { amount: 1500 })).rejects.toMatchObject({
            code: "EDICION_YA_SOLICITADA",
        });
    });

    it("rechaza una solicitud sin cambios", async () => {
        await expect(service.solicitar(10, EMISOR, { amount: 1000 })).rejects.toMatchObject({
            code: "EDICION_SIN_CAMBIOS",
        });
    });

    it("no permite cambiar la moneda si la copia ya tiene pagos", async () => {
        gastosRepository.getById.mockImplementation(async (id) => [
            Number(id) === 10 ? GASTO : { ...COPIA, payed_quotas: 1 },
        ]);

        await expect(service.solicitar(10, EMISOR, { currency_type: "USD" })).rejects.toMatchObject({
            code: "GASTO_CAMPO_NO_EDITABLE",
        });
    });

    it("al aprobar aplica el cambio a los dos gastos conservando la entidad de cada uno", async () => {
        await service.aprobar(5, RECEPTOR);

        expect(gastosRepository.update).toHaveBeenCalledWith(
            10,
            expect.objectContaining({ amount: 1500, financial_entity_id: 7 }),
        );
        expect(gastosRepository.update).toHaveBeenCalledWith(
            20,
            expect.objectContaining({ amount: 1500, financial_entity_id: 8 }),
        );
        expect(edicionesRepository.resolve).toHaveBeenCalledWith(5, "APPROVED", RECEPTOR);
    });

    it("pide el cambio de nombre sin modificar el gasto", async () => {
        const result = await service.solicitar(10, EMISOR, { name: "  Almuerzo  " });

        expect(result.changes).toEqual({ name: "Almuerzo" });
        expect(gastosRepository.update).not.toHaveBeenCalled();
        expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
            10,
            "EDIT_REQUESTED",
            null,
            null,
            EMISOR,
            'Nombre: "Cena" → "Almuerzo"',
        );
    });

    it("rechaza un nombre vacío y no cuenta espacios como cambio", async () => {
        await expect(service.solicitar(10, EMISOR, { name: "   " })).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
        });
        await expect(service.solicitar(10, EMISOR, { name: " Cena " })).rejects.toMatchObject({
            code: "EDICION_SIN_CAMBIOS",
        });
    });

    it("al aprobar un nombre lo aplica a los dos y lo registra en cada entidad", async () => {
        edicionesRepository.getById.mockResolvedValue([{ ...PENDIENTE, changes: { name: "Almuerzo" } }]);

        await service.aprobar(5, RECEPTOR);

        expect(gastosRepository.update).toHaveBeenCalledWith(10, expect.objectContaining({ name: "Almuerzo" }));
        expect(gastosRepository.update).toHaveBeenCalledWith(20, expect.objectContaining({ name: "Almuerzo" }));
        for (const entidad of [7, 8]) {
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                entidad,
                "EDITED",
                'Gasto renombrado: "Cena" → "Almuerzo"',
            );
        }
    });

    it("quien pidió la edición no puede aprobarla, pero sí cancelarla", async () => {
        await expect(service.aprobar(5, EMISOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });

        await service.cancelar(5, EMISOR);

        expect(edicionesRepository.resolve).toHaveBeenCalledWith(5, "CANCELLED", EMISOR);
    });

    it("al rechazar no modifica ningún gasto", async () => {
        await service.rechazar(5, RECEPTOR);

        expect(gastosRepository.update).not.toHaveBeenCalled();
        expect(edicionesRepository.resolve).toHaveBeenCalledWith(5, "REJECTED", RECEPTOR);
    });
});
