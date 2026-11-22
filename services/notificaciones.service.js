import { customError, ErrorCode } from "../utils/errors.js";

const LIMITE_POR_DEFECTO = 30;
const LIMITE_MAXIMO = 100;

const parseData = (value) => (typeof value === "string" ? JSON.parse(value) : (value ?? {}));

const idInvalido = (field) =>
    customError(ErrorCode.VALIDATION_ERROR, {
        message: "El identificador es inválido.",
        details: { field },
    });

function normalizarLimite(limit) {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 1) return LIMITE_POR_DEFECTO;
    return Math.min(value, LIMITE_MAXIMO);
}

export class NotificacionesService {
    constructor({ notificacionesRepository }) {
        this.notificacionesRepository = notificacionesRepository;
    }

    async listar(userId, { limit, before } = {}) {
        if (before !== undefined && !/^\d+$/.test(String(before))) throw idInvalido("before");

        const limite = normalizarLimite(limit);
        const [rows, unreadCount] = await Promise.all([
            this.notificacionesRepository.listar(userId, limite + 1, before ?? null),
            this.notificacionesRepository.contarNoLeidas(userId),
        ]);
        const items = rows.slice(0, limite).map((row) => ({ ...row, data: parseData(row.data) }));

        return {
            items,
            unread_count: unreadCount,
            next_before: rows.length > limite ? items[items.length - 1].id : null,
        };
    }

    async marcarLeida(id, userId) {
        if (!/^\d+$/.test(String(id))) throw idInvalido("id");
        await this.notificacionesRepository.marcarLeida(id, userId);
        return { unread_count: await this.notificacionesRepository.contarNoLeidas(userId) };
    }

    async marcarTodasLeidas(userId) {
        await this.notificacionesRepository.marcarTodasLeidas(userId);
        return { unread_count: 0 };
    }
}
