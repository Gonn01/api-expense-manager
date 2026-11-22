import PushNotifications from "@pusher/push-notifications-server";
import { BEAMS_INSTANCE_ID, BEAMS_SECRET_KEY } from "../config/env.js";
import { UserRepository } from "../repositories/user.repository.js";
import { buildPushMessage, isOwnPushAction } from "./push-messages.js";

const ANDROID_CHANNEL_ID = "shared_activity";
const OPEN_SHARED_ROUTE = "notificaciones";

const userRepository = new UserRepository();
let client = null;

export const isPushConfigured = () => Boolean(BEAMS_INSTANCE_ID && BEAMS_SECRET_KEY);

const getClient = () => {
    client ??= new PushNotifications({
        instanceId: BEAMS_INSTANCE_ID,
        secretKey: BEAMS_SECRET_KEY,
    });
    return client;
};

export const generatePushToken = (userId) => getClient().generateToken(String(userId));

const pushLanguageOf = async (userId) => {
    try {
        const [row] = await userRepository.getPushLanguage(userId);
        return row?.push_language;
    } catch (err) {
        console.error("Push language error:", err.message);
        return undefined;
    }
};

export async function sendPush(userId, event, data = {}) {
    if (!isPushConfigured() || isOwnPushAction(userId, data)) return;
    try {
        const message = buildPushMessage(event, data, await pushLanguageOf(userId));
        if (!message) return;
        await getClient().publishToUsers([String(userId)], {
            fcm: {
                priority: "high",
                notification: { ...message, android_channel_id: ANDROID_CHANNEL_ID },
                data: { em_route: OPEN_SHARED_ROUTE, event },
            },
        });
    } catch (err) {
        console.error(`Push error [${event}]:`, err.message);
    }
}
