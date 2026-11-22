import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificacionesService } from "../services/notificaciones.service.js";
import { datosDeNotificacion, debeNotificar } from "../utils/notifications.js";

vi.mock("../db.js", () => ({ executeQuery: vi.fn() }));
vi.mock("../utils/logs_custom.js", () => ({ logRed: vi.fn() }));

describe("NotificacionesService", () => {
    let notificacionesRepository;
    let service;

    beforeEach(() => {
        notificacionesRepository = {
            listar: vi.fn(async () => []),
            contarNoLeidas: vi.fn(async () => 2),
            marcarLeida: vi.fn(async () => [{ id: 1 }]),
            marcarTodasLeidas: vi.fn(async () => []),
        };
        service = new NotificacionesService({ notificacionesRepository });
    });

    it("pide una fila extra e informa el cursor si hay más", async () => {
        notificacionesRepository.listar.mockResolvedValue([
            { id: "3", data: { actorName: "Ana" } },
            { id: "2", data: "{\"actorName\":\"Beto\"}" },
            { id: "1", data: {} },
        ]);

        const result = await service.listar(5, { limit: "2" });

        expect(notificacionesRepository.listar).toHaveBeenCalledWith(5, 3, null);
        expect(result.items).toHaveLength(2);
        expect(result.items[1].data).toEqual({ actorName: "Beto" });
        expect(result.next_before).toBe("2");
        expect(result.unread_count).toBe(2);
    });

    it("no informa cursor en la última página y limita el tamaño", async () => {
        const result = await service.listar(5, { limit: "9999" });

        expect(notificacionesRepository.listar).toHaveBeenCalledWith(5, 101, null);
        expect(result.next_before).toBeNull();
    });

    it("rechaza un cursor inválido", async () => {
        await expect(service.listar(5, { before: "abc" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(notificacionesRepository.listar).not.toHaveBeenCalled();
    });

    it("marca solo notificaciones del usuario y devuelve el contador", async () => {
        await expect(service.marcarLeida("7", 5)).resolves.toEqual({ unread_count: 2 });
        expect(notificacionesRepository.marcarLeida).toHaveBeenCalledWith("7", 5);
    });

    it("rechaza un id inválido al marcar", async () => {
        await expect(service.marcarLeida("x", 5)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("marcar todas deja el contador en cero", async () => {
        await expect(service.marcarTodasLeidas(5)).resolves.toEqual({ unread_count: 0 });
    });
});

describe("reglas de notificación", () => {
    it("no notifica la acción propia ni un evento desconocido", () => {
        expect(debeNotificar(5, "edicion.aprobada", { actorId: "5" })).toBe(false);
        expect(debeNotificar(5, "otro.evento", {})).toBe(false);
        expect(debeNotificar(5, "edicion.aprobada", { actorId: 6 })).toBe(true);
    });

    it("guarda solo los campos conocidos y sin nulos", () => {
        expect(
            datosDeNotificacion({ actorName: "Ana", entityId: null, gastoId: 8, secreto: "x", confirmedPayments: 0 }),
        ).toEqual({ actorName: "Ana", confirmedPayments: 0 });
    });
});
