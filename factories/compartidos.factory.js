import { CompartidosController } from "../controller/compartidos.controller.js";
import { CompartidosService } from "../services/compartidos.service.js";
import { PagosCompartidosService } from "../services/pagos-compartidos.service.js";
import { EdicionesCompartidasService } from "../services/ediciones-compartidas.service.js";
import { EdicionesCompartidasRepository } from "../repositories/ediciones-compartidas.repository.js";
import { GastosRepository } from "../repositories/gastos.repository.js";
import { EntidadesFinancierasRepository } from "../repositories/entidades-financieras.repository.js";
import { MovementsRepository } from "../repositories/movements.repository.js";
import { SettlementRepository } from "../repositories/settlement.repository.js";

export function makeCompartidosController() {
    const gastosRepository = new GastosRepository();
    const entidadesFinancierasRepository = new EntidadesFinancierasRepository();
    const movementsRepository = new MovementsRepository();
    const settlementRepository = new SettlementRepository();

    const pagosCompartidosService = new PagosCompartidosService({
        gastosRepository,
        movementsRepository,
        settlementRepository,
        edicionesRepository: new EdicionesCompartidasRepository(),
    });

    const edicionesCompartidasService = new EdicionesCompartidasService({
        edicionesRepository: new EdicionesCompartidasRepository(),
        gastosRepository,
        movementsRepository,
        settlementRepository,
    });

    const compartidosService = new CompartidosService({
        gastosRepository,
        entidadesFinancierasRepository,
        movementsRepository,
        pagosCompartidosService,
        settlementRepository,
        edicionesCompartidasService,
    });

    return new CompartidosController(compartidosService);
}
