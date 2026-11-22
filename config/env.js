import dotenv from "dotenv";
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;
export const DATABASE_URL = process.env.DATABASE_URL;
export const BEAMS_INSTANCE_ID = process.env.BEAMS_INSTANCE_ID;
export const BEAMS_SECRET_KEY = process.env.BEAMS_SECRET_KEY;
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;