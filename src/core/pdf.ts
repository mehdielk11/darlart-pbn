/**
 * PDF output of a processed image, drawn as vector content straight from the facet data (no SVG parsing, no DOM),
 * so the website and the API produce the same document.
 *
 * buildPdf: page 1 the finished painting (colors only), page 2 the pre-printed canvas (faint colors,
 * grey outlines and numbers), page 3+ legend & palette by family
 * buildPaintingPdf: page 1 colored with numbers, page 2 palette
 *
 * jsPDF is passed in (window.jspdf.jsPDF in the browser, require("jspdf").jsPDF in Node).
 */
import { RGB } from "../common";
import { FacetResult } from "../facetmanagement";
import { buildPaletteEntries, groupPaletteEntries, PaletteRow } from "./palette";
import { fadeColors, FADED_CANVAS_STYLE, getFacetOutline, getLabelFontSize, labelColorFor } from "./svg";

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
    /** Borders and numbers of the outline page */
    outlineColor?: string;
    legendTitle?: string;
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
    const outlineColor = hexToRgb(options.outlineColor || "#bcc0ca");
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
     * The colored template, one filled shape per facet. Without borders each shape is stroked in its own
     * color instead, the way the SVG does it, so no white seams show between the regions.
     */
    const drawColoredTemplate = (borders: boolean = true) => {
        doc.setLineJoin("round");
        doc.setLineWidth(lineWidth);
        if (borders) {
            doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        }
        for (const f of drawableFacets) {
            const color = colorsByIndex[f!.color];
            doc.setFillColor(color[0], color[1], color[2]);
            if (!borders) {
                doc.setDrawColor(color[0], color[1], color[2]);
            }
            traceFacet(getFacetOutline(f!));
            doc.fillStroke();
        }
    };

    /** The pre-printed canvas: faintly tinted regions with grey outlines, the look of the "Preview SVG" download */
    const drawFadedTemplate = () => {
        const faded = fadeColors(colorsByIndex, FADED_CANVAS_STYLE.svgColorStrength);
        const stroke = hexToRgb(FADED_CANVAS_STYLE.strokeColor);
        doc.setLineJoin("round");
        doc.setLineWidth(lineWidth);
        doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
        for (const f of drawableFacets) {
            const color = faded[f!.color];
            doc.setFillColor(color[0], color[1], color[2]);
            traceFacet(getFacetOutline(f!));
            doc.fillStroke();
        }
    };

    /** The outlines only, in the outline color */
    const drawOutlines = () => {
        doc.setLineJoin("round");
        doc.setLineWidth(lineWidth);
        doc.setDrawColor(outlineColor[0], outlineColor[1], outlineColor[2]);
        for (const f of drawableFacets) {
            traceFacet(getFacetOutline(f!));
            doc.stroke();
        }
    };

    const addLegend = () => {
        const rows = groupPaletteEntries(buildPaletteEntries(colorsByIndex, template.colorCodes));
        addLegendPages(doc, rows, options.legendTitle || "Legend & Palette");
    };

    return { doc, drawColoredTemplate, drawFadedTemplate, drawOutlines, drawLabels, addLegend, outlineColor };
}

/**
 * Page 1: the finished painting, colors only (the "Download PNG" image).
 * Page 2: the pre-printed canvas, faint colors with grey outlines and numbers (the "Preview SVG" image).
 * Page 3+: legend & palette by family.
 */
export function buildPdf(JsPDF: JsPdfConstructor, template: PdfTemplate, options: PdfOptions = {}): any {
    const page = layoutTemplate(JsPDF, template, options);
    page.drawColoredTemplate(false);
    page.doc.addPage();
    page.drawFadedTemplate();
    page.drawLabels(hexToRgb(FADED_CANVAS_STYLE.fontColor));
    page.addLegend();
    return page.doc;
}

/**
 * The painting guide: page 1 is the colored template with its numbers (white on the dark regions),
 * page 2 is the palette.
 */
export function buildPaintingPdf(JsPDF: JsPdfConstructor, template: PdfTemplate, options: PdfOptions = {}): any {
    const page = layoutTemplate(JsPDF, template, options);
    page.drawColoredTemplate();
    page.drawLabels("contrast");
    page.addLegend();
    return page.doc;
}

/**
 * Legend as vector content. Family cards are packed into full-width lines and a new page
 * is only started when the next line doesn't fit on the current one.
 */
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
    let y = PAGE_MARGIN;
    const colorCount = rows.reduce((sum, row) => sum + row.entries.length, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor("#111827");
    doc.text(title, PAGE_MARGIN, y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#6b7280");
    doc.text(colorCount + " colors" + (isGrouped ? " · " + rows.length + " families" : ""), pageWidth - PAGE_MARGIN, y + 12, { align: "right" });
    y += 22;
    doc.setDrawColor("#e5e7eb");
    doc.setLineWidth(0.75);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += 12;

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
