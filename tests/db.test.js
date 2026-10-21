import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const makeSql = (name) => ({
    name,
    unsafe: vi.fn(async (query) => {
        calls.push([name, query]);
        return [];
    }),
    savepoint: vi.fn(async (cb) => cb(makeSql(`${name}>savepoint`))),
});
const connection = {
    ...makeSql("pool"),
    begin: vi.fn(async (cb) => cb(makeSql("tx"))),
};
vi.mock("postgres", () => ({ default: () => connection }));

const { executeQuery, withTransaction, afterCommit, bestEffort } = await import("../db.js");

describe("db: transacciones", () => {
    beforeEach(() => {
        calls.length = 0;
        connection.begin.mockClear();
    });

    it("fuera de una transacción, las consultas van al pool", async () => {
        await executeQuery("SELECT 1");
        expect(calls).toEqual([["pool", "SELECT 1"]]);
    });

    it("dentro de withTransaction, todas las consultas usan la transacción", async () => {
        await withTransaction(async () => {
            await executeQuery("INSERT a");
            await Promise.all([executeQuery("INSERT b"), executeQuery("INSERT c")]);
        });

        expect(connection.begin).toHaveBeenCalledTimes(1);
        expect(calls.map(([sql]) => sql)).toEqual(["tx", "tx", "tx"]);
    });

    it("una transacción anidada se suma a la de afuera", async () => {
        await withTransaction(async () => {
            await withTransaction(() => executeQuery("INSERT a"));
        });

        expect(connection.begin).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([["tx", "INSERT a"]]);
    });

    it("devuelve el resultado de la función y propaga sus errores", async () => {
        await expect(withTransaction(async () => 42)).resolves.toBe(42);
        await expect(withTransaction(async () => { throw new Error("falla"); })).rejects.toThrow("falla");
    });

    it("afterCommit corre después del commit, y no corre si hubo rollback", async () => {
        const efecto = vi.fn();

        await withTransaction(async () => {
            afterCommit(efecto);
            expect(efecto).not.toHaveBeenCalled();
        });
        expect(efecto).toHaveBeenCalledTimes(1);

        efecto.mockClear();
        await expect(
            withTransaction(async () => {
                afterCommit(efecto);
                throw new Error("rollback");
            }),
        ).rejects.toThrow("rollback");
        expect(efecto).not.toHaveBeenCalled();
    });

    it("afterCommit fuera de una transacción corre en el momento", async () => {
        const efecto = vi.fn();
        afterCommit(efecto);
        expect(efecto).toHaveBeenCalledTimes(1);
    });

    it("un afterCommit que falla no hace fallar la operación", async () => {
        await expect(
            withTransaction(async () => {
                afterCommit(() => { throw new Error("pusher caído"); });
                return "ok";
            }),
        ).resolves.toBe("ok");
    });

    it("bestEffort corre en un savepoint dentro de una transacción", async () => {
        await withTransaction(async () => {
            await bestEffort(() => executeQuery("INSERT log"));
            await executeQuery("INSERT principal");
        });

        expect(calls).toEqual([
            ["tx>savepoint", "INSERT log"],
            ["tx", "INSERT principal"],
        ]);
    });

    it("bestEffort fuera de una transacción corre directo", async () => {
        await bestEffort(() => executeQuery("INSERT log"));
        expect(calls).toEqual([["pool", "INSERT log"]]);
    });
});
