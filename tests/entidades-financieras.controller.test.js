import { describe, it, expect, vi, beforeEach } from "vitest";
import { EntidadesFinancierasController } from "../controller/entidades-financieras.controller.js";
import { customError, ErrorCode } from "../utils/errors.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

function makeReq(overrides = {}) {
    return { body: {}, params: {}, session: { userId: 1 }, ...overrides };
}

describe("EntidadesFinancierasController", () => {
    let service;
    let controller;

    beforeEach(() => {
        service = {
            listar: vi.fn(),
            obtenerPorId: vi.fn(),
            crear: vi.fn(),
            actualizar: vi.fn(),
            eliminar: vi.fn(),
            obtenerMovements: vi.fn(),
        };
        controller = new EntidadesFinancierasController(service);
    });

    // ─── listar ───────────────────────────────────────────────────────────────

    describe("listar", () => {
        it("responde con el listado de entidades del usuario", async () => {
            const req = makeReq();
            const res = makeRes();
            const mockEntidades = [{ id: 1, name: "Banco Nación" }];
            service.listar.mockResolvedValue(mockEntidades);

            await controller.listar(req, res);

            expect(service.listar).toHaveBeenCalledWith(1);
            expect(res.json).toHaveBeenCalledWith({
                message: "Listado de entidades financieras",
                data: mockEntidades,
            });
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq();
            const res = makeRes();
            service.listar.mockRejectedValue(new Error("DB error"));

            await controller.listar(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });
    });

    // ─── obtenerPorId ─────────────────────────────────────────────────────────

    describe("obtenerPorId", () => {
        it("responde con la entidad solicitada", async () => {
            const req = makeReq({ params: { id: "5" } });
            const res = makeRes();
            const mockEntidad = { id: 5, name: "Tarjeta Visa", gastos: [] };
            service.obtenerPorId.mockResolvedValue(mockEntidad);

            await controller.obtenerPorId(req, res);

            expect(service.obtenerPorId).toHaveBeenCalledWith("5", 1);
            expect(res.json).toHaveBeenCalledWith({
                message: "Entidad financiera obtenida con éxito",
                data: mockEntidad,
            });
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ params: { id: "5" } });
            const res = makeRes();
            service.obtenerPorId.mockRejectedValue(new Error("Not found"));

            await controller.obtenerPorId(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Error en el servidor") }));
        });
    });

    // ─── crear ────────────────────────────────────────────────────────────────

    describe("crear", () => {
        it("responde 201 con la entidad creada", async () => {
            const req = makeReq({ body: { name: "Banco Galicia" } });
            const res = makeRes();
            const mockEntidad = { id: 10, name: "Banco Galicia" };
            service.crear.mockResolvedValue(mockEntidad);

            await controller.crear(req, res);

            expect(service.crear).toHaveBeenCalledWith("Banco Galicia", 1);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                message: "Entidad financiera creada con éxito",
                data: mockEntidad,
            });
        });

        it("responde 400 cuando falta el campo name", async () => {
            const req = makeReq({ body: {} });
            const res = makeRes();

            await controller.crear(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Falta el campo 'name'", code: "VALIDATION_ERROR" }));
            expect(service.crear).not.toHaveBeenCalled();
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ body: { name: "Banco X" } });
            const res = makeRes();
            service.crear.mockRejectedValue(new Error("DB error"));

            await controller.crear(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });

        it("responde 400 cuando la entidad ya existe", async () => {
            const req = makeReq({ body: { name: "Banco Galicia" } });
            const res = makeRes();
            service.crear.mockRejectedValue(customError(ErrorCode.ENTIDAD_YA_EXISTE));

            await controller.crear(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: "Ya existe esta entidad", code: "ENTIDAD_YA_EXISTE" }),
            );
        });
    });

    // ─── actualizar ───────────────────────────────────────────────────────────

    describe("actualizar", () => {
        it("responde con la entidad actualizada e incluye movimientos", async () => {
            const req = makeReq({ params: { id: "5" }, body: { name: "Nuevo Nombre" } });
            const res = makeRes();
            const mockEntidad = { id: 5, name: "Nuevo Nombre" };
            const mockMovements = [{ id: 1, type: "CREATION" }];
            service.actualizar.mockResolvedValue(mockEntidad);
            service.obtenerMovements.mockResolvedValue(mockMovements);

            await controller.actualizar(req, res);

            expect(service.actualizar).toHaveBeenCalledWith("5", "Nuevo Nombre", 1);
            expect(service.obtenerMovements).toHaveBeenCalledWith("5");
            expect(res.json).toHaveBeenCalledWith({
                message: "Entidad financiera actualizada con éxito",
                data: { ...mockEntidad, movements: mockMovements },
            });
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ params: { id: "5" }, body: { name: "Nuevo Nombre" } });
            const res = makeRes();
            service.actualizar.mockRejectedValue(new Error("DB error"));

            await controller.actualizar(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });

        it("responde 400 cuando ya existe otra entidad con ese nombre", async () => {
            const req = makeReq({ params: { id: "5" }, body: { name: "Nombre Repetido" } });
            const res = makeRes();
            service.actualizar.mockRejectedValue(customError(ErrorCode.ENTIDAD_YA_EXISTE));

            await controller.actualizar(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: "Ya existe esta entidad", code: "ENTIDAD_YA_EXISTE" }),
            );
        });

        it("responde 404 cuando la entidad no existe", async () => {
            const req = makeReq({ params: { id: "5" }, body: { name: "Nuevo Nombre" } });
            const res = makeRes();
            service.actualizar.mockRejectedValue(customError(ErrorCode.ENTIDAD_NOT_FOUND));

            await controller.actualizar(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: "Entidad no encontrada", code: "ENTIDAD_NOT_FOUND" }),
            );
        });
    });

    // ─── eliminar ─────────────────────────────────────────────────────────────

    describe("eliminar", () => {
        it("responde con confirmación al eliminar la entidad", async () => {
            const req = makeReq({ params: { id: "5" } });
            const res = makeRes();
            const mockResult = { id: 5, deleted: true };
            service.eliminar.mockResolvedValue(mockResult);

            await controller.eliminar(req, res);

            expect(service.eliminar).toHaveBeenCalledWith("5", 1);
            expect(res.json).toHaveBeenCalledWith({
                message: "Entidad financiera eliminada con éxito",
                data: mockResult,
            });
        });

        it("responde 500 cuando el servicio lanza un error", async () => {
            const req = makeReq({ params: { id: "5" } });
            const res = makeRes();
            service.eliminar.mockRejectedValue(new Error("DB error"));

            await controller.eliminar(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Error en el servidor" });
        });
    });
});
