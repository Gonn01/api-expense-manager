WITH vinculadas AS (
    SELECT fe.id,
           COALESCE(u.name || ' (' || u.email || ')', u.name, u.email, 'un usuario') AS quien
    FROM financial_entities fe
    LEFT JOIN users u ON u.id = fe.linked_user_id
    WHERE fe.deleted = true AND fe.linked_user_id IS NOT NULL
    FOR UPDATE OF fe
),
desvinculadas AS (
    UPDATE financial_entities fe
    SET linked_user_id = NULL
    FROM vinculadas v
    WHERE fe.id = v.id
    RETURNING fe.id
)
INSERT INTO financial_entities_movements (created_at, financial_entity_id, movement_type, detail)
SELECT NOW(), v.id, 'UNLINK'::public.movement_type, 'Desvinculada de ' || v.quien
FROM vinculadas v
JOIN desvinculadas d ON d.id = v.id;
