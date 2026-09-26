/**
 * Builds automation/n8n-darlart-translation-sync.json, the "Darl'Art Translation Sync" n8n workflow: gives the products
 * the Shopify Uploader made their French and Arabic title and description, every hour or on "Run now".
 *
 *   every "Paint by Numbers Kit" product, 25 per page; only the Uploader's products (handle ending with the folder
 *   number, SKUs starting with it): manual products are left alone
 *   -> a product needs work when its title or description has no French / Arabic translation, or an outdated one
 *      (Shopify marks a translation outdated when the English text changes); a translation made by hand in
 *      Translate & Adapt is kept as long as the English text it translates stays the same
 *   -> the AI (OpenAI, the same model as the Titling Agent) translates the English title and description, keeping the
 *      description's paragraphs (HTML tags) as they are; the answer is checked before anything is saved
 *   -> the translations are saved in Shopify (translationsRegister): Settings > Languages > Translate & Adapt shows them.
 *      URLs (handles) are not translated: a product has the same address in every language
 *   -> at most maxPerRun products per run; when more wait, the workflow starts itself again
 *   -> one Telegram message when something was translated or failed (nothing when all is already translated)
 *
 * One run at a time (a Drive lock in "Artwork Agent", scripts/lib/n8n-queue-lock.js); a failed run's lock is released
 * by the Darl'Art Error Handler, a cancelled one's by the Queue Watchdog.
 */
const fs = require("fs");
const path = require("path");
const { queueLock, RETRY, SERVICE_PROBLEM } = require("./lib/n8n-queue-lock");

const root = path.join(__dirname, "..");
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1"; // "Darl'Art Error Handler"

const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent": the lock lives here
    shopDomain: "smgi0i-0a.myshopify.com",
    apiVersion: "2026-07",
    locales: "fr,ar", // the store's other languages (Settings > Languages)
    model: "gpt-5-mini", // same model as the Titling Agent
    maxPerRun: 10, // products translated per run; the workflow starts again while more wait
    // failed tries before a product is given up (translate it by hand); it is tried again once its English text changes
    maxTries: 3,
    telegramChatId: "-1003952514058", // empty = no message
};
const KEYS = ["title", "body_html"]; // what is translated (the handle is not: same URL in every language)
const LANGUAGE_NAMES = { fr: "French", ar: "Arabic (Modern Standard Arabic)" };

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "fe" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
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
node("Every hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0], { rule: { interval: [{ field: "hours", hoursInterval: 1, triggerAtMinute: 40 }] } });
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 200], {});
node("When called by itself", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 400], { inputSource: "passthrough" });
node("Settings", "n8n-nodes-base.set", 3.4, [220, 200], {
    assignments: { assignments: Object.entries(SETTINGS).map(([name, value], i) => ({ id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string" })) },
    options: {},
}, { executeOnce: true });
for (const t of ["Every hour", "Run now", "When called by itself"]) connect(t, "Settings");

// the AI calls take up to a few minutes per run: the lock stays fresh for 15 minutes
const lock = queueLock({ node, connect }, { prefix: "_translation-sync.lock", folderExpression: "$('Settings').first().json.agentFolderId", staleMinutes: 15, x: 440, y: -300 });
connect("Settings", "List locks");

// ---- 2. the store's kits, 25 per page, with their French and Arabic translations -------------------------
code("Next page", [2000, 200], `// First page, or the next one after the last page read
if ($runIndex === 0) return [{ json: { cursor: null, products: [], givenUp: 0 } }];
const last = $('Collect products').first().json;
return [{ json: { cursor: last.cursor, products: last.products, givenUp: last.givenUp } }];`);
connect("Lock won?", "Next page", 0);
// per language only the keys and their state (not the translated texts), plus the failed tries of the product
shopify("Products page", [2220, 200], `={{ JSON.stringify({
    query: "query Page($after: String) { products(first: 25, after: $after, query: \\"product_type:'Paint by Numbers Kit'\\") { pageInfo { hasNextPage endCursor } nodes { id title handle descriptionHtml tries: metafield(namespace: \\"darlart\\", key: \\"translation_tries\\") { value } variants(first: 3) { nodes { sku } } "
        + String($('Settings').first().json.locales).split(",").map((l) => l.trim()).filter(Boolean).map((l) => "t_" + l.replace(/\\W/g, "_") + ": translations(locale: \\"" + l + "\\") { key outdated }").join(" ")
        + " } } }",
    variables: { after: $json.cursor }
}) }}`);
connect("Next page", "Products page");
code("Collect products", [2440, 200], `// The Uploader's products only (handle "<name>-<folder>", SKUs starting with the folder number), and per product
// the keys and languages that need a translation: none yet, or an outdated one. A product that failed maxTries times
// is skipped until its English text changes (its tries are kept with a fingerprint of that text).
const settings = $('Settings').first().json;
const locales = String(settings.locales || "fr,ar").split(",").map((l) => l.trim()).filter(Boolean);
const KEYS = ${JSON.stringify(KEYS)};
const maxTries = Number(settings.maxTries) || 3;
const previous = $('Next page').first().json;
const response = $input.first().json;
if (response.errors) throw new Error("Shopify: " + JSON.stringify(response.errors).slice(0, 300));
const page = response.data.products;
const fingerprint = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(16) + "-" + text.length; };
const todo = [];
let givenUp = previous.givenUp || 0;
for (const p of page.nodes) {
    const m = /-(\\d{4,})$/.exec(p.handle);
    if (!m || !p.variants.nodes.length || !p.variants.nodes.every((v) => new RegExp("^" + m[1] + "\\\\d+[RS]$").test(v.sku || ""))) continue;
    // an empty description has nothing to translate
    const keys = KEYS.filter((key) => key !== "body_html" || String(p.descriptionHtml || "").trim() !== "");
    const need = {};
    for (const locale of locales) {
        const have = p["t_" + locale.replace(/\\W/g, "_")] || [];
        const missing = keys.filter((key) => { const t = have.find((x) => x.key === key); return !t || t.outdated; });
        if (missing.length) need[locale] = missing;
    }
    if (!Object.keys(need).length) continue;
    const hash = fingerprint(p.title + "\\n" + (p.descriptionHtml || ""));
    let tries = 0;
    try { const t = JSON.parse((p.tries && p.tries.value) || "{}"); if (t.hash === hash) tries = Number(t.tries) || 0; } catch (e) {}
    if (tries >= maxTries) { givenUp++; continue; }
    todo.push({ id: p.id, folder: m[1], title: p.title, need, hash, tries });
}
return [{ json: { cursor: page.pageInfo.endCursor, more: page.pageInfo.hasNextPage, products: previous.products.concat(todo), givenUp } }];`);
connect("Products page", "Collect products");
ifNode("More pages?", [2660, 200], "={{ $json.more }}");
connect("Collect products", "More pages?");
connect("More pages?", "Next page", 0);

code("Products to translate", [2880, 280], `// At most maxPerRun products this run (never tried first, then oldest folders first): a product that failed before
// never holds up the others. The rest wait for the next run, started right after.
const settings = $('Settings').first().json;
const all = $input.first().json.products.sort((a, b) => a.tries - b.tries || Number(a.folder) - Number(b.folder));
const now = all.slice(0, Number(settings.maxPerRun) || 10);
return [{ json: { ids: now.map((p) => p.id), products: now, waiting: all.length - now.length, givenUp: $input.first().json.givenUp || 0 } }];`, { executeOnce: true });
connect("More pages?", "Products to translate", 1);
ifNode("Anything to translate?", [3100, 280], "={{ $json.products.length > 0 }}");
connect("Products to translate", "Anything to translate?");

// ---- 3. the English texts (and their digests: a translation is tied to the text it translates) -------------
const SYSTEM = [
    "You translate product listings for Darl'Art, a Moroccan paint-by-numbers kit brand, from English.",
    "Write natural, appealing sales copy for customers in Morocco: keep the meaning and the tone, do not translate word by word.",
    "The description is HTML: keep exactly the same tags and paragraph structure (<p>, <br> and any other tag), translate only the text between the tags.",
    "Never translate the brand name Darl'Art. Keep numbers, sizes (e.g. 40x50) and color counts as they are.",
    "The title stays short and has no quotes.",
].join(" ");
shopify("English texts", [3320, 200], `={{ JSON.stringify({
    query: "query D($ids: [ID!]!) { translatableResourcesByIds(first: 50, resourceIds: $ids) { nodes { resourceId translatableContent { key value digest locale } } } }",
    variables: { ids: $json.ids }
}) }}`);
connect("Anything to translate?", "English texts", 0);
code("Texts to translate", [3540, 200], `// One item per product: its English texts, their digests, and the AI request for only what it needs (a product
// whose French title alone is outdated sends only its title, and asks only for French)
const settings = $('Settings').first().json;
const NAMES = ${JSON.stringify(LANGUAGE_NAMES)};
const SYSTEM = ${JSON.stringify(SYSTEM)};
const products = $('Products to translate').first().json.products;
const response = $input.first().json;
if (response.errors) throw new Error("Shopify: " + JSON.stringify(response.errors).slice(0, 300));
const byId = {};
for (const n of response.data.translatableResourcesByIds.nodes) byId[n.resourceId] = n.translatableContent;
const out = [];
for (const p of products) {
    const content = byId[p.id] || [];
    const get = (key) => content.find((c) => c.key === key) || {};
    const title = get("title"), body = get("body_html");
    if (!title.value) continue;
    const need = {};
    for (const [locale, keys] of Object.entries(p.need)) {
        const k = keys.filter((key) => key === "title" || String(body.value || "").trim() !== "");
        if (k.length) need[locale] = k;
    }
    const locales = Object.keys(need);
    if (!locales.length) continue;
    const texts = [];
    if (locales.some((l) => need[l].includes("title"))) texts.push("TITLE:\\n" + title.value);
    if (locales.some((l) => need[l].includes("body_html"))) texts.push("DESCRIPTION (HTML):\\n" + body.value);
    const request = {
        model: settings.model,
        messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "Translate into " + locales.map((l) => l + " (" + (NAMES[l] || l) + ")").join(" and ") + ".\\n\\n" + texts.join("\\n\\n") },
        ],
        response_format: { type: "json_schema", json_schema: { name: "translations", strict: true, schema: {
            type: "object", additionalProperties: false, required: locales,
            properties: Object.fromEntries(locales.map((l) => [l, { type: "object", additionalProperties: false, required: need[l], properties: Object.fromEntries(need[l].map((k) => [k, { type: "string" }])) }])),
        } } },
    };
    out.push({ json: { ...p, need, english: { title: title.value, body_html: body.value || "" }, digests: { title: title.digest, body_html: body.digest }, request } });
}
return out.length ? out : [{ json: { none: true } }];`);
connect("English texts", "Texts to translate");

// ---- 4. the AI translation, one product at a time ---------------------------------------------------------
node("Translate", "n8n-nodes-base.httpRequest", 4.2, [3760, 200], {
    method: "POST",
    url: "https://api.openai.com/v1/chat/completions",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "openAiApi",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.request) }}",
    options: { timeout: 180000, batching: { batch: { batchSize: 1, batchInterval: 0 } } },
}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: "continueRegularOutput" });
ifNode("Any text?", [3650, 280], "={{ !$json.none }}");
connect("Texts to translate", "Any text?");
connect("Any text?", "Translate", 0);
connect("Any text?", "Translation report", 1);

code("Check translations", [3980, 200], `// The AI's answer, checked (same paragraphs, nothing empty); per product, the registration of what it needs
const items = $('Texts to translate').all().map((item) => item.json);
const out = [];
const tagsOf = (html) => (String(html).match(/<\\s*\\/?\\s*([a-z0-9]+)/gi) || []).map((t) => t.replace(/[<\\/\\s]/g, "").toLowerCase()).join(",");
$input.all().forEach((item, i) => {
    const p = items[i];
    if (!p || p.none) return;
    const r = item.json || {};
    let answer = null;
    let problem = "";
    // the OpenAI account or service, not this product (no credit, wrong key, rate limit, OpenAI down): not counted as a try
    const service = !!r.error && ${SERVICE_PROBLEM}.test(JSON.stringify(r.error));
    try {
        if (r.error) throw new Error(String(r.error.message || r.error).slice(0, 200));
        const msg = r.choices && r.choices[0] && r.choices[0].message;
        if (!msg || msg.refusal) throw new Error("no answer" + (msg && msg.refusal ? ": " + msg.refusal : ""));
        answer = JSON.parse(msg.content);
    } catch (e) { problem = "AI: " + e.message; }
    const translations = {};
    if (answer) {
        for (const [locale, keys] of Object.entries(p.need)) {
            const t = answer[locale] || {};
            for (const key of keys) {
                const value = String(t[key] || "").trim();
                if (!value) { problem = locale + " " + key + " is empty"; continue; }
                if (key === "body_html" && tagsOf(value) !== tagsOf(p.english.body_html)) { problem = locale + " description lost its paragraphs"; continue; }
                if (key === "title" && value.length > 255) { problem = locale + " title too long"; continue; }
                (translations[locale] = translations[locale] || []).push({ locale, key, value, translatableContentDigest: p.digests[key] });
            }
        }
    }
    const locales = Object.keys(translations);
    out.push({ json: {
        id: p.id, folder: p.folder, title: p.title, problem, service, hash: p.hash, tries: p.tries, locales,
        body: locales.length ? {
            query: "mutation R(" + locales.map((l) => "$" + l + ": [TranslationInput!]!").join(", ") + ") { " + locales.map((l) => l + ": translationsRegister(resourceId: \\"" + p.id + "\\", translations: $" + l + ") { userErrors { field message } }").join(" ") + " }",
            variables: translations,
        } : null,
    } });
});
return out.length ? out : [{ json: { none: true } }];`);
connect("Translate", "Check translations");

code("Translations to save", [4200, 200], `const out = $input.all().filter((item) => item.json.body).map((item) => ({ json: item.json }));
return out.length ? out : [{ json: { none: true } }];`);
connect("Check translations", "Translations to save");
ifNode("Anything to save?", [4310, 280], "={{ !$json.none }}");
connect("Translations to save", "Anything to save?");
shopify("Save translations", [4420, 200], "={{ JSON.stringify($json.body) }}", { onError: "continueRegularOutput" });
connect("Anything to save?", "Save translations", 0);
connect("Anything to save?", "Translation report", 1);

code("Translation report", [4640, 280], `// What was translated, and what failed: a failure counts as a try of the product (kept in its metafield
// darlart.translation_tries with a fingerprint of its English text); after maxTries it is given up until that text changes
const settings = $('Settings').first().json;
const maxTries = Number(settings.maxTries) || 3;
const checked = $('Check translations').isExecuted ? $('Check translations').all().map((item) => item.json).filter((c) => !c.none) : [];
const toSave = checked.filter((c) => c.body);
const saved = $('Save translations').isExecuted ? $('Save translations').all().map((item) => item.json) : [];
const lines = [];
const record = [];
let done = 0, failed = 0, service = "";
const tried = (c, why) => {
    if (c.service) { service = service || why; return " (service problem, not counted)"; }
    const tries = (Number(c.tries) || 0) + 1;
    record.push({ ownerId: c.id, namespace: "darlart", key: "translation_tries", type: "json", value: JSON.stringify({ hash: c.hash, tries }) });
    return tries >= maxTries ? " | GIVEN UP after " + tries + " tries: translate it by hand in Translate & Adapt (it is tried again when its English text changes)" : " (try " + tries + " of " + maxTries + ")";
};
toSave.forEach((c, i) => {
    const a = saved[i] || {};
    const errors = [];
    if (a.error) errors.push(String(a.error.message || a.error));
    for (const e of a.errors || []) errors.push(e.message);
    for (const part of Object.values(a.data || {})) for (const e of (part && part.userErrors) || []) errors.push(e.message);
    if (errors.length) { failed++; lines.push("- " + c.folder + " " + c.title + ": ERROR " + errors.join("; ").slice(0, 200) + tried({ ...c, service: ${SERVICE_PROBLEM}.test(errors.join(" ")) }, errors[0])); }
    else { done++; lines.push("- " + c.folder + " " + c.title + " (" + c.locales.join(", ") + ")" + (c.problem ? " | partly: " + c.problem + tried(c, c.problem) : "")); }
});
for (const c of checked.filter((c) => !c.body)) { failed++; lines.push("- " + c.folder + " " + c.title + ": not translated (" + (c.problem || "no answer") + ")" + tried(c, c.problem)); }
const planned = $('Products to translate').first().json;
const waiting = planned.waiting;
const head = "Translation Sync: " + done + " product" + (done === 1 ? "" : "s") + " translated" + (failed ? ", " + failed + " failed" : "") + (waiting ? ", " + waiting + " more coming" : "");
if (service) lines.push("", "A service refused the calls (" + String(service).slice(0, 200) + "): check the OpenAI account (credit, API key) or the Shopify app. Nothing was counted against the products.");
return [{ json: { done, failed, waiting, record, send: !!(done || failed) && String(settings.telegramChatId || "").trim() !== "", text: [head, ...lines].join("\\n").slice(0, 4000) } }];`, { executeOnce: true, alwaysOutputData: true });
connect("Save translations", "Translation report");
// the failed tries, one call for all the products of the run
ifNode("Any try to record?", [4750, 440], "={{ $json.record.length > 0 }}");
connect("Translation report", "Any try to record?");
shopify("Record failed tries", [4860, 520], `={{ JSON.stringify({
    query: "mutation T($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }",
    variables: { m: $json.record }
}) }}`, { onError: "continueRegularOutput" });
connect("Any try to record?", "Record failed tries", 0);
ifNode("Telegram on?", [5080, 280], "={{ $('Translation report').first().json.send }}");
connect("Record failed tries", "Telegram on?");
connect("Any try to record?", "Telegram on?", 1);
node("Telegram: translation report", "n8n-nodes-base.telegram", 1.2, [5300, 200], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    // HTML with the text escaped: Markdown (n8n's default) refuses texts with "_"
    text: "={{ String($('Translation report').first().json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
}, { onError: "continueRegularOutput" });
connect("Telegram on?", "Telegram: translation report", 0);

// ---- 5. release the lock; start again while products wait --------------------------------------------------
lock.release([5300, 400], "$('Products to translate').isExecuted && $('Products to translate').first().json.waiting > 0 && $('Translation report').isExecuted && $('Translation report').first().json.done > 0");
connect("Telegram: translation report", "Locks to delete");
connect("Telegram on?", "Locks to delete", 1);
connect("Anything to translate?", "Locks to delete", 1);

const workflow = {
    name: "Darl'Art Translation Sync",
    nodes,
    connections,
    // runs that succeed are not kept (they would fill the n8n database every hour; the Telegram report says what was
    // done); failed runs and "Run now" runs are kept
    settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: ERROR_WORKFLOW_ID, saveDataSuccessExecution: "none", saveManualExecutions: true },
    pinData: {},
};
const out = path.join(root, "automation/n8n-darlart-translation-sync.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
