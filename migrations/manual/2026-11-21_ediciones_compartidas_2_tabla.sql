-- Motivo: cambiar monto, moneda, tipo, frecuencia o cuotas de un gasto compartido
-- requiere que la otra persona lo apruebe. Cada solicitud queda guardada con su
-- resultado. Solo puede haber una pendiente por gasto compartido.
--
-- Ejecutar manualmente después de 2026-11-21_ediciones_compartidas_1_enum.sql
-- y antes de desplegar la API.

CREATE TABLE IF NOT EXISTS purchase_edit_requests (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    sibling_purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
    counterparty_user_id INTEGER NOT NULL REFERENCES users(id),
    changes JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by_user_id INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_edit_requests_one_pending
    ON purchase_edit_requests (LEAST(purchase_id, sibling_purchase_id), GREATEST(purchase_id, sibling_purchase_id))
    WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS purchase_edit_requests_requested_by
    ON purchase_edit_requests (requested_by_user_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS purchase_edit_requests_counterparty
    ON purchase_edit_requests (counterparty_user_id) WHERE status = 'PENDING';
