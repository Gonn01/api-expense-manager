import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("../../../migrations/schema.sql", import.meta.url));
const PENDING_MIGRATIONS = [
    fileURLToPath(new URL("../../../migrations/manual/2026-11-21_monedas_bcra.sql", import.meta.url)),
    fileURLToPath(new URL("../../../migrations/manual/2026-11-21_users_push_language.sql", import.meta.url)),
    fileURLToPath(new URL("../../../migrations/manual/2026-11-22_notificaciones.sql", import.meta.url)),
    fileURLToPath(new URL("../../../migrations/manual/2026-11-22_users_identidad_unica.sql", import.meta.url)),
    fileURLToPath(new URL("../../../migrations/manual/2026-11-22_entidades_alias_mercado_pago.sql", import.meta.url)),
];
const DB_USER = "integration";
const DB_NAME = "integration";

function findBinary(name) {
    const executable = process.platform === "win32" ? `${name}.exe` : name;
    const directories = [process.env.PG_BIN];
    if (process.platform === "win32") {
        for (const version of [18, 17, 16]) {
            directories.push(`C:\\Program Files\\PostgreSQL\\${version}\\bin`);
        }
    }
    const found = directories
        .filter(Boolean)
        .map((directory) => path.join(directory, executable))
        .find((candidate) => existsSync(candidate));
    return found ?? executable;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function run(binary, args) {
    execFileSync(findBinary(binary), args, { stdio: ["ignore", "ignore", "pipe"] });
}

function startServer(dataDirectory, logFile, port) {
    execFileSync(
        findBinary("pg_ctl"),
        [
            "start", "-D", dataDirectory, "-l", logFile, "-w",
            "-o", `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
        ],
        { stdio: "ignore", timeout: 30000 },
    );
}

export default async function setup() {
    const directory = mkdtempSync(path.join(tmpdir(), "api-integration-pg-"));
    const dataDirectory = path.join(directory, "data");
    const logFile = path.join(directory, "postgres.log");
    const port = await freePort();

    const stop = () => {
        spawnSync(findBinary("pg_ctl"), ["stop", "-D", dataDirectory, "-m", "immediate", "-w"], {
            stdio: "ignore",
            timeout: 30000,
        });
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };

    try {
        run("initdb", ["-D", dataDirectory, "-U", DB_USER, "-A", "trust", "-E", "UTF8", "--locale=C"]);
        startServer(dataDirectory, logFile, port);
        const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", DB_USER];
        run("psql", [...connection, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${DB_NAME}`]);
        run("psql", [...connection, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA public CASCADE"]);
        run("psql", [...connection, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q", "-f", SCHEMA_PATH]);
        for (const migration of PENDING_MIGRATIONS) {
            run("psql", [...connection, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q", "-f", migration]);
        }
    } catch (error) {
        stop();
        throw new Error(`No se pudo crear el Postgres de test: ${error.stderr?.toString() || error.message}`);
    }

    process.env.DATABASE_URL = `postgres://${DB_USER}@127.0.0.1:${port}/${DB_NAME}`;
    process.env.JWT_SECRET = "secreto-de-integracion";

    return stop;
}
