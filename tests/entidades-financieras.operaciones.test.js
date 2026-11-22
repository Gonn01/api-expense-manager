import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ withTransaction: (fn) => fn(), bestEffort: (fn) => fn() }));
vi.mock("../utils/logs_custom.js", () => ({ logRed: vi.fn() }));
vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));

const { EntidadesFinancierasService } = await import("../services/entidades-financieras.service.js");
const { triggerCompartidos } = await import("../utils/pusher.js");

const USER = 1;
const ENTIDAD = 7;
const entidad = (overrides = {}) => ({ id: ENTIDAD, name: "Banco", user_id: USER, ...overrides });

describe("EntidadesFinancierasService: operaciones", () => {
    let entidadesFinancierasRepository;
    let gastosRepository;
    let movementsRepository;
    let authRepository;
    let service;

    beforeEach(() => {
        entidadesFinancierasRepository = {
            getById: vi.fn(async () => [entidad()]),
            findByName: vi.fn(async () => []),
            findByLinkedUser: vi.fn(async () => []),
            create: vi.fn(async () => [entidad()]),
            update: vi.fn(async (id, name) => [entidad({ name })]),
            setFavorite: vi.fn(async (id, userId, value) => [entidad({ is_favorite: value })]),
            setMercadoPagoAlias: vi.fn(async (id, userId, alias) => [entidad({ mercado_pago_alias: alias })]),
            vincularUsuario: vi.fn(async () => [entidad({ linked_user_id: 2 })]),
            desvincularUsuario: vi.fn(async () => [entidad({ linked_user_id: null })]),
        };
        vi.mocked(triggerCompartidos).mockClear();
        gastosRepository = {
            getUserName: vi.fn(async () => [{ name: "Yo" }]),
            getGastosByEntidad: vi.fn(async () => []),
            getPendingByEntidad: vi.fn(async () => []),
            getDeletedByEntidad: vi.fn(async () => []),
        };
        movementsRepository = {
            getMovementsByEntidad: vi.fn(async () => []),
            createEntidadLog: vi.fn(async () => []),
        };
        authRepository = {
            findUserByEmail: vi.fn(async () => [{ id: 2, name: "Ana", email: "ana@test.com" }]),
        };
        service = new EntidadesFinancierasService({
            entidadesFinancierasRepository,
            gastosRepository,
            movementsRepository,
            authRepository,
            runInTransaction: (fn) => fn(),
        });
    });

    describe("obtenerPorId", () => {
        it("separa gastos activos y finalizados, y mantiene activo un gasto fijo", async () => {
            const enCurso = { id: 1, payed_quotas: 1, number_of_quotas: 3, fixed_expense: false };
            const terminado = { id: 2, payed_quotas: "3", number_of_quotas: "3", fixed_expense: false };
            const fijo = { id: 3, payed_quotas: 12, number_of_quotas: 1, fixed_expense: true };
            gastosRepository.getGastosByEntidad.mockResolvedValue([enCurso, terminado, fijo]);
            gastosRepository.getPendingByEntidad.mockResolvedValue([{ id: 4 }]);

            const result = await service.obtenerPorId(ENTIDAD, USER);

            expect(result.gastos_activos).toEqual([enCurso, fijo]);
            expect(result.gastos_inactivos).toEqual([terminado]);
            expect(result.pending_count).toBe(1);
        });

        it("no lee los gastos de una entidad ajena", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([]);

            await expect(service.obtenerPorId(ENTIDAD, USER)).rejects.toMatchObject({ code: "ENTIDAD_NOT_FOUND" });
            expect(gastosRepository.getGastosByEntidad).not.toHaveBeenCalled();
        });
    });

    describe("crear", () => {
        it("crea la entidad y registra el movimiento", async () => {
            const result = await service.crear("Banco", USER);

            expect(result.id).toBe(ENTIDAD);
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(ENTIDAD, "CREATION");
        });

        it("rechaza un nombre repetido", async () => {
            entidadesFinancierasRepository.findByName.mockResolvedValue([entidad()]);

            await expect(service.crear("Banco", USER)).rejects.toMatchObject({ code: "ENTIDAD_YA_EXISTE" });
            expect(entidadesFinancierasRepository.create).not.toHaveBeenCalled();
        });
    });

    describe("actualizar", () => {
        it("registra el cambio de nombre", async () => {
            await service.actualizar(ENTIDAD, "Nuevo", USER);

            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                ENTIDAD,
                "EDITED",
                'Nombre: "Banco" → "Nuevo"',
            );
        });

        it("no registra movimiento si el nombre no cambió", async () => {
            await service.actualizar(ENTIDAD, "Banco", USER);

            expect(movementsRepository.createEntidadLog).not.toHaveBeenCalled();
        });

        it("excluye a la propia entidad al buscar nombres repetidos", async () => {
            await service.actualizar(ENTIDAD, "Nuevo", USER);

            expect(entidadesFinancierasRepository.findByName).toHaveBeenCalledWith(USER, "Nuevo", ENTIDAD);
        });

        it("no modifica una entidad ajena", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([]);

            await expect(service.actualizar(ENTIDAD, "Nuevo", USER)).rejects.toMatchObject({
                code: "ENTIDAD_NOT_FOUND",
            });
            expect(entidadesFinancierasRepository.update).not.toHaveBeenCalled();
        });

        it("no falla si no se puede registrar el historial", async () => {
            movementsRepository.createEntidadLog.mockRejectedValue(new Error("db"));

            await expect(service.actualizar(ENTIDAD, "Nuevo", USER)).resolves.toMatchObject({ name: "Nuevo" });
        });
    });

    describe("actualizarAliasMercadoPago", () => {
        it("guarda el alias y registra el cambio", async () => {
            const result = await service.actualizarAliasMercadoPago(ENTIDAD, "banco.demo", USER);

            expect(result.mercado_pago_alias).toBe("banco.demo");
            expect(entidadesFinancierasRepository.setMercadoPagoAlias).toHaveBeenCalledWith(ENTIDAD, USER, "banco.demo");
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                ENTIDAD,
                "EDITED",
                'Alias de Mercado Pago: sin alias → "banco.demo"',
            );
        });

        it("permite quitar el alias", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([entidad({ mercado_pago_alias: "banco.demo" })]);

            await service.actualizarAliasMercadoPago(ENTIDAD, null, USER);

            expect(entidadesFinancierasRepository.setMercadoPagoAlias).toHaveBeenCalledWith(ENTIDAD, USER, null);
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                ENTIDAD,
                "EDITED",
                'Alias de Mercado Pago: "banco.demo" → sin alias',
            );
        });

        it("no escribe si el alias no cambió", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([entidad({ mercado_pago_alias: "banco.demo" })]);

            await service.actualizarAliasMercadoPago(ENTIDAD, "banco.demo", USER);

            expect(entidadesFinancierasRepository.setMercadoPagoAlias).not.toHaveBeenCalled();
            expect(movementsRepository.createEntidadLog).not.toHaveBeenCalled();
        });

        it("no modifica una entidad ajena", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([]);

            await expect(service.actualizarAliasMercadoPago(ENTIDAD, "banco.demo", USER)).rejects.toMatchObject({
                code: "ENTIDAD_NOT_FOUND",
            });
            expect(entidadesFinancierasRepository.setMercadoPagoAlias).not.toHaveBeenCalled();
        });
    });

    describe("marcarFavorito", () => {
        it("convierte el valor a booleano", async () => {
            await service.marcarFavorito(ENTIDAD, USER, 0);

            expect(entidadesFinancierasRepository.setFavorite).toHaveBeenCalledWith(ENTIDAD, USER, false);
        });

        it("no marca una entidad ajena", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([]);

            await expect(service.marcarFavorito(ENTIDAD, USER, true)).rejects.toMatchObject({
                code: "ENTIDAD_NOT_FOUND",
            });
            expect(entidadesFinancierasRepository.setFavorite).not.toHaveBeenCalled();
        });
    });

    describe("vincularUsuario", () => {
        it("vincula y devuelve los datos del usuario", async () => {
            const result = await service.vincularUsuario(ENTIDAD, USER, "ana@test.com");

            expect(entidadesFinancierasRepository.vincularUsuario).toHaveBeenCalledWith(ENTIDAD, USER, 2);
            expect(result).toMatchObject({ linked_user_name: "Ana", linked_user_email: "ana@test.com" });
            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                ENTIDAD,
                "LINK",
                "Vinculada a Ana (ana@test.com)",
            );
            expect(triggerCompartidos).toHaveBeenCalledWith(2, "entidad.vinculada", {
                actorId: USER,
                actorName: "Yo",
                entityId: null,
            });
        });

        it("avisa a la persona reemplazada al vincular a otra", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([entidad({ linked_user_id: 3 })]);

            await service.vincularUsuario(ENTIDAD, USER, "ana@test.com");

            expect(triggerCompartidos).toHaveBeenCalledWith(3, "entidad.desvinculada", expect.any(Object));
            expect(triggerCompartidos).toHaveBeenCalledWith(2, "entidad.vinculada", expect.any(Object));
        });

        it("rechaza un email inexistente", async () => {
            authRepository.findUserByEmail.mockResolvedValue([]);

            await expect(service.vincularUsuario(ENTIDAD, USER, "x@test.com")).rejects.toMatchObject({
                code: "USUARIO_EMAIL_NOT_FOUND",
            });
        });

        it("rechaza vincular la propia cuenta aunque el id venga como texto", async () => {
            authRepository.findUserByEmail.mockResolvedValue([{ id: String(USER), name: "Yo", email: "yo@test.com" }]);

            await expect(service.vincularUsuario(ENTIDAD, USER, "yo@test.com")).rejects.toMatchObject({
                code: "VINCULAR_CUENTA_PROPIA",
            });
        });

        it("rechaza un usuario ya vinculado a otra entidad e indica cuál", async () => {
            entidadesFinancierasRepository.findByLinkedUser.mockResolvedValue([entidad({ id: 8, name: "Otra" })]);

            await expect(service.vincularUsuario(ENTIDAD, USER, "ana@test.com")).rejects.toMatchObject({
                code: "ENTIDAD_YA_VINCULADA",
                message: expect.stringContaining("Otra"),
            });
            expect(entidadesFinancierasRepository.vincularUsuario).not.toHaveBeenCalled();
        });
    });

    describe("desvincularUsuario", () => {
        it("registra de quién se desvinculó", async () => {
            entidadesFinancierasRepository.getById.mockResolvedValue([
                entidad({ linked_user_id: 2, linked_user_name: "Ana", linked_user_email: "ana@test.com" }),
            ]);

            await service.desvincularUsuario(ENTIDAD, USER);

            expect(movementsRepository.createEntidadLog).toHaveBeenCalledWith(
                ENTIDAD,
                "UNLINK",
                "Desvinculada de Ana (ana@test.com)",
            );
            expect(triggerCompartidos).toHaveBeenCalledWith(2, "entidad.desvinculada", expect.any(Object));
        });

        it("no registra movimiento si no había nadie vinculado", async () => {
            await service.desvincularUsuario(ENTIDAD, USER);

            expect(movementsRepository.createEntidadLog).not.toHaveBeenCalled();
            expect(triggerCompartidos).not.toHaveBeenCalled();
        });
    });
});
