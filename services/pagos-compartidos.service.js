import { MovementType, PusherEvent } from "../utils/enums.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { withTransaction } from "../db.js";

export class PagosCompartidosService {
    constructor({ gastosRepository, movementsRepository, settlementRepository, runInTransaction = withTransaction }) {
        this.gastosRepository = gastosRepository;
        this.movementsRepository = movementsRepository;
        this.settlementRepository = settlementRepository;
        this.tx = runInTransaction;
    }

    async #actorName(userId) {
        const [actor] = await this.gastosRepository.getUserName(userId);
        return actor?.name ?? null;
    }

    async #notificar(userId, event, purchaseId, actorUserId) {
        if (userId == null) return;
        await triggerCompartidos(userId, event, {
            purchaseId,
            actorName: await this.#actorName(actorUserId),
        });
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

    async #registrarPagoEnCopia(copiaId, pend) {
        const [copia] = await this.gastosRepository.getById(copiaId);
        if (!copia) return null;

        const yaSaldada =
            !copia.fixed_expense && (Number(copia.payed_quotas) || 0) >= Number(copia.number_of_quotas);
        if (yaSaldada) return null;

        const [mirror] = await this.movementsRepository.createGastoLog(
            copiaId,
            MovementType.PAYMENT,
            copia.amount_per_quota,
            pend.payment_date,
            pend.created_by_user_id,
            "Pago confirmado de gasto compartido",
        );
        return mirror ?? null;
    }

    async #confirmarPendiente(pend, copiaId) {
        const [confirmed] = await this.movementsRepository.confirmPendingPayment(pend.id);
        if (!confirmed) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);

        const mirror = await this.#registrarPagoEnCopia(copiaId, pend);
        if (mirror) {
            await Promise.all([
                this.movementsRepository.setPairedMovement(pend.id, mirror.id),
                this.movementsRepository.setPairedMovement(mirror.id, pend.id),
            ]);
        }

        await Promise.all([
            this.gastosRepository.clearFavoriteIfFinalized(pend.purchase_id),
            this.gastosRepository.clearFavoriteIfFinalized(copiaId),
        ]);
        return { confirmed, mirror };
    }

    async #desmarcarDeSesion(userId, purchaseId) {
        if (!this.settlementRepository) return;
        const session = await this.settlementRepository.getOpenSession(userId);
        if (session) await this.settlementRepository.removeItem(session.id, purchaseId);
    }

    async confirmar(movementId, userId) {
        return this.tx(async () => {
            const pend = await this.#getPendiente(movementId);
            const sibling = await this.#assertContraparteDelPendiente(pend, userId);
            await this.gastosRepository.lockPurchases([pend.purchase_id, sibling.sibling_id]);

            const { confirmed } = await this.#confirmarPendiente(pend, sibling.sibling_id);
            await this.#desmarcarDeSesion(userId, sibling.sibling_id);
            await this.#notificar(pend.created_by_user_id, PusherEvent.PAGO_CONFIRMADO, pend.purchase_id, userId);
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
            const pend = await this.#getPendiente(movementId);
            const sibling = await this.#assertContraparteDelPendiente(pend, userId);
            await this.gastosRepository.lockPurchases([pend.purchase_id, sibling.sibling_id]);

            const [rejected] = await this.movementsRepository.closePendingPayment(
                pend.id,
                MovementType.PAYMENT_REJECTED,
            );
            if (!rejected) throw customError(ErrorCode.PAGO_PENDIENTE_NOT_FOUND);

            await this.#desmarcarDeSesion(userId, sibling.sibling_id);
            await this.#notificar(pend.created_by_user_id, PusherEvent.PAGO_RECHAZADO, pend.purchase_id, userId);
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

    async rechazarPendientesDeContraparte(gastoId, userId) {
        const [sibling] = await this.gastosRepository.getSharedSibling(gastoId);
        if (!sibling) return [];

        const pendientes = await this.movementsRepository.getPendingPaymentsByPurchases([sibling.sibling_id]);
        const rejected = [];
        for (const pend of pendientes) {
            const [row] = await this.movementsRepository.closePendingPayment(
                pend.id,
                MovementType.PAYMENT_REJECTED,
            );
            if (row) rejected.push(row);
        }

        if (rejected.length) {
            await this.#notificar(sibling.counterparty_user_id, PusherEvent.PAGO_RECHAZADO, sibling.sibling_id, userId);
        }
        return rejected;
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

            const rows = await this.movementsRepository.setReversalRequest(this.#idsDelPar(pago), userId);
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

            const rows = await this.movementsRepository.clearReversalRequest(this.#idsDelPar(pago));
            await this.#notificar(otherUserId, PusherEvent.PAGO_REVERSION_CANCELADA, pago.purchase_id, userId);
            return rows[0];
        });
    }

    async aceptarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago, sibling } = await this.#getPagoConPartes(movementId, userId);
            this.#assertPuedeResponder(pago, userId);
            await this.gastosRepository.lockPurchases([pago.purchase_id, sibling.sibling_id]);

            const deleted = await this.movementsRepository.deletePaymentsByIds(this.#idsDelPar(pago));
            if (!deleted.length) throw customError(ErrorCode.PAGO_NOT_FOUND);

            const fecha = new Date();
            for (const row of deleted) {
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
            return deleted;
        });
    }

    async rechazarReversion(movementId, userId) {
        return this.tx(async () => {
            const { pago } = await this.#getPagoConPartes(movementId, userId);
            this.#assertPuedeResponder(pago, userId);

            const rows = await this.movementsRepository.clearReversalRequest(this.#idsDelPar(pago));
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
