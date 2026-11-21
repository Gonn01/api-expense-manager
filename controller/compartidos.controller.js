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

    descartar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const { delete_linked } = req.body ?? {};

            const data = await this.compartidosService.descartar(id, userId, delete_linked);
            res.json({ message: "Gasto descartado", data });
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

    solicitarEdicion = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const { amount, currency_type, type, fixed_expense, number_of_quotas } = req.body ?? {};

            const data = await this.compartidosService.solicitarEdicion(id, userId, {
                amount, currency_type, type, fixed_expense, number_of_quotas,
            });
            res.json({ message: "Solicitud de edición enviada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    aprobarEdicion = async (req, res) => {
        try {
            const { editId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.aprobarEdicion(editId, userId);
            res.json({ message: "Edición aprobada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    rechazarEdicion = async (req, res) => {
        try {
            const { editId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.rechazarEdicion(editId, userId);
            res.json({ message: "Edición rechazada", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    cancelarEdicion = async (req, res) => {
        try {
            const { editId } = req.params;
            const { userId } = req.session;

            const data = await this.compartidosService.cancelarEdicion(editId, userId);
            res.json({ message: "Solicitud de edición cancelada", data });
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
