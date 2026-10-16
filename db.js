import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { DATABASE_URL } from "./config/env.js";
import { logRed, logYellow } from "./utils/logs_custom.js";

const connectionString = DATABASE_URL;
const connection = postgres(connectionString, { ssl: "require" });

/**
 * Transacción en curso del flujo async actual: { sql, afterCommit[] }.
 * `executeQuery` la toma de acá, así los repositorios no reciben la
 * transacción por parámetro: todo lo que corre dentro de `withTransaction`
 * participa de ella automáticamente.
 */
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

/**
 * Corre `fn` dentro de una transacción: si `fn` termina bien se hace COMMIT;
 * si tira, ROLLBACK y el error se propaga. Anidada dentro de otra, se suma a
 * la de afuera (un solo COMMIT al final).
 *
 * Dentro de una transacción las consultas van por una sola conexión: se pueden
 * lanzar en paralelo con Promise.all (se encolan), salvo `bestEffort`, que
 * tiene que correr sola (ver abajo).
 */
export async function withTransaction(fn) {
    if (txStorage.getStore()) return fn();

    const pending = [];
    const result = await connection.begin((sql) =>
        txStorage.run({ sql, afterCommit: pending }, fn),
    );

    // Recién confirmados los cambios se disparan los efectos externos.
    await Promise.allSettled(
        pending.map(async (cb) => {
            try {
                await cb();
            } catch (err) {
                logRed(`[afterCommit] ${err.message}`);
            }
        }),
    );
    return result;
}

/**
 * Efecto externo (notificación en tiempo real, etc.) que solo tiene sentido si
 * los cambios se guardaron: dentro de una transacción se posterga hasta el
 * COMMIT (y se descarta si hay ROLLBACK); fuera de una, corre ya.
 */
export function afterCommit(fn) {
    const store = txStorage.getStore();
    if (!store) return fn();
    store.afterCommit.push(fn);
}

/**
 * Escritura best-effort (p. ej. el historial de una entidad): si falla, no
 * debe arrastrar a la operación principal. En Postgres una consulta fallida
 * aborta toda la transacción aunque el error se atrape en JS, así que dentro
 * de una transacción `fn` corre en un SAVEPOINT: si falla, se deshace solo lo
 * suyo y el error se propaga para que el llamador lo registre y siga.
 *
 * Tiene que esperarse sola (no en un Promise.all con otras consultas de la
 * misma transacción): lo que corra en paralelo quedaría dentro del savepoint.
 */
export async function bestEffort(fn) {
    const store = txStorage.getStore();
    if (!store) return fn();
    return store.sql.savepoint((sp) => txStorage.run({ ...store, sql: sp }, fn));
}
