const ALIAS_PATTERN = /^[a-zA-Z0-9.-]{6,20}$/;

export function normalizeMercadoPagoAlias(value) {
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const alias = value.trim();
    if (!alias) return null;
    return ALIAS_PATTERN.test(alias) ? alias : undefined;
}
