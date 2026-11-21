import { afterCommit } from "../../../db.js";

export const sentEvents = [];

export const pusher = { trigger: async () => {} };

export const triggerCompartidos = (userId, event, data = {}) =>
    afterCommit(async () => {
        sentEvents.push({ userId: Number(userId), event, data });
    });
