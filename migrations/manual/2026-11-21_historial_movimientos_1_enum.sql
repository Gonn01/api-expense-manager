-- Motivo: el historial del gasto conserva cada paso de pagos y gastos compartidos.
-- Estos tipos son líneas históricas: no cuentan como cuotas pagas ni pendientes.
--
-- Ejecutar manualmente contra la base real antes de desplegar la API, y antes de
-- 2026-11-21_historial_movimientos_2_backfill.sql.
-- ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción en
-- versiones viejas de Postgres: ejecutar cada sentencia por separado.

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PAYMENT_REQUESTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PAYMENT_REVERTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'REVERSAL_REQUESTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'REVERSAL_CANCELLED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'REVERSAL_REJECTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SHARED_APPROVED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SHARED_REJECTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SHARED_RETRIED';
