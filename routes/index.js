import express from "express";
import authRoutes from "./auth.route.js";
import healthRoutes from "./health.route.js";
import userRoutes from "./user.route.js";
import entidadesFinancierasRoutes from "./entidades_financieras.route.js";
import dashboardRoutes from "./dashboard.route.js"
import gastosRoutes from "./gastos.routes.js";
import categoriasRoutes from "./categorias.route.js";
import compartidosRoutes from "./compartidos.routes.js";
import notificacionesRoutes from "./notificaciones.routes.js";
import settlementRoutes from "./settlement.routes.js";
import { verifyToken } from "../middleware/verify_token.js";

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use(verifyToken);
router.use("/user", userRoutes);
router.use("/entidades-financieras", entidadesFinancierasRoutes);
router.use("/dashboard", dashboardRoutes)
router.use('/gastos', gastosRoutes);
router.use('/categorias', categoriasRoutes);
router.use('/notificaciones/pendientes', compartidosRoutes);
router.use('/notificaciones', notificacionesRoutes);
router.use('/settlement', settlementRoutes);

export default router;

