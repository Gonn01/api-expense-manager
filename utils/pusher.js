import Pusher from 'pusher';
import { afterCommit } from '../db.js';
import { NOTIFICACION_NUEVA_EVENT } from './enums.js';
import { registrarNotificacion } from './notifications.js';
import { realtimePayload } from './realtime-payload.js';
import { sendPush } from './push-notifications.js';

export const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

const isRealtimeConfigured = () =>
    Boolean(
        process.env.PUSHER_APP_ID &&
            process.env.PUSHER_KEY &&
            process.env.PUSHER_SECRET &&
            process.env.PUSHER_CLUSTER,
    );

const publish = async (channel, event, data) => {
    if (!isRealtimeConfigured()) return;
    try {
        await pusher.trigger(channel, event, realtimePayload(data));
    } catch (err) {
        console.error(`Pusher error [${event}]:`, err.message);
    }
};

export const userChannel = (userId) => `private-notificaciones-${userId}`;

export const authorizePusherChannel = (socketId, channelName) => pusher.authorizeChannel(socketId, channelName);

export const triggerCompartidos = (userId, event, data = {}) =>
    afterCommit(async () => {
        const channel = userChannel(userId);
        const notificacion = await registrarNotificacion(userId, event, data);
        await Promise.all([
            publish(channel, event, data),
            notificacion ? publish(channel, NOTIFICACION_NUEVA_EVENT, { id: notificacion.id }) : null,
            sendPush(userId, event, data),
        ]);
    });
