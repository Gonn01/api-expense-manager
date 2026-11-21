-- Motivo: reconstruir la línea "pago enviado" de los pagos compartidos ya confirmados.
--
-- La fecha de aprobación se toma del pago espejo, creado al confirmar. Los pagos
-- sin espejo, los rechazados, los retirados y las reversiones anteriores no se
-- pueden reconstruir porque esas fechas no se guardaron.
--
-- Ejecutar una vez, después de 2026-11-21_historial_movimientos_1_enum.sql.
-- Es idempotente: un pago que ya tiene su línea PAYMENT_REQUESTED se saltea.

BEGIN;

WITH confirmados AS (
    SELECT o.id, o.created_at, o.purchase_id, o.amount, o.payment_date,
           o.created_by_user_id, o.detail, espejo.created_at AS confirmed_at
    FROM purchases_movements o
    JOIN purchases_movements espejo ON espejo.id = o.paired_movement_id
    WHERE o.movement_type = 'PAYMENT'
      AND espejo.movement_type = 'PAYMENT'
      AND espejo.paired_movement_id = o.id
      AND espejo.detail = 'Pago confirmado de gasto compartido'
      AND o.detail IS DISTINCT FROM 'Pago confirmado de gasto compartido'
      AND NOT EXISTS (
          SELECT 1 FROM purchases_movements h
          WHERE h.movement_type = 'PAYMENT_REQUESTED' AND h.paired_movement_id = o.id
      )
),
enviados AS (
    INSERT INTO purchases_movements
        (created_at, purchase_id, movement_type, amount, payment_date, created_by_user_id, detail, paired_movement_id)
    SELECT created_at, purchase_id, 'PAYMENT_REQUESTED'::movement_type, amount, payment_date,
           created_by_user_id, detail, id
    FROM confirmados
)
UPDATE purchases_movements pm
SET created_at = confirmados.confirmed_at
FROM confirmados
WHERE pm.id = confirmados.id;

COMMIT;
