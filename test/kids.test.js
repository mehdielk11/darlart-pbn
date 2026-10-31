const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildKidsWorkflow } = require("../scripts/build-kids-workflow");
const { applyClassicKidsGuards } = require("../scripts/lib/kids-guards");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflow = buildKidsWorkflow();
const runCode = (name, input, context = {}) => new AsyncFunction("$input", "$", workflow.nodes.find((n) => n.name === name).parameters.jsCode)(
    { first: () => ({ json: input }) }, (node) => ({ first: () => ({ json: context[node] || {} }) }));

test("Kids graph has valid code, connections and stage-local node references", () => {
    assert.deepEqual(buildKidsWorkflow(), workflow, "rebuilding preserves node identities");
    const names = new Set(workflow.nodes.map((n) => n.name));
    assert.equal(names.size, workflow.nodes.length);
    for (const node of workflow.nodes) {
        if (node.type.endsWith(".code")) new AsyncFunction(node.parameters.jsCode);
        for (const [, name] of JSON.stringify(node.parameters).matchAll(/\$\('([^']+)'\)/g)) assert.ok(names.has(name), node.name + " references " + name);
        if (node.type.endsWith("executeWorkflow")) assert.equal(node.parameters.workflowId.value, "={{ $workflow.id }}");
    }
    for (const [from, outputs] of Object.entries(workflow.connections)) {
        assert.ok(names.has(from), from);
        for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) assert.ok(names.has(edge.node), edge.node);
    }
});

test("Kids prices consume the Kids tab and omit stretched at price zero", async () => {
    const result = await runCode("prices: Prices", { data: "canvas_type,size,colors,price\nRolled,24x30,18,189\nStretched,24x30,18,0" }, {
        "prices: Settings": { sizes: "24x30" }, "prices: Prices file": { name: "Kids", modifiedTime: "now" },
    });
    assert.equal(result[0].json.variants.length, 1);
    assert.equal(result[0].json.variants[0].price, "189.00");
    assert.equal(result[0].json.variants[0].optionValues[1].name, "Rolled Canvas");
    assert.equal(result[0].json.variants[0].optionValues[2].name, "18");
    const enabled = await runCode("prices: Prices", { data: "canvas_type,size,colors,price\nRolled,24x30,18,189\nStretched,24x30,18,249" }, {
        "prices: Settings": { sizes: "24x30" }, "prices: Prices file": { name: "Kids", modifiedTime: "now" },
    });
    assert.equal(enabled[0].json.variants.length, 2);
    await assert.rejects(runCode("prices: Prices", { data: "canvas_type,size,colors,price\nRolled,24x30,12,189" }, {
        "prices: Settings": { sizes: "24x30" }, "prices: Prices file": { name: "Kids", modifiedTime: "now" },
    }), /Kids prices must use 18 colors/);
});

test("Classic folder guards keep numeric names and exclude internally marked Kids", async () => {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, "../automation/n8n-darlart-print-agent.json")));
    const once = JSON.stringify(applyClassicKidsGuards(w));
    assert.equal(JSON.stringify(applyClassicKidsGuards(w)), once);
    const code = w.nodes.find((n) => n.name === "Folders").parameters.jsCode;
    const files = [{ id: "classic", name: "1207" }, { id: "kids", name: "1208", appProperties: { darlart_family: "kids" } }];
    const result = await new AsyncFunction("$input", code)({ first: () => ({ json: { files } }) });
    assert.deepEqual(result.map((v) => v.json.name), ["1207"]);
    const kids = await runCode("print: Folders", { files });
    assert.deepEqual(kids.map((v) => v.json.name), ["1208"]);
    const held = await runCode("print: Folders", { files: [{ ...files[1], appProperties: { darlart_family: "kids", darlart_state: "migrating" } }] });
    assert.equal(held[0].json.none, true);
    const review = await runCode("print: Folders", { files: [{ ...files[1], appProperties: { darlart_family: "kids", darlart_state: "review" } }] });
    assert.equal(review[0].json.none, true);
});

test("Kids worker shares the numeric allocation lock and atomically marks new folders", () => {
    const get = (name) => workflow.nodes.find((n) => n.name === name);
    assert.match(JSON.stringify(get("worker: List locks").parameters), /13fjEqSw2tqYfKwn23RPDdItLigrRvjTb/);
    assert.match(JSON.stringify(get("worker: List locks").parameters), /_artwork-worker\.lock/);
    assert.match(JSON.stringify(get("worker: Create folder (Artwork Agent\/1xxx)").parameters), /appProperties/);
    assert.match(JSON.stringify(get("worker: Create folder (Artwork Agent\/1xxx)").parameters), /darlart_family/);
    assert.match(JSON.stringify(get("print: Create pbn job").parameters), /requireExactColors/);
    assert.match(JSON.stringify(get("prices: Export prices sheet").parameters), /gid=188180018/);
    assert.throws(() => buildKidsWorkflow({ canvasSize: "24x31" }), /4:5/);
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
