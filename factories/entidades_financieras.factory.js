import { EntidadesFinancierasController } from "../controller/entidades-financieras.controller.js";
import { EntidadesFinancierasRepository } from "../repositories/entidades-financieras.repository.js";
import { GastosRepository } from "../repositories/gastos.repository.js";
import { MovementsRepository } from "../repositories/movements.repository.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import { SettlementRepository } from "../repositories/settlement.repository.js";
import { EntidadesFinancierasService } from "../services/entidades-financieras.service.js";
import { PagosCompartidosService } from "../services/pagos-compartidos.service.js";
import { EdicionesCompartidasRepository } from "../repositories/ediciones-compartidas.repository.js";

export function makeEntidadesFinancierasController() {
    const gastosRepository = new GastosRepository();
    const entidadesFinancierasRepository = new EntidadesFinancierasRepository();
    const movementsRepository = new MovementsRepository();
    const authRepository = new AuthRepository();
    const settlementRepository = new SettlementRepository();

    const pagosCompartidosService = new PagosCompartidosService({
        gastosRepository,
        movementsRepository,
        settlementRepository,
        edicionesRepository: new EdicionesCompartidasRepository(),
    });

    const entidadesFinancierasService = new EntidadesFinancierasService({
        entidadesFinancierasRepository,
        gastosRepository,
        movementsRepository,
        authRepository,
        settlementRepository,
        pagosCompartidosService,
    });

    const entidadesFinancierasController = new EntidadesFinancierasController(entidadesFinancierasService);

    return entidadesFinancierasController;
}
