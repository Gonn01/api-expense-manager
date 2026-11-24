import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findBinary } from "../../tests/integration/support/global-setup.js";
import { apiRequest, createAccount, createEntity, createExpense, startStack, wait, writeEvidence } from "./support.js";

const PORT = 3201;
const CRASH_EXPENSES = 150;
const CRASH_AFTER_MS = 250;
const RECOVERY_TIMEOUT_MS = 60000;
const TABLES = ["users", "financial_entities", "purchases", "purchases_movements", "notifications"];

function run(binary, args) {
    const result = spawnSync(findBinary(binary), args, { encoding: "utf8", timeout: 60000 });
    if (result.status !== 0) throw new Error(`${binary} falló: ${result.stderr}`);
    return result.stdout.trim();
}

function database(databaseUrl) {
    const url = new URL(databaseUrl);
    const connection = ["-h", url.hostname, "-p", url.port, "-U", url.username];
    const name = url.pathname.slice(1);
    const query = (sql, target = name) => run("psql", [...connection, "-d", target, "-Atc", sql]);
    const dataDirectory = query("SHOW data_directory");
    const logFile = path.join(path.dirname(dataDirectory), "postgres.log");
    return {
        connection,
        name,
        query,
        stop: () => run("pg_ctl", ["stop", "-D", dataDirectory, "-m", "immediate", "-w"]),
        start: () => {
            const result = spawnSync(
                findBinary("pg_ctl"),
                ["start", "-D", dataDirectory, "-l", logFile, "-w", "-o", `-h 127.0.0.1 -p ${url.port}`],
                { stdio: "ignore", timeout: 60000 },
            );
            if (result.status !== 0) throw new Error("pg_ctl no pudo iniciar la base");
        },
    };
}

async function healthStatus(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        return response.status;
    } catch {
        return 0;
    }
}

async function waitForHealth(baseUrl, expected) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < RECOVERY_TIMEOUT_MS) {
        if ((await healthStatus(baseUrl)) === expected) return Date.now() - startedAt;
        await wait(50);
    }
    throw new Error(`/health no llegó a ${expected}`);
}

async function databaseOutage(baseUrl, token, db) {
    const baseline = await apiRequest(baseUrl, "GET", "/dashboard", { token });
    db.stop();
    const detectedMs = await waitForHealth(baseUrl, 503);
    const during = await apiRequest(baseUrl, "GET", "/dashboard", { token });
    const body = JSON.stringify(during.json ?? {});
    const restartedAt = Date.now();
    db.start();
    const databaseStartMs = Date.now() - restartedAt;
    const apiReconnectMs = await waitForHealth(baseUrl, 200);
    const after = await apiRequest(baseUrl, "GET", "/dashboard", { token });
    return {
        baseline_status: baseline.status,
        health_detects_outage_ms: detectedMs,
        business_route_during_outage: during.status,
        leaks_internal_details: /postgres|ECONN|stack|SELECT/i.test(body),
        database_start_ms: databaseStartMs,
        api_reconnect_after_database_start_ms: apiReconnectMs,
        api_process_restarted: false,
        business_route_after_recovery: after.status,
    };
}

async function crashDuringWrites(baseUrl, token, entityId, db) {
    const expenses = [];
    for (let index = 0; index < CRASH_EXPENSES; index += 1) {
        expenses.push(
            await createExpense(baseUrl, token, entityId, { name: `Crash ${index}`, amount: 100, number_of_quotas: 1 }),
        );
    }

    const writes = expenses.map((expense) =>
        apiRequest(baseUrl, "POST", `/gastos/${expense.id}/settle-quota`, { token, body: { direct: true } })
            .then((response) => ({ id: Number(expense.id), acknowledged: response.status === 200 }))
            .catch(() => ({ id: Number(expense.id), acknowledged: false })),
    );
    await wait(CRASH_AFTER_MS);
    db.stop();
    const outcomes = await Promise.all(writes);
    db.start();
    await waitForHealth(baseUrl, 200);

    const ids = expenses.map((expense) => expense.id).join(",");
    const counts = new Map(
        db
            .query(
                `SELECT purchase_id, count(*) FROM purchases_movements
                 WHERE movement_type = 'PAYMENT' AND purchase_id IN (${ids}) GROUP BY purchase_id`,
            )
            .split("\n")
            .filter(Boolean)
            .map((line) => line.split("|").map(Number)),
    );
    const acknowledged = outcomes.filter((outcome) => outcome.acknowledged);
    return {
        concurrent_writes: expenses.length,
        acknowledged_before_crash: acknowledged.length,
        failed_or_interrupted: outcomes.length - acknowledged.length,
        acknowledged_payments_lost: acknowledged.filter((outcome) => !counts.has(outcome.id)).length,
        expenses_with_duplicate_payments: [...counts.values()].filter((count) => count > 1).length,
        persisted_payments: counts.size,
    };
}

function backupAndRestore(db) {
    const directory = mkdtempSync(path.join(tmpdir(), "api-evidence-backup-"));
    const dump = path.join(directory, "backup.dump");
    const restored = "restore_check";
    const fingerprint = (target) =>
        Object.fromEntries(
            TABLES.map((table) => [
                table,
                db.query(
                    `SELECT count(*) || ':' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM public.${table} t`,
                    target,
                ),
            ]),
        );

    try {
        const before = fingerprint(db.name);
        const backupStartedAt = Date.now();
        run("pg_dump", [...db.connection, "-d", db.name, "-Fc", "-f", dump]);
        const backupMs = Date.now() - backupStartedAt;

        db.query(`CREATE DATABASE ${restored}`, "postgres");
        const restoreStartedAt = Date.now();
        run("pg_restore", [...db.connection, "-d", restored, "--no-owner", dump]);
        const restoreMs = Date.now() - restoreStartedAt;
        const after = fingerprint(restored);

        return {
            backup_ms: backupMs,
            restore_ms: restoreMs,
            tables_compared: TABLES.length,
            rows_by_table: Object.fromEntries(TABLES.map((table) => [table, Number(before[table].split(":")[0])])),
            identical_after_restore: TABLES.every((table) => before[table] === after[table]),
        };
    } finally {
        db.query(`DROP DATABASE IF EXISTS ${restored}`, "postgres");
        rmSync(directory, { recursive: true, force: true });
    }
}

const stack = await startStack(PORT);

try {
    const { baseUrl, databaseUrl } = stack;
    const db = database(databaseUrl);
    const account = await createAccount(baseUrl, "Resiliencia");
    const entity = await createEntity(baseUrl, account.token, "Entidad de resiliencia");
    await createExpense(baseUrl, account.token, entity.id);

    const outage = await databaseOutage(baseUrl, account.token, db);
    console.log("Caída de la base:", outage);
    const crash = await crashDuringWrites(baseUrl, account.token, entity.id, db);
    console.log("Caída durante escrituras:", crash);
    const backup = backupAndRestore(db);
    console.log("Backup y restauración:", backup);

    const target = writeEvidence("recuperacion.json", {
        generated_at: new Date().toISOString(),
        environment: "API y PostgreSQL locales, con fsync y commits sincrónicos activos. No mide Vercel ni Supabase.",
        database_outage: outage,
        crash_during_writes: crash,
        backup_restore: backup,
    });
    console.log(`Evidencia: ${target}`);
} finally {
    await stack.stop();
}
