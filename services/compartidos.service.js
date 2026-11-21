import { MovementType, ExpenseStatus, PusherEvent } from "../utils/enums.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { logRed } from "../utils/logs_custom.js";
import { withTransaction, bestEffort } from "../db.js";

export class CompartidosService {
    constructor({
        gastosRepository,
        entidadesFinancierasRepository,
        movementsRepository,
        pagosCompartidosService,
        runInTransaction = withTransaction,
    }) {
        this.gastosRepository = gastosRepository;
        this.entidadesFinancierasRepository = entidadesFinancierasRepository;
        this.movementsRepository = movementsRepository;
        this.pagosCompartidosService = pagosCompartidosService;
        this.tx = runInTransaction;
    }

    async getCompartidos(userId) {
        const [recibidos, emitidos, pagosRows, reversionesRows] = await Promise.all([
            this.gastosRepository.getCompartidosRecibidos(userId),
            this.gastosRepository.getCompartidosEmitidos(userId),
            this.gastosRepository.getPagosCompartidos(userId),
            this.gastosRepository.getReversionesCompartidas(userId),
        ]);

        const pagos = { porConfirmar: [], esperando: [] };
        for (const r of pagosRows) {
            if (String(r.created_by_user_id) === String(userId)) pagos.esperando.push(r);
            else pagos.porConfirmar.push(r);
        }

        const reversiones = { porConfirmar: [], esperando: [] };
        for (const r of reversionesRows) {
            if (String(r.reversal_requested_by_user_id) === String(userId)) reversiones.esperando.push(r);
            else reversiones.porConfirmar.push(r);
        }

        return { recibidos, emitidos, pagos, reversiones };
    }

    async confirmarPago(movementId, userId) {
        return this.pagosCompartidosService.confirmar(movementId, userId);
    }

    async rechazarPago(movementId, userId) {
        return this.pagosCompartidosService.rechazar(movementId, userId);
    }

    async retirarPago(movementId, userId) {
        return this.pagosCompartidosService.retirar(movementId, userId);
    }

    async aceptarReversion(movementId, userId) {
        return this.pagosCompartidosService.aceptarReversion(movementId, userId);
    }

    async rechazarReversion(movementId, userId) {
        return this.pagosCompartidosService.rechazarReversion(movementId, userId);
    }

    async cancelarReversion(movementId, userId) {
        return this.pagosCompartidosService.cancelarReversion(movementId, userId);
    }

    async #vincularAlEmisor(entityId, userId, senderUserId) {
        const yaVinculada = await this.entidadesFinancierasRepository.findByLinkedUser(userId, senderUserId);
        if (yaVinculada.length) return;

        await this.entidadesFinancierasRepository.vincularUsuario(entityId, userId, senderUserId);
        try {
            const [emisor] = await this.gastosRepository.getUserName(senderUserId);
            await bestEffort(() =>
                this.movementsRepository.createEntidadLog(
                    entityId,
                    MovementType.LINK,
                    `Vinculada a ${emisor?.name ?? "un usuario"} al aceptar un gasto compartido`,
                ),
            );
        } catch (err) {
            logRed(`[historial entidad ${entityId}] no se pudo registrar LINK: ${err.message}`);
        }
    }

    async aprobar(gastoId, userId, financialEntityId, newEntityName) {
        return this.tx(async () => {
            const rows = await this.gastosRepository.getById(gastoId);
            if (!rows.length) throw customError(ErrorCode.GASTO_NOT_FOUND);

            const gasto = rows[0];
            if (String(gasto.receiver_user_id) !== String(userId)) throw customError(ErrorCode.NO_AUTORIZADO);
            if (gasto.status !== ExpenseStatus.PENDING_APPROVAL) throw customError(ErrorCode.GASTO_NO_PENDIENTE_APROBACION);

            let entityId = financialEntityId ?? null;
            const [sender] = await this.gastosRepository.getEntityOwnerByPurchaseId(gasto.shared_from_id);

            if (!entityId && newEntityName) {
                const [newEntity] = await this.entidadesFinancierasRepository.create(newEntityName, userId);
                await this.movementsRepository.createEntidadLog(newEntity.id, MovementType.CREATION);
                entityId = newEntity.id;

                if (sender) {
                    await this.entidadesFinancierasRepository.vincularUsuario(entityId, userId, sender.user_id);
                }
            }

            if (!entityId) throw customError(ErrorCode.ENTIDAD_O_NOMBRE_REQUERIDO);

            const entidad = await this.entidadesFinancierasRepository.getById(entityId, userId);
            if (!entidad.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND_O_AJENA);

            if (sender && !entidad[0].linked_user_id) {
                await this.#vincularAlEmisor(entityId, userId, sender.user_id);
            }

            const [[updated], notifRows] = await Promise.all([
                this.gastosRepository.aprobarGasto(gastoId, entityId),
                this.gastosRepository.getCopyNotificationData(gastoId),
            ]);

            const notif = notifRows[0];

            try {
                await bestEffort(() =>
                    this.movementsRepository.createEntidadLog(
                        entityId,
                        MovementType.PURCHASE_CREATED,
                        `Gasto compartido aceptado: "${gasto.name}"`,
                    ),
                );
            } catch (err) {
                logRed(`[historial entidad ${entityId}] no se pudo registrar PURCHASE_CREATED: ${err.message}`);
            }

            await Promise.all([
                this.gastosRepository.updateStatus(gasto.shared_from_id, ExpenseStatus.ACTIVE),
                notif && triggerCompartidos(notif.sender_user_id, PusherEvent.COMPARTIDO_APROBADO, {
                    gastoId,
                    entityId: notif.sender_entity_id,
                    receiverName: notif.receiver_name,
                    gastoName: notif.gasto_name,
                }),
            ]);

            return updated;
        });
    }

    async #rechazarPagosPendientes(originalId) {
        const pendientes = await this.movementsRepository.getPendingPaymentsByPurchases([originalId]);
        for (const pend of pendientes) {
            await this.movementsRepository.closePendingPayment(pend.id, MovementType.PAYMENT_REJECTED);
        }
    }

    async rechazar(gastoId, userId) {
        return this.tx(async () => {
            const rows = await this.gastosRepository.getById(gastoId);
            if (!rows.length) throw customError(ErrorCode.GASTO_NOT_FOUND);

            const gasto = rows[0];
            if (String(gasto.receiver_user_id) !== String(userId)) throw customError(ErrorCode.NO_AUTORIZADO);
            if (gasto.status !== ExpenseStatus.PENDING_APPROVAL) throw customError(ErrorCode.GASTO_NO_PENDIENTE_APROBACION);

            const [notif] = await this.gastosRepository.getCopyNotificationData(gastoId);

            const [[updated]] = await Promise.all([
                this.gastosRepository.updateStatus(gastoId, ExpenseStatus.REJECTED),
                this.gastosRepository.updateStatus(gasto.shared_from_id, ExpenseStatus.REJECTED),
                this.#rechazarPagosPendientes(gasto.shared_from_id),
                notif && triggerCompartidos(notif.sender_user_id, PusherEvent.COMPARTIDO_RECHAZADO, {
                    gastoId,
                    entityId: notif.sender_entity_id,
                    receiverName: notif.receiver_name,
                    gastoName: notif.gasto_name,
                }),
            ]);

            return updated;
        });
    }

    async reintentar(gastoId, userId) {
        return this.tx(async () => {
            const originalRows = await this.gastosRepository.getById(gastoId);
            if (!originalRows.length) throw customError(ErrorCode.GASTO_NOT_FOUND);

            const original = originalRows[0];

            const entidad = await this.entidadesFinancierasRepository.getById(original.financial_entity_id, userId);
            if (!entidad.length) throw customError(ErrorCode.NO_AUTORIZADO);

            const copyRows = await this.gastosRepository.getSharedCopyByOriginalId(gastoId);
            if (!copyRows.length) throw customError(ErrorCode.GASTO_COMPARTIDO_NO_ASOCIADO);

            const copy = copyRows[0];
            if (copy.status !== ExpenseStatus.REJECTED) throw customError(ErrorCode.GASTO_COMPARTIDO_NO_RECHAZADO);

            const [[updated]] = await Promise.all([
                this.gastosRepository.updateStatus(copy.id, ExpenseStatus.PENDING_APPROVAL),
                this.gastosRepository.updateStatus(gastoId, ExpenseStatus.PENDING_APPROVAL),
                triggerCompartidos(copy.receiver_user_id, PusherEvent.COMPARTIDO_NUEVO, { gastoId }),
            ]);

            return updated;
        });
    }
}
