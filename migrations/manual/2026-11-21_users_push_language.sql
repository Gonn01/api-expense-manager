ALTER TABLE users
    ADD COLUMN IF NOT EXISTS push_language varchar(2) NOT NULL DEFAULT 'es'
    CHECK (push_language IN ('es', 'en'));
