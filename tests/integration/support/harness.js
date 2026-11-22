import express from "express";
import jwt from "jsonwebtoken";
import { executeQuery } from "../../../db.js";
import routesIndex from "../../../routes/index.js";
import { errorMiddleware } from "../../../utils/errors.js";
import { sentEvents, settleNotifications } from "./fake-pusher.js";
import { assertLocalDatabase } from "./postgres-local.js";

const TABLES = [
    "notifications",
    "purchase_edit_requests",
    "settlement_session_items",
    "settlement_snapshots",
    "settlement_sessions",
    "purchases_categories",
    "purchases_movements",
    "purchases",
    "financial_entities_movements",
    "financial_entities",
    "user_categories",
    "users",
];

let server;
let baseUrl;

export async function startApi() {
    const app = express();
    app.use(express.json());
    app.use("/api", routesIndex);
    app.use(errorMiddleware);
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

export async function stopApi() {
    await new Promise((resolve) => server.close(resolve));
}

export async function resetDatabase() {
    assertLocalDatabase(process.env.DATABASE_URL);
    await settleNotifications();
    await executeQuery(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    sentEvents.length = 0;
}

export async function createUser(name) {
    const email = `${name.toLowerCase()}@test.com`;
    const [row] = await executeQuery(
        "INSERT INTO users (name, email, password) VALUES ($1, $2, 'hash') RETURNING id",
        [name, email],
    );
    const id = Number(row.id);
    const token = jwt.sign({ userId: id }, process.env.JWT_SECRET);

    async function call(method, path, body) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await response.json().catch(() => null);
        return { status: response.status, data: json?.data, code: json?.code };
    }

    return {
        id,
        email,
        get: (path) => call("GET", path),
        post: (path, body = {}) => call("POST", path, body),
        put: (path, body = {}) => call("PUT", path, body),
        delete: (path, body) => call("DELETE", path, body),
    };
}

export async function createEntity(user, name = "Banco") {
    const response = await user.post("/entidades-financieras", { name });
    if (response.status !== 201) throw new Error(`No se pudo crear la entidad: ${response.status}`);
    return Number(response.data.id);
}

export async function createExpense(user, entityId, overrides = {}) {
    const response = await user.post("/gastos", {
        financial_entity_id: entityId,
        name: "Gasto",
        amount: 300,
        number_of_quotas: 3,
        currency_type: "ARS",
        fixed_expense: false,
        type: "EGRESO",
        ...overrides,
    });
    if (response.status !== 201) {
        throw new Error(`No se pudo crear el gasto: ${response.status} ${response.code}`);
    }
    return Number(response.data.id);
}

export async function createSharedExpense(owner, receiver, overrides = {}) {
    const ownerEntity = await createEntity(owner, `Con ${receiver.email}`);
    await owner.put(`/entidades-financieras/${ownerEntity}/vincular-usuario`, { email: receiver.email });
    const ownerExpense = await createExpense(owner, ownerEntity, overrides);
    const [copy] = await executeQuery("SELECT id FROM purchases WHERE shared_from_id = $1", [ownerExpense]);
    const copyId = Number(copy.id);
    const approved = await receiver.post(`/notificaciones/pendientes/${copyId}/aprobar`, {
        new_entity_name: `De ${owner.email}`,
    });
    if (approved.status !== 200) throw new Error(`No se pudo aprobar: ${approved.status} ${approved.code}`);
    return { ownerEntity, ownerExpense, copyId };
}

export async function countMovements(purchaseId, type) {
    const [row] = await executeQuery(
        "SELECT count(*)::int AS total FROM purchases_movements WHERE purchase_id = $1 AND movement_type = $2",
        [purchaseId, type],
    );
    return row.total;
}

export async function latestMovement(purchaseId, type) {
    const [row] = await executeQuery(
        `SELECT * FROM purchases_movements
         WHERE purchase_id = $1 AND movement_type = $2
         ORDER BY id DESC LIMIT 1`,
        [purchaseId, type],
    );
    return row ?? null;
}

export async function paidQuotas(user, purchaseId) {
    const response = await user.get(`/gastos/${purchaseId}`);
    return Number(response.data.payed_quotas);
}

export { executeQuery, sentEvents, settleNotifications };
