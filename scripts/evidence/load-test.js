import os from "node:os";
import autocannon from "autocannon";
import { createAccount, createEntity, createExpense, startStack, writeEvidence } from "./support.js";

const PORT = 3200;
const ENTITIES = 20;
const EXPENSES_PER_ENTITY = 5;
const CONNECTIONS = [10, 25, 50];
const DURATION_SECONDS = 15;
const TARGET_P97_5_MS = 500;
const TARGET_CONNECTIONS = 25;

const runScenario = (baseUrl, token, scenario, connections) =>
    autocannon({
        url: baseUrl,
        connections,
        duration: DURATION_SECONDS,
        timeout: 10,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        requests: scenario.requests,
    });

const summarize = (scenario, connections, result) => ({
    scenario: scenario.name,
    connections,
    duration_seconds: DURATION_SECONDS,
    requests_total: result.requests.total,
    requests_per_second: Math.round(result.requests.average),
    latency_ms: {
        p50: result.latency.p50,
        p90: result.latency.p90,
        p97_5: result.latency.p97_5,
        p99: result.latency.p99,
        max: result.latency.max,
    },
    non_2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
});

const stack = await startStack(PORT);

try {
    const { baseUrl } = stack;
    const account = await createAccount(baseUrl, "Carga");
    const expenseIds = [];
    for (let entityIndex = 0; entityIndex < ENTITIES; entityIndex += 1) {
        const entity = await createEntity(baseUrl, account.token, `Entidad ${entityIndex}`);
        for (let expenseIndex = 0; expenseIndex < EXPENSES_PER_ENTITY; expenseIndex += 1) {
            const expense = await createExpense(baseUrl, account.token, entity.id, {
                name: `Gasto ${entityIndex}-${expenseIndex}`,
            });
            expenseIds.push(expense.id);
        }
    }

    const scenarios = [
        { name: "GET /health", requests: [{ method: "GET", path: "/api/health" }] },
        { name: "GET /dashboard", requests: [{ method: "GET", path: "/api/dashboard" }] },
        {
            name: "GET /gastos/:id",
            requests: expenseIds.slice(0, 10).map((id) => ({ method: "GET", path: `/api/gastos/${id}` })),
        },
        {
            name: "PUT /gastos/:id/favorito",
            requests: expenseIds.slice(0, 10).flatMap((id) => [
                { method: "PUT", path: `/api/gastos/${id}/favorito`, body: JSON.stringify({ favorite: true }) },
                { method: "PUT", path: `/api/gastos/${id}/favorito`, body: JSON.stringify({ favorite: false }) },
            ]),
        },
    ];

    const results = [];
    for (const scenario of scenarios) {
        for (const connections of CONNECTIONS) {
            const result = await runScenario(`http://127.0.0.1:${PORT}`, account.token, scenario, connections);
            const summary = summarize(scenario, connections, result);
            results.push(summary);
            console.log(
                `${summary.scenario} c=${connections}: ${summary.requests_per_second} req/s, p97.5=${summary.latency_ms.p97_5} ms, no-2xx=${summary.non_2xx}, errores=${summary.errors}`,
            );
        }
    }

    const target = writeEvidence("carga.json", {
        generated_at: new Date().toISOString(),
        environment: {
            scope: "API y PostgreSQL locales en la misma máquina, con durabilidad activa. No mide Vercel ni Supabase.",
            node: process.version,
            cpu: os.cpus()[0]?.model,
            logical_cpus: os.cpus().length,
            memory_gb: Math.round(os.totalmem() / 1024 ** 3),
        },
        dataset: { entities: ENTITIES, expenses: ENTITIES * EXPENSES_PER_ENTITY },
        objective: {
            connections: TARGET_CONNECTIONS,
            p97_5_ms_below: TARGET_P97_5_MS,
            non_2xx: 0,
            errors: 0,
        },
        results,
    });
    console.log(`Evidencia: ${target}`);
} finally {
    await stack.stop();
}
