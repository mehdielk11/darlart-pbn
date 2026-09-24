/**
 * Product mockup: the "perfect kit" photo showing the customer's own template. The faded numbered canvas goes on
 * the canvas, a grey print of it on the reference sheet, and their cropped photo on the image card.
 *
 * The geometry is in src/core/mockup.ts (shared with the website's "Download mockup" button), and the kit
 * photos are prepared once by server/scripts/prepare-mockups.js: this only stacks layers.
 */
import path from "path";
import sharp from "sharp";
import { containBox, FeaturedTemplate, insetBox, MOCKUP_STYLE, MockupTemplate, pickFeaturedTemplate, pickMockupTemplate, sheetGeometry } from "../../src/core/mockup";
import { config } from "./config";

export interface MockupRequest {
    /** The faded numbered canvas (canvas.png) */
    canvasPng: Buffer;
    /** The customer's photo, already cropped to the painting */
    photo: Buffer;
    /** Width / height of the painting, to pick the landscape or portrait kit */
    aspect: number;
}

export async function buildMockup(request: MockupRequest, template: MockupTemplate = pickMockupTemplate(request.aspect)): Promise<Buffer> {
    const blank = path.join(config.mockupsDir, template.blank);
    const overlay = path.join(config.mockupsDir, template.overlay);

    // The grey print, mapped onto the rotated reference sheet (k * v + 255 * (1 - k) is darkenForSheet)
    const sheet = sheetGeometry(template);
    const k = MOCKUP_STYLE.sheetDarken;
    const print = await sharp(request.canvasPng)
        .greyscale()
        .linear(k, 255 * (1 - k))
        .resize(sheet.width - 2 * sheet.margin, sheet.height - 2 * sheet.margin, { fit: "cover" })
        .extend({ top: sheet.margin, bottom: sheet.margin, left: sheet.margin, right: sheet.margin, background: "#ffffff" })
        .png()
        .toBuffer();
    const polygon = template.sheet.map((p) => p.join(",")).join(" ");
    const sheetLayer = await sharp(Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${template.size}" height="${template.size}">`
        + `<defs><clipPath id="sheet"><polygon points="${polygon}"/></clipPath></defs>`
        + `<g clip-path="url(#sheet)"><image width="${sheet.width}" height="${sheet.height}" preserveAspectRatio="none" `
        + `transform="matrix(${sheet.matrix.map((v) => v.toFixed(6)).join(",")})" xlink:href="data:image/png;base64,${print.toString("base64")}"/></g>`
        + "</svg>",
    )).png().toBuffer();

    // The canvas (covered edge to edge) and the card (the whole photo, at its own ratio), multiplied so the
    // canvas weave and the card's edges still show through
    const canvasPatch = await sharp(blank).extract(template.canvas).png().toBuffer();
    const canvasBox = insetBox(template.canvas, MOCKUP_STYLE.canvasEdge);
    const canvasArt = await sharp(request.canvasPng).resize(canvasBox.width, canvasBox.height, { fit: "cover" }).png().toBuffer();
    const photo = sharp(request.photo);
    const photoMeta = await photo.metadata();
    const cardBox = containBox(photoMeta.width!, photoMeta.height!, insetBox(template.card, MOCKUP_STYLE.cardEdge));
    const cardArt = await photo.resize(cardBox.width, cardBox.height, { fit: "fill" }).png().toBuffer();

    return sharp(blank)
        .composite([
            { input: sheetLayer, blend: "multiply" },
            // the canvas lies on top of the sheet, and the brushes and callout arcs on top of both
            { input: canvasPatch, left: template.canvas.left, top: template.canvas.top },
            { input: overlay },
            { input: canvasArt, left: canvasBox.left, top: canvasBox.top, blend: "multiply" },
            { input: cardArt, left: cardBox.left, top: cardBox.top, blend: "multiply" },
        ])
        .png({ compressionLevel: 9 })
        .toBuffer();
}

/** Size of the featured product image (square), in pixels */
export const FEATURED_SIZE = 1600;

/**
 * Featured product image: the artwork on the blank canvas of the wall photo matching its orientation (landscape
 * when wider than tall, portrait otherwise). The artwork fills the canvas face without distortion (cover): a 4:5
 * artwork fits it exactly. The photo is enlarged to `size` first, so the artwork keeps its own resolution.
 */
export async function buildFeatured(artwork: Buffer, size: number = FEATURED_SIZE): Promise<{ jpeg: Buffer; template: FeaturedTemplate }> {
    const art = sharp(artwork, { limitInputPixels: 100 * 1000 * 1000 }).rotate();
    const meta = await art.metadata();
    const swapped = (meta.orientation || 1) >= 5; // EXIF orientations 5-8 swap width and height
    const width = swapped ? meta.height! : meta.width!;
    const height = swapped ? meta.width! : meta.height!;
    const template = pickFeaturedTemplate(width / height);
    const scale = size / template.size;
    // the face plus the 1 px anti-aliased fringe the blank photo paints over
    const face = template.face;
    const left = Math.round((face.left - 1) * scale);
    const top = Math.round((face.top - 1) * scale);
    const box = { width: Math.round((face.left + face.width + 1) * scale) - left, height: Math.round((face.top + face.height + 1) * scale) - top };
    const artLayer = await art.resize(box.width, box.height, { fit: "cover", position: "centre" }).removeAlpha().png().toBuffer();
    // a JPEG: a photo-like product image, about 10 times smaller than a PNG
    const jpeg = await sharp(path.join(config.mockupsDir, template.blank))
        .resize(size, size, { kernel: "lanczos3" })
        .composite([{ input: artLayer, left, top }])
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
    return { jpeg, template };
}
