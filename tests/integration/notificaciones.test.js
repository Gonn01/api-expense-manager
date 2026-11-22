import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    createEntity,
    createSharedExpense,
    createUser,
    resetDatabase,
    settleNotifications,
    startApi,
    stopApi,
} from "./support/harness.js";

let ana;
let beto;
let carla;

beforeAll(startApi);
afterAll(stopApi);

beforeEach(async () => {
    await resetDatabase();
    ana = await createUser("Ana");
    beto = await createUser("Beto");
    carla = await createUser("Carla");
});

async function feed(user, query = "") {
    await settleNotifications();
    const response = await user.get(`/notificaciones${query}`);
    expect(response.status).toBe(200);
    return response.data;
}

const events = (data) => data.items.map((item) => item.event);

describe("notificaciones", () => {
    it("guarda el gasto recibido con quién lo envió y su nombre", async () => {
        const entity = await createEntity(ana, "Con Beto");
        await ana.put(`/entidades-financieras/${entity}/vincular-usuario`, { email: beto.email });
        await ana.post("/gastos", {
            financial_entity_id: entity,
            name: "Alquiler",
            amount: 300,
            number_of_quotas: 1,
            currency_type: "ARS",
            fixed_expense: false,
            type: "EGRESO",
        });

        const data = await feed(beto);

        expect(events(data)).toEqual(["compartido.nuevo", "entidad.vinculada"]);
        expect(data.items[0].data).toMatchObject({ actorName: "Ana", gastoName: "Alquiler" });
        expect(data.unread_count).toBe(2);
    });

    it("avisa la baja de una entidad vinculada e indica la entidad propia de quien recibe", async () => {
        const { ownerEntity } = await createSharedExpense(ana, beto);
        const inicial = await feed(beto);
        const entityDeBeto = (await beto.get("/entidades-financieras")).data.find(
            (e) => Number(e.linked_user_id) === ana.id,
        );

        await ana.delete(`/entidades-financieras/${ownerEntity}`);
        const data = await feed(beto);
        const aviso = data.items.find((item) => item.event === "entidad.desvinculada");

        expect(data.items.length).toBeGreaterThan(inicial.items.length);
        expect(aviso.data).toMatchObject({ actorName: "Ana" });
        expect(String(aviso.data.entityId)).toBe(String(entityDeBeto.id));
    });

    it("renombrar un gasto compartido pide aprobación y al aprobarse cambia en las dos copias", async () => {
        const { ownerExpense, copyId } = await createSharedExpense(ana, beto);

        const directo = await ana.put(`/gastos/${ownerExpense}`, { name: "Nuevo nombre" });
        expect(directo.status).toBe(409);
        expect(directo.code).toBe("GASTO_CAMPO_NO_EDITABLE");

        const pedido = await ana.post(`/notificaciones/pendientes/gastos/${ownerExpense}/edicion`, {
            name: "Nuevo nombre",
        });
        expect(pedido.status).toBe(200);
        expect((await ana.get(`/gastos/${ownerExpense}`)).data.name).toBe("Gasto");
        expect(events(await feed(beto))[0]).toBe("edicion.solicitada");

        const aprobado = await beto.post(`/notificaciones/pendientes/ediciones/${pedido.data.id}/aprobar`);
        expect(aprobado.status).toBe(200);
        expect((await ana.get(`/gastos/${ownerExpense}`)).data.name).toBe("Nuevo nombre");
        expect((await beto.get(`/gastos/${copyId}`)).data.name).toBe("Nuevo nombre");
        expect(events(await feed(ana))[0]).toBe("edicion.aprobada");
    });

    it("avisa la postergación de un gasto compartido", async () => {
        const { ownerExpense } = await createSharedExpense(ana, beto);

        await ana.put(`/gastos/${ownerExpense}/postergar`, { postponed: true });

        expect(events(await feed(beto))[0]).toBe("gasto.postergado");
    });

    it("no notifica a quien hizo la acción", async () => {
        const { ownerExpense } = await createSharedExpense(ana, beto);
        const antes = await feed(ana);

        await ana.put(`/gastos/${ownerExpense}/postergar`, { postponed: true });

        expect((await feed(ana)).items).toHaveLength(antes.items.length);
    });

    it("cada usuario ve y marca solo sus notificaciones", async () => {
        await createSharedExpense(ana, beto);
        const { items, unread_count: noLeidas } = await feed(beto);

        expect((await feed(carla)).items).toHaveLength(0);
        await carla.post(`/notificaciones/${items[0].id}/leer`);
        expect((await feed(beto)).unread_count).toBe(noLeidas);

        const marcada = await beto.post(`/notificaciones/${items[0].id}/leer`);
        expect(marcada.data.unread_count).toBe(noLeidas - 1);

        await beto.post("/notificaciones/leer-todas");
        expect((await feed(beto)).unread_count).toBe(0);
    });

    it("pagina con el cursor sin repetir", async () => {
        const entity = await createEntity(ana, "Con Beto");
        await ana.put(`/entidades-financieras/${entity}/vincular-usuario`, { email: beto.email });
        await ana.delete(`/entidades-financieras/${entity}/vincular-usuario`);
        await ana.put(`/entidades-financieras/${entity}/vincular-usuario`, { email: beto.email });

        const primera = await feed(beto, "?limit=2");
        const segunda = await feed(beto, `?limit=2&before=${primera.next_before}`);

        expect(primera.items).toHaveLength(2);
        expect(segunda.items).toHaveLength(1);
        expect(segunda.next_before).toBeNull();
        expect(primera.items.map((i) => i.id)).not.toContain(segunda.items[0].id);
    });
});
