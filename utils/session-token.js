import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";

const SESSION_DURATION = "7d";

export const signSessionToken = (user) =>
    jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
        expiresIn: SESSION_DURATION,
    });
