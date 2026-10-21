import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserController } from "../controller/user.controller.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

function makeReq(overrides = {}) {
    return { body: {}, params: {}, session: { userId: 1 }, ...overrides };
}

describe("UserController", () => {
    let userService;
    let controller;

    beforeEach(() => {
        userService = {
            updatePreferredCurrency: vi.fn(),
            updateSueldo: vi.fn(),
        };
        controller = new UserController(userService);
    });

    describe("updatePreferredCurrency", () => {
        it("responde con los datos actualizados cuando todo está bien", async () => {
            const req = makeReq({ body: { preferred_currency: "ARS" } });
            const res = makeRes();
            userService.updatePreferredCurrency.mockResolvedValue({ id: 1, preferred_currency: "ARS" });

            await controller.updatePreferredCurrency(req, res);

            expect(userService.updatePreferredCurrency).toHaveBeenCalledWith(1, "ARS");
            expect(res.json).toHaveBeenCalledWith({
                message: "Moneda preferida actualizada",
                data: { id: 1, preferred_currency: "ARS" },
            });
        });

        it("responde 400 cuando falta preferred_currency", async () => {
            const req = makeReq({ body: {} });
            const res = makeRes();

            await controller.updatePreferredCurrency(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updatePreferredCurrency).not.toHaveBeenCalled();
        });

        it("responde 400 cuando preferred_currency no es válida", async () => {
            const req = makeReq({ body: { preferred_currency: "XYZ" } });
            const res = makeRes();

            await controller.updatePreferredCurrency(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updatePreferredCurrency).not.toHaveBeenCalled();
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ body: { preferred_currency: "USD" } });
            const res = makeRes();
            userService.updatePreferredCurrency.mockRejectedValue(new Error("DB error"));

            await controller.updatePreferredCurrency(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });
    });

    describe("updateSueldo", () => {
        it("responde con los datos actualizados cuando todo está bien", async () => {
            const req = makeReq({ body: { sueldo: 1500.5, sueldo_currency: "USD" } });
            const res = makeRes();
            userService.updateSueldo.mockResolvedValue({ id: 1, sueldo: 1500.5, sueldo_currency: "USD" });

            await controller.updateSueldo(req, res);

            expect(userService.updateSueldo).toHaveBeenCalledWith(1, 1500.5, "USD");
            expect(res.json).toHaveBeenCalledWith({
                message: "Sueldo actualizado",
                data: { id: 1, sueldo: 1500.5, sueldo_currency: "USD" },
            });
        });

        it("responde con los datos actualizados cuando no se envía sueldo_currency", async () => {
            const req = makeReq({ body: { sueldo: 1500.5 } });
            const res = makeRes();
            userService.updateSueldo.mockResolvedValue({ id: 1, sueldo: 1500.5 });

            await controller.updateSueldo(req, res);

            expect(userService.updateSueldo).toHaveBeenCalledWith(1, 1500.5, undefined);
            expect(res.json).toHaveBeenCalledWith({
                message: "Sueldo actualizado",
                data: { id: 1, sueldo: 1500.5 },
            });
        });

        it("responde 400 cuando sueldo_currency no es válida", async () => {
            const req = makeReq({ body: { sueldo: 100, sueldo_currency: "XYZ" } });
            const res = makeRes();

            await controller.updateSueldo(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updateSueldo).not.toHaveBeenCalled();
        });

        it("responde 400 cuando falta sueldo", async () => {
            const req = makeReq({ body: {} });
            const res = makeRes();

            await controller.updateSueldo(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updateSueldo).not.toHaveBeenCalled();
        });

        it("responde 400 cuando sueldo es negativo", async () => {
            const req = makeReq({ body: { sueldo: -5 } });
            const res = makeRes();

            await controller.updateSueldo(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updateSueldo).not.toHaveBeenCalled();
        });

        it("responde 400 cuando sueldo no es un número", async () => {
            const req = makeReq({ body: { sueldo: "abc" } });
            const res = makeRes();

            await controller.updateSueldo(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(userService.updateSueldo).not.toHaveBeenCalled();
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ body: { sueldo: 100 } });
            const res = makeRes();
            userService.updateSueldo.mockRejectedValue(new Error("DB error"));

            await controller.updateSueldo(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });
    });
});
