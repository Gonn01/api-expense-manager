import { handleError } from "../utils/errors.js";

export class NotificacionesController {
    constructor(notificacionesService) {
        this.notificacionesService = notificacionesService;
    }

    listar = async (req, res) => {
        try {
            const { userId } = req.session;
            const { limit, before } = req.query;
            const data = await this.notificacionesService.listar(userId, { limit, before });
            res.json({ message: "Notificaciones obtenidas", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    marcarLeida = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.notificacionesService.marcarLeida(req.params.id, userId);
            res.json({ message: "Notificación leída", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    marcarTodasLeidas = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.notificacionesService.marcarTodasLeidas(userId);
            res.json({ message: "Notificaciones leídas", data });
        } catch (err) {
            return handleError(res, err);
        }
    };
}
