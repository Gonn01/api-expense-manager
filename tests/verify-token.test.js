import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../config/env.js", () => ({ JWT_SECRET: "secreto-de-test" }));
vi.mock("../utils/logs_custom.js", () => ({ logRed: vi.fn() }));

import { verifyToken } from "../middleware/verify_token.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

function run(authorization) {
    const req = { headers: authorization ? { authorization } : {} };
    const res = makeRes();
    const next = vi.fn();
    verifyToken(req, res, next);
    return { req, res, next };
}

describe("verifyToken", () => {
    it("deja pasar un token válido y carga la sesión", () => {
        const token = jwt.sign({ userId: 7 }, "secreto-de-test", { expiresIn: "1h" });

        const { req, res, next } = run(`Bearer ${token}`);

        expect(next).toHaveBeenCalledOnce();
        expect(req.session.userId).toBe(7);
        expect(res.status).not.toHaveBeenCalled();
    });

    it("responde 401 si falta el token", () => {
        const { res, next } = run();

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está vencido", () => {
        const token = jwt.sign({ userId: 7 }, "secreto-de-test", { expiresIn: "-1s" });

        const { res, next } = run(`Bearer ${token}`);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está firmado con otro secreto", () => {
        const token = jwt.sign({ userId: 7 }, "otro-secreto");

        const { res, next } = run(`Bearer ${token}`);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it("responde 401 si el token está malformado", () => {
        const { res, next } = run("Bearer no-es-un-jwt");

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});
