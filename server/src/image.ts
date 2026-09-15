/**
 * Image loading and preparation with sharp: EXIF rotation, crop to the canvas aspect ratio, resize
 */
import sharp from "sharp";
import { fitCropToAspect, PixelBox, RelativeBox, resolveCanvasSize, ResolvedCanvasSize } from "../../src/core/crop";
import { RGBAImage } from "../../src/core/pipeline";

export type CropMethod = "provided" | "attention";

export interface PrepareOptions {
    canvasSize: string;
    orientation: "auto" | "portrait" | "landscape";
    /** Crop box as fractions of the (rotated) photo, e.g. proposed by an AI vision model. Without it, sharp's attention strategy picks the crop. */
    crop: RelativeBox | null;
    /** Longest side of the image that is processed (the website uses 1024) */
    maxSide: number;
}

export interface PreparedImage {
    image: RGBAImage;
    canvas: ResolvedCanvasSize;
    crop: PixelBox;
    cropMethod: CropMethod;
    sourceWidth: number;
    sourceHeight: number;
}

const MAX_INPUT_PIXELS = 100 * 1000 * 1000;

export async function assertReadableImage(input: Buffer): Promise<{ width: number; height: number; format: string }> {
    const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata().catch(() => null);
    if (!metadata || !metadata.width || !metadata.height) {
        throw new Error("The file is not a readable image");
    }
    // EXIF orientations 5-8 swap width and height
    const swapped = (metadata.orientation || 1) >= 5;
    return {
        width: swapped ? metadata.height : metadata.width,
        height: swapped ? metadata.width : metadata.height,
        format: metadata.format || "unknown",
    };
}

function toRgbaImage(data: Buffer, width: number, height: number): RGBAImage {
    return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Largest crop with the canvas aspect ratio, positioned on the most interesting area (sharp attention strategy) */
export async function attentionCrop(raw: Buffer, width: number, height: number, aspect: number): Promise<PixelBox> {
    const size = fitCropToAspect(null, aspect, width, height);
    if (size.width === width && size.height === height) {
        return size;
    }
    const { info } = await sharp(raw, { raw: { width, height, channels: 4 } })
        .resize(size.width, size.height, { fit: "cover", position: sharp.strategy.attention })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const left = Math.min(width - size.width, Math.abs(info.cropOffsetLeft || 0));
    const top = Math.min(height - size.height, Math.abs(info.cropOffsetTop || 0));
    return { left, top, width: size.width, height: size.height };
}

export async function decodeImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // apply EXIF orientation
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

export async function prepareImage(input: Buffer, options: PrepareOptions): Promise<PreparedImage> {
    const decoded = await decodeImage(input);
    const canvas = resolveCanvasSize(options.canvasSize, options.orientation, decoded.width, decoded.height);

    let crop: PixelBox;
    let cropMethod: CropMethod;
    if (options.crop) {
        crop = fitCropToAspect(options.crop, canvas.aspect, decoded.width, decoded.height);
        cropMethod = "provided";
    } else {
        crop = await attentionCrop(decoded.data, decoded.width, decoded.height, canvas.aspect);
        cropMethod = "attention";
    }

    const { data, info } = await sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels: 4 } })
        .extract(crop)
        .resize({ width: options.maxSide, height: options.maxSide, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    return {
        image: toRgbaImage(data, info.width, info.height),
        canvas,
        crop,
        cropMethod,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
    };
}

/** Small version of the photo for quick analysis (complexity, crop suggestion) */
export async function loadForAnalysis(input: Buffer, maxSide: number = 1024): Promise<{ raw: Buffer; image: RGBAImage; scale: number; sourceWidth: number; sourceHeight: number }> {
    const decoded = await decodeImage(input);
    const { data, info } = await sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels: 4 } })
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { raw: data, image: toRgbaImage(data, info.width, info.height), scale: info.width / decoded.width, sourceWidth: decoded.width, sourceHeight: decoded.height };
}
