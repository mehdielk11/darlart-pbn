// Tests for the shared core and the API generation (run with `npm test`, uses the compiled server/dist)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "server", "dist");
const { parseCustomColors, buildSettings, DEFAULT_RANDOM_SEED } = require(path.join(dist, "src/core/settings"));
const { reorderColorsByFamily, buildPaletteEntries, groupPaletteEntries } = require(path.join(dist, "src/core/palette"));
const { fitCropToAspect, resolveCanvasSize, PRINT_FORMATS, PRINT_FORMAT_IDS, parsePrintFormat, printFormatForCanvas } = require(path.join(dist, "src/core/crop"));
const { suggestDifficulty } = require(path.join(dist, "src/core/complexity"));
const { fadeColors } = require(path.join(dist, "src/core/svg"));
const { findPaletteFamily } = require(path.join(dist, "src/palettefamilies"));
const { decodeImage } = require(path.join(dist, "server/src/image"));
const { generate } = require(path.join(dist, "server/src/generate"));

const paletteText = fs.readFileSync(path.join(root, "server/palettes/darlart-v2.json"), "utf8");
const simpleImage = path.join(root, "src-cli/testinput.png");
const photoImage = path.join(root, "src-cli/testinputmedium.png");

test("parseCustomColors reads the Darl'Art JSON palette with its codes", () => {
    const parsed = parseCustomColors(paletteText);
    assert.equal(parsed.restrictions.length, 409);
    assert.equal(parsed.codes["#FC6286"], "0101");
    assert.equal(parsed.codes["#fc6286"], "0101");
    assert.equal(parsed.codes["252,98,134"], "0101");
    // colors shared by Famille 32 and 35 keep the code of the JSON file
    assert.equal(parsed.codes["#C76C98"], "3201");
});

test("parseCustomColors reads hex and rgb lines with optional codes and comments", () => {
    const parsed = parseCustomColors("#FC6286, 0101\n// ignored\n255,255,255\n128,64,32: 0305\n#abc");
    assert.deepEqual(parsed.restrictions, [[252, 98, 134], [255, 255, 255], [128, 64, 32], [170, 187, 204]]);
    assert.equal(parsed.codes["#FC6286"], "0101");
    assert.equal(parsed.codes["128,64,32"], "0305");
    assert.equal(parsed.codes["255,255,255"], undefined);
});

test("buildSettings applies the difficulty preset and a fixed seed", () => {
    const settings = buildSettings({ colors: 36, difficulty: "hard", customColors: paletteText });
    assert.equal(settings.kMeansNrOfClusters, 36);
    assert.equal(settings.removeFacetsSmallerThanNrOfPoints, 30);
    assert.equal(settings.narrowPixelStripCleanupRuns, 5);
    assert.equal(settings.randomSeed, DEFAULT_RANDOM_SEED);
    assert.equal(settings.kMeansColorRestrictions.length, 409);
});

test("family lookup uses the paint code for the colors shared by Famille 32 and 35", () => {
    assert.equal(findPaletteFamily("#c76c98", "3201").label, "Famille 32");
    assert.equal(findPaletteFamily("#C76C98", "3501").label, "Famille 35");
    assert.equal(findPaletteFamily("#C76C98").label, "Famille 32");
    assert.equal(findPaletteFamily("#123456"), null);
});

test("reorderColorsByFamily renumbers colors in family order and remaps the facets", () => {
    const codes = parseCustomColors(paletteText).codes;
    const colors = [[10, 10, 12], [1, 2, 3], [252, 98, 134]]; // 3811, no family, 0101
    const facetResult = { facets: [{ color: 0 }, { color: 1 }, null, { color: 2 }] };
    const reordered = reorderColorsByFamily(colors, codes, facetResult);
    assert.deepEqual(reordered, [[252, 98, 134], [10, 10, 12], [1, 2, 3]]);
    assert.deepEqual(facetResult.facets.map((f) => f && f.color), [1, 2, null, 0]);

    const rows = groupPaletteEntries(buildPaletteEntries(reordered, codes));
    assert.deepEqual(rows.map((r) => r.label), ["Famille 01", "Famille 38 — Échelle blanc / gris / noir", "Other colors"]);
    assert.deepEqual(rows.map((r) => r.entries.map((e) => e.number)), [[1], [2], [3]]);
});

test("palettes without Darl'Art colors are split in unlabelled rows", () => {
    const colors = Array.from({ length: 12 }, (_, i) => [i, i, i + 1]);
    const rows = groupPaletteEntries(buildPaletteEntries(colors, {}));
    assert.deepEqual(rows.map((r) => [r.label, r.entries.length]), [["", 9], ["", 3]]);
});

test("resolveCanvasSize follows the photo orientation", () => {
    assert.deepEqual(resolveCanvasSize("30x40", "auto", 1366, 768), { widthCm: 40, heightCm: 30, orientation: "landscape", aspect: 4 / 3, label: "40x30" });
    assert.equal(resolveCanvasSize("40x30", "auto", 600, 900).label, "30x40");
    assert.equal(resolveCanvasSize("40x50", "landscape", 600, 900).label, "50x40");
    assert.equal(resolveCanvasSize("50x50", "portrait", 600, 900).orientation, "square");
    assert.throws(() => resolveCanvasSize("big", "auto", 10, 10));
});

test("print formats keep the A series shape and are recognised by name", () => {
    assert.deepEqual(PRINT_FORMAT_IDS, ["a4", "a3", "a2"]);
    for (const format of PRINT_FORMATS) {
        const resolved = resolveCanvasSize(format.canvasSize, "portrait", 600, 900);
        assert.ok(Math.abs(resolved.aspect - 1 / Math.SQRT2) < 0.001, `${format.label} aspect ${resolved.aspect}`);
    }
    // the cm pair travels to the API, so decimals must survive the round trip
    assert.equal(resolveCanvasSize("21x29.7", "portrait", 600, 900).label, "21x29.7");
    assert.equal(resolveCanvasSize("21x29.7", "landscape", 900, 600).label, "29.7x21");

    assert.equal(parsePrintFormat("A3").id, "a3");
    assert.equal(parsePrintFormat("Format A4 — 21 × 29,7 cm").id, "a4");
    assert.equal(parsePrintFormat("40x50"), null);

    assert.equal(printFormatForCanvas("29.7x42").label, "A3");
    assert.equal(printFormatForCanvas("59.4x42").label, "A2"); // landscape
    assert.equal(printFormatForCanvas("30x40"), null);
});

test("fadeColors mixes each color toward white", () => {
    assert.deepEqual(fadeColors([[255, 255, 255], [0, 0, 0], [200, 100, 50]], 0.35), [[255, 255, 255], [166, 166, 166], [236, 201, 183]]);
    assert.deepEqual(fadeColors([[10, 20, 30]], 1), [[10, 20, 30]]);
    assert.deepEqual(fadeColors([[10, 20, 30]], 0), [[255, 255, 255]]);
});

test("fitCropToAspect always returns a box with the right aspect inside the image", () => {
    const centered = fitCropToAspect(null, 0.75, 1000, 500);
    assert.deepEqual(centered, { left: 313, top: 0, width: 375, height: 500 });

    // AI box that is too wide, partly outside the image and with the wrong aspect
    const boxes = [{ x: 0.9, y: 0, w: 0.5, h: 1 }, { x: 0.1, y: 0.2, w: 0.2, h: 0.1 }, { x: 0, y: 0, w: 1, h: 1 }];
    for (const box of boxes) {
        const fitted = fitCropToAspect(box, 0.75, 1000, 500);
        assert.ok(fitted.left >= 0 && fitted.top >= 0, JSON.stringify(fitted));
        assert.ok(fitted.left + fitted.width <= 1000 && fitted.top + fitted.height <= 500, JSON.stringify(fitted));
        assert.ok(Math.abs(fitted.width / fitted.height - 0.75) < 0.01, JSON.stringify(fitted));
    }
    // a small box away from the edges keeps its center
    const small = fitCropToAspect({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 }, 0.75, 1000, 500);
    assert.ok(Math.abs(small.left + small.width / 2 - 400) <= 1 && Math.abs(small.top + small.height / 2 - 225) <= 1, JSON.stringify(small));
});

test("center crop mode keeps a photo already cropped by the customer", async () => {
    const sharp = require("sharp");
    const { prepareImage } = require(path.join(dist, "server/src/image"));
    const photo = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } }).png().toBuffer();
    const options = { canvasSize: "30x40", orientation: "landscape", crop: null, cropMode: "center", maxSide: 1024 };

    // exactly 4:3 like a 40x30 landscape canvas: nothing is cut
    const exact = await prepareImage(await photo(1200, 900), options);
    assert.deepEqual(exact.crop, { left: 0, top: 0, width: 1200, height: 900 });
    assert.equal(exact.cropMethod, "center");

    // one pixel too wide (rounding in the browser): only that pixel is trimmed
    const offByOne = await prepareImage(await photo(1201, 900), options);
    assert.deepEqual(offByOne.crop, { left: 1, top: 0, width: 1200, height: 900 });
});

test("suggestDifficulty scores a detailed photo higher than a simple image", async () => {
    const toImage = (d) => ({ width: d.width, height: d.height, data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.length) });
    const simple = suggestDifficulty(toImage(await decodeImage(fs.readFileSync(simpleImage))));
    const photo = suggestDifficulty(toImage(await decodeImage(fs.readFileSync(photoImage))));
    console.log("simple image:", simple.difficulty, simple.metrics);
    console.log("photo:", photo.difficulty, photo.metrics);
    assert.ok(photo.metrics.score > simple.metrics.score);
    assert.equal(simple.difficulty, "easy");
    assert.equal(photo.difficulty, "hard");
});

test("generate produces the PDF, SVG, preview and palette for a photo", { timeout: 300000 }, async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbn-test-"));
    try {
        const result = await generate({
            inputPath: simpleImage,
            outputDir,
            canvasSize: "30x40",
            orientation: "auto",
            colors: 12,
            difficulty: "auto",
            crop: null,
            paperSize: "a4",
            paletteId: "darlart-v2",
            customColors: paletteText,
            orderId: "#1001",
        });

        assert.deepEqual(result.files.map((f) => f.name).sort(), ["canvas.png", "mockup.png", "painting.pdf", "palette.json", "preview.png", "template-blank.svg", "template.pdf", "template.svg"]);

        // the kit mockup keeps the kit photo's size
        const mockupMeta = await require("sharp")(path.join(outputDir, "mockup.png")).metadata();
        assert.deepEqual([mockupMeta.width, mockupMeta.height], [1254, 1254]);

        // the pre-printed canvas look: a real PNG, on white, carrying the numbers
        const canvasPng = fs.readFileSync(path.join(outputDir, "canvas.png"));
        assert.equal(canvasPng.subarray(1, 4).toString("latin1"), "PNG");
        const sharp = require("sharp");
        const canvasMeta = await sharp(canvasPng).metadata();
        assert.ok(Math.max(canvasMeta.width, canvasMeta.height) > 1000, `canvas.png is ${canvasMeta.width}x${canvasMeta.height}`);
        assert.ok(Math.abs(result.canvas.aspect - result.crop.width / result.crop.height) < 0.01);
        assert.ok(result.colorsUsed > 0 && result.colorsUsed <= 12);

        const pdf = fs.readFileSync(path.join(outputDir, "template.pdf"), "latin1");
        assert.ok(pdf.startsWith("%PDF"));
        const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
        assert.ok(pages >= 3, `expected at least 3 pages, got ${pages}`);

        // every number in the template exists in the palette and all palette colors have a paint code
        const svg = fs.readFileSync(path.join(outputDir, "template.svg"), "utf8");
        const labels = new Set([...svg.matchAll(/>(\d+)<\/text>/g)].map((m) => Number(m[1])));
        const numbers = new Set(result.palette.flatMap((row) => row.colors.map((c) => c.number)));
        assert.ok(labels.size > 0);
        for (const label of labels) {
            assert.ok(numbers.has(label), `label ${label} missing from the palette`);
        }
        // numbers on dark regions are written in white so they stay readable
        const darkFills = [...svg.matchAll(/fill: rgb\((\d+),(\d+),(\d+)\)/g)]
            .filter((m) => 0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3] < 140);
        if (darkFills.length > 0) {
            assert.ok(svg.includes('fill="#ffffff">'), "expected white numbers on the dark regions");
        }

        // the blank template: outlines and numbers, no colored fill
        const blank = fs.readFileSync(path.join(outputDir, "template-blank.svg"), "utf8");
        assert.ok(blank.includes("fill: none;"), "the blank template should not be filled");
        assert.ok(!/fill: rgb\(/.test(blank), "the blank template should have no colors");
        assert.equal([...blank.matchAll(/<\/text>/g)].length, [...svg.matchAll(/<\/text>/g)].length);

        // the painting guide: colored template with numbers, then the palette
        const painting = fs.readFileSync(path.join(outputDir, "painting.pdf"), "latin1");
        assert.ok(painting.startsWith("%PDF"));
        assert.equal((painting.match(/\/Type \/Page\b/g) || []).length, 2);

        const colors = result.palette.flatMap((row) => row.colors);
        assert.ok(colors.every((c) => /^\d{4}$/.test(c.code)), "every color should have a Darl'Art code");
        assert.ok(result.palette.every((row) => row.family.startsWith("Famille")));
        // numbers follow the family order
        assert.deepEqual(colors.map((c) => c.number), colors.map((_, i) => i + 1));
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});
