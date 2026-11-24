import { beforeEach, describe, expect, it, vi } from "vitest";
import Pusher from "pusher";
import { UserController } from "../controller/user.controller.js";
import { UserService } from "../services/user.service.js";
import { userChannel } from "../utils/pusher.js";

vi.mock("../config/env.js", () => ({
    JWT_SECRET: "secreto-de-test",
    DATABASE_URL: "postgres://no-usar",
    DATABASE_SSL: undefined,
    BEAMS_INSTANCE_ID: undefined,
    BEAMS_SECRET_KEY: undefined,
}));
vi.mock("../db.js", () => ({
    executeQuery: vi.fn(),
    afterCommit: (fn) => fn(),
}));

const USER_ID = 7;
const SOCKET_ID = "123.456";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe("autorización del canal de tiempo real", () => {
    let authorizeChannel;
    let controller;

    const authorize = (body) => {
        const res = makeRes();
        controller.authorizeRealtimeChannel({ session: { userId: USER_ID }, body }, res);
        return res;
    };

    beforeEach(() => {
        const pusher = new Pusher({ appId: "1", key: "clave", secret: "secreto", cluster: "sa1" });
        authorizeChannel = vi.fn((socketId, channelName) => pusher.authorizeChannel(socketId, channelName));
        controller = new UserController(new UserService({ userRepository: {}, authorizeChannel }));
    });

    it("el canal de cada usuario es privado", () => {
        expect(userChannel(USER_ID)).toBe("private-notificaciones-7");
    });

    it("firma el canal propio", () => {
        const res = authorize({ socket_id: SOCKET_ID, channel_name: userChannel(USER_ID) });

        expect(authorizeChannel).toHaveBeenCalledWith(SOCKET_ID, "private-notificaciones-7");
        expect(res.json.mock.calls[0][0].data.auth).toMatch(/^clave:[0-9a-f]{64}$/);
    });

    it.each([
        ["de otro usuario", "private-notificaciones-8"],
        ["público", "notificaciones-7"],
        ["con un sufijo", "private-notificaciones-7-extra"],
    ])("rechaza un canal %s", (_caso, channelName) => {
        const res = authorize({ socket_id: SOCKET_ID, channel_name: channelName });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(authorizeChannel).not.toHaveBeenCalled();
    });

    it.each([
        ["sin socket", { channel_name: "private-notificaciones-7" }],
        ["con socket inválido", { socket_id: "abc", channel_name: "private-notificaciones-7" }],
        ["sin canal", { socket_id: SOCKET_ID }],
        ["sin body", undefined],
    ])("responde 400 %s", (_caso, body) => {
        const res = authorize(body);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(authorizeChannel).not.toHaveBeenCalled();
    });
});
