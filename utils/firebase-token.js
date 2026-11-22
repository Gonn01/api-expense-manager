import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FIREBASE_PROJECT_ID } from "../config/env.js";
import { customError, ErrorCode } from "./errors.js";

const INFRASTRUCTURE_ERROR_CODES = new Set(["auth/internal-error", "app/network-error"]);

function firebaseAuth() {
    const app = getApps()[0] ?? initializeApp({ projectId: FIREBASE_PROJECT_ID });
    return getAuth(app);
}

export function isInvalidFirebaseTokenError(err) {
    const code = err?.code ?? err?.errorInfo?.code;
    return typeof code === "string" && code.startsWith("auth/") && !INFRASTRUCTURE_ERROR_CODES.has(code);
}

export async function verifyFirebaseIdToken(idToken, auth = null) {
    if (!auth && !FIREBASE_PROJECT_ID) {
        throw customError(ErrorCode.GOOGLE_NO_CONFIGURADO);
    }

    try {
        const decoded = await (auth ?? firebaseAuth()).verifyIdToken(idToken);
        return {
            firebaseId: decoded.uid,
            email: decoded.email ?? null,
            emailVerified: decoded.email_verified === true,
            name: decoded.name ?? null,
            avatar: decoded.picture ?? null,
        };
    } catch (err) {
        if (isInvalidFirebaseTokenError(err)) {
            throw customError(ErrorCode.GOOGLE_TOKEN_INVALIDO);
        }
        throw err;
    }
}
