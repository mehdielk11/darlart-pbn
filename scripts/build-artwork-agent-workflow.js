/**
 * Builds automation/n8n-darlart-artwork-agent.json, the "Artwork Agent" n8n workflow:
 *
 *   Formulaire (upload) -> save the reference in Drive "Artwork Ref"
 *   -> gpt-image paints the artwork from the reference (fixed prompt, the reference's own colors) -> checker rejects swatches/text/borders (up to 3 tries)
 *   -> pbn API /v1/recolor: every pixel snapped to exactly 48 Darl'Art colors
 *   -> new folder "Artwork Agent/1xxx" with the reference, the artwork and the palette JSON
 *
 * "Check palette" embeds the palette from server/palettes/darlart-v3.json: run `node scripts/build-artwork-agent-workflow.js`
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
    imageQuality: "medium", // "high" costs ~4x more; the 48-color snap removes the fine texture it adds
    // the artwork is always this canvas: the model paints at imageSize (same 4:5 ratio as 40x50) and the snap
    // step crops (never stretches) to the exact ratio
    canvasSize: "40x50",
    orientation: "portrait",
    imageSize: "1024x1280", // multiples of 16, exactly 4:5
    timezone: "Africa/Casablanca",
};
// ============================================================================================
const SETTINGS_TITLING_WORKFLOW_ID = "tOSHbCt7hJ6ORh8a"; // "Darl'Art Titling Agent" in n8n
const SETTINGS_PRINT_WORKFLOW_ID = "ytxV3m341mDLCdt4"; // "Darl'Art Print Agent" in n8n

const excluded = new Set(SETTINGS.exclude.split(","));
const codeToHex = {};
for (const [hex, value] of Object.entries(palette)) {
    if (!excluded.has(value.code)) {
        codeToHex[value.code] = hex.toUpperCase();
    }
}
const codes = Object.keys(codeToHex).sort();

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
// ---- upload check: real image format (from the file's bytes, not its name) and size, before anything runs ----
node("Check upload", "n8n-nodes-base.code", 2, [110, -200], {
    jsCode: `// Only JPG, PNG or WEBP images up to MAX_MB are accepted. The format is read from the file's first bytes,
// so a renamed file (e.g. a PDF called photo.jpg) is refused. Nothing else runs for a refused file.
const MAX_MB = 5;
const item = $input.first();
const key = Object.keys(item.binary || {})[0];
if (!key) return [{ json: { valid: false, reason: "No file was uploaded." } }];
const file = item.binary[key];
const bytes = await this.helpers.getBinaryDataBuffer(0, key);
const size = bytes.length;
const head = bytes.subarray(0, 12);
const ascii = (from, to) => head.subarray(from, to).toString("latin1");
let format = "";
if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) format = "jpg";
else if (head[0] === 0x89 && ascii(1, 4) === "PNG") format = "png";
else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") format = "webp";
const mb = (size / 1024 / 1024).toFixed(1);
let reason = "";
if (!format) reason = "This file is not a JPG, PNG or WEBP image. Please upload a photo in one of these formats.";
else if (size > MAX_MB * 1024 * 1024) reason = "The image is " + mb + " MB. The maximum is " + MAX_MB + " MB: please upload a smaller or compressed image.";
else if (size < 100) reason = "The image is empty or damaged. Please upload another file.";
const mimeType = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[format] || file.mimeType;
return [{
    json: { valid: !reason, reason, format, extension: format, bytes: size, fileName: file.fileName || "" },
    // the file goes on with its real type
    binary: { [key]: { ...file, mimeType, fileExtension: format || file.fileExtension } },
}];`,
});
connect("Formulaire", "Check upload");

node("Upload OK?", "n8n-nodes-base.if", 2, [330, -200], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "uploadok", leftValue: "={{ $json.valid }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
connect("Check upload", "Upload OK?");
connect("Upload OK?", "Settings", 0);

node("Page: invalid upload", "n8n-nodes-base.form", 2.3, [550, -360], {
    operation: "completion",
    respondWith: "showText",
    responseText: "=<div style=\"font-family:system-ui,sans-serif;text-align:center\"><h2>This file can't be used</h2><p>{{ $json.reason }}</p><p><a href=\"javascript:history.back()\">Try again</a></p></div>",
});
connect("Upload OK?", "Page: invalid upload", 1);

node("Prepare", "n8n-nodes-base.code", 2, [440, 0], {
    jsCode: `// The uploaded image becomes the "reference" file, and the run gets its date+time stamp
const settings = $('Settings').first().json;
const checked = $('Check upload').first();
const key = Object.keys(checked.binary || {})[0];
if (!key) throw new Error("No image in the form submission");
const file = checked.binary[key];
const extension = checked.json.extension; // the real format, read from the file's bytes
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

// ---- 2. image prompt ------------------------------------------------------------------------
// No color instructions: the model paints the reference's own colors, and "Snap to palette" then picks the
// 48 Darl'Art colors that fit the painting best. Palette lists in the prompt risk swatches painted into the image.
node("Build image prompt", "n8n-nodes-base.code", 2, [880, 0], {
    jsCode: `// A fixed prompt: the model sees the reference itself, so no scene description is needed
const imagePrompt = [
    "Repaint this image as a highly detailed digital painting in flat cel-shaded color, like a fine gouache or screen-print illustration made for a paint-by-numbers canvas.",
    "The output is a vertical canvas painting in a 4:5 ratio (40 x 50 cm). Recompose the scene to fit this frame naturally: keep every subject whole and in proportion, extend the surrounding scenery where the frame needs more room, and never stretch, squash or distort anything.",
    "Paint only the artwork itself: ignore any white or grey background, wall, shadow, frame or canvas edge around it in the reference.",
    "Keep everything from the artwork exactly: the same subjects, likeness, expressions, poses, objects and background, with realistic proportions.",
    "Keep the original colors of the image.",
    "Each area is painted in flat solid tones with crisp, clean, smooth edges, and shading is built from distinct flat tone steps.",
    "Preserve every fine detail: facial features, eyes, lips, fingers, hair strands, clothing folds, individual leaves, reflections, architecture.",
    "Smooth high-resolution shapes, not pixel art, no blocks, no mosaic, no gradients, no blur, no texture, no grain, no brush strokes, no outlines.",
    "The painting fills the entire image edge to edge. Do not add anything to the image: no color bar, no swatches, no palette, no legend, no labels, no text, no numbers, no border, no margin.",
].join("\\n");
return [{ json: { imagePrompt }, binary: $('Prepare').first().binary }];`,
});
connect("Save reference (Artwork Ref)", "Build image prompt");

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
            { name: "size", value: "={{ $('Settings').first().json.imageSize }}" },
            { name: "quality", value: "={{ $('Settings').first().json.imageQuality }}" },
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
node("Snap to palette (48 colors)", "n8n-nodes-base.httpRequest", 4.2, [2820, -200], {
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
            // the final artwork always has the exact canvas ratio (cropped, never stretched)
            { name: "canvasSize", value: "={{ $('Settings').first().json.canvasSize }}" },
            { name: "orientation", value: "={{ $('Settings').first().json.orientation }}" },
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "artwork" },
        ],
    },
    options: { timeout: 180000 },
});
node("Approved artwork", "n8n-nodes-base.code", 2, [2600, -200], {
    jsCode: `// The checker (AI Agent) only outputs its verdict: take the approved image from the latest paint attempt
return [{ json: {}, binary: { artwork: $('Raw artwork file').last().binary.artwork } }];`,
});
connect("Artwork clean?", "Approved artwork", 0);
connect("Approved artwork", "Snap to palette (48 colors)");

node("Check palette", "n8n-nodes-base.code", 2, [3040, -200], {
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

node("Artwork file", "n8n-nodes-base.convertToFile", 1.1, [3260, -200], {
    operation: "toBinary",
    sourceProperty: "image",
    binaryPropertyName: "artwork",
    options: { fileName: "={{ $('Prepare').first().json.artworkName }}", mimeType: "image/png" },
});
connect("Check palette", "Artwork file");

// ---- 5. Drive folder Artwork Agent/1xxx ----------------------------------------------------------
node("List Artwork Agent folders", "n8n-nodes-base.httpRequest", 4.2, [3480, -200], {
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

node("Next folder number", "n8n-nodes-base.code", 2, [3700, -200], {
    jsCode: `// The new folder is the next free number: 1001, 1002, ... (folders with other names are ignored)
const first = Number($('Settings').first().json.firstFolderNumber) || 1001;
const numbers = (($input.first().json.files) || []).map((f) => String(f.name).trim()).filter((n) => /^\\d+$/.test(n)).map(Number);
const next = numbers.length ? Math.max(first - 1, ...numbers) + 1 : first;
return [{ json: { folderName: String(next) } }];`,
});
connect("List Artwork Agent folders", "Next folder number");

node("Create folder (Artwork Agent/1xxx)", "n8n-nodes-base.googleDrive", 3, [3920, -200], {
    resource: "folder",
    name: "={{ $json.folderName }}",
    driveId: drive,
    folderId: byId("={{ $('Settings').first().json.agentFolderId }}"),
    options: {},
});
connect("Next folder number", "Create folder (Artwork Agent/1xxx)");

node("Files for the folder", "n8n-nodes-base.code", 2, [4140, -200], {
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

node("Upload to folder", "n8n-nodes-base.googleDrive", 3, [4360, -200], {
    name: "={{ $json.name }}",
    driveId: drive,
    folderId: byId("={{ $json.folderId }}"),
    inputDataFieldName: "data",
    options: {},
});
connect("Files for the folder", "Upload to folder");

// ---- 6. result page -------------------------------------------------------------------------
node("Build result page", "n8n-nodes-base.code", 2, [4580, -200], {
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

// ---- 7. product texts ----------------------------------------------------------------------------
// Starts the Titling Agent (product JSON for this folder and any other folder still missing one) without waiting:
// the result page doesn't wait for it and a titling error can't fail the artwork run.
node("Run Titling Agent", "n8n-nodes-base.executeWorkflow", 1.2, [4360, 0], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: SETTINGS_TITLING_WORKFLOW_ID },
    mode: "once",
    options: { waitForSubWorkflow: false },
}, { executeOnce: true, onError: "continueRegularOutput" });
connect("Upload to folder", "Run Titling Agent");

// Starts the Print Agent (PBN variants, print files and mockup), queued on its side, without waiting
node("Run Print Agent", "n8n-nodes-base.executeWorkflow", 1.2, [4360, 200], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: SETTINGS_PRINT_WORKFLOW_ID },
    mode: "once",
    options: { waitForSubWorkflow: false },
}, { executeOnce: true, onError: "continueRegularOutput" });
connect("Upload to folder", "Run Print Agent");

node("Page: result", "n8n-nodes-base.form", 2.3, [4800, -200], {
    operation: "completion",
    respondWith: "showText",
    responseText: "={{ $json.html }}",
});
connect("Build result page", "Page: result");

// "Build result page" runs once per uploaded file otherwise: execute it once
nodes.find((n) => n.name === "Build result page").executeOnce = true;

for (const n of nodes) { if (n.position[0] >= 1600) { n.position[0] -= 520; } }

const workflow = { name: "Darl'Art Artwork Agent", nodes, connections, settings: { executionOrder: "v1", timezone: SETTINGS.timezone }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-artwork-agent.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes, " + codes.length + " palette colors");
