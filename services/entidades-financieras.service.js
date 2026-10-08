import { MovementType } from "../utils/enums.js";
import { customError, ErrorCode } from "../utils/errors.js";
import { logRed } from "../utils/logs_custom.js";

export class EntidadesFinancierasService {
  constructor({ entidadesFinancierasRepository, gastosRepository, movementsRepository, authRepository }) {
    this.entidadesFinancierasRepository = entidadesFinancierasRepository;
    this.gastosRepository = gastosRepository;
    this.movementsRepository = movementsRepository;
    this.authRepository = authRepository;
  }

  // Registra un movimiento en el historial de la entidad. Best-effort: si falla
  // el log no rompemos la operación real.
  async #log(entidadId, type, detail = null) {
    if (!entidadId) return;
    try {
      await this.movementsRepository.createEntidadLog(entidadId, type, detail);
    } catch (err) {
      logRed(`[historial entidad ${entidadId}] no se pudo registrar ${type}: ${err.message}`);
    }
  }

  async listar(userId) {
    // El repositorio ya trae `cantidad` y `pending_count` agregados en una
    // sola query (ver EntidadesFinancierasRepository.listar).
    return await this.entidadesFinancierasRepository.listar(userId);
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
    const existing = await this.entidadesFinancierasRepository.findByName(userId, name);
    if (existing.length) throw customError(ErrorCode.ENTIDAD_YA_EXISTE);

    const [row] = await this.entidadesFinancierasRepository.create(name, userId);

    await this.movementsRepository.createEntidadLog(row.id, MovementType.CREATION);

    return row;
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

  async marcarFavorito(id, userId, favorite) {
    const currentRows = await this.entidadesFinancierasRepository.getById(id, userId);
    if (currentRows.length === 0) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const [row] = await this.entidadesFinancierasRepository.setFavorite(id, userId, Boolean(favorite));
    return row;
  }

  async eliminar(id, userId) {
    const deletedRows = await this.entidadesFinancierasRepository.delete(id, userId);

    if (deletedRows.length === 0) {
      throw customError(ErrorCode.ENTIDAD_NOT_FOUND);
    }

    return deletedRows[0];
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

    return { ...updated[0], linked_user_name: linkedUser.name, linked_user_email: linkedUser.email };
  }

  async desvincularUsuario(entityId, userId) {
    const entidad = await this.entidadesFinancierasRepository.getById(entityId, userId);
    if (!entidad.length) throw customError(ErrorCode.ENTIDAD_NOT_FOUND);

    const prev = entidad[0];
    const updated = await this.entidadesFinancierasRepository.desvincularUsuario(entityId, userId);

    if (prev.linked_user_id) {
      const quien = prev.linked_user_email
        ? `${prev.linked_user_name} (${prev.linked_user_email})`
        : (prev.linked_user_name ?? "un usuario");
      await this.#log(entityId, MovementType.UNLINK, `Desvinculada de ${quien}`);
    }

    return updated[0];
  }
}
