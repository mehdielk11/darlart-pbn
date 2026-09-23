/**
 * SVG output of a processed image, as a string (works in the browser and in Node)
 */
import { RGB } from "../common";
import { Facet, FacetResult } from "../facetmanagement";
import { Point } from "../structs/point";

export interface SvgOptions {
    sizeMultiplier?: number;
    fill?: boolean;
    stroke?: boolean;
    labels?: boolean;
    fontSize?: number;
    fontColor?: string;
    strokeColor?: string;
    /** Outline width in output pixels (default 1) */
    strokeWidth?: number;
    /** Label font (default Tahoma); add fallbacks when rendering where Tahoma isn't installed */
    fontFamily?: string;
    /** Color painted behind the facets (default: none, transparent) */
    background?: string;
    /** Numbers on dark filled regions are written in white instead of fontColor, so they stay readable */
    labelContrast?: boolean;
}

/** Numbers stay readable on any fill: white on a dark region, the normal color on a light one */
export function labelColorFor(color: RGB, fontColor: string): string {
    const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    return luminance < 140 ? "#ffffff" : fontColor;
}

/** The faded "pre-printed canvas" look: pale colors with grey outlines and grey numbers */
export const FADED_CANVAS_STYLE = {
    /** Share of each color that is kept, the rest being white: 1 keeps the color, 0 turns it white */
    colorStrength: 0.22,
    /** The vector version, lighter than the PNG: it is printed and the numbers must stay easy to read */
    svgColorStrength: 0.18,
    strokeColor: "#a2a7ad",
    fontColor: "#868b92",
    background: "#ffffff",
};

/** Closed outline of a facet built from its (smoothed) border segments, in image pixel coordinates */
export function getFacetOutline(f: Facet): Point[] {
    const path = f.getFullPathFromBorderSegments(false);
    if (path.length > 0 && (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y)) {
        path.push(path[0]);
    }
    return path;
}

export function buildFacetPathData(outline: Point[], sizeMultiplier: number): string {
    let data = "M ";
    data += outline[0].x * sizeMultiplier + " " + outline[0].y * sizeMultiplier + " ";
    for (let i = 1; i < outline.length; i++) {
        const midpointX = (outline[i].x + outline[i - 1].x) / 2;
        const midpointY = (outline[i].y + outline[i - 1].y) / 2;
        data += "Q " + (midpointX * sizeMultiplier) + " " + (midpointY * sizeMultiplier) + " " + (outline[i].x * sizeMultiplier) + " " + (outline[i].y * sizeMultiplier) + " ";
    }
    data += "Z";
    return data;
}

/** Font size of a facet label, in the -50..50 viewBox units of its label box */
export function getLabelFontSize(f: Facet, fontSize: number): number {
    return fontSize / ((f.color + 1) + "").length;
}

function rgbString(color: RGB) {
    return `rgb(${color[0]},${color[1]},${color[2]})`;
}

export function buildSvgString(facetResult: FacetResult, colorsByIndex: RGB[], options: SvgOptions = {}): string {
    const sizeMultiplier = options.sizeMultiplier !== undefined ? options.sizeMultiplier : 3;
    const fill = options.fill !== undefined ? options.fill : true;
    const stroke = options.stroke !== undefined ? options.stroke : true;
    const labels = options.labels !== undefined ? options.labels : true;
    const fontSize = options.fontSize !== undefined ? options.fontSize : 50;
    const fontColor = options.fontColor || "#000";
    const strokeColor = options.strokeColor || "#000";
    const strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 1;
    const fontFamily = (options.fontFamily || "Tahoma").replace(/"/g, "'");

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMultiplier * facetResult.width}" height="${sizeMultiplier * facetResult.height}">`);
    if (options.background) {
        parts.push(`<rect width="100%" height="100%" fill="${options.background}"></rect>`);
    }

    for (const f of facetResult.facets) {
        if (f == null || f.borderSegments.length === 0) {
            continue;
        }
        const outline = getFacetOutline(f);
        const color = rgbString(colorsByIndex[f.color]);

        let style = "";
        if (stroke) {
            style += `stroke: ${strokeColor}; `;
        } else if (fill) {
            // make the border the same color as the fill color if there is no border stroke to not have gaps in between facets
            style += `stroke: ${color}; `;
        }
        style += `stroke-width: ${strokeWidth}px; `;
        style += `fill: ${fill ? color : "none"};`;
        parts.push(`<path data-facetId="${f.id}" d="${buildFacetPathData(outline, sizeMultiplier)}" style="${style}"></path>`);

        if (labels) {
            const labelFill = fill && options.labelContrast ? labelColorFor(colorsByIndex[f.color], fontColor) : fontColor;
            parts.push(`<g class="label" transform="translate(${f.labelBounds.minX * sizeMultiplier},${f.labelBounds.minY * sizeMultiplier})">` +
                `<svg width="${f.labelBounds.width * sizeMultiplier}" height="${f.labelBounds.height * sizeMultiplier}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
                `<text font-family="${fontFamily}" font-size="${getLabelFontSize(f, fontSize)}" dominant-baseline="middle" text-anchor="middle" fill="${labelFill}">${f.color + 1}</text>` +
                `</svg></g>`);
        }
    }

    parts.push("</svg>");
    return parts.join("");
}

/** The blank template: dark grey outlines and black numbers on white, no colors (to print and paint from scratch) */
export function buildBlankSvgString(facetResult: FacetResult, colorsByIndex: RGB[], options: SvgOptions = {}): string {
    return buildSvgString(facetResult, colorsByIndex, {
        // the same grey as the Agency PDF outlines: clear lines that stay softer than black
        strokeColor: "#6a6f77",
        fontColor: "#000000",
        background: "#ffffff",
        ...options,
        fill: false,
        stroke: true,
        labels: true,
    });
}

/** Mixes each color toward white, keeping `strength` of the original (0 = white, 1 = unchanged) */
export function fadeColors(colorsByIndex: RGB[], strength: number): RGB[] {
    const kept = Math.max(0, Math.min(1, strength));
    return colorsByIndex.map((color) => color.map((channel, i) => (i < 3 ? Math.round(255 - (255 - channel) * kept) : channel)));
}

/**
 * The template as a pre-printed canvas: every region faintly tinted with its color, with grey outlines and
 * numbers on white. Painters see where each color goes while the numbers stay readable.
 */
export function buildFadedSvgString(facetResult: FacetResult, colorsByIndex: RGB[], options: SvgOptions & { colorStrength?: number } = {}): string {
    const strength = options.colorStrength !== undefined ? options.colorStrength : FADED_CANVAS_STYLE.colorStrength;
    const svgOptions: SvgOptions = {
        strokeColor: FADED_CANVAS_STYLE.strokeColor,
        fontColor: FADED_CANVAS_STYLE.fontColor,
        background: FADED_CANVAS_STYLE.background,
    };
    for (const key of Object.keys(options) as (keyof SvgOptions)[]) {
        if (key !== ("colorStrength" as string) && options[key] !== undefined) {
            (svgOptions as any)[key] = options[key];
        }
    }
    svgOptions.fill = true;
    svgOptions.stroke = true;
    svgOptions.labels = true;
    return buildSvgString(facetResult, fadeColors(colorsByIndex, strength), svgOptions);
}

