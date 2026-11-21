import { SettlementController } from "../controller/settlement.controller.js";
import { SettlementRepository } from "../repositories/settlement.repository.js";
import { SettlementService } from "../services/settlement.service.js";
import { GastosService } from "../services/gastos.service.js";
import { PagosCompartidosService } from "../services/pagos-compartidos.service.js";
import { EdicionesCompartidasRepository } from "../repositories/ediciones-compartidas.repository.js";
import { GastosRepository } from "../repositories/gastos.repository.js";
import { MovementsRepository } from "../repositories/movements.repository.js";
import { EntidadesFinancierasRepository } from "../repositories/entidades-financieras.repository.js";
import { CategoriasRepository } from "../repositories/categorias.repository.js";

export function makeSettlementController() {
    const settlementRepository = new SettlementRepository();
    const gastosRepository = new GastosRepository();
    const movementsRepository = new MovementsRepository();

    const pagosCompartidosService = new PagosCompartidosService({
        gastosRepository,
        movementsRepository,
        settlementRepository,
        edicionesRepository: new EdicionesCompartidasRepository(),
    });

    const gastosService = new GastosService({
        gastosRepository,
        movementsRepository,
        entidadesFinancierasRepository: new EntidadesFinancierasRepository(),
        categoriasRepository: new CategoriasRepository(),
        settlementRepository,
        pagosCompartidosService,
    });

    const settlementService = new SettlementService({ settlementRepository, gastosService, movementsRepository });
    return new SettlementController(settlementService);
}
