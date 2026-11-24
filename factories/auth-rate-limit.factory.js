import { AuthRateLimitRepository } from "../repositories/auth-rate-limit.repository.js";
import { AuthRateLimitService } from "../services/auth-rate-limit.service.js";

export const makeAuthRateLimitService = () =>
    new AuthRateLimitService({ rateLimitRepository: new AuthRateLimitRepository() });
