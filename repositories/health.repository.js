import { executeQuery } from "../db.js";

export class HealthRepository {
    async pingDatabase() {
        await executeQuery("SELECT 1");
    }
}
