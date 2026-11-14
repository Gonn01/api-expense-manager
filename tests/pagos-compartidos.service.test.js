import { describe, it, expect, vi, beforeEach } from "vitest";
import { PusherEvent } from "../utils/enums.js";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));
vi.mock("../db.js", () => ({ withTransaction: (fn) => fn(), bestEffort: (fn) => fn() }));

const { triggerCompartidos } = await import("../utils/pusher.js");
const { PagosCompartidosService } = await import("../services/pagos-compartidos.service.js");

const RECEPTOR = 1;
const EMISOR = 2;
const AJENO = 3;
const PEND = { id: 50, purchase_id: 20, amount: 100, payment_date: "2026-11-01", created_by_user_id: EMISOR };
const COPIA = { id: 30, fixed_expense: false, payed_quotas: 1, number_of_quotas: 3, amount_per_quota: 100 };

describe("PagosCompartidosService", () => {
    let gastosRepository;
    let movementsRepository;
    let settlementRepository;
    let service;

    beforeEach(() => {
        vi.mocked(triggerCompartidos).mockClear();
        gastosRepository = {
            getSharedSibling: vi.fn(async (purchaseId) =>
                String(purchaseId) === "20"
                    ? [{ sibling_id: COPIA.id, counterparty_user_id: RECEPTOR }]
                    : [{ sibling_id: 20, counterparty_user_id: EMISOR }],
            ),
            getById: vi.fn(async () => [COPIA]),
            getByIdsWithOwner: vi.fn(async ([id], userId) => [
                { id: Number(id), owned: (String(id) === "20" && userId === EMISOR) || (String(id) === "30" && userId === RECEPTOR) },
            ]),
            getEntityOwnerByPurchaseId: vi.fn(async (id) => [{ user_id: String(id) === "20" ? EMISOR : RECEPTOR }]),
            clearFavoriteIfFinalized: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Ana" }]),
            lockPurchases: vi.fn(),
        };
        movementsRepository = {
            getPendingPaymentById: vi.fn(async () => [PEND]),
            confirmPendingPayment: vi.fn(async () => [{ ...PEND, movement_type: "PAYMENT" }]),
            closePendingPayment: vi.fn(async (id, type) => [{ ...PEND, id, movement_type: type }]),
            createGastoLog: vi.fn(async (purchaseId, type) => [{ id: 60, purchase_id: purchaseId, movement_type: type }]),
            setPairedMovement: vi.fn(),
            getPendingPaymentsByPurchases: vi.fn(async () => [PEND]),
            getPaymentById: vi.fn(async () => [
                { id: 50, purchase_id: 20, movement_type: "PAYMENT", paired_movement_id: 60, reversal_requested_by_user_id: null },
            ]),
            setReversalRequest: vi.fn(async (ids) => ids.map((id) => ({ id }))),
            clearReversalRequest: vi.fn(async (ids) => ids.map((id) => ({ id }))),
            deletePaymentsByIds: vi.fn(async (ids) =>
                ids.map((id) => ({ id, purchase_id: id === 50 ? 20 : 30, amount: 100 })),
            ),
        };
        settlementRepository = {
            getOpenSession: vi.fn(async () => null),
            removeItem: vi.fn(),
        };
        service = new PagosCompartidosService({
            gastosRepository,
            movementsRepository,
            settlementRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    describe("confirmar", () => {
        it("registra el pago también en la copia de la contraparte y los vincula", async () => {
            await service.confirmar(PEND.id, RECEPTOR);

            expect(movementsRepository.confirmPendingPayment).toHaveBeenCalledWith(PEND.id);
            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(
                COPIA.id,
                "PAYMENT",
                COPIA.amount_per_quota,
                PEND.payment_date,
                EMISOR,
                expect.any(String),
            );
            expect(movementsRepository.setPairedMovement).toHaveBeenCalledWith(PEND.id, 60);
            expect(movementsRepository.setPairedMovement).toHaveBeenCalledWith(60, PEND.id);
            expect(gastosRepository.clearFavoriteIfFinalized).toHaveBeenCalledWith(COPIA.id);
            expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, PusherEvent.PAGO_CONFIRMADO, expect.any(Object));
        });

        it("no registra el pago en la copia si ya está saldada", async () => {
            gastosRepository.getById.mockResolvedValue([{ ...COPIA, payed_quotas: 3 }]);

            await service.confirmar(PEND.id, RECEPTOR);

            expect(movementsRepository.confirmPendingPayment).toHaveBeenCalled();
            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
            expect(movementsRepository.setPairedMovement).not.toHaveBeenCalled();
        });

        it("en un gasto fijo la copia siempre recibe el pago", async () => {
            gastosRepository.getById.mockResolvedValue([{ ...COPIA, fixed_expense: true, payed_quotas: 9, number_of_quotas: 1 }]);

            await service.confirmar(PEND.id, RECEPTOR);

            expect(movementsRepository.createGastoLog).toHaveBeenCalled();
        });

        it("saca la copia de la sesión abierta de quien confirma", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 8 });

            await service.confirmar(PEND.id, RECEPTOR);

            expect(settlementRepository.removeItem).toHaveBeenCalledWith(8, COPIA.id);
        });

        it("quien registró el pago no puede confirmarlo", async () => {
            await expect(service.confirmar(PEND.id, EMISOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            expect(movementsRepository.confirmPendingPayment).not.toHaveBeenCalled();
        });
    });

    describe("rechazar", () => {
        it("marca el pago como rechazado sin borrarlo y desmarca la copia", async () => {
            settlementRepository.getOpenSession.mockResolvedValue({ id: 8 });

            await service.rechazar(PEND.id, RECEPTOR);

            expect(movementsRepository.closePendingPayment).toHaveBeenCalledWith(PEND.id, "PAYMENT_REJECTED");
            expect(settlementRepository.removeItem).toHaveBeenCalledWith(8, COPIA.id);
            expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, PusherEvent.PAGO_RECHAZADO, expect.any(Object));
        });
    });

    describe("retirar", () => {
        it("quien registró el pago lo retira y se avisa a la contraparte", async () => {
            await service.retirar(PEND.id, EMISOR);

            expect(movementsRepository.closePendingPayment).toHaveBeenCalledWith(PEND.id, "PAYMENT_WITHDRAWN");
            expect(triggerCompartidos).toHaveBeenCalledWith(RECEPTOR, PusherEvent.PAGO_RETIRADO, expect.any(Object));
        });

        it("la contraparte no puede retirarlo", async () => {
            await expect(service.retirar(PEND.id, RECEPTOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            expect(movementsRepository.closePendingPayment).not.toHaveBeenCalled();
        });
    });

    describe("rechazarPendientesDeContraparte", () => {
        it("rechaza los pendientes de la otra persona y le avisa", async () => {
            const rejected = await service.rechazarPendientesDeContraparte(COPIA.id, RECEPTOR);

            expect(movementsRepository.getPendingPaymentsByPurchases).toHaveBeenCalledWith([20]);
            expect(movementsRepository.closePendingPayment).toHaveBeenCalledWith(PEND.id, "PAYMENT_REJECTED");
            expect(rejected).toHaveLength(1);
            expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, PusherEvent.PAGO_RECHAZADO, expect.any(Object));
        });
    });

    describe("reversión de un pago confirmado", () => {
        it("cualquiera de las dos partes puede pedirla y queda en los dos movimientos", async () => {
            await service.solicitarReversion(50, EMISOR);

            expect(movementsRepository.setReversalRequest).toHaveBeenCalledWith([50, 60], EMISOR);
            expect(triggerCompartidos).toHaveBeenCalledWith(RECEPTOR, PusherEvent.PAGO_REVERSION_SOLICITADA, expect.any(Object));
        });

        it("no se puede pedir dos veces", async () => {
            movementsRepository.getPaymentById.mockResolvedValue([
                { id: 50, purchase_id: 20, movement_type: "PAYMENT", paired_movement_id: 60, reversal_requested_by_user_id: EMISOR },
            ]);

            await expect(service.solicitarReversion(50, EMISOR)).rejects.toMatchObject({ code: "REVERSION_YA_SOLICITADA" });
        });

        it("alguien ajeno al gasto no puede pedirla", async () => {
            gastosRepository.getByIdsWithOwner.mockResolvedValue([{ id: 20, owned: false }]);

            await expect(service.solicitarReversion(50, AJENO)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
        });

        describe("con una solicitud pendiente", () => {
            beforeEach(() => {
                movementsRepository.getPaymentById.mockResolvedValue([
                    { id: 50, purchase_id: 20, movement_type: "PAYMENT", paired_movement_id: 60, reversal_requested_by_user_id: EMISOR },
                ]);
            });

            it("la otra persona la acepta: se eliminan los dos pagos y queda el reembolso en ambos gastos", async () => {
                await service.aceptarReversion(50, RECEPTOR);

                expect(movementsRepository.deletePaymentsByIds).toHaveBeenCalledWith([50, 60]);
                expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(20, "REFUND", 100, expect.any(Date), null, expect.any(String));
                expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(30, "REFUND", 100, expect.any(Date), null, expect.any(String));
                expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, PusherEvent.PAGO_REVERSION_ACEPTADA, expect.any(Object));
            });

            it("la otra persona la rechaza: el pago sigue confirmado", async () => {
                await service.rechazarReversion(50, RECEPTOR);

                expect(movementsRepository.clearReversalRequest).toHaveBeenCalledWith([50, 60]);
                expect(movementsRepository.deletePaymentsByIds).not.toHaveBeenCalled();
                expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, PusherEvent.PAGO_REVERSION_RECHAZADA, expect.any(Object));
            });

            it("quien la pidió no puede responderla, pero sí cancelarla", async () => {
                await expect(service.aceptarReversion(50, EMISOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });

                await service.cancelarReversion(50, EMISOR);

                expect(movementsRepository.clearReversalRequest).toHaveBeenCalledWith([50, 60]);
                expect(triggerCompartidos).toHaveBeenCalledWith(RECEPTOR, PusherEvent.PAGO_REVERSION_CANCELADA, expect.any(Object));
            });

            it("la otra persona no puede cancelarla", async () => {
                await expect(service.cancelarReversion(50, RECEPTOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            });
        });
    });
});
