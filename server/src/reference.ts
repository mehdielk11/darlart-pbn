/**
 * Exact canvas ratio: fitToCanvas crops (never stretches) an image to a canvas size's ratio, e.g. 60x75.
 */
import sharp from "sharp";
import { resolveCanvasSize } from "../../src/core/crop";

const MAX_INPUT_PIXELS = 100 * 1000 * 1000;

/**
 * Crops an image to the exact ratio of a canvas size (e.g. "60x75", portrait or landscape), keeping the most
 * interesting area. Never stretches: when the image already has the ratio, it is returned unchanged.
 */
export async function fitToCanvas(input: Buffer, canvasSize: string, orientation: "auto" | "portrait" | "landscape"): Promise<{ image: Buffer; label: string; cropped: boolean }> {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().toBuffer({ resolveWithObject: true });
    const canvas = resolveCanvasSize(canvasSize, orientation, info.width, info.height);
    let width = info.width;
    let height = Math.round(width / canvas.aspect);
    if (height > info.height) {
        height = info.height;
        width = Math.round(height * canvas.aspect);
    }
    if (width === info.width && height === info.height) {
        return { image: data, label: canvas.label, cropped: false };
    }
    const image = await sharp(data).resize(width, height, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
    return { image, label: canvas.label, cropped: true };
}
