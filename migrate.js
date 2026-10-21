import { readFileSync } from 'fs';
import { logGreen, logCyan, logBlue, logYellow } from './utils/logs_custom.js';
import { executeQuery } from './db.js';
import { MovementType, Currency, ExpenseType } from './utils/enums.js';

const data = JSON.parse(readFileSync('./data.json', 'utf8'));

const CURRENCY_MAP = {
    0: Currency.ARS,
    1: Currency.USD,
    2: Currency.EUR,
};

const TYPE_MAP = {
    0: ExpenseType.EGRESO,
    1: ExpenseType.INGRESO,
    2: ExpenseType.EGRESO,
    3: ExpenseType.INGRESO,
};

function parseDate(str) {
    if (!str) return null;
    const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, dd, mm, yyyy, hh, mi] = match;
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00`);
}

function extractPaymentDates(logs) {
    return logs
        .filter((l) => l.includes('pago'))
        .map((l) => parseDate(l))
        .filter(Boolean)
        .sort((a, b) => a - b);
}

async function runMigration() {
    logGreen('🚀 Iniciando migración…');

    const userRows = await executeQuery(
        `SELECT id FROM users WHERE firebase_user_id = $1 LIMIT 1`,
        [data.idUser],
    );

    if (!userRows.length) {
        console.error(`❌ No se encontró usuario con firebase_user_id: ${data.idUser}`);
        process.exit(1);
    }

    const userId = userRows[0].id;
    logBlue(`  Usuario encontrado: ID ${userId}`);

    logCyan('➡ Limpiando datos previos del usuario…');

    await executeQuery(`
        DELETE FROM purchases_categories
        WHERE purchase_id IN (
            SELECT p.id FROM purchases p
            JOIN financial_entities fe ON fe.id = p.financial_entity_id
            WHERE fe.user_id = $1
        )
    `, [userId]);

    await executeQuery(`
        DELETE FROM purchases_movements
        WHERE purchase_id IN (
            SELECT p.id FROM purchases p
            JOIN financial_entities fe ON fe.id = p.financial_entity_id
            WHERE fe.user_id = $1
        )
    `, [userId]);

    await executeQuery(`
        DELETE FROM purchases
        WHERE financial_entity_id IN (
            SELECT id FROM financial_entities WHERE user_id = $1
        )
    `, [userId]);

    await executeQuery(
        `DELETE FROM financial_entities_movements
         WHERE financial_entity_id IN (
             SELECT id FROM financial_entities WHERE user_id = $1
         )`,
        [userId],
    );

    await executeQuery(
        `DELETE FROM financial_entities WHERE user_id = $1`,
        [userId],
    );

    logGreen('✔ Datos previos eliminados.');

    logCyan(`➡ Migrando ${data.categorias.length} entidades…`);

    let totalPurchases = 0;
    let totalMovements = 0;
    let skipped = 0;

    for (const cat of data.categorias) {
        const entityCreatedAt = parseDate(cat.logs?.[0]) ?? new Date();

        const entityRows = await executeQuery(
            `INSERT INTO financial_entities (name, user_id, deleted, created_at)
             VALUES ($1, $2, false, $3)
             RETURNING id`,
            [cat.name.trim(), userId, entityCreatedAt],
        );
        const entityId = entityRows[0].id;

        await executeQuery(
            `INSERT INTO financial_entities_movements (created_at, financial_entity_id, movement_type)
             VALUES ($1, $2, $3)`,
            [entityCreatedAt, entityId, MovementType.CREATION],
        );

        logBlue(`  ✓ Entidad "${cat.name}" (${cat.compras.length} compras)`);

        for (const compra of cat.compras) {
            const currency = CURRENCY_MAP[compra.currencyType];
            const type = TYPE_MAP[compra.type];

            if (!currency || !type) {
                logYellow(`    ⚠ Skipping "${compra.nameOfProduct}": tipo/moneda desconocido`);
                skipped++;
                continue;
            }

            const createdAt = parseDate(compra.creationDate) ?? new Date();
            const amount = compra.totalAmount;
            const quotas = compra.amountOfQuotas ?? 0;
            const paymentDates = extractPaymentDates(compra.logs ?? []);

            const purchaseRows = await executeQuery(
                `INSERT INTO purchases (
                    created_at, image_url, amount, number_of_quotas,
                    currency_type, type, name, financial_entity_id, fixed_expense, deleted
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false)
                RETURNING id`,
                [
                    createdAt,
                    compra.image ?? null,
                    amount,
                    quotas,
                    currency,
                    type,
                    compra.nameOfProduct.trim(),
                    entityId,
                ],
            );
            const purchaseId = purchaseRows[0].id;
            totalPurchases++;

            await executeQuery(
                `INSERT INTO purchases_movements (created_at, purchase_id, movement_type, amount, payment_date)
                 VALUES ($1, $2, $3, NULL, NULL)`,
                [createdAt, purchaseId, MovementType.CREATION],
            );

            const amountPerQuota = quotas > 0 ? amount / quotas : amount;
            const paidCount = compra.quotasPayed ?? 0;

            for (let i = 0; i < paidCount; i++) {
                const payDate = paymentDates[i] ?? createdAt;
                await executeQuery(
                    `INSERT INTO purchases_movements (created_at, purchase_id, movement_type, amount, payment_date)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [payDate, purchaseId, MovementType.PAYMENT, amountPerQuota, payDate],
                );
                totalMovements++;
            }
        }
    }

    logGreen(`\n✔ Migración completada:`);
    logGreen(`   - ${data.categorias.length} entidades`);
    logGreen(`   - ${totalPurchases} compras`);
    logGreen(`   - ${totalMovements} movimientos de pago`);
    if (skipped) logYellow(`   - ${skipped} compras omitidas por datos inválidos`);

    process.exit(0);
}

runMigration().catch((err) => {
    console.error('❌ Error en migración:', err);
    process.exit(1);
});
