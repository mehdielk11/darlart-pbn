/**
 * Product mockup: the "perfect kit" photo showing the customer's own template. The faded numbered canvas goes on
 * the canvas, a grey print of it on the reference sheet, and their cropped photo on the image card.
 *
 * The geometry is in src/core/mockup.ts (shared with the website's "Download mockup" button), and the kit
 * photos are prepared once by server/scripts/prepare-mockups.js: this only stacks layers.
 */
import path from "path";
import sharp from "sharp";
import { containBox, insetBox, MOCKUP_STYLE, MockupTemplate, pickMockupTemplate, sheetGeometry } from "../../src/core/mockup";
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
