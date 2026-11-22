import { PusherEvent } from "./enums.js";

export const PUSH_LANGUAGES = Object.freeze(["es", "en"]);

const DEFAULT_LANGUAGE = "es";

const CATALOG = Object.freeze({
    es: {
        title: "Compartidos",
        otherPerson: "La otra persona",
        aUser: "Un usuario",
        unsharedConfirmed: "Tus pagos pendientes quedaron confirmados.",
        paymentPendingAnonymous: "Tenés un pago para confirmar en Compartidos",
        events: {
            [PusherEvent.COMPARTIDO_NUEVO]: () => "Recibiste un nuevo gasto compartido",
            [PusherEvent.COMPARTIDO_APROBADO]: (who) => `${who} ha aceptado tu gasto`,
            [PusherEvent.COMPARTIDO_RECHAZADO]: (who) => `${who} rechazó tu gasto`,
            [PusherEvent.COMPARTIDO_DESCARTADO]: (who) => `${who} descartó un gasto que habías rechazado`,
            [PusherEvent.COMPARTIDO_DESVINCULADO]: (who) => `${who} eliminó un gasto: ya no es un gasto compartido.`,
            [PusherEvent.PAGO_PENDIENTE]: (who) => `${who} registró un pago. Confirmalo en Compartidos`,
            [PusherEvent.PAGO_CONFIRMADO]: (who) => `${who} confirmó tu pago`,
            [PusherEvent.PAGO_RECHAZADO]: (who) => `${who} rechazó tu pago`,
            [PusherEvent.PAGO_RETIRADO]: (who) => `${who} retiró un pago que tenías para confirmar`,
            [PusherEvent.PAGO_REVERSION_SOLICITADA]: (who) => `${who} pidió revertir un pago. Respondé en Compartidos`,
            [PusherEvent.PAGO_REVERSION_CANCELADA]: (who) => `${who} canceló el pedido de reversión de un pago`,
            [PusherEvent.PAGO_REVERSION_ACEPTADA]: (who) => `${who} aceptó revertir el pago`,
            [PusherEvent.PAGO_REVERSION_RECHAZADA]: (who) => `${who} rechazó revertir el pago`,
            [PusherEvent.EDICION_SOLICITADA]: (who) => `${who} pidió editar un gasto. Respondé en Compartidos`,
            [PusherEvent.EDICION_CANCELADA]: (who) => `${who} canceló un pedido de edición`,
            [PusherEvent.EDICION_APROBADA]: (who) => `${who} aprobó la edición`,
            [PusherEvent.EDICION_RECHAZADA]: (who) => `${who} rechazó la edición`,
        },
    },
    en: {
        title: "Shared",
        otherPerson: "The other person",
        aUser: "A user",
        unsharedConfirmed: "Your pending payments were confirmed.",
        paymentPendingAnonymous: "You have a payment to confirm in Shared",
        events: {
            [PusherEvent.COMPARTIDO_NUEVO]: () => "You received a new shared expense",
            [PusherEvent.COMPARTIDO_APROBADO]: (who) => `${who} accepted your expense`,
            [PusherEvent.COMPARTIDO_RECHAZADO]: (who) => `${who} rejected your expense`,
            [PusherEvent.COMPARTIDO_DESCARTADO]: (who) => `${who} discarded an expense you had rejected`,
            [PusherEvent.COMPARTIDO_DESVINCULADO]: (who) => `${who} deleted an expense: it is no longer a shared expense.`,
            [PusherEvent.PAGO_PENDIENTE]: (who) => `${who} recorded a payment. Confirm it in Shared`,
            [PusherEvent.PAGO_CONFIRMADO]: (who) => `${who} confirmed your payment`,
            [PusherEvent.PAGO_RECHAZADO]: (who) => `${who} rejected your payment`,
            [PusherEvent.PAGO_RETIRADO]: (who) => `${who} withdrew a payment you had to confirm`,
            [PusherEvent.PAGO_REVERSION_SOLICITADA]: (who) => `${who} asked to revert a payment. Reply in Shared`,
            [PusherEvent.PAGO_REVERSION_CANCELADA]: (who) => `${who} cancelled a payment reversal request`,
            [PusherEvent.PAGO_REVERSION_ACEPTADA]: (who) => `${who} agreed to revert the payment`,
            [PusherEvent.PAGO_REVERSION_RECHAZADA]: (who) => `${who} refused to revert the payment`,
            [PusherEvent.EDICION_SOLICITADA]: (who) => `${who} asked to edit an expense. Reply in Shared`,
            [PusherEvent.EDICION_CANCELADA]: (who) => `${who} cancelled an edit request`,
            [PusherEvent.EDICION_APROBADA]: (who) => `${who} approved the edit`,
            [PusherEvent.EDICION_RECHAZADA]: (who) => `${who} rejected the edit`,
        },
    },
});

const RECEIVER_EVENTS = new Set([PusherEvent.COMPARTIDO_APROBADO, PusherEvent.COMPARTIDO_RECHAZADO]);

export const isOwnPushAction = (userId, data = {}) =>
    data.actorId !== undefined && data.actorId !== null && String(data.actorId) === String(userId);

export function buildPushMessage(event, data = {}, language = DEFAULT_LANGUAGE) {
    const texts = CATALOG[language] ?? CATALOG[DEFAULT_LANGUAGE];
    const render = texts.events[event];
    if (!render) return null;

    if (event === PusherEvent.PAGO_PENDIENTE && !data.actorName) {
        return { title: texts.title, body: texts.paymentPendingAnonymous };
    }

    const who = RECEIVER_EVENTS.has(event)
        ? data.receiverName || texts.aUser
        : data.actorName || texts.otherPerson;
    const body = render(who);
    const confirmed = event === PusherEvent.COMPARTIDO_DESVINCULADO && data.confirmedPayments > 0;

    return { title: texts.title, body: confirmed ? `${body} ${texts.unsharedConfirmed}` : body };
}
