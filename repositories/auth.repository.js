import { executeQuery } from '../db.js';

export class AuthRepository {
    async findUserByEmail(email) {
        return await executeQuery(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [email]
        );
    }

    async findUserByFirebaseId(firebaseId) {
        return await executeQuery(
            "SELECT * FROM users WHERE firebase_user_id = $1 LIMIT 1",
            [firebaseId]
        );
    }

    async createUser(name, email, hash, firebaseId, avatar) {
        return await executeQuery(
            `INSERT INTO users (name, email, password, firebase_user_id, avatar, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id, name, email`,
            [name, email, hash, firebaseId, avatar ?? null]
        );
    }

    async linkFirebaseId(userId, firebaseId, avatar) {
        return await executeQuery(
            `UPDATE users
             SET firebase_user_id = $1,
                 avatar = COALESCE(avatar, $2)
             WHERE id = $3
             RETURNING id, name, email`,
            [firebaseId, avatar ?? null, userId]
        );
    }

}