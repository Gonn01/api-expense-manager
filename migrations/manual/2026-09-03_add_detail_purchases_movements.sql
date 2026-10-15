-- Motivo: historial de eventos de un gasto (feature "historial de eventos").
-- Se agrega una columna de detalle libre para guardar, por ejemplo, qué campo
-- cambió al editar un gasto (ej: `Nombre: "Netflix" -> "Netflix Premium"`).
-- Además, movement_type es un enum de Postgres que solo tenía CREATION,
-- PAYMENT, REFUND y PENDING_PAYMENT: se agregan los valores EDITED, RESTORE
-- y DELETE (este último ya existía del lado JS en utils/enums.js pero nunca
-- se había agregado a la base, por lo que nunca se usó para loggear).
--
-- Ejecutado manualmente contra la base real el 2026-09-03.

ALTER TABLE purchases_movements ADD COLUMN detail TEXT;

ALTER TYPE movement_type ADD VALUE 'EDITED';
ALTER TYPE movement_type ADD VALUE 'RESTORE';
ALTER TYPE movement_type ADD VALUE 'DELETE';
