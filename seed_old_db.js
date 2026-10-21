import fs from "fs";
import pkg from "pg";
import dayjs from "dayjs";

const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value)) {
        return value;
    }

    const formats = [
        "DD/MM/YYYY HH:mm",
        "DD/MM/YYYY HH:mm:ss",
        "YYYY-MM-DD HH:mm:ss",
        "YYYY-MM-DD HH:mm:ss.SSSSSS",
        "YYYY-MM-DDTHH:mm:ss",
    ];

    for (const format of formats) {
        const d = dayjs(value, format, true);
        if (d.isValid()) {
            return d.toDate();
        }
    }

    const native = new Date(value);
    if (!isNaN(native)) {
        return native;
    }

    console.warn("⚠️ Fecha inválida ignorada:", value);
    return null;
}

async function run() {
    const raw = fs.readFileSync("./data.json", "utf8");
    const data = JSON.parse(raw);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const {
            rows: [user],
        } = await client.query(
            `
      INSERT INTO users (email, firebase_user_id)
      VALUES ($1, $2)
      RETURNING id
      `,
            [`imported@user.com`, data.idUser]
        );

        const userId = user.id;

        for (const categoria of data.categorias) {
            const {
                rows: [entity],
            } = await client.query(
                `
        INSERT INTO financial_entities (name, user_id, deleted)
        VALUES ($1, $2, false)
        RETURNING id
        `,
                [categoria.name, userId]
            );

            const entityId = entity.id;

            for (const compra of categoria.compras || []) {
                const createdAt =
                    parseDate(compra.creationDate) ?? new Date();
                await client.query(
                    `
          INSERT INTO purchases (
            created_at,
            finalization_date,
            first_quota_date,
            image,
            amount,
            amount_per_quota,
            number_of_quotas,
            payed_quotas,
            currency_type,
            name,
            financial_entity_id,
            fixed_expense,
            deleted,
            type
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13
          )
          RETURNING id
          `,
                    [
                        createdAt,
                        parseDate(compra.lastQuotaDate),
                        parseDate(compra.firstQuotaDate),
                        compra.image,
                        compra.totalAmount,
                        compra.amountPerQuota,
                        compra.amountOfQuotas,
                        compra.quotasPayed,
                        compra.currencyType,
                        compra.nameOfProduct,
                        entityId,
                        compra.ignored ?? false,
                        mapExpenseType(compra.type),
                    ]
                );

            }
        }

        await client.query("COMMIT");
        console.log("✅ Import completo");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

function mapExpenseType(type) {
    switch (type) {
        case 0:
            return "DEBO";
        case 1:
            return "ME_DEBEN";
        case 2:
            return "DEBO";
        case 3:
            return "ME_DEBEN";
        default:
            return null;
    }
}

run();
