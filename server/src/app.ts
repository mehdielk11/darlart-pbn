/**
 * HTTP API (Fastify)
 *
 * POST /v1/jobs                    create a generation job (multipart "image" file, or JSON with "imageUrl")
 * GET  /v1/jobs/:id                job status, progress, result and file links
 * GET  /v1/jobs/:id/files/:name    download template.pdf, template.svg, preview.png or palette.json
 * POST /v1/analyze                 photo complexity, suggested difficulty and a crop suggestion
 * POST /v1/recolor                 repaint an image with exactly N palette colors (PNG as base64 + the colors used)
 * POST /v1/featured                featured product image: the artwork on a canvas photo (PNG as base64)
 * POST /v1/webp                    a WebP copy of an image, for Shopify (WebP as base64)
 * GET  /v1/palettes                available palettes
 * GET  /health                     liveness check (no API key)
 */
import { timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { suggestDifficulty } from "../../src/core/complexity";
import { parseCanvasSize, RelativeBox, resolveCanvasSize } from "../../src/core/crop";
import { PAPER_SIZES, PaperSize } from "../../src/core/pdf";
import { Difficulty, DIFFICULTIES } from "../../src/core/settings";
import { config } from "./config";
import { OUTPUT_FILES } from "./generate";
import { assertReadableImage, attentionCrop, CROP_MODES, CropMode, loadForAnalysis } from "./image";
import { JobManager, JobOptions, publicJob } from "./jobs";
import { isValidPaletteId, listPalettes, loadPalette, NO_PALETTE } from "./palettes";
import { buildFeatured, toWebp, WEBP_QUALITY } from "./mockup";
import { recolorToPalette } from "./recolor";

class HttpError extends Error {
    constructor(public statusCode: number, message: string, public details?: string[]) {
        super(message);
    }
}

type Fields = { [key: string]: unknown };

const IMAGE_EXTENSIONS: { [format: string]: string } = { jpeg: ".jpg", png: ".png", webp: ".webp", tiff: ".tif", gif: ".gif", heif: ".heic", avif: ".avif" };

function keysMatch(provided: string, expected: string) {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads the fields and the image from a multipart form or a JSON body */
async function readInput(request: FastifyRequest): Promise<{ fields: Fields; image?: Buffer }> {
    const fields: Fields = {};
    let image: Buffer | undefined;
    if (request.isMultipart()) {
        try {
            for await (const part of request.parts()) {
                if (part.type === "file") {
                    const data = await part.toBuffer();
                    if (part.fieldname === "image") {
                        image = data;
                    }
                } else {
                    fields[part.fieldname] = part.value;
                }
            }
        } catch (e) {
            if (e instanceof Error && /too large/i.test(e.message)) {
                throw new HttpError(413, `Image is larger than ${Math.round(config.maxImageBytes / 1024 / 1024)} MB`);
            }
            throw e;
        }
    } else if (request.body && typeof request.body === "object") {
        Object.assign(fields, request.body as Fields);
    }
    return { fields, image };
}

async function downloadImage(url: string): Promise<Buffer> {
    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
    } catch (e) {
        throw new HttpError(422, `Could not download imageUrl: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok || !response.body) {
        throw new HttpError(422, `Could not download imageUrl: HTTP ${response.status}`);
    }
    const declared = parseInt(response.headers.get("content-length") || "0", 10);
    if (declared > config.maxImageBytes) {
        throw new HttpError(413, `Image is larger than ${Math.round(config.maxImageBytes / 1024 / 1024)} MB`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }
        size += value.length;
        if (size > config.maxImageBytes) {
            await reader.cancel();
            throw new HttpError(413, `Image is larger than ${Math.round(config.maxImageBytes / 1024 / 1024)} MB`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

async function resolveImage(fields: Fields, image?: Buffer): Promise<{ image: Buffer; extension: string; width: number; height: number }> {
    let data = image;
    if (!data) {
        const url = typeof fields.imageUrl === "string" ? fields.imageUrl.trim() : "";
        if (!url) {
            throw new HttpError(400, "Provide the photo as a multipart file field \"image\" or as \"imageUrl\"");
        }
        if (!/^https?:\/\//i.test(url)) {
            throw new HttpError(400, "imageUrl must be an http(s) URL");
        }
        data = await downloadImage(url);
    }
    try {
        const info = await assertReadableImage(data);
        return { image: data, extension: IMAGE_EXTENSIONS[info.format] || ".img", width: info.width, height: info.height };
    } catch (e) {
        throw new HttpError(422, e instanceof Error ? e.message : "The file is not a readable image");
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) { return undefined; }
    const text = String(value).trim();
    return text === "" ? undefined : text;
}

function parseCrop(value: unknown, errors: string[]): RelativeBox | null {
    if (value === undefined || value === null || value === "") { return null; }
    let crop: any = value;
    if (typeof value === "string") {
        try {
            crop = JSON.parse(value);
        } catch (e) {
            errors.push("crop must be a JSON object {x, y, w, h} with fractions between 0 and 1");
            return null;
        }
    }
    const numbers = ["x", "y", "w", "h"].map((key) => Number(crop && crop[key]));
    if (numbers.some((n) => !isFinite(n) || n < 0 || n > 1) || numbers[2] === 0 || numbers[3] === 0) {
        errors.push("crop must be {x, y, w, h} with fractions between 0 and 1 (w and h > 0)");
        return null;
    }
    return { x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3] };
}

export function parseJobOptions(fields: Fields): { options: JobOptions; callbackUrl?: string } {
    const errors: string[] = [];

    const canvasSize = asString(fields.canvasSize) || "";
    if (!parseCanvasSize(canvasSize)) {
        errors.push("canvasSize is required, e.g. \"40x50\"");
    }

    const orientation = (asString(fields.orientation) || "auto").toLowerCase();
    if (!["auto", "portrait", "landscape"].includes(orientation)) {
        errors.push("orientation must be auto, portrait or landscape");
    }

    const colors = Number(asString(fields.colors) || "24");
    if (!Number.isInteger(colors) || colors < 2 || colors > 64) {
        errors.push("colors must be an integer between 2 and 64 (the website offers 12, 24, 36, 48)");
    }

    const difficulty = (asString(fields.difficulty) || "auto").toLowerCase();
    if (difficulty !== "auto" && !DIFFICULTIES.includes(difficulty as Difficulty)) {
        errors.push("difficulty must be auto, easy, medium or hard");
    }

    const paperSize = (asString(fields.paperSize) || "a4").toLowerCase();
    if (!PAPER_SIZES.includes(paperSize as PaperSize)) {
        errors.push(`paperSize must be one of ${PAPER_SIZES.join(", ")}`);
    }

    const paletteId = asString(fields.palette) || config.defaultPalette;
    if (paletteId !== NO_PALETTE && !isValidPaletteId(paletteId)) {
        errors.push("palette is invalid");
    }

    const orderId = asString(fields.orderId) || "";
    if (orderId.length > 64) {
        errors.push("orderId must be at most 64 characters");
    }

    const crop = parseCrop(fields.crop, errors);

    const cropMode = (asString(fields.cropMode) || "attention").toLowerCase();
    if (!CROP_MODES.includes(cropMode as CropMode)) {
        errors.push(`cropMode must be one of ${CROP_MODES.join(", ")} ("center" for photos already cropped by the customer)`);
    }

    let randomSeed: number | undefined;
    if (asString(fields.randomSeed) !== undefined) {
        randomSeed = Number(fields.randomSeed);
        if (!Number.isInteger(randomSeed)) {
            errors.push("randomSeed must be an integer");
        }
    }

    const callbackUrl = asString(fields.callbackUrl);
    if (callbackUrl && !/^https?:\/\//i.test(callbackUrl)) {
        errors.push("callbackUrl must be an http(s) URL");
    }

    if (errors.length > 0) {
        throw new HttpError(400, "Invalid request", errors);
    }
    return {
        options: {
            canvasSize,
            orientation: orientation as JobOptions["orientation"],
            colors,
            difficulty: difficulty as JobOptions["difficulty"],
            crop,
            cropMode: cropMode as CropMode,
            paperSize: paperSize as PaperSize,
            paletteId,
            orderId,
            randomSeed,
        },
        callbackUrl,
    };
}

export async function buildApp(jobs: JobManager) {
    const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
    await app.register(multipart, { limits: { fileSize: config.maxImageBytes, files: 1, fields: 30 } });

    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.url.startsWith("/v1/") || !config.apiKey) {
            return;
        }
        const provided = request.headers["x-api-key"];
        if (typeof provided !== "string" || !keysMatch(provided, config.apiKey)) {
            return reply.code(401).send({ error: "Invalid or missing x-api-key header" });
        }
        return;
    });

    app.setErrorHandler((error: Error & { statusCode?: number; details?: string[] }, request, reply) => {
        const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
        if (statusCode >= 500) {
            request.log.error(error);
        }
        reply.code(statusCode).send({ error: statusCode >= 500 ? "Internal error" : error.message, details: error.details });
    });

    app.get("/health", async () => ({ ok: true, ...jobs.stats() }));

    app.get("/v1/palettes", async () => ({ default: config.defaultPalette, palettes: [NO_PALETTE, ...listPalettes()] }));

    app.post("/v1/jobs", async (request, reply) => {
        const { fields, image } = await readInput(request);
        const { options, callbackUrl } = parseJobOptions(fields);
        try {
            loadPalette(options.paletteId);
        } catch (e) {
            throw new HttpError(400, e instanceof Error ? e.message : String(e));
        }
        const resolved = await resolveImage(fields, image);
        const job = jobs.create(resolved.image, resolved.extension, options, callbackUrl);
        return reply.code(202).send(publicJob(job));
    });

    app.get("/v1/jobs/:id", async (request) => {
        const { id } = request.params as { id: string };
        const job = jobs.get(id);
        if (!job) {
            throw new HttpError(404, "Job not found");
        }
        return publicJob(job);
    });

    app.get("/v1/jobs/:id/files/:name", async (request, reply) => {
        const { id, name } = request.params as { id: string; name: string };
        const job = jobs.get(id);
        if (!job) {
            throw new HttpError(404, "Job not found");
        }
        const file = job.result && job.result.files.find((f) => f.name === name);
        if (!file || !Object.values(OUTPUT_FILES).some((f) => f.name === name)) {
            throw new HttpError(404, job.status === "completed" ? "File not found" : `Job is ${job.status}`);
        }
        const filePath = path.join(jobs.jobDir(id), file.name);
        if (!fs.existsSync(filePath)) {
            throw new HttpError(404, "File not found");
        }
        reply.header("content-type", file.contentType);
        reply.header("content-disposition", `attachment; filename="${file.downloadName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`);
        return reply.send(fs.createReadStream(filePath));
    });

    app.post("/v1/analyze", async (request) => {
        const { fields, image } = await readInput(request);
        const resolved = await resolveImage(fields, image);
        const analysis = await loadForAnalysis(resolved.image);
        const suggestion = suggestDifficulty(analysis.image);

        let cropSuggestion: object | undefined;
        const canvasSize = asString(fields.canvasSize);
        if (canvasSize) {
            if (!parseCanvasSize(canvasSize)) {
                throw new HttpError(400, "Invalid request", ["canvasSize must look like \"40x50\""]);
            }
            const orientation = (asString(fields.orientation) || "auto").toLowerCase() as "auto" | "portrait" | "landscape";
            const canvas = resolveCanvasSize(canvasSize, ["portrait", "landscape"].includes(orientation) ? orientation : "auto", analysis.image.width, analysis.image.height);
            const box = await attentionCrop(analysis.raw, analysis.image.width, analysis.image.height, canvas.aspect);
            cropSuggestion = {
                canvas,
                method: "attention",
                crop: {
                    x: box.left / analysis.image.width,
                    y: box.top / analysis.image.height,
                    w: box.width / analysis.image.width,
                    h: box.height / analysis.image.height,
                },
            };
        }

        return {
            width: resolved.width,
            height: resolved.height,
            suggestedDifficulty: suggestion.difficulty,
            complexity: suggestion.metrics,
            cropSuggestion,
        };
    });

    app.post("/v1/recolor", async (request) => {
        const { fields, image } = await readInput(request);
        const errors: string[] = [];
        const colors = Number(asString(fields.colors) || "48");
        if (!Number.isInteger(colors) || colors < 2 || colors > 64) {
            errors.push("colors must be an integer between 2 and 64");
        }
        const maxSide = Number(asString(fields.maxSide) || "2048");
        if (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 4096) {
            errors.push("maxSide must be an integer between 64 and 4096");
        }
        const smooth = Number(asString(fields.smooth) || "3");
        if (![0, 1, 3, 5].includes(smooth)) {
            errors.push("smooth must be 0, 1, 3 or 5");
        }
        const paletteId = asString(fields.palette) || config.defaultPalette;
        if (paletteId === NO_PALETTE || !isValidPaletteId(paletteId)) {
            errors.push("palette must name a palette from /v1/palettes");
        }
        if (errors.length) {
            throw new HttpError(400, "Invalid request", errors);
        }
        let palette: string;
        try {
            palette = loadPalette(paletteId);
        } catch (e) {
            throw new HttpError(400, e instanceof Error ? e.message : String(e));
        }
        const exclude = (asString(fields.exclude) || "").split(/[\s,;]+/).filter((code) => code);
        const canvasSize = asString(fields.canvasSize);
        if (canvasSize && !parseCanvasSize(canvasSize)) {
            throw new HttpError(400, "Invalid request", ["canvasSize must look like \"60x75\""]);
        }
        const orientation = (asString(fields.orientation) || "auto").toLowerCase() as "auto" | "portrait" | "landscape";
        if (!["auto", "portrait", "landscape"].includes(orientation)) {
            throw new HttpError(400, "Invalid request", ["orientation must be auto, portrait or landscape"]);
        }
        const resolved = await resolveImage(fields, image);
        let result;
        try {
            result = await recolorToPalette(resolved.image, { colors, palette, exclude, maxSide, smooth, canvasSize, orientation });
        } catch (e) {
            throw new HttpError(422, e instanceof Error ? e.message : String(e));
        }
        return {
            palette: paletteId,
            requestedColors: colors,
            colorCount: result.colors.length,
            width: result.width,
            height: result.height,
            colors: result.colors,
            image: result.png.toString("base64"),
        };
    });

    // The artwork (multipart "image" or "imageUrl") placed on the portrait or landscape canvas photo, whichever
    // matches its shape (a square artwork is portrait). Optional "size": the square image's side, 800 to 3000.
    app.post("/v1/featured", async (request) => {
        const { fields, image } = await readInput(request);
        const size = Number(asString(fields.size) || "1600");
        if (!Number.isInteger(size) || size < 800 || size > 3000) {
            throw new HttpError(400, "Invalid request", ["size must be an integer between 800 and 3000"]);
        }
        const resolved = await resolveImage(fields, image);
        let result;
        try {
            result = await buildFeatured(resolved.image, size);
        } catch (e) {
            throw new HttpError(422, e instanceof Error ? e.message : String(e));
        }
        return { template: result.template.name, width: size, height: size, contentType: "image/png", image: result.png.toString("base64") };
    });

    // A WebP copy of an image (multipart "image" or "imageUrl"). Optional "quality" (50-100) and "maxSide" (64-4096).
    app.post("/v1/webp", async (request) => {
        const { fields, image } = await readInput(request);
        const errors: string[] = [];
        const quality = Number(asString(fields.quality) || String(WEBP_QUALITY));
        if (!Number.isInteger(quality) || quality < 50 || quality > 100) {
            errors.push("quality must be an integer between 50 and 100");
        }
        const maxSideText = asString(fields.maxSide);
        const maxSide = maxSideText ? Number(maxSideText) : undefined;
        if (maxSide !== undefined && (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 4096)) {
            errors.push("maxSide must be an integer between 64 and 4096");
        }
        if (errors.length) {
            throw new HttpError(400, "Invalid request", errors);
        }
        const resolved = await resolveImage(fields, image);
        let result;
        try {
            result = await toWebp(resolved.image, quality, maxSide);
        } catch (e) {
            throw new HttpError(422, e instanceof Error ? e.message : String(e));
        }
        return { width: result.width, height: result.height, bytes: result.webp.length, sourceBytes: resolved.image.length, contentType: "image/webp", image: result.webp.toString("base64") };
    });

    return app;
}
