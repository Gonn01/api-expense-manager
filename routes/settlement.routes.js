import { Router } from "express";
import { makeSettlementController } from "../factories/settlement.factory.js";

const router = Router();
const controller = makeSettlementController();

router.get("/session", controller.getSession);
router.post("/session", controller.startSession);
router.put("/session/items", controller.setItems);
router.post("/session/finish", controller.finishSession);
router.delete("/session", controller.discardSession);

router.get("/snapshots", controller.listSnapshots);
router.get("/snapshots/:id", controller.getSnapshot);

export default router;
