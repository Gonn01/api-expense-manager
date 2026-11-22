CREATE INDEX IF NOT EXISTS purchases_shared_from_idx
    ON purchases (shared_from_id)
    WHERE shared_from_id IS NOT NULL;
