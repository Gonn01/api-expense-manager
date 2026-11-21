-- Motivo: el historial del gasto registra cada paso de una solicitud de edición
-- de un gasto compartido. Son líneas históricas: no cuentan como pagos.
--
-- Ejecutar manualmente contra la base real antes de desplegar la API, y antes de
-- 2026-11-21_ediciones_compartidas_2_tabla.sql.
-- ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción en
-- versiones viejas de Postgres: ejecutar cada sentencia por separado.

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'EDIT_REQUESTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'EDIT_APPROVED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'EDIT_REJECTED';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'EDIT_CANCELLED';
