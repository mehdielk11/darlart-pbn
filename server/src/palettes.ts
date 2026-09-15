/**
 * Paint palettes stored on the server (server/palettes/<id>.json), in the same format as the website's custom colors
 */
import fs from "fs";
import path from "path";
import { parseCustomColors } from "../../src/core/settings";
import { config } from "./config";

/** "none" means no custom palette: the colors come straight from the photo */
export const NO_PALETTE = "none";

const cache: { [id: string]: string } = {};

export function isValidPaletteId(id: string) {
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

export function listPalettes(): string[] {
    if (!fs.existsSync(config.palettesDir)) {
        return [];
    }
    return fs.readdirSync(config.palettesDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -5))
        .filter(isValidPaletteId)
        .sort();
}

/** Returns the palette text to use as custom colors ("" for "none"), or throws when the palette doesn't exist */
export function loadPalette(id: string): string {
    if (id === NO_PALETTE) {
        return "";
    }
    if (!isValidPaletteId(id)) {
        throw new Error(`Invalid palette "${id}"`);
    }
    if (cache[id] === undefined) {
        const file = path.join(config.palettesDir, id + ".json");
        if (!fs.existsSync(file)) {
            throw new Error(`Unknown palette "${id}". Available: ${[NO_PALETTE, ...listPalettes()].join(", ")}`);
        }
        const text = fs.readFileSync(file, "utf8");
        if (parseCustomColors(text).restrictions.length === 0) {
            throw new Error(`Palette "${id}" doesn't contain any colors`);
        }
        cache[id] = text;
    }
    return cache[id];
}
