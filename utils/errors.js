import { logRed } from "./logs_custom.js";
import { HttpStatus } from "./http_status.js";

/**
 * Error de dominio de la app. Lleva un `code` estable (la identidad del error,
 * lo que el cliente debería usar para decidir qué hacer) separado del `message`
 * (texto para mostrar, que puede cambiar sin romper nada) y del `status` HTTP.
 *
 * En vez de `throw new Error("texto")` + comparar strings en el controller,
 * los services lanzan `throw customError(ErrorCode.X)` y `handleError` traduce
 * el error a la respuesta HTTP en un solo lugar.
 */
export class CustomError extends Error {
    constructor(code, { status = HttpStatus.BAD_REQUEST, message, details } = {}) {
        super(message ?? code);
        this.name = "CustomError";
        this.code = code;       // identidad estable del error
        this.status = status;   // HTTP status
        this.details = details; // opcional: { field, ... }
        this.expected = true;   // distingue error de dominio de bug inesperado
    }
}

// Catálogo: única fuente de verdad `code -> (status HTTP, mensaje por defecto)`.
const CATALOG = Object.freeze({
    // ─── Validación de input ────────────────────────────────────────────────
    VALIDATION_ERROR: { status: HttpStatus.BAD_REQUEST, message: "Datos inválidos" },

    // ─── Gastos ──────────────────────────────────────────────────────────────
    GASTO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Gasto no encontrado" },
    GASTO_POSTERGADO: { status: HttpStatus.CONFLICT, message: "El gasto está postergado para la próxima sesión de cuentas." },
    GASTO_NO_PENDIENTE_APROBACION: { status: HttpStatus.BAD_REQUEST, message: "El gasto no está pendiente de aprobación" },
    GASTO_COMPARTIDO_NO_ASOCIADO: { status: HttpStatus.BAD_REQUEST, message: "No hay gasto compartido asociado" },
    GASTO_COMPARTIDO_NO_RECHAZADO: { status: HttpStatus.BAD_REQUEST, message: "El gasto compartido no está rechazado" },
    GASTO_YA_SALDADO: { status: HttpStatus.CONFLICT, message: "El gasto ya tiene todas sus cuotas pagas" },
    SIN_CUOTAS_PARA_REVERTIR: { status: HttpStatus.BAD_REQUEST, message: "No hay cuotas pagadas para revertir" },
    LISTA_IDS_INVALIDA: { status: HttpStatus.BAD_REQUEST, message: "La lista de IDs de compra es inválida." },

    // ─── Entidades financieras ───────────────────────────────────────────────
    ENTIDAD_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad no encontrada" },
    ENTIDAD_FINANCIERA_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad financiera no encontrada o eliminada" },
    ENTIDAD_PAGO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Entidad de pago no encontrada o eliminada" },
    ENTIDAD_NOT_FOUND_O_AJENA: { status: HttpStatus.BAD_REQUEST, message: "Entidad no encontrada o no pertenece al usuario" },
    ENTIDAD_YA_EXISTE: { status: HttpStatus.BAD_REQUEST, message: "Ya existe esta entidad" },
    ENTIDAD_O_NOMBRE_REQUERIDO: { status: HttpStatus.BAD_REQUEST, message: "Debe seleccionar una entidad o proporcionar un nombre para crear una nueva" },
    VINCULAR_CUENTA_PROPIA: { status: HttpStatus.BAD_REQUEST, message: "No podés vincular tu propia cuenta" },
    ENTIDAD_YA_VINCULADA: { status: HttpStatus.BAD_REQUEST, message: "Ya tenés una entidad vinculada a ese usuario" },

    // ─── Usuarios / auth ─────────────────────────────────────────────────────
    USUARIO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Usuario no encontrado" },
    USUARIO_EMAIL_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "No existe un usuario registrado con ese email" },
    CREDENCIALES_INVALIDAS: { status: HttpStatus.UNAUTHORIZED, message: "Credenciales incorrectas" },
    EMAIL_YA_REGISTRADO: { status: HttpStatus.CONFLICT, message: "El email ya existe" },

    // ─── Compartidos ─────────────────────────────────────────────────────────
    NO_AUTORIZADO: { status: HttpStatus.FORBIDDEN, message: "No autorizado" },
    PAGO_PENDIENTE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Pago pendiente no encontrado" },

    // ─── Categorías ──────────────────────────────────────────────────────────
    CATEGORIA_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Categoría no encontrada" },

    // ─── Modo "hacer cuentas" (settlement) ────────────────────────────────────
    SETTLEMENT_REQUIRED: { status: HttpStatus.CONFLICT, message: 'Activá el modo "Hacer cuentas" para registrar pagos.' },
    NO_OPEN_SESSION: { status: HttpStatus.BAD_REQUEST, message: "No hay una sesión de cuentas abierta" },
    SNAPSHOT_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Snapshot no encontrado" },
});

/**
 * Códigos como constantes navegables: `ErrorCode.GASTO_NOT_FOUND === "GASTO_NOT_FOUND"`.
 * Usalo siempre en vez del string literal para que un typo explote en dev.
 */
export const ErrorCode = Object.freeze(
    Object.fromEntries(Object.keys(CATALOG).map((k) => [k, k])),
);

/**
 * Fábrica única de errores de dominio.
 * @param {string} code  una clave de `ErrorCode`
 * @param {{ message?: string, status?: number, details?: any }} [overrides]
 *        `message` para un texto custom (p. ej. interpolado con datos), etc.
 */
export function customError(code, overrides = {}) {
    const base = CATALOG[code] ?? { status: HttpStatus.INTERNAL_SERVER_ERROR };
    return new CustomError(code, { ...base, ...overrides });
}

/**
 * Responde un 400 de validación de input, con `code` para que el cliente no
 * dependa del texto. Para usar en los controllers ANTES de llamar al service.
 * @param {import("express").Response} res
 * @param {string} message  texto para mostrar
 * @param {any} [details]    opcional: { field, ... }
 */
export function badRequest(res, message, details) {
    return res.status(HttpStatus.BAD_REQUEST).json({
        error: message,
        code: ErrorCode.VALIDATION_ERROR,
        ...(details ? { details } : {}),
    });
}

/**
 * Traduce cualquier error a la respuesta HTTP. Lo llaman todos los `catch` de
 * los controllers: un `CustomError` sale con su `status`/`code`/`message`;
 * cualquier otra cosa es un bug -> se loguea y sale 500 genérico.
 */
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

/**
 * Middleware de Express de último recurso: si algún handler async lanza sin
 * capturar, esto evita que se caiga el request. Se registra al final de la app.
 */
export function errorMiddleware(err, req, res, next) {
    if (res.headersSent) return next(err);
    return handleError(res, err);
}
