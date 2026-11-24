import { fork } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STARTUP_ATTEMPTS = 120;
const STARTUP_DELAY_MS = 500;
const SHUTDOWN_TIMEOUT_MS = 20000;

export const PASSWORD = "secreta123";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function evidencePath(fileName) {
    const directory = process.argv[2];
    if (!directory) throw new Error("Indicá la carpeta de salida de la evidencia");
    mkdirSync(directory, { recursive: true });
    return path.join(directory, fileName);
}

export function writeEvidence(fileName, data) {
    const target = evidencePath(fileName);
    writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
    return target;
}

export async function startStack(port) {
    let databaseUrl = null;
    const child = fork(path.join(API_DIRECTORY, "scripts", "local-stack.js"), [], {
        cwd: API_DIRECTORY,
        env: { ...process.env, PORT: String(port), LOCAL_DB_DURABLE: "1" },
        stdio: ["ignore", "pipe", "inherit", "ipc"],
    });

    child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/DATABASE_READY (\S+)/);
        if (match) databaseUrl = match[1];
    });

    const baseUrl = `http://127.0.0.1:${port}/api`;
    const stop = () =>
        new Promise((resolve) => {
            if (child.exitCode !== null) {
                resolve();
                return;
            }
            const timer = setTimeout(() => {
                child.kill();
                resolve();
            }, SHUTDOWN_TIMEOUT_MS);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
            child.send("shutdown");
        });

    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
        if (child.exitCode !== null) throw new Error("La API local terminó antes de iniciar");
        const healthy = await fetch(`${baseUrl}/health`)
            .then((response) => response.ok)
            .catch(() => false);
        if (healthy && databaseUrl) return { baseUrl, databaseUrl, stop };
        await wait(STARTUP_DELAY_MS);
    }

    await stop();
    throw new Error("La API local no respondió a tiempo");
}

export async function apiRequest(baseUrl, method, route, { token, body } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, data: json?.data, json };
}

export async function createAccount(baseUrl, name) {
    const email = `${name.toLowerCase()}-${Date.now()}@test.com`;
    await apiRequest(baseUrl, "POST", "/auth/register", { body: { name, email, password: PASSWORD } });
    const { data } = await apiRequest(baseUrl, "POST", "/auth/login", {
        body: { email, password: PASSWORD },
    });
    return { ...data, email };
}

export async function createEntity(baseUrl, token, name) {
    const { status, data } = await apiRequest(baseUrl, "POST", "/entidades-financieras", {
        token,
        body: { name },
    });
    if (status !== 201) throw new Error(`No se pudo crear la entidad: ${status}`);
    return data;
}

export async function createExpense(baseUrl, token, entityId, overrides = {}) {
    const { status, data } = await apiRequest(baseUrl, "POST", "/gastos", {
        token,
        body: {
            financial_entity_id: entityId,
            name: "Gasto de prueba",
            amount: 300,
            number_of_quotas: 3,
            currency_type: "ARS",
            fixed_expense: false,
            type: "EGRESO",
            ...overrides,
        },
    });
    if (status !== 201) throw new Error(`No se pudo crear el gasto: ${status}`);
    return data;
}
