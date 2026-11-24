import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { DATABASE_SSL, DATABASE_URL } from "./config/env.js";
import { logRed, logYellow } from "./utils/logs_custom.js";

const connectionString = DATABASE_URL;
const connection = postgres(connectionString, {
    ssl: DATABASE_SSL === "disable" ? false : "require",
    idle_timeout: 60 * 5,
    max_lifetime: 60 * 30,
    prepare: false,
});

const EFFECTS_TIMEOUT_MS = 5000;
const txStorage = new AsyncLocalStorage();

const currentSql = () => txStorage.getStore()?.sql ?? connection;

export async function executeQuery(query, values = [], log = false) {
    if (log) {
        logYellow(
            `Ejecutando query: ${query} con valores: ${JSON.stringify(values)}`
        );
    }

    try {
        const results = await currentSql().unsafe(query, values);

        if (log) {
            logYellow(`Query ejecutado con éxito: ${JSON.stringify(results)}`);
        }

        return results;
    } catch (error) {
        logYellow(`Error en executeQuery: ${error.stack}`);
        throw error;
    }
}

export async function withTransaction(fn) {
    if (txStorage.getStore()) return fn();

    const pending = [];
    const result = await connection.begin((sql) =>
        txStorage.run({ sql, afterCommit: pending }, fn),
    );

    await settleEffects(pending);
    return result;
}

async function settleEffects(effects) {
    if (!effects.length) return;

    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            logRed(`[afterCommit] se respondió sin esperar más de ${EFFECTS_TIMEOUT_MS} ms`);
            resolve();
        }, EFFECTS_TIMEOUT_MS);
    });
    await Promise.race([Promise.all(effects.map(runEffect)), timeout]);
    clearTimeout(timer);
}

async function runEffect(fn) {
    try {
        await fn();
    } catch (err) {
        logRed(`[afterCommit] ${err.message}`);
    }
}

export function afterCommit(fn) {
    const store = txStorage.getStore();
    if (!store) return settleEffects([fn]);
    store.afterCommit.push(fn);
}

export async function bestEffort(fn) {
    const store = txStorage.getStore();
    if (!store) return fn();
    return store.sql.savepoint((sp) => txStorage.run({ ...store, sql: sp }, fn));
}
