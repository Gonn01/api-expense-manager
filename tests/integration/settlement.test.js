import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const mark = (user, purchaseId) => user.put("/settlement/session/items", { purchase_id: purchaseId, checked: true });

describe("sesión de cuentas", () => {
    it("marcar un gasto no registra el pago", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");

        await mark(ana, gasto);

        expect(await countMovements(gasto, "PAYMENT")).toBe(0);
        expect((await ana.get("/settlement/session")).data.items).toHaveLength(1);
    });

    it("cerrar la sesión registra los pagos y guarda el snapshot", async () => {
        const uno = await createExpense(ana, entity, { name: "Uno", amount: 300, number_of_quotas: 3 });
        const dos = await createExpense(ana, entity, { name: "Dos", amount: 50, number_of_quotas: 1 });
        await ana.post("/settlement/session");
        await mark(ana, uno);
        await mark(ana, dos);

        const finished = await ana.post("/settlement/session/finish");

        expect(finished.status).toBe(200);
        expect(await paidQuotas(ana, uno)).toBe(1);
        expect(await paidQuotas(ana, dos)).toBe(1);
        expect(finished.data.items).toHaveLength(2);
        expect(finished.data.items.map((item) => item.payment_status)).toEqual(["pagado", "pagado"]);
        expect((await ana.get("/settlement/session")).data).toBeNull();
    });

    it("descartar la sesión no registra pagos", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");
        await mark(ana, gasto);

        await ana.delete("/settlement/session");

        expect(await countMovements(gasto, "PAYMENT")).toBe(0);
        expect((await ana.get("/settlement/session")).data).toBeNull();
    });

    it("cerrar una sesión vacía falla y la deja abierta", async () => {
        await ana.post("/settlement/session");

        const response = await ana.post("/settlement/session/finish");

        expect(response).toMatchObject({ status: 409, code: "SETTLEMENT_EMPTY" });
        expect((await ana.get("/settlement/session")).data.session).toBeTruthy();
    });

    it("iniciar dos veces devuelve la misma sesión", async () => {
        const first = await ana.post("/settlement/session");
        const second = await ana.post("/settlement/session");

        expect(second.status).toBe(200);
        expect(second.data.session.id).toBe(first.data.session.id);
    });

    it("dos cierres simultáneos pagan una sola vez", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");
        await mark(ana, gasto);

        const responses = await Promise.all([
            ana.post("/settlement/session/finish"),
            ana.post("/settlement/session/finish"),
        ]);

        const [snapshots] = await executeQuery("SELECT count(*)::int AS total FROM settlement_snapshots");
        expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
        expect(await countMovements(gasto, "PAYMENT")).toBe(1);
        expect(snapshots.total).toBe(1);
    });

    it("si falla el snapshot no queda ningún pago registrado", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");
        await mark(ana, gasto);
        await executeQuery(
            "ALTER TABLE settlement_snapshots ADD CONSTRAINT fuerza_fallo CHECK (month = 'nunca') NOT VALID",
        );

        try {
            const response = await ana.post("/settlement/session/finish");

            expect(response.status).toBe(500);
            expect(await countMovements(gasto, "PAYMENT")).toBe(0);
            expect((await ana.get("/settlement/session")).data.items).toHaveLength(1);
        } finally {
            await executeQuery("ALTER TABLE settlement_snapshots DROP CONSTRAINT fuerza_fallo");
        }
    });

    it("no permite marcar un gasto ajeno", async () => {
        const gasto = await createExpense(ana, entity);
        await beto.post("/settlement/session");

        const response = await mark(beto, gasto);

        expect([403, 404]).toContain(response.status);
        expect((await beto.get("/settlement/session")).data.items).toEqual([]);
    });

    it("otro usuario no puede ver el snapshot", async () => {
        const gasto = await createExpense(ana, entity);
        await ana.post("/settlement/session");
        await mark(ana, gasto);
        const finished = await ana.post("/settlement/session/finish");

        const response = await beto.get(`/settlement/snapshots/${finished.data.id}`);

        expect(response.status).toBe(404);
    });

    it("el pago en lote exige una sesión abierta", async () => {
        const gasto = await createExpense(ana, entity);

        const response = await ana.post("/gastos/settle-lote", { purchase_ids: [gasto] });

        expect(response).toMatchObject({ status: 409, code: "SETTLEMENT_REQUIRED" });
        expect(await countMovements(gasto, "PAYMENT")).toBe(0);
    });
});
