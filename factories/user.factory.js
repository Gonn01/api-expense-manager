import { UserController } from "../controller/user.controller.js";
import { UserRepository } from "../repositories/user.repository.js";
import { UserService } from "../services/user.service.js";
import { makeAuthRateLimitService } from "./auth-rate-limit.factory.js";
import { makeFirebaseIdentity } from "./firebase-identity.factory.js";

export function makeUserController() {
    const userRepository = new UserRepository();

    const userService = new UserService({
        userRepository,
        rateLimitService: makeAuthRateLimitService(),
        identity: makeFirebaseIdentity(),
    });

    const userController = new UserController(userService);

    return userController;
}
