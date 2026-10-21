import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import { customError, ErrorCode } from "../utils/errors.js";

export class AuthService {
    constructor({
        authRepository
    }) {
        this.authRepository = authRepository;
    }

    async login(email, password) {
        const users = await this.authRepository.findUserByEmail(email);

        if (users.length === 0) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        const user = users[0];

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            throw customError(ErrorCode.CREDENCIALES_INVALIDAS);
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, firebaseId: user.firebase_id },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return { user, token };
    }

    async firebaseLogin(name, email, avatar, firebaseId) {
        const existing = await this.authRepository.findUserByFirebaseId(firebaseId);

        let user;

        if (existing.length > 0) {
            user = existing[0];
        } else {
            const byEmail = email ? await this.authRepository.findUserByEmail(email) : [];

            if (byEmail.length > 0) {
                const linked = await this.authRepository.linkFirebaseId(byEmail[0].id, firebaseId, avatar);
                user = linked[0];
            } else {
                const inserted = await this.authRepository.createUser(name, email, null, firebaseId, avatar);
                user = inserted[0];
            }
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, firebaseId },
            JWT_SECRET,
            { expiresIn: "7d" }
        );
        return { user, token };
    }

    async register(name, email, password, firebaseId) {
        const existing = await this.authRepository.findUserByEmail(email);

        if (existing.length > 0) {
            throw customError(ErrorCode.EMAIL_YA_REGISTRADO);
        }

        const hash = await bcrypt.hash(password, 12);

        await this.authRepository.createUser(name, email, hash, firebaseId);
    }
}