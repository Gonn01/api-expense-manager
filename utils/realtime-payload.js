const CAMPOS_PUBLICADOS = ["id", "gastoId", "purchaseId", "copyId", "entityId", "actorId"];

export const realtimePayload = (data = {}) =>
    Object.fromEntries(
        CAMPOS_PUBLICADOS.filter((campo) => data[campo] !== undefined).map((campo) => [campo, data[campo]]),
    );
