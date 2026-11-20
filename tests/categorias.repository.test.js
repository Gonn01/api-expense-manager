import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn(async () => []);
vi.mock("../db.js", () => ({ executeQuery, withTransaction: (fn) => fn() }));

const { CategoriasRepository } = await import("../repositories/categorias.repository.js");

const GASTO = 10;

describe("CategoriasRepository.addCategoriasToNewGasto: SQL que se envía", () => {
    let repository;

    beforeEach(() => {
        executeQuery.mockClear();
        repository = new CategoriasRepository();
    });

    it("con una categoría usa $2 como parámetro y manda [gastoId, categoría]", async () => {
        await repository.addCategoriasToNewGasto(GASTO, [5]);

        const [sql, params] = executeQuery.mock.calls[0];
        expect(sql).toContain("($1, $2, NOW())");
        expect(params).toEqual([GASTO, 5]);
    });

    it("con dos categorías usa $2 y $3 y manda [gastoId, cat1, cat2]", async () => {
        await repository.addCategoriasToNewGasto(GASTO, [5, 8]);

        const [sql, params] = executeQuery.mock.calls[0];
        expect(sql).toContain("($1, $2, NOW()), ($1, $3, NOW())");
        expect(params).toEqual([GASTO, 5, 8]);
    });

    it("sin categorías devuelve [] y no ejecuta ninguna consulta", async () => {
        await expect(repository.addCategoriasToNewGasto(GASTO, [])).resolves.toEqual([]);

        expect(executeQuery).not.toHaveBeenCalled();
    });
});
