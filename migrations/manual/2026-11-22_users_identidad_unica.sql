BEGIN;

UPDATE users
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

ALTER TABLE users ALTER COLUMN firebase_user_id DROP DEFAULT;

UPDATE users
SET firebase_user_id = NULL
WHERE firebase_user_id IN ('a', '');

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE UNIQUE INDEX users_firebase_user_id_key ON users (firebase_user_id)
WHERE firebase_user_id IS NOT NULL;

COMMIT;
