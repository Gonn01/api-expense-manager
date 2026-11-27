import { AuthController } from "../controller/auth.controller.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import { AuthService } from "../services/auth.service.js";
import { makeAuthRateLimitService } from "./auth-rate-limit.factory.js";
import { makeFirebaseIdentity } from "./firebase-identity.factory.js";

export function makeAuthController() {
    const authRepository = new AuthRepository();

    const authService = new AuthService({
        authRepository,
        rateLimitService: makeAuthRateLimitService(),
        identity: makeFirebaseIdentity(),
    });

    const authController = new AuthController(authService);

    return authController;
}
