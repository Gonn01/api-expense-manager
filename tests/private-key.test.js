import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { normalizePrivateKey } from "../utils/private-key.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const body = pem.replace(/-----[^-]+-----/g, "").trim();
const escaped = (text) => text.replace(/\n/g, "\\n");

describe("normalizePrivateKey", () => {
    it("acepta la clave con saltos de línea escritos como \\n", () => {
        expect(() => createPrivateKey(normalizePrivateKey(escaped(pem)))).not.toThrow();
    });

    it("agrega los encabezados si se pegó solo el cuerpo de la clave", () => {
        const normalized = normalizePrivateKey(escaped(body));

        expect(normalized.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
        expect(() => createPrivateKey(normalized)).not.toThrow();
    });

    it("quita las comillas que quedaron alrededor del valor", () => {
        expect(() => createPrivateKey(normalizePrivateKey(`"${escaped(pem)}"`))).not.toThrow();
    });

    it("deja vacío un valor que no está definido", () => {
        expect(normalizePrivateKey(undefined)).toBeUndefined();
    });
});
