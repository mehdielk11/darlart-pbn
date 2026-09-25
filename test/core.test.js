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
const { recolorToPalette } = require(path.join(dist, "server/src/recolor"));
const { fitToCanvas } = require(path.join(dist, "server/src/reference"));
const { buildFeatured, toWebp } = require(path.join(dist, "server/src/mockup"));

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

test("parseCustomColors reads palettes whose values are objects", () => {
    // { "#HEX": { rgb, code } } as exported by the palette tool
    const parsed = parseCustomColors(JSON.stringify({
        "#FFBBE4": { rgb: [255, 187, 228], code: "0101" },
        "#FC6286": { rgb: [252, 98, 134], code: "0105" },
    }));
    assert.deepEqual(parsed.restrictions, [[255, 187, 228], [252, 98, 134]]);
    assert.equal(parsed.codes["#FFBBE4"], "0101");
    assert.equal(parsed.codes["255,187,228"], "0101");
    assert.equal(parsed.codes["#FC6286"], "0105");
    // the color can also be in the value, keyed by its code or name
    const byCode = parseCustomColors(JSON.stringify({ "0101": { rgb: [255, 187, 228] }, blush: { hex: "#FC6286", code: "0105" } }));
    assert.deepEqual(byCode.restrictions, [[255, 187, 228], [252, 98, 134]]);
    assert.equal(byCode.codes["#FFBBE4"], "0101");
    assert.equal(byCode.codes["#FC6286"], "0105");
    // a list of objects keeps working
    const list = parseCustomColors(JSON.stringify([{ color: "#FFBBE4", code: "0101" }, { rgb: [252, 98, 134], id: "0105" }]));
    assert.deepEqual(list.restrictions, [[255, 187, 228], [252, 98, 134]]);
    assert.equal(list.codes["#FC6286"], "0105");
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
    // a square photo is portrait
    assert.equal(resolveCanvasSize("60x75", "auto", 1024, 1024).label, "60x75");
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

test("recolorToPalette paints a photo with exactly N palette colors, never an excluded one", { timeout: 60000 }, async () => {
    const sharp = require("sharp");
    const v3Text = fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8");
    const v3 = JSON.parse(v3Text);
    const result = await recolorToPalette(fs.readFileSync(photoImage), { colors: 48, palette: v3Text, exclude: ["3801", "3811"], maxSide: 1024, smooth: 3 });
    assert.equal(result.colors.length, 48);
    const listed = new Set(result.colors.map((c) => c.hex));
    for (const color of result.colors) {
        assert.equal(v3[color.hex].code, color.code);
        assert.ok(!["3801", "3811"].includes(color.code));
    }
    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
    const seen = new Set();
    for (let i = 0; i < data.length; i += info.channels) {
        seen.add("#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase());
    }
    assert.deepEqual([...seen].sort(), [...listed].sort());
    assert.equal(Math.round(result.colors.reduce((sum, c) => sum + c.percent, 0)), 100);
});

test("recolorToPalette keeps every chosen color, even one no pixel is nearest to", async () => {
    const sharp = require("sharp");
    // two near-identical pinks: both are chosen, but every pixel of the second is nearer to the first one's paint
    const A = [255, 187, 228];
    const B = [255, 187, 237];
    const C = [20, 90, 200];
    const W = 90;
    const H = 30;
    const raw = Buffer.alloc(W * H * 3);
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const c = x < 30 ? A : x < 60 ? B : C;
            raw.set(c, (y * W + x) * 3);
        }
    }
    const image = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const v3Text = fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8");
    const result = await recolorToPalette(image, { colors: 3, palette: v3Text, exclude: [], maxSide: 2048, smooth: 0 });
    assert.equal(result.colors.length, 3);
    assert.ok(result.colors.every((c) => c.pixels > 0));
    // the painted image really holds those 3 colors
    const { data } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
    const seen = new Set();
    for (let o = 0; o < data.length; o += 3) seen.add(data[o] + "," + data[o + 1] + "," + data[o + 2]);
    assert.equal(seen.size, 3);
});

test("fitToCanvas crops to the exact canvas ratio without stretching", async () => {
    const sharp = require("sharp");
    for (const [w, h] of [[1024, 1536], [1536, 1024], [1024, 1280]]) {
        const img = await sharp({ create: { width: w, height: h, channels: 3, background: "#888888" } }).png().toBuffer();
        const fitted = await fitToCanvas(img, "60x75", "portrait");
        const meta = await sharp(fitted.image).metadata();
        assert.equal(fitted.label, "60x75");
        assert.ok(Math.abs(meta.width / meta.height - 0.8) < 0.002, `${w}x${h} -> ${meta.width}x${meta.height}`);
        assert.ok(meta.width <= w && meta.height <= h, "only cropped, never enlarged or stretched");
    }
});

test("buildFeatured puts the artwork on the canvas photo of its orientation", async () => {
    const sharp = require("sharp");
    for (const [w, h, name] of [[1024, 1280, "portrait"], [1280, 1024, "landscape"], [1024, 1024, "portrait"]]) {
        const art = await sharp({ create: { width: w, height: h, channels: 3, background: "#cc2200" } }).png().toBuffer();
        const featured = await buildFeatured(art, 800);
        assert.equal(featured.template.name, name, `${w}x${h}`);
        assert.equal((await sharp(featured.png).metadata()).format, "png");
        const { data, info } = await sharp(featured.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.width, 800);
        assert.equal(info.height, 800);
        const face = featured.template.face;
        const at = (x, y) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
        const [r, g, b] = at(Math.round(face.left + face.width / 2), Math.round(face.top + face.height / 2));
        assert.ok(r > 180 && g < 60 && b < 40, "the artwork fills the canvas face");
        const corner = at(5, 5);
        assert.ok(corner[0] > 180 && Math.abs(corner[0] - corner[2]) < 12, "the wall stays grey");
    }
});

test("toWebp makes a lighter WebP copy of the same size", async () => {
    const sharp = require("sharp");
    const png = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#cc2200" } })
        .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><circle cx="512" cy="640" r="400" fill="#2266aa"/></svg>') }])
        .png().toBuffer();
    const result = await toWebp(png);
    const meta = await sharp(result.webp).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1280);
    assert.ok(result.webp.length < png.length, "smaller than the PNG");
    assert.equal((await toWebp(png, 80, 512)).width, 410, "maxSide shrinks it, keeping the ratio");
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

        assert.deepEqual(result.files.map((f) => f.name).sort(), ["blank.svg", "canvas.png", "canvas.svg", "mockup.png", "painting.pdf", "palette.json", "preview.png", "template.pdf", "template.svg"]);

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

        // the canvas SVG: the same faint look as canvas.png, with slightly stronger colors, and the same numbers
        const blankSvg = fs.readFileSync(path.join(outputDir, "blank.svg"), "utf8");
        assert.ok(!/fill: rgb/.test(blankSvg), "blank.svg has no colored regions");
        assert.ok(/stroke: #6a6f77/.test(blankSvg) && /<text[^>]*fill="#000000"/.test(blankSvg), "blank.svg: grey outlines, black numbers");
        const canvasSvg = fs.readFileSync(path.join(outputDir, "canvas.svg"), "utf8");
        assert.ok(canvasSvg.includes('<rect width="100%" height="100%" fill="#ffffff">'), "the canvas SVG should be on white");
        assert.equal([...canvasSvg.matchAll(/<\/text>/g)].length, [...svg.matchAll(/<\/text>/g)].length);
        const faintness = (text) => {
            const fills = [...text.matchAll(/fill: rgb\((\d+),(\d+),(\d+)\)/g)];
            return fills.reduce((sum, m) => sum + (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3, 0) / fills.length;
        };
        const templateBrightness = faintness(svg);
        const canvasBrightness = faintness(canvasSvg);
        // faded toward white, but not as pale as the preview canvas.png
        assert.ok(canvasBrightness > templateBrightness, `canvas.svg (${canvasBrightness}) should be paler than the template (${templateBrightness})`);
        assert.ok(canvasBrightness < 255, "canvas.svg should still be colored");

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

test("createGate runs one heavy task at a time, in order, and a failed task frees its turn", async () => {
    const { createGate } = require(path.join(dist, "server/src/gate"));
    const gate = createGate(1);
    const order = [];
    let running = 0;
    let peak = 0;
    const task = (name, fail) => gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(name);
        running--;
        if (fail) throw new Error("boom " + name);
        return name;
    });
    const results = await Promise.allSettled([task("a"), task("b", true), task("c"), task("d")]);
    assert.equal(peak, 1);
    assert.deepEqual(order, ["a", "b", "c", "d"]);
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    assert.deepEqual(gate.stats(), { running: 0, waiting: 0, limit: 1 });
});
