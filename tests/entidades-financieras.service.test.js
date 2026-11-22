import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({ withTransaction: (fn) => fn(), bestEffort: (fn) => fn() }));

const { EntidadesFinancierasService } = await import("../services/entidades-financieras.service.js");

const USER = 1;
const ENTIDAD = 7;

describe("EntidadesFinancierasService: eliminar y restaurar en cascada", () => {
    let entidadesFinancierasRepository;
    let gastosRepository;
    let movementsRepository;
    let settlementRepository;
    let pagosCompartidosService;
    let service;

    beforeEach(() => {
        entidadesFinancierasRepository = {
            getById: vi.fn(async () => [{ id: ENTIDAD, user_id: USER }]),
            delete: vi.fn(async () => [{ id: ENTIDAD }]),
            restaurar: vi.fn(async () => [{ id: ENTIDAD, deleted: false }]),
        };
        gastosRepository = {
            getIdsByEntidad: vi.fn(async () => [{ id: 10 }, { id: 11 }]),
            deleteByEntidad: vi.fn(async () => [{ id: 10 }, { id: 11 }]),
            restoreByEntidad: vi.fn(async () => [{ id: 10 }]),
            unlinkMany: vi.fn(async () => []),
        };
        movementsRepository = { createGastoLogs: vi.fn(async () => []) };
        settlementRepository = {
            getOpenSession: vi.fn(async () => ({ id: 99 })),
            removeItems: vi.fn(async () => []),
        };
        pagosCompartidosService = { cerrarCompartidos: vi.fn(async () => []) };
        service = new EntidadesFinancierasService({
            entidadesFinancierasRepository,
            gastosRepository,
            movementsRepository,
            settlementRepository,
            pagosCompartidosService,
            runInTransaction: (fn) => fn(),
        });
    });

    it("elimina los gastos de la entidad, cierra los compartidos en lote y los quita de la sesión", async () => {
        const result = await service.eliminar(ENTIDAD, USER);

        expect(gastosRepository.deleteByEntidad).toHaveBeenCalledWith(ENTIDAD);
        expect(pagosCompartidosService.cerrarCompartidos).toHaveBeenCalledTimes(1);
        expect(pagosCompartidosService.cerrarCompartidos).toHaveBeenCalledWith([10, 11], USER);
        expect(gastosRepository.unlinkMany).toHaveBeenCalledWith([10, 11]);
        expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
            { gastoId: 10, movementType: "DELETE" },
            { gastoId: 11, movementType: "DELETE" },
        ]);
        expect(settlementRepository.removeItems).toHaveBeenCalledWith(99, [10, 11]);
        expect(result).toEqual({ id: ENTIDAD, deleted_purchase_ids: ["10", "11"] });
    });

    it("no toca la sesión si no hay una abierta", async () => {
        settlementRepository.getOpenSession.mockResolvedValue(null);

        await service.eliminar(ENTIDAD, USER);

        expect(settlementRepository.removeItems).not.toHaveBeenCalled();
    });

    it("rechaza una entidad que no existe sin borrar nada", async () => {
        entidadesFinancierasRepository.getById.mockResolvedValue([]);

        await expect(service.eliminar(ENTIDAD, USER)).rejects.toMatchObject({ code: "ENTIDAD_NOT_FOUND" });
        expect(gastosRepository.deleteByEntidad).not.toHaveBeenCalled();
        expect(entidadesFinancierasRepository.delete).not.toHaveBeenCalled();
    });

    it("al restaurar trae de vuelta solo los gastos que se eliminaron con la entidad", async () => {
        const result = await service.restaurar(ENTIDAD, USER);

        expect(gastosRepository.restoreByEntidad).toHaveBeenCalledWith(ENTIDAD);
        expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([{ gastoId: 10, movementType: "RESTORE" }]);
        expect(result).toEqual([{ id: ENTIDAD, deleted: false }]);
    });

    it("restaurar una entidad inexistente responde ENTIDAD_NOT_FOUND", async () => {
        entidadesFinancierasRepository.restaurar.mockResolvedValue([]);

        await expect(service.restaurar(ENTIDAD, USER)).rejects.toMatchObject({ code: "ENTIDAD_NOT_FOUND" });
        expect(gastosRepository.restoreByEntidad).not.toHaveBeenCalled();
    });
});
