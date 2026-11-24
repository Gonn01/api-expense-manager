import { beforeEach, describe, expect, it, vi } from "vitest";

const { trigger, registrarNotificacion, sendPush } = vi.hoisted(() => {
    Object.assign(process.env, {
        PUSHER_APP_ID: "1",
        PUSHER_KEY: "clave",
        PUSHER_SECRET: "secreto",
        PUSHER_CLUSTER: "sa1",
    });
    return {
        trigger: vi.fn(),
        registrarNotificacion: vi.fn(),
        sendPush: vi.fn(),
    };
});

vi.mock("pusher", () => ({
    default: class {
        trigger = trigger;
    },
}));
vi.mock("../db.js", () => ({ afterCommit: (fn) => fn() }));
vi.mock("../utils/notifications.js", () => ({ registrarNotificacion }));
vi.mock("../utils/push-notifications.js", () => ({ sendPush }));

const { triggerCompartidos } = await import("../utils/pusher.js");

const DATA = {
    gastoId: 10,
    entityId: 5,
    actorId: 2,
    actorName: "Ana",
    receiverName: "Beto",
    gastoName: "Alquiler",
    confirmedPayments: 1,
};

describe("triggerCompartidos", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registrarNotificacion.mockResolvedValue({ id: 99 });
    });

    it("publica solo identificadores en el canal privado", async () => {
        await triggerCompartidos(7, "compartido.aprobado", DATA);

        expect(trigger).toHaveBeenCalledWith("private-notificaciones-7", "compartido.aprobado", {
            gastoId: 10,
            entityId: 5,
            actorId: 2,
        });
        expect(JSON.stringify(trigger.mock.calls)).not.toMatch(/Ana|Beto|Alquiler/);
    });

    it("avisa la notificación guardada con su id", async () => {
        await triggerCompartidos(7, "compartido.aprobado", DATA);

        expect(trigger).toHaveBeenCalledWith("private-notificaciones-7", "notificacion.nueva", { id: 99 });
    });

    it("sin credenciales guarda la notificación pero no publica", async () => {
        const appId = process.env.PUSHER_APP_ID;
        process.env.PUSHER_APP_ID = "";

        await triggerCompartidos(7, "compartido.aprobado", DATA);

        process.env.PUSHER_APP_ID = appId;
        expect(trigger).not.toHaveBeenCalled();
        expect(registrarNotificacion).toHaveBeenCalledOnce();
    });

    it("guarda la notificación con los datos completos", async () => {
        await triggerCompartidos(7, "compartido.aprobado", DATA);

        expect(registrarNotificacion).toHaveBeenCalledWith(7, "compartido.aprobado", DATA);
    });
});
