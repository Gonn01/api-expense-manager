import { MovementType, ExpenseStatus, ExpenseType, Currency, PusherEvent } from "../utils/enums.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { computeEditLocks } from "../utils/gasto-edit-locks.js";
import { logRed } from "../utils/logs_custom.js";
import { withTransaction, bestEffort } from "../db.js";

export const MAX_INSTALLMENTS = 360;
const MAX_INSTALLMENTS_MESSAGE = `El máximo es de ${MAX_INSTALLMENTS} cuotas.`;
const ESTADOS_SIN_ACEPTAR = new Set([ExpenseStatus.REJECTED]);

export class GastosService {
    constructor({
        gastosRepository,
        movementsRepository,
        entidadesFinancierasRepository,
        categoriasRepository,
        settlementRepository,
        pagosCompartidosService,
        edicionesRepository,
        runInTransaction = withTransaction,
    }) {
        this.edicionesRepository = edicionesRepository;
        this.gastosRepository = gastosRepository;
        this.movementsRepository = movementsRepository;
        this.entidadesFinancierasRepository = entidadesFinancierasRepository;
        this.categoriasRepository = categoriasRepository;
        this.settlementRepository = settlementRepository;
        this.pagosCompartidosService = pagosCompartidosService;
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

    async #avisarContraparte(gastoId, userId, event, data = {}) {
        try {
            await bestEffort(async () => {
                const [sibling] = await this.gastosRepository.getSharedSibling(gastoId);
                if (!sibling?.counterparty_user_id) return;
                if (String(sibling.counterparty_user_id) === String(userId)) return;
                await triggerCompartidos(sibling.counterparty_user_id, event, {
                    gastoId: sibling.sibling_id,
                    actorId: userId,
                    actorName: await this.#nombreDe(userId),
                    ...data,
                });
            });
        } catch (err) {
            logRed(`[notificaciones] no se pudo avisar ${event}: ${err.message}`);
        }
    }

    async requireSettlementSession(userId) {
        if (!this.settlementRepository) return null;
        if (!userId) throw customError(ErrorCode.SETTLEMENT_REQUIRED);
        const session = await this.settlementRepository.getOpenSession(userId);
        if (!session) throw customError(ErrorCode.SETTLEMENT_REQUIRED);
        return session;
    }

    async #nombreDe(userId) {
        const [row] = (await this.gastosRepository.getUserName(userId)) ?? [];
        return row?.name ?? null;
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

    #cuotasCubiertas({ fixed_expense, payed_quotas, pending_quotas, number_of_quotas }) {
        return (
            !fixed_expense &&
            (Number(payed_quotas) || 0) + (Number(pending_quotas) || 0) >= Number(number_of_quotas ?? 1)
        );
    }

    #sinAceptar({ status }) {
        return ESTADOS_SIN_ACEPTAR.has(status);
    }

    #assertCuotasLibres(gasto) {
        if (this.#sinAceptar(gasto)) throw customError(ErrorCode.GASTO_NO_ACTIVO);
        this.#assertQuotasRestantes(gasto);
        if (this.#cuotasCubiertas(gasto)) {
            throw customError(ErrorCode.GASTO_CUOTAS_CUBIERTAS);
        }
    }

    async errorDeMarcado(ids, userId) {
        const valid = [...new Set(ids.map(String))].filter((id) => /^\d+$/.test(id));
        if (!valid.length) return new Map();
        const rows = await this.gastosRepository.getByIdsWithOwner(valid, userId);
        const errores = new Map();
        for (const gasto of rows) {
            if (this.#sinAceptar(gasto)) errores.set(Number(gasto.id), ErrorCode.GASTO_NO_ACTIVO);
            else if (this.#isFullyPaid(gasto)) errores.set(Number(gasto.id), ErrorCode.GASTO_YA_SALDADO);
            else if (this.#cuotasCubiertas(gasto)) errores.set(Number(gasto.id), ErrorCode.GASTO_CUOTAS_CUBIERTAS);
        }
        return errores;
    }

    async getById(id, userId) {
        const [, detalle] = await Promise.all([
            this.#getOwned(id, userId, { allowReceiver: true }),
            this.#detalle(id, userId),
        ]);
        return detalle;
    }

    async #detalle(id, userId, known = {}) {
        const [rows, movements, categories, siblings, session, sharedState] = await Promise.all([
            this.gastosRepository.getById(id),
            this.movementsRepository.getMovementsByGasto(id),
            this.categoriasRepository.getCategoriasByGasto(id),
            known.siblings ?? this.gastosRepository.getSharedSibling(id),
            known.session !== undefined || known.marked !== undefined
                ? known.session
                : this.getOpenSettlementSession(userId),
            this.gastosRepository.getSharedState(id),
        ]);
        const gasto = rows[0];
        if (!gasto) return null;

        const sibling = siblings?.[0];
        const [pendingEdit] =
            sibling && this.edicionesRepository ? await this.edicionesRepository.getPendingByPurchase(id) : [];

        let editLocks = null;
        let sharedEditLocks = null;
        if (gasto.financial_entity_id) {
            const marked =
                known.marked ?? (session ? await this.settlementRepository.hasItem(session.id, id) : false);
            editLocks = this.#computeEditLocks(gasto, { hasSibling: Boolean(siblings?.length), marked });
            if (sibling && gasto.status === ExpenseStatus.ACTIVE && !pendingEdit) {
                sharedEditLocks = this.#computeEditLocks(gasto, { marked, ignoreShared: true });
            }
        }

        gasto.movements = movements;
        gasto.categories = categories;
        gasto.edit_locks = editLocks;
        gasto.shared_edit_locks = sharedEditLocks;
        gasto.pending_edit_request = pendingEdit
            ? {
                  id: pendingEdit.id,
                  requested_by_user_id: pendingEdit.requested_by_user_id,
                  changes:
                      typeof pendingEdit.changes === "string"
                          ? JSON.parse(pendingEdit.changes)
                          : pendingEdit.changes,
                  created_at: pendingEdit.created_at,
              }
            : null;
        gasto.shared_counterparty = sibling
            ? { user_id: sibling.counterparty_user_id, name: sibling.counterparty_name ?? null }
            : null;
        Object.assign(gasto, await this.#datosParaCompartir(gasto, userId, sharedState?.[0]));
        return gasto;
    }

    async #datosParaCompartir(gasto, userId, estado) {
        const was_shared = Boolean(estado?.was_shared);
        const datos = {
            was_shared,
            shared_partner_name: estado?.sibling_id ? (estado.counterparty_name ?? null) : null,
            can_share: false,
            share_target_name: null,
        };
        if (was_shared || gasto.status !== ExpenseStatus.ACTIVE || !gasto.financial_entity_id) return datos;

        const [entidad] = await this.entidadesFinancierasRepository.getById(gasto.financial_entity_id, userId);
        if (!entidad?.linked_user_id) return datos;
        return {
            ...datos,
            can_share: true,
            share_target_name: entidad.linked_user_name ?? entidad.linked_user_email ?? null,
        };
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
            if (!fixed_expense && number_of_quotas > MAX_INSTALLMENTS) {
                throw invalid("number_of_quotas", MAX_INSTALLMENTS_MESSAGE);
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
        await Promise.all([
            this.gastosRepository.setPostponed(gasto.id, false),
            this.movementsRepository.createGastoLog(gasto.id, MovementType.UNPOSTPONED),
            this.#logEntidad(
                gasto.financial_entity_id,
                MovementType.UNPOSTPONED,
                `Postergación quitada al registrar el pago: "${gasto.name}"`,
            ),
        ]);
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

    #computeEditLocks(gasto, context) {
        return computeEditLocks(gasto, context);
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
            let mirrorNameLock = null;
            if (mirror) {
                const mirrorLocks = await this.#editLocks(mirror, userId);
                mirrorNameLock = mirrorLocks.name ?? null;
                for (const [field, reason] of Object.entries(mirrorLocks)) {
                    if (field === "financial_entity_id") continue;
                    if (!locks[field]) locks[field] = `Movimiento vinculado: ${reason}`;
                }
            }

            const paid = Number(current.payed_quotas) || 0;
            const pending = Number(current.pending_quotas) || 0;
            const ambosFijos = base.fixed_expense && next.fixed_expense;
            const changed = {
                name: next.name !== base.name.trim(),
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

            if (mirrorNameLock && mirror.name !== next.name) {
                throw customError(ErrorCode.GASTO_CAMPO_NO_EDITABLE, {
                    message: `Movimiento vinculado: ${mirrorNameLock}`,
                    details: { field: "name" },
                });
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

            return await this.#detalle(id, userId, { marked: lockContext.marked });
        });
    }

    async delete(id, userId, delete_linked = false) {
        return this.tx(async () => {
            const current = await this.#getOwned(id, userId);
            const linkedId = current[0].linked_purchase_id;

            if (this.pagosCompartidosService) {
                await this.pagosCompartidosService.cerrarCompartido(id, userId);
                if (linkedId && delete_linked) {
                    await this.pagosCompartidosService.cerrarCompartido(linkedId, userId);
                }
            }

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
                    await this.movementsRepository.createGastoLog(linkedId, MovementType.DELETE);
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

            const [estado] = await this.gastosRepository.getSharedState(id);
            if (estado?.was_shared) throw customError(ErrorCode.GASTO_COMPARTIDO_NO_RESTAURABLE);

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

    async compartir(id, userId) {
        return this.tx(async () => {
            await this.#getOwnedWithOwner(id, userId);
            await this.gastosRepository.lockPurchases([id]);

            const [[gasto], [estado], session] = await Promise.all([
                this.gastosRepository.getById(id),
                this.gastosRepository.getSharedState(id),
                this.getOpenSettlementSession(userId),
            ]);
            if (!gasto) throw customError(ErrorCode.GASTO_NOT_FOUND);

            const [entidad] = await this.entidadesFinancierasRepository.getById(gasto.financial_entity_id, userId);
            if (!entidad?.linked_user_id || estado?.was_shared || gasto.status !== ExpenseStatus.ACTIVE) {
                throw customError(ErrorCode.GASTO_NO_COMPARTIBLE);
            }

            const [copia] = await this.gastosRepository.create({
                financial_entity_id: null,
                name: gasto.name,
                amount: gasto.amount,
                number_of_quotas: gasto.number_of_quotas,
                currency_type: gasto.currency_type,
                fixed_expense: gasto.fixed_expense,
                image_url: gasto.image_url,
                type: gasto.type,
                status: ExpenseStatus.PENDING_APPROVAL,
                shared_from_id: gasto.id,
                receiver_user_id: entidad.linked_user_id,
            });
            await this.movementsRepository.createGastoLog(copia.id, MovementType.CREATION);
            await this.#copiarPagos(gasto.id, copia.id);

            const receptor = entidad.linked_user_name ?? entidad.linked_user_email ?? "otro usuario";
            await Promise.all([
                this.gastosRepository.updateStatus(gasto.id, ExpenseStatus.PENDING_APPROVAL),
                this.movementsRepository.createGastoLog(
                    gasto.id, MovementType.EDITED, null, null, userId, `Compartido con ${receptor}`,
                ),
                session ? this.settlementRepository.removeItem(session.id, gasto.id) : null,
            ]);
            await this.#logEntidad(
                gasto.financial_entity_id,
                MovementType.EDITED,
                `Gasto compartido con ${receptor}: "${gasto.name}"`,
            );
            await triggerCompartidos(entidad.linked_user_id, PusherEvent.COMPARTIDO_NUEVO, { gastoId: gasto.id });

            return await this.#detalle(gasto.id, userId);
        });
    }

    async #copiarPagos(gastoId, copiaId) {
        const movimientos = await this.movementsRepository.getMovementsByGasto(gastoId);
        const pagos = movimientos.filter((m) => m.movement_type === MovementType.PAYMENT).reverse();
        const copias = await this.movementsRepository.createGastoLogs(
            pagos.map((pago) => ({
                gastoId: copiaId,
                movementType: MovementType.PAYMENT,
                amount: pago.amount,
                paymentDate: pago.payment_date,
                createdByUserId: pago.created_by_user_id,
                detail: "Pago registrado antes de compartir el gasto",
                pairedMovementId: pago.id,
            })),
        );
        await this.movementsRepository.setPairedMovements(copias.map((c) => [c.paired_movement_id, c.id]));
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
        paidAsPendingBy = null,
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

        const paidAsPending = paidAsPendingBy != null;
        const logs = [
            { gastoId, movementType: MovementType.CREATION },
            ...Array.from({ length: Number(payed_quotas) || 0 }, () => ({
                gastoId,
                movementType: paidAsPending ? MovementType.PENDING_PAYMENT : MovementType.PAYMENT,
                amount: amountPerQuota,
                paymentDate,
                createdByUserId: paidAsPendingBy,
            })),
        ];

        const [, categories] = await Promise.all([
            this.movementsRepository.createGastoLogs(logs),
            this.categoriasRepository.addCategoriasToNewGasto(gastoId, category_ids),
        ]);

        const registered = Number(payed_quotas) || 0;
        const paid = paidAsPending ? 0 : registered;
        const lastPayment = paid > 0 ? paymentDate : null;
        Object.assign(rows[0], {
            categories,
            payed_quotas: paid,
            pending_quotas: paidAsPending ? registered : 0,
            first_quota_date: lastPayment,
            last_payment_date: lastPayment,
            finalization_date: !fixed_expense && paid >= Number(number_of_quotas) ? lastPayment : null,
        });

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
        if (!fixed_expense && Number(number_of_quotas) > MAX_INSTALLMENTS) {
            throw customError(ErrorCode.VALIDATION_ERROR, {
                message: MAX_INSTALLMENTS_MESSAGE,
                details: { field: "number_of_quotas" },
            });
        }

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
                paidAsPendingBy: entidad[0].linked_user_id ? userId : null,
            });

            const gastoId = rows[0].id;

            entidadLogs.push([
                financial_entity_id,
                MovementType.PURCHASE_CREATED,
                `Gasto creado: "${name}"`,
            ]);

            if (entidad[0].linked_user_id) {
                await triggerCompartidos(entidad[0].linked_user_id, PusherEvent.COMPARTIDO_NUEVO, { gastoId });
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
                Object.assign(rows[0], {
                    linked_purchase_id: mirror[0].id,
                    linked_financial_entity_id: payment_entity_id,
                    linked_name: name,
                    linked_type: oppositeType,
                    mirror: {
                        ...mirror[0],
                        linked_purchase_id: gastoId,
                        linked_financial_entity_id: financial_entity_id,
                        linked_name: name,
                        linked_type: type,
                    },
                });

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
            await this.#avisarContraparte(
                id,
                userId,
                value ? PusherEvent.GASTO_POSTERGADO : PusherEvent.GASTO_POSTERGACION_QUITADA,
                { gastoName: current.name },
            );
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
        if (!/^\d+$/.test(String(purchase_id))) throw customError(ErrorCode.GASTO_NOT_FOUND);

        return this.tx(async () => {
            const siblings = await this.gastosRepository.getSharedSibling(purchase_id, { includePendingApproval: true });
            await this.gastosRepository.lockPurchases([purchase_id, siblings[0]?.sibling_id]);

            const [rows, session] = await Promise.all([
                this.#getOwnedWithOwner(purchase_id, userId),
                direct ? null : this.getOpenSettlementSession(userId),
            ]);
            this.#assertCuotasLibres(rows[0]);

            if (session) {
                if (rows[0].is_postponed) {
                    throw customError(ErrorCode.GASTO_POSTERGADO);
                }
                await this.settlementRepository.upsertItem(session.id, purchase_id);
                return await this.#detalle(purchase_id, userId, { siblings, marked: true });
            }

            await this.#levantarPostergacionParaPagar(rows[0]);

            await this.#registrarPagoOPendiente(rows[0], userId, new Date(), siblings);
            const [, detalle] = await Promise.all([
                this.gastosRepository.clearFavoriteIfFinalized(purchase_id),
                this.#detalle(purchase_id, userId, { siblings, session: direct ? undefined : null }),
            ]);
            return detalle;
        });
    }

    async effectSettlementBatch(purchaseIds, userId, paymentDate = new Date()) {
        return this.tx(async () => {
            if (userId == null) throw customError(ErrorCode.NO_AUTORIZADO);
            const ids = [...new Set(purchaseIds.map(String))].filter((id) => /^\d+$/.test(id));
            if (!ids.length) return { kept: [], discarded: purchaseIds.map(Number), payments: {} };

            const siblings = await this.gastosRepository.getSharedSiblings(ids, { includePendingApproval: true });
            const siblingById = new Map(
                siblings
                    .filter((s) => s.counterparty_user_id && String(s.counterparty_user_id) !== String(userId))
                    .map((s) => [String(s.purchase_id), s]),
            );
            const siblingIds = [...siblingById.values()].map((s) => s.sibling_id);
            await this.gastosRepository.lockPurchases([...ids, ...siblingIds]);

            const [rows, pendientesDelOtro] = await Promise.all([
                this.gastosRepository.getByIdsWithOwner(ids, userId),
                this.movementsRepository.getPendingPaymentsByPurchases(siblingIds),
            ]);
            const byId = new Map(rows.map((r) => [String(r.id), r]));
            const pendientesPorCopia = new Map();
            for (const pend of pendientesDelOtro) {
                if (String(pend.created_by_user_id) === String(userId)) continue;
                const key = String(pend.purchase_id);
                if (!pendientesPorCopia.has(key)) pendientesPorCopia.set(key, []);
                pendientesPorCopia.get(key).push(pend);
            }

            const kept = [];
            const discarded = [];
            const logs = [];
            const confirmaciones = [];
            const notifications = [];
            const payments = {};

            for (const id of ids) {
                const gasto = byId.get(id);
                const fullyPaid = gasto && this.#isFullyPaid(gasto);

                if (!gasto || !gasto.owned || gasto.is_postponed || fullyPaid || this.#sinAceptar(gasto)) {
                    discarded.push(Number(id));
                    continue;
                }

                const sibling = siblingById.get(id);

                if (!sibling) {
                    kept.push(Number(id));
                    logs.push({
                        gastoId: gasto.id,
                        movementType: MovementType.PAYMENT,
                        amount: gasto.amount_per_quota,
                        paymentDate,
                    });
                    continue;
                }

                const pendDelOtro = pendientesPorCopia.get(String(sibling.sibling_id))?.shift();
                if (pendDelOtro && this.pagosCompartidosService) {
                    kept.push(Number(id));
                    confirmaciones.push({ pend: pendDelOtro, gasto, sibling });
                    continue;
                }

                if (this.#cuotasCubiertas(gasto)) {
                    discarded.push(Number(id));
                    continue;
                }

                kept.push(Number(id));
                logs.push({
                    gastoId: gasto.id,
                    movementType: MovementType.PENDING_PAYMENT,
                    amount: gasto.amount_per_quota,
                    paymentDate,
                    createdByUserId: userId,
                });
                if (!this.#esperaAprobacion(sibling)) {
                    notifications.push([sibling.counterparty_user_id, gasto.id, sibling.sibling_id]);
                }
            }

            const [insertedRows, actorName] = await Promise.all([
                this.movementsRepository.createGastoLogs(logs),
                notifications.length ? this.#nombreDe(userId) : null,
            ]);
            const inserted = insertedRows ?? [];
            for (const row of inserted) {
                const sibling = siblingById.get(String(row.purchase_id));
                payments[row.purchase_id] = {
                    movement_id: row.id,
                    shared: Boolean(sibling),
                    role: "pago",
                    counterparty_name: sibling?.counterparty_name ?? null,
                };
            }

            await this.pagosCompartidosService?.confirmarDesdeCopias(
                confirmaciones.map(({ pend, gasto }) => ({ pend, copiaId: gasto.id })),
                userId,
            );
            for (const { pend, gasto, sibling } of confirmaciones) {
                payments[gasto.id] = {
                    movement_id: pend.id,
                    shared: true,
                    role: "confirmacion",
                    counterparty_name: sibling.counterparty_name ?? null,
                };
            }

            await Promise.all([
                this.gastosRepository.clearFavoritesIfFinalized(kept),
                ...notifications.map(([counterparty, purchaseId, copyId]) =>
                    triggerCompartidos(counterparty, PusherEvent.PAGO_PENDIENTE, { purchaseId, copyId, actorName }),
                ),
            ]);

            for (const id of purchaseIds) {
                if (!/^\d+$/.test(String(id))) discarded.push(id);
            }
            return { kept, discarded, payments };
        });
    }

    #esperaAprobacion(sibling) {
        return sibling?.sibling_status === ExpenseStatus.PENDING_APPROVAL;
    }

    async #registrarPagoOPendiente(gasto, userId, paymentDate, knownSiblings) {
        const [sibling] =
            knownSiblings ??
            (await this.gastosRepository.getSharedSibling(gasto.id, { includePendingApproval: true }));

        const esCompartido =
            sibling &&
            sibling.counterparty_user_id &&
            String(sibling.counterparty_user_id) !== String(userId);

        if (esCompartido) {
            if (this.pagosCompartidosService) {
                const pendientes = await this.movementsRepository.getPendingPaymentsByPurchases([sibling.sibling_id]);
                const pendDelOtro = pendientes.find((p) => String(p.created_by_user_id) !== String(userId));
                if (pendDelOtro) {
                    await this.pagosCompartidosService.confirmarDesdeCopia(pendDelOtro, gasto.id, userId);
                    return { pending: false, confirmed: true };
                }
            }

            if (this.#cuotasCubiertas(gasto)) return { pending: true, skipped: true };

            const [, actorName] = await Promise.all([
                this.movementsRepository.createGastoLog(
                    gasto.id, MovementType.PENDING_PAYMENT, gasto.amount_per_quota, paymentDate, userId,
                ),
                this.#nombreDe(userId),
            ]);
            if (!this.#esperaAprobacion(sibling)) {
                await triggerCompartidos(sibling.counterparty_user_id, PusherEvent.PAGO_PENDIENTE, {
                    purchaseId: gasto.id,
                    copyId: sibling.sibling_id,
                    actorName,
                });
            }
            return { pending: true };
        }

        await this.movementsRepository.createGastoLog(
            gasto.id, MovementType.PAYMENT, gasto.amount_per_quota, paymentDate,
        );
        return { pending: false };
    }

    #ultimoPago(movements) {
        return movements
            .filter((m) => m.movement_type === MovementType.PAYMENT)
            .sort((a, b) => {
                const byDate = new Date(b.payment_date ?? 0) - new Date(a.payment_date ?? 0);
                if (byDate !== 0) return byDate;
                return new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0);
            })[0];
    }

    async #revertirMovimiento(gasto, movement, userId) {
        if (movement.movement_type === MovementType.PENDING_PAYMENT) {
            if (String(movement.created_by_user_id) !== String(userId)) {
                throw customError(ErrorCode.PAGO_REGISTRADO_POR_OTRO);
            }
            await this.pagosCompartidosService.retirar(movement.id, userId);
            return "retirado";
        }

        const [sibling] = await this.gastosRepository.getSharedSibling(gasto.id);
        if (sibling && this.pagosCompartidosService) {
            await this.pagosCompartidosService.solicitarReversion(movement.id, userId);
            return "solicitada";
        }

        const [reverted] = await this.movementsRepository.revertPaymentsByIds([movement.id]);
        if (!reverted) throw customError(ErrorCode.PAGO_NOT_FOUND);
        await this.movementsRepository.createGastoLog(gasto.id, MovementType.REFUND, reverted.amount ?? null, new Date());
        return "revertido";
    }

    async revertirPago(purchase_id, movementId, userId) {
        const resultado = await this.tx(async () => {
            const [gasto] = await this.#getOwnedWithOwner(purchase_id, userId);
            const [movement] = await this.movementsRepository.getPaymentById(movementId);
            if (!movement || String(movement.purchase_id) !== String(gasto.id)) {
                throw customError(ErrorCode.PAGO_NOT_FOUND);
            }
            return await this.#revertirMovimiento(gasto, movement, userId);
        });

        return { resultado, gasto: await this.getById(purchase_id, userId) };
    }

    async refundCuota(purchase_id, userId) {
        return this.tx(async () => {
            const rows = await this.#getOwned(purchase_id, userId);
            if (rows[0].payed_quotas === 0) throw customError(ErrorCode.SIN_CUOTAS_PARA_REVERTIR);

            const movements = await this.movementsRepository.getMovementsByGasto(purchase_id);
            const ultimo = this.#ultimoPago(movements);
            if (!ultimo) throw customError(ErrorCode.SIN_CUOTAS_PARA_REVERTIR);

            await this.#revertirMovimiento(rows[0], ultimo, userId);
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

            if (this.#sinAceptar(gasto)) {
                failed.push({ id, reason: "El gasto no está activo" });
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

            if (this.#cuotasCubiertas(gasto)) {
                failed.push({ id, reason: "Las cuotas que quedan ya tienen pagos esperando confirmación" });
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
