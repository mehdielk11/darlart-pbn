/**
 * Builds automation/n8n-darlart-titling-agent.json, the "Titling Agent" n8n workflow:
 *
 *   Artwork Agent finished / Run now / every day -> Shopify collections (the store's themes) + Drive "Artwork Agent" folders
 *   -> folders that have an artwork but no product JSON yet, one by one:
 *      download the artwork -> AI agent (title, description, tags, themes) -> <date+time>_product.json in the same folder
 *
 * The JSON follows Shopify's product fields (title, handle, productType, vendor, category, collections, tags) and a
 * plain-text description (wrap its paragraphs in <p> for Shopify's descriptionHtml).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// ===== Settings written into the workflow (all editable later in the "Settings" node) =====
const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    shopDomain: "smgi0i-0a.myshopify.com", // darlart.ma
    apiVersion: "2026-07",
    language: "English",
    maxPerRun: 20, // folders handled per run, the rest wait for the next run
    productType: "Paint by Numbers Kit",
    vendor: "Darl'Art",
    baseTags: "paint-by-numbers", // always added, comma-separated
    categoryId: "gid://shopify/TaxonomyCategory/tg-5-2-5",
    categoryName: "Toys & Games > Toys > Drawing & Painting Toys > Paint by Number Kits",
    // collections that are not themes: never proposed to the agent
    skipCollections: "all-kits,Best Sellers,Extras,Mini Kits",
};
// ============================================================================================

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "bb" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
}
function connect(from, to, output = 0, type = "main") {
    connections[from] = connections[from] || {};
    const outputs = (connections[from][type] = connections[from][type] || []);
    while (outputs.length <= output) { outputs.push([]); }
    outputs[output].push({ node: to, type, index: 0 });
}
const drive = { __rl: true, mode: "list", value: "My Drive" };
const byId = (value) => ({ __rl: true, mode: "id", value });
const driveList = (name, position, q) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    url: "https://www.googleapis.com/drive/v3/files",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    sendQuery: true,
    queryParameters: {
        parameters: [
            { name: "q", value: q },
            { name: "fields", value: "files(id,name,mimeType)" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
});

// ---- 1. triggers, settings --------------------------------------------------------------------
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 0], {});
// safety net: catches folders a failed run left behind
node("Every day", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 200], { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 3 }] } });
// the Artwork Agent calls this workflow when it has saved a new artwork
node("When called by Artwork Agent", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 400], { inputSource: "passthrough" });

node("Settings", "n8n-nodes-base.set", 3.4, [220, 100], {
    assignments: {
        assignments: Object.entries(SETTINGS).map(([name, value], i) => ({
            id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string",
        })),
    },
    options: {},
});
connect("Run now", "Settings");
connect("Every day", "Settings");
connect("When called by Artwork Agent", "Settings");

// ---- 2. the store's themes ----------------------------------------------------------------------
node("Shopify collections", "n8n-nodes-base.httpRequest", 4.2, [440, 100], {
    method: "POST",
    url: "=https://{{ $('Settings').first().json.shopDomain }}/admin/api/{{ $('Settings').first().json.apiVersion }}/graphql.json",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "shopifyOAuth2Api",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ query: '{ collections(first: 250) { nodes { id title handle } } }' }) }}",
    options: { timeout: 30000 },
});
connect("Settings", "Shopify collections");

node("Themes", "n8n-nodes-base.code", 2, [660, 100], {
    jsCode: `// One theme per collection family: "Animals", "Animals - Mini Kits" and "Animals - Kids Kits" are the theme "Animals".
// Its tag is the main collection's handle (the Kids Kits smart collections match on it, e.g. "animals").
const settings = $('Settings').first().json;
const response = $input.first().json;
const errors = (response.errors || []).map((e) => e.message);
if (errors.length) throw new Error("Shopify: " + errors.join("; "));
const collections = ((response.data || {}).collections || {}).nodes || [];
const skip = new Set(String(settings.skipCollections).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const slug = (s) => String(s).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const themes = {};
for (const c of collections) {
    if (skip.has(c.title.trim().toLowerCase())) continue;
    const name = c.title.split(" - ")[0].trim();
    const theme = (themes[name] = themes[name] || { name, tag: slug(name), collections: [] });
    theme.collections.push({ id: c.id, title: c.title, handle: c.handle });
    if (c.title.trim() === name) theme.tag = c.handle; // the main collection's handle
}
const list = Object.values(themes).sort((a, b) => a.name.localeCompare(b.name));
if (!list.length) throw new Error("No theme collections found in Shopify");
return [{ json: { themes: list, names: list.map((t) => t.name) } }];`,
});
connect("Shopify collections", "Themes");

// ---- 3. folders waiting for their product JSON -----------------------------------------------------
driveList("List Artwork Agent folders", [880, 100], "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
connect("Themes", "List Artwork Agent folders");

node("Folders", "n8n-nodes-base.code", 2, [1100, 100], {
    jsCode: `// One item per numbered folder (1001, 1002...), oldest first
const folders = ($input.first().json.files || []).filter((f) => /^\\d+$/.test(String(f.name).trim()));
folders.sort((a, b) => Number(a.name) - Number(b.name));
return folders.map((f) => ({ json: { id: f.id, name: String(f.name).trim() } }));`,
});
connect("List Artwork Agent folders", "Folders");

driveList("List folder files", [1320, 100], "='{{ $json.id }}' in parents and trashed = false");
connect("Folders", "List folder files");

node("Pending folders", "n8n-nodes-base.code", 2, [1540, 100], {
    jsCode: `// Keeps the folders that have an artwork (<date+time>_art.png) and no <date+time>_product.json yet
const settings = $('Settings').first().json;
const folders = $('Folders').all();
const pending = [];
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    const files = item.json.files || [];
    const art = files.find((f) => /^(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2})_art\\.png$/.test(f.name));
    if (!art) return;
    const stamp = art.name.slice(0, 19);
    const productName = stamp + "_product.json";
    if (files.some((f) => f.name === productName)) return;
    const ref = files.find((f) => f.name.startsWith(stamp + "_ref."));
    pending.push({ json: { folderId: folder.id, folder: folder.name, stamp, artworkId: art.id, artworkName: art.name, referenceName: ref ? ref.name : "", productName } });
});
return pending.slice(0, Number(settings.maxPerRun) || 20);`,
});
connect("List folder files", "Pending folders");

// ---- 4. one folder at a time ------------------------------------------------------------------------
node("Loop over folders", "n8n-nodes-base.splitInBatches", 3, [1760, 100], { options: {} });
connect("Pending folders", "Loop over folders");

node("Download artwork", "n8n-nodes-base.httpRequest", 4.2, [1980, 200], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $json.artworkId }}?alt=media&supportsAllDrives=true",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    options: { response: { response: { responseFormat: "file", outputPropertyName: "artwork" } }, timeout: 120000 },
});
connect("Loop over folders", "Download artwork", 1);

node("Titling agent", "@n8n/n8n-nodes-langchain.agent", 2.2, [2200, 200], {
    promptType: "define",
    text: "=Theme list: {{ $('Themes').first().json.names.join(', ') }}.\nWrite the product texts for the attached artwork.",
    hasOutputParser: true,
    options: {
        systemMessage: `=You write product listings for Darl'Art, a Moroccan paint-by-numbers brand. Each product is a kit: the customer paints the attached artwork on a numbered canvas. You look at the artwork and write in {{ $('Settings').first().json.language }}.

1. TITLE: 2 to 5 words naming what the painting shows, evocative and specific, in Title Case (e.g. "Blue Iris", "Red Umbrella", "Lanterns of Fes", "Golden Hour Camel Ride"). Never "paint by numbers", "kit" or the brand. Never a real person's name, a brand or a trademarked character.
2. DESCRIPTION: plain text, no HTML, two short paragraphs separated by a blank line, 50 to 90 words in all. First: what the finished painting shows and its mood. Second: why it is a pleasure to paint and who it suits (a relaxing hobby, a gift, which room it brightens). Warm and simple, no emojis, no prices, no sizes, no number of colors.
3. TAGS: 6 to 12 lowercase keywords for the store search: the subject, its elements, the style, the mood, the main colors, where it fits (e.g. "iris", "blue flowers", "botanical", "calm", "living room decor"). No brand, no "paint by numbers".
4. THEMES: 1 or 2 names copied exactly from the theme list in the prompt, the ones this painting belongs to. Only names from that list.`,
        passthroughBinaryImages: true,
    },
});
connect("Download artwork", "Titling agent");

node("Titling model", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.2, [2160, 420], { model: { __rl: true, value: "gpt-5-mini", mode: "id" }, options: {} });
connect("Titling model", "Titling agent", 0, "ai_languageModel");

node("Listing format", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.2, [2340, 420], {
    schemaType: "manual",
    inputSchema: JSON.stringify({
        type: "object",
        properties: {
            title: { type: "string" },
            description: { type: "string", description: "Plain text, two paragraphs separated by a blank line" },
            tags: { type: "array", items: { type: "string" } },
            themes: { type: "array", items: { type: "string" }, description: "1 or 2 names from the theme list" },
        },
        required: ["title", "description", "tags", "themes"],
    }, null, 2),
});
connect("Listing format", "Titling agent", 0, "ai_outputParser");

node("Build product JSON", "n8n-nodes-base.code", 2, [2500, 200], {
    jsCode: `// The product JSON, in Shopify's field names, saved next to the artwork as <date+time>_product.json
const settings = $('Settings').first().json;
const folder = $('Loop over folders').first().json;
const themes = $('Themes').first().json.themes;
const out = $json.output || {};

const title = String(out.title || "").replace(/\\s+/g, " ").trim().slice(0, 70);
if (!title) throw new Error("No title for folder " + folder.folder);
const handle = title.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// only themes that exist in the store; their tags make the smart collections (e.g. Kids Kits) pick the product up
const chosen = [];
for (const name of out.themes || []) {
    const theme = themes.find((t) => t.name.toLowerCase() === String(name).trim().toLowerCase());
    if (theme && !chosen.includes(theme)) chosen.push(theme);
}
const collections = chosen.map((t) => t.collections.find((c) => c.title === t.name)).filter(Boolean);

// plain text: any HTML the model adds anyway becomes paragraph breaks
const description = String(out.description || "")
    .replace(/<\\/p>\\s*<p[^>]*>/gi, "\\n\\n").replace(/<br\\s*\\/?>/gi, "\\n").replace(/<[^>]+>/g, "")
    .replace(/[ \\t]+/g, " ").replace(/\\s*\\n\\s*\\n\\s*/g, "\\n\\n").trim();

const tags = [];
for (const tag of [...String(settings.baseTags).split(","), ...chosen.map((t) => t.tag), ...(out.tags || [])]) {
    const clean = String(tag).toLowerCase().replace(/\\s+/g, " ").trim();
    if (clean && !tags.includes(clean)) tags.push(clean);
}

const product = {
    title,
    handle,
    description,
    productType: settings.productType,
    vendor: settings.vendor,
    category: { id: settings.categoryId, name: settings.categoryName },
    themes: chosen.map((t) => t.name),
    collections: collections.map((c) => ({ id: c.id, title: c.title, handle: c.handle })),
    tags,
    needsReview: chosen.length === 0 ? "no theme from the store matched: choose the collection by hand" : "",
    source: { folder: folder.folder, artwork: folder.artworkName, reference: folder.referenceName, palette: folder.stamp + "_palette.json" },
    generatedAt: $now.setZone("Africa/Casablanca").toISO(),
};
return [{
    json: { folder: folder.folder, title, file: folder.productName },
    binary: { data: { data: Buffer.from(JSON.stringify(product, null, 2)).toString("base64"), mimeType: "application/json", fileName: folder.productName } },
}];`,
});
connect("Titling agent", "Build product JSON");

node("Save product JSON", "n8n-nodes-base.googleDrive", 3, [2720, 200], {
    name: "={{ $('Loop over folders').first().json.productName }}",
    driveId: drive,
    folderId: byId("={{ $('Loop over folders').first().json.folderId }}"),
    inputDataFieldName: "data",
    options: {},
});
connect("Build product JSON", "Save product JSON");
connect("Save product JSON", "Loop over folders");

node("Summary", "n8n-nodes-base.code", 2, [1980, -40], {
    jsCode: `// What this run produced (visible in the execution log)
const saved = $input.all().map((item) => item.json.name).filter(Boolean);
return [{ json: { saved: saved.length, files: saved } }];`,
});
connect("Loop over folders", "Summary", 0);

const workflow = { name: "Darl'Art Titling Agent", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca" }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-titling-agent.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
