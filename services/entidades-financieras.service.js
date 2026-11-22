import { MovementType, PusherEvent } from "../utils/enums.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { logRed } from "../utils/logs_custom.js";
import { triggerCompartidos } from "../utils/pusher.js";
import { withTransaction, bestEffort } from "../db.js";

const detalleDesvinculacion = ({ linked_user_name: name, linked_user_email: email }) =>
  `Desvinculada de ${name && email ? `${name} (${email})` : (name ?? email ?? "un usuario")}`;

export class EntidadesFinancierasService {
  constructor({
    entidadesFinancierasRepository,
    gastosRepository,
    movementsRepository,
    authRepository,
    settlementRepository = null,
    pagosCompartidosService = null,
    runInTransaction = withTransaction,
  }) {
    this.settlementRepository = settlementRepository;
    this.pagosCompartidosService = pagosCompartidosService;
    this.entidadesFinancierasRepository = entidadesFinancierasRepository;
    this.gastosRepository = gastosRepository;
    this.movementsRepository = movementsRepository;
    this.authRepository = authRepository;
    this.tx = runInTransaction;
  }

  async #log(entidadId, type, detail = null) {
    if (!entidadId) return;
    try {
      await bestEffort(() => this.movementsRepository.createEntidadLog(entidadId, type, detail));
    } catch (err) {
      logRed(`[historial entidad ${entidadId}] no se pudo registrar ${type}: ${err.message}`);
    }
  }

  async #avisarVinculo(event, destinatarioId, actorId) {
    try {
      await bestEffort(async () => {
        const [[actor], [entidadPropia]] = await Promise.all([
          this.gastosRepository.getUserName(actorId),
          this.entidadesFinancierasRepository.findByLinkedUser(destinatarioId, actorId),
        ]);
        await triggerCompartidos(destinatarioId, event, {
          actorId,
          actorName: actor?.name ?? null,
          entityId: entidadPropia?.id ?? null,
        });
      });
    } catch (err) {
      logRed(`[notificaciones] no se pudo avisar ${event}: ${err.message}`);
    }
  }

  async listar(userId) {
    return await this.entidadesFinancierasRepository.listar(userId);
  }

  async restaurar(id, userId) {
    return this.tx(async () => {
      const rows = await this.entidadesFinancierasRepository.restaurar(id, userId);
      if (!rows.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

      const restored = await this.gastosRepository.restoreByEntidad(id);
      await this.movementsRepository.createGastoLogs(
        restored.map((g) => ({ gastoId: g.id, movementType: MovementType.RESTORE })),
      );

      return rows;
    });
  }

  async obtenerPorId(id, userId) {
    const entidad = await this.entidadesFinancierasRepository.getById(id, userId);

    if (!entidad.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const entity = entidad[0];
    const gastos = await this.gastosRepository.getGastosByEntidad(id);
    const gastosActivos = gastos.filter(g => Number(g.payed_quotas) < Number(g.number_of_quotas) || g.fixed_expense);
    const gastosFinalizados = gastos.filter(g => Number(g.payed_quotas) >= Number(g.number_of_quotas) && !g.fixed_expense);
    const gastosPendientes = await this.gastosRepository.getPendingByEntidad(id);
    const gastosEliminados = await this.gastosRepository.getDeletedByEntidad(id);

    const movements = await this.movementsRepository.getMovementsByEntidad(id);

    return {
      id: entity.id,
      name: entity.name,
      created_at: entity.created_at,
      is_favorite: entity.is_favorite,
      mercado_pago_alias: entity.mercado_pago_alias ?? null,
      linked_user_id: entity.linked_user_id,
      linked_user_name: entity.linked_user_name ?? null,
      linked_user_email: entity.linked_user_email ?? null,
      gastos_activos: gastosActivos,
      gastos_inactivos: gastosFinalizados,
      gastos_pendientes: gastosPendientes,
      gastos_eliminados: gastosEliminados,
      pending_count: gastosPendientes.length,
      movements,
    };
  }

  async crear(name, userId) {
    return this.tx(async () => {
      const existing = await this.entidadesFinancierasRepository.findByName(userId, name);
      if (existing.length) throw customError(ErrorCode.ENTIDAD_YA_EXISTE);

      const [row] = await this.entidadesFinancierasRepository.create(name, userId);

      await this.movementsRepository.createEntidadLog(row.id, MovementType.CREATION);

      return row;
    });
  }

  async actualizar(id, name, userId) {
    const currentRows = await this.entidadesFinancierasRepository.getById(id, userId);
    if (currentRows.length === 0) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const existing = await this.entidadesFinancierasRepository.findByName(userId, name, id);
    if (existing.length) throw customError(ErrorCode.ENTIDAD_YA_EXISTE);

    const oldName = currentRows[0].name;
    const [row] = await this.entidadesFinancierasRepository.update(id, name, userId);

    if (name !== oldName) {
      await this.#log(id, MovementType.EDITED, `Nombre: "${oldName}" → "${name}"`);
    }

    return row;
  }

  async actualizarAliasMercadoPago(id, alias, userId) {
    const [actual] = await this.entidadesFinancierasRepository.getById(id, userId);
    if (!actual) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const anterior = actual.mercado_pago_alias ?? null;
    if (anterior === alias) return actual;

    const [row] = await this.entidadesFinancierasRepository.setMercadoPagoAlias(id, userId, alias);
    await this.#log(
      id,
      MovementType.EDITED,
      `Alias de Mercado Pago: ${anterior ? `"${anterior}"` : "sin alias"} → ${alias ? `"${alias}"` : "sin alias"}`,
    );

    return row;
  }

  async marcarFavorito(id, userId, favorite) {
    const currentRows = await this.entidadesFinancierasRepository.getById(id, userId);
    if (currentRows.length === 0) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const [row] = await this.entidadesFinancierasRepository.setFavorite(id, userId, Boolean(favorite));
    return row;
  }

  async eliminar(id, userId) {
    return this.tx(async () => {
      const [[entidad], gastos, session] = await Promise.all([
        this.entidadesFinancierasRepository.getById(id, userId),
        this.gastosRepository.getIdsByEntidad(id),
        this.settlementRepository?.getOpenSession(userId) ?? null,
      ]);
      if (!entidad) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

      const ids = gastos.map((g) => g.id);
      await this.pagosCompartidosService?.cerrarCompartidos(ids, userId);

      const [[deleted]] = await Promise.all([
        this.entidadesFinancierasRepository.delete(id, userId),
        this.gastosRepository.deleteByEntidad(id),
        this.gastosRepository.unlinkMany(ids),
        this.movementsRepository.createGastoLogs(
          ids.map((gastoId) => ({ gastoId, movementType: MovementType.DELETE })),
        ),
        session ? this.settlementRepository.removeItems(session.id, ids) : null,
      ]);

      if (entidad.linked_user_id) {
        await this.movementsRepository.createEntidadLog(
          id,
          MovementType.UNLINK,
          detalleDesvinculacion(entidad),
        );
        await this.#avisarVinculo(PusherEvent.ENTIDAD_DESVINCULADA, entidad.linked_user_id, userId);
      }

      return { ...deleted, deleted_purchase_ids: ids.map(String) };
    });
  }

  async obtenerMovements(id) {
    return await this.movementsRepository.getMovementsByEntidad(id);
  }

  async vincularUsuario(entityId, userId, email) {
    const entidad = await this.entidadesFinancierasRepository.getById(entityId, userId);
    if (!entidad.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const users = await this.authRepository.findUserByEmail(email);
    if (!users.length) throw customError(ErrorCode.USUARIO_EMAIL_NOT_FOUND);

    const linkedUser = users[0];
    if (Number(linkedUser.id) === Number(userId)) throw customError(ErrorCode.VINCULAR_CUENTA_PROPIA);

    const existing = await this.entidadesFinancierasRepository.findByLinkedUser(userId, linkedUser.id);
    if (existing.length) {
      throw customError(ErrorCode.ENTIDAD_YA_VINCULADA, {
        message: `Ya tenés la entidad "${existing[0].name}" vinculada a ese usuario`,
      });
    }

    const updated = await this.entidadesFinancierasRepository.vincularUsuario(entityId, userId, linkedUser.id);

    const quien = linkedUser.email ? `${linkedUser.name} (${linkedUser.email})` : linkedUser.name;
    await this.#log(entityId, MovementType.LINK, `Vinculada a ${quien}`);

    const anterior = entidad[0].linked_user_id;
    if (anterior && String(anterior) !== String(linkedUser.id)) {
      await this.#avisarVinculo(PusherEvent.ENTIDAD_DESVINCULADA, anterior, userId);
    }
    await this.#avisarVinculo(PusherEvent.ENTIDAD_VINCULADA, linkedUser.id, userId);

    return { ...updated[0], linked_user_name: linkedUser.name, linked_user_email: linkedUser.email };
  }

  async desvincularUsuario(entityId, userId) {
    const entidad = await this.entidadesFinancierasRepository.getById(entityId, userId);
    if (!entidad.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const prev = entidad[0];
    const updated = await this.entidadesFinancierasRepository.desvincularUsuario(entityId, userId);

    if (prev.linked_user_id) {
      await this.#log(entityId, MovementType.UNLINK, detalleDesvinculacion(prev));
      await this.#avisarVinculo(PusherEvent.ENTIDAD_DESVINCULADA, prev.linked_user_id, userId);
    }

    return updated[0];
  }
}
