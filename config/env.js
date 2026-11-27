import dotenv from "dotenv";
import { normalizePrivateKey } from "../utils/private-key.js";
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;
export const DATABASE_URL = process.env.DATABASE_URL;
export const DATABASE_SSL = process.env.DATABASE_SSL;
export const BEAMS_INSTANCE_ID = process.env.BEAMS_INSTANCE_ID;
export const BEAMS_SECRET_KEY = process.env.BEAMS_SECRET_KEY;
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
export const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
export const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
export const FIREBASE_PRIVATE_KEY = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
