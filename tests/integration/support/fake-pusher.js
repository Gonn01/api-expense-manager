import { afterCommit } from "../../../db.js";
import { registrarNotificacion } from "../../../utils/notifications.js";

export const sentEvents = [];

const pendingNotifications = new Set();

export const settleNotifications = async () => {
    await Promise.all([...pendingNotifications]);
};

export const pusher = { trigger: async () => {} };

export const triggerCompartidos = (userId, event, data = {}) =>
    afterCommit(async () => {
        sentEvents.push({ userId: Number(userId), event, data });
        const saving = registrarNotificacion(userId, event, data).finally(() =>
            pendingNotifications.delete(saving),
        );
        pendingNotifications.add(saving);
        await saving;
    });
