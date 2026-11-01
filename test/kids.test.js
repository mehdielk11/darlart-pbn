const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
test("strict kits retain 18 actually painted colors when cleanup removes rare regions", async () => {
    const { runPipeline } = require("../server/dist/src/core/pipeline");
    const { buildSettings, parseCustomColors } = require("../server/dist/src/core/settings");
    const { buildSvgString } = require("../server/dist/src/core/svg");
    const colors = parseCustomColors(fs.readFileSync(path.join(__dirname, "../server/palettes/darlart-v3.json"), "utf8")).restrictions.slice(0, 18);
    const image = { width: 120, height: 150, data: new Uint8ClampedArray(120 * 150 * 4) };
    for (let p = 0; p < 120 * 150; p++) image.data.set([...colors[0], 255], p * 4);
    for (let c = 1; c < 18; c++) {
        const x = 5 + (c % 6) * 18, y = 5 + Math.floor(c / 6) * 40;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) image.data.set([...colors[c], 255], ((y + dy) * 120 + x + dx) * 4);
    }
    const settings = buildSettings({ colors: 18, difficulty: "hard", customColors: JSON.stringify(colors.map(rgb => ({ rgb }))) });
    const classic = await runPipeline(image, settings);
    assert.ok(classic.colorsByIndex.length < 18, "fixture reproduces cleanup color loss");
    settings.preservePaletteColors = true;
    const strict = await runPipeline(image, settings);
    assert.equal(strict.colorsByIndex.length, 18);
    assert.equal(new Set(strict.colorsByIndex.map(c => c.join(","))).size, 18);
    const counts = new Map();
    for (const f of strict.facetResult.facets) if (f) counts.set(f.color, (counts.get(f.color) || 0) + f.pointCount);
    assert.equal(counts.size, 18);
    assert.ok([...counts.values()].every(n => n > 0));
    const svg = buildSvgString(strict.facetResult, strict.colorsByIndex, { labels: true });
    assert.equal(new Set([...svg.matchAll(/>(\d+)<\/text>/g)].map(m => m[1])).size, 18);
});

test("production SVG measures its painting separately from its footer; packing guide uses Kids size", async () => {
    const sharp = require("sharp");
    const { generate } = require("../server/dist/server/src/generate");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kids-production-"));
    try {
        const paletteText = fs.readFileSync(path.join(__dirname, "../server/palettes/darlart-v3.json"), "utf8");
        const colors = [...new Map(Object.entries(JSON.parse(paletteText)).map(([hex, value]) => [hex, value.rgb])).values()].slice(0, 18);
        const pixels = Buffer.alloc(240 * 300 * 3);
        for (let y = 0; y < 300; y++) for (let x = 0; x < 240; x++) {
            const c = colors[Math.floor(y / 100) * 6 + Math.floor(x / 40)];
            for (let k = 0; k < 3; k++) pixels[(y * 240 + x) * 3 + k] = c[k];
        }
        const inputPath = path.join(tmp, "input.png");
        await sharp(pixels, { raw: { width: 240, height: 300, channels: 3 } }).png().toFile(inputPath);
        const outputDir = path.join(tmp, "out");
        const result = await generate({ inputPath, outputDir, canvasSize: "24x30", orientation: "portrait", colors: 18, difficulty: "hard", crop: null, cropMode: "center", paperSize: "a4", paletteId: "darlart-v3", customColors: paletteText, orderId: "1208", requireExactColors: true, paintCanvasSizes: ["24x30"], physicalSvg: true });
        assert.equal(result.colorsUsed, 18);
        assert.deepEqual(result.paints.kits.map((k) => k.canvas), ["24x30"]);
        const svg = fs.readFileSync(path.join(outputDir, "blank.svg"), "utf8");
        assert.match(svg, /width="24cm"/);
        assert.match(svg, /data-painting-height-cm="30"/);
        assert.match(svg, /1208_18/);
        const height = Number(/height="([\d.]+)cm"/.exec(svg)[1]);
        assert.ok(height > 30, "the identification footer is outside the 30 cm painting");
        const landscapeInput = path.join(tmp, "landscape.png");
        await sharp(inputPath).rotate(90).toFile(landscapeInput);
        const landscapeDir = path.join(tmp, "landscape");
        const landscape = await generate({ inputPath: landscapeInput, outputDir: landscapeDir, canvasSize: "24x30", orientation: "auto", colors: 18, difficulty: "hard", crop: null, cropMode: "center", paperSize: "a4", paletteId: "darlart-v3", customColors: paletteText, orderId: "1209", requireExactColors: true, paintCanvasSizes: ["24x30"], physicalSvg: true });
        assert.equal(landscape.canvas.label, "30x24");
        assert.deepEqual(landscape.paints.kits.map((k) => k.canvas), ["30x24"]);
        assert.match(fs.readFileSync(path.join(landscapeDir, "blank.svg"), "utf8"), /width="30cm"/);

        await assert.rejects(generate({ inputPath, outputDir: path.join(tmp, "rejected"), canvasSize: "24x30", orientation: "portrait", colors: 19, difficulty: "hard", crop: null, cropMode: "center", paperSize: "a4", paletteId: "darlart-v3", customColors: paletteText, orderId: "1208", requireExactColors: true }), /Exact color validation failed/);
        assert.equal(fs.existsSync(path.join(tmp, "rejected")), false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
