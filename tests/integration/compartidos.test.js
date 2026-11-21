import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    countMovements,
    createSharedExpense,
    createUser,
    executeQuery,
    latestMovement,
    paidQuotas,
    resetDatabase,
    sentEvents,
    startApi,
    stopApi,
} from "./support/harness.js";

let ana;
let beto;
let carla;
let shared;

beforeAll(startApi);
afterAll(stopApi);

beforeEach(async () => {
    await resetDatabase();
    ana = await createUser("Ana");
    beto = await createUser("Beto");
    carla = await createUser("Carla");
    shared = await createSharedExpense(ana, beto);
    sentEvents.length = 0;
});

async function payAsAna() {
    await ana.post(`/gastos/${shared.ownerExpense}/settle-quota`, { direct: true });
    return latestMovement(shared.ownerExpense, "PENDING_PAYMENT");
}

async function confirmedPayment() {
    const pending = await payAsAna();
    await beto.post(`/compartidos/pagos/${pending.id}/confirmar`);
    return pending;
}

describe("aprobación", () => {
    it("deja activas las dos copias", async () => {
        const rows = await executeQuery("SELECT status FROM purchases ORDER BY id");

        expect(rows.map((r) => r.status)).toEqual(["ACTIVE", "ACTIVE"]);
    });

    it("un tercero no puede aprobar", async () => {
        const otro = await createSharedExpense(ana, carla);
        await executeQuery("UPDATE purchases SET status = 'PENDING_APPROVAL' WHERE id = $1", [otro.copyId]);

        const response = await beto.post(`/compartidos/${otro.copyId}/aprobar`, { new_entity_name: "X" });

        expect(response.status).toBe(403);
    });
});

describe("pago compartido", () => {
    it("queda pendiente hasta que la otra persona confirma", async () => {
        const pending = await payAsAna();

        expect(pending).toBeTruthy();
        expect(await countMovements(shared.ownerExpense, "PAYMENT")).toBe(0);
        expect(await countMovements(shared.copyId, "PAYMENT")).toBe(0);
    });

    it("al confirmarse registra el pago en las dos copias y los vincula", async () => {
        const pending = await payAsAna();

        const response = await beto.post(`/compartidos/pagos/${pending.id}/confirmar`);

        const own = await latestMovement(shared.ownerExpense, "PAYMENT");
        const mirror = await latestMovement(shared.copyId, "PAYMENT");
        expect(response.status).toBe(200);
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(1);
        expect(await paidQuotas(beto, shared.copyId)).toBe(1);
        expect(Number(own.paired_movement_id)).toBe(Number(mirror.id));
        expect(Number(mirror.paired_movement_id)).toBe(Number(own.id));
        expect(sentEvents.map((e) => e.event)).toContain("pago.confirmado");
    });

    it("quien pagó no puede confirmar su propio pago", async () => {
        const pending = await payAsAna();

        const response = await ana.post(`/compartidos/pagos/${pending.id}/confirmar`);

        expect(response.status).toBe(403);
        expect(await countMovements(shared.ownerExpense, "PAYMENT")).toBe(0);
    });

    it("un tercero no puede confirmar", async () => {
        const pending = await payAsAna();

        const response = await carla.post(`/compartidos/pagos/${pending.id}/confirmar`);

        expect(response.status).toBe(403);
        expect(await countMovements(shared.ownerExpense, "PAYMENT")).toBe(0);
    });

    it("dos confirmaciones simultáneas registran un solo pago", async () => {
        const pending = await payAsAna();

        await Promise.all([
            beto.post(`/compartidos/pagos/${pending.id}/confirmar`),
            beto.post(`/compartidos/pagos/${pending.id}/confirmar`),
        ]);

        expect(await countMovements(shared.ownerExpense, "PAYMENT")).toBe(1);
        expect(await countMovements(shared.copyId, "PAYMENT")).toBe(1);
    });

    it("pagos simultáneos de quien pagó dejan un solo pendiente en la última cuota", async () => {
        const unaCuota = await createSharedExpense(ana, carla, { amount: 100, number_of_quotas: 1 });

        await Promise.all(
            Array.from({ length: 5 }, () =>
                ana.post(`/gastos/${unaCuota.ownerExpense}/settle-quota`, { direct: true }),
            ),
        );

        expect(await countMovements(unaCuota.ownerExpense, "PENDING_PAYMENT")).toBe(1);
    });

    it("si las dos personas pagan a la vez la cuota queda confirmada una sola vez", async () => {
        const unaCuota = await createSharedExpense(ana, carla, { amount: 100, number_of_quotas: 1 });

        await Promise.all([
            ana.post(`/gastos/${unaCuota.ownerExpense}/settle-quota`, { direct: true }),
            carla.post(`/gastos/${unaCuota.copyId}/settle-quota`, { direct: true }),
        ]);

        expect(await countMovements(unaCuota.ownerExpense, "PAYMENT")).toBe(1);
        expect(await countMovements(unaCuota.copyId, "PAYMENT")).toBe(1);
        expect(await countMovements(unaCuota.ownerExpense, "PENDING_PAYMENT")).toBe(0);
        expect(await countMovements(unaCuota.copyId, "PENDING_PAYMENT")).toBe(0);
    });

    it("rechazarlo conserva el historial sin sumar cuotas", async () => {
        const pending = await payAsAna();

        await beto.post(`/compartidos/pagos/${pending.id}/rechazar`);

        expect(await countMovements(shared.ownerExpense, "PAYMENT_REJECTED")).toBe(1);
        expect(await countMovements(shared.ownerExpense, "PENDING_PAYMENT")).toBe(0);
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(0);
    });

    it("quien pagó puede retirarlo y la otra persona no", async () => {
        const pending = await payAsAna();

        const denied = await beto.post(`/compartidos/pagos/${pending.id}/retirar`);
        const allowed = await ana.post(`/compartidos/pagos/${pending.id}/retirar`);

        expect(denied.status).toBe(403);
        expect(allowed.status).toBe(200);
        expect(await countMovements(shared.ownerExpense, "PAYMENT_WITHDRAWN")).toBe(1);
    });
});

describe("reversión", () => {
    async function requestReversal() {
        await confirmedPayment();
        const payment = await latestMovement(shared.ownerExpense, "PAYMENT");
        const response = await ana.post(`/gastos/${shared.ownerExpense}/pagos/${payment.id}/revertir`);
        return { payment, response };
    }

    it("solicitarla no cambia las cuotas", async () => {
        const { response } = await requestReversal();

        expect(response.status).toBe(200);
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(1);
        expect(await paidQuotas(beto, shared.copyId)).toBe(1);
    });

    it("aceptarla devuelve la cuota en las dos copias y deja un REFUND", async () => {
        const { payment } = await requestReversal();

        const response = await beto.post(`/compartidos/pagos/${payment.id}/reversion/aceptar`);

        expect(response.status).toBe(200);
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(0);
        expect(await paidQuotas(beto, shared.copyId)).toBe(0);
        expect(await countMovements(shared.ownerExpense, "REFUND")).toBe(1);
        expect(await countMovements(shared.copyId, "REFUND")).toBe(1);
    });

    it("quien la pidió no puede aceptarla", async () => {
        const { payment } = await requestReversal();

        const response = await ana.post(`/compartidos/pagos/${payment.id}/reversion/aceptar`);

        expect(response.status).toBe(403);
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(1);
    });

    it("rechazarla mantiene el pago", async () => {
        const { payment } = await requestReversal();

        await beto.post(`/compartidos/pagos/${payment.id}/reversion/rechazar`);

        const current = await latestMovement(shared.ownerExpense, "PAYMENT");
        expect(current.reversal_requested_by_user_id).toBeNull();
        expect(await paidQuotas(ana, shared.ownerExpense)).toBe(1);
    });
});

describe("baja de una entidad compartida", () => {
    it("rechaza los pagos pendientes de la contraparte", async () => {
        await beto.post(`/gastos/${shared.copyId}/settle-quota`, { direct: true });

        const [row] = await executeQuery(
            "SELECT financial_entity_id FROM purchases WHERE id = $1",
            [shared.ownerExpense],
        );
        await ana.delete(`/entidades-financieras/${row.financial_entity_id}`);

        expect(await countMovements(shared.copyId, "PENDING_PAYMENT")).toBe(0);
        expect(await countMovements(shared.copyId, "PAYMENT_REJECTED")).toBe(1);
    });
});
