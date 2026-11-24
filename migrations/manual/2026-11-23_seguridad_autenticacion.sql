BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key text PRIMARY KEY,
    attempts integer NOT NULL,
    window_started_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx
    ON public.auth_rate_limits (window_started_at);

COMMIT;
