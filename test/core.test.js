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

        // the painting guide: colored template with numbers, the palette, then the paints and pots to pack
        const painting = fs.readFileSync(path.join(outputDir, "painting.pdf"), "latin1");
        assert.ok(painting.startsWith("%PDF"));
        assert.equal((painting.match(/\/Type \/Page\b/g) || []).length, 3);

        const colors = result.palette.flatMap((row) => row.colors);
        assert.ok(colors.every((c) => /^\d{4}$/.test(c.code)), "every color should have a Darl'Art code");
        assert.ok(result.palette.every((row) => row.family.startsWith("Famille")));
        // numbers follow the family order
        assert.deepEqual(colors.map((c) => c.number), colors.map((_, i) => i + 1));

        // the paint bill of materials of every canvas size sold: each color's area, paint and pots, the areas cover
        // that canvas, a smaller canvas never needs more paint
        // the sold sizes, turned like the canvas (this photo is landscape: 50x40)
        const turned = (size) => { const [a, b] = size.split("x").map(Number); return result.canvas.widthCm >= result.canvas.heightCm ? `${Math.max(a, b)}x${Math.min(a, b)}` : `${Math.min(a, b)}x${Math.max(a, b)}`; };
        assert.deepEqual(result.paints.kits.map((k) => k.canvas), ["40x50", "32x40", "20x25"].map(turned));
        for (const kit of result.paints.kits) {
            const [w, h] = kit.canvas.split("x").map(Number);
            assert.ok(Math.abs(colors.reduce((sum, c) => sum + c.paint[kit.canvas].areaCm2, 0) - w * h) < colors.length * 0.1, kit.canvas);
            assert.ok(colors.every((c) => c.paint[kit.canvas].ml > 0 && c.paint[kit.canvas].pots.reduce((ml, p) => ml + p.sizeMl * p.count, 0) >= c.paint[kit.canvas].ml));
            assert.ok(kit.totalMl > 0 && kit.totalPackedMl >= kit.totalMl);
            // this job's canvas is 30x40 (3:4): the 4:5 sizes sold are flagged as another shape
            assert.equal(kit.sameShape, false);
        }
        assert.ok(result.paints.kits[0].totalMl > result.paints.kits[1].totalMl && result.paints.kits[1].totalMl > result.paints.kits[2].totalMl);
        const saved = JSON.parse(fs.readFileSync(path.join(outputDir, "palette.json"), "utf8"));
        assert.deepEqual(saved.paints, result.paints);
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

test("despeckle merges the tiny areas of a very speckled image, and leaves an ordinary image alone", () => {
    const { despeckle } = require(path.join(dist, "src/core/despeckle"));
    const { Uint8Array2D } = require(path.join(dist, "src/structs/typedarrays"));
    const colors = [[255, 255, 255], [0, 0, 0], [200, 0, 0]];
    const w = 40, h = 40;
    const build = () => {
        const img = new Uint8Array2D(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x, y, x < 20 ? 0 : 2);
        // single-pixel specks on a checker grid, in both halves
        for (let y = 1; y < h; y += 3) for (let x = 1; x < w; x += 3) img.set(x, y, 1);
        return img;
    };
    // few areas: nothing changes
    const calm = build();
    const r0 = despeckle(w, h, calm, colors, 30, 100000);
    assert.equal(r0.passes, 0);
    assert.equal(calm.get(1, 1), 1);
    // many areas: every speck takes the color around it, the two halves stay
    const img = build();
    const r = despeckle(w, h, img, colors, 30, 10);
    assert.ok(r.merged >= 169);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.equal(img.get(x, y), x < 20 ? 0 : 2);
});

test("callout layout: dots inside their region and clear of every outline, numbers in the right region", async () => {
    const { runPipeline } = require(path.join(dist, "src/core/pipeline"));
    const { computeLabelLayout } = require(path.join(dist, "src/core/callouts"));
    const { getFacetOutline } = require(path.join(dist, "src/core/svg"));
    const { prepareImage } = require(path.join(dist, "server/src/image"));
    const prepared = await prepareImage(fs.readFileSync(photoImage), { canvasSize: "40x50", orientation: "portrait", crop: null, cropMode: "attention", maxSide: 1024 });
    const settings = buildSettings({ colors: 24, difficulty: "hard", customColors: paletteText });
    settings.despeckleTinyAreas = true;
    const log = console.log;
    console.log = () => undefined;
    let result;
    try { result = await runPipeline(prepared.image, settings); } finally { console.log = log; }
    const fr = result.facetResult;
    const layout = computeLabelLayout(fr);
    assert.ok(layout.callouts.size > 0, "a hard template has regions too small for their number");

    // a point belongs to the smallest drawn outline that contains it (a region can enclose others)
    const outlines = new Map();
    const areas = new Map();
    const segments = [];
    for (const f of fr.facets) {
        if (!f || f.borderSegments.length === 0) continue;
        const o = getFacetOutline(f);
        outlines.set(f.id, o);
        let a = 0;
        for (let i = 0, j = o.length - 1; i < o.length; j = i++) a += (o[j].x + o[i].x) * (o[j].y - o[i].y);
        areas.set(f.id, Math.abs(a / 2));
        for (let i = 1; i < o.length; i++) segments.push([o[i - 1], o[i]]);
    }
    const inPolygon = (p, poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
        }
        return c;
    };
    const inRegion = (id, p) => inPolygon(p, outlines.get(id)) &&
        !(fr.facets[id].neighbourFacets || []).some((n) => outlines.has(n) && areas.get(n) < areas.get(id) && inPolygon(p, outlines.get(n)));
    const distanceToOutlines = (p) => Math.min(...segments.map(([a, b]) => {
        const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }));
    for (const c of layout.callouts.values()) {
        assert.ok(inRegion(c.facetId, c.anchor), `the dot of region ${c.facetId} is outside it`);
        assert.ok(distanceToOutlines(c.anchor) >= c.dotRadius, `the dot of region ${c.facetId} touches an outline`);
        assert.ok(inRegion(c.hostFacetId, c.text), `the callout number of region ${c.facetId} is not in region ${c.hostFacetId}`);
    }
    for (const l of layout.labels.values()) {
        if (l.fontSize > 0) assert.ok(inRegion(l.facetId, l.center), `the number of region ${l.facetId} is outside it`);
    }
});

test("palette matching: an image already painted with N paints keeps every pixel's paint", () => {
    const { matchToPalette } = require(path.join(dist, "src/core/palettematch"));
    const palette = parseCustomColors(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8")).restrictions;
    const paints = [0, 40, 120, 250, 333, 401, 480, 565].map((i) => palette[i]);
    const W = 64, H = 40;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p++) {
        const c = paints[Math.floor((p % W) / 8)];
        data.set([c[0], c[1], c[2], 255], p * 4);
    }
    const match = matchToPalette(data, 4, paints.length, palette);
    for (let p = 0; p < W * H; p++) {
        assert.deepEqual(palette[match.paintOfPixel[p]], paints[Math.floor((p % W) / 8)]);
    }
});

test("palette matching: white and black areas keep the white and black paints, never a grey average", () => {
    const { matchToPalette } = require(path.join(dist, "src/core/palettematch"));
    const parsed = parseCustomColors(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8"));
    const byCode = (code) => parsed.restrictions.find((c) => parsed.codes[c.join()] === code);
    // large white and black areas, with lighter / darker neighbours that the old k-means averaged into greys
    const areas = [["3801", 30], ["3802", 6], ["3803", 6], ["3811", 30], ["3715", 6], ["3714", 6], ["0810", 8], ["2106", 8]];
    const W = areas.reduce((s, a) => s + a[1], 0), H = 20;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        let x = 0;
        for (const [code, width] of areas) {
            const c = byCode(code);
            for (let i = 0; i < width; i++, x++) data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
        }
    }
    const match = matchToPalette(data, 4, 5, parsed.restrictions);
    const codeAt = (x) => parsed.codes[parsed.restrictions[match.paintOfPixel[x]].join()];
    assert.equal(codeAt(0), "3801", "the white area stays white");
    assert.equal(codeAt(30 + 6 + 6), "3811", "the black area stays black");
    assert.equal(new Set(Array.from(match.paintOfPixel)).size, 5);
});

test("tone correction: a photo's warm off-white becomes white, a colored highlight and the mid-tones are left alone", () => {
    const { correctTones } = require(path.join(dist, "src/core/palettematch"));
    const image = (colors) => {
        const data = new Uint8ClampedArray(colors.length * 100 * 3);
        colors.forEach((c, i) => { for (let k = 0; k < 100; k++) data.set(c, (i * 100 + k) * 3); });
        return data;
    };
    // a white wall with a slight warm cast, mid-tones and a near-black
    const wall = image([[242, 237, 231], [128, 100, 80], [60, 90, 140], [12, 12, 14]]);
    const result = correctTones(wall, 3);
    assert.ok(result.applied && result.neutralised);
    assert.ok(wall[0] >= 250 && wall[2] >= 250 && Math.abs(wall[0] - wall[2]) <= 3, `white: ${wall.slice(0, 3)}`);
    assert.ok(wall[300 * 3] <= 3, "the near-black becomes black");
    const mid = wall.slice(100 * 3, 100 * 3 + 3);
    assert.ok(Math.abs(mid[0] - 128) <= 6 && Math.abs(mid[1] - 100) <= 6, `mid-tones barely move: ${mid}`);
    // a yellow fire as the brightest area: not neutralised, and dark-grey smoke is not pushed to black
    const fire = image([[253, 240, 170], [90, 70, 60], [45, 40, 38]]);
    const fireResult = correctTones(fire, 3);
    assert.ok(!fireResult.neutralised);
    assert.ok(fire[2] < 200, "the fire stays yellow");
    assert.deepEqual(Array.from(fire.slice(200 * 3, 200 * 3 + 3)), [45, 40, 38]);
});

test("generation: the legend only lists paints that are painted, and white / black areas keep their paints", { timeout: 120000 }, async () => {
    const sharp = require("sharp");
    const { runPipeline } = require(path.join(dist, "src/core/pipeline"));
    const { prepareImage } = require(path.join(dist, "server/src/image"));
    const v3Text = fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8");
    // an artwork painted with paints (white, black, greys, a gold and a blue) at 1024x1280, resized like the print agent's
    const W = 1024, H = 1280, raw = Buffer.alloc(W * H * 3);
    const paints = { "3801": [255, 255, 255], "3803": [231, 231, 231], "3811": [10, 10, 12], "3714": [30, 31, 28], "0810": [255, 182, 54], "2106": [0, 100, 176] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const code = y < 500 ? (x < 700 ? "3801" : "3803") : y < 1000 ? (x < 700 ? "3811" : "3714") : (x < 512 ? "0810" : "2106");
        raw.set(paints[code], (y * W + x) * 3);
    }
    const input = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const prepared = await prepareImage(input, { canvasSize: "60x75", orientation: "portrait", crop: null, cropMode: "center", maxSide: 1024 });
    // resized without blending: no in-between colors along the edges
    const seen = new Set();
    for (let o = 0; o < prepared.image.data.length; o += 4) seen.add(prepared.image.data.slice(o, o + 3).join());
    assert.equal(seen.size, 6);
    const settings = buildSettings({ colors: 24, difficulty: "hard", customColors: v3Text });
    const log = console.log;
    console.log = () => undefined;
    let result;
    try { result = await runPipeline(prepared.image, settings); } finally { console.log = log; }
    const used = new Set(result.facetResult.facets.filter((f) => f).map((f) => f.color));
    assert.equal(result.colorsByIndex.length, used.size, "no unused paint in the legend");
    const hexes = result.colorsByIndex.map((c) => c.join());
    for (const rgb of Object.values(paints)) assert.ok(hexes.includes(rgb.join()), `paint ${rgb} kept`);
    assert.equal(result.colorsByIndex.length, 6);
});

test("recolorToPalette uses white and near black when they are not excluded", { timeout: 60000 }, async () => {
    const sharp = require("sharp");
    const v3Text = fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8");
    // a slightly warm white wall, a near-black block and a few colors
    const W = 200, H = 200, raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = x < 100 ? [240, 236, 229] : y < 100 ? [18, 18, 20] : x < 150 ? [200, 60, 40] : [40, 120, 200];
        raw.set(c, (y * W + x) * 3);
    }
    const image = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const result = await recolorToPalette(image, { colors: 4, palette: v3Text, exclude: [], maxSide: 1024, smooth: 0 });
    const codes = result.colors.map((c) => c.code);
    assert.equal(result.colors.length, 4); // the image has 4 distinct colors
    assert.ok(codes.includes("3801"), `white used: ${codes}`);
    assert.ok(codes.includes("3811"), `near black used: ${codes}`);
    // the white wall is painted white, not a tinted off-white
    assert.equal(result.colors[0].code === "3801" || result.colors[1].code === "3801", true);
});

test("an artwork painted with paints is recognised even after a JPEG re-encode (the website's crop), a photo is not", { timeout: 60000 }, async () => {
    const sharp = require("sharp");
    const { isPaintedWithPalette } = require(path.join(dist, "src/core/palettematch"));
    const palette = parseCustomColors(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8")).restrictions;
    // flat areas of paints with soft blobs, like an artwork, re-encoded as JPEG
    const W = 400, H = 500, raw = Buffer.alloc(W * H * 3);
    const paints = [12, 100, 222, 301, 444, 520, 560].map((i) => palette[i]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        raw.set(paints[(Math.floor(x / 57) + Math.floor(y / 71) * 3 + (Math.hypot(x - 200, y - 250) < 90 ? 4 : 0)) % paints.length], (y * W + x) * 3);
    }
    const art = await sharp(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()).raw().toBuffer();
    assert.ok(isPaintedWithPalette(art, 3, palette));
    const photo = await sharp(fs.readFileSync(photoImage)).resize(600).removeAlpha().raw().toBuffer();
    assert.ok(!isPaintedWithPalette(photo, 3, palette));
});

test("tone correction never changes a bright color's hue (a peach stays peach, it doesn't turn cream)", () => {
    const { correctTones } = require(path.join(dist, "src/core/palettematch"));
    // a picture whose brightest area is a warm beige (white point and neutralisation apply), with a peach
    const data = new Uint8ClampedArray(400 * 3);
    for (let i = 0; i < 400; i++) data.set(i < 200 ? [236, 220, 207] : i < 300 ? [255, 226, 192] : [20, 20, 22], i * 3);
    correctTones(data, 3);
    const peach = data.slice(250 * 3, 250 * 3 + 3);
    // the peach keeps its channel ratios (green/red and blue/red as before, within rounding)
    assert.ok(Math.abs(peach[1] / peach[0] - 226 / 255) < 0.03 && Math.abs(peach[2] / peach[0] - 192 / 255) < 0.05, `peach: ${peach}`);
});

test("palette matching never uses more paints than asked, and exactly N in exact mode (the artwork's Check palette)", { timeout: 120000 }, async () => {
    const sharp = require("sharp");
    const { matchToPalette, correctTones } = require(path.join(dist, "src/core/palettematch"));
    const palette = parseCustomColors(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8")).restrictions;
    // sizes and counts that gave one to three paints too many before the fix (a swap left colors on a dropped paint)
    for (const side of [400, 700, 1024]) {
        const { data } = await sharp(fs.readFileSync(photoImage)).resize(side, side, { fit: "inside" }).removeAlpha().median(3).raw().toBuffer({ resolveWithObject: true });
        correctTones(data, 3);
        for (const n of [12, 24, 36, 48]) {
            assert.equal(matchToPalette(data, 3, n, palette, { exactCount: true }).paints.length, n, `exact, ${side}px, ${n} colors`);
            assert.ok(matchToPalette(data, 3, n, palette).paints.length <= n, `template, ${side}px, ${n} colors`);
        }
    }
});

test("paint plan: pots follow the need, a large color gets several pots, the areas add up to the canvas", () => {
    const { potsFor, describePots, planPaints, parsePaintSettings, DEFAULT_PAINT_SETTINGS } = require(path.join(dist, "src/core/paint"));
    const sizes = [3, 5, 10, 20];
    assert.deepEqual(potsFor(0.4, sizes), [{ sizeMl: 3, count: 1 }]);
    assert.deepEqual(potsFor(9.5, sizes), [{ sizeMl: 10, count: 1 }]);
    // least paint packed (26 ml, not 20 + 10 ml), then the fewest pots
    assert.deepEqual(potsFor(25.1, sizes), [{ sizeMl: 20, count: 1 }, { sizeMl: 3, count: 2 }]);
    assert.deepEqual(potsFor(39.5, sizes), [{ sizeMl: 20, count: 2 }]);
    assert.equal(describePots(potsFor(45, sizes)), "2 × 20 ml + 5 ml");
    // the default: 3 ml pots only
    assert.deepEqual(DEFAULT_PAINT_SETTINGS.potSizesMl, [3]);
    assert.deepEqual(potsFor(0.3, [2]), [{ sizeMl: 2, count: 1 }]);
    assert.deepEqual(potsFor(4.1, [2]), [{ sizeMl: 2, count: 3 }]);
    // mixed sizes, if ever set
    const small = [2, 2.5, 3];
    assert.deepEqual(potsFor(0.3, small), [{ sizeMl: 2, count: 1 }]);
    assert.deepEqual(potsFor(2.2, small), [{ sizeMl: 2.5, count: 1 }]);
    assert.deepEqual(potsFor(3, small), [{ sizeMl: 3, count: 1 }]);
    assert.deepEqual(potsFor(3.7, small), [{ sizeMl: 2, count: 2 }]);
    assert.deepEqual(potsFor(4.3, small), [{ sizeMl: 2.5, count: 1 }, { sizeMl: 2, count: 1 }]);
    assert.deepEqual(potsFor(8.9, small), [{ sizeMl: 3, count: 3 }]);
    // settings from the environment: invalid values keep the defaults
    const parsed = parsePaintSettings({ coverage: "40", margin: "abc", potSizes: "5, 15,30" });
    assert.equal(parsed.coverageCm2PerMl, 40);
    assert.equal(parsed.margin, DEFAULT_PAINT_SETTINGS.margin);
    assert.deepEqual(parsed.potSizesMl, [5, 15, 30]);
    // three colors on a 10x10 grid: 60 / 30 / 10 pixels on a 60x75 canvas
    const facet = (color, pointCount) => ({ color, pointCount });
    const facetResult = { facets: [facet(0, 50), facet(0, 10), facet(1, 30), facet(2, 10), null] };
    const plan = planPaints(facetResult, 3, { widthCm: 60, heightCm: 75 }, { coverageCm2PerMl: 30, margin: 0, mlPerRegion: 0, potSizesMl: sizes });
    assert.deepEqual(plan.colors.map((c) => c.areaCm2), [2700, 1350, 450]);
    assert.deepEqual(plan.colors.map((c) => c.regions), [2, 1, 1]);
    assert.deepEqual(plan.colors.map((c) => c.ml), [90, 45, 15]);
    assert.equal(plan.totalMl, 150);
    // 90 ml: four 20 ml pots and a 10 ml one, rather than a fifth 20 ml pot
    assert.deepEqual(plan.colors[0].pots, [{ sizeMl: 20, count: 4 }, { sizeMl: 10, count: 1 }]);
    // 15 ml: 10 + 5 ml, not a 20 ml pot
    assert.deepEqual(plan.colors[2].pots, [{ sizeMl: 10, count: 1 }, { sizeMl: 5, count: 1 }]);
    assert.equal(plan.potsBySize.reduce((n, p) => n + p.count, 0), 5 + 3 + 2);
});

test("paint plan per canvas size sold: turned like the template, per-region paint scaled, other shapes flagged", () => {
    const { planPaintsForSizes, planPaints, DEFAULT_PAINT_SETTINGS } = require(path.join(dist, "src/core/paint"));
    const facetResult = { facets: [{ color: 0, pointCount: 80 }, { color: 1, pointCount: 20 }] };
    const settings = { ...DEFAULT_PAINT_SETTINGS, canvasSizes: ["40x50", "20x25", "30x40"] };
    // a portrait 60x75 template: every size is planned portrait
    const plans = planPaintsForSizes(facetResult, 2, { widthCm: 60, heightCm: 75 }, settings);
    assert.deepEqual(plans.map((p) => p.label), ["40x50", "20x25", "30x40"]);
    assert.deepEqual(plans.map((p) => p.sameShape), [true, true, false]);
    assert.deepEqual(plans[0].colors.map((c) => c.areaCm2), [1600, 400]);
    // a landscape template turns the sizes too
    assert.equal(planPaintsForSizes(facetResult, 2, { widthCm: 75, heightCm: 60 }, settings)[0].label, "50x40");
    // the per-region extra is set for a 40x50 and shrinks with the canvas
    const perRegion = { coverageCm2PerMl: 1e9, margin: 0, mlPerRegion: 0.5, potSizesMl: [3], canvasSizes: [] };
    assert.equal(planPaints(facetResult, 2, { widthCm: 40, heightCm: 50 }, perRegion).colors[0].ml, 0.5);
    assert.equal(planPaints(facetResult, 2, { widthCm: 20, heightCm: 25 }, perRegion).colors[0].ml, 0.1);
});
