import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Currency } from "../../utils/enums.js";
import {
    countMovements,
    createEntity,
    createExpense,
    createUser,
    executeQuery,
    paidQuotas,
    resetDatabase,
    startApi,
    stopApi,
} from "./support/harness.js";

let ana;
let beto;
let entity;

beforeAll(startApi);
afterAll(stopApi);

beforeEach(async () => {
    await resetDatabase();
    ana = await createUser("Ana");
    beto = await createUser("Beto");
    entity = await createEntity(ana);
});

describe("pagos directos", () => {
    it("cuenta las cuotas pagas a partir de los movimientos", async () => {
        const gasto = await createExpense(ana, entity);

        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });
        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        expect(await paidQuotas(ana, gasto)).toBe(2);
        expect(await countMovements(gasto, "PAYMENT")).toBe(2);
    });

    it("registra el monto de una cuota", async () => {
        const gasto = await createExpense(ana, entity, { amount: 300, number_of_quotas: 3 });

        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        const [movement] = await executeQuery(
            "SELECT amount FROM purchases_movements WHERE purchase_id = $1 AND movement_type = 'PAYMENT'",
            [gasto],
        );
        expect(Number(movement.amount)).toBe(100);
    });

    it("no permite pagar más cuotas de las que tiene", async () => {
        const gasto = await createExpense(ana, entity, { amount: 100, number_of_quotas: 1 });
        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        const response = await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        expect(response).toMatchObject({ status: 409, code: "GASTO_YA_SALDADO" });
        expect(await countMovements(gasto, "PAYMENT")).toBe(1);
    });

    it("pagos simultáneos de la última cuota registran uno solo", async () => {
        const gasto = await createExpense(ana, entity, { amount: 100, number_of_quotas: 1 });

        const responses = await Promise.all(
            Array.from({ length: 5 }, () => ana.post(`/gastos/${gasto}/settle-quota`, { direct: true })),
        );

        expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
        expect(responses.filter((r) => r.status === 409 && r.code === "GASTO_YA_SALDADO")).toHaveLength(4);
        expect(await countMovements(gasto, "PAYMENT")).toBe(1);
    });

    it("pagos simultáneos no superan las cuotas restantes", async () => {
        const gasto = await createExpense(ana, entity, { amount: 300, number_of_quotas: 3 });

        await Promise.all(
            Array.from({ length: 6 }, () => ana.post(`/gastos/${gasto}/settle-quota`, { direct: true })),
        );

        expect(await countMovements(gasto, "PAYMENT")).toBe(3);
    });

    it("reversiones simultáneas devuelven una sola cuota", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        await Promise.all(Array.from({ length: 4 }, () => ana.post(`/gastos/${gasto}/refund-cuota`)));

        expect(await countMovements(gasto, "REFUND")).toBe(1);
        expect(await countMovements(gasto, "PAYMENT_REVERTED")).toBe(1);
    });

    it("un id inválido responde 404 sin error de base", async () => {
        const response = await ana.post("/gastos/abc/settle-quota", { direct: true });

        expect(response).toMatchObject({ status: 404, code: "GASTO_NOT_FOUND" });
    });

    it("revertir una cuota la vuelve a dejar pendiente", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        const response = await ana.post(`/gastos/${gasto}/refund-cuota`);

        expect(response.status).toBe(200);
        expect(await paidQuotas(ana, gasto)).toBe(0);
    });

    it("un gasto fijo admite pagos sin límite de cuotas", async () => {
        const gasto = await createExpense(ana, entity, { fixed_expense: true, number_of_quotas: 1 });

        await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });
        const second = await ana.post(`/gastos/${gasto}/settle-quota`, { direct: true });

        expect(second.status).toBe(200);
        expect(await countMovements(gasto, "PAYMENT")).toBe(2);
    });
});

describe("pertenencia", () => {
    it("otro usuario no puede leer, pagar, editar ni borrar el gasto", async () => {
        const gasto = await createExpense(ana, entity);

        const responses = await Promise.all([
            beto.get(`/gastos/${gasto}`),
            beto.post(`/gastos/${gasto}/settle-quota`, { direct: true }),
            beto.put(`/gastos/${gasto}`, { name: "Robado" }),
            beto.delete(`/gastos/${gasto}`),
        ]);

        for (const response of responses) expect([403, 404]).toContain(response.status);
        const [row] = await executeQuery("SELECT name, deleted FROM purchases WHERE id = $1", [gasto]);
        expect(row).toMatchObject({ name: "Gasto", deleted: false });
        expect(await countMovements(gasto, "PAYMENT")).toBe(0);
    });

    it("otro usuario no puede crear gastos en una entidad ajena", async () => {
        const response = await beto.post("/gastos", {
            financial_entity_id: entity,
            name: "Intruso",
            amount: 10,
            number_of_quotas: 1,
            currency_type: "ARS",
            type: "EGRESO",
        });

        expect(response.status).toBe(404);
    });

    it("otro usuario no puede ver ni borrar la entidad", async () => {
        expect((await beto.get(`/entidades-financieras/${entity}`)).status).toBe(404);
        expect((await beto.delete(`/entidades-financieras/${entity}`)).status).toBe(404);
    });

    it("el listado de entidades solo trae las propias", async () => {
        await createEntity(beto, "De Beto");

        const response = await ana.get("/entidades-financieras");

        expect(response.data.map((e) => e.name)).toEqual(["Banco"]);
    });
});

describe("entidad de pago", () => {
    it("crea un gasto espejo del tipo opuesto y los enlaza", async () => {
        const pago = await createEntity(ana, "Billetera");

        const gasto = await createExpense(ana, entity, { payment_entity_id: pago });

        const rows = await executeQuery(
            "SELECT id, type, linked_purchase_id, financial_entity_id FROM purchases ORDER BY id",
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ type: "EGRESO" });
        expect(rows[1]).toMatchObject({ type: "INGRESO" });
        expect(Number(rows[0].linked_purchase_id)).toBe(Number(rows[1].id));
        expect(Number(rows[1].linked_purchase_id)).toBe(gasto);
    });

    it("si la entidad de pago es ajena no crea nada", async () => {
        const ajena = await createEntity(beto, "Ajena");

        const response = await ana.post("/gastos", {
            financial_entity_id: entity,
            name: "Gasto",
            amount: 10,
            number_of_quotas: 1,
            currency_type: "ARS",
            type: "EGRESO",
            payment_entity_id: ajena,
        });

        const [row] = await executeQuery("SELECT count(*)::int AS total FROM purchases");
        expect(response.status).toBe(404);
        expect(row.total).toBe(0);
    });
});

describe("monedas", () => {
    const createIn = (currency) =>
        ana.post("/gastos", {
            financial_entity_id: entity,
            name: "Gasto",
            amount: 10,
            number_of_quotas: 1,
            currency_type: currency,
            type: "EGRESO",
        });

    it.each(["ARS", "USD", "EUR"])("permite crear un gasto en %s", async (currency) => {
        expect((await createIn(currency)).status).toBe(201);
    });

    it.fails("BUG CONOCIDO: permite crear un gasto en todas las monedas declaradas", async () => {
        const rejected = [];
        for (const currency of Object.values(Currency)) {
            const response = await createIn(currency);
            if (response.status !== 201) rejected.push(currency);
        }

        expect(rejected).toEqual([]);
    });
});

describe("baja y restauración de entidades", () => {
    it("restaura solo los gastos que se eliminaron con la entidad", async () => {
        const conEntidad = await createExpense(ana, entity, { name: "Con entidad" });
        const borradoAntes = await createExpense(ana, entity, { name: "Borrado antes" });
        await ana.delete(`/gastos/${borradoAntes}`);

        const deleted = await ana.delete(`/entidades-financieras/${entity}`);
        expect(deleted.status).toBe(200);

        const restored = await ana.put(`/entidades-financieras/${entity}/restaurar`);
        expect(restored.status).toBe(200);

        const rows = await executeQuery("SELECT id, deleted FROM purchases ORDER BY id");
        expect(rows.find((r) => Number(r.id) === conEntidad).deleted).toBe(false);
        expect(rows.find((r) => Number(r.id) === borradoAntes).deleted).toBe(true);
        expect(await countMovements(conEntidad, "RESTORE")).toBe(1);
    });

    it("al eliminar la entidad saca sus gastos de la sesión abierta", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");
        await ana.put("/settlement/session/items", { purchase_id: gasto, checked: true });

        await ana.delete(`/entidades-financieras/${entity}`);

        const session = await ana.get("/settlement/session");
        expect(session.data.items).toEqual([]);
    });
});
