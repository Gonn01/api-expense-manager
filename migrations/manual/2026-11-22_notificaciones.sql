CREATE TABLE IF NOT EXISTS public.notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
    ON public.notifications (user_id, id DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON public.notifications (user_id)
    WHERE read_at IS NULL;
