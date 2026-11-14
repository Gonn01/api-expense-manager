import { handleError } from "../utils/errors.js";

export class HealthController {
    constructor(healthService) {
        this.healthService = healthService;
    }

    check = async (req, res) => {
        try {
            const health = await this.healthService.check();
            const ok = health.status === "ok";

            res.status(ok ? 200 : 503).json({
                message: ok ? "API funcionando" : "La API no puede conectarse a la base de datos",
                data: health,
            });
        } catch (err) {
            return handleError(res, err);
        }
    };
}
