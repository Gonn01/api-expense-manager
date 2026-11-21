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
            getCopyNotificationData: vi.fn(async () => []),
            updateStatus: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Juan" }]),
        };
        entidadesFinancierasRepository = {
            create: vi.fn(async () => [{ id: 9 }]),
            getById: vi.fn(async () => entidad(null)),
            findByLinkedUser: vi.fn(async () => []),
            vincularUsuario: vi.fn(),
        };
        movementsRepository = { createEntidadLog: vi.fn(), createGastoLog: vi.fn(), createGastoLogs: vi.fn() };
        service = new CompartidosService({
            gastosRepository,
            entidadesFinancierasRepository,
            movementsRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("al aprobar deja la línea en el historial de los dos gastos", async () => {
        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
            { gastoId: GASTO.id, movementType: "SHARED_APPROVED", createdByUserId: RECEPTOR },
            { gastoId: GASTO.shared_from_id, movementType: "SHARED_APPROVED", createdByUserId: RECEPTOR },
        ]);
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

    it("al aprobar no escribe otro CREATION en el historial del gasto", async () => {
        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(movementsRepository.createGastoLog).not.toHaveBeenCalledWith(expect.anything(), "CREATION");
    });

    it("al aprobar registra PURCHASE_CREATED en la entidad del receptor y activa el original", async () => {
        await service.aprobar(GASTO.id, RECEPTOR, 7, null);

        expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
            7,
            "PURCHASE_CREATED",
            expect.stringContaining(GASTO.name),
        );
        expect(gastosRepository.updateStatus).toHaveBeenCalledWith(GASTO.shared_from_id, "ACTIVE");
    });

    it("vincula la entidad nueva una sola vez", async () => {
        entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 9, user_id: RECEPTOR, linked_user_id: EMISOR }]);

        await service.aprobar(GASTO.id, RECEPTOR, null, "Juan");

        expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledTimes(1);
        expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledWith(9, RECEPTOR, EMISOR);
    });
});

describe("CompartidosService.rechazar", () => {
    let gastosRepository;
    let movementsRepository;
    let service;

    beforeEach(async () => {
        const { triggerCompartidos } = await import("../utils/pusher.js");
        triggerCompartidos.mockClear();
        movementsRepository = { createGastoLogs: vi.fn() };
        gastosRepository = {
            getById: vi.fn(async () => [GASTO]),
            getCopyNotificationData: vi.fn(async () => [
                { sender_user_id: EMISOR, sender_entity_id: 5, receiver_name: "Ana", gasto_name: "Cena" },
            ]),
            updateStatus: vi.fn(async (id, status) => [{ id, status }]),
        };
        service = new CompartidosService({
            gastosRepository,
            entidadesFinancierasRepository: {},
            movementsRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    it("rechaza las dos copias y le avisa al emisor quién rechazó qué gasto", async () => {
        const { triggerCompartidos } = await import("../utils/pusher.js");

        const updated = await service.rechazar(GASTO.id, RECEPTOR);

        expect(updated).toEqual({ id: GASTO.id, status: "REJECTED" });
        expect(gastosRepository.updateStatus).toHaveBeenCalledWith(GASTO.shared_from_id, "REJECTED");
        expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
            { gastoId: GASTO.id, movementType: "SHARED_REJECTED", createdByUserId: RECEPTOR },
            { gastoId: GASTO.shared_from_id, movementType: "SHARED_REJECTED", createdByUserId: RECEPTOR },
        ]);
        expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, "compartido.rechazado", {
            gastoId: GASTO.id,
            entityId: 5,
            receiverName: "Ana",
            gastoName: "Cena",
        });
    });

    it("no notifica si el gasto original ya no existe", async () => {
        const { triggerCompartidos } = await import("../utils/pusher.js");
        gastosRepository.getCopyNotificationData.mockResolvedValue([]);

        await service.rechazar(GASTO.id, RECEPTOR);

        expect(triggerCompartidos).not.toHaveBeenCalled();
    });
});

describe("CompartidosService: gasto rechazado del emisor", () => {
    const ORIGINAL = { id: 20, name: "Cena", status: "REJECTED", financial_entity_id: 5, linked_purchase_id: null };
    const COPIA = { id: 30, status: "REJECTED", receiver_user_id: RECEPTOR, shared_from_id: 20 };
    const ESPEJO = { id: 40, name: "Cena", financial_entity_id: 6 };

    let gastosRepository;
    let entidadesFinancierasRepository;
    let movementsRepository;
    let settlementRepository;
    let service;
    let triggerCompartidos;

    const conOriginal = (original) => {
        gastosRepository.getById.mockImplementation(async (id) => {
            if (String(id) === String(original.id)) return [original];
            if (String(id) === String(ESPEJO.id)) return [ESPEJO];
            return [];
        });
    };

    beforeEach(async () => {
        ({ triggerCompartidos } = await import("../utils/pusher.js"));
        triggerCompartidos.mockClear();
        gastosRepository = {
            getById: vi.fn(),
            getSharedCopyByOriginalId: vi.fn(async () => [COPIA]),
            lockPurchases: vi.fn(),
            updateStatus: vi.fn(async (id, status) => [{ id, status }]),
            delete: vi.fn(async (id) => [{ id }]),
            unlink: vi.fn(),
            getUserName: vi.fn(async () => [{ name: "Beto" }]),
        };
        conOriginal(ORIGINAL);
        entidadesFinancierasRepository = {
            getById: vi.fn(async () => [{ id: 5, user_id: EMISOR, linked_user_id: RECEPTOR }]),
        };
        movementsRepository = { createGastoLog: vi.fn(), createGastoLogs: vi.fn(), createEntidadLog: vi.fn() };
        settlementRepository = {
            getOpenSession: vi.fn(async () => ({ id: 77 })),
            removeItems: vi.fn(),
        };
        service = new CompartidosService({
            gastosRepository,
            entidadesFinancierasRepository,
            movementsRepository,
            settlementRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    describe("reintentar", () => {
        it("vuelve a pendiente y le avisa al receptor si el vínculo sigue", async () => {
            await service.reintentar(ORIGINAL.id, EMISOR);

            expect(gastosRepository.updateStatus).toHaveBeenCalledWith(COPIA.id, "PENDING_APPROVAL");
            expect(gastosRepository.updateStatus).toHaveBeenCalledWith(ORIGINAL.id, "PENDING_APPROVAL");
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([
                { gastoId: ORIGINAL.id, movementType: "SHARED_RETRIED", createdByUserId: EMISOR },
                { gastoId: COPIA.id, movementType: "SHARED_RETRIED", createdByUserId: EMISOR },
            ]);
            expect(triggerCompartidos).toHaveBeenCalledWith(RECEPTOR, "compartido.nuevo", { gastoId: ORIGINAL.id });
        });

        it.each([null, 99])("no reenvía si la entidad quedó vinculada a %s", async (linked_user_id) => {
            entidadesFinancierasRepository.getById.mockResolvedValue([{ id: 5, linked_user_id }]);

            await expect(service.reintentar(ORIGINAL.id, EMISOR)).rejects.toMatchObject({
                code: "GASTO_COMPARTIDO_DESVINCULADO",
            });
            expect(gastosRepository.updateStatus).not.toHaveBeenCalled();
            expect(triggerCompartidos).not.toHaveBeenCalled();
        });
    });

    describe("descartar", () => {
        it("sin espejo da de baja el original y les avisa a las dos partes", async () => {
            const result = await service.descartar(ORIGINAL.id, EMISOR);

            expect(gastosRepository.delete).toHaveBeenCalledTimes(1);
            expect(gastosRepository.delete).toHaveBeenCalledWith(ORIGINAL.id);
            expect(gastosRepository.unlink).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(ORIGINAL.id, "DELETE");
            expect(triggerCompartidos).toHaveBeenCalledWith(RECEPTOR, "compartido.descartado", {
                gastoId: COPIA.id,
                actorId: EMISOR,
                actorName: "Beto",
            });
            expect(triggerCompartidos).toHaveBeenCalledWith(EMISOR, "compartido.descartado", {
                gastoId: ORIGINAL.id,
                actorId: EMISOR,
                actorName: "Beto",
            });
            expect(result).toEqual({ id: ORIGINAL.id, mirror_id: null, mirror_deleted: false });
        });

        it("con espejo exige elegir qué hacer con él", async () => {
            conOriginal({ ...ORIGINAL, linked_purchase_id: ESPEJO.id });

            await expect(service.descartar(ORIGINAL.id, EMISOR)).rejects.toMatchObject({
                code: "VALIDATION_ERROR",
                details: { field: "delete_linked" },
            });
            expect(gastosRepository.delete).not.toHaveBeenCalled();
        });

        it("conservar el espejo lo deja activo y sin enlace", async () => {
            conOriginal({ ...ORIGINAL, linked_purchase_id: ESPEJO.id });

            const result = await service.descartar(ORIGINAL.id, EMISOR, false);

            expect(gastosRepository.delete).toHaveBeenCalledTimes(1);
            expect(gastosRepository.delete).toHaveBeenCalledWith(ORIGINAL.id);
            expect(gastosRepository.unlink).toHaveBeenCalledWith(ORIGINAL.id);
            expect(settlementRepository.removeItems).not.toHaveBeenCalled();
            expect(result).toEqual({ id: ORIGINAL.id, mirror_id: ESPEJO.id, mirror_deleted: false });
        });

        it("eliminar el espejo lo da de baja y lo quita de la sesión abierta", async () => {
            conOriginal({ ...ORIGINAL, linked_purchase_id: ESPEJO.id });

            const result = await service.descartar(ORIGINAL.id, EMISOR, true);

            expect(gastosRepository.delete).toHaveBeenCalledWith(ORIGINAL.id);
            expect(gastosRepository.delete).toHaveBeenCalledWith(ESPEJO.id);
            expect(movementsRepository.createGastoLog).toHaveBeenCalledWith(ESPEJO.id, "DELETE");
            expect(settlementRepository.removeItems).toHaveBeenCalledWith(77, [ESPEJO.id]);
            expect(result.mirror_deleted).toBe(true);
        });

        it("no descarta un gasto que no está rechazado", async () => {
            gastosRepository.getSharedCopyByOriginalId.mockResolvedValue([{ ...COPIA, status: "PENDING_APPROVAL" }]);

            await expect(service.descartar(ORIGINAL.id, EMISOR)).rejects.toMatchObject({
                code: "GASTO_COMPARTIDO_NO_RECHAZADO",
            });
            expect(gastosRepository.delete).not.toHaveBeenCalled();
        });

        it("no deja descartar a quien no es dueño de la entidad", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([]);

            await expect(service.descartar(ORIGINAL.id, RECEPTOR)).rejects.toMatchObject({ code: "NO_AUTORIZADO" });
            expect(gastosRepository.delete).not.toHaveBeenCalled();
        });
    });
});
