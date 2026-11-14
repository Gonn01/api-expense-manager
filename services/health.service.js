export class HealthService {
    constructor({ healthRepository }) {
        this.healthRepository = healthRepository;
    }

    async check() {
        const database = await this.healthRepository
            .pingDatabase()
            .then(() => "ok")
            .catch(() => "error");

        return {
            status: database === "ok" ? "ok" : "error",
            database,
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        };
    }
}
