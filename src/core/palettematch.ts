/**
 * Paints an image with N colors taken from a paint palette, as faithfully as possible.
 *
 * Used by the template pipeline (website and API) and by the artwork recoloring. The paints are chosen to minimise
 * the color error of the pixels themselves (CIEDE2000), not by averaging clusters of colors and snapping the average
 * to a paint: averages drift toward the middle, which turned whites grey and blacks dark grey.
 *
 * 1. histogram of the image colors: exact when the image has few colors (an artwork already painted with paints),
 *    otherwise 6 bits per channel
 * 2. each color's nearest paints; every color's nearest paint forms the ideal set: with N or fewer paints it is the
 *    answer
 * 3. greedy elimination: the paint whose removal adds the least error (pixels x CIEDE2000) is dropped, until N remain
 * 4. swap refinement: a chosen paint is replaced by an unchosen one when the total error goes down
 * 5. every pixel takes its nearest chosen paint
 *
 * A paint can serve several large areas (no "one paint per cluster" rule), and nothing is averaged.
 */
import { RGB } from "../common";
import { deltaE2000, rgb2lab } from "../lib/colorconversion";

export interface PaletteMatchOptions {
    /** Always use exactly N paints when the image has at least N distinct colors (the artwork recoloring needs it) */
    exactCount?: boolean;
    /** Nearest paints kept per color (default 32) */
    candidates?: number;
}

export interface PaletteMatchResult {
    /** Index into the palette of each pixel's paint */
    paintOfPixel: Int32Array;
    /** The palette indexes used, most used first */
    paints: number[];
    /** Pixels per palette index (for the used ones) */
    pixelsPerPaint: Map<number, number>;
}

/** Above this many distinct colors, the histogram uses 6-bit bins */
const EXACT_COLOR_LIMIT = 4096;
const HISTOGRAM_BITS = 6;

type Pixels = Uint8Array | Uint8ClampedArray;

export function matchToPalette(data: Pixels, channels: number, n: number, palette: RGB[], options: PaletteMatchOptions = {}): PaletteMatchResult {
    const P = palette.length;
    if (P === 0) { throw new Error("The palette is empty"); }
    const paletteLab = palette.map((rgb) => rgb2lab(rgb));
    const pixels = Math.floor(data.length / channels);
    n = Math.max(1, Math.min(n, P));

    // 1. histogram
    const exactColors = new Set<number>();
    for (let o = 0; o < pixels * channels && exactColors.size <= EXACT_COLOR_LIMIT; o += channels) {
        exactColors.add((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
    }
    const exact = exactColors.size <= EXACT_COLOR_LIMIT;
    const shift = 8 - HISTOGRAM_BITS;
    const keyAt = exact
        ? (o: number) => (data[o] << 16) | (data[o + 1] << 8) | data[o + 2]
        : (o: number) => ((data[o] >> shift) << (2 * HISTOGRAM_BITS)) | ((data[o + 1] >> shift) << HISTOGRAM_BITS) | (data[o + 2] >> shift);
    const binOfKey = new Map<number, number>();
    const binOfPixel = new Int32Array(pixels);
    const sums: number[] = [];
    for (let p = 0, o = 0; p < pixels; p++, o += channels) {
        const key = keyAt(o);
        let bin = binOfKey.get(key);
        if (bin === undefined) {
            bin = binOfKey.size;
            binOfKey.set(key, bin);
            sums.push(0, 0, 0, 0);
        }
        binOfPixel[p] = bin;
        sums[bin * 4] += data[o];
        sums[bin * 4 + 1] += data[o + 1];
        sums[bin * 4 + 2] += data[o + 2];
        sums[bin * 4 + 3]++;
    }
    const B = binOfKey.size;
    const weight = new Float64Array(B);
    const labs: number[][] = new Array(B);
    for (let i = 0; i < B; i++) {
        const count = sums[i * 4 + 3];
        weight[i] = count;
        labs[i] = rgb2lab([sums[i * 4] / count, sums[i * 4 + 1] / count, sums[i * 4 + 2] / count]);
    }

    // 2. each bin's K nearest paints (prefiltered by plain Lab distance), sorted by CIEDE2000
    const K = Math.min(P, options.candidates || 32);
    const cand: Int32Array[] = new Array(B);
    const candD: Float64Array[] = new Array(B);
    const top: number[] = [];
    const topD: number[] = [];
    for (let i = 0; i < B; i++) {
        const l = labs[i];
        top.length = 0;
        topD.length = 0;
        for (let j = 0; j < P; j++) {
            const q = paletteLab[j];
            const e = (l[0] - q[0]) * (l[0] - q[0]) + (l[1] - q[1]) * (l[1] - q[1]) + (l[2] - q[2]) * (l[2] - q[2]);
            if (top.length === K && e >= topD[K - 1]) { continue; }
            let at = top.length;
            while (at > 0 && topD[at - 1] > e) { at--; }
            top.splice(at, 0, j);
            topD.splice(at, 0, e);
            if (top.length > K) { top.pop(); topD.pop(); }
        }
        const d = top.map((j) => deltaE2000(l, paletteLab[j]));
        const order = top.map((_, k) => k).sort((a, b) => (d[a] - d[b]) || (top[a] - top[b]));
        cand[i] = Int32Array.from(order.map((k) => top[k]));
        candD[i] = Float64Array.from(order.map((k) => d[k]));
    }
    // for each paint, the bins that list it (to find who gains when it is chosen)
    const listedBins: number[][] = Array.from({ length: P }, () => []);
    const listedD: number[][] = Array.from({ length: P }, () => []);
    for (let i = 0; i < B; i++) {
        for (let k = 0; k < cand[i].length; k++) {
            listedBins[cand[i][k]].push(i);
            listedD[cand[i][k]].push(candD[i][k]);
        }
    }

    // the ideal set: every bin's nearest paint
    const chosen = new Uint8Array(P);
    let chosenCount = 0;
    for (let i = 0; i < B; i++) {
        if (!chosen[cand[i][0]]) { chosen[cand[i][0]] = 1; chosenCount++; }
    }

    // best and second-best chosen paint of each bin
    const best = new Int32Array(B);
    const bestD = new Float64Array(B);
    const second = new Int32Array(B);
    const secondD = new Float64Array(B);
    /** Nearest chosen paint over the whole palette, when none of the bin's candidates is chosen any more (rare) */
    const nearestChosen = (i: number, skip: number): [number, number] => {
        const l = labs[i];
        const near: Array<[number, number]> = [];
        for (let c = 0; c < P; c++) {
            if (!chosen[c] || c === skip) { continue; }
            const q = paletteLab[c];
            near.push([(l[0] - q[0]) * (l[0] - q[0]) + (l[1] - q[1]) * (l[1] - q[1]) + (l[2] - q[2]) * (l[2] - q[2]), c]);
        }
        near.sort((a, b) => a[0] - b[0]);
        let j = -1;
        let d = Infinity;
        for (const [, c] of near.slice(0, 6)) {
            const e = deltaE2000(l, paletteLab[c]);
            if (e < d) { d = e; j = c; }
        }
        return [j, d];
    };
    const refresh = (i: number) => {
        let k1 = -1;
        let k2 = -1;
        for (let k = 0; k < cand[i].length; k++) {
            if (chosen[cand[i][k]]) {
                if (k1 < 0) { k1 = k; } else { k2 = k; break; }
            }
        }
        if (k1 >= 0) {
            best[i] = cand[i][k1];
            bestD[i] = candD[i][k1];
        } else {
            [best[i], bestD[i]] = nearestChosen(i, -1);
        }
        if (k2 >= 0) {
            second[i] = cand[i][k2];
            secondD[i] = candD[i][k2];
        } else {
            [second[i], secondD[i]] = chosenCount > 1 ? nearestChosen(i, best[i]) : [-1, 1e6];
        }
    };
    for (let i = 0; i < B; i++) { refresh(i); }

    // 3. greedy elimination: removing paint j moves its bins to their second-best paint
    const removal = new Float64Array(P);
    const byBest: number[][] = Array.from({ length: P }, () => []);
    const bySecond: number[][] = Array.from({ length: P }, () => []);
    const rebuild = () => {
        removal.fill(0);
        for (let j = 0; j < P; j++) { byBest[j].length = 0; bySecond[j].length = 0; }
        for (let i = 0; i < B; i++) {
            removal[best[i]] += weight[i] * (secondD[i] - bestD[i]);
            byBest[best[i]].push(i);
            if (second[i] >= 0) { bySecond[second[i]].push(i); }
        }
    };
    rebuild();
    while (chosenCount > n) {
        let drop = -1;
        let dropCost = Infinity;
        for (let j = 0; j < P; j++) {
            if (chosen[j] && removal[j] < dropCost) { dropCost = removal[j]; drop = j; }
        }
        chosen[drop] = 0;
        chosenCount--;
        const touched = new Set<number>(byBest[drop].concat(bySecond[drop]));
        touched.forEach((i) => {
            removal[best[i]] -= weight[i] * (secondD[i] - bestD[i]);
            refresh(i);
            removal[best[i]] += weight[i] * (secondD[i] - bestD[i]);
            byBest[best[i]].push(i);
            if (second[i] >= 0) { bySecond[second[i]].push(i); }
        });
        // the lists keep stale entries (refresh is idempotent): prune them now and then
        if (chosenCount % 16 === 0) { rebuild(); }
    }

    // 4. swap refinement: try the unchosen paints that are the nearest paint of a chosen paint's own colors
    for (let round = 0; round < 2; round++) {
        let improved = false;
        rebuild();
        for (let j = 0; j < P; j++) {
            if (!chosen[j]) { continue; }
            const own = byBest[j].filter((i) => best[i] === j);
            const optionWeight = new Map<number, number>();
            for (const i of own) {
                const c = cand[i][0];
                if (!chosen[c]) { optionWeight.set(c, (optionWeight.get(c) || 0) + weight[i]); }
            }
            const options = Array.from(optionWeight.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] - b[0])).slice(0, 6).map((e) => e[0]);
            for (const o of options) {
                chosen[j] = 0;
                chosen[o] = 1;
                const affected = new Set<number>(own);
                const lb = listedBins[o];
                const ld = listedD[o];
                for (let q = 0; q < lb.length; q++) {
                    if (ld[q] < bestD[lb[q]]) { affected.add(lb[q]); }
                }
                const saved: Array<[number, number, number, number, number]> = [];
                let delta = 0;
                affected.forEach((i) => {
                    saved.push([i, best[i], bestD[i], second[i], secondD[i]]);
                    const before = bestD[i];
                    refresh(i);
                    delta += weight[i] * (bestD[i] - before);
                });
                if (delta < -1e-6) {
                    improved = true;
                    break;
                }
                chosen[o] = 0;
                chosen[j] = 1;
                for (const [i, b1, d1, b2, d2] of saved) {
                    best[i] = b1; bestD[i] = d1; second[i] = b2; secondD[i] = d2;
                }
            }
        }
        if (!improved) { break; }
    }

    // exact count: with fewer paints than asked (a simple image needs fewer paints), the extra paints go where they
    // change the picture least: each one to the color (among paints that keep other colors) whose move to its
    // nearest unused paint adds the least error, i.e. small, rare colors, never a large area
    if (options.exactCount) {
        const binsOf = new Map<number, number>();
        for (let i = 0; i < B; i++) { binsOf.set(best[i], (binsOf.get(best[i]) || 0) + 1); }
        let used = binsOf.size;
        while (used < n) {
            let pick = -1;
            let pickPaint = -1;
            let pickD = 0;
            let pickCost = Infinity;
            for (let i = 0; i < B; i++) {
                if ((binsOf.get(best[i]) || 0) < 2) { continue; }
                let k = 0;
                while (k < cand[i].length && binsOf.has(cand[i][k])) { k++; }
                if (k === cand[i].length) { continue; }
                const added = weight[i] * (candD[i][k] - bestD[i]);
                if (added < pickCost) { pickCost = added; pick = i; pickPaint = cand[i][k]; pickD = candD[i][k]; }
            }
            if (pick < 0) { break; } // fewer distinct colors than paints asked
            binsOf.set(best[pick], binsOf.get(best[pick])! - 1);
            best[pick] = pickPaint;
            bestD[pick] = pickD;
            binsOf.set(pickPaint, 1);
            used++;
        }
    }

    // 5. every pixel takes its bin's paint
    const paintOfPixel = new Int32Array(pixels);
    const pixelsPerPaint = new Map<number, number>();
    for (let p = 0; p < pixels; p++) {
        const paint = best[binOfPixel[p]];
        paintOfPixel[p] = paint;
        pixelsPerPaint.set(paint, (pixelsPerPaint.get(paint) || 0) + 1);
    }
    const paints = Array.from(pixelsPerPaint.keys()).sort((a, b) => (pixelsPerPaint.get(b)! - pixelsPerPaint.get(a)!) || (a - b));
    return { paintOfPixel, paints, pixelsPerPaint };
}

/**
 * Whether the image is an artwork already painted with the palette's paints (it is then matched as is, without
 * tone correction): most of its pixels are within a small distance of a paint. Near rather than exact, because the
 * website's crop re-encodes the image as JPEG, which shifts every color slightly. Photos stay far below.
 */
export function isPaintedWithPalette(data: Pixels, channels: number, palette: RGB[], share: number = 0.55, tolerance: number = 3): boolean {
    const labs = palette.map((c) => rgb2lab(c));
    const pixels = Math.floor(data.length / channels);
    const step = Math.max(1, Math.floor(pixels / 20000));
    const limit = tolerance * tolerance;
    let total = 0;
    let painted = 0;
    for (let p = 0; p < pixels; p += step) {
        const o = p * channels;
        const l = rgb2lab([data[o], data[o + 1], data[o + 2]]);
        total++;
        for (const q of labs) {
            const d = (l[0] - q[0]) * (l[0] - q[0]) + (l[1] - q[1]) * (l[1] - q[1]) + (l[2] - q[2]) * (l[2] - q[2]);
            if (d < limit) { painted++; break; }
        }
    }
    return total > 0 && painted / total >= share;
}

export interface ToneCorrection {
    applied: boolean;
    /** Luminance mapped to black, and to white */
    blackPoint: number;
    whitePoint: number;
    /** Whether a slight color cast of the whites was neutralised */
    neutralised: boolean;
}

/**
 * White and black point of a photo: the photo's whites are rarely paint-white (a white wall or marble sits around
 * 90-95% lightness, nearer to a light grey paint) and its blacks rarely paint-black.
 * - the brightest 0.5% become white when they are light enough to be meant as white
 * - the darkest 0.5% become black only when they already are nearly black (a dark grey smoke keeps its tone)
 * - only the highlights and the shadows move: the mid-tones are left as they are
 * - a slight color cast of the whites is neutralised only when they are near-neutral (a yellow fire or a blue sky
 *   stays as it is)
 * Works in place on RGB or RGBA data.
 */
export function correctTones(data: Pixels, channels: number): ToneCorrection {
    const pixels = Math.floor(data.length / channels);
    const result: ToneCorrection = { applied: false, blackPoint: 0, whitePoint: 255, neutralised: false };
    if (pixels === 0) { return result; }
    const lum = new Uint8Array(pixels);
    const hist = new Uint32Array(256);
    for (let p = 0, o = 0; p < pixels; p++, o += channels) {
        const v = Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
        lum[p] = v;
        hist[v]++;
    }
    const tail = pixels * 0.005;
    let acc = 0;
    let low = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tail) { low = v; break; } }
    acc = 0;
    let high = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tail) { high = v; break; } }

    // only stretch what is meant as white / black: a dim or a hazy picture keeps its tones
    const blackPoint = low <= 20 ? low : 0;
    const whitePoint = high >= 190 ? high : 255;

    // the whites' color: neutralised when it is only a slight cast
    let wr = 0;
    let wg = 0;
    let wb = 0;
    let wn = 0;
    for (let p = 0, o = 0; p < pixels; p++, o += channels) {
        if (lum[p] >= high) { wr += data[o]; wg += data[o + 1]; wb += data[o + 2]; wn++; }
    }
    const gains = [1, 1, 1];
    if (wn > 0 && high >= 190) {
        const white = [wr / wn, wg / wn, wb / wn];
        const lab = rgb2lab(white);
        const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
        if (chroma > 0.5 && chroma < 12) {
            const mean = (white[0] + white[1] + white[2]) / 3;
            for (let c = 0; c < 3; c++) { gains[c] = mean / Math.max(1, white[c]); }
            result.neutralised = true;
        }
    }
    if (blackPoint === 0 && whitePoint === 255 && !result.neutralised) { return result; }

    // the curve only moves the tones above the high knee (toward white) and below the low knee (toward black)
    const kneeHigh = Math.max(128, whitePoint - 48);
    const kneeLow = Math.min(100, blackPoint + 40);
    const curve = (v: number) => {
        if (whitePoint < 255 && v > kneeHigh) {
            return kneeHigh + (v - kneeHigh) * (255 - kneeHigh) / Math.max(1, whitePoint - kneeHigh);
        }
        if (blackPoint > 0 && v < kneeLow) {
            return v <= blackPoint ? 0 : (v - blackPoint) * kneeLow / (kneeLow - blackPoint);
        }
        return v;
    };
    // the curve applies to the pixel's luminance and its channels are scaled together, never past 255: a bright
    // saturated color keeps its hue
    const factor = new Float64Array(256);
    for (let v = 1; v < 256; v++) { factor[v] = curve(v) / v; }
    for (let o = 0; o < pixels * channels; o += channels) {
        const r = data[o] * gains[0];
        const g = data[o + 1] * gains[1];
        const b = data[o + 2] * gains[2];
        const l = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
        // never past 255 on the brightest channel: a clipped channel would change the hue (a peach turning cream)
        const f = l === 0 ? 0 : Math.min(factor[l], 255 / Math.max(1, r, g, b));
        data[o] = Math.max(0, Math.min(255, Math.round(r * f)));
        data[o + 1] = Math.max(0, Math.min(255, Math.round(g * f)));
        data[o + 2] = Math.max(0, Math.min(255, Math.round(b * f)));
    }
    result.applied = true;
    result.blackPoint = blackPoint;
    result.whitePoint = whitePoint;
    return result;
}
