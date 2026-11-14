import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthService } from "../services/health.service.js";
import { HealthController } from "../controller/health.controller.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe("HealthService", () => {
    let healthRepository;
    let service;

    beforeEach(() => {
        healthRepository = { pingDatabase: vi.fn() };
        service = new HealthService({ healthRepository });
    });

    it("informa ok cuando la base responde", async () => {
        healthRepository.pingDatabase.mockResolvedValue();

        const health = await service.check();

        expect(health).toMatchObject({ status: "ok", database: "ok" });
        expect(typeof health.uptime).toBe("number");
        expect(typeof health.timestamp).toBe("string");
    });

    it("informa error cuando la base no responde", async () => {
        healthRepository.pingDatabase.mockRejectedValue(new Error("ECONNREFUSED"));

        const health = await service.check();

        expect(health).toMatchObject({ status: "error", database: "error" });
    });
});

describe("HealthController", () => {
    let healthService;
    let controller;

    beforeEach(() => {
        healthService = { check: vi.fn() };
        controller = new HealthController(healthService);
    });

    it("responde 200 cuando todo está bien", async () => {
        const data = { status: "ok", database: "ok", uptime: 5, timestamp: "t" };
        healthService.check.mockResolvedValue(data);
        const res = makeRes();

        await controller.check({}, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: "API funcionando", data });
    });

    it("responde 503 cuando la base no responde", async () => {
        const data = { status: "error", database: "error", uptime: 5, timestamp: "t" };
        healthService.check.mockResolvedValue(data);
        const res = makeRes();

        await controller.check({}, res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data }));
    });
});
