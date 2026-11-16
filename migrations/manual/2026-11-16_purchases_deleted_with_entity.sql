-- Motivo: eliminar una entidad da de baja también sus gastos, y restaurarla
-- trae de vuelta solo los que se eliminaron con ella.
--
-- * deleted_with_entity: marca los gastos dados de baja por la eliminación de
--   su entidad. Eliminar o restaurar un gasto suelto la deja en false.
--
-- Ejecutar manualmente contra la base real antes de desplegar la API.

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS deleted_with_entity BOOLEAN NOT NULL DEFAULT false;
