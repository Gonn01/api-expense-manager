DO $$
DECLARE
    enum_name text;
    currency_code text;
BEGIN
    FOR enum_name IN
        SELECT DISTINCT t.typname
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE c.relkind = 'r'
          AND pg_table_is_visible(c.oid)
          AND a.attname IN ('currency_type', 'preferred_currency', 'sueldo_currency')
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND t.typtype = 'e'
    LOOP
        FOREACH currency_code IN ARRAY ARRAY[
            'BRL', 'CLP', 'UYU',
            'AUD', 'AWG', 'BOB', 'CAD', 'CHF', 'CNH', 'CNY', 'COP', 'CZK', 'DKK',
            'GBP', 'HKD', 'ILS', 'INR', 'JPY', 'MXN', 'NIO', 'NOK', 'NZD', 'PEN',
            'PYG', 'RSD', 'RUB', 'SEK', 'SGD', 'TRY', 'VES', 'VND', 'XDR', 'ZAR'
        ]
        LOOP
            EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_name, currency_code);
        END LOOP;
    END LOOP;
END $$;
