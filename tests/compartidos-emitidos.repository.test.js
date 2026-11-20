import { describe, it, expect, vi, beforeAll } from "vitest";

const executeQuery = vi.fn(async () => []);
vi.mock("../db.js", () => ({ executeQuery }));

const { GastosRepository } = await import("../repositories/gastos.repository.js");

const USER = 2;

const statusesIn = (sql, alias) => {
    const match = sql.match(new RegExp(`${alias}\\.status IN \\(([^)]*)\\)`));
    if (!match) return null;
    return match[1].split(",").map((s) => s.trim().replace(/'/g, ""));
};

describe("GastosRepository.getCompartidosEmitidos: qué gastos enviados devuelve", () => {
    let sql;
    let params;
    let originalStatuses;
    let copyStatuses;

    const apareceEnEnviados = (originalStatus, copyStatus) =>
        originalStatuses.includes(originalStatus) && copyStatuses.includes(copyStatus);

    beforeAll(async () => {
        await new GastosRepository().getCompartidosEmitidos(USER);
        [sql, params] = executeQuery.mock.calls[0];
        originalStatuses = statusesIn(sql, "p");
        copyStatuses = statusesIn(sql, "copy");
    });

    it("filtra por el usuario emisor y devuelve el estado de la copia", () => {
        expect(params).toEqual([USER]);
        expect(sql).toMatch(/copy\.status AS copy_status/);
        expect(originalStatuses).not.toBeNull();
        expect(copyStatuses).not.toBeNull();
    });

    it("un gasto compartido recién creado aparece en enviados como pendiente", () => {
        expect(apareceEnEnviados("PENDING_APPROVAL", "PENDING_APPROVAL")).toBe(true);
    });

    it("un gasto rechazado aparece en enviados, para poder reintentarlo", () => {
        expect(apareceEnEnviados("REJECTED", "REJECTED")).toBe(true);
    });

    it("un gasto aprobado no aparece en enviados", () => {
        expect(apareceEnEnviados("ACTIVE", "ACTIVE")).toBe(false);
    });
});
