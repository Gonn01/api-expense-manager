import { GastosController } from "../controller/gastos.controller.js";
import { GastosRepository } from "../repositories/gastos.repository.js";
import { MovementsRepository } from "../repositories/movements.repository.js";
import { EntidadesFinancierasRepository } from "../repositories/entidades-financieras.repository.js";
import { CategoriasRepository } from "../repositories/categorias.repository.js";
import { SettlementRepository } from "../repositories/settlement.repository.js";
import { GastosService } from "../services/gastos.service.js";

export function makeGastosController() {
    const gastosRepository = new GastosRepository();
    const movementsRepository = new MovementsRepository();
    const entidadesFinancierasRepository = new EntidadesFinancierasRepository();
    const categoriasRepository = new CategoriasRepository();
    const settlementRepository = new SettlementRepository();

    const gastosService = new GastosService({
        gastosRepository,
        movementsRepository,
        entidadesFinancierasRepository,
        categoriasRepository,
        settlementRepository
    });

    const gastosController = new GastosController(gastosService);

    return gastosController;
}
