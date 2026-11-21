import postgres from "../../../node_modules/postgres/src/index.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertLocalDatabase(connectionString) {
    const { hostname } = new URL(connectionString);
    if (!LOCAL_HOSTS.has(hostname)) {
        throw new Error("Los tests de integración solo pueden usar una base local");
    }
}

export default function localPostgres(connectionString, options = {}) {
    assertLocalDatabase(connectionString);
    return postgres(connectionString, { ...options, ssl: false, onnotice: () => {} });
}
