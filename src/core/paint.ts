/**
 * Paint bill of materials of a template: for each color, the area it covers on the canvas, its regions, the paint it
 * needs and the pots to pack. One pot of the same size for every color runs out on a large area (a sky, a black
 * background) and is mostly wasted on a tiny one: the pots follow the actual need instead.
 *
 * need (ml) = area / coverage x (1 + margin) + regions x ml per region
 * - coverage: cm² one ml of paint covers with the coats a painting needs. A thin brushed paint-by-numbers layer is
 *   far thinner than wall paint: commercial kits cover the largest color of a 40x50 canvas (300-400 cm²) with one
 *   3 ml pot, i.e. at least ~100 cm² per ml
 * - margin: a safety share on top, the customer must never run short
 * - per region: every small region costs a little extra paint (loading the brush, edges)
 * The pots are the smallest size that holds the need; above the largest size, several pots of the same number.
 */
import { FacetResult } from "../facetmanagement";

export interface PaintSettings {
    /** cm² covered by 1 ml of paint, all coats included (default 100, to be calibrated with the real paint) */
    coverageCm2PerMl: number;
    /** Safety margin on top of the need (default 0.1: 10%) */
    margin: number;
    /** Extra paint per region (default 0.002 ml: a color's regions are painted in one go, the brush is loaded once per dip) */
    mlPerRegion: number;
    /** Pot sizes that can be packed, in ml (default 3: Darl'Art kits use 3 ml pots only) */
    potSizesMl: number[];
}

export const DEFAULT_PAINT_SETTINGS: PaintSettings = {
    coverageCm2PerMl: 100,
    margin: 0.1,
    mlPerRegion: 0.002,
    potSizesMl: [3],
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
    settings: PaintSettings;
    colors: PaintNeed[];
    totalMl: number;
    totalPackedMl: number;
    /** All the pots of the kit, by size */
    potsBySize: PaintPot[];
}

/** Reads the settings from text values (environment variables, request fields); a missing or invalid value keeps the default */
export function parsePaintSettings(values: { coverage?: string; margin?: string; perRegion?: string; potSizes?: string }): PaintSettings {
    const num = (value: string | undefined, fallback: number, min: number) => {
        const n = Number(value);
        return value !== undefined && value !== "" && isFinite(n) && n >= min ? n : fallback;
    };
    const sizes = (values.potSizes || "").split(/[\s,;]+/).map(Number).filter((n) => isFinite(n) && n > 0);
    return {
        coverageCm2PerMl: num(values.coverage, DEFAULT_PAINT_SETTINGS.coverageCm2PerMl, 1),
        margin: num(values.margin, DEFAULT_PAINT_SETTINGS.margin, 0),
        mlPerRegion: num(values.perRegion, DEFAULT_PAINT_SETTINGS.mlPerRegion, 0),
        potSizesMl: sizes.length ? sizes : DEFAULT_PAINT_SETTINGS.potSizesMl.slice(),
    };
}

/** The pots for a need: the largest size as many times as needed, then the smallest size that holds the rest */
export function potsFor(ml: number, potSizesMl: number[]): PaintPot[] {
    const sizes = potSizesMl.filter((s) => s > 0).sort((a, b) => a - b);
    if (!sizes.length) { return []; }
    const largest = sizes[sizes.length - 1];
    const pots = new Map<number, number>();
    let rest = ml;
    while (rest > largest) {
        pots.set(largest, (pots.get(largest) || 0) + 1);
        rest -= largest;
    }
    const last = sizes.find((s) => s >= rest) || largest;
    pots.set(last, (pots.get(last) || 0) + 1);
    return Array.from(pots.entries()).sort((a, b) => b[0] - a[0]).map(([sizeMl, count]) => ({ sizeMl, count }));
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
        const ml = areaCm2 / settings.coverageCm2PerMl * (1 + settings.margin) + regions[index] * settings.mlPerRegion;
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
        settings,
        colors,
        totalMl: round(colors.reduce((sum, c) => sum + c.ml, 0), 0.1),
        totalPackedMl: colors.reduce((sum, c) => sum + c.packedMl, 0),
        potsBySize: Array.from(potsBySize.entries()).sort((a, b) => b[0] - a[0]).map(([sizeMl, count]) => ({ sizeMl, count })),
    };
}
