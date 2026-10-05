/**
 * Builds automation/n8n-darlart-titling-agent.json, the "Titling Agent" n8n workflow:
 *
 *   Artwork Agent finished / Run now / every day -> Shopify collections (the store's themes) + Drive "Artwork Agent" folders
 *   -> folders that have an artwork but no product JSON yet, one by one:
 *      download the artwork -> AI agent (title, description, tags, themes) -> <folder>_product.json in the same folder
 *
 * One run at a time (a Drive lock in "Artwork Agent", see scripts/lib/n8n-queue-lock.js): a call that finds another
 * run working waits and tries again, and a run that wrote product JSONs starts itself again until none is missing.
 *
 * Each try on a folder leaves a marker "_titling-try-<execution>" in it (deleted when its product JSON is saved). A
 * folder is given up after maxTries tries (marker "_titling-gave-up", one Telegram alert), so a folder that always
 * fails never costs AI calls run after run; folders never tried go first, so it never holds up the others either.
 * Delete its "_titling-..." markers to try it again. The Error Handler deletes the try markers of a run that failed
 * on an account or service problem (no OpenAI credit, wrong key...): that is not the folder's fault.
 *
 * The JSON follows Shopify's product fields (title, handle, productType, vendor, collections, tags) and a
 * plain-text description (wrap its paragraphs in <p> for Shopify's descriptionHtml).
 */
const fs = require("fs");
const path = require("path");
const { queueLock, RETRY } = require("./lib/n8n-queue-lock");

const root = path.join(__dirname, "..");
// "Darl'Art Error Handler" (scripts/build-error-handler-workflow.js): releases a failed run's lock and alerts on Telegram
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1";

// ===== Settings written into the workflow (all editable later in the "Settings" node) =====
const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    shopDomain: "smgi0i-0a.myshopify.com", // darlart.ma
    apiVersion: "2026-07",
    language: "English",
    maxPerRun: 20, // folders handled per run, the rest wait for the next run
    maxTries: 3, // tries on a folder before it is given up (one Telegram alert)
    telegramChatId: "-1003952514058", // where the given-up alert goes (empty = no alert)
    productType: "Paint by Numbers Kit",
    vendor: "Darl'Art",
    baseTags: "paint-by-numbers", // always added, comma-separated
    // collections that are not themes: never proposed to the agent
    skipCollections: "all-kits,all-kids,classic-kits,New Arrivals,Best Sellers,Extras,Mini Kits",
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
const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
const ifNode = (name, position, left, extra) => node(name, "n8n-nodes-base.if", 2, position, {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
}, extra);
const googleAuth = { authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api" };
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
            // newest first: a listing holds 1000 files at most, and the newest are the ones still to do
            { name: "orderBy", value: "createdTime desc" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
}, RETRY);

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
}, { executeOnce: true });
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
    jsonBody: "={{ JSON.stringify({ query: '{ collections(first: 250) { nodes { id title handle ruleSet { appliedDisjunctively } } } metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: \"custom\") { nodes { key validations { name value } } } }' }) }}",
    options: { timeout: 30000 },
});
// ---- one run at a time ------------------------------------------------------------------------------
const lock = queueLock({ node, connect }, { prefix: "_titling-agent.lock", folderExpression: "$('Settings').first().json.agentFolderId", staleMinutes: 15, x: 440, y: -420 });
connect("Settings", "List locks");
connect("Lock won?", "Shopify collections", 0);

node("Themes", "n8n-nodes-base.code", 2, [660, 100], {
    jsCode: `// One theme per collection family: "Animals", "Animals - Mini Kits" and "Kids - Animals" (or "Animals - Kids Kits")
// are the theme "Animals".
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
    // "Kids - Animals": the Kids Kits collection of the theme after "Kids - "
    const kidsPrefix = /^kids\\s*-\\s*(.+)$/i.exec(c.title.trim());
    const name = kidsPrefix ? kidsPrefix[1].trim() : c.title.split(" - ")[0].trim();
    const theme = (themes[name] = themes[name] || { name, tag: slug(name), collections: [] });
    // smart: an automated collection (its rules pick the products, e.g. by tag); a product can't be put in it by hand
    const kids = !!kidsPrefix || /-\\s*kids kits$/i.test(c.title);
    theme.collections.push({ id: c.id, title: c.title, handle: c.handle, smart: !!c.ruleSet, kids });
    if (c.title.trim() === name) theme.tag = c.handle; // the main collection's handle
}
// themes with a main collection (e.g. "Animals"), for every painting; themes with only a Kids Kits collection
// (e.g. "Kids - Space"), for kids paintings only. A Mini Kits collection alone never makes a theme.
for (const t of Object.values(themes)) t.kidsOnly = !t.collections.some((c) => c.title.trim() === t.name) && t.collections.some((c) => c.kids);
const list = Object.values(themes).filter((t) => !t.kidsOnly && t.collections.some((c) => c.title.trim() === t.name) || t.kidsOnly).sort((a, b) => a.name.localeCompare(b.name));
if (!list.length) throw new Error("No theme collections found in Shopify");
// the allowed values of the collection-page filters (Settings > Custom data > Products): Category, Difficulty level
const choicesOf = (key) => {
    const d = (((response.data || {}).metafieldDefinitions || {}).nodes || []).find((n) => n.key === key);
    const v = d && (d.validations || []).find((x) => x.name === "choices");
    try { return v ? JSON.parse(v.value) : []; } catch (e) { return []; }
};
return [{ json: { themes: list, names: list.filter((t) => !t.kidsOnly).map((t) => t.name), kidsNames: list.filter((t) => t.kidsOnly).map((t) => t.name), categoryChoices: choicesOf("category"), difficultyChoices: choicesOf("difficulty_level") } }];`,
});
connect("Shopify collections", "Themes");

// ---- 3. folders waiting for their product JSON -----------------------------------------------------
driveList("List Artwork Agent folders", [880, 100], "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
connect("Themes", "List Artwork Agent folders");

node("Folders", "n8n-nodes-base.code", 2, [1100, 100], {
    jsCode: `// One item per numbered folder (1001, 1002...), oldest first
const folders = ($input.first().json.files || []).filter((f) => /^\\d+$/.test(String(f.name).trim()));
folders.sort((a, b) => Number(a.name) - Number(b.name));
if (!folders.length) return [{ json: { none: true } }];
return folders.map((f) => ({ json: { id: f.id, name: String(f.name).trim() } }));`,
});
connect("List Artwork Agent folders", "Folders");

driveList("List folder files", [1320, 100], "={{ $json.none ? \"name = '__none__' and trashed = false\" : \"'\" + $json.id + \"' in parents and trashed = false\" }}");
connect("Folders", "List folder files");

node("Pending folders", "n8n-nodes-base.code", 2, [1540, 100], {
    jsCode: `// Keeps the folders that have an artwork (1095_art.png) and no 1095_product.json yet, and were not
// given up (maxTries tries); folders never tried first, then the oldest
const settings = $('Settings').first().json;
const maxTries = Number(settings.maxTries) || 3;
const folders = $('Folders').all();
const pending = [];
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    if (folder.none) return;
    const files = item.json.files || [];
    const art = files.find((f) => /^.+_art\\.png$/.test(f.name));
    if (!art) return;
    // the files' prefix: the folder number (a date+time in folders made before 2026-10-05)
    const stamp = art.name.slice(0, -"_art.png".length);
    const productName = stamp + "_product.json";
    if (files.some((f) => f.name === productName)) return;
    const tries = files.filter((f) => f.name.startsWith("_titling-try-")).length;
    if (tries >= maxTries || files.some((f) => f.name === "_titling-gave-up")) return;
    const ref = files.find((f) => f.name.startsWith(stamp + "_ref."));
    pending.push({ json: { folderId: folder.id, folder: folder.name, stamp, artworkId: art.id, artworkName: art.name, referenceName: ref ? ref.name : "", productName, tries } });
});
pending.sort((a, b) => a.json.tries - b.json.tries || Number(a.json.folder) - Number(b.json.folder));
const todo = pending.slice(0, Number(settings.maxPerRun) || 20);
return todo.length ? todo : [{ json: { none: true } }];`,
});
connect("List folder files", "Pending folders");

// ---- folders given up: tried maxTries times without a product JSON; one marker and one alert each ------------
// (placed above the main path: it runs first)
code("Given up folders", [1540, -160], `// Folders tried maxTries times that still have no product JSON and no "_titling-gave-up" marker yet
const settings = $('Settings').first().json;
const maxTries = Number(settings.maxTries) || 3;
const folders = $('Folders').all();
const out = [];
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    if (folder.none) return;
    const files = item.json.files || [];
    const art = files.find((f) => /^.+_art\\.png$/.test(f.name));
    if (!art || files.some((f) => f.name === art.name.slice(0, -"_art.png".length) + "_product.json")) return;
    const tries = files.filter((f) => f.name.startsWith("_titling-try-")).length;
    if (tries >= maxTries && !files.some((f) => f.name === "_titling-gave-up")) out.push({ json: { folderId: folder.id, folder: folder.name, tries } });
});
return out.length ? out : [{ json: { none: true } }];`);
connect("List folder files", "Given up folders");
ifNode("Any given up?", [1760, -160], "={{ !$json.none }}");
connect("Given up folders", "Any given up?");
node("Mark given up", "n8n-nodes-base.httpRequest", 4.2, [1980, -240], {
    method: "POST",
    url: "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ name: '_titling-gave-up', mimeType: 'text/plain', parents: [$json.folderId], description: 'Titling Agent: ' + $json.tries + ' tries without a product JSON. Delete the _titling-... files to try again.' }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Any given up?", "Mark given up", 0);
code("Given up message", [2200, -240], `const settings = $('Settings').first().json;
const up = $('Given up folders').all().map((item) => item.json).filter((f) => !f.none);
if (!up.length || !String(settings.telegramChatId || "").trim()) return [{ json: { none: true } }];
return [{ json: { text: ["Titling Agent: gave up on folder" + (up.length === 1 ? " " : "s ") + up.map((f) => f.folder).join(", ") + " after " + settings.maxTries + " tries (no product texts).", "", "Its print files are still made, but it gets no Shopify draft until it has its product JSON. To try again, delete the files named _titling-... in the folder. The last error is in the Error Handler's alerts."].join("\\n") } }];`, { executeOnce: true });
connect("Mark given up", "Given up message");
ifNode("Alert?", [2420, -240], "={{ !$json.none }}");
connect("Given up message", "Alert?");
node("Telegram: given up", "n8n-nodes-base.telegram", 1.2, [2640, -240], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    text: "={{ String($json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
}, { onError: "continueRegularOutput" });
connect("Alert?", "Telegram: given up", 0);

node("Folders to title?", "n8n-nodes-base.if", 2, [1650, 260], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "folderstotitle", leftValue: "={{ !$json.none }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
}, { executeOnce: true });
connect("Pending folders", "Folders to title?");

// ---- 4. one folder at a time ------------------------------------------------------------------------
node("Loop over folders", "n8n-nodes-base.splitInBatches", 3, [1760, 100], { options: {} });
connect("Folders to title?", "Loop over folders", 0);

lock.heartbeat("Heartbeat (refresh lock)", [1870, 360]);
connect("Loop over folders", "Heartbeat (refresh lock)", 1);

node("Download artwork", "n8n-nodes-base.httpRequest", 4.2, [1980, 200], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $('Loop over folders').first().json.artworkId }}?alt=media&supportsAllDrives=true",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    options: { response: { response: { responseFormat: "file", outputPropertyName: "artwork" } }, timeout: 120000 },
});
// one try on this folder, recorded before the AI call (a run that crashes midway still counts it)
node("Record the try", "n8n-nodes-base.httpRequest", 4.2, [1980, 360], {
    method: "POST",
    url: "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ name: '_titling-try-' + $execution.id, mimeType: 'text/plain', parents: [$('Loop over folders').first().json.folderId] }) }}",
    options: { timeout: 30000 },
}, { ...RETRY, onError: "continueRegularOutput" });
connect("Heartbeat (refresh lock)", "Record the try");
connect("Record the try", "Download artwork");

node("Titling agent", "@n8n/n8n-nodes-langchain.agent", 2.2, [2200, 200], {
    promptType: "define",
    text: "=Theme list: {{ $('Themes').first().json.names.join(', ') }}.{{ ($('Themes').first().json.kidsNames || []).length ? '\\nThemes for kids paintings only (use them only when KIDS is true): ' + $('Themes').first().json.kidsNames.join(', ') + '.' : '' }}\nWrite the product texts for the attached artwork.",
    hasOutputParser: true,
    options: {
        systemMessage: `=You write product listings for Darl'Art, a Moroccan paint-by-numbers brand. Each product is a kit: the customer paints the attached artwork on a numbered canvas. You look at the artwork and write in {{ $('Settings').first().json.language }}.

1. TITLE: 2 to 5 words naming what the painting shows, evocative and specific, in Title Case (e.g. "Blue Iris", "Red Umbrella", "Lanterns of Fes", "Golden Hour Camel Ride"). Never "paint by numbers", "kit" or the brand. Never a real person's name, a brand or a trademarked character.
2. DESCRIPTION: plain text, no HTML, two short paragraphs separated by a blank line, 50 to 90 words in all. First: what the finished painting shows and its mood. Second: why it is a pleasure to paint and who it suits (a relaxing hobby, a gift, which room it brightens). Warm and simple, no emojis, no prices, no sizes, no number of colors.
3. TAGS: 6 to 12 lowercase keywords for the store search: the subject, its elements, the style, the mood, the main colors, where it fits (e.g. "iris", "blue flowers", "botanical", "calm", "living room decor"). No brand, no "paint by numbers".
4. THEMES: the ONE store collection this painting belongs to, exactly 1 name copied exactly from the theme list in the prompt. Each painting is shown in a single collection, so pick the one a shopper would look in first: the main subject decides (an eagle in the sky goes in Animals, not Nature; a car on a coastal road goes in Vehicles; a medina street goes in Morocco; a sunset over the sea goes in Sunsets; a couple goes in Romance). Anime & Manga only for artwork drawn in a Japanese anime or manga style, never for a realistic or western scene. Judge by the main subject and the overall scene, never by a small detail in the background. Only names from that list.
5. KIDS: true when the painting is made for children: a simple cartoon or storybook style with big bold shapes, thick outlines, bright flat colors and a cute, playful subject a child would love (friendly animals, dinosaurs, rockets, toy-like cars, smiling characters). false for anything realistic, detailed, moody or grown-up, even when its subject is an animal or a car. A kids painting goes in the Kids Kits version of the theme you pick (e.g. Kids - Animals).
6. DIFFICULTY: how hard the painting is to paint by numbers: "Beginner" for big simple shapes and few small areas (every kids painting), "Intermediate" for a normal level of detail, "Advanced" for many small areas, fine details, faces, fur, foliage or intricate patterns.`,
        passthroughBinaryImages: true,
    },
}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 });
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
            themes: { type: "array", items: { type: "string" }, description: "exactly 1 name from the theme list" },
            kids: { type: "boolean", description: "true when the painting is a children's cartoon style: it goes in the Kids Kits collections" },
            difficulty: { type: "string", description: "Beginner, Intermediate or Advanced" },
        },
        required: ["title", "description", "tags", "themes", "kids", "difficulty"],
    }, null, 2),
});
connect("Listing format", "Titling agent", 0, "ai_outputParser");

node("Build product JSON", "n8n-nodes-base.code", 2, [2500, 200], {
    jsCode: `// The product JSON, in Shopify's field names, saved next to the artwork as <folder>_product.json
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
    // a kids-only theme (e.g. Space: only "Kids - Space" exists) is kept for a kids painting only
    if (theme && !chosen.includes(theme) && (!theme.kidsOnly || out.kids === true)) chosen.push(theme);
}
// one collection per painting: keep the first valid theme only
chosen.splice(1);
// a kids painting goes in each theme's "<theme> - Kids Kits" collection instead of the main one (the main one when the
// theme has no Kids Kits collection); an automated Kids Kits collection picks it up by its tags (kids-kits + the theme)
const kids = out.kids === true;
const categoryChoices = $('Themes').first().json.categoryChoices || [];
const difficultyChoices = $('Themes').first().json.difficultyChoices || [];
// a kids painting is always "Beginner"; an answer outside the allowed values becomes "Intermediate"
const pickDifficulty = (want) => difficultyChoices.find((d) => d.toLowerCase() === String(want || "").trim().toLowerCase()) || "";
const difficulty = kids ? (pickDifficulty("Beginner") || "Beginner") : (pickDifficulty(out.difficulty) || pickDifficulty("Intermediate") || "");
const collections = chosen.map((t) => {
    const main = t.collections.find((c) => c.title === t.name);
    const kidsKits = kids ? t.collections.find((c) => c.kids) : null;
    return kidsKits || main;
}).filter((c) => c && !c.smart);

// plain text: any HTML the model adds anyway becomes paragraph breaks
const description = String(out.description || "")
    .replace(/<\\/p>\\s*<p[^>]*>/gi, "\\n\\n").replace(/<br\\s*\\/?>/gi, "\\n").replace(/<[^>]+>/g, "")
    .replace(/[ \\t]+/g, " ").replace(/\\s*\\n\\s*\\n\\s*/g, "\\n\\n").trim();

const tags = [];
for (const tag of [...String(settings.baseTags).split(","), ...(kids ? ["kids-kits"] : []), ...chosen.map((t) => t.tag), ...(out.tags || [])]) {
    const clean = String(tag).toLowerCase().replace(/\\s+/g, " ").trim();
    if (clean && !tags.includes(clean)) tags.push(clean);
}

const product = {
    title,
    handle,
    description,
    productType: settings.productType,
    vendor: settings.vendor,
    themes: chosen.map((t) => t.name),
    kids,
    // the collection-page filters: Category = the product's themes (allowed values only), Difficulty level
    category: chosen.map((t) => t.name).filter((n) => !categoryChoices.length || categoryChoices.includes(n)).slice(0, 5),
    difficulty,
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
// the product JSON is saved: the folder's try marker is no longer needed (a side branch above the loop, so it runs first)
node("Delete the try", "n8n-nodes-base.httpRequest", 4.2, [2940, 60], {
    method: "DELETE",
    url: "=https://www.googleapis.com/drive/v3/files/{{ $('Record the try').first().json.id }}?supportsAllDrives=true",
    ...googleAuth,
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Save product JSON", "Delete the try");

node("Summary", "n8n-nodes-base.code", 2, [1980, -40], {
    jsCode: `// What this run produced (visible in the execution log)
const saved = $input.all().map((item) => item.json.name).filter(Boolean);
return [{ json: { saved: saved.length, files: saved } }];`,
});
connect("Loop over folders", "Summary", 0);

// ---- release the lock; a run that wrote product JSONs starts again (it stops at once when none is missing) ----
lock.release([2200, -420], "$('Summary').isExecuted && $('Summary').first().json.saved > 0");
connect("Summary", "Locks to delete");
connect("Folders to title?", "Locks to delete", 1);

const workflow = { name: "Darl'Art Titling Agent", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: ERROR_WORKFLOW_ID }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-titling-agent.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
