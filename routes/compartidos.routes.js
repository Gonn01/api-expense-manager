import { Router } from "express";
import { makeCompartidosController } from "../factories/compartidos.factory.js";

const router = Router();
const controller = makeCompartidosController();

router.get("/", controller.getCompartidos);
router.post("/pagos/:movementId/confirmar", controller.confirmarPago);
router.post("/pagos/:movementId/rechazar", controller.rechazarPago);
router.post("/pagos/:movementId/retirar", controller.retirarPago);
router.post("/pagos/:movementId/reversion/aceptar", controller.aceptarReversion);
router.post("/pagos/:movementId/reversion/rechazar", controller.rechazarReversion);
router.post("/pagos/:movementId/reversion/cancelar", controller.cancelarReversion);
router.post("/:id/aprobar", controller.aprobar);
router.post("/:id/rechazar", controller.rechazar);
router.post("/:id/reintentar", controller.reintentar);

export default router;
