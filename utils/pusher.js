import Pusher from 'pusher';
import { afterCommit } from '../db.js';
import { sendPush } from './push-notifications.js';

export const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

export const triggerCompartidos = (userId, event, data = {}) =>
    afterCommit(async () => {
        const publishToChannel = async () => {
            try {
                await pusher.trigger(`compartidos-${userId}`, event, data);
            } catch (err) {
                console.error(`Pusher error [${event}]:`, err.message);
            }
        };
        await Promise.all([publishToChannel(), sendPush(userId, event, data)]);
    });
