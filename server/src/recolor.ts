/**
 * Palette recoloring: repaints an image with exactly N colors taken from a paint palette.
 *
 * Used by the n8n artwork workflow: the image model paints freely, then every pixel is snapped to the
 * N palette colors that represent the picture best, so the artwork only contains real paint colors.
 *
 * 1. the pixels are grouped in a 5-bit-per-channel histogram (weighted points, fast)
 * 2. weighted k-means in Lab finds N color centers
 * 3. each center takes the nearest palette color that is still free (largest clusters choose first)
 * 4. palette-constrained refinement: each chosen color moves to the palette color nearest to the mean of
 *    the pixels it covers; a color that covers nothing is replaced by the worst-represented pixels' color
 * 5. every pixel is painted with its nearest chosen color
 * 6. a chosen color that no pixel is nearest to takes the pixels closest to it (from a color that keeps others),
 *    so the artwork has exactly N colors whenever the image has N distinct RGB values
 */
import sharp from "sharp";
import { parseCustomColors } from "../../src/core/settings";
import { rgb2lab } from "../../src/lib/colorconversion";
import { fitToCanvas } from "./reference";

export interface RecolorOptions {
    colors: number;
    /** Palette text, as stored in server/palettes */
    palette: string;
    /** Paint codes that must not be used (e.g. pure white and black) */
    exclude: string[];
    /** Longest side of the output image */
    maxSide: number;
    /** Median filter size before recoloring, softens anti-aliasing speckles (0 or 1 = off) */
    smooth: number;
    /** When set (e.g. "60x75"), the image is first cropped (never stretched) to this canvas ratio */
    canvasSize?: string;
    orientation?: "auto" | "portrait" | "landscape";
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
    lab: number[];
}

const MAX_INPUT_PIXELS = 100 * 1000 * 1000;

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

function dist2(a: number[], b: number[]) {
    const dl = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dl * dl + da * da + db * db;
}

export function loadPaletteColors(paletteText: string, exclude: string[] = []): PaletteColor[] {
    const parsed = parseCustomColors(paletteText);
    const excluded = new Set(exclude.map((code) => code.trim()).filter((code) => code));
    const colors: PaletteColor[] = [];
    for (const rgb of parsed.restrictions) {
        const code = parsed.codes[`${rgb[0]},${rgb[1]},${rgb[2]}`] || "";
        if (code && excluded.has(code)) {
            continue;
        }
        colors.push({ code, hex: toHex(rgb), rgb: [rgb[0], rgb[1], rgb[2]], lab: rgb2lab(rgb) });
    }
    return colors;
}

function nearest(lab: number[], candidates: PaletteColor[], taken?: Set<number>, allowed?: number): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < candidates.length; i++) {
        if (taken && taken.has(i) && i !== allowed) {
            continue;
        }
        const d = dist2(lab, candidates[i].lab);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    }
    return best;
}

/** Deterministic pseudo random numbers, so the same image always gives the same result */
function seededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
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

    // 1. histogram: 32 levels per channel, each bin keeps its pixel count and mean color
    const BINS = 32 * 32 * 32;
    const counts = new Float64Array(BINS);
    const sums = new Float64Array(BINS * 3);
    for (let p = 0, o = 0; p < pixelCount; p++, o += 3) {
        const bin = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
        counts[bin]++;
        sums[bin * 3] += data[o];
        sums[bin * 3 + 1] += data[o + 1];
        sums[bin * 3 + 2] += data[o + 2];
    }
    const points: number[][] = [];
    const weights: number[] = [];
    for (let bin = 0; bin < BINS; bin++) {
        if (counts[bin] > 0) {
            const c = counts[bin];
            points.push(rgb2lab([sums[bin * 3] / c, sums[bin * 3 + 1] / c, sums[bin * 3 + 2] / c]));
            weights.push(c);
        }
    }
    const n = points.length;
    const k = Math.min(options.colors, n);
    const assignment = new Int32Array(n);

    // 2. weighted k-means++ then Lloyd iterations, in Lab
    const random = seededRandom(n * 31 + pixelCount);
    const centers: number[][] = [];
    let heaviest = 0;
    for (let i = 1; i < n; i++) {
        if (weights[i] > weights[heaviest]) { heaviest = i; }
    }
    centers.push(points[heaviest].slice());
    const closest = new Float64Array(n).fill(Infinity);
    while (centers.length < k) {
        const last = centers[centers.length - 1];
        let total = 0;
        for (let i = 0; i < n; i++) {
            closest[i] = Math.min(closest[i], dist2(points[i], last));
            total += closest[i] * weights[i];
        }
        let target = random() * total;
        let pick = n - 1;
        for (let i = 0; i < n; i++) {
            target -= closest[i] * weights[i];
            if (target <= 0) { pick = i; break; }
        }
        centers.push(points[pick].slice());
    }
    const clusterWeights = new Float64Array(k);
    for (let iteration = 0; iteration < 20; iteration++) {
        const sumsLab = new Float64Array(k * 3);
        clusterWeights.fill(0);
        for (let i = 0; i < n; i++) {
            let best = 0;
            let bestDistance = Infinity;
            for (let c = 0; c < k; c++) {
                const d = dist2(points[i], centers[c]);
                if (d < bestDistance) { bestDistance = d; best = c; }
            }
            assignment[i] = best;
            clusterWeights[best] += weights[i];
            sumsLab[best * 3] += points[i][0] * weights[i];
            sumsLab[best * 3 + 1] += points[i][1] * weights[i];
            sumsLab[best * 3 + 2] += points[i][2] * weights[i];
        }
        let moved = 0;
        for (let c = 0; c < k; c++) {
            if (clusterWeights[c] === 0) { continue; }
            const next = [sumsLab[c * 3] / clusterWeights[c], sumsLab[c * 3 + 1] / clusterWeights[c], sumsLab[c * 3 + 2] / clusterWeights[c]];
            moved = Math.max(moved, dist2(next, centers[c]));
            centers[c] = next;
        }
        if (moved < 0.01) { break; }
    }

    // 3. snap the centers to distinct palette colors, the largest clusters choose first
    const taken = new Set<number>();
    const chosen: number[] = new Array(k);
    const order = Array.from({ length: k }, (_, c) => c).sort((a, b) => clusterWeights[b] - clusterWeights[a]);
    for (const c of order) {
        chosen[c] = nearest(centers[c], palette, taken);
        taken.add(chosen[c]);
    }

    // 4. refinement restricted to the palette
    const assignToChosen = () => {
        let error = 0;
        for (let i = 0; i < n; i++) {
            let best = 0;
            let bestDistance = Infinity;
            for (let c = 0; c < k; c++) {
                const d = dist2(points[i], palette[chosen[c]].lab);
                if (d < bestDistance) { bestDistance = d; best = c; }
            }
            assignment[i] = best;
            closest[i] = bestDistance;
            error += bestDistance * weights[i];
        }
        return error;
    };
    for (let iteration = 0; iteration < 30; iteration++) {
        assignToChosen();
        const sumsLab = new Float64Array(k * 3);
        clusterWeights.fill(0);
        for (let i = 0; i < n; i++) {
            const c = assignment[i];
            clusterWeights[c] += weights[i];
            sumsLab[c * 3] += points[i][0] * weights[i];
            sumsLab[c * 3 + 1] += points[i][1] * weights[i];
            sumsLab[c * 3 + 2] += points[i][2] * weights[i];
        }
        let changed = false;
        for (let c = 0; c < k; c++) {
            let target: number[];
            if (clusterWeights[c] > 0) {
                target = [sumsLab[c * 3] / clusterWeights[c], sumsLab[c * 3 + 1] / clusterWeights[c], sumsLab[c * 3 + 2] / clusterWeights[c]];
            } else {
                // an unused color: give it to the pixels that are represented worst
                let worst = 0;
                for (let i = 1; i < n; i++) {
                    if (closest[i] * weights[i] > closest[worst] * weights[worst]) { worst = i; }
                }
                target = points[worst];
                closest[worst] = 0;
            }
            const next = nearest(target, palette, taken, chosen[c]);
            if (next !== chosen[c]) {
                taken.delete(chosen[c]);
                taken.add(next);
                chosen[c] = next;
                changed = true;
            }
        }
        if (!changed) { break; }
    }

    // 5. every exact RGB takes its nearest chosen color
    const chosenLab = chosen.map((index) => palette[index].lab);
    const cache = new Map<number, number>();
    const keysPerColor: number[][] = Array.from({ length: k }, () => []);
    for (let p = 0, o = 0; p < pixelCount; p++, o += 3) {
        const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
        if (cache.has(key)) { continue; }
        const lab = rgb2lab([data[o], data[o + 1], data[o + 2]]);
        let c = 0;
        let bestDistance = Infinity;
        for (let j = 0; j < k; j++) {
            const d = dist2(lab, chosenLab[j]);
            if (d < bestDistance) { bestDistance = d; c = j; }
        }
        cache.set(key, c);
        keysPerColor[c].push(key);
    }

    // 6. a chosen color no pixel is nearest to (its cluster was measured on the coarse histogram, the pixels are exact)
    //    takes the exact RGB nearest to it, from a color that keeps others: exactly N colors whenever the image has
    //    at least N distinct RGB values
    const keyLab = (key: number) => rgb2lab([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
    for (let c = 0; c < k; c++) {
        if (keysPerColor[c].length > 0) { continue; }
        let bestKey = -1;
        let bestFrom = -1;
        let bestDistance = Infinity;
        for (let from = 0; from < k; from++) {
            if (keysPerColor[from].length < 2) { continue; }
            for (const key of keysPerColor[from]) {
                const d = dist2(keyLab(key), chosenLab[c]);
                if (d < bestDistance) { bestDistance = d; bestKey = key; bestFrom = from; }
            }
        }
        if (bestKey < 0) { break; } // fewer distinct RGB values than colors
        keysPerColor[bestFrom].splice(keysPerColor[bestFrom].indexOf(bestKey), 1);
        keysPerColor[c].push(bestKey);
        cache.set(bestKey, c);
    }

    // 7. paint every pixel with its color
    const pixelsPerColor = new Float64Array(k);
    const out = Buffer.alloc(pixelCount * 3);
    for (let p = 0, o = 0; p < pixelCount; p++, o += 3) {
        const c = cache.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]) as number;
        pixelsPerColor[c]++;
        const rgb = palette[chosen[c]].rgb;
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
    }

    const png = await sharp(out, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
    const colors: RecolorColor[] = [];
    for (let c = 0; c < k; c++) {
        if (pixelsPerColor[c] === 0) { continue; }
        const color = palette[chosen[c]];
        colors.push({
            code: color.code,
            hex: color.hex,
            rgb: color.rgb,
            pixels: pixelsPerColor[c],
            percent: Math.round((pixelsPerColor[c] / pixelCount) * 10000) / 100,
        });
    }
    colors.sort((a, b) => b.pixels - a.pixels);
    return { png, width, height, colors };
}
