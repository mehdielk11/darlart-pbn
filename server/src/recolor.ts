/**
 * Palette recoloring: repaints an image with exactly N colors taken from a paint palette.
 *
 * Used by the n8n artwork workflow: the image model paints freely, then every pixel is snapped to the
 * N palette colors that represent the picture best, so the artwork only contains real paint colors.
 *
 * 1. white and black point (src/core/palettematch.ts correctTones): the picture's whites become white and its
 *    blacks black, so they are matched to the white and black paints instead of light and dark greys
 * 2. the N paints that minimise the pixels' color error are chosen and every pixel takes its nearest one
 *    (src/core/palettematch.ts matchToPalette), exactly N whenever the image has N distinct colors
 */
import sharp from "sharp";
import { RGB } from "../../src/common";
import { correctTones, matchToPalette } from "../../src/core/palettematch";
import { parseCustomColors } from "../../src/core/settings";
import { fitToCanvas } from "./reference";

export interface RecolorOptions {
    colors: number;
    /** Palette text, as stored in server/palettes */
    palette: string;
    /** Paint codes that must not be used */
    exclude: string[];
    /** Longest side of the output image */
    maxSide: number;
    /** Median filter size before recoloring, softens anti-aliasing speckles (0 or 1 = off) */
    smooth: number;
    /** When set (e.g. "60x75"), the image is first cropped (never stretched) to this canvas ratio */
    canvasSize?: string;
    orientation?: "auto" | "portrait" | "landscape";
    /** White and black point before matching (default true) */
    toneCorrection?: boolean;
}

export interface RecolorColor {
    code: string;
    hex: string;
    rgb: [number, number, number];
    pixels: number;
    percent: number;
}

export interface RecolorResult {
    png: Buffer;
    width: number;
    height: number;
    colors: RecolorColor[];
}

interface PaletteColor {
    code: string;
    hex: string;
    rgb: [number, number, number];
}

const MAX_INPUT_PIXELS = 100 * 1000 * 1000;

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

export function loadPaletteColors(paletteText: string, exclude: string[] = []): PaletteColor[] {
    const parsed = parseCustomColors(paletteText);
    const excluded = new Set(exclude.map((code) => code.trim()).filter((code) => code));
    const colors: PaletteColor[] = [];
    for (const rgb of parsed.restrictions) {
        const code = parsed.codes[`${rgb[0]},${rgb[1]},${rgb[2]}`] || "";
        if (code && excluded.has(code)) {
            continue;
        }
        colors.push({ code, hex: toHex(rgb), rgb: [rgb[0], rgb[1], rgb[2]] });
    }
    return colors;
}

export async function recolorToPalette(input: Buffer, options: RecolorOptions): Promise<RecolorResult> {
    const palette = loadPaletteColors(options.palette, options.exclude);
    if (palette.length < options.colors) {
        throw new Error(`The palette has ${palette.length} usable colors, fewer than the ${options.colors} requested`);
    }

    if (options.canvasSize) {
        input = (await fitToCanvas(input, options.canvasSize, options.orientation || "auto")).image;
    }
    let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize(options.maxSide, options.maxSide, { fit: "inside", withoutEnlargement: true });
    if (options.smooth > 1) {
        pipeline = pipeline.median(options.smooth);
    }
    const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const pixelCount = width * height;

    if (options.toneCorrection !== false) {
        correctTones(data, 3);
    }
    const match = matchToPalette(data, 3, options.colors, palette.map((c) => c.rgb as RGB), { exactCount: true });

    const out = Buffer.alloc(pixelCount * 3);
    for (let p = 0, o = 0; p < pixelCount; p++, o += 3) {
        const rgb = palette[match.paintOfPixel[p]].rgb;
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
    }
    const png = await sharp(out, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
    const colors: RecolorColor[] = match.paints.map((index) => {
        const color = palette[index];
        const pixels = match.pixelsPerPaint.get(index) || 0;
        return {
            code: color.code,
            hex: color.hex,
            rgb: color.rgb,
            pixels,
            percent: Math.round((pixels / pixelCount) * 10000) / 100,
        };
    });
    return { png, width, height, colors };
}
