/**
 * PDF output of a processed image, drawn as vector content straight from the facet data (no SVG parsing, no DOM),
 * so the website and the API produce the same document.
 *
 * buildPdf (the customer's "User PDF"): page 1 the finished painting (colors only), page 2 the painted template
 * (colors, outlines and numbers), page 3 the blank template with callouts, page 4+ the legend: numbers and colors only
 * buildPaintingPdf: page 1 colored with numbers, page 2 palette, then (with a paint plan) the paints and pots to pack
 *
 * jsPDF is passed in (window.jspdf.jsPDF in the browser, require("jspdf").jsPDF in Node).
 */
import { RGB } from "../common";
import { FacetResult } from "../facetmanagement";
import { buildPaletteEntries, groupPaletteEntries, PaletteEntry, PaletteRow } from "./palette";
import { getFacetOutline, getLabelFontSize, labelColorFor } from "./svg";
import { computeLabelLayout, DIGIT_BASELINE_OFFSET } from "./callouts";
import { describePots, PaintNeed, PaintPlan, PaintPot } from "./paint";

export type PaperSize = "a2" | "a3" | "a4" | "a5";
export const PAPER_SIZES: PaperSize[] = ["a2", "a3", "a4", "a5"];

export type JsPdfConstructor = new (options: { orientation: string; unit: string; format: string; compress?: boolean }) => any;

export interface PdfTemplate {
    facetResult: FacetResult;
    colorsByIndex: RGB[];
    colorCodes: { [key: string]: string };
}

export interface PdfOptions {
    paperSize?: PaperSize;
    /** Same multiplier as the SVG output, it only affects the stroke width relative to the facets */
    sizeMultiplier?: number;
    /** Label font size, in percentage of the label box (same as the SVG option) */
    fontSize?: number;
    /** Borders of the colored page */
    borderColor?: string;
    /** Borders of the painting guide's colored page: grey, so they guide without cutting up the artwork */
    outlineColor?: string;
    legendTitle?: string;
    /** Painting guide only: adds the production page of the paints and pots, one plan per canvas size sold (src/core/paint.ts) */
    paintPlans?: PaintPlan[];
    /** The file's reference (the product folder and the color count, "1097_36"), printed at the bottom of every page */
    reference?: string;
}

const PAGE_MARGIN = 36; // 0.5 inch

function hexToRgb(hex: string): RGB {
    const clean = hex.replace(/^#/, "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    return [parseInt(full.substring(0, 2), 16), parseInt(full.substring(2, 4), 16), parseInt(full.substring(4, 6), 16)];
}

/** Page setup shared by the PDFs: the template scaled and centered on the paper, with its facets ready to trace */
function layoutTemplate(JsPDF: JsPdfConstructor, template: PdfTemplate, options: PdfOptions) {
    const paperSize = options.paperSize || "a4";
    const sizeMultiplier = options.sizeMultiplier || 3;
    const fontSize = options.fontSize || 50;
    const borderColor = hexToRgb(options.borderColor || "#000000");
    const outlineColor = hexToRgb(options.outlineColor || "#6a6f77");
    const { facetResult, colorsByIndex } = template;

    // Template geometry in SVG units (image pixels * multiplier) with a small padding so strokes aren't clipped at the edges
    const svgWidth = facetResult.width * sizeMultiplier;
    const svgHeight = facetResult.height * sizeMultiplier;
    const pad = Math.max(2, Math.min(svgWidth, svgHeight) * 0.01);
    const paddedWidth = svgWidth + pad * 2;
    const paddedHeight = svgHeight + pad * 2;

    // compress: the vector outlines of hundreds of facets are several MB uncompressed
    const doc = new JsPDF({ orientation: paddedWidth > paddedHeight ? "landscape" : "portrait", unit: "pt", format: paperSize, compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const scale = Math.min((pageWidth - PAGE_MARGIN * 2) / paddedWidth, (pageHeight - PAGE_MARGIN * 2) / paddedHeight);
    const offsetX = (pageWidth - paddedWidth * scale) / 2;
    const offsetY = (pageHeight - paddedHeight * scale) / 2;
    // image pixel coordinate → page coordinate
    const toPageX = (x: number) => offsetX + (x * sizeMultiplier + pad) * scale;
    const toPageY = (y: number) => offsetY + (y * sizeMultiplier + pad) * scale;
    const lineWidth = scale; // 1px stroke in SVG units

    const traceFacet = (outline: { x: number; y: number }[]) => {
        doc.moveTo(toPageX(outline[0].x), toPageY(outline[0].y));
        for (let i = 1; i < outline.length; i++) {
            doc.lineTo(toPageX(outline[i].x), toPageY(outline[i].y));
        }
        doc.close();
    };

    const drawableFacets = facetResult.facets.filter((f) => f != null && f.borderSegments.length > 0);

    /** Every facet's number, centered in its label box, the same way the SVG places it */
    const drawLabels = (color: RGB | "contrast") => {
        doc.setFont("helvetica", "normal");
        if (color !== "contrast") { doc.setTextColor(color[0], color[1], color[2]); }
        for (const f of drawableFacets) {
            const bounds = f!.labelBounds;
            // the label is centered in its box and scaled like the SVG viewBox "-50 -50 100 100" (meet)
            const boxScale = Math.min(bounds.width, bounds.height) * sizeMultiplier / 100;
            const labelSize = getLabelFontSize(f!, fontSize) * boxScale * scale;
            if (labelSize < 0.5) { continue; }
            if (color === "contrast") {
                // white on a dark region, dark on a light one
                doc.setTextColor(labelColorFor(colorsByIndex[f!.color], "#111111"));
            }
            doc.setFontSize(labelSize);
            doc.text(String(f!.color + 1), toPageX(bounds.minX + bounds.width / 2), toPageY(bounds.minY + bounds.height / 2), { align: "center", baseline: "middle" });
        }
    };

    /**
     * The colored template, one filled shape per facet, outlined in `border`. With `null` each shape is
     * stroked in its own color instead, the way the SVG does it, so no white seams show between the regions.
     */
    const drawColoredTemplate = (border: RGB | null = borderColor) => {
        doc.setLineJoin("round");
        doc.setLineWidth(lineWidth);
        if (border) {
            doc.setDrawColor(border[0], border[1], border[2]);
        }
        for (const f of drawableFacets) {
            const color = colorsByIndex[f!.color];
            doc.setFillColor(color[0], color[1], color[2]);
            if (!border) {
                doc.setDrawColor(color[0], color[1], color[2]);
            }
            traceFacet(getFacetOutline(f!));
            doc.fillStroke();
        }
    };

    /**
     * The blank template to paint on: grey outlines and black numbers on white, every number as large as its region
     * allows, and the regions too small for a readable number get a dot and a short line to it (see core/callouts.ts)
     */
    const drawCalloutTemplate = () => {
        const layout = computeLabelLayout(facetResult);
        const toPt = sizeMultiplier * scale; // image pixels → points
        doc.setLineJoin("round");
        doc.setLineWidth(lineWidth);
        doc.setDrawColor(outlineColor[0], outlineColor[1], outlineColor[2]);
        for (const f of drawableFacets) {
            traceFacet(getFacetOutline(f!));
            doc.stroke();
        }

        doc.setFont("helvetica", "normal");
        doc.setTextColor(0, 0, 0);
        /** The digits centered on the point */
        const drawNumber = (c: { x: number; y: number }, fontSize: number, value: number) => {
            const size = fontSize * toPt;
            const x = toPageX(c.x);
            const y = toPageY(c.y + fontSize * DIGIT_BASELINE_OFFSET);
            doc.setFontSize(size);
            doc.text(String(value), x, y, { align: "center", baseline: "alphabetic" });
        };
        for (const label of layout.labels.values()) {
            drawNumber(label.center, label.fontSize, facetResult.facets[label.facetId]!.color + 1);
        }
        doc.setFillColor(0, 0, 0);
        for (const c of layout.callouts.values()) {
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(c.fontSize * 0.07 * toPt);
            doc.setLineCap("round");
            doc.line(toPageX(c.anchor.x), toPageY(c.anchor.y), toPageX(c.lineEnd.x), toPageY(c.lineEnd.y));
            doc.circle(toPageX(c.anchor.x), toPageY(c.anchor.y), c.dotRadius * toPt, "F");
            drawNumber(c.text, c.fontSize, facetResult.facets[c.facetId]!.color + 1);
        }
    };

    /** `simple`: numbers and colors only, in number order (no families, paint codes or hex values) */
    const addLegend = (simple = false) => {
        const entries = buildPaletteEntries(colorsByIndex, template.colorCodes);
        if (simple) {
            addSimpleLegendPages(doc, entries, options.legendTitle || "Legend & Palette");
        } else {
            addLegendPages(doc, groupPaletteEntries(entries), options.legendTitle || "Legend & Palette");
        }
    };

    return { doc, drawColoredTemplate, drawLabels, drawCalloutTemplate, addLegend, outlineColor };
}

/**
 * The customer's "User PDF".
 * Page 1: the finished painting, colors only (the "PNG" image).
 * Page 2: the painted template, colors with outlines and numbers, white on the dark regions (the "SVG" image).
 * Page 3: the blank template to paint on, with callouts for the regions too small for a readable number.
 * Page 4+: the legend, numbers and colors only, even with a paint palette (no families, codes or hex values).
 */
export function buildPdf(JsPDF: JsPdfConstructor, template: PdfTemplate, options: PdfOptions = {}): any {
    const page = layoutTemplate(JsPDF, template, options);
    page.drawColoredTemplate(null);
    page.doc.addPage();
    page.drawColoredTemplate();
    page.drawLabels("contrast");
    page.doc.addPage();
    page.drawCalloutTemplate();
    page.addLegend(true);
    addReference(page.doc, options.reference);
    return page.doc;
}

/**
 * The painting guide: page 1 is the colored template with grey outlines and its numbers (white on the
 * dark regions), page 2 is the palette.
 */
export function buildPaintingPdf(JsPDF: JsPdfConstructor, template: PdfTemplate, options: PdfOptions = {}): any {
    const page = layoutTemplate(JsPDF, template, options);
    // grey outlines: they show where each region ends without cutting up the artwork the way black does
    page.drawColoredTemplate(page.outlineColor);
    page.drawLabels("contrast");
    page.addLegend();
    if (options.paintPlans && options.paintPlans.length) {
        addPaintPages(page.doc, buildPaletteEntries(template.colorsByIndex, template.colorCodes), options.paintPlans);
    }
    addReference(page.doc, options.reference);
    return page.doc;
}

/** The reference at the bottom center of every page, in the margin below the content */
function addReference(doc: any, reference: string | undefined) {
    if (!reference) { return; }
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.setTextColor("#111827");
        doc.text(reference, pageWidth / 2, pageHeight - PAGE_MARGIN / 2, { align: "center", baseline: "middle" });
    }
}

/**
 * Legend as vector content. Family cards are packed into full-width lines and a new page
 * is only started when the next line doesn't fit on the current one.
 */
/** Title line shared by the legends: title on the left, color count on the right, then a rule. Returns the next y. */
function drawLegendHeader(doc: any, title: string, summary: string): number {
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = PAGE_MARGIN;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor("#111827");
    doc.text(title, PAGE_MARGIN, y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#6b7280");
    doc.text(summary, pageWidth - PAGE_MARGIN, y + 12, { align: "right" });
    y += 22;
    doc.setDrawColor("#e5e7eb");
    doc.setLineWidth(0.75);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    return y + 12;
}

/**
 * The customer legend: large color circles with their number below, in number order, on the page itself
 * (no cards, families, paint codes or hex values). Every row is centered, the last one included.
 */
export function addSimpleLegendPages(doc: any, entries: PaletteEntry[], title: string) {
    if (entries.length === 0) { return; }
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PAGE_MARGIN * 2;

    const radius = 22;
    const numberSize = 13;
    const cellWidth = 64; // circle + breathing room
    const columns = Math.max(4, Math.min(entries.length, Math.floor(contentWidth / cellWidth)));
    const rowHeight = radius * 2 + 8 + numberSize + 18;

    doc.addPage();
    let y = drawLegendHeader(doc, title, entries.length + " colors") + 8;
    for (let start = 0; start < entries.length; start += columns) {
        if (y + rowHeight > pageHeight - PAGE_MARGIN) {
            doc.addPage();
            y = PAGE_MARGIN;
        }
        const row = entries.slice(start, start + columns);
        let cx = (pageWidth - row.length * cellWidth) / 2 + cellWidth / 2;
        for (const entry of row) {
            doc.setLineWidth(0.8);
            doc.setDrawColor("#9ca3af");
            doc.setFillColor(entry.color[0], entry.color[1], entry.color[2]);
            doc.circle(cx, y + radius, radius, "FD");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(numberSize);
            doc.setTextColor("#111827");
            doc.text(String(entry.number), cx, y + radius * 2 + 8 + numberSize * 0.8, { align: "center" });
            cx += cellWidth;
        }
        y += rowHeight;
    }
}

export function addLegendPages(doc: any, rows: PaletteRow[], title: string) {
    if (rows.length === 0) { return; }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PAGE_MARGIN * 2;
    const isGrouped = rows.some((row) => !!row.label);
    const maxSwatches = Math.max(...rows.map((row) => row.entries.length));

    // Sizes are tuned for A4 and scale down (k < 1) when the largest family doesn't fit a smaller paper size
    const cardPadding = 8;
    const cardGap = 8;
    const cellWidth = Math.min(44, (contentWidth - cardPadding * 2) / maxSwatches);
    const k = cellWidth / 44;
    const radius = 12 * k;
    const labelFontSize = Math.max(6, 8.5 * k);
    const labelLineHeight = labelFontSize * 1.25;
    const hasCodes = rows.some((row) => row.entries.some((e) => !!e.code));
    const cellHeight = radius * 2 + 10 * k + (hasCodes ? 8.5 * k : 0) + 8 * k + 3 * k;

    interface Card { row: PaletteRow; width: number; labelLines: string[]; }
    interface Line { cards: Card[]; labelHeight: number; height: number; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(labelFontSize);
    const cards: Card[] = rows.map((row) => {
        // +1pt slack so splitTextToSize doesn't wrap a label that exactly fits
        const labelWidth = row.label ? Math.min(doc.getTextWidth(row.label) + 1, contentWidth - cardPadding * 2) : 0;
        return { row, width: cardPadding * 2 + Math.max(row.entries.length * cellWidth, labelWidth), labelLines: [] };
    });

    // Pack cards into lines, keeping the family order
    const lines: Line[] = [];
    let current: Card[] = [];
    let usedWidth = 0;
    for (const card of cards) {
        const gap = current.length ? cardGap : 0;
        if (current.length && usedWidth + gap + card.width > contentWidth) {
            lines.push({ cards: current, labelHeight: 0, height: 0 });
            current = [];
            usedWidth = 0;
        }
        usedWidth += (current.length ? cardGap : 0) + card.width;
        current.push(card);
    }
    if (current.length) {
        lines.push({ cards: current, labelHeight: 0, height: 0 });
    }

    // Stretch cards so every line spans the full width (a short last line keeps its natural widths)
    lines.forEach((line, lineIndex) => {
        const lineWidth = line.cards.reduce((sum, card) => sum + card.width, 0) + cardGap * (line.cards.length - 1);
        const isShortLastLine = lineIndex === lines.length - 1 && lineWidth < contentWidth * 0.75;
        const extra = isShortLastLine ? 0 : (contentWidth - lineWidth) / line.cards.length;
        for (const card of line.cards) {
            card.width += extra;
            card.labelLines = card.row.label ? doc.splitTextToSize(card.row.label, card.width - cardPadding * 2) : [];
        }
        const maxLabelLines = Math.max(...line.cards.map((card) => card.labelLines.length));
        line.labelHeight = maxLabelLines ? maxLabelLines * labelLineHeight + 6 * k : 0;
        line.height = cardPadding + line.labelHeight + cellHeight + cardPadding * 0.5;
    });

    const drawCard = (card: Card, x: number, y: number, line: Line) => {
        doc.setLineWidth(0.75);
        doc.setDrawColor("#e5e7eb");
        doc.setFillColor("#fafafa");
        doc.roundedRect(x, y, card.width, line.height, 6, 6, "FD");

        if (card.labelLines.length) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(labelFontSize);
            doc.setTextColor("#1e293b");
            card.labelLines.forEach((text, i) => {
                doc.text(text, x + cardPadding, y + cardPadding + labelFontSize * 0.8 + i * labelLineHeight);
            });
        }

        const top = y + cardPadding + line.labelHeight;
        let cellX = x + (card.width - card.row.entries.length * cellWidth) / 2;
        for (const entry of card.row.entries) {
            const cx = cellX + cellWidth / 2;
            doc.setLineWidth(0.6);
            doc.setDrawColor("#9ca3af");
            doc.setFillColor(entry.color[0], entry.color[1], entry.color[2]);
            doc.circle(cx, top + radius, radius, "FD");

            let textY = top + radius * 2 + 10 * k;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(Math.max(6, 9 * k));
            doc.setTextColor("#111827");
            doc.text(String(entry.number), cx, textY, { align: "center" });
            if (hasCodes) {
                textY += 8.5 * k;
                if (entry.code) {
                    doc.setFontSize(Math.max(5, 7.5 * k));
                    doc.setTextColor("#334155");
                    doc.text(entry.code, cx, textY, { align: "center" });
                }
            }
            textY += 8 * k;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(Math.max(4.5, 6.5 * k));
            doc.setTextColor("#6b7280");
            doc.text(entry.hex, cx, textY, { align: "center" });
            cellX += cellWidth;
        }
    };

    doc.addPage();
    const colorCount = rows.reduce((sum, row) => sum + row.entries.length, 0);
    let y = drawLegendHeader(doc, title, colorCount + " colors" + (isGrouped ? " · " + rows.length + " families" : ""));

    for (const line of lines) {
        if (y + line.height > pageHeight - PAGE_MARGIN) {
            doc.addPage();
            y = PAGE_MARGIN;
        }
        let x = PAGE_MARGIN;
        for (const card of line.cards) {
            drawCard(card, x, y, line);
            x += card.width + cardGap;
        }
        y += line.height + cardGap;
    }
}

/**
 * Production page of the paints: for each color its share of the canvas and, for every canvas size sold, the paint it
 * needs and the pots to pack (src/core/paint.ts). The kit of each size is at the top, the assumptions at the bottom.
 */
export function addPaintPages(doc: any, entries: PaletteEntry[], plans: PaintPlan[]) {
    if (plans.length === 0 || plans[0].colors.length === 0) { return; }
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const needs = plans.map((plan) => new Map<number, PaintNeed>(plan.colors.map((c) => [c.index, c])));
    const rows = entries.filter((e) => needs[0].has(e.number - 1));
    const potCount = (pots: PaintPot[]) => pots.reduce((sum, p) => sum + p.count, 0);
    const label = (plan: PaintPlan) => plan.label + (plan.sameShape ? "" : " *");

    // columns: number, swatch, code, share, regions, then one per canvas size
    const x = { number: PAGE_MARGIN + 14, swatch: PAGE_MARGIN + 30, code: PAGE_MARGIN + 52, share: PAGE_MARGIN + 128, regions: PAGE_MARGIN + 178 };
    const sizesLeft = PAGE_MARGIN + 196;
    const sizeWidth = (pageWidth - PAGE_MARGIN - sizesLeft) / plans.length;
    const rowHeight = 17;
    const headerRow = (y: number) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor("#6b7280");
        doc.text("#", x.number, y, { align: "right" });
        doc.text("Paint", x.code, y);
        doc.text("Share", x.share, y, { align: "right" });
        doc.text("Regions", x.regions, y, { align: "right" });
        plans.forEach((plan, i) => doc.text(label(plan) + " cm", sizesLeft + i * sizeWidth + 6, y));
        return y + 8;
    };

    doc.addPage();
    let y = drawLegendHeader(doc, "Paints & pots", `${rows.length} colors · ` + plans.map((p) => `${p.label}: ${potCount(p.potsBySize)} pots`).join(" · "));
    // the kit of each size
    for (const plan of plans) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor("#111827");
        doc.text(`${label(plan)} cm:`, PAGE_MARGIN, y + 4);
        doc.setFont("helvetica", "normal");
        doc.text(`${describePots(plan.potsBySize)}  ·  ${plan.totalMl.toFixed(1)} ml needed, ${Math.round(plan.totalPackedMl)} ml packed`, PAGE_MARGIN + 62, y + 4);
        y += 13;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#6b7280");
    doc.text("A color with several pots: every pot carries that color's number. Highlighted: more than one pot for that size.", PAGE_MARGIN, y + 4);
    y = headerRow(y + 22);

    for (const entry of rows) {
        if (y + rowHeight > pageHeight - PAGE_MARGIN - 30) {
            doc.addPage();
            y = headerRow(PAGE_MARGIN + 10);
        }
        const mid = y + rowHeight / 2;
        const base = needs[0].get(entry.number - 1)!;
        // a size that needs more than one pot of this color: its cell stands out
        plans.forEach((plan, i) => {
            const need = needs[i].get(entry.number - 1);
            if (need && potCount(need.pots) > 1) {
                doc.setFillColor("#fef3c7");
                doc.rect(sizesLeft + i * sizeWidth + 2, y + 1, sizeWidth - 4, rowHeight - 2, "F");
            }
        });
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor("#111827");
        doc.text(String(entry.number), x.number, mid + 3.5, { align: "right" });
        doc.setLineWidth(0.5);
        doc.setDrawColor("#9ca3af");
        doc.setFillColor(entry.color[0], entry.color[1], entry.color[2]);
        doc.circle(x.swatch + 7, mid, 6.5, "FD");
        doc.setFont("helvetica", "normal");
        doc.text(entry.code || entry.hex, x.code, mid + 3.5);
        doc.setFontSize(9);
        doc.setTextColor("#374151");
        doc.text(`${base.sharePercent.toFixed(1)}%`, x.share, mid + 3.5, { align: "right" });
        doc.text(String(base.regions), x.regions, mid + 3.5, { align: "right" });
        plans.forEach((plan, i) => {
            const need = needs[i].get(entry.number - 1);
            if (!need) { return; }
            const left = sizesLeft + i * sizeWidth + 6;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.5);
            doc.setTextColor("#111827");
            const pots = describePots(need.pots);
            doc.text(pots, left, mid + 3.5);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor("#6b7280");
            doc.text(`${need.ml.toFixed(1)} ml`, left + doc.getTextWidth(pots) + 18, mid + 3.5);
        });
        doc.setDrawColor("#f3f4f6");
        doc.line(PAGE_MARGIN, y + rowHeight, pageWidth - PAGE_MARGIN, y + rowHeight);
        y += rowHeight;
    }

    // the assumptions behind the estimates
    const s = plans[0].settings;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor("#6b7280");
    let note = `Estimate: ${s.coverageCm2PerMl} cm² per ml (all coats), +${Math.round(s.margin * 100)}% margin, +${s.mlPerRegion} ml per region at 40x50 (scaled with the canvas). ` +
        `Pots: ${s.potSizesMl.slice().sort((a, b) => a - b).join(", ")} ml.`;
    if (plans.some((p) => !p.sameShape)) {
        note += " * Not the template's shape: the print is cropped, the estimate is approximate.";
    }
    doc.text(doc.splitTextToSize(note, pageWidth - PAGE_MARGIN * 2), PAGE_MARGIN, pageHeight - PAGE_MARGIN - 8);
}
