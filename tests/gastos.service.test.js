import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/pusher.js", () => ({ triggerCompartidos: vi.fn() }));

import { GastosService } from "../services/gastos.service.js";

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
            clearFavoriteIfFinalized: vi.fn(),
            clearFavoritesIfFinalized: vi.fn(),
        };
        movementsRepository = {
            getMovementsByGasto: vi.fn(async () => []),
            createGastoLog: vi.fn(),
            createGastoLogs: vi.fn(),
            createEntidadLog: vi.fn(),
            deletePayments: vi.fn(),
            deleteLastPayment: vi.fn(async () => [{ amount: 100 }]),
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
        });

        it("un compartido con todas las cuotas cubiertas sigue en la sesión pero no suma otro pendiente", async () => {
            gasto = makeGasto({ payed_quotas: 1, pending_quotas: 2 });
            gastosRepository.getSharedSiblings.mockResolvedValue([
                { purchase_id: 10, sibling_id: 20, counterparty_user_id: INTRUSO },
            ]);

            const { kept } = await service.effectSettlementBatch([10], OWNER);

            expect(kept).toEqual([10]);
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledWith([]);
        });
    });

    describe("crearGasto", () => {
        const crear = ({ number_of_quotas = 3, payed_quotas = 0, category_ids = [], postponed = false } = {}) =>
            service.crearGasto(7, "Netflix", 300, number_of_quotas, "ARS", false, null, "EGRESO", OWNER, payed_quotas, category_ids, null, postponed);

        beforeEach(() => {
            gastosRepository.create = vi.fn(async (data) => [{ id: 10, ...data }]);
            categoriasRepository.addCategoriasToNewGasto = vi.fn(async (_, ids) => ids.map((id) => ({ id, name: `c${id}` })));
        });

        it("registra la creación y las cuotas pagas en una sola inserción", async () => {
            await crear({ payed_quotas: 2 });

            expect(movementsRepository.createGastoLog).not.toHaveBeenCalled();
            expect(movementsRepository.createGastoLogs).toHaveBeenCalledTimes(1);
            const [logs] = movementsRepository.createGastoLogs.mock.calls[0];
            expect(logs.map((l) => l.movementType)).toEqual(["CREATION", "PAYMENT", "PAYMENT"]);
            expect(logs[1]).toMatchObject({ gastoId: 10, amount: 100 });
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
            [{ type: "OTRO" }, "type"],
            [{ currency_type: "XXX" }, "currency_type"],
            [{ number_of_quotas: 1.5 }, "number_of_quotas"],
            [{ number_of_quotas: 361 }, "number_of_quotas"],
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
            expect(movementsRepository.deleteLastPayment).not.toHaveBeenCalled();
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

            it("deja cambiar el nombre", async () => {
                await service.update(10, OWNER, { name: "Otro" });
                expect(gastosRepository.update).toHaveBeenCalled();
            });
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
