/**
 * One generation job: photo → prepared image → paint by numbers → PDF, SVG, preview PNG and palette JSON
 */
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { jsPDF } from "jspdf";
import { ComplexityMetrics, suggestDifficulty } from "../../src/core/complexity";
import { PixelBox, RelativeBox, ResolvedCanvasSize } from "../../src/core/crop";
import { buildPaletteEntries, groupPaletteEntries } from "../../src/core/palette";
import { buildPdf, JsPdfConstructor, PaperSize } from "../../src/core/pdf";
import { PipelineStep, runPipeline } from "../../src/core/pipeline";
import { buildSettings, Difficulty } from "../../src/core/settings";
import { buildSvgString } from "../../src/core/svg";
import { CropMethod, CropMode, prepareImage } from "./image";

export interface GenerateRequest {
    inputPath: string;
    outputDir: string;
    canvasSize: string;
    orientation: "auto" | "portrait" | "landscape";
    colors: number;
    difficulty: Difficulty | "auto";
    crop: RelativeBox | null;
    /** Used when no crop box is given: "center" for photos already cropped by the customer */
    cropMode: CropMode;
    paperSize: PaperSize;
    paletteId: string;
    /** Palette text resolved by the API ("" for no palette) */
    customColors: string;
    orderId: string;
    randomSeed?: number;
}

export interface OutputFile {
    name: string;
    downloadName: string;
    contentType: string;
    size: number;
}

export interface PaletteColorInfo {
    number: number;
    hex: string;
    code: string;
    rgb: number[];
    /** Share of the painted area (0-1), useful to estimate paint quantities */
    areaPercentage: number;
    used: boolean;
}

export interface GenerateResult {
    downloadBaseName: string;
    canvas: ResolvedCanvasSize;
    crop: PixelBox & { method: CropMethod };
    source: { width: number; height: number };
    processed: { width: number; height: number };
    difficulty: Difficulty;
    difficultySource: "requested" | "auto";
    complexity: ComplexityMetrics;
    colorsRequested: number;
    colorsUsed: number;
    facets: number;
    palette: { family: string; colors: PaletteColorInfo[] }[];
    files: OutputFile[];
    durationMs: number;
}

export type ProgressStep = PipelineStep | "prepare" | "output";

const STEP_RANGES: { [key in ProgressStep]: [number, number] } = {
    prepare: [0, 0.05],
    kmeans: [0.05, 0.3],
    facetBuilding: [0.3, 0.4],
    facetReduction: [0.4, 0.6],
    borderTracing: [0.6, 0.7],
    borderSegmentation: [0.7, 0.8],
    labelPlacement: [0.8, 0.9],
    output: [0.9, 1],
};

export const OUTPUT_FILES = {
    pdf: { name: "template.pdf", contentType: "application/pdf" },
    svg: { name: "template.svg", contentType: "image/svg+xml" },
    preview: { name: "preview.png", contentType: "image/png" },
    palette: { name: "palette.json", contentType: "application/json" },
};

function safeFileName(text: string) {
    return text.replace(/[^\w\- .#]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "paintbynumbers";
}

export async function generate(request: GenerateRequest, onProgress: (step: ProgressStep, overall: number) => void = () => undefined): Promise<GenerateResult> {
    const startedAt = Date.now();
    const report = (step: ProgressStep, progress: number) => {
        const [from, to] = STEP_RANGES[step];
        onProgress(step, from + (to - from) * Math.max(0, Math.min(1, progress)));
    };

    report("prepare", 0);
    const input = await fs.readFile(request.inputPath);
    const prepared = await prepareImage(input, {
        canvasSize: request.canvasSize,
        orientation: request.orientation,
        crop: request.crop,
        cropMode: request.cropMode || "attention",
        maxSide: 1024,
    });

    const suggestion = suggestDifficulty(prepared.image);
    const difficulty: Difficulty = request.difficulty === "auto" ? suggestion.difficulty : request.difficulty;
    const settings = buildSettings({
        colors: request.colors,
        difficulty,
        customColors: request.customColors,
        randomSeed: request.randomSeed,
    });
    report("prepare", 1);

    const result = await runPipeline(prepared.image, settings, {
        onProgress: (step, progress) => report(step, progress),
    });

    report("output", 0);
    await fs.mkdir(request.outputDir, { recursive: true });
    const downloadBaseName = safeFileName(`${request.orderId || "paintbynumbers"} ${request.colors} ${difficulty} ${prepared.canvas.label}`);
    const files: OutputFile[] = [];
    const writeOutput = async (file: { name: string; contentType: string }, extension: string, data: Buffer | string) => {
        await fs.writeFile(path.join(request.outputDir, file.name), data);
        const size = typeof data === "string" ? Buffer.byteLength(data) : data.length;
        files.push({ name: file.name, downloadName: `${downloadBaseName}${extension}`, contentType: file.contentType, size });
    };

    // PDF: colored page, numbered outline, legend grouped by family
    const doc = buildPdf(jsPDF as unknown as JsPdfConstructor, result, { paperSize: request.paperSize });
    await writeOutput(OUTPUT_FILES.pdf, ".pdf", Buffer.from(doc.output("arraybuffer")));
    report("output", 0.4);

    // SVG: colored with borders and numbers (same as the website "Download SVG")
    await writeOutput(OUTPUT_FILES.svg, ".svg", buildSvgString(result.facetResult, result.colorsByIndex, { fill: true, stroke: true, labels: true }));
    report("output", 0.6);

    // Preview: colored template without numbers
    const previewSvg = buildSvgString(result.facetResult, result.colorsByIndex, { fill: true, stroke: false, labels: false, sizeMultiplier: 2 });
    const preview = await sharp(Buffer.from(previewSvg)).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    await writeOutput(OUTPUT_FILES.preview, "-preview.png", preview);
    report("output", 0.8);

    // Palette with paint codes, families and area share
    const pointsByColor = new Array(result.colorsByIndex.length).fill(0);
    let facets = 0;
    for (const f of result.facetResult.facets) {
        if (f != null) {
            pointsByColor[f.color] += f.pointCount;
            facets++;
        }
    }
    const totalPoints = pointsByColor.reduce((sum: number, v: number) => sum + v, 0) || 1;
    const rows = groupPaletteEntries(buildPaletteEntries(result.colorsByIndex, result.colorCodes));
    const palette = rows.map((row) => ({
        family: row.label,
        colors: row.entries.map((entry) => ({
            number: entry.number,
            hex: entry.hex,
            code: entry.code,
            rgb: entry.color.slice(0, 3),
            areaPercentage: pointsByColor[entry.number - 1] / totalPoints,
            used: pointsByColor[entry.number - 1] > 0,
        })),
    }));
    const colorsUsed = pointsByColor.filter((points: number) => points > 0).length;

    const resultInfo: GenerateResult = {
        downloadBaseName,
        canvas: prepared.canvas,
        crop: { ...prepared.crop, method: prepared.cropMethod },
        source: { width: prepared.sourceWidth, height: prepared.sourceHeight },
        processed: { width: prepared.image.width, height: prepared.image.height },
        difficulty,
        difficultySource: request.difficulty === "auto" ? "auto" : "requested",
        complexity: suggestion.metrics,
        colorsRequested: request.colors,
        colorsUsed,
        facets,
        palette,
        files,
        durationMs: 0,
    };
    await writeOutput(OUTPUT_FILES.palette, "-palette.json", JSON.stringify({ orderId: request.orderId, paletteId: request.paletteId, difficulty, canvas: prepared.canvas, palette }, null, 2));
    report("output", 1);

    resultInfo.durationMs = Date.now() - startedAt;
    return resultInfo;
}
