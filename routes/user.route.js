import express from "express";
import { makeUserController } from "../factories/user.factory.js";

const router = express.Router();

const userController = makeUserController();

router.put("/preferred-currency", userController.updatePreferredCurrency);
router.put("/sueldo", userController.updateSueldo);
router.get("/password-status", userController.getPasswordStatus);
router.put("/password", userController.updatePassword);
router.post("/sessions/revoke", userController.revokeSessions);
router.get("/push-token", userController.getPushToken);
router.put("/push-language", userController.updatePushLanguage);
router.post("/realtime-auth", userController.authorizeRealtimeChannel);

export default router;
