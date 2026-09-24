/**
 * Builds automation/n8n-darlart-shopify-uploader.json, the "Shopify Uploader" n8n workflow:
 *
 *   Print Agent finished / Run now / every day -> prices Google Sheet (Drive) + Drive "Artwork Agent" folders
 *   -> folders that have a product JSON, an artwork and a mockup but no <date+time>_shopify.json yet, one by one:
 *      upload the artwork + mockup to Shopify -> draft product (texts from the product JSON, variants and prices
 *      from the CSV, images: artwork, mockup, then the shared images) -> <date+time>_shopify.json in the folder
 *
 * The prices Google Sheet ("Darl'Art Prices", first tab) is exported as CSV on every run, so a new price
 * applies to every product uploaded after the change. Columns: canvas_type,size,colors,price[,compare_at_price].
 * The product's handle is the product JSON's handle plus the folder number (e.g. blue-iris-1003): a rerun updates
 * the same draft instead of creating a second one, and never touches an existing product.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// ===== Settings written into the workflow (all editable later in the "Settings" node) =====
const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    pricesSheetId: "1iv2qOUSHPMWgdlZ5ZoCxx9WPljK9V3eWKZp7cYlB9Pk", // Google Sheet "Darl'Art Prices" (its first tab is read)
    shopDomain: "smgi0i-0a.myshopify.com", // darlart.ma
    apiVersion: "2026-07",
    status: "DRAFT",
    // the sizes sold: sheet rows of any other size (e.g. 60x75: its print files are still made, it is just not sold) are skipped
    sizes: "20x25,32x40,40x50",
    compareAtMultiplier: 2, // compare-at price = price x this, when the CSV has no compare_at_price
    // the images shown on every product after the artwork and the mockup: Shopify Files URLs
    // (Content > Files > copy link) or file IDs (gid://shopify/MediaImage/...), comma-separated
    // 3_package-kit, 4_rolled-stretched, 5_order-package
    sharedImages: "gid://shopify/MediaImage/53174515335449,gid://shopify/MediaImage/53174515302681,gid://shopify/MediaImage/53174515368217",
    maxPerRun: 10, // folders handled per run, the rest wait for the next run
};
// ============================================================================================

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "cc" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
}
function connect(from, to, output = 0, type = "main") {
    connections[from] = connections[from] || {};
    const outputs = (connections[from][type] = connections[from][type] || []);
    while (outputs.length <= output) { outputs.push([]); }
    outputs[output].push({ node: to, type, index: 0 });
}
const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
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
            { name: "fields", value: "files(id,name,mimeType,modifiedTime)" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
});
// format: "json", "text" (into "data") or a binary property name
const driveDownload = (name, position, fileId, format) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    url: "=https://www.googleapis.com/drive/v3/files/{{ " + fileId + " }}?alt=media&supportsAllDrives=true",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    options: {
        response: { response: format === "json" ? { responseFormat: "json" } : format === "text" ? { responseFormat: "text", outputPropertyName: "data" } : { responseFormat: "file", outputPropertyName: format } },
        timeout: 120000,
    },
});
const shopify = (name, position, body) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    method: "POST",
    url: "=https://{{ $('Settings').first().json.shopDomain }}/admin/api/{{ $('Settings').first().json.apiVersion }}/graphql.json",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "shopifyOAuth2Api",
    sendBody: true,
    specifyBody: "json",
    jsonBody: body,
    options: { timeout: 120000 },
});
// the file goes to the staged upload URL, with the headers Shopify asked for
const stagedPut = (name, position, target, binaryName) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    method: "PUT",
    url: "={{ $('Upload targets').first().json." + target + ".url }}",
    sendHeaders: true,
    specifyHeaders: "json",
    jsonHeaders: "={{ JSON.stringify($('Upload targets').first().json." + target + ".headers) }}",
    sendBody: true,
    contentType: "binaryData",
    inputDataFieldName: binaryName,
    options: { response: { response: { responseFormat: "text" } }, timeout: 120000 },
});

// ---- 1. triggers, settings --------------------------------------------------------------------
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 0], {});
// safety net: catches folders a failed run left behind
node("Every day", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 200], { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 5 }] } });
// the Print Agent calls this workflow when it has saved new files (the mockup is one of them)
node("When called by Print Agent", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 400], { inputSource: "passthrough" });

node("Settings", "n8n-nodes-base.set", 3.4, [220, 200], {
    assignments: {
        assignments: Object.entries(SETTINGS).map(([name, value], i) => ({
            id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string",
        })),
    },
    options: {},
}, { executeOnce: true });
connect("Run now", "Settings");
connect("Every day", "Settings");
connect("When called by Print Agent", "Settings");

// ---- 2. prices, read fresh on every run ---------------------------------------------------------
node("Find prices sheet", "n8n-nodes-base.httpRequest", 4.2, [440, 200], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $('Settings').first().json.pricesSheetId }}",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    sendQuery: true,
    queryParameters: { parameters: [{ name: "fields", value: "id,name,mimeType,modifiedTime,trashed" }, { name: "supportsAllDrives", value: "true" }] },
    options: { timeout: 30000 },
});
connect("Settings", "Find prices sheet");

code("Prices file", [660, 200], `const file = $input.first().json;
if (!file.id || file.trashed) throw new Error("The prices sheet (pricesSheetId in Settings) is missing or in the trash");
if (file.mimeType !== "application/vnd.google-apps.spreadsheet") throw new Error(file.name + " is not a Google Sheet: pricesSheetId must point to the prices spreadsheet");
return [{ json: { id: file.id, name: file.name, modifiedTime: file.modifiedTime } }];`);
connect("Find prices sheet", "Prices file");

// the sheet's first tab, as CSV
node("Export prices sheet", "n8n-nodes-base.httpRequest", 4.2, [880, 200], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $json.id }}/export?mimeType=text/csv",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    options: { response: { response: { responseFormat: "text", outputPropertyName: "data" } }, timeout: 60000 },
});
connect("Prices file", "Export prices sheet");

code("Prices", [1100, 200], `// The CSV becomes the product's options and variants: Size / Canvas Type / Colors, like the store's other kits
const settings = $('Settings').first().json;
const file = $('Prices file').first().json;
const text = String($input.first().json.data || "").replace(/^\\uFEFF/, "");
// empty rows of the sheet export as ",,," lines
const lines = text.split(/\\r?\\n/).map((l) => l.trim()).filter((l) => l.replace(/[,;"\\s]/g, ""));
// one CSV line into cells; a quoted cell may hold a comma (e.g. "179,00" in a French-format sheet)
const split = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === "," || ch === ";") { cells.push(cell.trim()); cell = ""; }
        else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
};
const header = split(lines.shift() || "").map((h) => h.toLowerCase().replace(/\\s+/g, "_"));
const col = (name) => header.indexOf(name);
for (const name of ["canvas_type", "size", "colors", "price"]) {
    if (col(name) < 0) throw new Error(file.name + ": missing column " + name + " (columns: canvas_type,size,colors,price)");
}
// "179", "179.00", "179,00" or "179,00 MAD"
const money = (value) => Number(String(value).replace(/[^\\d,.-]/g, "").replace(",", "."));
const normSize = (value) => String(value || "").toLowerCase().trim().replace(/\\s*cm$/, "").replace(/\\s*[x×]\\s*/, "x");
const soldSizes = String(settings.sizes || "").split(",").map(normSize).filter(Boolean);
const rows = [];
const seen = new Set();
lines.forEach((line, i) => {
    const cells = split(line);
    const size = normSize(cells[col("size")]);
    if (soldSizes.length && !soldSizes.includes(size)) return; // not a size the store sells
    let canvasType = cells[col("canvas_type")];
    if (!/canvas$/i.test(canvasType)) canvasType += " Canvas"; // "Rolled" -> "Rolled Canvas", the store's wording
    const colors = String(parseInt(cells[col("colors")], 10));
    const price = money(cells[col("price")]);
    const compareCell = col("compare_at_price") >= 0 ? cells[col("compare_at_price")] : "";
    const compareAt = compareCell ? money(compareCell) : price * Number(settings.compareAtMultiplier || 0);
    const where = file.name + " line " + (i + 2);
    if (!/^\\d+x\\d+$/.test(size)) throw new Error(where + ": size must look like 30x40");
    if (colors === "NaN") throw new Error(where + ": colors must be a number");
    if (!(price > 0)) throw new Error(where + ": price must be a number above 0");
    const key = size + "|" + canvasType + "|" + colors;
    if (seen.has(key)) throw new Error(where + ": " + key.replace(/\\|/g, " / ") + " is listed twice");
    seen.add(key);
    rows.push({ size, canvasType, colors, price: price.toFixed(2), compareAtPrice: compareAt > price ? compareAt.toFixed(2) : null });
});
if (!rows.length) throw new Error(file.name + " has no prices" + (soldSizes.length ? " for the sizes in Settings (" + soldSizes.join(", ") + ")" : ""));
const missing = soldSizes.filter((s) => !rows.some((r) => r.size === s));
if (missing.length) throw new Error(file.name + " has no prices for " + missing.join(", ") + " (sizes in Settings)");
if (rows.length > 100) throw new Error(file.name + ": Shopify allows 100 variants per product, the CSV has " + rows.length);

const area = (s) => s.split("x").reduce((a, b) => a * Number(b), 1);
const unique = (values) => [...new Set(values)];
const sizes = unique(rows.map((r) => r.size)).sort((a, b) => area(a) - area(b));
const canvasTypes = unique(rows.map((r) => r.canvasType)).sort();
const colors = unique(rows.map((r) => r.colors)).sort((a, b) => a - b);
rows.sort((a, b) => sizes.indexOf(a.size) - sizes.indexOf(b.size) || canvasTypes.indexOf(a.canvasType) - canvasTypes.indexOf(b.canvasType) || a.colors - b.colors);

const productOptions = [
    { name: "Size", position: 1, values: sizes.map((name) => ({ name })) },
    { name: "Canvas Type", position: 2, values: canvasTypes.map((name) => ({ name })) },
    { name: "Colors", position: 3, values: colors.map((name) => ({ name })) },
];
const variants = rows.map((r, i) => ({
    optionValues: [
        { optionName: "Size", name: r.size },
        { optionName: "Canvas Type", name: r.canvasType },
        { optionName: "Colors", name: r.colors },
    ],
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    position: i + 1,
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: false, requiresShipping: true },
}));
return [{ json: { pricesVersion: file.modifiedTime, variantCount: variants.length, productOptions, variants } }];`);
connect("Export prices sheet", "Prices");

// ---- 3. folders waiting for Shopify ------------------------------------------------------------------
driveList("List Artwork Agent folders", [1320, 200], "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
connect("Prices", "List Artwork Agent folders");

code("Folders", [1540, 200], `// One item per numbered folder (1001, 1002...), oldest first
const folders = ($input.first().json.files || []).filter((f) => /^\\d+$/.test(String(f.name).trim()));
folders.sort((a, b) => Number(a.name) - Number(b.name));
return folders.map((f) => ({ json: { id: f.id, name: String(f.name).trim() } }));`);
connect("List Artwork Agent folders", "Folders");

driveList("List folder files", [1760, 200], "='{{ $json.id }}' in parents and trashed = false");
connect("Folders", "List folder files");

code("Pending folders", [1980, 200], `// Keeps the folders that have their product JSON, artwork and mockup, and no <date+time>_shopify.json yet
const settings = $('Settings').first().json;
const folders = $('Folders').all();
const pending = [];
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    const files = item.json.files || [];
    const art = files.find((f) => /^(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2})_art\\.png$/.test(f.name));
    if (!art) return;
    const stamp = art.name.slice(0, 19);
    const find = (suffix) => files.find((f) => f.name === stamp + suffix);
    const product = find("_product.json");
    const mockup = find("_mockup.png");
    const markerName = stamp + "_shopify.json";
    if (!product || !mockup || find("_shopify.json")) return;
    pending.push({ json: { folderId: folder.id, folder: folder.name, stamp, productId: product.id, artworkId: art.id, artworkName: art.name, mockupId: mockup.id, mockupName: mockup.name, markerName } });
});
return pending.slice(0, Number(settings.maxPerRun) || 10);`);
connect("List folder files", "Pending folders");

// ---- 4. one folder at a time ------------------------------------------------------------------------
node("Loop over folders", "n8n-nodes-base.splitInBatches", 3, [2200, 200], { options: {} });
connect("Pending folders", "Loop over folders");

driveDownload("Download product JSON", [2420, 300], "$json.productId", "json");
connect("Loop over folders", "Download product JSON", 1);

shopify("Stage uploads", [2640, 300], `={{ JSON.stringify({
  query: 'mutation StageImages($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }',
  variables: { input: [
    { resource: 'IMAGE', filename: $('Loop over folders').first().json.folder + '-artwork.png', mimeType: 'image/png', httpMethod: 'PUT' },
    { resource: 'IMAGE', filename: $('Loop over folders').first().json.folder + '-mockup.png', mimeType: 'image/png', httpMethod: 'PUT' }
  ] }
}) }}`);
connect("Download product JSON", "Stage uploads");

code("Upload targets", [2860, 300], `// Where the artwork and the mockup go: a URL, the headers to send with the file, and the address Shopify reads it from
const response = $input.first().json;
const errors = [...(response.errors || []), ...(((response.data || {}).stagedUploadsCreate || {}).userErrors || [])].map((e) => e.message);
if (errors.length) throw new Error("Shopify staged upload: " + errors.join("; "));
const targets = response.data.stagedUploadsCreate.stagedTargets;
const target = (t) => ({ url: t.url, resourceUrl: t.resourceUrl, headers: Object.fromEntries(t.parameters.map((p) => [p.name, p.value])) });
return [{ json: { art: target(targets[0]), mockup: target(targets[1]) } }];`);
connect("Stage uploads", "Upload targets");

driveDownload("Download artwork", [3080, 300], "$('Loop over folders').first().json.artworkId", "art");
connect("Upload targets", "Download artwork");
stagedPut("Upload artwork", [3300, 300], "art", "art");
connect("Download artwork", "Upload artwork");

driveDownload("Download mockup", [3520, 300], "$('Loop over folders').first().json.mockupId", "mockup");
connect("Upload artwork", "Download mockup");
stagedPut("Upload mockup", [3740, 300], "mockup", "mockup");
connect("Download mockup", "Upload mockup");

code("Build product", [3960, 300], `// The product JSON (Titling Agent) + the CSV variants + the images, as one productSet input
const settings = $('Settings').first().json;
const folder = $('Loop over folders').first().json;
const product = $('Download product JSON').first().json;
const prices = $('Prices').first().json;
const targets = $('Upload targets').first().json;

const title = String(product.title || "").trim();
if (!title) throw new Error("Folder " + folder.folder + ": the product JSON has no title");
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// the folder number keeps the handle unique: a rerun updates this draft, an existing product is never touched
const handle = (slug(product.handle || title) || "kit") + "-" + folder.folder;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const descriptionHtml = String(product.description || "").split(/\\n\\s*\\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => "<p>" + escape(p).replace(/\\n/g, "<br>") + "</p>").join("\\n");

// the image order is enforced after creation (Image order): 1 artwork, 2 mockup, then the shared images.
// Each image gets its own alt text, so it can be recognized among the product's media.
const alts = { art: title, mockup: title + " - finished painting on the wall" };
const files = [
    { originalSource: targets.art.resourceUrl, contentType: "IMAGE", alt: alts.art },
    { originalSource: targets.mockup.resourceUrl, contentType: "IMAGE", alt: alts.mockup },
];
const shared = [];
String(settings.sharedImages || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((image, i) => {
    if (image.startsWith("gid://")) {
        files.push({ id: image });
        shared.push({ id: image });
    } else {
        const alt = title + " - kit details " + (i + 1);
        files.push({ originalSource: image, contentType: "IMAGE", alt });
        shared.push({ alt });
    }
});

// Mini Kits and Kids Kits collections are filled by hand later: never a collection with "mini kit" or "kids kit" in
// its title, and never a tag those collections match on (mini-kit, kids-kits...)
const kitCollection = (title) => /\b(mini|kids?)[\s-]*kits?\b/i.test(String(title || ""));
const tags = (product.tags || []).filter((tag) => !kitCollection(tag));

// SKU = folder + size digits + color count + canvas type initial, e.g. 1001 + 2025 + 12 + R = 1001202512R
const sku = (variant) => {
    const value = (name) => variant.optionValues.find((o) => o.optionName === name).name;
    return folder.folder + value("Size").replace("x", "") + value("Colors") + value("Canvas Type").charAt(0).toUpperCase();
};

const input = {
    title,
    handle,
    descriptionHtml,
    productType: product.productType || "Paint by Numbers Kit",
    vendor: product.vendor || "Darl'Art",
    status: settings.status || "DRAFT",
    tags,
    collections: (product.collections || []).filter((c) => !kitCollection(c.title)).map((c) => c.id).filter(Boolean),
    productOptions: prices.productOptions,
    variants: prices.variants.map((variant) => ({ ...variant, inventoryItem: { ...variant.inventoryItem, sku: sku(variant) } })),
    files,
};
return [{ json: { handle, title, alts, shared, input } }];`);
connect("Upload mockup", "Build product");

shopify("Create draft product", [4180, 300], `={{ JSON.stringify({
  query: 'mutation UpsertDraftProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) { productSet(synchronous: true, identifier: $identifier, input: $input) { product { id handle title status variantsCount { count } media(first: 50) { nodes { id alt } } } userErrors { field message code } } }',
  variables: { identifier: { handle: $json.handle }, input: $json.input }
}) }}`);
connect("Build product", "Create draft product");

code("Image order", [4400, 300], `// Enforced image order: 1 artwork, 2 mockup, 3+ the shared images (in the Settings order), anything else after them
const folder = $('Loop over folders').first().json;
const built = $('Build product').first().json;
const response = $input.first().json;
const result = (response.data || {}).productSet || {};
const errors = [...(response.errors || []), ...(result.userErrors || [])].map((e) => (e.field ? e.field.join(".") + ": " : "") + e.message);
if (errors.length || !result.product) throw new Error("Folder " + folder.folder + ", Shopify: " + (errors.join("; ") || "no product returned"));
const product = result.product;
const media = product.media.nodes;
const used = new Set();
const pick = (match) => {
    const found = media.find((m) => !used.has(m.id) && match(m));
    if (found) used.add(found.id);
    return found;
};
const art = pick((m) => m.alt === built.alts.art);
const mockup = pick((m) => m.alt === built.alts.mockup);
if (!art || !mockup) throw new Error("Folder " + folder.folder + ": the artwork or the mockup is missing from the product's images");
const shared = built.shared.map((s) => pick((m) => (s.id ? m.id === s.id : m.alt === s.alt)));
// a shared image Shopify attached under a new ID: the next image that is neither the artwork nor the mockup
for (let i = 0; i < shared.length; i++) {
    if (!shared[i]) shared[i] = pick(() => true);
}
if (shared.some((m) => !m)) throw new Error("Folder " + folder.folder + ": " + built.shared.length + " shared images expected, some are missing from the product");
const wanted = [art, mockup, ...shared].map((m) => m.id);
const order = [...wanted, ...media.filter((m) => !used.has(m.id)).map((m) => m.id)];
return [{ json: { productId: product.id, product, wanted, startedAt: Date.now(), moves: order.map((id, i) => ({ id, newPosition: String(i) })) } }];`);
connect("Create draft product", "Image order");

shopify("Reorder images", [4620, 300], `={{ JSON.stringify({
  query: 'mutation ReorderImages($id: ID!, $moves: [MoveInput!]!) { productReorderMedia(id: $id, moves: $moves) { job { id done } mediaUserErrors { field message } } }',
  variables: { id: $json.productId, moves: $json.moves }
}) }}`);
connect("Image order", "Reorder images");

code("Reorder sent", [4840, 300], `const folder = $('Loop over folders').first().json;
const response = $input.first().json;
const result = (response.data || {}).productReorderMedia || {};
const errors = [...(response.errors || []), ...(result.mediaUserErrors || [])].map((e) => e.message);
if (errors.length) throw new Error("Folder " + folder.folder + ", image order: " + errors.join("; "));
return [{ json: { productId: $('Image order').first().json.productId } }];`);
connect("Reorder images", "Reorder sent");

// the reorder is a background job on Shopify's side: read the order back until it is right
node("Wait for reorder", "n8n-nodes-base.wait", 1.1, [5060, 300], { resume: "timeInterval", amount: 3, unit: "seconds" });
connect("Reorder sent", "Wait for reorder");

shopify("Read image order", [5280, 300], `={{ JSON.stringify({
  query: 'query ImageOrder($id: ID!) { product(id: $id) { media(first: 50) { nodes { id alt } } } }',
  variables: { id: $('Image order').first().json.productId }
}) }}`);
connect("Wait for reorder", "Read image order");

code("Order confirmed?", [5500, 300], `// The first images must be exactly: artwork, mockup, shared images. Read again every 3 seconds, for up to MAX_SECONDS.
const MAX_SECONDS = 30;
const wanted = $('Image order').first().json.wanted;
const media = ((($input.first().json.data || {}).product || {}).media || {}).nodes || [];
const actual = media.slice(0, wanted.length).map((m) => m.id);
const ok = wanted.every((id, i) => actual[i] === id);
const seconds = Math.round((Date.now() - $('Image order').first().json.startedAt) / 1000);
return [{ json: { ok, retry: !ok && seconds < MAX_SECONDS, seconds, wanted, actual } }];`);
connect("Read image order", "Order confirmed?");

node("Images in order?", "n8n-nodes-base.if", 2, [5720, 300], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "imagesinorder", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
connect("Order confirmed?", "Images in order?");

node("Check again?", "n8n-nodes-base.if", 2, [5940, 480], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "checkagain", leftValue: "={{ $json.retry }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
connect("Images in order?", "Check again?", 1);
connect("Check again?", "Wait for reorder", 0);

code("Images out of order", [6160, 560], `// Stops the run: the folder gets no marker, so the next run uploads it again (same draft, reordered again)
const folder = $('Loop over folders').first().json;
throw new Error("Folder " + folder.folder + ": Shopify did not apply the image order (artwork, mockup, shared images) after " + $json.seconds + " seconds");`);
connect("Check again?", "Images out of order", 1);

code("Shopify marker", [5940, 200], `// <date+time>_shopify.json marks the folder as done (delete it to upload the folder again)
const settings = $('Settings').first().json;
const folder = $('Loop over folders').first().json;
const product = $('Image order').first().json.product;
const store = settings.shopDomain.replace(".myshopify.com", "");
const marker = {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    status: product.status,
    adminUrl: "https://admin.shopify.com/store/" + store + "/products/" + product.id.split("/").pop(),
    variants: product.variantsCount ? product.variantsCount.count : null,
    images: $('Image order').first().json.wanted,
    pricesVersion: $('Prices').first().json.pricesVersion,
    uploadedAt: $now.setZone("Africa/Casablanca").toISO(),
};
return [{
    json: { folder: folder.folder, title: product.title, adminUrl: marker.adminUrl },
    binary: { data: { data: Buffer.from(JSON.stringify(marker, null, 2)).toString("base64"), mimeType: "application/json", fileName: folder.markerName } },
}];`);
connect("Images in order?", "Shopify marker", 0);

node("Save marker", "n8n-nodes-base.googleDrive", 3, [6160, 200], {
    name: "={{ $('Loop over folders').first().json.markerName }}",
    driveId: drive,
    folderId: byId("={{ $('Loop over folders').first().json.folderId }}"),
    inputDataFieldName: "data",
    options: {},
});
connect("Shopify marker", "Save marker");
connect("Save marker", "Loop over folders");

code("Summary", [2420, 60], `// What this run uploaded (visible in the execution log)
const saved = $input.all().map((item) => item.json.name).filter(Boolean);
return [{ json: { uploaded: saved.length, markers: saved } }];`);
connect("Loop over folders", "Summary", 0);

const workflow = { name: "Darl'Art Shopify Uploader", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca" }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-shopify-uploader.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
