import Pusher from 'pusher';
import { afterCommit } from '../db.js';

export const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

/**
 * Avisa en tiempo real a `userId`. Dentro de una transacción el aviso sale
 * recién después del COMMIT (y no sale si hay ROLLBACK): el otro cliente no
 * debe enterarse de un cambio que todavía no existe, o que nunca existió.
 * Un fallo de Pusher no hace fallar la operación.
 */
export const triggerCompartidos = (userId, event, data = {}) =>
    afterCommit(async () => {
        try {
            await pusher.trigger(`compartidos-${userId}`, event, data);
        } catch (err) {
            console.error(`Pusher error [${event}]:`, err.message);
        }
    });
