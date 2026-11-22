import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn(async () => []);
vi.mock("../db.js", () => ({ executeQuery }));

const { GastosRepository } = await import("../repositories/gastos.repository.js");

describe("GastosRepository: pagos de un gasto compartido sin aprobar", () => {
    let repository;

    beforeEach(() => {
        executeQuery.mockClear();
        repository = new GastosRepository();
    });

    const sqlDe = () => executeQuery.mock.calls[0][0];

    it("getSharedSibling por defecto solo encuentra copias aprobadas", async () => {
        await repository.getSharedSibling(10);

        expect(sqlDe()).toContain("sib.status = 'ACTIVE'");
        expect(sqlDe()).not.toContain("PENDING_APPROVAL");
    });

    it("getSharedSibling para pagar encuentra también la copia pendiente y devuelve su estado", async () => {
        await repository.getSharedSibling(10, { includePendingApproval: true });

        expect(sqlDe()).toContain("sib.status IN ('ACTIVE', 'PENDING_APPROVAL')");
        expect(sqlDe()).toContain("sib.status AS sibling_status");
    });

    it("getSharedSiblings para pagar en lote encuentra también las copias pendientes", async () => {
        await repository.getSharedSiblings(["10", "11"], { includePendingApproval: true });

        const [sql, params] = executeQuery.mock.calls[0];
        expect(sql).toContain("sib.status IN ('ACTIVE', 'PENDING_APPROVAL')");
        expect(params).toEqual(["10", "11"]);
    });

    it("la otra persona solo ve por confirmar los pagos de un gasto que ya aprobó; quien pagó los ve siempre", async () => {
        await repository.getPagosCompartidos(2);

        const [sql, params] = executeQuery.mock.calls[0];
        expect(sql).toContain("sib.status AS sibling_status");
        expect(sql).toMatch(
            /WHERE pend\.created_by_user_id = \$1\s+OR \(pend\.counterparty_user_id = \$1 AND pend\.sibling_status = 'ACTIVE'\)/,
        );
        expect(params).toEqual([2]);
    });
});
