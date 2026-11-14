import express from "express";
import { makeHealthController } from "../factories/health.factory.js";

const router = express.Router();

const healthController = makeHealthController();

router.get("/", healthController.check);

export default router;
