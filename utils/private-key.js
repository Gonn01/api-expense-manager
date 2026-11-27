const PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const PEM_FOOTER = "-----END PRIVATE KEY-----";

export function normalizePrivateKey(value) {
    if (!value) return value;
    const key = value
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\\n/g, "\n")
        .trim();
    if (key.includes("-----BEGIN")) return key.endsWith("\n") ? key : `${key}\n`;
    return `${PEM_HEADER}\n${key}\n${PEM_FOOTER}\n`;
}
