import express from "express";
import { makeEntidadesFinancierasController } from "../factories/entidades_financieras.factory.js";

const router = express.Router();

const controller = makeEntidadesFinancierasController();

router.get("/", controller.listar);
router.get("/:id", controller.obtenerPorId);
router.post("/", controller.crear);
router.delete("/:id", controller.eliminar);
router.put("/:id", controller.actualizar);
router.put("/:id/favorito", controller.favorito);
router.put("/:id/vincular-usuario", controller.vincularUsuario);
router.delete("/:id/vincular-usuario", controller.desvincularUsuario);

export default router;
