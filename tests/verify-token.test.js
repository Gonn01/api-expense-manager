import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../config/env.js", () => ({ JWT_SECRET: "secreto-de-test" }));
vi.mock("../utils/logs_custom.js", () => ({ logRed: vi.fn() }));
vi.mock("../db.js", () => ({ executeQuery: vi.fn() }));

import { createVerifyToken } from "../middleware/verify_token.js";
import { logRed } from "../utils/logs_custom.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

const signed = (payload = {}, options = { expiresIn: "1h" }, secret = "secreto-de-test") =>
    jwt.sign({ userId: 7, tokenVersion: 2, ...payload }, secret, options);

async function run(authorization, versionRows = [{ token_version: 2 }]) {
    const userRepository = { getTokenVersion: vi.fn().mockResolvedValue(versionRows) };
    const req = { headers: authorization ? { authorization } : {} };
    const res = makeRes();
    const next = vi.fn();
    await createVerifyToken(userRepository)(req, res, next);
    return { req, res, next, userRepository };
}

describe("verifyToken", () => {
    it("deja pasar un token vigente y carga la sesión", async () => {
        const { req, res, next, userRepository } = await run(`Bearer ${signed()}`);

        expect(userRepository.getTokenVersion).toHaveBeenCalledWith(7);
        expect(next).toHaveBeenCalledOnce();
        expect(req.session.userId).toBe(7);
        expect(res.status).not.toHaveBeenCalled();
    });

    it("responde 401 si falta el token", async () => {
        const { res, next } = await run();

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está vencido, sin consultar la base", async () => {
        const { res, next, userRepository } = await run(`Bearer ${signed({}, { expiresIn: "-1s" })}`);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(userRepository.getTokenVersion).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está firmado con otro secreto", async () => {
        const { res, next } = await run(`Bearer ${signed({}, {}, "otro-secreto")}`);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está malformado", async () => {
        const { res, next } = await run("Bearer no-es-un-jwt");

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si la sesión fue revocada", async () => {
        const { res, next } = await run(`Bearer ${signed()}`, [{ token_version: 3 }]);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 a un token emitido antes de versionar las sesiones", async () => {
        const token = jwt.sign({ userId: 7 }, "secreto-de-test");

        const { res, next } = await run(`Bearer ${token}`, [{ token_version: 0 }]);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el usuario ya no existe", async () => {
        const { res, next } = await run(`Bearer ${signed()}`, []);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("no escribe el token en los logs cuando lo rechaza", async () => {
        logRed.mockClear();
        const token = signed({}, {}, "otro-secreto");

        await run(`Bearer ${token}`);

        expect(logRed).toHaveBeenCalledOnce();
        expect(logRed.mock.calls.flat().join(" ")).not.toContain(token);
    });
});
