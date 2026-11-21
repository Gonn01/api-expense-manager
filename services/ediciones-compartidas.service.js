import { Currency, ExpenseStatus, ExpenseType, MovementType, PusherEvent } from "../utils/enums.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { computeEditLocks } from "../utils/gasto-edit-locks.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { withTransaction } from "../db.js";
import { MAX_INSTALLMENTS } from "./gastos.service.js";

const invalid = (field, message) => customError(ErrorCode.VALIDATION_ERROR, { message, details: { field } });

function parseChanges(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}

function modo(fixed, quotas) {
    if (fixed) return "fixed";
    return Number(quotas) > 1 ? "installment" : "single";
}

function modoLabel(fixed, quotas) {
    if (fixed) return "Fijo";
    return Number(quotas) > 1 ? `En cuotas (${quotas})` : "Pago único";
}

function tipoLabel(type) {
    return type === ExpenseType.INGRESO ? "Ingreso" : "Egreso";
}

export function normalizarCambios(input, gasto) {
    const has = (k) => input[k] !== undefined && input[k] !== null;

    let amount = Number(gasto.amount);
    if (has("amount")) {
        amount = Number(input.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw invalid("amount", "El monto debe ser mayor a 0.");
    }

    let currency_type = gasto.currency_type;
    if (has("currency_type")) {
        currency_type = String(input.currency_type).toUpperCase();
        if (!Object.values(Currency).includes(currency_type)) throw invalid("currency_type", "La moneda es inválida.");
    }

    let type = gasto.type;
    if (has("type")) {
        type = String(input.type).toUpperCase();
        if (!Object.values(ExpenseType).includes(type)) throw invalid("type", "El tipo del gasto es inválido.");
    }

    const fixed_expense = has("fixed_expense") ? Boolean(input.fixed_expense) : Boolean(gasto.fixed_expense);

    let number_of_quotas = Number(gasto.number_of_quotas) || 1;
    if (!fixed_expense && has("number_of_quotas")) {
        number_of_quotas = Number(input.number_of_quotas);
        if (!Number.isInteger(number_of_quotas) || number_of_quotas < 1) {
            throw invalid("number_of_quotas", "La cantidad de cuotas debe ser un entero positivo.");
        }
        if (number_of_quotas > MAX_INSTALLMENTS) {
            throw invalid("number_of_quotas", `El máximo es de ${MAX_INSTALLMENTS} cuotas.`);
        }
    }

    const changes = {};
    if (amount !== Number(gasto.amount)) changes.amount = amount;
    if (currency_type !== gasto.currency_type) changes.currency_type = currency_type;
    if (type !== gasto.type) changes.type = type;
    if (fixed_expense !== Boolean(gasto.fixed_expense)) changes.fixed_expense = fixed_expense;
    if (number_of_quotas !== (Number(gasto.number_of_quotas) || 1)) changes.number_of_quotas = number_of_quotas;
    return changes;
}

export function describirCambios(changes, gasto) {
    const lineas = [];
    if (changes.amount !== undefined) lineas.push(`Monto: $${gasto.amount} → $${changes.amount}`);
    if (changes.currency_type) lineas.push(`Moneda: ${gasto.currency_type} → ${changes.currency_type}`);
    if (changes.type) lineas.push(`Tipo: ${tipoLabel(gasto.type)} → ${tipoLabel(changes.type)}`);
    if (changes.fixed_expense !== undefined || changes.number_of_quotas !== undefined) {
        const fixed = changes.fixed_expense ?? Boolean(gasto.fixed_expense);
        const quotas = changes.number_of_quotas ?? gasto.number_of_quotas;
        lineas.push(
            `Frecuencia: ${modoLabel(gasto.fixed_expense, gasto.number_of_quotas)} → ${modoLabel(fixed, quotas)}`,
        );
    }
    return lineas.join("\n");
}

export class EdicionesCompartidasService {
    constructor({
        edicionesRepository,
        gastosRepository,
        movementsRepository,
        settlementRepository,
        runInTransaction = withTransaction,
    }) {
        this.edicionesRepository = edicionesRepository;
        this.gastosRepository = gastosRepository;
        this.movementsRepository = movementsRepository;
        this.settlementRepository = settlementRepository;
        this.tx = runInTransaction;
    }

    async #nombreDe(userId) {
        const [row] = (await this.gastosRepository.getUserName(userId)) ?? [];
        return row?.name ?? null;
    }

    async #estaMarcado(gastoId, ownerId) {
        const session = await this.settlementRepository.getOpenSession(ownerId);
        return session ? this.settlementRepository.hasItem(session.id, gastoId) : false;
    }

    async #assertAplicable(changes, gasto, ownerId) {
        if (gasto.status !== ExpenseStatus.ACTIVE) throw customError(ErrorCode.GASTO_NO_ACTIVO);

        const marked = await this.#estaMarcado(gasto.id, ownerId);
        const locks = computeEditLocks(gasto, { marked, ignoreShared: true });
        const fixed = changes.fixed_expense ?? Boolean(gasto.fixed_expense);
        const quotas = changes.number_of_quotas ?? gasto.number_of_quotas;
        const cambiaModo = modo(gasto.fixed_expense, gasto.number_of_quotas) !== modo(fixed, quotas);
        const cambiados = {
            amount: changes.amount !== undefined,
            currency_type: changes.currency_type !== undefined,
            type: changes.type !== undefined,
            mode: cambiaModo,
            number_of_quotas: !fixed && changes.number_of_quotas !== undefined,
        };
        for (const [field, cambio] of Object.entries(cambiados)) {
            if (cambio && locks[field]) {
                throw customError(ErrorCode.GASTO_CAMPO_NO_EDITABLE, { message: locks[field], details: { field } });
            }
        }

        const comprometidas = (Number(gasto.payed_quotas) || 0) + (Number(gasto.pending_quotas) || 0);
        if (!fixed && Number(quotas) < comprometidas) {
            throw invalid(
                "number_of_quotas",
                "La cantidad de cuotas no puede ser menor que las cuotas ya pagadas o pendientes.",
            );
        }
    }

    #logAmbos(request, type, userId, detail = null) {
        return Promise.all(
            [request.purchase_id, request.sibling_purchase_id].map((gastoId) =>
                this.movementsRepository.createGastoLog(gastoId, type, null, null, userId, detail),
            ),
        );
    }

    async #pendiente(id) {
        if (!/^\d+$/.test(String(id))) throw customError(ErrorCode.EDICION_NOT_FOUND);
        const [request] = await this.edicionesRepository.getById(id);
        if (!request || request.status !== "PENDING") throw customError(ErrorCode.EDICION_NOT_FOUND);
        return request;
    }

    async #pendienteBloqueada(id, assertActor) {
        const inicial = await this.#pendiente(id);
        assertActor(inicial);
        await this.gastosRepository.lockPurchases([inicial.purchase_id, inicial.sibling_purchase_id]);
        const request = await this.#pendiente(id);
        return { ...request, changes: parseChanges(request.changes) };
    }

    #assertContraparte(userId) {
        return (request) => {
            if (String(request.counterparty_user_id) !== String(userId)) throw customError(ErrorCode.NO_AUTORIZADO);
        };
    }

    async listar(userId) {
        const rows = await this.edicionesRepository.getPendingForUser(userId);
        const ediciones = { porConfirmar: [], esperando: [] };
        for (const row of rows) {
            const item = { ...row, changes: parseChanges(row.changes) };
            if (String(row.requested_by_user_id) === String(userId)) ediciones.esperando.push(item);
            else ediciones.porConfirmar.push(item);
        }
        return ediciones;
    }

    async solicitar(gastoId, userId, input = {}) {
        if (!/^\d+$/.test(String(gastoId))) throw customError(ErrorCode.GASTO_NOT_FOUND);
        return this.tx(async () => {
            const [owned] = await this.gastosRepository.getByIdsWithOwner([String(gastoId)], userId);
            if (!owned) throw customError(ErrorCode.GASTO_NOT_FOUND);
            if (!owned.owned) throw customError(ErrorCode.NO_AUTORIZADO);

            const [sibling] = await this.gastosRepository.getSharedSibling(gastoId);
            if (!sibling?.counterparty_user_id) throw customError(ErrorCode.GASTO_COMPARTIDO_NO_ASOCIADO);
            await this.gastosRepository.lockPurchases([gastoId, sibling.sibling_id]);

            const [[gasto], [copia], [existente]] = await Promise.all([
                this.gastosRepository.getById(gastoId),
                this.gastosRepository.getById(sibling.sibling_id),
                this.edicionesRepository.getPendingByPurchase(gastoId),
            ]);
            if (!gasto || !copia) throw customError(ErrorCode.GASTO_NOT_FOUND);
            if (existente) throw customError(ErrorCode.EDICION_YA_SOLICITADA);

            const changes = normalizarCambios(input, gasto);
            if (!Object.keys(changes).length) throw customError(ErrorCode.EDICION_SIN_CAMBIOS);

            await this.#assertAplicable(changes, gasto, userId);
            await this.#assertAplicable(changes, copia, sibling.counterparty_user_id);

            const [request] = await this.edicionesRepository.create({
                purchaseId: gasto.id,
                siblingPurchaseId: copia.id,
                requestedByUserId: userId,
                counterpartyUserId: sibling.counterparty_user_id,
                changes,
            });
            const [actorName] = await Promise.all([
                this.#nombreDe(userId),
                this.#logAmbos(request, MovementType.EDIT_REQUESTED, userId, describirCambios(changes, gasto)),
            ]);
            await triggerCompartidos(sibling.counterparty_user_id, PusherEvent.EDICION_SOLICITADA, {
                purchaseId: copia.id,
                actorName,
                gastoName: gasto.name,
            });
            return { ...request, changes };
        });
    }

    async aprobar(id, userId) {
        return this.tx(async () => {
            const request = await this.#pendienteBloqueada(id, this.#assertContraparte(userId));
            const [[gasto], [copia]] = await Promise.all([
                this.gastosRepository.getById(request.purchase_id),
                this.gastosRepository.getById(request.sibling_purchase_id),
            ]);
            if (!gasto || !copia) throw customError(ErrorCode.GASTO_NOT_FOUND);

            await this.#assertAplicable(request.changes, gasto, request.requested_by_user_id);
            await this.#assertAplicable(request.changes, copia, request.counterparty_user_id);

            const detail = describirCambios(request.changes, gasto);
            const [resolved, , , actorName] = await Promise.all([
                this.edicionesRepository.resolve(request.id, "APPROVED", userId),
                this.gastosRepository.update(gasto.id, { ...gasto, ...request.changes }),
                this.gastosRepository.update(copia.id, { ...copia, ...request.changes }),
                this.#nombreDe(userId),
                this.#logAmbos(request, MovementType.EDIT_APPROVED, userId, detail),
            ]);
            const aviso = { actorId: userId, actorName, gastoName: gasto.name };
            await Promise.all([
                triggerCompartidos(request.requested_by_user_id, PusherEvent.EDICION_APROBADA, {
                    purchaseId: gasto.id,
                    ...aviso,
                }),
                triggerCompartidos(request.counterparty_user_id, PusherEvent.EDICION_APROBADA, {
                    purchaseId: copia.id,
                    ...aviso,
                }),
            ]);
            return resolved[0];
        });
    }

    async rechazar(id, userId) {
        return this.tx(async () => {
            const request = await this.#pendienteBloqueada(id, this.#assertContraparte(userId));
            const [[gasto]] = await Promise.all([this.gastosRepository.getById(request.purchase_id)]);
            const [resolved, actorName] = await Promise.all([
                this.edicionesRepository.resolve(request.id, "REJECTED", userId),
                this.#nombreDe(userId),
                this.#logAmbos(
                    request,
                    MovementType.EDIT_REJECTED,
                    userId,
                    gasto ? describirCambios(request.changes, gasto) : null,
                ),
            ]);
            await triggerCompartidos(request.requested_by_user_id, PusherEvent.EDICION_RECHAZADA, {
                purchaseId: request.purchase_id,
                actorName,
                gastoName: gasto?.name ?? null,
            });
            return resolved[0];
        });
    }

    async cancelar(id, userId) {
        return this.tx(async () => {
            const request = await this.#pendienteBloqueada(id, (r) => {
                if (String(r.requested_by_user_id) !== String(userId)) throw customError(ErrorCode.NO_AUTORIZADO);
            });
            const [[gasto]] = await Promise.all([this.gastosRepository.getById(request.purchase_id)]);
            const [resolved, actorName] = await Promise.all([
                this.edicionesRepository.resolve(request.id, "CANCELLED", userId),
                this.#nombreDe(userId),
                this.#logAmbos(
                    request,
                    MovementType.EDIT_CANCELLED,
                    userId,
                    gasto ? describirCambios(request.changes, gasto) : null,
                ),
            ]);
            await triggerCompartidos(request.counterparty_user_id, PusherEvent.EDICION_CANCELADA, {
                purchaseId: request.sibling_purchase_id,
                actorName,
                gastoName: gasto?.name ?? null,
            });
            return resolved[0];
        });
    }
}
