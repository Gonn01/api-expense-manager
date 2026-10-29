import { MovementType, ExpenseStatus, ExpenseType, Currency } from "../utils/enums.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { logRed } from "../utils/logs_custom.js";
import { withTransaction, bestEffort } from "../db.js";

export class GastosService {
    constructor({
        gastosRepository,
        movementsRepository,
        entidadesFinancierasRepository,
        categoriasRepository,
        settlementRepository,
        runInTransaction = withTransaction,
    }) {
        this.gastosRepository = gastosRepository;
        this.movementsRepository = movementsRepository;
        this.entidadesFinancierasRepository = entidadesFinancierasRepository;
        this.categoriasRepository = categoriasRepository;
        this.settlementRepository = settlementRepository;
        this.tx = runInTransaction;
    }

    async #logEntidad(entidadId, type, detail = null) {
        if (!entidadId) return;
        try {
            await bestEffort(() => this.movementsRepository.createEntidadLog(entidadId, type, detail));
        } catch (err) {
            logRed(`[historial entidad ${entidadId}] no se pudo registrar ${type}: ${err.message}`);
        }
    }

    async requireSettlementSession(userId) {
        if (!this.settlementRepository) return null;
        if (!userId) throw customError(ErrorCode.SETTLEMENT_REQUIRED);
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) throw customError(ErrorCode.SETTLEMENT_REQUIRED);
        return session;
    }

    async getOpenSettlementSession(userId) {
        if (!this.settlementRepository || !userId) return null;
        return await this.settlementRepository.getOpenSession(userId);
    }

    async #assertOwner(gasto, userId, { allowReceiver = false } = {}) {
        if (userId == null) throw customError(ErrorCode.NO_AUTORIZADO);

        if (gasto.financial_entity_id) {
            const entidad = await this.entidadesFinancierasRepository.getById(
                gasto.financial_entity_id,
                userId,
            );
            if (entidad.length) return;
        } else if (allowReceiver && String(gasto.receiver_user_id) === String(userId)) {
            return;
        }

        throw customError(ErrorCode.NO_AUTORIZADO);
    }

    async #getOwned(id, userId, options) {
        const rows = await this.gastosRepository.getById(id);
        if (rows.length === 0) throw customError(ErrorCode.GASTO_NOT_FOUND);
        await this.#assertOwner(rows[0], userId, options);
        return rows;
    }

    async #getOwnedWithOwner(id, userId) {
        if (userId == null) throw customError(ErrorCode.NO_AUTORIZADO);
        if (!/^\d+$/.test(String(id))) throw customError(ErrorCode.GASTO_NOT_FOUND);

        const [row] = await this.gastosRepository.getByIdsWithOwner([String(id)], userId);
        if (!row) throw customError(ErrorCode.GASTO_NOT_FOUND);
        const { owned, ...gasto } = row;
        if (!owned) throw customError(ErrorCode.NO_AUTORIZADO);
        return [gasto];
    }

    async assertOwnedAll(ids, userId) {
        if (userId == null) throw customError(ErrorCode.NO_AUTORIZADO);

        const wanted = [...new Set(ids.map(String))];
        if (wanted.length === 0) return;
        if (wanted.some((id) => !/^\d+$/.test(id))) throw customError(ErrorCode.NO_AUTORIZADO);

        const rows = await this.gastosRepository.getOwnedIds(wanted, userId);
        const owned = new Set(rows.map((r) => String(r.id)));
        if (wanted.some((id) => !owned.has(id))) throw customError(ErrorCode.NO_AUTORIZADO);
    }

    #isFullyPaid({ fixed_expense, payed_quotas, number_of_quotas }) {
        return !fixed_expense && Number(payed_quotas ?? 0) >= Number(number_of_quotas ?? 1);
    }

    #assertQuotasRestantes(gasto) {
        if (this.#isFullyPaid(gasto)) {
            throw customError(ErrorCode.GASTO_YA_SALDADO);
        }
    }

    async getById(id, userId) {
        const row = await this.#getOwned(id, userId, { allowReceiver: true });

        const [movements, categories, editLocks] = await Promise.all([
            this.movementsRepository.getMovementsByGasto(id),
            this.categoriasRepository.getCategoriasByGasto(id),
            row[0].financial_entity_id ? this.#editLocks(row[0], userId) : null,
        ]);

        row[0].movements = movements;
        row[0].categories = categories;
        row[0].edit_locks = editLocks;
        return row[0];
    }

    #modoLabel(fixed, quotas) {
        if (fixed) return "Fijo";
        return Number(quotas) > 1 ? `En cuotas (${quotas})` : "Pago único";
    }

    #normalizarUpdate(input, current) {
        const invalid = (field, message) =>
            customError(ErrorCode.VALIDATION_ERROR, { message, details: { field } });
        const has = (k) => input[k] !== undefined;

        let name = current.name;
        if (has("name")) {
            if (typeof input.name !== "string" || !input.name.trim()) {
                throw invalid("name", "El nombre del gasto es obligatorio.");
            }
            name = input.name.trim();
        }

        let amount = Number(current.amount);
        if (has("amount")) {
            amount = Number(input.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw invalid("amount", "El monto debe ser mayor a 0.");
            }
        }

        let type = current.type;
        if (has("type")) {
            type = String(input.type).toUpperCase();
            if (!Object.values(ExpenseType).includes(type)) {
                throw invalid("type", "El tipo del gasto es inválido.");
            }
        }

        let currency_type = current.currency_type;
        if (has("currency_type")) {
            currency_type = String(input.currency_type).toUpperCase();
            if (!Object.values(Currency).includes(currency_type)) {
                throw invalid("currency_type", "La moneda es inválida.");
            }
        }

        const fixed_expense = has("fixed_expense")
            ? Boolean(input.fixed_expense)
            : Boolean(current.fixed_expense);

        let number_of_quotas = Number(current.number_of_quotas) || 0;
        if (has("number_of_quotas")) {
            number_of_quotas = Number(input.number_of_quotas);
            if (!Number.isInteger(number_of_quotas) || number_of_quotas < 0) {
                throw invalid("number_of_quotas", "La cantidad de cuotas debe ser un entero positivo.");
            }
        }
        if (!fixed_expense && number_of_quotas < 1) number_of_quotas = 1;

        let payed_quotas;
        if (has("payed_quotas") && input.payed_quotas !== null) {
            payed_quotas = Number(input.payed_quotas);
            if (!Number.isInteger(payed_quotas) || payed_quotas < 0) {
                throw invalid("payed_quotas", "Las cuotas pagadas deben ser un entero positivo.");
            }
        }

        let financial_entity_id = current.financial_entity_id;
        if (has("financial_entity_id") && input.financial_entity_id !== null) {
            if (!/^\d+$/.test(String(input.financial_entity_id))) {
                throw invalid("financial_entity_id", "La entidad es inválida.");
            }
            financial_entity_id = Number(input.financial_entity_id);
        }

        let category_ids;
        if (has("category_ids") && input.category_ids !== null) {
            if (!Array.isArray(input.category_ids)) {
                throw invalid("category_ids", "Las categorías son inválidas.");
            }
            category_ids = input.category_ids;
        }

        const image_url = has("image_url") ? input.image_url || null : current.image_url ?? null;

        return {
            name,
            amount,
            type,
            currency_type,
            fixed_expense,
            number_of_quotas,
            payed_quotas,
            financial_entity_id,
            category_ids,
            image_url,
        };
    }

    async #levantarPostergacionParaPagar(gasto) {
        if (!gasto.is_postponed) return;
        await this.gastosRepository.setPostponed(gasto.id, false);
        await this.movementsRepository.createGastoLog(gasto.id, MovementType.UNPOSTPONED);
        await this.#logEntidad(
            gasto.financial_entity_id,
            MovementType.UNPOSTPONED,
            `Postergación quitada al registrar el pago: "${gasto.name}"`,
        );
    }

    #modo(fixed, quotas) {
        if (fixed) return "fixed";
        return Number(quotas) > 1 ? "installment" : "single";
    }

    async #editLockContext(gasto, userId) {
        const [siblings, session] = await Promise.all([
            this.gastosRepository.getSharedSibling(gasto.id),
            this.getOpenSettlementSession(userId),
        ]);
        const marked = session
            ? await this.settlementRepository.hasItem(session.id, gasto.id)
            : false;
        return { hasSibling: Boolean(siblings?.length), marked };
    }

    #computeEditLocks(gasto, { hasSibling, marked }) {
        const paid = Number(gasto.payed_quotas) || 0;
        const pending = Number(gasto.pending_quotas) || 0;
        const quotas = Math.max(Number(gasto.number_of_quotas) || 0, 1);
        const finalized = !gasto.fixed_expense && paid >= quotas;
        const shared =
            hasSibling ||
            Boolean(gasto.shared_from_id) ||
            gasto.status === ExpenseStatus.PENDING_APPROVAL;

        const locks = {};
        const lock = (fields, reason) => {
            for (const f of fields) if (!locks[f]) locks[f] = reason;
        };
        const estructura = ["amount", "currency_type", "type", "mode", "number_of_quotas", "financial_entity_id"];

        lock(["payed_quotas"], "Los pagos se registran con Pagar y se deshacen con Revertir.");
        if (finalized) {
            lock(estructura, "El gasto está finalizado: solo se pueden cambiar el nombre y las categorías.");
        }
        if (shared) {
            lock(estructura, "El gasto está compartido con otro usuario: el cambio no llegaría a su copia.");
        }
        if (marked) {
            lock(
                ["amount", "currency_type", "type"],
                "El gasto está marcado en la sesión de cuentas abierta. Desmarcalo o terminá la sesión para cambiarlo.",
            );
        }
        if (paid + pending > 0) {
            lock(["currency_type", "type", "mode"], "El gasto ya tiene pagos registrados.");
        }
        return locks;
    }

    async #editLocks(gasto, userId) {
        return this.#computeEditLocks(gasto, await this.#editLockContext(gasto, userId));
    }

    async update(id, userId, input = {}) {
        return this.tx(async () => {
            const [current] = await this.#getOwnedWithOwner(id, userId);
            const base = this.#normalizarUpdate({}, current);
            const next = this.#normalizarUpdate(input, current);
            const linkedId = current.linked_purchase_id;
            const applyToLinked = Boolean(input.apply_to_linked) && Boolean(linkedId);

            const [lockContext, mirrorRows, currentCategories] = await Promise.all([
                this.#editLockContext(current, userId),
                applyToLinked ? this.gastosRepository.getById(linkedId) : [],
                next.category_ids ? this.categoriasRepository.getCategoriasByGasto(id) : [],
            ]);
            const [mirror] = mirrorRows;

            const locks = this.#computeEditLocks(current, lockContext);
            if (mirror) {
                const mirrorLocks = await this.#editLocks(mirror, userId);
                for (const [field, reason] of Object.entries(mirrorLocks)) {
                    if (field === "financial_entity_id") continue;
                    if (!locks[field]) locks[field] = `Movimiento vinculado: ${reason}`;
                }
            }

            const paid = Number(current.payed_quotas) || 0;
            const pending = Number(current.pending_quotas) || 0;
            const ambosFijos = base.fixed_expense && next.fixed_expense;
            const changed = {
                amount: next.amount !== base.amount,
                currency_type: next.currency_type !== base.currency_type,
                type: next.type !== base.type,
                mode:
                    this.#modo(base.fixed_expense, base.number_of_quotas) !==
                    this.#modo(next.fixed_expense, next.number_of_quotas),
                number_of_quotas: !ambosFijos && next.number_of_quotas !== base.number_of_quotas,
                financial_entity_id: String(next.financial_entity_id) !== String(base.financial_entity_id),
                payed_quotas: next.payed_quotas !== undefined && next.payed_quotas !== paid,
            };
            for (const [field, didChange] of Object.entries(changed)) {
                if (didChange && locks[field]) {
                    throw customError(ErrorCode.GASTO_CAMPO_NO_EDITABLE, {
                        message: locks[field],
                        details: { field },
                    });
                }
            }

            if (!next.fixed_expense && next.number_of_quotas < paid + pending) {
                throw customError(ErrorCode.VALIDATION_ERROR, {
                    message: "La cantidad de cuotas no puede ser menor que las cuotas ya pagadas o pendientes.",
                    details: { field: "number_of_quotas" },
                });
            }

            let entidadActual = null;
            let entidadNueva = null;
            if (changed.financial_entity_id) {
                [[entidadNueva], [entidadActual]] = await Promise.all([
                    this.entidadesFinancierasRepository.getById(next.financial_entity_id, userId),
                    this.entidadesFinancierasRepository.getById(current.financial_entity_id, userId),
                ]);
                if (!entidadNueva) throw customError(ErrorCode.ENTIDAD_FINANCIERA_NOT_FOUND);

                if (entidadNueva.linked_user_id || entidadActual?.linked_user_id) {
                    throw customError(ErrorCode.GASTO_ENTIDAD_NO_EDITABLE, {
                        message: "Un gasto no se puede mover desde o hacia una entidad compartida con otro usuario.",
                    });
                }
                if (linkedId && String(next.financial_entity_id) === String(current.linked_financial_entity_id)) {
                    throw customError(ErrorCode.GASTO_ENTIDAD_NO_EDITABLE, {
                        message: "El gasto no se puede mover a la entidad de su movimiento vinculado.",
                    });
                }
            }

            const changes = [];
            if (current.name !== next.name) {
                changes.push(`Nombre: "${current.name}" → "${next.name}"`);
            }
            if (changed.amount) {
                changes.push(`Monto: $${current.amount} → $${next.amount}`);
            }
            if (changed.currency_type) {
                changes.push(`Moneda: ${base.currency_type} → ${next.currency_type}`);
            }
            if (changed.type) {
                const label = (t) => (t === ExpenseType.INGRESO ? "Ingreso" : "Egreso");
                changes.push(`Tipo: ${label(base.type)} → ${label(next.type)}`);
            }
            const modoAntes = this.#modoLabel(base.fixed_expense, base.number_of_quotas);
            const modoDespues = this.#modoLabel(next.fixed_expense, next.number_of_quotas);
            if (modoAntes !== modoDespues) {
                changes.push(`Frecuencia: ${modoAntes} → ${modoDespues}`);
            }
            if (changed.financial_entity_id) {
                changes.push(`Entidad: "${entidadActual?.name ?? "-"}" → "${entidadNueva.name}"`);
            }
            const categoriesChanged =
                Boolean(next.category_ids) &&
                JSON.stringify(currentCategories.map((c) => String(c.id)).sort()) !==
                    JSON.stringify(next.category_ids.map((cid) => String(cid)).sort());
            if (categoriesChanged) {
                changes.push("Categorías actualizadas");
            }
            const editDetail = changes.length ? changes.join("\n") : null;

            const [row] = await this.gastosRepository.update(id, next);
            if (!row) throw customError(ErrorCode.GASTO_NOT_FOUND);

            await Promise.all([
                changes.length
                    ? this.movementsRepository.createGastoLog(id, MovementType.EDITED, null, null, null, editDetail)
                    : null,
                categoriesChanged
                    ? this.categoriasRepository.setCategoriasForGasto(id, next.category_ids)
                    : null,
            ]);

            if (current.name !== next.name) {
                await this.#logEntidad(
                    next.financial_entity_id,
                    MovementType.EDITED,
                    `Gasto renombrado: "${current.name}" → "${next.name}"`,
                );
            }
            if (changed.financial_entity_id) {
                await this.#logEntidad(
                    current.financial_entity_id,
                    MovementType.EDITED,
                    `Gasto movido a "${entidadNueva.name}": "${next.name}"`,
                );
                await this.#logEntidad(
                    next.financial_entity_id,
                    MovementType.EDITED,
                    `Gasto traído desde "${entidadActual?.name ?? "-"}": "${next.name}"`,
                );
            }

            if (mirror) {
                const oppositeType = next.type === ExpenseType.INGRESO
                    ? ExpenseType.EGRESO
                    : ExpenseType.INGRESO;
                await this.gastosRepository.update(linkedId, {
                    ...next,
                    type: oppositeType,
                    financial_entity_id: mirror.financial_entity_id,
                });
                if (changes.length) {
                    await this.movementsRepository.createGastoLog(
                        linkedId, MovementType.EDITED, null, null, null, editDetail,
                    );
                }
                if (next.category_ids) {
                    await this.categoriasRepository.setCategoriasForGasto(linkedId, next.category_ids);
                }
                if (mirror.name !== next.name) {
                    await this.#logEntidad(
                        mirror.financial_entity_id,
                        MovementType.EDITED,
                        `Gasto renombrado: "${mirror.name}" → "${next.name}"`,
                    );
                }
            }

            const [[updated], movements, categories] = await Promise.all([
                this.gastosRepository.getById(id),
                this.movementsRepository.getMovementsByGasto(id),
                this.categoriasRepository.getCategoriasByGasto(id),
            ]);
            updated.movements = movements;
            updated.categories = categories;
            updated.edit_locks = this.#computeEditLocks(updated, lockContext);
            return updated;
        });
    }

    async delete(id, userId, delete_linked = false) {
        return this.tx(async () => {
            const current = await this.#getOwned(id, userId);
            const linkedId = current[0].linked_purchase_id;

            const row = await this.gastosRepository.delete(id);

            if (!row || row.length === 0) {
                throw customError(ErrorCode.GASTO_NOT_FOUND);
            }

            await this.movementsRepository.createGastoLog(id, MovementType.DELETE);
            await this.#logEntidad(
                current[0].financial_entity_id,
                MovementType.DELETE,
                `Gasto eliminado: "${current[0].name}"`,
            );

            if (linkedId) {
                if (delete_linked) {
                    await this.gastosRepository.delete(linkedId);
                    await this.#logEntidad(
                        current[0].linked_financial_entity_id,
                        MovementType.DELETE,
                        `Gasto eliminado: "${current[0].linked_name ?? current[0].name}"`,
                    );
                } else {
                    await this.gastosRepository.unlink(id);
                }
            }

            return row[0];
        });
    }

    async restaurar(id, userId) {
        return this.tx(async () => {
            const [gasto] = await this.gastosRepository.getByIdIncludingDeleted(id);
            if (!gasto) throw customError(ErrorCode.GASTO_NOT_FOUND);

            await this.#assertOwner(gasto, userId);

            const [restored] = await this.gastosRepository.restore(id);
            if (!restored) throw customError(ErrorCode.GASTO_NOT_FOUND);

            await this.movementsRepository.createGastoLog(id, MovementType.RESTORE);
            await this.#logEntidad(
                gasto.financial_entity_id,
                MovementType.RESTORE,
                `Gasto restaurado: "${gasto.name}"`,
            );

            return await this.getById(id, userId);
        });
    }

    async #crearCompraConLogs({
        financial_entity_id,
        name,
        amount,
        number_of_quotas,
        currency_type,
        fixed_expense,
        image_url,
        type,
        status,
        payed_quotas = 0,
        category_ids = [],
        linked_purchase_id = null,
        is_postponed = false,
    }) {
        const rows = await this.gastosRepository.create({
            financial_entity_id,
            name,
            amount,
            number_of_quotas,
            currency_type,
            fixed_expense,
            image_url,
            type,
            status,
            linked_purchase_id,
            is_postponed,
        });

        const gastoId = rows[0].id;
        const amountPerQuota = number_of_quotas > 0 ? amount / number_of_quotas : amount;
        const paymentDate = new Date();

        const logs = [
            { gastoId, movementType: MovementType.CREATION },
            ...Array.from({ length: Number(payed_quotas) || 0 }, () => ({
                gastoId,
                movementType: MovementType.PAYMENT,
                amount: amountPerQuota,
                paymentDate,
            })),
        ];

        const [, categories] = await Promise.all([
            this.movementsRepository.createGastoLogs(logs),
            this.categoriasRepository.addCategoriasToNewGasto(gastoId, category_ids),
        ]);

        rows[0].categories = categories;

        return rows;
    }

    async crearGasto(
        financial_entity_id,
        name,
        amount,
        number_of_quotas,
        currency_type,
        fixed_expense,
        image_url,
        type,
        userId,
        payed_quotas = 0,
        category_ids = [],
        payment_entity_id = null,
        postponed = false
    ) {
        if (postponed && this.#isFullyPaid({ fixed_expense, payed_quotas, number_of_quotas })) {
            throw customError(ErrorCode.GASTO_PAGADO_NO_POSTERGABLE);
        }

        const usaEntidadPago = payment_entity_id && String(payment_entity_id) !== String(financial_entity_id);
        const entidadLogs = [];

        const created = await this.tx(async () => {
            const [entidad, entidadPago] = await Promise.all([
                this.entidadesFinancierasRepository.getById(financial_entity_id, userId),
                usaEntidadPago
                    ? this.entidadesFinancierasRepository.getById(payment_entity_id, userId)
                    : null,
            ]);
            if (!entidad.length) throw customError(ErrorCode.ENTIDAD_FINANCIERA_NOT_FOUND);
            if (usaEntidadPago && !entidadPago.length) throw customError(ErrorCode.ENTIDAD_PAGO_NOT_FOUND);

            const rows = await this.#crearCompraConLogs({
                financial_entity_id,
                name,
                amount,
                number_of_quotas,
                currency_type,
                fixed_expense,
                image_url,
                type,
                status: entidad[0].linked_user_id ? ExpenseStatus.PENDING_APPROVAL : ExpenseStatus.ACTIVE,
                payed_quotas,
                category_ids,
                is_postponed: Boolean(postponed),
            });

            const gastoId = rows[0].id;

            entidadLogs.push([
                financial_entity_id,
                MovementType.PURCHASE_CREATED,
                `Gasto creado: "${name}"`,
            ]);

            if (entidad[0].linked_user_id) {
                await triggerCompartidos(entidad[0].linked_user_id, 'compartido.nuevo', { gastoId });
                const sharedRows = await this.gastosRepository.create({
                    financial_entity_id: null,
                    name,
                    amount,
                    number_of_quotas,
                    currency_type,
                    fixed_expense,
                    image_url,
                    type,
                    status: ExpenseStatus.PENDING_APPROVAL,
                    shared_from_id: gastoId,
                    receiver_user_id: entidad[0].linked_user_id,
                });
                await this.movementsRepository.createGastoLog(sharedRows[0].id, MovementType.CREATION);
            }

            if (usaEntidadPago) {
                const oppositeType = String(type).toUpperCase() === ExpenseType.INGRESO
                    ? ExpenseType.EGRESO
                    : ExpenseType.INGRESO;

                const mirror = await this.#crearCompraConLogs({
                    financial_entity_id: payment_entity_id,
                    name,
                    amount,
                    number_of_quotas,
                    currency_type,
                    fixed_expense,
                    image_url,
                    type: oppositeType,
                    status: ExpenseStatus.ACTIVE,
                    payed_quotas,
                    category_ids,
                    linked_purchase_id: gastoId,
                });

                await this.gastosRepository.linkPurchases(gastoId, mirror[0].id);
                rows[0].linked_purchase_id = mirror[0].id;

                entidadLogs.push([
                    payment_entity_id,
                    MovementType.PURCHASE_CREATED,
                    `Gasto espejo creado: "${name}"`,
                ]);
            }

            return rows;
        });

        for (const log of entidadLogs) await this.#logEntidad(...log);
        return created;
    }

    async postergarGasto(id, userId, postponed) {
        const value = Boolean(postponed);
        let entidadLog = null;

        const updated = await this.tx(async () => {
            const [current] = await this.#getOwnedWithOwner(id, userId);

            if (value && this.#isFullyPaid(current)) {
                throw customError(ErrorCode.GASTO_PAGADO_NO_POSTERGABLE);
            }
            if (value === current.is_postponed) return current;

            const type = value ? MovementType.POSTPONED : MovementType.UNPOSTPONED;
            const [[row]] = await Promise.all([
                this.gastosRepository.setPostponed(id, value),
                this.movementsRepository.createGastoLog(id, type),
            ]);

            entidadLog = [
                current.financial_entity_id,
                type,
                `${value ? "Postergación agregada" : "Postergación quitada"}: "${current.name}"`,
            ];
            return row;
        });

        if (entidadLog) await this.#logEntidad(...entidadLog);
        return updated;
    }

    async marcarFavorito(id, userId, favorite) {
        await this.#getOwnedWithOwner(id, userId);

        const [updated] = await this.gastosRepository.setFavorite(id, Boolean(favorite));
        return updated;
    }

    async actualizarCategorias(gastoId, userId, categoryIds) {
        return this.tx(async () => {
            await this.#getOwned(gastoId, userId);
            await this.categoriasRepository.setCategoriasForGasto(gastoId, categoryIds);
            return await this.categoriasRepository.getCategoriasByGasto(gastoId);
        });
    }

    async settleQuota(purchase_id, userId, { direct = false } = {}) {
        return this.tx(async () => {
            const [rows, session] = await Promise.all([
                this.#getOwnedWithOwner(purchase_id, userId),
                direct ? null : this.getOpenSettlementSession(userId),
            ]);
            this.#assertQuotasRestantes(rows[0]);

            if (session) {
                if (rows[0].is_postponed) {
                    throw customError(ErrorCode.GASTO_POSTERGADO);
                }
                await this.settlementRepository.upsertItem(session.id, purchase_id);
                return rows;
            }

            await this.#levantarPostergacionParaPagar(rows[0]);

            await this.effectSettlement(rows[0], userId);
            return await this.gastosRepository.getById(purchase_id);
        });
    }

    async effectSettlementBatch(purchaseIds, userId, paymentDate = new Date()) {
        return this.tx(async () => {
            if (userId == null) throw customError(ErrorCode.NO_AUTORIZADO);
            const ids = [...new Set(purchaseIds.map(String))].filter((id) => /^\d+$/.test(id));
            if (!ids.length) return { kept: [], discarded: purchaseIds.map(Number) };

            const [rows, siblings] = await Promise.all([
                this.gastosRepository.getByIdsWithOwner(ids, userId),
                this.gastosRepository.getSharedSiblings(ids),
            ]);
            const byId = new Map(rows.map((r) => [String(r.id), r]));
            const siblingById = new Map(siblings.map((s) => [String(s.purchase_id), s]));

            const kept = [];
            const discarded = [];
            const logs = [];
            const notifications = [];

            for (const id of ids) {
                const gasto = byId.get(id);
                const fullyPaid = gasto && this.#isFullyPaid(gasto);

                if (!gasto || !gasto.owned || gasto.is_postponed || fullyPaid) {
                    discarded.push(Number(id));
                    continue;
                }
                kept.push(Number(id));

                const sibling = siblingById.get(id);
                const esCompartido =
                    sibling &&
                    sibling.counterparty_user_id &&
                    String(sibling.counterparty_user_id) !== String(userId);

                if (!esCompartido) {
                    logs.push({
                        gastoId: gasto.id,
                        movementType: MovementType.PAYMENT,
                        amount: gasto.amount_per_quota,
                        paymentDate,
                    });
                    continue;
                }

                const yaCubierto =
                    !gasto.fixed_expense &&
                    (Number(gasto.payed_quotas) || 0) + (Number(gasto.pending_quotas) || 0) >=
                        Number(gasto.number_of_quotas);
                if (yaCubierto) continue;

                logs.push({
                    gastoId: gasto.id,
                    movementType: MovementType.PENDING_PAYMENT,
                    amount: gasto.amount_per_quota,
                    paymentDate,
                    createdByUserId: userId,
                });
                notifications.push([sibling.counterparty_user_id, gasto.id]);
            }

            await this.movementsRepository.createGastoLogs(logs);

            await Promise.all([
                this.gastosRepository.clearFavoritesIfFinalized(kept),
                ...notifications.map(([counterparty, purchaseId]) =>
                    triggerCompartidos(counterparty, "pago.pendiente", { purchaseId }),
                ),
            ]);

            for (const id of purchaseIds) {
                if (!/^\d+$/.test(String(id))) discarded.push(id);
            }
            return { kept, discarded };
        });
    }

    async effectSettlement(gasto, userId, paymentDate = new Date()) {
        const result = await this.#registrarPagoOPendiente(gasto, userId, paymentDate);
        await this.gastosRepository.clearFavoriteIfFinalized(gasto.id);
        return result;
    }

    async #registrarPagoOPendiente(gasto, userId, paymentDate) {
        const [sibling] = await this.gastosRepository.getSharedSibling(gasto.id);

        const esCompartido =
            sibling &&
            sibling.counterparty_user_id &&
            String(sibling.counterparty_user_id) !== String(userId);

        if (esCompartido) {
            const yaCubierto =
                !gasto.fixed_expense &&
                (Number(gasto.payed_quotas) || 0) + (Number(gasto.pending_quotas) || 0) >=
                    Number(gasto.number_of_quotas);

            if (yaCubierto) return { pending: true, skipped: true };

            await this.movementsRepository.createGastoLog(
                gasto.id, MovementType.PENDING_PAYMENT, gasto.amount_per_quota, paymentDate, userId,
            );
            await triggerCompartidos(sibling.counterparty_user_id, 'pago.pendiente', {
                purchaseId: gasto.id,
            });
            return { pending: true };
        }

        await this.movementsRepository.createGastoLog(
            gasto.id, MovementType.PAYMENT, gasto.amount_per_quota, paymentDate,
        );
        return { pending: false };
    }

    async refundCuota(purchase_id, userId) {
        return this.tx(async () => {
            const rows = await this.#getOwned(purchase_id, userId);
            if (rows[0].payed_quotas === 0) throw customError(ErrorCode.SIN_CUOTAS_PARA_REVERTIR);

            const deleted = await this.movementsRepository.deleteLastPayment(purchase_id);
            await this.movementsRepository.createGastoLog(purchase_id, MovementType.REFUND, deleted[0]?.amount ?? null, new Date());

            return await this.gastosRepository.getById(purchase_id);
        });
    }

    async settleQuotasLote(purchaseIds, userId) {
        if (!Array.isArray(purchaseIds) || purchaseIds.length === 0) {
            throw customError(ErrorCode.LISTA_IDS_INVALIDA);
        }

        const session = await this.requireSettlementSession(userId);

        const validIds = [...new Set(purchaseIds.map(String))].filter((id) => /^\d+$/.test(id));
        const rows = await this.gastosRepository.getByIdsWithOwner(validIds, userId);
        const byId = new Map(rows.map((r) => [String(r.id), r]));

        const updated = [];
        const failed = [];

        for (const id of purchaseIds) {
            const row = byId.get(String(id));
            if (!row) {
                failed.push({ id, reason: "Gasto no encontrado" });
                continue;
            }

            const { owned, ...gasto } = row;
            if (!owned) {
                failed.push({ id, reason: "No autorizado" });
                continue;
            }

            if (gasto.is_postponed) {
                failed.push({ id, reason: "Gasto postergado para la próxima sesión" });
                continue;
            }

            if (!gasto.fixed_expense && gasto.payed_quotas >= gasto.number_of_quotas) {
                failed.push({ id, reason: "Todas las cuotas ya están pagas" });
                continue;
            }

            updated.push(gasto);
        }

        if (updated.length) {
            await this.settlementRepository.upsertItems(
                session.id,
                updated.map((g) => Number(g.id)),
            );
        }

        return { updated, failed };
    }

    async obtenerMovementsPorGasto(gastoId) {
        return await this.movementsRepository.getMovementsByGasto(gastoId);
    }
}
