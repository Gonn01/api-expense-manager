ALTER TABLE public.financial_entities
    ADD COLUMN IF NOT EXISTS mercado_pago_alias text;
