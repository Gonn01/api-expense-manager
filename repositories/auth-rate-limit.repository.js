import { executeQuery } from "../db.js";

export class AuthRateLimitRepository {
    async consume(key, windowSeconds) {
        return await executeQuery(
            `INSERT INTO auth_rate_limits AS current (key, attempts, window_started_at)
             VALUES ($1, 1, NOW())
             ON CONFLICT (key) DO UPDATE SET
                 attempts = CASE
                     WHEN current.window_started_at <= NOW() - make_interval(secs => $2::int) THEN 1
                     ELSE current.attempts + 1
                 END,
                 window_started_at = CASE
                     WHEN current.window_started_at <= NOW() - make_interval(secs => $2::int) THEN NOW()
                     ELSE current.window_started_at
                 END
             RETURNING attempts,
                       GREATEST(
                           1,
                           CEIL(EXTRACT(EPOCH FROM window_started_at + make_interval(secs => $2::int) - NOW()))
                       )::int AS retry_after_seconds`,
            [key, windowSeconds],
        );
    }

    async reset(keys) {
        if (!keys.length) return [];
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        return await executeQuery(`DELETE FROM auth_rate_limits WHERE key IN (${placeholders})`, keys);
    }

    async purgeOlderThan(seconds) {
        return await executeQuery(
            `DELETE FROM auth_rate_limits WHERE window_started_at < NOW() - make_interval(secs => $1::int)`,
            [seconds],
        );
    }
}
