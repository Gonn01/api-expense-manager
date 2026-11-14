import { HealthController } from "../controller/health.controller.js";
import { HealthRepository } from "../repositories/health.repository.js";
import { HealthService } from "../services/health.service.js";

export function makeHealthController() {
    const healthRepository = new HealthRepository();
    const healthService = new HealthService({ healthRepository });
    return new HealthController(healthService);
}
