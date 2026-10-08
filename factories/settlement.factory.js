import { SettlementController } from "../controller/settlement.controller.js";
import { SettlementRepository } from "../repositories/settlement.repository.js";
import { SettlementService } from "../services/settlement.service.js";
import { GastosService } from "../services/gastos.service.js";
import { GastosRepository } from "../repositories/gastos.repository.js";
import { MovementsRepository } from "../repositories/movements.repository.js";
import { EntidadesFinancierasRepository } from "../repositories/entidades-financieras.repository.js";
import { CategoriasRepository } from "../repositories/categorias.repository.js";

export function makeSettlementController() {
    const settlementRepository = new SettlementRepository();

    // El cierre de sesión efectúa los pagos marcados: necesita GastosService.
    const gastosService = new GastosService({
        gastosRepository: new GastosRepository(),
        movementsRepository: new MovementsRepository(),
        entidadesFinancierasRepository: new EntidadesFinancierasRepository(),
        categoriasRepository: new CategoriasRepository(),
        settlementRepository,
    });

    const settlementService = new SettlementService({ settlementRepository, gastosService });
    return new SettlementController(settlementService);
}
