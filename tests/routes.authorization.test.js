import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";

const TEST_SECRET = "secreto-de-test";

const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }));

vi.mock("../config/env.js", () => ({
    JWT_SECRET: "secreto-de-test",
    DATABASE_URL: "postgres://no-usar",
    BEAMS_INSTANCE_ID: undefined,
    BEAMS_SECRET_KEY: undefined,
}));
vi.mock("../db.js", () => ({
    executeQuery,
    withTransaction: (fn) => fn(),
    bestEffort: (fn) => fn(),
    afterCommit: (fn) => fn(),
}));
vi.mock("../utils/pusher.js", () => ({
    pusher: { trigger: vi.fn() },
    triggerCompartidos: vi.fn(),
}));
vi.mock("../utils/logs_custom.js", () => ({
    logBlue: vi.fn(),
    logGray: vi.fn(),
    logRed: vi.fn(),
    logGreen: vi.fn(),
    logYellow: vi.fn(),
}));

const { default: routesIndex } = await import("../routes/index.js");

const PROTECTED_ROUTES = [
    ["put", "/user/preferred-currency"],
    ["put", "/user/sueldo"],
    ["get", "/user/password-status"],
    ["put", "/user/password"],
    ["get", "/user/push-token"],
    ["put", "/user/push-language"],
    ["get", "/entidades-financieras"],
    ["get", "/entidades-financieras/1"],
    ["post", "/entidades-financieras"],
    ["delete", "/entidades-financieras/1"],
    ["put", "/entidades-financieras/1"],
    ["put", "/entidades-financieras/1/restaurar"],
    ["put", "/entidades-financieras/1/favorito"],
    ["put", "/entidades-financieras/1/vincular-usuario"],
    ["delete", "/entidades-financieras/1/vincular-usuario"],
    ["get", "/dashboard"],
    ["post", "/gastos"],
    ["get", "/gastos/1"],
    ["put", "/gastos/1"],
    ["delete", "/gastos/1"],
    ["put", "/gastos/1/categorias"],
    ["put", "/gastos/1/postergar"],
    ["put", "/gastos/1/favorito"],
    ["post", "/gastos/1/settle-quota"],
    ["post", "/gastos/1/refund-cuota"],
    ["post", "/gastos/1/pagos/2/revertir"],
    ["post", "/gastos/1/restaurar"],
    ["post", "/gastos/1/compartir"],
    ["post", "/gastos/settle-lote"],
    ["get", "/categorias"],
    ["post", "/categorias"],
    ["get", "/notificaciones"],
    ["post", "/notificaciones/leer-todas"],
    ["post", "/notificaciones/1/leer"],
    ["get", "/notificaciones/pendientes"],
    ["post", "/notificaciones/pendientes/pagos/1/confirmar"],
    ["post", "/notificaciones/pendientes/pagos/1/rechazar"],
    ["post", "/notificaciones/pendientes/pagos/1/retirar"],
    ["post", "/notificaciones/pendientes/pagos/1/reversion/aceptar"],
    ["post", "/notificaciones/pendientes/pagos/1/reversion/rechazar"],
    ["post", "/notificaciones/pendientes/pagos/1/reversion/cancelar"],
    ["post", "/notificaciones/pendientes/gastos/1/edicion"],
    ["post", "/notificaciones/pendientes/ediciones/1/aprobar"],
    ["post", "/notificaciones/pendientes/ediciones/1/rechazar"],
    ["post", "/notificaciones/pendientes/ediciones/1/cancelar"],
    ["post", "/notificaciones/pendientes/1/aprobar"],
    ["post", "/notificaciones/pendientes/1/rechazar"],
    ["post", "/notificaciones/pendientes/1/reintentar"],
    ["post", "/notificaciones/pendientes/1/descartar"],
    ["get", "/settlement/session"],
    ["post", "/settlement/session"],
    ["put", "/settlement/session/items"],
    ["post", "/settlement/session/finish"],
    ["delete", "/settlement/session"],
    ["get", "/settlement/snapshots"],
    ["get", "/settlement/snapshots/1"],
];

let server;
let baseUrl;

function request(method, path, { token, body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, {
        method: method.toUpperCase(),
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
}

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", routesIndex);
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue([]);
});

describe("rutas protegidas", () => {
    it.each(PROTECTED_ROUTES)("%s %s responde 401 sin token y no consulta la base", async (method, path) => {
        const response = await request(method, path);

        expect(response.status).toBe(401);
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it.each(PROTECTED_ROUTES)("%s %s responde 401 con un token firmado con otro secreto", async (method, path) => {
        const token = jwt.sign({ userId: 42 }, "otro-secreto");

        const response = await request(method, path, { token });

        expect(response.status).toBe(401);
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("responde 401 con un token vencido", async () => {
        const token = jwt.sign({ userId: 42 }, TEST_SECRET, { expiresIn: -10 });

        const response = await request("get", "/dashboard", { token });

        expect(response.status).toBe(401);
        expect(executeQuery).not.toHaveBeenCalled();
    });
});

describe("identidad del usuario", () => {
    const token = () => jwt.sign({ userId: 42 }, TEST_SECRET);

    it("busca la entidad con el usuario del token", async () => {
        const response = await request("get", "/entidades-financieras/5", { token: token() });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.code).toBe("ENTIDAD_NOT_FOUND");
        expect(executeQuery.mock.calls[0][1]).toEqual(["5", 42]);
    });

    it("ignora un userId enviado en el body", async () => {
        executeQuery.mockImplementation(async (query) =>
            /INSERT/i.test(query) ? [{ id: 1, name: "Banco" }] : [],
        );

        const response = await request("post", "/entidades-financieras", {
            token: token(),
            body: { name: "Banco", userId: 99, user_id: 99 },
        });

        const values = executeQuery.mock.calls.flatMap(([, params]) => params ?? []);
        expect(response.status).toBe(201);
        expect(values).toContain(42);
        expect(values).not.toContain(99);
    });
});

describe("rutas públicas", () => {
    it("health no exige token", async () => {
        executeQuery.mockResolvedValue([{ ok: 1 }]);

        const response = await request("get", "/health");

        expect(response.status).toBe(200);
    });

    it("login no exige token", async () => {
        const response = await request("post", "/auth/login", { body: {} });

        expect(response.status).not.toBe(401);
    });
});
