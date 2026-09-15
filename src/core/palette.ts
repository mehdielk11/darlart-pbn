/**
 * Palette helpers shared by the website, the CLI and the API:
 * paint codes, Darl'Art family renumbering and grouping of the legend by family
 */
import { RGB } from "../common";
import { FacetResult } from "../facetmanagement";
import { findPaletteFamily, PaletteFamilyMatch } from "../palettefamilies";

export function colorToHex(color: RGB): string {
    const r = Math.floor(color[0]);
    const g = Math.floor(color[1]);
    const b = Math.floor(color[2]);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function getColorCode(color: RGB, colorCodes: { [key: string]: string } = {}): string {
    const hexValue = colorToHex(color);
    return (colorCodes && (colorCodes[`${color[0]},${color[1]},${color[2]}`] || colorCodes[hexValue.toUpperCase()] || colorCodes[hexValue.toLowerCase()])) || "";
}

/**
 * Renumbers the colors so they follow the Darl'Art paint family order: family by family, in the order of each family's swatches.
 * Colors that don't belong to a family keep their relative order after the family colors.
 * The facet colors are remapped in place (they determine the label numbers) and the reordered colors are returned.
 */
export function reorderColorsByFamily(colorsByIndex: RGB[], colorCodes: { [key: string]: string }, facetResult: FacetResult): RGB[] {
    const entries = colorsByIndex.map((color, index) => {
        const family = findPaletteFamily(colorToHex(color), getColorCode(color, colorCodes));
        return {
            index,
            familyIndex: family ? family.familyIndex : Number.MAX_VALUE,
            position: family ? family.position : 0,
        };
    });
    if (!entries.some((e) => e.familyIndex !== Number.MAX_VALUE)) {
        return colorsByIndex;
    }

    entries.sort((a, b) => (a.familyIndex - b.familyIndex) || (a.position - b.position) || (a.index - b.index));

    const newIndexByOldIndex: number[] = new Array(entries.length);
    entries.forEach((e, newIndex) => { newIndexByOldIndex[e.index] = newIndex; });
    for (const f of facetResult.facets) {
        if (f != null) {
            f.color = newIndexByOldIndex[f.color];
        }
    }
    return entries.map((e) => colorsByIndex[e.index]);
}

export interface PaletteEntry {
    number: number;
    color: RGB;
    hex: string;
    code: string;
    family: PaletteFamilyMatch | null;
}

export interface PaletteRow {
    /** Family label, empty when the palette has no Darl'Art colors */
    label: string;
    entries: PaletteEntry[];
}

export function buildPaletteEntries(colorsByIndex: RGB[], colorCodes: { [key: string]: string } = {}): PaletteEntry[] {
    return colorsByIndex.map((color, index) => {
        const hex = colorToHex(color);
        const code = getColorCode(color, colorCodes);
        return { number: index + 1, color, hex, code, family: findPaletteFamily(hex, code) };
    });
}

/**
 * One row per paint family (in family order), colors without a family in a last row.
 * When no color belongs to a family, the entries are split in unlabelled rows of `ungroupedRowSize`.
 */
export function groupPaletteEntries(entries: PaletteEntry[], otherLabel: string = "Other colors", ungroupedRowSize: number = 9): PaletteRow[] {
    if (!entries.some((e) => e.family !== null)) {
        const rows: PaletteRow[] = [];
        for (let i = 0; i < entries.length; i += ungroupedRowSize) {
            rows.push({ label: "", entries: entries.slice(i, i + ungroupedRowSize) });
        }
        return rows;
    }

    const rowsByKey: { [key: string]: { key: number; row: PaletteRow } } = {};
    for (const entry of entries) {
        const key = entry.family ? entry.family.familyIndex : Number.MAX_VALUE;
        if (!rowsByKey[key]) {
            rowsByKey[key] = { key, row: { label: entry.family ? entry.family.label : otherLabel, entries: [] } };
        }
        rowsByKey[key].row.entries.push(entry);
    }
    return Object.keys(rowsByKey)
        .map((k) => rowsByKey[k])
        .sort((a, b) => a.key - b.key)
        .map((r) => {
            r.row.entries.sort((a, b) => a.number - b.number);
            return r.row;
        });
}
