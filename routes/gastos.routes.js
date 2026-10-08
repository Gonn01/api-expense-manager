import { Router } from 'express';
import { makeGastosController } from '../factories/gastos.factory.js';

const router = Router();

const controller = makeGastosController();

router.post("/", controller.crear);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);
router.put('/:id/categorias', controller.actualizarCategorias);
router.put('/:id/postergar', controller.postergar);
router.put('/:id/favorito', controller.favorito);
router.post("/:id/settle-quota", controller.settleQuota);
router.post("/:id/refund-cuota", controller.refundCuota);
router.post("/:id/restaurar", controller.restaurar);
router.post("/settle-lote", controller.settleQuotasLote);

export default router;
