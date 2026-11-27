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

    describe("con pedidos simultáneos", () => {
        const ROUNDS = 5;

        const sessionsByStatus = async () => {
            const rows = await executeQuery(
                "SELECT status, count(*)::int AS total FROM settlement_sessions GROUP BY status",
            );
            return Object.fromEntries(rows.map((r) => [r.status, r.total]));
        };

        it("iniciar dos veces a la vez devuelve la misma sesión", async () => {
            for (let round = 0; round < ROUNDS; round++) {
                await executeQuery("DELETE FROM settlement_sessions");

                const responses = await Promise.all([
                    ana.post("/settlement/session"),
                    ana.post("/settlement/session"),
                ]);

                expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
                expect(responses[0].data.session.id).toBe(responses[1].data.session.id);
            }
        });

        it("terminar y descartar a la vez no borra una sesión ya cerrada", async () => {
            for (let round = 0; round < ROUNDS; round++) {
                await resetDatabase();
                ana = await createUser("Ana");
                entity = await createEntity(ana);
                const gasto = await createExpense(ana, entity);
                await ana.post("/settlement/session");
                await mark(ana, gasto);

                const [finished, discarded] = await Promise.all([
                    ana.post("/settlement/session/finish"),
                    ana.delete("/settlement/session"),
                ]);

                const [snapshots] = await executeQuery("SELECT count(*)::int AS total FROM settlement_snapshots");
                const sessions = await sessionsByStatus();
                if (finished.status === 200) {
                    expect(discarded.data.discarded).toBe(false);
                    expect(snapshots.total).toBe(1);
                    expect(sessions.FINISHED).toBe(1);
                    expect(await countMovements(gasto, "PAYMENT")).toBe(1);
                } else {
                    expect(finished.code).toBe("NO_OPEN_SESSION");
                    expect(discarded.data.discarded).toBe(true);
                    expect(snapshots.total).toBe(0);
                    expect(await countMovements(gasto, "PAYMENT")).toBe(0);
                }
                expect(sessions.OPEN ?? 0).toBe(0);
            }
        });

        it("marcar mientras se termina no deja ítems sueltos en una sesión cerrada", async () => {
            for (let round = 0; round < ROUNDS; round++) {
                await resetDatabase();
                ana = await createUser("Ana");
                entity = await createEntity(ana);
                const uno = await createExpense(ana, entity, { name: "Uno" });
                const dos = await createExpense(ana, entity, { name: "Dos" });
                await ana.post("/settlement/session");
                await mark(ana, uno);

                const [finished, marked] = await Promise.all([
                    ana.post("/settlement/session/finish"),
                    mark(ana, dos),
                ]);

                expect(finished.status).toBe(200);
                expect([200, 409]).toContain(marked.status);
                const [snapshot] = await executeQuery("SELECT items FROM settlement_snapshots");
                const snapshotItems =
                    typeof snapshot.items === "string" ? JSON.parse(snapshot.items) : snapshot.items;
                const inSnapshot = snapshotItems.map((item) => Number(item.purchase_id)).sort((a, b) => a - b);
                const items = await executeQuery(
                    `SELECT i.purchase_id FROM settlement_session_items i
                     JOIN settlement_sessions s ON s.id = i.session_id
                     WHERE s.status = 'FINISHED' ORDER BY i.purchase_id`,
                );
                expect(items.map((row) => Number(row.purchase_id))).toEqual(inSnapshot);
            }
        });

        it("pagar una cuota mientras se termina no se traba", async () => {
            for (let round = 0; round < ROUNDS; round++) {
                await resetDatabase();
                ana = await createUser("Ana");
                entity = await createEntity(ana);
                const uno = await createExpense(ana, entity, { name: "Uno" });
                const dos = await createExpense(ana, entity, { name: "Dos" });
                await ana.post("/settlement/session");
                await mark(ana, uno);

                const responses = await Promise.all([
                    ana.post("/settlement/session/finish"),
                    ana.post(`/gastos/${dos}/settle-quota`),
                    ana.post(`/gastos/${uno}/settle-quota`),
                ]);

                expect(responses.map((r) => r.status)).not.toContain(500);
                expect(responses[0].status).toBe(200);
            }
        });
    });

    it("el pago en lote exige una sesión abierta", async () => {
        const gasto = await createExpense(ana, entity);

        const response = await ana.post("/gastos/settle-lote", { purchase_ids: [gasto] });

        expect(response).toMatchObject({ status: 409, code: "SETTLEMENT_REQUIRED" });
        expect(await countMovements(gasto, "PAYMENT")).toBe(0);
    });
});
