-- Motivo: pagos compartidos con estado en el resumen de cuentas, retiro de pagos
-- pendientes y solicitud de reversión de pagos confirmados.
--
-- * PAYMENT_REJECTED: el pago pendiente rechazado por la contraparte deja de
--   borrarse; queda con este tipo para que el resumen muestre "rechazado".
-- * PAYMENT_WITHDRAWN: pago pendiente retirado por quien lo registró.
-- * paired_movement_id: vincula el pago confirmado con el pago registrado en la
--   copia de la contraparte, para revertir los dos juntos.
-- * reversal_requested_by_user_id / reversal_requested_at: solicitud de
--   reversión de un pago confirmado, pendiente de que la otra parte responda.
--
-- Ejecutar manualmente contra la base real antes de desplegar la API.
-- ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción en
-- versiones viejas de Postgres: ejecutar cada sentencia por separado.

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PAYMENT_WITHDRAWN';

ALTER TABLE purchases_movements ADD COLUMN IF NOT EXISTS paired_movement_id INTEGER;
ALTER TABLE purchases_movements ADD COLUMN IF NOT EXISTS reversal_requested_by_user_id INTEGER;
ALTER TABLE purchases_movements ADD COLUMN IF NOT EXISTS reversal_requested_at TIMESTAMPTZ;
