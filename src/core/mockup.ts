/**
 * Product mockup geometry, shared by the website and the API: the "perfect kit" photos and where the canvas,
 * the image card and the reference sheet sit on them.
 *
 * The kit photos are flat lays shot from above, so every placeholder is an upright or rotated rectangle: the
 * mockup only needs resizing, one rotation and masking. The costly part (erasing the drawing printed on the
 * template's sheet, cutting out the brushes lying on it) is done once by server/scripts/prepare-mockups.js,
 * which writes the "-blank" and "-overlay" images next to the kit photos in /mockups, and a script embedding
 * both for the website.
 */

export type MockupPoint = [number, number];

export interface MockupBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface MockupTemplate {
    name: "landscape" | "portrait";
    /** The original kit photo, only read by prepare-mockups.js */
    source: string;
    /** The kit photo with a blank reference sheet */
    blank: string;
    /** What lies on top of the reference sheet (brushes, callout arcs), transparent elsewhere */
    overlay: string;
    /** Script embedding blank and overlay for the website, so the mockup can be exported even when the page is opened from disk */
    script: string;
    /** Width and height of the kit photo */
    size: number;
    /** The blank canvas, facing the camera */
    canvas: MockupBox;
    /** The blank image card */
    card: MockupBox;
    /** Reference sheet corners: top-left, top-right, bottom-right, bottom-left. Partly hidden under the canvas. */
    sheet: [MockupPoint, MockupPoint, MockupPoint, MockupPoint];
}

/** Placeholder positions, measured on the 1254 x 1254 kit photos */
export const MOCKUP_TEMPLATES: { [name in "landscape" | "portrait"]: MockupTemplate } = {
    landscape: {
        name: "landscape",
        source: "kit-landscape.webp",
        blank: "kit-landscape-blank.webp",
        overlay: "kit-landscape-overlay.png",
        script: "kit-landscape.js",
        size: 1254,
        canvas: { left: 288, top: 321, width: 680, height: 532 },
        card: { left: 53, top: 324, width: 184, height: 182 },
        sheet: [[628, 188], [1215, 329], [1089, 862], [506, 722]],
    },
    portrait: {
        name: "portrait",
        source: "kit-portrait.webp",
        blank: "kit-portrait-blank.webp",
        overlay: "kit-portrait-overlay.png",
        script: "kit-portrait.js",
        size: 1254,
        canvas: { left: 313, top: 172, width: 628, height: 750 },
        card: { left: 68, top: 356, width: 171, height: 187 },
        // the sheet lies almost entirely behind the canvas: only its top-right corner shows
        sheet: [[786, 186], [1169, 357], [907, 851], [524, 680]],
    },
};

export const MOCKUP_STYLE = {
    /** The art covers the canvas face exactly: its box is measured on the face, bevel included */
    canvasEdge: 0,
    /** Pixels kept free along the image card's border, so its edge and shadow stay visible */
    cardEdge: 2,
    /** The reference sheet print is darker than the canvas: 1 keeps the tone, higher is darker (white stays white) */
    sheetDarken: 1.15,
    /** White margin around the print on the reference sheet, as a share of the sheet's shorter side */
    sheetMargin: 0.035,
};

/** The kit whose canvas shape is closest to the painting's (width / height) */
export function pickMockupTemplate(aspect: number): MockupTemplate {
    const distance = (t: MockupTemplate) => Math.abs(Math.log((t.canvas.width / t.canvas.height) / aspect));
    return distance(MOCKUP_TEMPLATES.landscape) <= distance(MOCKUP_TEMPLATES.portrait) ? MOCKUP_TEMPLATES.landscape : MOCKUP_TEMPLATES.portrait;
}

export function insetBox(box: MockupBox, by: number): MockupBox {
    return { left: box.left + by, top: box.top + by, width: box.width - 2 * by, height: box.height - 2 * by };
}

/**
 * The reference sheet as an upright rectangle (width x height, with the print's margin) and the affine
 * matrix [a, b, c, d, e, f] that maps it onto the rotated sheet in the photo.
 */
export function sheetGeometry(template: MockupTemplate): { width: number; height: number; margin: number; matrix: number[] } {
    const [topLeft, topRight, , bottomLeft] = template.sheet;
    const width = Math.round(Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]));
    const height = Math.round(Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]));
    return {
        width,
        height,
        margin: Math.round(Math.min(width, height) * MOCKUP_STYLE.sheetMargin),
        matrix: [
            (topRight[0] - topLeft[0]) / width,
            (topRight[1] - topLeft[1]) / width,
            (bottomLeft[0] - topLeft[0]) / height,
            (bottomLeft[1] - topLeft[1]) / height,
            topLeft[0],
            topLeft[1],
        ],
    };
}

/** Darkens a grey value for the reference sheet print, keeping white white */
export function darkenForSheet(value: number): number {
    return Math.max(0, Math.min(255, 255 - (255 - value) * MOCKUP_STYLE.sheetDarken));
}

/** The source rectangle to draw so that an image fills a box without distortion (CSS "cover", centred) */
export function coverSource(sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number): MockupBox {
    const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const width = boxWidth / scale;
    const height = boxHeight / scale;
    return { left: (sourceWidth - width) / 2, top: (sourceHeight - height) / 2, width, height };
}

/** Where a kit's script (see MockupTemplate.script) puts its layers, as data URLs */
export const MOCKUP_KITS_GLOBAL = "DARLART_MOCKUP_KITS";

/** Where to draw an image so it fits whole in a box, keeping its ratio (CSS "contain", centred), in whole pixels */
export function containBox(sourceWidth: number, sourceHeight: number, box: MockupBox): MockupBox {
    const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    return { left: box.left + Math.round((box.width - width) / 2), top: box.top + Math.round((box.height - height) / 2), width, height };
}
