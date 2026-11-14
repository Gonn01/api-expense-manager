import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));
vi.mock("../db.js", () => ({ withTransaction: (fn) => fn(), bestEffort: (fn) => fn() }));

const { CompartidosService } = await import("../services/compartidos.service.js");

const RECEPTOR = 1;
const EMISOR = 2;
const GASTO = { id: 30, name: "Cena", status: "PENDING_APPROVAL", receiver_user_id: RECEPTOR, shared_from_id: 20 };

describe("CompartidosService.aprobar: vínculo con el emisor", () => {
    let gastosRepository;
    let entidadesFinancierasRepository;
    let movementsRepository;
    let service;

    const entidad = (linked_user_id) => [{ id: 7, user_id: RECEPTOR, linked_user_id }];

    beforeEach(() => {
        gastosRepository = {
            getById: vi.fn(async () => [GASTO]),
            getEntityOwnerByPurchaseId: vi.fn(async () => [{ user_id: EMISOR }]),
            aprobarGasto: vi.fn(async () => [{ ...GASTO, financial_entity_id: 7 }]),
            getApprovalNotificationData: vi.fn(async () => []),
            updateStatus: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Juan" }]),
        };
        entidadesFinancierasRepository = {
            create: vi.fn(async () => [{ id: 9 }]),
            getById: vi.fn(async () => entidad(null)),
            findByLinkedUser: vi.fn(async () => []),
            vincularUsuario: vi.fn(),
        };
        movementsRepository = { createEntidadLog: vi.fn(), createGastoLog: vi.fn() };
        service = new CompartidosService({
            gastosRepository,
            entidadesFinancierasRepository,
            movementsRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("vincula al emisor una entidad existente sin vínculo", async () => {
        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledWith(7, RECEPTOR, EMISOR);
        expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(7, "LINK", expect.stringContaining("Juan"));
    });

    it("no toca una entidad ya vinculada", async () => {
        entidadesFinancierasRepository.getById.mockResolvedValue(entidad(EMISOR));

        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(entidadesFinancierasRepository.vincularUsuario).not.toHaveBeenCalled();
    });

    it("no vincula si otra entidad ya está vinculada al emisor", async () => {
        entidadesFinancierasRepository.findByLinkedUser.mockResolvedValue([{ id: 8, name: "Juan" }]);

        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(entidadesFinancierasRepository.vincularUsuario).not.toHaveBeenCalled();
    });

    it("vincula la entidad nueva una sola vez", async () => {
        entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 9, user_id: RECEPTOR, linked_user_id: EMISOR }]);

        await service.aprobar(GASTO.id, RECEPTOR, null, "Juan");

        expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledTimes(1);
        expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledWith(9, RECEPTOR, EMISOR);
    });
});

describe("CompartidosService.confirmarPago: pago registrado también en la copia", () => {
    const PEND = { id: 50, purchase_id: 20, amount: 100, payment_date: "2026-11-01", created_by_user_id: EMISOR };
    const COPIA = { id: 30, fixed_expense: false, payed_quotas: 1, number_of_quotas: 3, amount_per_quota: 100 };

    let gastosRepository;
    let movementsRepository;
    let service;

    beforeEach(() => {
        gastosRepository = {
            getSharedSibling: vi.fn(async () => [{ sibling_id: COPIA.id, counterparty_user_id: RECEPTOR }]),
            getById: vi.fn(async () => [COPIA]),
            clearFavoriteIfFinalized: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Ana" }]),
        };
        movementsRepository = {
            getPendingPaymentById: vi.fn(async () => [PEND]),
            confirmPendingPayment: vi.fn(async () => [{ ...PEND, movement_type: "PAYMENT" }]),
            createGastoLog: vi.fn(),
        };
        service = new CompartidosService({
            gastosRepository,
            entidadesFinancierasRepository: {},
            movementsRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("registra el pago también en la copia de la contraparte", async () => {
        await service.confirmarPago(PEND.id, RECEPTOR);

        expect(movementsRepository.confirmPendingPayment).toHaveBeenCalledWith(PEND.id);
        expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
            COPIA.id,
            "PAYMENT",
            COPIA.amount_per_quota,
            PEND.payment_date,
            EMISOR,
            expect.any(String),
        );
        expect(gastosRepository.clearFavoriteIfFinalized).toHaveBeenCalledWith(COPIA.id);
    });

    it("no registra el pago en la copia si la copia ya está saldada", async () => {
        gastosRepository.getById.mockResolvedValue([{ ...COPIA, payed_quotas: 3 }]);

        await service.confirmarPago(PEND.id, RECEPTOR);

        expect(movementsRepository.confirmPendingPayment).toHaveBeenCalled();
        expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
    });

    it("en un gasto fijo la copia siempre recibe el pago", async () => {
        gastosRepository.getById.mockResolvedValue([{ ...COPIA, fixed_expense: true, payed_quotas: 9, number_of_quotas: 1 }]);

        await service.confirmarPago(PEND.id, RECEPTOR);

        expect(movementsRepository.createGastoLog).toHaveBeenCalled();
    });
});
