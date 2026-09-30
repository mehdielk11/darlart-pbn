/**
 * Number layout of the callout template. Every number is written as large as its region allows without touching
 * the region's outline; the regions too small to hold a readable number get a callout instead: a dot in the region
 * and a thin leader line to the number, written at a readable size in free space nearby (inside a single larger
 * region, away from the other numbers and leader lines).
 *
 * Everything is computed in image pixel coordinates.
 */
import { RGB } from "../common";
import { FacetResult, Facet } from "../facetmanagement";
import { buildSvgString, getFacetOutline, labelColorFor, SvgOptions } from "./svg";

export interface CalloutPoint { x: number; y: number; }

/** A number written inside its own region */
export interface InlineLabel {
    facetId: number;
    /** Center of the number */
    center: CalloutPoint;
    /** Font size, in image pixels */
    fontSize: number;
}

export interface LabelCallout {
    facetId: number;
    /** The dot, inside the small region, clear of its outline */
    anchor: CalloutPoint;
    /** Radius of the dot, in image pixels */
    dotRadius: number;
    /** Center of the number */
    text: CalloutPoint;
    /** End of the leader line, on the edge of the number's box */
    lineEnd: CalloutPoint;
    /** Font size of the number, in image pixels */
    fontSize: number;
    /** The region the number is written in (to pick a readable color on it) */
    hostFacetId: number;
}

export interface LabelLayout {
    labels: Map<number, InlineLabel>;
    callouts: Map<number, LabelCallout>;
}

export interface CalloutOptions {
    /** A region that can't hold its number at this size (share of the image's long side) gets a callout, when
     *  there is room for one right next to it; otherwise it keeps its small number (default 0.004) */
    minFontRatio?: number;
    /** Largest callout number, as a share of the image's long side (default 0.0078): each callout is as large as
     *  the room next to its region allows, from this size down to the smallest number */
    calloutFontRatio?: number;
    /** Largest number in a region, as a share of the image's long side (default 0.015) */
    maxFontRatio?: number;
    /** Free space kept between a number and its region's outline, in image pixels (default 0.35) */
    borderMargin?: number;
    /** Longest distance between a callout number and its region, in callout font sizes (default 2.5): the
     *  number goes to the nearest spot where it fits, never far away where it would read as another region's */
    maxLeaderLength?: number;
}

/**
 * Share of the font size a digit takes in width, and the digits' height: Helvetica (the PDF font, digits 0.556 wide
 * and 0.71 high) with a little slack. Tahoma is about the same; DejaVu Sans, wider, can come closer to the outlines.
 */
const DIGIT_WIDTH = 0.57;
const DIGIT_HEIGHT = 0.72;
/** Baseline offset that centers the digits vertically on a point (half the digit height) */
export const DIGIT_BASELINE_OFFSET = 0.36;

interface Rect { minX: number; minY: number; maxX: number; maxY: number; }
interface Segment { a: CalloutPoint; b: CalloutPoint; }

function labelCenter(f: Facet): CalloutPoint {
    return { x: f.labelBounds.minX + f.labelBounds.width / 2, y: f.labelBounds.minY + f.labelBounds.height / 2 };
}

function textRect(center: CalloutPoint, digits: number, fontSize: number, pad: number): Rect {
    const halfW = DIGIT_WIDTH * fontSize * digits / 2 + pad;
    const halfH = DIGIT_HEIGHT * fontSize / 2 + pad;
    return { minX: center.x - halfW, minY: center.y - halfH, maxX: center.x + halfW, maxY: center.y + halfH };
}

function rectsOverlap(a: Rect, b: Rect) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function segmentsCross(p: Segment, q: Segment) {
    const cross = (o: CalloutPoint, a: CalloutPoint, b: CalloutPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const d1 = cross(q.a, q.b, p.a);
    const d2 = cross(q.a, q.b, p.b);
    const d3 = cross(p.a, p.b, q.a);
    const d4 = cross(p.a, p.b, q.b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentHitsRect(s: Segment, r: Rect) {
    const inside = (p: CalloutPoint) => p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
    if (inside(s.a) || inside(s.b)) { return true; }
    const corners = [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }];
    for (let i = 0; i < 4; i++) {
        if (segmentsCross(s, { a: corners[i], b: corners[(i + 1) % 4] })) { return true; }
    }
    return false;
}

/** Where the segment from the rect's center toward `from` leaves the rect */
function rectExitPoint(center: CalloutPoint, r: Rect, from: CalloutPoint): CalloutPoint {
    const dx = from.x - center.x;
    const dy = from.y - center.y;
    const halfW = (r.maxX - r.minX) / 2;
    const halfH = (r.maxY - r.minY) / 2;
    const t = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity, 1);
    return { x: center.x + dx * t, y: center.y + dy * t };
}

/** Simple bucket grid so the collision checks only look at nearby rects and segments */
class Grid<T> {
    private cells = new Map<number, T[]>();
    constructor(private cellSize: number) { }
    private key(cx: number, cy: number) { return cy * 100003 + cx; }
    public add(r: Rect, item: T) {
        for (let cy = Math.floor(r.minY / this.cellSize); cy <= Math.floor(r.maxY / this.cellSize); cy++) {
            for (let cx = Math.floor(r.minX / this.cellSize); cx <= Math.floor(r.maxX / this.cellSize); cx++) {
                const k = this.key(cx, cy);
                const cell = this.cells.get(k);
                if (cell) { cell.push(item); } else { this.cells.set(k, [item]); }
            }
        }
    }
    /** Whether an item near r matches (items spanning several cells may be tested more than once) */
    public some(r: Rect, predicate: (item: T) => boolean): boolean {
        for (let cy = Math.floor(r.minY / this.cellSize); cy <= Math.floor(r.maxY / this.cellSize); cy++) {
            for (let cx = Math.floor(r.minX / this.cellSize); cx <= Math.floor(r.maxX / this.cellSize); cx++) {
                const cell = this.cells.get(this.key(cx, cy));
                if (cell) {
                    for (const item of cell) {
                        if (predicate(item)) { return true; }
                    }
                }
            }
        }
        return false;
    }
    public query(r: Rect): Set<T> {
        const found = new Set<T>();
        for (let cy = Math.floor(r.minY / this.cellSize); cy <= Math.floor(r.maxY / this.cellSize); cy++) {
            for (let cx = Math.floor(r.minX / this.cellSize); cx <= Math.floor(r.maxX / this.cellSize); cx++) {
                const cell = this.cells.get(this.key(cx, cy));
                if (cell) { for (const item of cell) { found.add(item); } }
            }
        }
        return found;
    }
}

function polygonArea(polygon: CalloutPoint[]) {
    let area = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
    }
    return Math.abs(area / 2);
}

/** Even-odd ray casting */
function pointInPolygon(p: CalloutPoint, polygon: CalloutPoint[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

function pointSegmentDistance(p: CalloutPoint, s: Segment) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

function segmentBounds(s: Segment): Rect {
    return { minX: Math.min(s.a.x, s.b.x), minY: Math.min(s.a.y, s.b.y), maxX: Math.max(s.a.x, s.b.x), maxY: Math.max(s.a.y, s.b.y) };
}

/**
 * Largest number that fits in each region, measured against the outlines as they are drawn, then a callout for
 * every region whose number would stay below the readable size. Numbers never touch or cross an outline.
 *
 * A callout number goes to the nearest spot around its region where it fits (measured from the region itself, the
 * dot being put on the region's point nearest to the number), at the callout size or a little smaller, never
 * further than a short reach. A neighbouring region's own number may move or shrink a little to make room for it.
 */
export function computeLabelLayout(facetResult: FacetResult, options: CalloutOptions = {}): LabelLayout {
    const labels = new Map<number, InlineLabel>();
    const callouts = new Map<number, LabelCallout>();
    const longSide = Math.max(facetResult.width, facetResult.height);
    const minFont = longSide * (options.minFontRatio !== undefined ? options.minFontRatio : 0.004);
    const calloutFont = Math.max(minFont, longSide * (options.calloutFontRatio !== undefined ? options.calloutFontRatio : 0.0078));
    const maxFont = Math.max(calloutFont, longSide * (options.maxFontRatio !== undefined ? options.maxFontRatio : 0.015));
    const margin = options.borderMargin !== undefined ? options.borderMargin : 0.35;
    const maxReach = calloutFont * (options.maxLeaderLength !== undefined ? options.maxLeaderLength : 2.5);
    const { facetMap, width, height } = facetResult;

    const facets = facetResult.facets.filter((f): f is Facet => f != null && f.borderSegments.length > 0 && f.labelBounds != null);

    // every outline as drawn (straight lines between the outline points), to measure the free room around a number
    const outlines = new Grid<Segment>(8);
    const outlineOf = new Map<number, CalloutPoint[]>();
    const outlineArea = new Map<number, number>();
    for (const f of facets) {
        const outline = getFacetOutline(f);
        outlineOf.set(f.id, outline);
        outlineArea.set(f.id, polygonArea(outline));
        for (let i = 1; i < outline.length; i++) {
            const s = { a: outline[i - 1], b: outline[i] };
            outlines.add(segmentBounds(s), s);
        }
    }
    const crossesOutline = (r: Rect) => outlines.some(r, (s) => segmentHitsRect(s, r));
    const insideImage = (r: Rect) => r.minX >= 0 && r.minY >= 0 && r.maxX <= width - 1 && r.maxY <= height - 1;
    const regionAt = (c: CalloutPoint) => facetMap.get(Math.max(0, Math.min(width - 1, Math.round(c.x))), Math.max(0, Math.min(height - 1, Math.round(c.y))));
    /**
     * Whether p lies inside region f as it is drawn: inside its outline and not inside a smaller neighbouring
     * region enclosed by it (an outline is the region's outer border, a region can enclose others). The pixel map
     * alone isn't enough: near a border the drawn (smoothed) outline and the pixels can disagree by a pixel, which
     * put dots just outside their region.
     */
    const insideRegion = (f: Facet, p: CalloutPoint): boolean => {
        if (!pointInPolygon(p, outlineOf.get(f.id)!)) { return false; }
        const area = outlineArea.get(f.id)!;
        for (const n of f.neighbourFacets || []) {
            const g = facetResult.facets[n];
            const outline = outlineOf.get(n);
            if (g && outline && outlineArea.get(n)! < area && p.x >= g.bbox.minX - 1 && p.x <= g.bbox.maxX + 1 && p.y >= g.bbox.minY - 1 && p.y <= g.bbox.maxY + 1 &&
                pointInPolygon(p, outline)) {
                return false;
            }
        }
        return true;
    };
    /** The region p lies in, as drawn (-1 if none is found) */
    const regionContaining = (p: CalloutPoint): number => {
        const f = facetResult.facets[regionAt(p)];
        if (!f || !outlineOf.has(f.id)) { return -1; }
        if (insideRegion(f, p)) { return f.id; }
        for (const n of f.neighbourFacets || []) {
            const g = facetResult.facets[n];
            if (g && outlineOf.has(n) && insideRegion(g, p)) { return n; }
        }
        return -1;
    };

    /**
     * Largest number that fits in region f (its box, grown by the margin, inside the region without touching any
     * outline nor anything `blocked` reports): best of the pole of inaccessibility and a coarse grid of points over
     * the region, then a hill climb while a slightly larger number fits nearby.
     */
    const fitRegion = (f: Facet, blocked: ((r: Rect) => boolean) | null = null) => {
        const digits = String(f.color + 1).length;
        const fits = (c: CalloutPoint, fs: number) => {
            const r = textRect(c, digits, fs, margin);
            return insideImage(r) && !crossesOutline(r) && insideRegion(f, c) && !(blocked && blocked(r));
        };
        const largestAt = (c: CalloutPoint, lower: number) => {
            if (lower === 0 && !fits(c, 0.05)) { return 0; }
            let lo = lower;
            let hi = maxFont;
            if (fits(c, hi)) { return hi; }
            while (hi - lo > 0.05) {
                const mid = (lo + hi) / 2;
                if (fits(c, mid)) { lo = mid; } else { hi = mid; }
            }
            return lo;
        };
        let center = labelCenter(f);
        let size = largestAt(center, 0);
        const b = f.bbox;
        const step = Math.max(1, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 6);
        for (let y = b.minY + step / 2; y <= b.maxY; y += step) {
            for (let x = b.minX + step / 2; x <= b.maxX; x += step) {
                const c = { x, y };
                if (fits(c, size + 0.05)) {
                    center = c;
                    size = largestAt(c, size + 0.05);
                }
            }
        }
        let move = Math.max(1, size * 0.5);
        while (move >= 0.2 && size < maxFont) {
            let moved = false;
            for (let d = 0; d < 8 && !moved; d++) {
                const angle = d * Math.PI / 4;
                const c = { x: center.x + Math.round(Math.cos(angle)) * move, y: center.y + Math.round(Math.sin(angle)) * move };
                if (fits(c, size + 0.05)) {
                    center = c;
                    size = largestAt(c, size + 0.05);
                    moved = true;
                }
            }
            if (!moved) { move /= 2; }
        }
        return { center, size };
    };

    /** Distance from p to the nearest outline, up to `limit` */
    const clearance = (p: CalloutPoint, limit: number) => {
        let best = limit;
        outlines.some({ minX: p.x - limit, minY: p.y - limit, maxX: p.x + limit, maxY: p.y + limit }, (s) => {
            best = Math.min(best, pointSegmentDistance(p, s));
            return false;
        });
        return best;
    };
    const dotRadius = minFont * 0.22;
    /**
     * Where the dot can go in region f: points whose dot, plus the margin, stays clear of every outline. In a region
     * too thin for that, the points with the most room, and a dot shrunk to fit them.
     */
    const dotSpots = (f: Facet): { points: CalloutPoint[]; radius: number } => {
        const b = f.bbox;
        const step = Math.max(0.25, Math.min(1, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 40));
        const scored: { p: CalloutPoint; room: number }[] = [];
        for (let y = b.minY - 0.5; y <= b.maxY + 0.5; y += step) {
            for (let x = b.minX - 0.5; x <= b.maxX + 0.5; x += step) {
                const p = { x, y };
                if (!insideRegion(f, p)) { continue; }
                scored.push({ p, room: clearance(p, dotRadius + margin) });
            }
        }
        if (scored.length === 0) {
            // a sliver thinner than the sampling step: sample it finely
            for (let y = b.minY - 0.5; y <= b.maxY + 0.5; y += 0.1) {
                for (let x = b.minX - 0.5; x <= b.maxX + 0.5; x += 0.1) {
                    const p = { x, y };
                    if (insideRegion(f, p)) { scored.push({ p, room: clearance(p, dotRadius + margin) }); }
                }
            }
        }
        if (scored.length === 0) { return { points: [labelCenter(f)], radius: 0 }; }
        const roomy = scored.filter((s) => s.room >= dotRadius + margin);
        // a few hundred spots are plenty to find the one nearest to the number
        const thin = (list: CalloutPoint[]) => list.length <= 200 ? list : list.filter((_, i) => i % Math.ceil(list.length / 200) === 0);
        if (roomy.length > 0) { return { points: thin(roomy.map((s) => s.p)), radius: dotRadius }; }
        const most = Math.max(...scored.map((s) => s.room));
        return { points: thin(scored.filter((s) => s.room >= most * 0.95).map((s) => s.p)), radius: Math.max(most - margin, most * 0.5) };
    };

    const small: Facet[] = [];
    const smallIds = new Set<number>();
    for (const f of facets) {
        const fit = fitRegion(f);
        labels.set(f.id, { facetId: f.id, center: fit.center, fontSize: fit.size });
        if (fit.size < minFont) {
            small.push(f);
            smallIds.add(f.id);
        }
    }
    if (small.length === 0) { return { labels, callouts }; }

    /** Numbers on the page: a region's own number (owner = its id, it may move to make room) or a callout number (-1) */
    interface Placed { rect: Rect; owner: number; alive: boolean; }
    const texts = new Grid<Placed>(calloutFont * 4);
    const leaders = new Grid<Segment>(calloutFont * 4);
    const inlineText = new Map<number, Placed>();
    const addInline = (f: Facet) => {
        const label = labels.get(f.id)!;
        const placed = { rect: textRect(label.center, String(f.color + 1).length, label.fontSize, 0), owner: f.id, alive: true };
        texts.add(placed.rect, placed);
        inlineText.set(f.id, placed);
    };
    for (const f of facets) {
        if (!smallIds.has(f.id)) { addInline(f); }
    }
    const aliveTexts = (r: Rect) => [...texts.query(r)].filter((o) => o.alive && rectsOverlap(o.rect, r));

    // the smallest regions first: they have the fewest options
    small.sort((a, b) => labels.get(a.id)!.fontSize - labels.get(b.id)!.fontSize);
    const gridStep = calloutFont * 0.3;

    /** Places the callout of region f at the nearest spot where one of `fonts` fits (the largest first) */
    const placeRegion = (f: Facet, fonts: number[]) => {
        const digits = String(f.color + 1).length;
        const { points, radius: dotSize } = dotSpots(f);
        const nearest = (c: CalloutPoint) => {
            let best = points[0];
            let bestDist = Infinity;
            for (const p of points) {
                const d = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y);
                if (d < bestDist) { bestDist = d; best = p; }
            }
            return { point: best, dist: Math.sqrt(bestDist) };
        };

        // candidate spots for the number around the region, nearest first
        const b = f.bbox;
        const candidates: { center: CalloutPoint; dot: CalloutPoint; dist: number }[] = [];
        for (let y = b.minY - maxReach; y <= b.maxY + maxReach; y += gridStep) {
            for (let x = b.minX - maxReach; x <= b.maxX + maxReach; x += gridStep) {
                const center = { x, y };
                const n = nearest(center);
                if (n.dist <= maxReach) { candidates.push({ center, dot: n.point, dist: n.dist }); }
            }
        }
        candidates.sort((p, q) => p.dist - q.dist);

        interface Choice { score: number; callout: LabelCallout; rect: Rect; leader: Segment; moves: { facet: Facet; center: CalloutPoint; size: number }[]; }
        let best: Choice | null = null;
        // moving neighbouring numbers is costly: a limited number of tries per region
        let refits = 30;
        for (const cand of candidates) {
            // the score only grows with the distance: nothing further can beat the best spot found
            if (best != null && cand.dist >= best.score) { break; }
            for (const font of fonts) {
                const score = cand.dist + (calloutFont - font) * 1.5;
                if (best != null && score >= best.score) { break; }
                const center = cand.center;
                const rect = textRect(center, digits, font, font * 0.12 + margin);
                if (!insideImage(rect) || crossesOutline(rect)) { continue; }
                const host = regionContaining(center);
                if (host < 0) { continue; }
                if (smallIds.has(host)) { continue; }
                if (leaders.some(rect, (s) => segmentHitsRect(s, rect))) { continue; }
                const conflicts = aliveTexts(rect);
                if (conflicts.some((o) => o.owner < 0)) { continue; }

                const lineEnd = rectExitPoint(center, textRect(center, digits, font, font * 0.1), cand.dot);
                // a short line stays visible between the dot and the number
                if (Math.hypot(lineEnd.x - cand.dot.x, lineEnd.y - cand.dot.y) < dotSize + font * 0.45) { continue; }
                const leader = { a: cand.dot, b: lineEnd };
                const bounds = segmentBounds(leader);
                if (leaders.some(bounds, (s) => segmentsCross(s, leader))) { continue; }
                // the leader never runs through a callout number, and through a region's number only if it moves away
                const crossed = [...texts.query(bounds)].filter((o) => o.alive && segmentHitsRect(leader, o.rect));
                if (crossed.some((o) => o.owner < 0)) { continue; }

                // the numbers in the way move (or shrink a little) within their own region to make room
                const movers = new Set<number>([...conflicts, ...crossed].map((o) => o.owner));
                if (movers.size > 0 && refits <= 0) { continue; }
                refits -= movers.size;
                const blocked = (r: Rect) => rectsOverlap(r, rect) || segmentHitsRect(leader, r) ||
                    leaders.some(r, (s) => segmentHitsRect(s, r)) ||
                    texts.some(r, (o) => o.alive && o.owner < 0 && rectsOverlap(o.rect, r));
                const moves: Choice["moves"] = [];
                let penalty = 0;
                let possible = true;
                for (const owner of movers) {
                    const g = facetResult.facets[owner]!;
                    const old = labels.get(owner)!.fontSize;
                    const fit = fitRegion(g, blocked);
                    if (fit.size < Math.max(minFont, old * 0.6)) { possible = false; break; }
                    penalty += (old - fit.size) / old * calloutFont * 2 + calloutFont * 0.3;
                    moves.push({ facet: g, center: fit.center, size: fit.size });
                }
                if (!possible || (best != null && score + penalty >= best.score)) { continue; }
                best = {
                    score: score + penalty, rect, leader, moves,
                    callout: { facetId: f.id, anchor: cand.dot, dotRadius: dotSize, text: center, lineEnd, fontSize: font, hostFacetId: host },
                };
                break;
            }
        }

        if (best != null) {
            for (const move of best.moves) {
                inlineText.get(move.facet.id)!.alive = false;
                labels.set(move.facet.id, { facetId: move.facet.id, center: move.center, fontSize: move.size });
                addInline(move.facet);
            }
            callouts.set(f.id, best.callout);
            labels.delete(f.id);
            const placed = { rect: best.rect, owner: -1, alive: true };
            texts.add(best.rect, placed);
            leaders.add(segmentBounds(best.leader), best.leader);
        }
    };
    for (const f of small) {
        placeRegion(f, [0, 0.25, 0.5, 0.75, 1].map((t) => calloutFont - (calloutFont - minFont) * t));
    }
    // a region without a spot within reach keeps the largest number that fits in it
    return { labels, callouts };
}

/**
 * The blank template with callouts: grey outlines and black numbers on white (like buildBlankSvgString), every
 * number as large as its region allows, and the regions too small for a readable number get a dot and a leader
 * line to their number instead. Options are the SVG options (fill, colors, fonts...) plus the callout sizes;
 * the label font size setting doesn't apply here (the numbers are sized to their regions).
 */
export function buildCalloutSvgString(facetResult: FacetResult, colorsByIndex: RGB[], options: SvgOptions & CalloutOptions = {}): string {
    const svgOptions: SvgOptions = {
        strokeColor: "#6a6f77",
        fontColor: "#000000",
        background: "#ffffff",
        fill: false,
        stroke: true,
        ...options,
    };
    const m = svgOptions.sizeMultiplier !== undefined ? svgOptions.sizeMultiplier : 3;
    const fontColor = svgOptions.fontColor || "#000";
    const fontFamily = (svgOptions.fontFamily || "Tahoma").replace(/"/g, "'");
    const colorOn = (facetId: number) => {
        const f = facetResult.facets[facetId];
        return svgOptions.fill && svgOptions.labelContrast && f ? labelColorFor(colorsByIndex[f.color], fontColor) : fontColor;
    };
    // the digits are centered on the point with an explicit baseline: renderers disagree on dominant-baseline
    const text = (c: CalloutPoint, fontSize: number, fill: string, value: number) =>
        `<text x="${c.x * m}" y="${(c.y + fontSize * DIGIT_BASELINE_OFFSET) * m}" font-family="${fontFamily}" font-size="${fontSize * m}" text-anchor="middle" fill="${fill}">${value}</text>`;

    // the regions and outlines exactly as the other SVGs draw them, the numbers are added below
    const base = buildSvgString(facetResult, colorsByIndex, { ...svgOptions, labels: false });
    const layout = computeLabelLayout(facetResult, options);
    const parts: string[] = [base.substring(0, base.lastIndexOf("</svg>"))];

    for (const label of layout.labels.values()) {
        const f = facetResult.facets[label.facetId]!;
        parts.push(`<g class="label">${text(label.center, label.fontSize, colorOn(f.id), f.color + 1)}</g>`);
    }

    for (const c of layout.callouts.values()) {
        const f = facetResult.facets[c.facetId]!;
        const textColor = colorOn(c.hostFacetId);
        parts.push(`<g class="callout">` +
            `<line x1="${c.anchor.x * m}" y1="${c.anchor.y * m}" x2="${c.lineEnd.x * m}" y2="${c.lineEnd.y * m}" stroke="${textColor}" stroke-width="${c.fontSize * 0.07 * m}" stroke-linecap="round"></line>` +
            `<circle cx="${c.anchor.x * m}" cy="${c.anchor.y * m}" r="${c.dotRadius * m}" fill="${colorOn(c.facetId)}"></circle>` +
            text(c.text, c.fontSize, textColor, f.color + 1) +
            `</g>`);
    }

    parts.push("</svg>");
    return parts.join("");
}
