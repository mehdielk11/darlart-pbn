/**
 * Builds automation/n8n-darlart-artwork-agent.json, the "Artwork Agent" n8n workflow:
 *
 *   Formulaire (upload) -> save the reference in Drive "Artwork Ref"
 *   -> AI agent (art brief from the photo, colors picked from the Darl'Art palette)
 *   -> gpt-image paints the artwork -> checker rejects swatches/text/borders (up to 3 tries)
 *   -> pbn API /v1/recolor: every pixel snapped to exactly 48 Darl'Art colors
 *   -> new folder "Artwork Agent/1xxx" with the reference, the artwork and the palette JSON
 *
 * The palette is embedded from server/palettes/darlart-v3.json: run `node scripts/build-artwork-agent-workflow.js`
 * again after changing it, then re-import the workflow.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const palette = JSON.parse(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8"));

// ===== Settings written into the workflow (all editable later in the "Settings" node) =====
const SETTINGS = {
    colors: 48,
    exclude: "3801,3811", // pure white and near black are never used in the artwork
    paletteId: "darlart-v3",
    pbnApiUrl: "http://127.0.0.1:3000",
    refFolderId: "1iGdgyIplbyQx52QOK1jUcwOuwuYTlWM-", // Drive "Artwork Ref"
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    firstFolderNumber: 1001,
    imageModel: "gpt-image-2",
    imageQuality: "high",
    timezone: "Africa/Casablanca",
};
// ============================================================================================

const excluded = new Set(SETTINGS.exclude.split(","));
const codeToHex = {};
for (const [hex, value] of Object.entries(palette)) {
    if (!excluded.has(value.code)) {
        codeToHex[value.code] = hex.toUpperCase();
    }
}
const codes = Object.keys(codeToHex).sort();
const families = {};
for (const code of codes) {
    (families[code.slice(0, 2)] = families[code.slice(0, 2)] || []).push(code.slice(2) + "=" + codeToHex[code].slice(1));
}
const paletteLines = Object.keys(families).sort().map((family) => family + ": " + families[family].join(" ")).join("\n");

const drive = { __rl: true, mode: "list", value: "My Drive" };
const byId = (value) => ({ __rl: true, mode: "id", value });

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "aa" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
}
function connect(from, to, output = 0, type = "main") {
    connections[from] = connections[from] || {};
    const outputs = (connections[from][type] = connections[from][type] || []);
    while (outputs.length <= output) { outputs.push([]); }
    outputs[output].push({ node: to, type, index: 0 });
}

// ---- 1. form, settings, reference --------------------------------------------------------
node("Formulaire", "n8n-nodes-base.formTrigger", 2.2, [0, 0], {
    formTitle: "Darl'Art Artwork Agent",
    formDescription: "Upload the artwork reference. The agent paints it with exactly " + SETTINGS.colors + " Darl'Art colors and saves everything in Drive (Artwork Agent). It takes 1 to 3 minutes: keep this page open.",
    formFields: { values: [{ fieldLabel: "Artwork reference", fieldType: "file", multipleFiles: false, acceptFileTypes: ".jpg,.jpeg,.png,.webp", requiredField: true }] },
    options: { buttonLabel: "Generate artwork", appendAttribution: false },
});

node("Settings", "n8n-nodes-base.set", 3.4, [220, 0], {
    assignments: {
        assignments: Object.entries(SETTINGS).map(([name, value], i) => ({
            id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string",
        })),
    },
    options: {},
});
connect("Formulaire", "Settings");

node("Prepare", "n8n-nodes-base.code", 2, [440, 0], {
    jsCode: `// The uploaded image becomes the "reference" file, and the run gets its date+time stamp
const settings = $('Settings').first().json;
const binary = $('Formulaire').first().binary || {};
const key = Object.keys(binary)[0];
if (!key) throw new Error("No image in the form submission");
const file = binary[key];
const extension = ((file.fileName || "").match(/\\.([a-z0-9]+)$/i) || [, (file.fileExtension || "jpg")])[1].toLowerCase();
const stamp = $now.setZone(settings.timezone).toFormat("yyyy-MM-dd_HH-mm-ss");
return [{
    json: {
        stamp,
        referenceName: stamp + "_ref." + extension,
        artworkName: stamp + "_art.png",
        paletteName: stamp + "_palette.json",
    },
    binary: { reference: file },
}];`,
});
connect("Settings", "Prepare");

node("Save reference (Artwork Ref)", "n8n-nodes-base.googleDrive", 3, [660, 0], {
    name: "={{ $('Prepare').first().json.referenceName }}",
    driveId: drive,
    folderId: byId("={{ $('Settings').first().json.refFolderId }}"),
    inputDataFieldName: "reference",
    options: {},
});
connect("Prepare", "Save reference (Artwork Ref)");

node("Photo for the agent", "n8n-nodes-base.code", 2, [880, 0], {
    jsCode: `// The Drive node returns file metadata only: hand the reference image to the AI agent again
return [{ json: { referenceFileId: $input.first().json.id }, binary: $('Prepare').first().binary }];`,
});
connect("Save reference (Artwork Ref)", "Photo for the agent");

// ---- 2. AI agent ---------------------------------------------------------------------------
node("AI Agent (art director)", "@n8n/n8n-nodes-langchain.agent", 2.2, [1100, 0], {
    promptType: "define",
    text: "=Number of colors N = {{ $('Settings').first().json.colors }}.\nPrepare the artwork brief for the attached reference image.",
    hasOutputParser: true,
    options: {
        systemMessage: `You are the art director of Darl'Art, a paint-by-numbers brand. You receive a reference image and a number of colors N. You never draw: you write the brief a painter will follow.

DARL'ART PALETTE: the only paint colors that exist.
Each line is a family "FF: SS=HEX ...": the color ID is family + shade, e.g. "01: 05=FC6286" means ID 0105 = #FC6286. Shades 01 to 10 go from very light to vivid, 11 to 15 from dark to darkest.
${paletteLines}

YOUR TASKS
1. SCENE: describe everything visible in the reference in rich detail, so nothing is lost: the subject(s), faces and expressions, poses, hands, hair, clothing and its folds, objects, the background, the light direction, the framing. 80 to 160 words. Never name a real person.
2. ORIENTATION: landscape, portrait or square, from the reference's shape.
3. PALETTE: exactly N distinct IDs from the palette above that together can paint this image faithfully: cover the lightest highlights, the darkest shadows, every important hue, and several tone steps for large areas (skin, sky, foliage...). For each: the ID and where it goes. Largest area first. Only IDs that exist in the list.`,
        passthroughBinaryImages: true,
    },
});
connect("Photo for the agent", "AI Agent (art director)");

node("Art director model", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.2, [1060, 220], { model: { __rl: true, value: "gpt-5", mode: "id" }, options: {} });
connect("Art director model", "AI Agent (art director)", 0, "ai_languageModel");

node("Brief format", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.2, [1240, 220], {
    schemaType: "manual",
    inputSchema: JSON.stringify({
        type: "object",
        properties: {
            scene: { type: "string" },
            orientation: { type: "string", enum: ["landscape", "portrait", "square"] },
            palette: {
                type: "array",
                description: "Exactly N distinct Darl'Art IDs, largest area first",
                items: {
                    type: "object",
                    properties: { id: { type: "string", description: "4-digit Darl'Art ID, e.g. 0105" }, use: { type: "string", description: "Where the color goes" } },
                    required: ["id", "use"],
                },
            },
        },
        required: ["scene", "orientation", "palette"],
    }, null, 2),
});
connect("Brief format", "AI Agent (art director)", 0, "ai_outputParser");

node("Build image prompt", "n8n-nodes-base.code", 2, [1400, 0], {
    jsCode: `// Keeps only real Darl'Art IDs (the HEX always comes from the palette, never from the model) and writes the image prompt.
// The final colors are enforced later by "Snap to palette": this list only steers the painter toward them.
const PALETTE = ${JSON.stringify(codeToHex)};
const brief = $json.output || {};
const seen = new Set();
const colors = [];
for (const c of brief.palette || []) {
    const id = String(c.id || "").replace(/\\D/g, "").padStart(4, "0");
    if (!PALETTE[id] || seen.has(id)) continue;
    seen.add(id);
    colors.push({ id, hex: PALETTE[id], use: String(c.use || "").trim() });
}
const orientation = ["landscape", "portrait", "square"].includes(brief.orientation) ? brief.orientation : "square";
const size = { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" }[orientation];
const imagePrompt = [
    "Repaint this image as a highly detailed digital painting in flat cel-shaded color, like a fine gouache or screen-print illustration made for a paint-by-numbers canvas.",
    "Keep everything from the image: " + String(brief.scene || "").trim(),
    orientation.charAt(0).toUpperCase() + orientation.slice(1) + " composition, the same framing as the reference.",
    "Each area is painted in flat solid tones with crisp, clean, smooth edges, and shading is built from distinct flat tone steps.",
    "Preserve every fine detail: facial features and expressions, eyes, lips, fingers, hair strands, clothing folds, individual leaves, reflections, architecture. Faithful likeness and realistic proportions.",
    colors.length ? "Use only this limited set of paint colors, each for the areas listed: " + colors.map((c) => c.hex + " (" + c.use + ")").join(", ") + ". No other color." : "",
    "Smooth high-resolution shapes, not pixel art, no blocks, no mosaic, no gradients, no blur, no texture, no grain, no brush strokes, no outlines.",
    "The painting fills the entire image edge to edge. Do not add anything to the image: no color bar, no swatches, no palette, no legend, no labels, no text, no numbers, no border, no margin.",
].filter(Boolean).join("\\n");
return [{
    json: { orientation, size, suggestedColors: colors, imagePrompt },
    binary: $('Prepare').first().binary,
}];`,
});
connect("AI Agent (art director)", "Build image prompt");

// ---- 3. paint + check ------------------------------------------------------------------------
node("Generate ART", "n8n-nodes-base.httpRequest", 4.2, [1620, 0], {
    method: "POST",
    url: "https://api.openai.com/v1/images/edits",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "openAiApi",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: {
        parameters: [
            { name: "model", value: "={{ $('Settings').first().json.imageModel }}" },
            { name: "prompt", value: "={{ $('Build image prompt').last().json.imagePrompt }}" },
            { name: "size", value: "={{ $('Build image prompt').last().json.size }}" },
            { name: "quality", value: "={{ $('Settings').first().json.imageQuality }}" },
            { name: "input_fidelity", value: "high" },
            { name: "output_format", value: "png" },
            { name: "n", value: "1" },
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "reference" },
        ],
    },
    options: { timeout: 300000 },
});
connect("Build image prompt", "Generate ART");

node("Raw artwork file", "n8n-nodes-base.convertToFile", 1.1, [1840, 0], {
    operation: "toBinary",
    sourceProperty: "data[0].b64_json",
    binaryPropertyName: "artwork",
    options: { fileName: "artwork.png", mimeType: "image/png" },
});
connect("Generate ART", "Raw artwork file");

node("Check artwork", "@n8n/n8n-nodes-langchain.agent", 2.2, [2060, 0], {
    promptType: "define",
    text: "Check the attached image.\nclean = false if it contains ANY of these:\n- a color palette, color swatches, color chips, a color bar or strip, or a legend;\n- any text, letters, numbers, labels, logo, signature or watermark;\n- a border, frame, white margin, mockup, canvas edge or paper around the painting;\n- a pixel-art, blocky or mosaic look (visible square pixels or blocks).\nOtherwise clean = true. \"problems\" lists what you found, or is empty.",
    hasOutputParser: true,
    options: {
        systemMessage: "You check artwork files before they go to a paint-by-numbers production tool. You look at the image and report problems. Be strict.",
        passthroughBinaryImages: true,
    },
});
connect("Raw artwork file", "Check artwork");

node("Checker model", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.2, [2020, 220], { model: { __rl: true, value: "gpt-5-mini", mode: "id" }, options: {} });
connect("Checker model", "Check artwork", 0, "ai_languageModel");

node("Check format", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.2, [2200, 220], {
    schemaType: "manual",
    inputSchema: JSON.stringify({ type: "object", properties: { clean: { type: "boolean" }, problems: { type: "string" } }, required: ["clean", "problems"] }, null, 2),
});
connect("Check format", "Check artwork", 0, "ai_outputParser");

const ifNode = (name, position, left, operator, right) => node(name, "n8n-nodes-base.if", 2, position, {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: right, operator }],
        combinator: "and",
    },
    options: {},
});
ifNode("Artwork clean?", [2380, 0], "={{ $json.output.clean }}", { type: "boolean", operation: "true", singleValue: true }, true);
connect("Check artwork", "Artwork clean?");

node("Count attempts", "n8n-nodes-base.code", 2, [2600, 200], {
    jsCode: `// A problem was found in the artwork: paint again, at most MAX_ATTEMPTS images in all
const MAX_ATTEMPTS = 3;
const attempt = $runIndex + 2; // this node runs after attempt 1, 2...
return [{
    json: { retry: attempt <= MAX_ATTEMPTS, attempt, problems: $json.output ? $json.output.problems : "" },
    binary: $('Prepare').first().binary,
}];`,
});
connect("Artwork clean?", "Count attempts", 1);
ifNode("Paint again?", [2820, 200], "={{ $json.retry }}", { type: "boolean", operation: "true", singleValue: true }, true);
connect("Count attempts", "Paint again?");
connect("Paint again?", "Generate ART", 0);
node("Page: artwork failed", "n8n-nodes-base.form", 2.3, [3040, 300], {
    operation: "completion",
    respondWith: "showText",
    responseText: "<div style=\"font-family:system-ui,sans-serif;text-align:center\"><h2>Something went wrong</h2><p>The artwork could not be painted cleanly after 3 tries. The reference is saved in Artwork Ref. Please submit it again.</p><p><a href=\"javascript:history.back()\">Try again</a></p></div>",
});
connect("Paint again?", "Page: artwork failed", 1);

// ---- 4. strict palette -----------------------------------------------------------------------
node("Snap to palette (48 colors)", "n8n-nodes-base.httpRequest", 4.2, [2600, -200], {
    method: "POST",
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/recolor",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: {
        parameters: [
            { name: "colors", value: "={{ $('Settings').first().json.colors }}" },
            { name: "palette", value: "={{ $('Settings').first().json.paletteId }}" },
            { name: "exclude", value: "={{ $('Settings').first().json.exclude }}" },
            { name: "smooth", value: "3" },
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "artwork" },
        ],
    },
    options: { timeout: 180000 },
});
connect("Artwork clean?", "Snap to palette (48 colors)", 0);

node("Check palette", "n8n-nodes-base.code", 2, [2820, -200], {
    jsCode: `// Every pixel of the final artwork is a Darl'Art color: check the count and the codes before saving
const PALETTE = ${JSON.stringify(codeToHex)};
const settings = $('Settings').first().json;
const result = $input.first().json;
const colors = result.colors || [];
const bad = colors.filter((c) => PALETTE[c.code] !== c.hex);
if (bad.length) throw new Error("Colors outside the Darl'Art palette: " + bad.map((c) => c.code + " " + c.hex).join(", "));
if (colors.length !== Number(settings.colors)) throw new Error("The artwork has " + colors.length + " colors instead of " + settings.colors);
const prepared = $('Prepare').first().json;
const paletteJson = {
    artwork: prepared.artworkName,
    reference: prepared.referenceName,
    palette: settings.paletteId,
    colorCount: colors.length,
    width: result.width,
    height: result.height,
    colors: colors.map((c) => ({ code: c.code, hex: c.hex, rgb: c.rgb, percent: c.percent })),
};
return [{ json: { image: result.image, paletteJson } }];`,
});
connect("Snap to palette (48 colors)", "Check palette");

node("Artwork file", "n8n-nodes-base.convertToFile", 1.1, [3040, -200], {
    operation: "toBinary",
    sourceProperty: "image",
    binaryPropertyName: "artwork",
    options: { fileName: "={{ $('Prepare').first().json.artworkName }}", mimeType: "image/png" },
});
connect("Check palette", "Artwork file");

// ---- 5. Drive folder Artwork Agent/1xxx ----------------------------------------------------------
node("List Artwork Agent folders", "n8n-nodes-base.httpRequest", 4.2, [3260, -200], {
    url: "https://www.googleapis.com/drive/v3/files",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    sendQuery: true,
    queryParameters: {
        parameters: [
            { name: "q", value: "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false" },
            { name: "fields", value: "files(id,name)" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
});
connect("Artwork file", "List Artwork Agent folders");

node("Next folder number", "n8n-nodes-base.code", 2, [3480, -200], {
    jsCode: `// The new folder is the next free number: 1001, 1002, ... (folders with other names are ignored)
const first = Number($('Settings').first().json.firstFolderNumber) || 1001;
const numbers = (($input.first().json.files) || []).map((f) => String(f.name).trim()).filter((n) => /^\\d+$/.test(n)).map(Number);
const next = numbers.length ? Math.max(first - 1, ...numbers) + 1 : first;
return [{ json: { folderName: String(next) } }];`,
});
connect("List Artwork Agent folders", "Next folder number");

node("Create folder (Artwork Agent/1xxx)", "n8n-nodes-base.googleDrive", 3, [3700, -200], {
    resource: "folder",
    name: "={{ $json.folderName }}",
    driveId: drive,
    folderId: byId("={{ $('Settings').first().json.agentFolderId }}"),
    options: {},
});
connect("Next folder number", "Create folder (Artwork Agent/1xxx)");

node("Files for the folder", "n8n-nodes-base.code", 2, [3920, -200], {
    jsCode: `// Artwork Ref + Artwork Gen (+ the palette JSON), one item per file
const folderId = $input.first().json.id;
const prepared = $('Prepare').first();
const paletteJson = $('Check palette').first().json.paletteJson;
return [
    { json: { folderId, name: prepared.json.referenceName }, binary: { data: prepared.binary.reference } },
    { json: { folderId, name: prepared.json.artworkName }, binary: { data: $('Artwork file').first().binary.artwork } },
    {
        json: { folderId, name: prepared.json.paletteName },
        binary: { data: { data: Buffer.from(JSON.stringify(paletteJson, null, 2)).toString("base64"), mimeType: "application/json", fileName: prepared.json.paletteName } },
    },
];`,
});
connect("Create folder (Artwork Agent/1xxx)", "Files for the folder");

node("Upload to folder", "n8n-nodes-base.googleDrive", 3, [4140, -200], {
    name: "={{ $json.name }}",
    driveId: drive,
    folderId: byId("={{ $json.folderId }}"),
    inputDataFieldName: "data",
    options: {},
});
connect("Files for the folder", "Upload to folder");

// ---- 6. result page -------------------------------------------------------------------------
node("Build result page", "n8n-nodes-base.code", 2, [4360, -200], {
    jsCode: `// Result: 1xxx = Artwork Ref + Artwork Gen, shown on the form's last page
const folder = $('Create folder (Artwork Agent/1xxx)').first().json;
const paletteJson = $('Check palette').first().json.paletteJson;
const png = "data:image/png;base64," + $('Check palette').first().json.image;
const folderUrl = "https://drive.google.com/drive/folders/" + folder.id;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const swatches = paletteJson.colors.map((c) => '<span class="sw" title="' + esc(c.code + " " + c.hex + " " + c.percent + "%") + '" style="background:' + c.hex + '"></span>').join("");
const html = \`<style>
  .r{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;text-align:left;color:#1d2433}
  .r img{width:100%;height:auto;border-radius:10px;display:block}
  .r h2{margin:18px 0 6px;font-size:22px}
  .r .b{display:inline-block;padding:10px 16px;border-radius:8px;background:#1d2433;color:#fff;text-decoration:none;margin:0 8px 14px 0}
  .r .sw{display:inline-block;width:22px;height:22px;border-radius:4px;margin:0 4px 4px 0;border:1px solid #0002}
  .r pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto;max-height:320px;font-size:12px}
</style>
<div class="r">
  <img src="\${png}" alt="Artwork \${esc(folder.name)}">
  <h2>Artwork \${esc(folder.name)}: \${paletteJson.colorCount} Darl'Art colors</h2>
  <a class="b" href="\${folderUrl}" target="_blank">Open Drive folder \${esc(folder.name)}</a>
  <a class="b" href="\${png}" download="\${esc(paletteJson.artwork)}">Download artwork</a>
  <div>\${swatches}</div>
  <pre>\${esc(JSON.stringify(paletteJson.colors.map((c) => ({ code: c.code, hex: c.hex, percent: c.percent })), null, 1))}</pre>
</div>\`;
return [{ json: { html, folder: folder.name, folderUrl } }];`,
});
connect("Upload to folder", "Build result page");

node("Page: result", "n8n-nodes-base.form", 2.3, [4580, -200], {
    operation: "completion",
    respondWith: "showText",
    responseText: "={{ $json.html }}",
});
connect("Build result page", "Page: result");

// "Build result page" runs once per uploaded file otherwise: execute it once
nodes.find((n) => n.name === "Build result page").executeOnce = true;

const workflow = { name: "Darl'Art Artwork Agent", nodes, connections, settings: { executionOrder: "v1", timezone: SETTINGS.timezone }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-artwork-agent.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes, " + codes.length + " palette colors");
