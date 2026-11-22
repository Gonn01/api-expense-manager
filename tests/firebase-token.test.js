import { describe, it, expect, vi } from "vitest";
import { verifyFirebaseIdToken } from "../utils/firebase-token.js";

describe("verifyFirebaseIdToken", () => {
    it("toma la identidad del token verificado", async () => {
        const auth = {
            verifyIdToken: vi.fn().mockResolvedValue({
                uid: "fb123",
                email: "juan@test.com",
                email_verified: true,
                name: "Juan",
                picture: "https://avatar.url",
            }),
        };

        await expect(verifyFirebaseIdToken("id-token", auth)).resolves.toEqual({
            firebaseId: "fb123",
            email: "juan@test.com",
            emailVerified: true,
            name: "Juan",
            avatar: "https://avatar.url",
        });
    });

    it("trata como no verificado un token sin la marca", async () => {
        const auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: "fb123", email: "juan@test.com" }) };

        const identity = await verifyFirebaseIdToken("id-token", auth);

        expect(identity.emailVerified).toBe(false);
    });

    it("responde GOOGLE_TOKEN_INVALIDO con un token rechazado", async () => {
        const auth = { verifyIdToken: vi.fn().mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/argument-error" })) };

        await expect(verifyFirebaseIdToken("falso", auth)).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALIDO" });
    });

    it("no confunde una falla de infraestructura con un token inválido", async () => {
        const failure = Object.assign(new Error("down"), { code: "auth/internal-error" });
        const auth = { verifyIdToken: vi.fn().mockRejectedValue(failure) };

        await expect(verifyFirebaseIdToken("id-token", auth)).rejects.toBe(failure);
    });
});
