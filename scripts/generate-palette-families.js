// Rebuilds src/palettefamilies.ts from a Darl'Art palette JSON, so the families match the paints exactly.
// Accepts both formats: { "#HEX": "0101" } and { "#HEX": { "rgb": [r,g,b], "code": "0101" } }.
//   node scripts/generate-palette-families.js [path/to/palette.json]
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SOURCE = process.argv[2] || path.join(ROOT, "server/palettes/darlart-v3.json");
const OUT = path.join(ROOT, "src/palettefamilies.ts");
const LABELS = { "38": "Famille 38 — Échelle blanc / gris / noir" };

const raw = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const entries = Object.entries(raw).map(([hex, value]) => ({
    hex: hex.toUpperCase(),
    code: String(typeof value === "object" && value !== null ? value.code : value),
}));
const families = {};
for (const e of entries) {
    if (!/^\d{4}$/.test(e.code)) throw new Error("unexpected code " + e.code);
    (families[e.code.slice(0, 2)] = families[e.code.slice(0, 2)] || []).push(e);
}
const keys = Object.keys(families).sort();
for (const key of keys) families[key].sort((a, b) => Number(a.code) - Number(b.code));

const body = keys.map((key) => {
    const label = LABELS[key] || "Famille " + key;
    const colors = families[key].map((e) => `["${e.code}", "${e.hex}"]`).join(", ");
    return `    { label: "${label}", colors: [\n        ${colors},\n    ] },`;
}).join("\n");

const header = `/**
 * Darl'Art paint families, generated from the palette file (${entries.length} colors, ${keys.length} families).
 * Each family lists its [code, hex] swatches in code order.
 * Regenerate with scripts/generate-palette-families.js when the palette changes.
 */

export interface PaletteFamily {
    label: string;
    colors: Array<[string, string]>;
}

export interface PaletteFamilyMatch {
    familyIndex: number;
    label: string;
    position: number;
}

export const PALETTE_FAMILIES: PaletteFamily[] = [
${body}
];

const matchesByCodeAndHex: { [key: string]: PaletteFamilyMatch } = {};
const matchesByHex: { [key: string]: PaletteFamilyMatch } = {};
/** Family index by the first 2 digits of a paint code, so older palette versions still group correctly */
const familyIndexByCodePrefix: { [prefix: string]: number } = {};
PALETTE_FAMILIES.forEach((family, familyIndex) => {
    family.colors.forEach(([code, hex], position) => {
        const match: PaletteFamilyMatch = { familyIndex, label: family.label, position };
        matchesByCodeAndHex[code + "|" + hex] = match;
        if (!(hex in matchesByHex)) {
            matchesByHex[hex] = match;
        }
        if (!(code.substring(0, 2) in familyIndexByCodePrefix)) {
            familyIndexByCodePrefix[code.substring(0, 2)] = familyIndex;
        }
    });
});

/**
 * Finds the paint family of a color. The paint code is checked first: it names the family even when the
 * color comes from another version of the palette, and some families can share a hex value.
 */
export function findPaletteFamily(hex: string, code?: string): PaletteFamilyMatch | null {
    const hexKey = hex.trim().toUpperCase();
    const codeKey = code ? code.trim() : "";
    if (codeKey) {
        const exactMatch = matchesByCodeAndHex[codeKey + "|" + hexKey];
        if (exactMatch) {
            return exactMatch;
        }
        // a code from another palette version: its first 2 digits still name the family, the last 2 the shade
        if (/^\\d{4}$/.test(codeKey)) {
            const familyIndex = familyIndexByCodePrefix[codeKey.substring(0, 2)];
            if (familyIndex !== undefined) {
                return { familyIndex, label: PALETTE_FAMILIES[familyIndex].label, position: parseInt(codeKey.substring(2), 10) - 1 };
            }
        }
    }
    return matchesByHex[hexKey] || null;
}
`;
fs.writeFileSync(OUT, header);
console.log("families", keys.length, "colors", entries.length, "->", OUT);
