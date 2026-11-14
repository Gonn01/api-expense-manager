import { handleError } from "../utils/errors.js";

export class CompartidosController {
    constructor(compartidosService) {
        this.compartidosService = compartidosService;
    }

    getCompartidos = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.compartidosService.getCompartidos(userId);
            res.json({ message: "Gastos compartidos obtenidos", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    aprobar = async (req, res) => {
        try {
            const { id } = req.params;
            const { financial_entity_id, new_entity_name } = req.body;
            const { userId } = req.session;

            const data = await this.compartidosService.aprobar(id, userId, financial_entity_id, new_entity_name);
            res.json({ message: "Gasto aprobado con éxito", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    rechazar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.rechazar(id, userId);
            res.json({ message: "Gasto rechazado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    reintentar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.reintentar(id, userId);
            res.json({ message: "Gasto reenviado con éxito", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    confirmarPago = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.confirmarPago(movementId, userId);
            res.json({ message: "Pago confirmado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    rechazarPago = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.rechazarPago(movementId, userId);
            res.json({ message: "Pago rechazado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    retirarPago = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.retirarPago(movementId, userId);
            res.json({ message: "Pago retirado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    aceptarReversion = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.aceptarReversion(movementId, userId);
            res.json({ message: "Reversión aceptada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    rechazarReversion = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.rechazarReversion(movementId, userId);
            res.json({ message: "Reversión rechazada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    cancelarReversion = async (req, res) => {
        try {
            const { movementId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.cancelarReversion(movementId, userId);
            res.json({ message: "Solicitud de reversión cancelada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }
}
