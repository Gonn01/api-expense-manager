import { logRed } from "./logs_custom.js";
import { HttpStatus } from "./http_status.js";

export class CustomError extends Error {
    constructor(code, { status = HttpStatus.BAD_REQUEST, message, details } = {}) {
        super(message ?? code);
        this.name = "CustomError";
        this.code = code;
        this.status = status;
        this.details = details;
        this.expected = true;
    }
}

const CATALOG = Object.freeze({
    VALIDATION_ERROR: { status: HttpStatus.BAD_REQUEST, message: "Datos inválidos" },

    GASTO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Gasto no encontrado" },
    GASTO_POSTERGADO: { status: HttpStatus.CONFLICT, message: "El gasto está postergado para la próxima sesión de cuentas." },
    GASTO_PAGADO_NO_POSTERGABLE: { status: HttpStatus.CONFLICT, message: "Un gasto con todas sus cuotas pagas no se puede postergar." },
    GASTO_NO_PENDIENTE_APROBACION: { status: HttpStatus.BAD_REQUEST, message: "El gasto no está pendiente de aprobación" },
    GASTO_COMPARTIDO_NO_ASOCIADO: { status: HttpStatus.BAD_REQUEST, message: "No hay gasto compartido asociado" },
    GASTO_COMPARTIDO_NO_RECHAZADO: { status: HttpStatus.BAD_REQUEST, message: "El gasto compartido no está rechazado" },
    GASTO_YA_SALDADO: { status: HttpStatus.CONFLICT, message: "El gasto ya tiene todas sus cuotas pagas" },
    SIN_CUOTAS_PARA_REVERTIR: { status: HttpStatus.BAD_REQUEST, message: "No hay cuotas pagadas para revertir" },
    LISTA_IDS_INVALIDA: { status: HttpStatus.BAD_REQUEST, message: "La lista de IDs de compra es inválida." },
    GASTO_ENTIDAD_NO_EDITABLE: { status: HttpStatus.CONFLICT, message: "Este gasto no se puede mover a esa entidad." },
    GASTO_CAMPO_NO_EDITABLE: { status: HttpStatus.CONFLICT, message: "Ese dato del gasto no se puede cambiar." },

    ENTIDAD_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad no encontrada" },
    ENTIDAD_FINANCIERA_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad financiera no encontrada o eliminada" },
    ENTIDAD_PAGO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad de pago no encontrada o eliminada" },
    ENTIDAD_NOT_FOUND_O_AJENA: { status: HttpStatus.BAD_REQUEST, message: "Entidad no encontrada o no pertenece al usuario" },
    ENTIDAD_YA_EXISTE: { status: HttpStatus.BAD_REQUEST, message: "Ya existe esta entidad" },
    ENTIDAD_O_NOMBRE_REQUERIDO: { status: HttpStatus.BAD_REQUEST, message: "Debe seleccionar una entidad o proporcionar un nombre para crear una nueva" },
    VINCULAR_CUENTA_PROPIA: { status: HttpStatus.BAD_REQUEST, message: "No podés vincular tu propia cuenta" },
    ENTIDAD_YA_VINCULADA: { status: HttpStatus.BAD_REQUEST, message: "Ya tenés una entidad vinculada a ese usuario" },

    USUARIO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Usuario no encontrado" },
    USUARIO_EMAIL_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "No existe un usuario registrado con ese email" },
    CREDENCIALES_INVALIDAS: { status: HttpStatus.UNAUTHORIZED, message: "Credenciales incorrectas" },
    EMAIL_YA_REGISTRADO: { status: HttpStatus.CONFLICT, message: "El email ya existe" },

    NO_AUTORIZADO: { status: HttpStatus.FORBIDDEN, message: "No autorizado" },
    PAGO_PENDIENTE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Pago pendiente no encontrado" },

    SETTLEMENT_REQUIRED: { status: HttpStatus.CONFLICT, message: 'Activá el modo "Hacer cuentas" para registrar pagos.' },
    NO_OPEN_SESSION: { status: HttpStatus.BAD_REQUEST, message: "No hay una sesión de cuentas abierta" },
    SETTLEMENT_EMPTY: { status: HttpStatus.CONFLICT, message: "Marcá al menos un gasto para terminar las cuentas, o descartá la sesión." },
    SNAPSHOT_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Snapshot no encontrado" },
});

export const ErrorCode = Object.freeze(
    Object.fromEntries(Object.keys(CATALOG).map((k) => [k, k])),
);

export function customError(code, overrides = {}) {
    const base = CATALOG[code] ?? { status: HttpStatus.INTERNAL_SERVER_ERROR };
    return new CustomError(code, { ...base, ...overrides });
}

export function badRequest(res, message, details) {
    return res.status(HttpStatus.BAD_REQUEST).json({
        error: message,
        code: ErrorCode.VALIDATION_ERROR,
        ...(details ? { details } : {}),
    });
}

export function handleError(res, err) {
    if (err instanceof CustomError) {
        return res.status(err.status).json({
            error: err.message,
            code: err.code,
            ...(err.details ? { details: err.details } : {}),
        });
    }
    logRed(err);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Error en el servidor" });
}

export function errorMiddleware(err, req, res, next) {
    if (res.headersSent) return next(err);
    return handleError(res, err);
}
