import { Router } from "express";
import { makeCategoriasController } from "../factories/categorias.factory.js";

const router = Router();
const controller = makeCategoriasController();

router.get("/", controller.listar);
router.post("/", controller.crear);

export default router;
