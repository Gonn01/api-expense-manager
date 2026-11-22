import { Router } from "express";
import { makeNotificacionesController } from "../factories/notificaciones.factory.js";

const router = Router();
const controller = makeNotificacionesController();

router.get("/", controller.listar);
router.post("/leer-todas", controller.marcarTodasLeidas);
router.post("/:id/leer", controller.marcarLeida);

export default router;
