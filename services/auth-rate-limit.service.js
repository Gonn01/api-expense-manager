import { createHash } from "node:crypto";
import { customError, ErrorCode } from "../utils/errors.js";
import { logRed } from "../utils/logs_custom.js";

const PURGE_PROBABILITY = 0.01;
const PURGE_AFTER_SECONDS = 24 * 60 * 60;

const hashKey = (key) => createHash("sha256").update(key).digest("hex");

export class AuthRateLimitService {
    constructor({ rateLimitRepository, shouldPurge = () => Math.random() < PURGE_PROBABILITY }) {
        this.rateLimitRepository = rateLimitRepository;
        this.shouldPurge = shouldPurge;
    }

    async consume(rules) {
        const results = await Promise.all(
            rules.map(async (rule) => {
                const [row] = await this.rateLimitRepository.consume(hashKey(rule.key), rule.windowSeconds);
                return { ...row, limit: rule.limit };
            }),
        );

        if (this.shouldPurge()) {
            await this.rateLimitRepository
                .purgeOlderThan(PURGE_AFTER_SECONDS)
                .catch((err) => logRed(`[límite de intentos] no se pudo limpiar: ${err.message}`));
        }

        const exceeded = results.filter((result) => result.attempts > result.limit);
        if (!exceeded.length) return;

        throw customError(ErrorCode.DEMASIADOS_INTENTOS, {
            details: {
                retry_after_seconds: Math.max(...exceeded.map((result) => result.retry_after_seconds)),
            },
        });
    }

    async reset(rules) {
        await this.rateLimitRepository.reset(rules.map((rule) => hashKey(rule.key)));
    }
}
