import { executeQuery } from '../db.js';
import { USER_PUBLIC_COLUMNS, USER_SESSION_COLUMNS } from './user-columns.js';

export class AuthRepository {
    async findUserByEmail(email) {
        return await executeQuery(
            `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE lower(email) = lower(trim($1)) LIMIT 1`,
            [email]
        );
    }

    async findUserWithPasswordByEmail(email) {
        return await executeQuery(
            `SELECT ${USER_SESSION_COLUMNS}, password FROM users WHERE lower(email) = lower(trim($1)) LIMIT 1`,
            [email]
        );
    }

    async findUserByFirebaseId(firebaseId) {
        return await executeQuery(
            `SELECT ${USER_SESSION_COLUMNS} FROM users WHERE firebase_user_id = $1 LIMIT 1`,
            [firebaseId]
        );
    }

    async findUserWithPasswordByFirebaseId(firebaseId) {
        return await executeQuery(
            `SELECT ${USER_SESSION_COLUMNS}, password FROM users WHERE firebase_user_id = $1 LIMIT 1`,
            [firebaseId]
        );
    }

    async moveToFirebase(userId, firebaseId) {
        return await executeQuery(
            `UPDATE users
             SET firebase_user_id = $2, password = NULL
             WHERE id = $1
             RETURNING ${USER_SESSION_COLUMNS}`,
            [userId, firebaseId]
        );
    }

    async createUser(name, email, hash, firebaseId, avatar) {
        return await executeQuery(
            `INSERT INTO users (name, email, password, firebase_user_id, avatar, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING ${USER_SESSION_COLUMNS}`,
            [name, email, hash, firebaseId, avatar ?? null]
        );
    }

    async linkFirebaseId(userId, { firebaseId, name, avatar, discardPassword = false }) {
        return await executeQuery(
            `UPDATE users
             SET firebase_user_id = $1,
                 name = COALESCE(NULLIF(name, ''), $2),
                 avatar = COALESCE(avatar, $3),
                 password = CASE WHEN $4::boolean THEN NULL ELSE password END,
                 token_version = token_version + CASE WHEN $4::boolean THEN 1 ELSE 0 END
             WHERE id = $5
             RETURNING ${USER_SESSION_COLUMNS}`,
            [firebaseId, name ?? null, avatar ?? null, discardPassword, userId]
        );
    }
}
