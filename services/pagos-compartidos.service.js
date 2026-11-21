import { ExpenseStatus, MovementType, PusherEvent } from "../utils/enums.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { withTransaction } from "../db.js";

export class PagosCompartidosService {
    constructor({
        gastosRepository,
        movementsRepository,
        settlementRepository,
        edicionesRepository,
        runInTransaction = withTransaction,
    }) {
        this.edicionesRepository = edicionesRepository;
        this.gastosRepository = gastosRepository;
        this.movementsRepository = movementsRepository;
        this.settlementRepository = settlementRepository;
        this.tx = runInTransaction;
    }

    async #actorName(userId) {
        const [actor] = await this.gastosRepository.getUserName(userId);
        return actor?.name ?? null;
    }

    async #notificar(userId, event, purchaseId, actorUserId, known = {}) {
        if (userId == null) return;
        await triggerCompartidos(userId, event, {
            purchaseId,
            actorName: known.actorName !== undefined ? known.actorName : await this.#actorName(actorUserId),
        });
    }

    async #getOpenSession(userId) {
        if (!this.settlementRepository) return null;
        return await this.settlementRepository.getOpenSession(userId);
    }

    async #inicioRespuesta(movementId, userId) {
        const [pend, actorName, session] = await Promise.all([
            this.#getPendiente(movementId),
            this.#actorName(userId),
            this.#getOpenSession(userId),
        ]);
        return { pend, actorName, session };
    }

    async #assertContraparteDelPendiente(pend, userId) {
        if (String(pend.created_by_user_id) === String(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
        const [sibling] = await this.gastosRepository.getSharedSibling(pend.purchase_id);
        if (!sibling || String(sibling.counterparty_user_id) !== String(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
        return sibling;
    }

    async #getPendiente(movementId) {
        const [pend] = await this.movementsRepository.getPendingPaymentById(movementId);
        if (!pend) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);
        return pend;
    }

    async #registrarPagoEnCopia(copia, pend) {
        if (!copia) return null;

        const yaSaldada =
            !copia.fixed_expense && (Number(copia.payed_quotas) || 0) >= Number(copia.number_of_quotas);
        if (yaSaldada) return null;

        const [mirror] = await this.movementsRepository.createGastoLog(
            copia.id,
            MovementType.PAYMENT,
            copia.amount_per_quota,
            pend.payment_date,
            pend.created_by_user_id,
            "Pago confirmado de gasto compartido",
        );
        return mirror ?? null;
    }

    async #confirmarPendiente(pend, copiaId, alCerrar = []) {
        const [[confirmed], [copia]] = await Promise.all([
            this.movementsRepository.confirmPendingPayment(pend.id),
            this.gastosRepository.getById(copiaId),
        ]);
        if (!confirmed) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);

        const mirror = await this.#registrarPagoEnCopia(copia, pend);

        await Promise.all([
            mirror && this.movementsRepository.setPairedMovement(pend.id, mirror.id),
            mirror && this.movementsRepository.setPairedMovement(mirror.id, pend.id),
            this.gastosRepository.clearFavoriteIfFinalized(pend.purchase_id),
            this.gastosRepository.clearFavoriteIfFinalized(copiaId),
            ...alCerrar.map((run) => run()),
        ]);
        return { confirmed, mirror };
    }

    #desmarcarDeSesion(session, purchaseId) {
        if (!session) return null;
        return this.settlementRepository.removeItem(session.id, purchaseId);
    }

    async confirmar(movementId, userId) {
        return this.tx(async () => {
            const { pend, actorName, session } = await this.#inicioRespuesta(movementId, userId);
            const sibling = await this.#assertContraparteDelPendiente(pend, userId);
            await this.gastosRepository.lockPurchases([pend.purchase_id, sibling.sibling_id]);

            const { confirmed } = await this.#confirmarPendiente(pend, sibling.sibling_id, [
                () => this.#desmarcarDeSesion(session, sibling.sibling_id),
            ]);
            await this.#notificar(pend.created_by_user_id, PusherEvent.PAGO_CONFIRMADO, pend.purchase_id, userId, {
                actorName,
            });
            return confirmed;
        });
    }

    async confirmarDesdeCopia(pend, copiaId, userId) {
        const result = await this.#confirmarPendiente(pend, copiaId);
        await this.#notificar(pend.created_by_user_id, PusherEvent.PAGO_CONFIRMADO, pend.purchase_id, userId);
        return result;
    }

    async rechazar(movementId, userId) {
        return this.tx(async () => {
            const { pend, actorName, session } = await this.#inicioRespuesta(movementId, userId);
            const sibling = await this.#assertContraparteDelPendiente(pend, userId);
            await this.gastosRepository.lockPurchases([pend.purchase_id, sibling.sibling_id]);

            const [[rejected]] = await Promise.all([
                this.movementsRepository.closePendingPayment(pend.id, MovementType.PAYMENT_REJECTED),
                this.#desmarcarDeSesion(session, sibling.sibling_id),
            ]);
            if (!rejected) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);

            await this.#notificar(pend.created_by_user_id, PusherEvent.PAGO_RECHAZADO, pend.purchase_id, userId, {
                actorName,
            });
            return rejected;
        });
    }

    async retirar(movementId, userId) {
        return this.tx(async () => {
            const pend = await this.#getPendiente(movementId);
            if (String(pend.created_by_user_id) !== String(userId)) {
                throw customError(ErrorCode.NO_AUTORIZADO);
            }
            const [sibling] = await this.gastosRepository.getSharedSibling(pend.purchase_id);
            await this.gastosRepository.lockPurchases([pend.purchase_id, sibling?.sibling_id]);

            const [withdrawn] = await this.movementsRepository.closePendingPayment(
                pend.id,
                MovementType.PAYMENT_WITHDRAWN,
            );
            if (!withdrawn) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);

            await this.#notificar(sibling?.counterparty_user_id, PusherEvent.PAGO_RETIRADO, pend.purchase_id, userId);
            return withdrawn;
        });
    }

    async cerrarCompartido(gastoId, userId) {
        const [inicial] = await this.gastosRepository.getSharedState(gastoId);
        if (!inicial?.sibling_id) return null;

        await this.gastosRepository.lockPurchases([gastoId, inicial.sibling_id]);
        const [estado] = await this.gastosRepository.getSharedState(gastoId);
        if (!estado?.sibling_id) return null;

        const confirmedPayments =
            estado.sibling_status === ExpenseStatus.ACTIVE
                ? await this.#resolverPagosAlCerrar(gastoId, estado.sibling_id, userId)
                : await this.#darDeBajaCopiaSinAceptar(estado.sibling_id);
        await this.#cancelarEdicionAlCerrar(gastoId, estado.sibling_id, userId);

        if (estado.counterparty_user_id != null) {
            await triggerCompartidos(estado.counterparty_user_id, PusherEvent.COMPARTIDO_DESVINCULADO, {
                gastoId: estado.sibling_id,
                gastoName: estado.gasto_name,
                actorId: userId,
                actorName: await this.#actorName(userId),
                confirmedPayments,
            });
        }
        return { siblingId: estado.sibling_id, confirmedPayments };
    }

    async #resolverPagosAlCerrar(gastoId, siblingId, userId) {
        const [delOtro, propios, reversiones] = await Promise.all([
            this.movementsRepository.getPendingPaymentsByPurchases([siblingId]),
            this.movementsRepository.getPendingPaymentsByPurchases([gastoId]),
            this.movementsRepository.getPendingReversalIds([gastoId, siblingId]),
        ]);

        for (const pend of propios) {
            await this.movementsRepository.closePendingPayment(pend.id, MovementType.PAYMENT_WITHDRAWN);
        }
        for (const pend of delOtro) {
            await this.#confirmarPendiente(pend, gastoId);
        }

        const reversionIds = reversiones.map((r) => r.id);
        if (reversionIds.length) {
            await Promise.all([
                this.movementsRepository.clearReversalRequest(reversionIds),
                this.movementsRepository.logPaymentEvent(reversionIds, MovementType.REVERSAL_CANCELLED, userId),
            ]);
        }
        return delOtro.length;
    }

    async #darDeBajaCopiaSinAceptar(copiaId) {
        await Promise.all([
            this.gastosRepository.delete(copiaId),
            this.movementsRepository.createGastoLog(copiaId, MovementType.DELETE),
        ]);
        return 0;
    }

    async #cancelarEdicionAlCerrar(gastoId, siblingId, userId) {
        if (!this.edicionesRepository) return;
        const [edicion] = await this.edicionesRepository.getPendingByPurchase(gastoId);
        if (!edicion) return;
        await Promise.all([
            this.edicionesRepository.resolve(edicion.id, "CANCELLED", userId),
            this.movementsRepository.createGastoLog(gastoId, MovementType.EDIT_CANCELLED, null, null, userId),
            this.movementsRepository.createGastoLog(siblingId, MovementType.EDIT_CANCELLED, null, null, userId),
        ]);
    }

    async #getPagoConPartes(movementId, userId) {
        const [pago] = await this.movementsRepository.getPaymentById(movementId);
        if (!pago || pago.movement_type !== MovementType.PAYMENT) {
            throw customError(ErrorCode.PAGO_NOT_FOUND);
        }

        const [[row], [sibling], [owner]] = await Promise.all([
            this.gastosRepository.getByIdsWithOwner([String(pago.purchase_id)], userId),
            this.gastosRepository.getSharedSibling(pago.purchase_id),
            this.gastosRepository.getEntityOwnerByPurchaseId(pago.purchase_id),
        ]);
        if (!row || !sibling) throw customError(ErrorCode.PAGO_NOT_FOUND);

        const isOwner = Boolean(row.owned);
        const isCounterparty = String(sibling.counterparty_user_id) === String(userId);
        if (!isOwner && !isCounterparty) throw customError(ErrorCode.NO_AUTORIZADO);

        const otherUserId = isOwner ? sibling.counterparty_user_id : owner?.user_id;
        return { pago, sibling, otherUserId };
    }

    #idsDelPar(pago) {
        return [pago.id, pago.paired_movement_id].filter((id) => id != null);
    }

    async solicitarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago, sibling, otherUserId } = await this.#getPagoConPartes(movementId, userId);
            await this.gastosRepository.lockPurchases([pago.purchase_id, sibling.sibling_id]);

            const [actual] = await this.movementsRepository.getPaymentById(pago.id);
            if (actual?.reversal_requested_by_user_id != null) {
                throw customError(ErrorCode.REVERSION_YA_SOLICITADA);
            }

            const ids = this.#idsDelPar(pago);
            const [rows] = await Promise.all([
                this.movementsRepository.setReversalRequest(ids, userId),
                this.movementsRepository.logPaymentEvent(ids, MovementType.REVERSAL_REQUESTED, userId),
            ]);
            await this.#notificar(otherUserId, PusherEvent.PAGO_REVERSION_SOLICITADA, pago.purchase_id, userId);
            return rows.find((r) => String(r.id) === String(pago.id)) ?? rows[0];
        });
    }

    async cancelarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago, otherUserId } = await this.#getPagoConPartes(movementId, userId);
            if (pago.reversal_requested_by_user_id == null) throw customError(ErrorCode.REVERSION_NOT_FOUND);
            if (String(pago.reversal_requested_by_user_id) !== String(userId)) {
                throw customError(ErrorCode.NO_AUTORIZADO);
            }

            const ids = this.#idsDelPar(pago);
            const [rows] = await Promise.all([
                this.movementsRepository.clearReversalRequest(ids),
                this.movementsRepository.logPaymentEvent(ids, MovementType.REVERSAL_CANCELLED, userId),
            ]);
            await this.#notificar(otherUserId, PusherEvent.PAGO_REVERSION_CANCELADA, pago.purchase_id, userId);
            return rows[0];
        });
    }

    async aceptarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago, sibling } = await this.#getPagoConPartes(movementId, userId);
            this.#assertPuedeResponder(pago, userId);
            await this.gastosRepository.lockPurchases([pago.purchase_id, sibling.sibling_id]);

            const reverted = await this.movementsRepository.revertPaymentsByIds(this.#idsDelPar(pago));
            if (!reverted.length) throw customError(ErrorCode.PAGO_NOT_FOUND);

            const fecha = new Date();
            for (const row of reverted) {
                await this.movementsRepository.createGastoLog(
                    row.purchase_id,
                    MovementType.REFUND,
                    row.amount,
                    fecha,
                    null,
                    "Reversión de pago compartido aceptada",
                );
            }

            await this.#notificar(
                pago.reversal_requested_by_user_id,
                PusherEvent.PAGO_REVERSION_ACEPTADA,
                pago.purchase_id,
                userId,
            );
            return reverted;
        });
    }

    async rechazarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago } = await this.#getPagoConPartes(movementId, userId);
            this.#assertPuedeResponder(pago, userId);

            const ids = this.#idsDelPar(pago);
            const [rows] = await Promise.all([
                this.movementsRepository.clearReversalRequest(ids),
                this.movementsRepository.logPaymentEvent(ids, MovementType.REVERSAL_REJECTED, userId),
            ]);
            await this.#notificar(
                pago.reversal_requested_by_user_id,
                PusherEvent.PAGO_REVERSION_RECHAZADA,
                pago.purchase_id,
                userId,
            );
            return rows[0];
        });
    }

    #assertPuedeResponder(pago, userId) {
        if (pago.reversal_requested_by_user_id == null) throw customError(ErrorCode.REVERSION_NOT_FOUND);
        if (String(pago.reversal_requested_by_user_id) === String(userId)) {
            throw customError(ErrorCode.NO_AUTORIZADO);
        }
    }
}
