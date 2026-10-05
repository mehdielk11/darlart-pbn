/**
 * Paint bill of materials of a template: for each color, the area it covers on the canvas, its regions, the paint it
 * needs and the pots to pack. One pot of the same size for every color runs out on a large area (a sky, a black
 * background) and is mostly wasted on a tiny one: the pots follow the actual need instead.
 *
 * need (ml) = area / coverage x (1 + margin) + regions x ml per region x (canvas area / 40x50 area)
 * - coverage: cm² one ml of paint covers with the coats a painting needs. A thin brushed paint-by-numbers layer is
 *   far thinner than wall paint: commercial kits cover the largest color of a 40x50 canvas (300-400 cm²) with one
 *   3 ml pot, i.e. at least ~100 cm² per ml
 * - margin: a safety share on top, the customer must never run short
 * - per region: every small region costs a little extra paint (loading the brush, edges); the regions are the same on
 *   every canvas size but smaller on a small canvas, so this extra scales with the canvas area (set for a 40x50)
 * The pots are the combination that holds the need with the least surplus; above the largest size, several pots of
 * the same number.
 *
 * One template serves every canvas size sold (it is generated at 60x75 and printed at 40x50, 32x40, 20x25: the same
 * 4:5 shape), so each color's share of the canvas is the same on all of them: planPaintsForSizes gives each size its
 * own areas, paint and pots.
 */
import { FacetResult } from "../facetmanagement";

export interface PaintSettings {
    /** cm² covered by 1 ml of paint, all coats included (default 100, to be calibrated with the real paint) */
    coverageCm2PerMl: number;
    /** Safety margin on top of the need (default 0.1: 10%) */
    margin: number;
    /** Extra paint per region on a 40x50 canvas, scaled with the canvas area (default 0.002 ml: a color's regions
     *  are painted in one go, the brush is loaded once per dip) */
    mlPerRegion: number;
    /** Pot sizes that can be packed, in ml (default 3: Darl'Art kits use 3 ml pots only, several pots of the same number above 3 ml) */
    potSizesMl: number[];
    /** Canvas sizes sold, orientation-neutral (default 40x50, 32x40, 20x25): the paints page gives the pots for each */
    canvasSizes: string[];
}

/** The per-region extra is set for this canvas area (40x50) */
export const REGION_REFERENCE_CM2 = 40 * 50;

export const DEFAULT_PAINT_SETTINGS: PaintSettings = {
    coverageCm2PerMl: 100,
    margin: 0.1,
    mlPerRegion: 0.002,
    potSizesMl: [3],
    canvasSizes: ["40x50", "32x40", "20x25"],
};

export interface PaintPot {
    sizeMl: number;
    count: number;
}

export interface PaintNeed {
    /** Index of the color in colorsByIndex (the color's number is index + 1) */
    index: number;
    /** Area on the canvas */
    areaCm2: number;
    /** Share of the canvas, 0-100 */
    sharePercent: number;
    regions: number;
    /** Paint needed, margin included */
    ml: number;
    /** Pots to pack for this color (several pots of the same number when the need is above the largest size) */
    pots: PaintPot[];
    /** Paint packed in those pots */
    packedMl: number;
}

export interface PaintPlan {
    canvas: { widthCm: number; heightCm: number };
    /** "40x50" (width x height as printed) */
    label: string;
    /** False when the size's shape differs from the template's: the print is then cropped, the estimate approximate */
    sameShape: boolean;
    settings: PaintSettings;
    colors: PaintNeed[];
    totalMl: number;
    totalPackedMl: number;
    /** All the pots of the kit, by size */
    potsBySize: PaintPot[];
}

/** Reads the settings from text values (environment variables, request fields); a missing or invalid value keeps the default */
export function parsePaintSettings(values: { coverage?: string; margin?: string; perRegion?: string; potSizes?: string; canvasSizes?: string }): PaintSettings {
    const num = (value: string | undefined, fallback: number, min: number) => {
        const n = Number(value);
        return value !== undefined && value !== "" && isFinite(n) && n >= min ? n : fallback;
    };
    const sizes = (values.potSizes || "").split(/[\s,;]+/).map(Number).filter((n) => isFinite(n) && n > 0);
    // "40x50, 32x40; 20 x 25": comma or semicolon between sizes, a "." for decimals
    const canvases = (values.canvasSizes || "").split(/[,;]+/).map((c) => c.trim()).filter((c) => parseSize(c) !== null);
    return {
        coverageCm2PerMl: num(values.coverage, DEFAULT_PAINT_SETTINGS.coverageCm2PerMl, 1),
        margin: num(values.margin, DEFAULT_PAINT_SETTINGS.margin, 0),
        mlPerRegion: num(values.perRegion, DEFAULT_PAINT_SETTINGS.mlPerRegion, 0),
        potSizesMl: sizes.length ? sizes : DEFAULT_PAINT_SETTINGS.potSizesMl.slice(),
        canvasSizes: canvases.length ? canvases : DEFAULT_PAINT_SETTINGS.canvasSizes.slice(),
    };
}

/** "40x50" -> [40, 50] (centimetres), null when it isn't a size */
function parseSize(size: string): [number, number] | null {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(size || "");
    if (!m) { return null; }
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 0 && b > 0 ? [a, b] : null;
}

/**
 * The pots for a need: the combination of sizes that holds it with the least paint packed, then the fewest pots
 * (3.7 ml with 2, 2.5 and 3 ml pots: 2 × 2 ml, not 3 + 2 ml)
 */
export function potsFor(ml: number, potSizesMl: number[]): PaintPot[] {
    // in tenths of a ml, so 2.5 ml pots add up exactly
    const sizes = Array.from(new Set(potSizesMl.filter((s) => s > 0).map((s) => Math.max(1, Math.round(s * 10))))).sort((a, b) => a - b);
    if (!sizes.length) { return []; }
    const largest = sizes[sizes.length - 1];
    const need = Math.max(1, Math.ceil(ml * 10 - 1e-6));
    // fewest pots to pack exactly t tenths, for every t up to the need plus one largest pot
    const limit = need + largest;
    const potCount = new Array(limit + 1).fill(Infinity);
    const lastPot = new Array(limit + 1).fill(0);
    potCount[0] = 0;
    for (let t = 1; t <= limit; t++) {
        for (const s of sizes) {
            if (s <= t && potCount[t - s] + 1 < potCount[t]) {
                potCount[t] = potCount[t - s] + 1;
                lastPot[t] = s;
            }
        }
    }
    let t = need;
    while (potCount[t] === Infinity) { t++; }
    const pots = new Map<number, number>();
    for (; t > 0; t -= lastPot[t]) { pots.set(lastPot[t], (pots.get(lastPot[t]) || 0) + 1); }
    return Array.from(pots.entries()).sort((a, b) => b[0] - a[0]).map(([tenths, count]) => ({ sizeMl: tenths / 10, count }));
}

/** "20 ml + 10 ml", "2 × 20 ml" */
export function describePots(pots: PaintPot[]): string {
    return pots.map((p) => (p.count > 1 ? `${p.count} × ${p.sizeMl} ml` : `${p.sizeMl} ml`)).join(" + ");
}

export function planPaints(facetResult: FacetResult, colorCount: number, canvas: { widthCm: number; heightCm: number }, settings: PaintSettings = DEFAULT_PAINT_SETTINGS): PaintPlan {
    const pixels = new Array(colorCount).fill(0);
    const regions = new Array(colorCount).fill(0);
    let total = 0;
    for (const f of facetResult.facets) {
        if (f == null || f.color >= colorCount) { continue; }
        pixels[f.color] += f.pointCount;
        regions[f.color]++;
        total += f.pointCount;
    }
    const canvasCm2 = canvas.widthCm * canvas.heightCm;
    // rounded through an integer, so the JSON holds 657.9 and not 657.9000000000001
    const round = (v: number, step: number) => Math.round(v / step) / Math.round(1 / step);
    const colors: PaintNeed[] = [];
    for (let index = 0; index < colorCount; index++) {
        if (pixels[index] === 0) { continue; }
        const areaCm2 = total > 0 ? canvasCm2 * pixels[index] / total : 0;
        const ml = areaCm2 / settings.coverageCm2PerMl * (1 + settings.margin) + regions[index] * settings.mlPerRegion * canvasCm2 / REGION_REFERENCE_CM2;
        const pots = potsFor(ml, settings.potSizesMl);
        colors.push({
            index,
            areaCm2: round(areaCm2, 0.1),
            sharePercent: total > 0 ? round(100 * pixels[index] / total, 0.01) : 0,
            regions: regions[index],
            ml: round(ml, 0.1),
            pots,
            packedMl: pots.reduce((sum, p) => sum + p.sizeMl * p.count, 0),
        });
    }
    const potsBySize = new Map<number, number>();
    for (const c of colors) {
        for (const p of c.pots) { potsBySize.set(p.sizeMl, (potsBySize.get(p.sizeMl) || 0) + p.count); }
    }
    return {
        canvas: { widthCm: canvas.widthCm, heightCm: canvas.heightCm },
        label: `${canvas.widthCm}x${canvas.heightCm}`,
        sameShape: true,
        settings,
        colors,
        totalMl: round(colors.reduce((sum, c) => sum + c.ml, 0), 0.1),
        totalPackedMl: colors.reduce((sum, c) => sum + c.packedMl, 0),
        potsBySize: Array.from(potsBySize.entries()).sort((a, b) => b[0] - a[0]).map(([sizeMl, count]) => ({ sizeMl, count })),
    };
}

/**
 * One plan per canvas size sold (settings.canvasSizes), each turned like the template (portrait or landscape).
 * A size whose shape differs from the template's is still planned, marked sameShape: false.
 */
export function planPaintsForSizes(facetResult: FacetResult, colorCount: number, template: { widthCm: number; heightCm: number }, settings: PaintSettings = DEFAULT_PAINT_SETTINGS): PaintPlan[] {
    const portrait = template.heightCm >= template.widthCm;
    const aspect = template.widthCm / template.heightCm;
    const plans: PaintPlan[] = [];
    for (const size of settings.canvasSizes) {
        const parsed = parseSize(size);
        if (!parsed) { continue; }
        const short = Math.min(parsed[0], parsed[1]);
        const long = Math.max(parsed[0], parsed[1]);
        const canvas = portrait ? { widthCm: short, heightCm: long } : { widthCm: long, heightCm: short };
        const plan = planPaints(facetResult, colorCount, canvas, settings);
        plan.sameShape = Math.abs(canvas.widthCm / canvas.heightCm - aspect) / aspect < 0.01;
        plans.push(plan);
    }
    return plans;
}
