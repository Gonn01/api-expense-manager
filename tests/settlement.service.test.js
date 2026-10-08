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
        service = new SettlementService({ settlementRepository, gastosService });
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
});
