/**
 * Canvas sizes and crop geometry shared by the website and the API
 */

export type Orientation = "portrait" | "landscape" | "square";

/** Canvas sizes in cm, as offered in the crop dialog (portrait form; landscape swaps them) */
export const CANVAS_SIZES = ["30x40", "40x50", "50x50", "60x70"];

/**
 * Print formats of the digital products: the customer prints the template on that paper.
 * The canvas is the paper itself, so the template fills the page: every A size has the same 1:√2 shape.
 */
export interface PrintFormat {
    /** "a4", also the API paperSize */
    id: "a2" | "a3" | "a4";
    /** "A4", shown to the customer and used in file names */
    label: string;
    /** canvas size in cm, portrait form, as sent to the API */
    canvasSize: string;
    widthCm: number;
    heightCm: number;
}

export const PRINT_FORMATS: PrintFormat[] = [
    { id: "a4", label: "A4", canvasSize: "21x29.7", widthCm: 21, heightCm: 29.7 },
    { id: "a3", label: "A3", canvasSize: "29.7x42", widthCm: 29.7, heightCm: 42 },
    { id: "a2", label: "A2", canvasSize: "42x59.4", widthCm: 42, heightCm: 59.4 },
];

export const PRINT_FORMAT_IDS = PRINT_FORMATS.map((format) => format.id);

export interface ResolvedCanvasSize {
    widthCm: number;
    heightCm: number;
    orientation: Orientation;
    /** width / height */
    aspect: number;
    /** e.g. "40x30" for a 30x40 canvas in landscape, used in file names */
    label: string;
}

export function parseCanvasSize(size: string): { a: number; b: number } | null {
    const match = (size || "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/);
    if (!match) { return null; }
    const a = parseFloat(match[1]);
    const b = parseFloat(match[2]);
    if (!(a > 0) || !(b > 0)) { return null; }
    return { a, b };
}

/** The print format named in a text, e.g. "A3", "Format A4 — 21 × 29,7 cm" */
export function parsePrintFormat(text: string): PrintFormat | null {
    const match = (text || "").match(/\ba\s*([234])\b/i);
    if (!match) { return null; }
    return PRINT_FORMATS.find((format) => format.id === `a${match[1]}`) || null;
}

/** The print format of a canvas size in either orientation, e.g. "29.7x42" and "42x29.7" are both A3 */
export function printFormatForCanvas(size: string): PrintFormat | null {
    const parsed = parseCanvasSize(size);
    if (!parsed) { return null; }
    const short = Math.min(parsed.a, parsed.b);
    const long = Math.max(parsed.a, parsed.b);
    return PRINT_FORMATS.find((format) => Math.abs(format.widthCm - short) < 0.05 && Math.abs(format.heightCm - long) < 0.05) || null;
}

/**
 * Resolves the canvas dimensions for a size like "40x50" and an orientation.
 * "auto" follows the photo: landscape when it's wider than it is tall, portrait otherwise, a square photo
 * included (same rule as the crop dialog).
 */
export function resolveCanvasSize(size: string, orientation: "auto" | "portrait" | "landscape", imageWidth: number, imageHeight: number): ResolvedCanvasSize {
    const parsed = parseCanvasSize(size);
    if (!parsed) {
        throw new Error(`Invalid canvas size "${size}", expected e.g. "40x50"`);
    }
    const short = Math.min(parsed.a, parsed.b);
    const long = Math.max(parsed.a, parsed.b);
    let resolved: Orientation;
    if (short === long) {
        resolved = "square";
    } else if (orientation === "auto") {
        resolved = imageWidth > imageHeight ? "landscape" : "portrait";
    } else {
        resolved = orientation;
    }
    const widthCm = resolved === "landscape" ? long : short;
    const heightCm = resolved === "landscape" ? short : long;
    return { widthCm, heightCm, orientation: resolved, aspect: widthCm / heightCm, label: `${widthCm}x${heightCm}` };
}

/** Crop box as fractions (0-1) of the image */
export interface RelativeBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Crop box in pixels */
export interface PixelBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Turns a (possibly imprecise, e.g. AI-proposed) crop box into a valid pixel box with the exact aspect ratio:
 * keeps the box center, grows the short side to match the aspect, shrinks when it doesn't fit the image and clamps inside the image.
 * Without a box, the largest centered crop is returned.
 */
export function fitCropToAspect(box: RelativeBox | null | undefined, aspect: number, imageWidth: number, imageHeight: number): PixelBox {
    let cx = imageWidth / 2;
    let cy = imageHeight / 2;
    let w = imageWidth;
    let h = imageHeight;

    const valid = box && [box.x, box.y, box.w, box.h].every((v) => typeof v === "number" && isFinite(v)) && box.w > 0 && box.h > 0;
    if (valid && box) {
        const x = clamp(box.x, 0, 1);
        const y = clamp(box.y, 0, 1);
        const bw = clamp(box.w, 0, 1 - x);
        const bh = clamp(box.h, 0, 1 - y);
        if (bw > 0 && bh > 0) {
            w = bw * imageWidth;
            h = bh * imageHeight;
            cx = (x + bw / 2) * imageWidth;
            cy = (y + bh / 2) * imageHeight;
        }
    }

    // grow the short side to the requested aspect
    if (w / h > aspect) {
        h = w / aspect;
    } else {
        w = h * aspect;
    }
    // shrink to fit inside the image
    if (w > imageWidth) {
        w = imageWidth;
        h = w / aspect;
    }
    if (h > imageHeight) {
        h = imageHeight;
        w = h * aspect;
    }

    const width = Math.max(1, Math.round(w));
    const height = Math.max(1, Math.round(h));
    const left = Math.round(clamp(cx - width / 2, 0, imageWidth - width));
    const top = Math.round(clamp(cy - height / 2, 0, imageHeight - height));
    return { left, top, width, height };
}
