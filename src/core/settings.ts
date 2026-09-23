/**
 * Generation settings shared by the website, the CLI and the API:
 * custom color parsing, difficulty presets and a single place to build a Settings object
 */
import { RGB } from "../common";
import { ClusteringColorSpace, Settings } from "../settings";

export type Difficulty = "easy" | "medium" | "hard";

export interface DifficultyPreset {
    resizeImageIfTooLarge: boolean;
    resizeImageWidth: number;
    resizeImageHeight: number;
    kMeansMinDeltaDifference: number;
    kMeansClusteringColorSpace: ClusteringColorSpace;
    narrowPixelStripCleanupRuns: number;
    removeFacetsSmallerThanNrOfPoints: number;
    maximumNumberOfFacets: number;
    removeFacetsFromLargeToSmall: boolean;
    nrOfTimesToHalveBorderSegments: number;
}

export const DIFFICULTY_PRESETS: { [key in Difficulty]: DifficultyPreset } = {
    // Simple shapes, large paint areas
    easy: {
        resizeImageIfTooLarge: true,
        resizeImageWidth: 1024,
        resizeImageHeight: 1024,
        kMeansMinDeltaDifference: 1,
        kMeansClusteringColorSpace: ClusteringColorSpace.RGB,
        narrowPixelStripCleanupRuns: 3,
        removeFacetsSmallerThanNrOfPoints: 160,
        maximumNumberOfFacets: 10000,
        removeFacetsFromLargeToSmall: true,
        nrOfTimesToHalveBorderSegments: 3,
    },
    // Balanced detail and simplicity
    medium: {
        resizeImageIfTooLarge: true,
        resizeImageWidth: 1024,
        resizeImageHeight: 1024,
        kMeansMinDeltaDifference: 1,
        kMeansClusteringColorSpace: ClusteringColorSpace.RGB,
        narrowPixelStripCleanupRuns: 3,
        removeFacetsSmallerThanNrOfPoints: 110,
        maximumNumberOfFacets: 35000,
        removeFacetsFromLargeToSmall: true,
        nrOfTimesToHalveBorderSegments: 2,
    },
    // Detailed patterns with many small areas
    hard: {
        resizeImageIfTooLarge: true,
        resizeImageWidth: 1024,
        resizeImageHeight: 1024,
        kMeansMinDeltaDifference: 1,
        kMeansClusteringColorSpace: ClusteringColorSpace.RGB,
        narrowPixelStripCleanupRuns: 5,
        removeFacetsSmallerThanNrOfPoints: 30,
        maximumNumberOfFacets: 100000,
        removeFacetsFromLargeToSmall: true,
        nrOfTimesToHalveBorderSegments: 2,
    },
};

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Fixed seed so the same photo and options always give the same template */
export const DEFAULT_RANDOM_SEED = 7707;

export interface ParsedCustomColors {
    restrictions: RGB[];
    codes: { [key: string]: string };
}

function parseHexToRgb(hexStr: string): RGB | null {
    let clean = hexStr.trim().replace(/^#/, "");
    if (clean.length === 3) {
        clean = clean.split("").map((ch) => ch + ch).join("");
    }
    if (clean.length === 6) {
        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            return [r, g, b];
        }
    }
    return null;
}

function toHex(r: number, g: number, b: number) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Parses the custom colors text: a JSON dictionary / array, or one color per line
 * as "#hex", "#hex, code", "r,g,b" or "r,g,b, code". Lines starting with // are comments.
 */
export function parseCustomColors(text: string): ParsedCustomColors {
    const result: ParsedCustomColors = { restrictions: [], codes: {} };
    const rawText = text || "";
    const rawTrimmed = rawText.trim();
    const seenColors = new Set<string>();

    function addColor(r: number, g: number, b: number, code?: string) {
        if (isNaN(r) || isNaN(g) || isNaN(b)) { return; }
        r = Math.max(0, Math.min(255, Math.floor(r)));
        g = Math.max(0, Math.min(255, Math.floor(g)));
        b = Math.max(0, Math.min(255, Math.floor(b)));
        const rgbKey = `${r},${g},${b}`;
        const hexKey = toHex(r, g, b).toUpperCase();
        if (!seenColors.has(rgbKey)) {
            seenColors.add(rgbKey);
            result.restrictions.push([r, g, b]);
        }
        if (code && code.trim()) {
            const cleanCode = code.trim().replace(/^["']|["']$/g, "");
            result.codes[rgbKey] = cleanCode;
            result.codes[hexKey] = cleanCode;
            result.codes[hexKey.toLowerCase()] = cleanCode;
        }
    }

    /** The paint code of a JSON value: "0101", { code: "0101" }, { id: … } or { name: … } */
    function codeFromValue(value: any): string | undefined {
        if (value === undefined || value === null) { return undefined; }
        if (typeof value === "object") {
            const code = value.code !== undefined ? value.code : (value.id !== undefined ? value.id : value.name);
            return code === undefined || code === null ? undefined : String(code);
        }
        return String(value);
    }

    /** The color of a JSON value when the key isn't one: { rgb: [r, g, b] } or { hex: "#…" } */
    function rgbFromValue(value: any): number[] | null {
        if (!value || typeof value !== "object") { return null; }
        if (Array.isArray(value.rgb) && value.rgb.length >= 3) {
            return [Number(value.rgb[0]), Number(value.rgb[1]), Number(value.rgb[2])];
        }
        return parseHexToRgb(value.hex || value.color || "");
    }

    // 1. JSON: { "#FC6286": "0101" }, { "#FC6286": { "code": "0101", "rgb": [252,98,134] } }
    //    or [ { "color": "#FC6286", "code": "0101" } ]
    let jsonParsed = false;
    if (rawTrimmed.startsWith("{") || rawTrimmed.startsWith("[")) {
        try {
            const parsed = JSON.parse(rawTrimmed);
            if (typeof parsed === "object" && parsed !== null) {
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (typeof item === "string") {
                            const rgb = parseHexToRgb(item);
                            if (rgb) { addColor(rgb[0], rgb[1], rgb[2]); }
                        } else if (typeof item === "object" && item !== null) {
                            const rgb = parseHexToRgb(item.color || item.hex || "") || rgbFromValue(item);
                            if (rgb) {
                                addColor(rgb[0], rgb[1], rgb[2], codeFromValue(item));
                            }
                        }
                    }
                } else {
                    for (const key of Object.keys(parsed)) {
                        const val = (parsed as any)[key];
                        const codeVal = codeFromValue(val);
                        if (key.startsWith("#")) {
                            const rgb = parseHexToRgb(key);
                            if (rgb) { addColor(rgb[0], rgb[1], rgb[2], codeVal); }
                        } else if (key.includes(",")) {
                            const parts = key.split(",");
                            if (parts.length === 3) {
                                addColor(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), codeVal);
                            }
                        } else {
                            // the key is a name or a code: the color itself is in the value
                            const rgb = rgbFromValue(val);
                            if (rgb) { addColor(rgb[0], rgb[1], rgb[2], codeVal || key); }
                        }
                    }
                }
                jsonParsed = result.restrictions.length > 0;
            }
        } catch (e) {
            // not valid JSON, fall back to line-by-line parsing
        }
    }

    // 2. Line-by-line
    if (!jsonParsed) {
        for (const line of rawText.split("\n")) {
            const tline = line.trim();
            if (!tline || tline.startsWith("//")) { continue; }

            if (tline.startsWith("#")) {
                // "#FC6286, 0101" or "#FC6286: 0101" or "#FC6286 0101" or "#FC6286"
                const match = tline.match(/^#([0-9a-fA-F]{3,8})([,:\s]+(.+))?$/);
                if (match) {
                    const rgb = parseHexToRgb("#" + match[1]);
                    if (rgb) {
                        addColor(rgb[0], rgb[1], rgb[2], match[3] ? match[3].trim() : undefined);
                    }
                }
            } else if (tline.includes(",")) {
                // "252, 98, 134, 0101" or "252, 98, 134: 0101" or "252, 98, 134"
                const parts = tline.split(",");
                if (parts.length >= 4) {
                    addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(parts[2].trim()), parts.slice(3).join(",").trim());
                } else if (parts.length === 3) {
                    const p2 = parts[2].trim();
                    const submatch = p2.match(/^(\d+)([:\s]+(.+))?$/);
                    if (submatch) {
                        addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(submatch[1]), submatch[3] ? submatch[3].trim() : undefined);
                    } else {
                        addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(p2));
                    }
                }
            }
        }
    }

    return result;
}

export function applyDifficultyPreset(settings: Settings, difficulty: Difficulty) {
    const preset = DIFFICULTY_PRESETS[difficulty];
    settings.resizeImageIfTooLarge = preset.resizeImageIfTooLarge;
    settings.resizeImageWidth = preset.resizeImageWidth;
    settings.resizeImageHeight = preset.resizeImageHeight;
    settings.kMeansMinDeltaDifference = preset.kMeansMinDeltaDifference;
    settings.kMeansClusteringColorSpace = preset.kMeansClusteringColorSpace;
    settings.narrowPixelStripCleanupRuns = preset.narrowPixelStripCleanupRuns;
    settings.removeFacetsSmallerThanNrOfPoints = preset.removeFacetsSmallerThanNrOfPoints;
    settings.maximumNumberOfFacets = preset.maximumNumberOfFacets;
    settings.removeFacetsFromLargeToSmall = preset.removeFacetsFromLargeToSmall;
    settings.nrOfTimesToHalveBorderSegments = preset.nrOfTimesToHalveBorderSegments;
}

export interface GenerationOptions {
    colors: number;
    difficulty: Difficulty;
    customColors?: string;
    randomSeed?: number;
}

export function buildSettings(options: GenerationOptions): Settings {
    const settings = new Settings();
    applyDifficultyPreset(settings, options.difficulty);
    settings.kMeansNrOfClusters = options.colors;
    settings.randomSeed = typeof options.randomSeed === "number" ? options.randomSeed : DEFAULT_RANDOM_SEED;
    if (options.customColors && options.customColors.trim()) {
        const parsed = parseCustomColors(options.customColors);
        settings.kMeansColorRestrictions = parsed.restrictions;
        settings.colorCodes = parsed.codes;
    }
    return settings;
}
