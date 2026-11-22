import { describe, expect, it } from "vitest";
import { PusherEvent } from "../utils/enums.js";
import { buildPushMessage, isOwnPushAction } from "../utils/push-messages.js";

describe("buildPushMessage", () => {
    it.each(Object.values(PusherEvent))("tiene texto en los dos idiomas para %s", (event) => {
        expect(buildPushMessage(event, { actorName: "Ana" }, "es")?.body).toBeTruthy();
        expect(buildPushMessage(event, { actorName: "Ana" }, "en")?.body).toBeTruthy();
    });

    it("usa el idioma pedido", () => {
        expect(buildPushMessage(PusherEvent.PAGO_CONFIRMADO, { actorName: "Ana" }, "en")).toEqual({
            title: "Notifications",
            body: "Ana confirmed your payment",
        });
    });

    it("usa español si el idioma no existe o no llegó", () => {
        expect(buildPushMessage(PusherEvent.PAGO_CONFIRMADO, { actorName: "Ana" }, "fr").title).toBe("Notificaciones");
        expect(buildPushMessage(PusherEvent.PAGO_CONFIRMADO, { actorName: "Ana" }).title).toBe("Notificaciones");
    });

    it("nombra a quien recibió el gasto al aprobarlo", () => {
        const message = buildPushMessage(PusherEvent.COMPARTIDO_APROBADO, { receiverName: "Luz" }, "es");
        expect(message.body).toBe("Luz ha aceptado tu gasto");
    });

    it("no incluye el nombre del gasto", () => {
        const message = buildPushMessage(
            PusherEvent.EDICION_SOLICITADA,
            { actorName: "Ana", gastoName: "Alquiler" },
            "es",
        );
        expect(message.body).not.toContain("Alquiler");
    });

    it("avisa los pagos confirmados al desvincular", () => {
        const message = buildPushMessage(
            PusherEvent.COMPARTIDO_DESVINCULADO,
            { actorName: "Ana", confirmedPayments: 2 },
            "es",
        );
        expect(message.body).toContain("Tus pagos pendientes quedaron confirmados.");
    });

    it("usa el texto anónimo de un pago pendiente sin actor", () => {
        expect(buildPushMessage(PusherEvent.PAGO_PENDIENTE, {}, "es").body).toBe(
            "Tenés un pago para confirmar en Notificaciones",
        );
    });

    it("devuelve null para un evento desconocido", () => {
        expect(buildPushMessage("otro.evento", {}, "es")).toBeNull();
    });
});

describe("isOwnPushAction", () => {
    it("detecta la acción propia aunque cambie el tipo del id", () => {
        expect(isOwnPushAction(5, { actorId: "5" })).toBe(true);
    });

    it("no marca la acción de otra persona ni un evento sin actor", () => {
        expect(isOwnPushAction(5, { actorId: 6 })).toBe(false);
        expect(isOwnPushAction(5, {})).toBe(false);
    });
});
