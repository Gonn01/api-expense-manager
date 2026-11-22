import { describe, expect, it } from "vitest";
import { normalizeMercadoPagoAlias } from "../utils/mercado-pago-alias.js";

describe("normalizeMercadoPagoAlias", () => {
    it("acepta letras, números, puntos y guiones, sin espacios alrededor", () => {
        expect(normalizeMercadoPagoAlias("  mi.alias-01 ")).toBe("mi.alias-01");
    });

    it("interpreta null o texto vacío como quitar el alias", () => {
        expect(normalizeMercadoPagoAlias(null)).toBeNull();
        expect(normalizeMercadoPagoAlias("   ")).toBeNull();
    });

    it.each([undefined, 123, "corto", "a".repeat(21), "con espacio", "muñeca.azul"])(
        "rechaza %s",
        (value) => {
            expect(normalizeMercadoPagoAlias(value)).toBeUndefined();
        },
    );
});
