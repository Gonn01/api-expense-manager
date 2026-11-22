import { PusherEvent } from "./enums.js";
import { logRed } from "./logs_custom.js";
import { isOwnPushAction } from "./push-messages.js";
import { NotificacionesRepository } from "../repositories/notificaciones.repository.js";

const EVENTOS_NOTIFICABLES = new Set(Object.values(PusherEvent));
const CAMPOS_GUARDADOS = [
    "actorId",
    "actorName",
    "receiverName",
    "gastoName",
    "confirmedPayments",
    "entityId",
];

const repository = new NotificacionesRepository();

export const debeNotificar = (userId, event, data = {}) =>
    userId != null && EVENTOS_NOTIFICABLES.has(event) && !isOwnPushAction(userId, data);

export const datosDeNotificacion = (data = {}) =>
    Object.fromEntries(
        CAMPOS_GUARDADOS.filter((campo) => data[campo] !== undefined && data[campo] !== null).map((campo) => [
            campo,
            data[campo],
        ]),
    );

async function completarDatos(event, data) {
    const esNuevo = event === PusherEvent.COMPARTIDO_NUEVO;
    const gastoId = data.gastoId ?? data.purchaseId;
    if (gastoId == null || (data.gastoName && !esNuevo)) return data;

    const [gasto] = await repository.getGastoContext(gastoId);
    if (!gasto) return data;
    return {
        ...data,
        gastoName: data.gastoName ?? gasto.name,
        actorName: data.actorName ?? (esNuevo ? gasto.owner_name : undefined),
    };
}

export async function registrarNotificacion(userId, event, data = {}) {
    if (!debeNotificar(userId, event, data)) return null;
    try {
        const completos = await completarDatos(event, data);
        const [row] = await repository.create(userId, event, datosDeNotificacion(completos));
        return row ?? null;
    } catch (err) {
        logRed(`[notificaciones] no se pudo guardar ${event}: ${err.message}`);
        return null;
    }
}
