import { NotificacionesController } from "../controller/notificaciones.controller.js";
import { NotificacionesRepository } from "../repositories/notificaciones.repository.js";
import { NotificacionesService } from "../services/notificaciones.service.js";

export function makeNotificacionesController() {
    const notificacionesService = new NotificacionesService({
        notificacionesRepository: new NotificacionesRepository(),
    });
    return new NotificacionesController(notificacionesService);
}
