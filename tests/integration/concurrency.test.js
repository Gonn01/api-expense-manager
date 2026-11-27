import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    countMovements,
    createEntity,
    createExpense,
    createUser,
    executeQuery,
    resetDatabase,
    startApi,
    stopApi,
} from "./support/harness.js";

const ROUNDS = 15;

beforeAll(startApi);
afterAll(stopApi);

async function freshUser() {
    await resetDatabase();
    const ana = await createUser("Ana");
    const entity = await createEntity(ana);
    return { ana, entity };
}

const purchase = async (id) => {
    const [row] = await executeQuery(
        `SELECT p.number_of_quotas::int AS quotas, p.is_postponed, p.deleted,
                (SELECT count(*)::int FROM purchases_movements m
                 WHERE m.purchase_id = p.id AND m.movement_type = 'PAYMENT') AS paid
         FROM purchases p WHERE p.id = $1`,
        [id],
    );
    return row;
};

describe("operaciones simultáneas sobre un mismo gasto o entidad", () => {
    it("editar las cuotas mientras se paga no deja más cuotas pagas que cuotas", async () => {
        for (let round = 0; round < ROUNDS; round++) {
            const { ana, entity } = await freshUser();
            const gasto = await createExpense(ana, entity, { amount: 300, number_of_quotas: 3, payed_quotas: 2 });

            const responses = await Promise.all([
                ana.put(`/gastos/${gasto}`, { number_of_quotas: 2 }),
                ana.post(`/gastos/${gasto}/settle-quota`, { direct: true }),
            ]);

            expect(responses.map((r) => r.status)).not.toContain(500);
            const { quotas, paid } = await purchase(gasto);
            expect(paid).toBeLessThanOrEqual(quotas);
        }
    });

    it("postergar mientras se paga la última cuota no deja un gasto saldado postergado", async () => {
        for (let round = 0; round < ROUNDS; round++) {
            const { ana, entity } = await freshUser();
            const gasto = await createExpense(ana, entity, { amount: 100, number_of_quotas: 1 });

            const responses = await Promise.all([
                ana.put(`/gastos/${gasto}/postergar`, { postponed: true }),
                ana.post(`/gastos/${gasto}/settle-quota`, { direct: true }),
            ]);

            expect(responses.map((r) => r.status)).not.toContain(500);
            const { quotas, paid, is_postponed } = await purchase(gasto);
            expect(is_postponed && paid >= quotas).toBe(false);
        }
    });

    it("revertir dos veces a la vez la última cuota no duplica el reembolso", async () => {
        for (let round = 0; round < ROUNDS; round++) {
            const { ana, entity } = await freshUser();
            const gasto = await createExpense(ana, entity, { amount: 300, number_of_quotas: 3, payed_quotas: 2 });

            const responses = await Promise.all([
                ana.post(`/gastos/${gasto}/refund-cuota`),
                ana.post(`/gastos/${gasto}/refund-cuota`),
            ]);

            expect(responses.map((r) => r.status)).not.toContain(500);
            const ok = responses.filter((r) => r.status === 200).length;
            expect(await countMovements(gasto, "REFUND")).toBe(ok);
            expect(await countMovements(gasto, "PAYMENT_REVERTED")).toBe(ok);
            expect(await countMovements(gasto, "PAYMENT")).toBe(2 - ok);
        }
    });

    it("eliminar una entidad mientras se crea un gasto en ella no deja gastos activos adentro", async () => {
        for (let round = 0; round < ROUNDS; round++) {
            const { ana, entity } = await freshUser();

            const [deleted, created] = await Promise.all([
                ana.delete(`/entidades-financieras/${entity}`),
                ana.post("/gastos", {
                    financial_entity_id: entity,
                    name: "Gasto",
                    amount: 100,
                    number_of_quotas: 1,
                    currency_type: "ARS",
                    fixed_expense: false,
                    type: "EGRESO",
                }),
            ]);

            expect([deleted.status, created.status]).not.toContain(500);
            const [active] = await executeQuery(
                `SELECT count(*)::int AS total FROM purchases p
                 JOIN financial_entities fe ON fe.id = p.financial_entity_id
                 WHERE fe.deleted = true AND p.deleted = false`,
            );
            expect(active.total).toBe(0);
        }
    });

    it("vincular dos entidades a la vez con la misma persona deja una sola vinculada", async () => {
        for (let round = 0; round < ROUNDS; round++) {
            const { ana, entity } = await freshUser();
            const otra = await createEntity(ana, "Otra");
            const beto = await createUser("Beto");

            const responses = await Promise.all([
                ana.put(`/entidades-financieras/${entity}/vincular-usuario`, { email: beto.email }),
                ana.put(`/entidades-financieras/${otra}/vincular-usuario`, { email: beto.email }),
            ]);

            expect(responses.map((r) => r.status)).not.toContain(500);
            const [linked] = await executeQuery(
                "SELECT count(*)::int AS total FROM financial_entities WHERE linked_user_id = $1 AND deleted = false",
                [beto.id],
            );
            expect(linked.total).toBe(1);
        }
    });
});
