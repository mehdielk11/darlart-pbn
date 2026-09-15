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
}

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

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMultiplier * facetResult.width}" height="${sizeMultiplier * facetResult.height}">`);

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
        style += "stroke-width: 1px; ";
        style += `fill: ${fill ? color : "none"};`;
        parts.push(`<path data-facetId="${f.id}" d="${buildFacetPathData(outline, sizeMultiplier)}" style="${style}"></path>`);

        if (labels) {
            parts.push(`<g class="label" transform="translate(${f.labelBounds.minX * sizeMultiplier},${f.labelBounds.minY * sizeMultiplier})">` +
                `<svg width="${f.labelBounds.width * sizeMultiplier}" height="${f.labelBounds.height * sizeMultiplier}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
                `<text font-family="Tahoma" font-size="${getLabelFontSize(f, fontSize)}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color + 1}</text>` +
                `</svg></g>`);
        }
    }

    parts.push("</svg>");
    return parts.join("");
}
