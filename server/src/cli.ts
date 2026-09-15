/**
 * Command line generation, same output as the API:
 *
 *   node server/dist/server/src/cli.js -i photo.jpg -o out/ --size 40x50
 *        [--colors 24] [--difficulty auto|easy|medium|hard] [--orientation auto|portrait|landscape]
 *        [--palette darlart-v2|none] [--paper a4] [--crop x,y,w,h] [--order 1001] [--seed 7707]
 */
import minimist from "minimist";
import path from "path";
import { parseCanvasSize, RelativeBox } from "../../src/core/crop";
import { PAPER_SIZES, PaperSize } from "../../src/core/pdf";
import { Difficulty, DIFFICULTIES } from "../../src/core/settings";
import { config } from "./config";
import { generate } from "./generate";
import { loadPalette } from "./palettes";

const USAGE = "Usage: node server/dist/server/src/cli.js -i <photo> -o <output dir> --size <e.g. 40x50> [--colors 24] [--difficulty auto] "
    + "[--orientation auto] [--palette darlart-v2|none] [--paper a4] [--crop x,y,w,h] [--order <id>] [--seed <n>]";

function fail(message: string): never {
    console.error(message);
    console.error(USAGE);
    process.exit(1);
}

async function main() {
    const args = minimist(process.argv.slice(2), {
        string: ["i", "o", "size", "difficulty", "orientation", "palette", "paper", "crop", "order"],
        alias: { i: "input", o: "output" },
    });
    if (!args.i || !args.o || !args.size) {
        fail("Missing -i, -o or --size");
    }
    if (!parseCanvasSize(args.size)) {
        fail(`Invalid --size "${args.size}"`);
    }

    const difficulty = (args.difficulty || "auto").toLowerCase();
    if (difficulty !== "auto" && !DIFFICULTIES.includes(difficulty as Difficulty)) {
        fail(`Invalid --difficulty "${difficulty}"`);
    }
    const orientation = (args.orientation || "auto").toLowerCase();
    if (!["auto", "portrait", "landscape"].includes(orientation)) {
        fail(`Invalid --orientation "${orientation}"`);
    }
    const paperSize = (args.paper || "a4").toLowerCase();
    if (!PAPER_SIZES.includes(paperSize as PaperSize)) {
        fail(`Invalid --paper "${paperSize}"`);
    }
    const colors = parseInt(String(args.colors || "24"), 10);
    if (!(colors >= 2 && colors <= 64)) {
        fail(`Invalid --colors "${args.colors}"`);
    }

    let crop: RelativeBox | null = null;
    if (args.crop) {
        const values = String(args.crop).split(",").map(Number);
        if (values.length !== 4 || values.some((v) => !isFinite(v) || v < 0 || v > 1)) {
            fail("--crop must be x,y,w,h with fractions between 0 and 1");
        }
        crop = { x: values[0], y: values[1], w: values[2], h: values[3] };
    }

    const paletteId = args.palette || config.defaultPalette;
    const outputDir = path.resolve(args.o);
    const result = await generate({
        inputPath: path.resolve(args.i),
        outputDir,
        canvasSize: args.size,
        orientation: orientation as "auto" | "portrait" | "landscape",
        colors,
        difficulty: difficulty as Difficulty | "auto",
        crop,
        paperSize: paperSize as PaperSize,
        paletteId,
        customColors: loadPalette(paletteId),
        orderId: args.order || "",
        randomSeed: args.seed !== undefined ? parseInt(String(args.seed), 10) : undefined,
    }, (step, progress) => {
        process.stdout.write(`\r${Math.round(progress * 100)}% ${step}          `);
    });

    process.stdout.write("\n");
    console.log(`Difficulty: ${result.difficulty} (${result.difficultySource}, score ${result.complexity.score.toFixed(3)})`);
    console.log(`Canvas: ${result.canvas.label} cm, crop ${result.crop.width}x${result.crop.height} at ${result.crop.left},${result.crop.top} (${result.crop.method})`);
    console.log(`Colors used: ${result.colorsUsed}/${result.colorsRequested}, facets: ${result.facets}, ${Math.round(result.durationMs / 1000)}s`);
    for (const file of result.files) {
        console.log(`  ${path.join(outputDir, file.name)} (${Math.round(file.size / 1024)} KB)`);
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
