import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID } from "../config/env.js";

export const hasFirebaseAdminCredentials = () =>
    Boolean(FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY);

export function firebaseAdminAuth() {
    const app =
        getApps()[0] ??
        initializeApp(
            hasFirebaseAdminCredentials()
                ? {
                      projectId: FIREBASE_PROJECT_ID,
                      credential: cert({
                          projectId: FIREBASE_PROJECT_ID,
                          clientEmail: FIREBASE_CLIENT_EMAIL,
                          privateKey: FIREBASE_PRIVATE_KEY,
                      }),
                  }
                : { projectId: FIREBASE_PROJECT_ID },
        );
    return getAuth(app);
}
