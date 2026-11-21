import { describe, expect, it } from "vitest";
import { executeQuery } from "../../db.js";

describe("base de integración", () => {
    it("usa una base local con el esquema cargado", async () => {
        const rows = await executeQuery(
            "SELECT count(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'",
        );

        expect(new URL(process.env.DATABASE_URL).hostname).toBe("127.0.0.1");
        expect(rows[0].total).toBe(11);
    });
});
