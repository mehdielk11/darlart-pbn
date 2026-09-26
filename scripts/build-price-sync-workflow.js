/**
 * Builds automation/n8n-darlart-price-sync.json, the "Darl'Art Price Sync" n8n workflow: brings the products the
 * Shopify Uploader made in line with the prices Google Sheet, every hour or on "Run now".
 *
 *   prices sheet (same reading as the Uploader, scripts/lib/prices-code.js)
 *   -> every "Paint by Numbers Kit" product, 10 per page; only the Uploader's products are touched: handle ending
 *      with the folder number (e.g. blue-iris-1003) and every SKU starting with it (manual products are left alone)
 *   -> per product, only what differs from the sheet:
 *        price or compare-at price changed          -> updated (the variant keeps its id: carts and orders are safe)
 *        price set to 0 in the sheet ("not sold")    -> variant deleted (the product page shows it greyed out)
 *        price above 0 again for a missing variant   -> variant created, SKU as the Uploader makes it
 *      a combination missing from the sheet is never deleted (a sheet mistake cannot empty the store)
 *   -> the canvas option values get their French and Arabic names (canvasTranslations), like the store's other kits:
 *      the product page picks the canvas icons by these names, so without them fr/ar pages show a default icon
 *   -> one Telegram message when something changed or failed (nothing when all is already in line)
 *
 * One run at a time (a Drive lock in "Artwork Agent", scripts/lib/n8n-queue-lock.js); a failed run's lock is released
 * by the Darl'Art Error Handler.
 */
const fs = require("fs");
const path = require("path");
const { queueLock, RETRY } = require("./lib/n8n-queue-lock");
const { PRICES_CODE } = require("./lib/prices-code");

const root = path.join(__dirname, "..");
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1"; // "Darl'Art Error Handler"

const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent": the lock lives here
    pricesSheetId: "1iv2qOUSHPMWgdlZ5ZoCxx9WPljK9V3eWKZp7cYlB9Pk", // Google Sheet "Darl'Art Prices" (first tab)
    shopDomain: "smgi0i-0a.myshopify.com",
    apiVersion: "2026-07",
    sizes: "20x25,32x40,40x50", // same as the Uploader: rows of other sizes are ignored
    compareAtMultiplier: 2, // same as the Uploader
    telegramChatId: "-1003952514058", // empty = no message
    // the canvas values' names in the store's other languages (same as the manual kits)
    canvasTranslations: JSON.stringify({
        "Rolled Canvas": { fr: "Toile roulée", ar: "قماش ملفوف" },
        "Stretched Canvas": { fr: "Toile tendue", ar: "قماش مشدود" },
    }),
};

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "ff" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
}
function connect(from, to, output = 0, type = "main") {
    connections[from] = connections[from] || {};
    const outputs = (connections[from][type] = connections[from][type] || []);
    while (outputs.length <= output) { outputs.push([]); }
    outputs[output].push({ node: to, type, index: 0 });
}
const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
const ifNode = (name, position, left) => node(name, "n8n-nodes-base.if", 2, position, {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
const googleAuth = { authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api" };
// Shopify Admin GraphQL; every call is safe to repeat, one item at a time
const shopify = (name, position, body, extra = {}) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    method: "POST",
    url: "=https://{{ $('Settings').first().json.shopDomain }}/admin/api/{{ $('Settings').first().json.apiVersion }}/graphql.json",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "shopifyOAuth2Api",
    sendBody: true,
    specifyBody: "json",
    jsonBody: body,
    options: { timeout: 120000, batching: { batch: { batchSize: 1, batchInterval: 500 } } },
}, { ...RETRY, ...extra });

// ---- 1. triggers, settings, lock ----------------------------------------------------------------------
node("Every hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0], { rule: { interval: [{ field: "hours", hoursInterval: 1, triggerAtMinute: 20 }] } });
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 200], {});
node("Settings", "n8n-nodes-base.set", 3.4, [220, 100], {
    assignments: { assignments: Object.entries(SETTINGS).map(([name, value], i) => ({ id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string" })) },
    options: {},
}, { executeOnce: true });
connect("Every hour", "Settings");
connect("Run now", "Settings");

const lock = queueLock({ node, connect }, { prefix: "_price-sync.lock", folderExpression: "$('Settings').first().json.agentFolderId", staleMinutes: 5, x: 440, y: -300 });
connect("Settings", "List locks");

// ---- 2. the prices sheet, read like the Uploader reads it -----------------------------------------------
node("Find prices sheet", "n8n-nodes-base.httpRequest", 4.2, [2000, 100], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $('Settings').first().json.pricesSheetId }}",
    ...googleAuth,
    sendQuery: true,
    queryParameters: { parameters: [{ name: "fields", value: "id,name,mimeType,modifiedTime,trashed" }, { name: "supportsAllDrives", value: "true" }] },
    options: { timeout: 30000 },
}, RETRY);
connect("Lock won?", "Find prices sheet", 0);
code("Prices file", [2220, 100], `const file = $input.first().json;
if (!file.id || file.trashed) throw new Error("The prices sheet (pricesSheetId in Settings) is missing or in the trash");
if (file.mimeType !== "application/vnd.google-apps.spreadsheet") throw new Error(file.name + " is not a Google Sheet: pricesSheetId must point to the prices spreadsheet");
return [{ json: { id: file.id, name: file.name, modifiedTime: file.modifiedTime } }];`);
connect("Find prices sheet", "Prices file");
node("Export prices sheet", "n8n-nodes-base.httpRequest", 4.2, [2440, 100], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $json.id }}/export?mimeType=text/csv",
    ...googleAuth,
    options: { response: { response: { responseFormat: "text", outputPropertyName: "data" } }, timeout: 60000 },
}, RETRY);
connect("Prices file", "Export prices sheet");
code("Prices", [2660, 100], PRICES_CODE);
connect("Export prices sheet", "Prices");

// ---- 3. the store's kits, 10 per page (the products and pages travel through the loop) -------------------
code("Next page", [2880, 100], `// First page, or the next one after the last page read
if ($runIndex === 0) return [{ json: { cursor: null, products: [] } }];
const last = $('Collect products').first().json;
return [{ json: { cursor: last.cursor, products: last.products } }];`);
connect("Prices", "Next page");
shopify("Products page", [3100, 100], `={{ JSON.stringify({
    query: "query Page($after: String) { products(first: 10, after: $after, query: \\"product_type:'Paint by Numbers Kit'\\") { pageInfo { hasNextPage endCursor } nodes { id title handle options { name position optionValues { id name fr: translations(locale: \\"fr\\") { key value } ar: translations(locale: \\"ar\\") { key value } } } variants(first: 60) { nodes { id sku price compareAtPrice selectedOptions { name value } } } } } }",
    variables: { after: $json.cursor }
}) }}`);
connect("Next page", "Products page");
code("Collect products", [3320, 100], `// The Uploader's products only: handle "<name>-<folder>" and every SKU starting with the folder number
const previous = $('Next page').first().json.products;
const response = $input.first().json;
if (response.errors) throw new Error("Shopify: " + JSON.stringify(response.errors).slice(0, 300));
const page = response.data.products;
const mine = page.nodes.filter((p) => {
    const m = /-(\\d{4,})$/.exec(p.handle);
    return m && p.variants.nodes.length && p.variants.nodes.every((v) => new RegExp("^" + m[1] + "\\\\d+[RS]$").test(v.sku || ""));
}).map((p) => ({ ...p, folder: /-(\\d{4,})$/.exec(p.handle)[1] }));
return [{ json: { cursor: page.pageInfo.endCursor, more: page.pageInfo.hasNextPage, products: previous.concat(mine) } }];`);
connect("Products page", "Collect products");
ifNode("More pages?", [3540, 100], "={{ $json.more }}");
connect("Collect products", "More pages?");
connect("More pages?", "Next page", 0);

// ---- 4a. translations: the canvas values' French and Arabic names, when missing or different ------------------
code("Missing translations", [3760, -120], `// Canvas option values without their French / Arabic name (from canvasTranslations in Settings)
const wanted = JSON.parse($('Settings').first().json.canvasTranslations || "{}");
const todo = [];
for (const p of $input.first().json.products) {
    for (const opt of p.options) {
        if (opt.name !== "Canvas Type") continue;
        for (const v of opt.optionValues) {
            const want = wanted[v.name];
            if (!want) continue;
            const have = { fr: ((v.fr || [])[0] || {}).value, ar: ((v.ar || [])[0] || {}).value };
            const locales = Object.keys(want).filter((l) => have[l] !== want[l]);
            if (locales.length) todo.push({ id: v.id, name: v.name, folder: p.folder, translations: locales.map((l) => ({ locale: l, value: want[l] })) });
        }
    }
}
return [{ json: { todo, ids: todo.map((t) => t.id) } }];`, { executeOnce: true });
connect("More pages?", "Missing translations", 1);
ifNode("Translations to add?", [3980, -120], "={{ $json.todo.length > 0 }}");
connect("Missing translations", "Translations to add?");
shopify("Translation digests", [4200, -200], `={{ JSON.stringify({
    query: "query D($ids: [ID!]!) { translatableResourcesByIds(first: 100, resourceIds: $ids) { nodes { resourceId translatableContent { key digest } } } }",
    variables: { ids: $json.ids.slice(0, 100) }
}) }}`, { onError: "continueRegularOutput" });
connect("Translations to add?", "Translation digests", 0);
code("Translations request", [4420, -200], `// One request registering every missing name (a value's digest proves which English text it translates)
const todo = $('Missing translations').first().json.todo;
const nodes = ((($input.first().json.data || {}).translatableResourcesByIds) || {}).nodes || [];
const vars = [];
const parts = [];
const variables = {};
todo.forEach((t, i) => {
    const node = nodes.find((n) => n.resourceId === t.id);
    const digest = node && (node.translatableContent.find((c) => c.key === "name") || {}).digest;
    if (!digest) return;
    vars.push("$r" + i + ": ID!", "$t" + i + ": [TranslationInput!]!");
    parts.push("t" + i + ": translationsRegister(resourceId: $r" + i + ", translations: $t" + i + ") { userErrors { field message } }");
    variables["r" + i] = t.id;
    variables["t" + i] = t.translations.map((x) => ({ locale: x.locale, key: "name", value: x.value, translatableContentDigest: digest }));
});
if (!parts.length) return [{ json: { none: true } }];
return [{ json: { count: parts.length, body: { query: "mutation R(" + vars.join(", ") + ") { " + parts.join(" ") + " }", variables } } }];`, { executeOnce: true });
connect("Translation digests", "Translations request");
ifNode("Any translation?", [4640, -200], "={{ !$json.none }}");
connect("Translations request", "Any translation?");
shopify("Save translations", [4860, -280], "={{ JSON.stringify($json.body) }}", { onError: "continueRegularOutput" });
connect("Any translation?", "Save translations", 0);
connect("Save translations", "Changes");
connect("Any translation?", "Changes", 1);
connect("Translations to add?", "Changes", 1);

// ---- 4b. what differs from the sheet, product by product --------------------------------------------------
code("Changes", [3760, 180], `// Per product: variants to update (price), delete (price 0 in the sheet) and create (price above 0 again)
const prices = $('Prices').first().json;
const products = $('Collect products').first().json.products;
const byKey = {};
for (const row of prices.rows) byKey[row.key] = row;
const optionOf = (v, name) => (v.selectedOptions.find((o) => o.name === name) || {}).value;
const keyOf = (v) => optionOf(v, "Size") + "|" + optionOf(v, "Canvas Type") + "|" + optionOf(v, "Colors");
const money = (x) => (x === null || x === undefined || x === "" ? null : Number(x).toFixed(2));
const out = [];
for (const p of products) {
    const existing = {};
    for (const v of p.variants.nodes) existing[keyOf(v)] = v;
    const update = [];
    const remove = [];
    const create = [];
    for (const [key, v] of Object.entries(existing)) {
        const row = byKey[key];
        if (!row) continue; // not in the sheet (another size...): left alone
        if (!row.sold) { remove.push({ id: v.id, key }); continue; }
        if (money(v.price) !== row.price || money(v.compareAtPrice) !== row.compareAtPrice) {
            update.push({ id: v.id, price: row.price, compareAtPrice: row.compareAtPrice, key, was: money(v.price) });
        }
    }
    for (const row of prices.rows) {
        if (!row.sold || existing[row.key]) continue;
        create.push({
            optionValues: [{ optionName: "Size", name: row.size }, { optionName: "Canvas Type", name: row.canvasType }, { optionName: "Colors", name: row.colors }],
            price: row.price,
            compareAtPrice: row.compareAtPrice,
            inventoryPolicy: "DENY",
            inventoryItem: { tracked: false, requiresShipping: true, sku: p.folder + row.size.replace("x", "") + row.colors + row.canvasType.charAt(0).toUpperCase() },
        });
    }
    if (!update.length && !remove.length && !create.length) continue;
    // a product always keeps at least one variant: if the sheet would leave none, nothing is deleted
    const kept = Object.keys(existing).length - remove.length + create.length;
    const removeNow = kept > 0 ? remove : [];
    // new values go back to their place: options in the sheet's order, only the values the product will have
    const after = new Set(Object.keys(existing).filter((k) => !removeNow.some((r) => r.key === k)).concat(create.map((c) => c.optionValues.map((o) => o.name).join("|"))));
    const valuesOf = (i) => [...new Set(prices.rows.map((r) => r.key.split("|")[i]))].filter((value) => [...after].some((k) => k.split("|")[i] === value)).map((name) => ({ name }));
    const reorder = create.length ? [{ name: "Size", values: valuesOf(0) }, { name: "Canvas Type", values: valuesOf(1) }, { name: "Colors", values: valuesOf(2) }] : [];
    const vars = [];
    const parts = [];
    if (create.length) { vars.push("$c: [ProductVariantsBulkInput!]!"); parts.push("c: productVariantsBulkCreate(productId: $p, variants: $c) { userErrors { field message } }"); }
    if (update.length) { vars.push("$u: [ProductVariantsBulkInput!]!"); parts.push("u: productVariantsBulkUpdate(productId: $p, variants: $u) { userErrors { field message } }"); }
    if (removeNow.length) { vars.push("$d: [ID!]!"); parts.push("d: productVariantsBulkDelete(productId: $p, variantsIds: $d) { userErrors { field message } }"); }
    if (reorder.length) { vars.push("$o: [OptionReorderInput!]!"); parts.push("o: productOptionsReorder(productId: $p, options: $o) { userErrors { field message } }"); }
    out.push({ json: {
        productId: p.id,
        folder: p.folder,
        title: p.title,
        summary: { updated: update.map((u) => u.key + " " + u.was + " -> " + u.price), removed: removeNow.map((r) => r.key), created: create.map((c) => c.optionValues.map((o) => o.name).join("|")), keptAll: remove.length !== removeNow.length },
        body: {
            query: "mutation Sync($p: ID!" + (vars.length ? ", " + vars.join(", ") : "") + ") { " + parts.join(" ") + " }",
            variables: { p: p.id, c: create, u: update.map((u) => ({ id: u.id, price: u.price, compareAtPrice: u.compareAtPrice })), d: removeNow.map((r) => r.id), o: reorder },
        },
    } });
}
return out.length ? out : [{ json: { none: true, checked: products.length } }];`, { executeOnce: true });
ifNode("Anything to change?", [3980, 180], "={{ !$json.none }}");
connect("Changes", "Anything to change?");
shopify("Apply changes", [4200, 100], "={{ JSON.stringify($json.body) }}", { onError: "continueRegularOutput" });
connect("Anything to change?", "Apply changes", 0);

code("Sync report", [4420, 100], `// One message: what changed per product, and any error Shopify returned
const changes = $('Changes').all().map((item) => item.json);
const answers = $input.all().map((item) => item.json);
const lines = [];
let failed = 0;
changes.forEach((c, i) => {
    const a = answers[i] || {};
    const errors = [];
    if (a.error) errors.push(String(a.error.message || a.error));
    for (const e of a.errors || []) errors.push(e.message);
    for (const part of Object.values(a.data || {})) for (const e of (part && part.userErrors) || []) errors.push(e.message);
    const s = c.summary;
    const bits = [];
    if (s.updated.length) bits.push(s.updated.length + " price" + (s.updated.length === 1 ? "" : "s") + " updated");
    if (s.removed.length) bits.push(s.removed.length + " not sold (removed)");
    if (s.created.length) bits.push(s.created.length + " back on sale");
    if (s.keptAll) bits.push("nothing removed: every price of this product is 0 in the sheet");
    lines.push("- " + c.folder + " " + c.title + ": " + bits.join(", ") + (errors.length ? " | ERROR: " + errors.join("; ").slice(0, 300) : ""));
    if (errors.length) failed++;
});
const tr = $('Save translations').isExecuted ? $('Save translations').first().json : null;
if (tr) {
    const errs = [];
    if (tr.error) errs.push(String(tr.error.message || tr.error));
    for (const e of tr.errors || []) errs.push(e.message);
    for (const part of Object.values(tr.data || {})) for (const e of (part && part.userErrors) || []) errs.push(e.message);
    if (errs.length) { lines.push("- translations: ERROR " + errs.join("; ").slice(0, 300)); failed++; }
}
const head = "Price Sync: " + changes.length + " product" + (changes.length === 1 ? "" : "s") + " brought in line with the prices sheet" + (failed ? ", " + failed + " with errors (retried next hour)" : "");
return [{ json: { failed, text: [head, ...lines].join("\\n").slice(0, 4000) } }];`, { executeOnce: true });
connect("Apply changes", "Sync report");
ifNode("Telegram on?", [4640, 100], "={{ String($('Settings').first().json.telegramChatId || '').trim() !== '' }}");
connect("Sync report", "Telegram on?");
node("Telegram: sync report", "n8n-nodes-base.telegram", 1.2, [4860, 20], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    // HTML with the text escaped: Markdown (n8n's default) refuses texts with "_"
    text: "={{ String($json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
}, { onError: "continueRegularOutput" });
connect("Telegram on?", "Telegram: sync report", 0);

// ---- 5. release the lock (the next run is the next hour) --------------------------------------------------
lock.release([5080, 260], "false");
connect("Telegram: sync report", "Locks to delete");
connect("Telegram on?", "Locks to delete", 1);
connect("Anything to change?", "Locks to delete", 1);

const workflow = {
    name: "Darl'Art Price Sync",
    nodes,
    connections,
    settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: ERROR_WORKFLOW_ID, saveDataSuccessExecution: "all", saveManualExecutions: true },
    pinData: {},
};
const out = path.join(root, "automation/n8n-darlart-price-sync.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
