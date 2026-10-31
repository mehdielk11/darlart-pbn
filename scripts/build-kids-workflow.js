/** Assemble one independent Kids workflow from the maintained agent templates. */
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const root = path.join(__dirname, "..");
const DEFAULTS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH",
    allocationQueueFolderId: "13fjEqSw2tqYfKwn23RPDdItLigrRvjTb",
    pricesSheetId: "1iv2qOUSHPMWgdlZ5ZoCxx9WPljK9V3eWKZp7cYlB9Pk",
    pricesTab: "Kids", pricesTabId: 188180018, canvasSize: "24x30", colors: 18, difficulty: "hard",
    queueFolderId: "KIDS_QUEUE_FOLDER_ID", doneFolderId: "KIDS_DONE_FOLDER_ID",
    refFolderId: "KIDS_REFERENCES_FOLDER_ID", failedFolderId: "KIDS_FAILED_FOLDER_ID",
    telegramChatId: "",
};
const stages = { form: "artwork-agent", worker: "artwork-worker", titling: "titling-agent", print: "print-agent", upload: "shopify-uploader", prices: "price-sync", translate: "translation-sync" };
const read = (stage) => JSON.parse(fs.readFileSync(path.join(root, "automation/n8n-darlart-" + stages[stage] + ".json"), "utf8"));
function mapStrings(value, fn) {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
    return value;
}
function buildKidsWorkflow(config = {}) {
    const settings = { ...DEFAULTS, ...config };
    const dims = settings.canvasSize.split("x").map(Number);
    if (dims.length !== 2 || dims.some((n) => !Number.isFinite(n)) || dims[0] < 20 || dims[0] > 32 || Math.abs(dims[1] / dims[0] - 1.25) > 1e-8) throw new Error("Kids size must be 4:5, from 20x25 to 32x40");
    settings.canvasSize = dims.join("x");
    const nodes = [], connections = {};
    const link = (a, b, index = 0, type = "main") => {
        const outputs = (connections[a] ||= {})[type] ||= [];
        while (outputs.length <= index) outputs.push([]);
        outputs[index].push({ node: b, type, index: 0 });
    };
    const add = (name, type, parameters, position, extra = {}) => nodes.push({ id: "kids-global-" + createHash("sha256").update(name).digest("hex").slice(0, 24), name, type, typeVersion: type.endsWith(".code") ? 2 : 1, parameters, position, ...extra });
    const routeFor = (stage, name) => name === "Run Titling Agent" ? "titling" : name === "Run Print Agent" ? "print" : name === "Run Shopify Uploader" ? "upload" : name === "Start worker" ? "worker" : name === "Check batches" ? "batch-messages" : stage;
    let stageIndex = 0;
    for (const stage of Object.keys(stages)) {
        const source = read(stage);
        const get = (name) => source.nodes.find((n) => n.name === name);
        const pref = (name) => stage + ": " + name;
        const assignments = get("Settings").parameters.assignments.assignments;
        const set = (name, value) => {
            const a = assignments.find((a) => a.name === name);
            if (a) a.value = value;
            else assignments.push({ id: "kids-" + name, name, value, type: typeof value === "number" ? "number" : "string" });
        };
        for (const key of ["agentFolderId", "pricesSheetId", "queueFolderId", "doneFolderId", "refFolderId", "failedFolderId", "telegramChatId"]) if (assignments.some((a) => a.name === key)) set(key, settings[key]);
        if (stage === "worker") { set("colors", 18); set("canvasSize", settings.canvasSize); }
        if (stage === "print") { set("colorsList", "18"); set("canvasSizes", settings.canvasSize); set("mockupColors", 18); set("difficulty", "hard"); }
        if (["prices", "upload"].includes(stage)) set("sizes", settings.canvasSize);
        if (stage === "upload") set("batchDoneFolderId", settings.doneFolderId);
        if (["prices", "translate"].includes(stage)) {
            get("Products page").parameters.jsonBody = get("Products page").parameters.jsonBody.replace("product_type:'Paint by Numbers Kit'", "product_type:'Paint by Numbers Kit' AND tag:kids-kits");
        }
        if (stage === "form") {
            get("Check uploads").parameters.jsCode = get("Check uploads").parameters.jsCode.replace(/const batchId = [^\n]+;/,
                'const batchId = $now.setZone("Africa/Casablanca").toFormat("yyyy-MM-dd_HH-mm-ss") + "_" + $execution.id;');
        }

        // Only this workflow processes Kids folders; a migration is invisible until promoted.
        const folderFilter = get("Folders");
        if (folderFilter) {
            folderFilter.parameters.jsCode = folderFilter.parameters.jsCode.replace('darlart_family !== "kids"', 'darlart_family === "kids" && !["migrating", "review", "validation"].includes((f.appProperties || {}).darlart_state)');
        }
        if (stage === "titling") {
            const b = get("Build product JSON");
            b.parameters.jsCode = b.parameters.jsCode.replace('kids: false', 'kids: true').replace('clean !== "kids-kits" && ', "");
            b.parameters.jsCode = b.parameters.jsCode.replace('const difficulty = kids ?', 'const difficulty = false ?'); // HARD generation is not an automatic Beginner claim.
        }
        if (stage === "worker") {
            // Execution IDs distinguish two form submissions arriving in the same second.
            get("Next reference").parameters.jsCode = `const files = $input.first().json.files || [];
const images = files.filter((f) => /^.+_[0-9]{2}[.](jpg|png|webp)$/.test(f.name)).sort((a,b) => a.name.localeCompare(b.name));
if (!images.length) return [{ json: { none: true } }];
const image = images[0];
const batchId = image.name.split("_").slice(0, -1).join("_");
const manifest = files.find((f) => f.name === batchId + "_batch.json");
return [{ json: { none: false, fileId: image.id, queueName: image.name, extension: image.name.split(".").pop(), batchId, manifestId: manifest ? manifest.id : "", remaining: images.length - 1 } }];`;
            get("Leftover manifests").parameters.jsCode = get("Leftover manifests").parameters.jsCode.replace(/\/\^.*?_batch\\\.json\$\//, '/^.+_batch[.]json$/');
            const folder = get("Create folder (Artwork Agent/1xxx)");
            folder.type = "n8n-nodes-base.httpRequest"; folder.typeVersion = 4.2;
            folder.parameters = {
                method: "POST", url: "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,appProperties",
                authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api", sendBody: true, specifyBody: "json",
                jsonBody: "={{ JSON.stringify({ name: $json.folderName, mimeType: 'application/vnd.google-apps.folder', parents: [$('Settings').first().json.agentFolderId], appProperties: { darlart_family: 'kids', darlart_size: '" + settings.canvasSize + "', darlart_colors: '18' } }) }}", options: { timeout: 30000 },
            };
            for (const name of ["List locks", "List locks again", "Create lock"]) {
                const n = get(name);
                n.parameters = mapStrings(n.parameters, (s) => s.replaceAll("$('Settings').first().json.queueFolderId", "'" + settings.allocationQueueFolderId + "'"));
            }
            get("Build image prompt").parameters.jsCode = get("Build image prompt").parameters.jsCode.replaceAll("75 x 60 cm", dims[1] + " x " + dims[0] + " cm").replaceAll("60 x 75 cm", dims[0] + " x " + dims[1] + " cm");
        }
        if (stage === "print") {
            get("Create pbn job").parameters.bodyParameters.parameters.push(
                { name: "requireExactColors", value: "true" }, { name: "physicalSvg", value: "true" },
                { name: "paintCanvasSizes", value: settings.canvasSize });
            // Validate both API output and all paints before saving production files.
            const check = get("Jobs checked");
            check.parameters.jsCode = check.parameters.jsCode.replace('job.status = "completed";',
                'if (a.result.colorsUsed !== 18 || a.result.colorsRequested !== 18) { Object.assign(job, { status: "failed", error: "Kids template must use exactly 18 paints" }); return; }\n            job.status = "completed";');
            // A deterministic color-count failure is held immediately, not regenerated every five minutes.
            source.nodes.push({ id: "strict-color-holds", name: "Strict color holds", type: "n8n-nodes-base.code", typeVersion: 2, position: [6380, 300], parameters: { jsCode: `const holds = $('Jobs checked').first().json.jobs.filter((j) => j.status === "failed" && /Exact color validation failed|must use exactly 18 paints/.test(j.error || ""));
const seen = new Set();
const unique = holds.filter((j) => !seen.has(j.folderId) && seen.add(j.folderId));
return unique.length ? unique.map((j) => ({ json: { folderId: j.folderId } })) : [{ json: { none: true } }];` } });
            source.nodes.push({ id: "strict-hold-if", name: "Any strict color hold?", type: "n8n-nodes-base.if", typeVersion: 2, position: [6600, 300], parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose" }, conditions: [{ id: "hold", leftValue: "={{ !$json.none }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} } });
            source.nodes.push({ id: "save-strict-hold", name: "Hold template for review", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [6820, 220], parameters: { method: "PATCH", url: "=https://www.googleapis.com/drive/v3/files/{{ $json.folderId }}?supportsAllDrives=true&fields=id,name,appProperties", authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api", sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ appProperties: { darlart_family: "kids", darlart_state: "review", darlart_review_reason: "exact-colors" } }), options: { timeout: 30000 } } });
            source.nodes.push({ id: "restore-jobs-state", name: "Resume jobs state", type: "n8n-nodes-base.code", typeVersion: 2, position: [7040, 300], parameters: { jsCode: "return [{ json: $('Jobs checked').first().json }];" } });
            source.connections["Jobs checked"].main[0] = [{ node: "Strict color holds", type: "main", index: 0 }];
            source.connections["Strict color holds"] = { main: [[{ node: "Any strict color hold?", type: "main", index: 0 }]] };
            source.connections["Any strict color hold?"] = { main: [[{ node: "Hold template for review", type: "main", index: 0 }], [{ node: "Resume jobs state", type: "main", index: 0 }]] };
            source.connections["Hold template for review"] = { main: [[{ node: "Resume jobs state", type: "main", index: 0 }]] };
            source.connections["Resume jobs state"] = { main: [[{ node: "Files to download", type: "main", index: 0 }]] };
        }
        if (["prices", "upload"].includes(stage)) {
            get("Export prices sheet").parameters.url = "=https://docs.google.com/spreadsheets/d/{{ $('Settings').first().json.pricesSheetId }}/export?format=csv&gid=" + settings.pricesTabId;
            const p = get("Prices");
            // The generic parser supports arbitrary counts; Kids must only consume 18-color rows.
            p.parameters.jsCode = p.parameters.jsCode.replace('if (colors === "NaN")', 'if (colors !== "18") throw new Error(where + ": Kids prices must use 18 colors");\n    if (colors === "NaN")');
            p.parameters.jsCode = p.parameters.jsCode.replace('/^\\d+x\\d+$/', '/^\\d+(?:[.]\\d+)?x\\d+(?:[.]\\d+)?$/');
            if (stage === "upload") get("Build product").parameters.jsCode = get("Build product").parameters.jsCode.replace('value("Size").replace("x", "")', 'value("Size").replace(/[^0-9]/g, "")');
        }
        if (stage === "prices") {
            get("Changes").parameters.jsCode = get("Changes").parameters.jsCode.replace('row.size.replace("x", "")', 'row.size.replace(/[^0-9]/g, "")');
            const collect = get("Collect products");
            collect.parameters.jsCode = collect.parameters.jsCode.replace('if ((p.tags || []).includes("kids-kits")) return false;',
                'if (!(p.tags || []).includes("kids-kits")) return false;\n    if (!p.variants.nodes.every((v) => v.selectedOptions.some((o) => o.name === "Colors" && o.value === "18") && v.selectedOptions.some((o) => o.name === "Size" && o.value === "' + settings.canvasSize + '"))) return false;');
        }
        if (stage === "translate") get("Collect products").parameters.jsCode = get("Collect products").parameters.jsCode.replace('if ((p.tags || []).includes("kids-kits")) continue;', 'if (!(p.tags || []).includes("kids-kits")) continue;');

        const removed = new Set(source.nodes.filter((n) => n.type.endsWith("manualTrigger") || n.type.endsWith("scheduleTrigger") || n.type.endsWith("executeWorkflowTrigger")).map((n) => n.name));
        const names = source.nodes.map((n) => n.name);
        for (const old of source.nodes) {
            if (removed.has(old.name)) continue;
            let n = structuredClone(old);
            n.parameters = mapStrings(n.parameters, (s) => {
                for (const name of names) {
                    s = s.replaceAll("$('" + name + "')", "$('" + pref(name) + "')").replaceAll('$("' + name + '")', '$("' + pref(name) + '")');
                }
                if (stage !== "worker") s = s.replaceAll("_" + stages[stage] + ".lock", "_kids-" + stages[stage] + ".lock");
                if (stage !== "worker") s = s.replaceAll("_failed-", "_kids-failed-");
                return s;
            });
            if (n.type === "n8n-nodes-base.executeWorkflow") {
                n.parameters.workflowId = { __rl: true, mode: "id", value: "={{ $workflow.id }}" };
                // A code node supplies the stage explicitly; passthrough triggers do not require a declared schema.
                const route = routeFor(stage, old.name);
                const setter = pref("Route " + old.name);
                add(setter, "n8n-nodes-base.code", { jsCode: `return [{ json: { mode: ${JSON.stringify(route)} } }];` }, [n.position[0] - 80, n.position[1] + stageIndex * 2200]);
                for (const outputs of Object.values(source.connections)) for (const branches of Object.values(outputs)) for (const branch of branches) for (const edge of branch) if (edge.node === old.name) edge.node = "Route " + old.name;
                link(setter, pref(old.name));
            }
            if (n.type === "n8n-nodes-base.formTrigger") {
                n.parameters.formTitle = "Darl'Art Kids Artwork Agent";
                n.parameters.formDescription = "Upload Kids artwork references. Each design uses exactly 18 Darl'Art paints, HARD detail and " + settings.canvasSize + " cm (landscape reversed). Files are saved in the existing Artwork Agent folder.";
                n.webhookId = config.formWebhookId || "darlart-kids-upload";
            }
            n.id = "kids-" + stage + "-" + old.id;
            n.name = pref(old.name);
            n.position = [n.position[0], n.position[1] + stageIndex * 2200];
            delete n.credentials;
            nodes.push(n);
        }
        for (const [from, outputs] of Object.entries(source.connections)) {
            if (removed.has(from)) continue;
            for (const [type, branches] of Object.entries(outputs)) branches.forEach((edges, i) => {
                for (const e of edges) if (!removed.has(e.node)) link(pref(from), pref(e.node), i, type);
            });
        }
        // Settings is the stage entrypoint. The form's Settings still follows its validation node.
        if (stage !== "form") link("Run " + stage, pref("Settings"));
        stageIndex++;
    }
    add("Run now", "n8n-nodes-base.manualTrigger", {}, [-1100, 0]);
    add("Maintenance", "n8n-nodes-base.scheduleTrigger", { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }, [-1100, 200], { typeVersion: 1.2 });
    add("When called", "n8n-nodes-base.executeWorkflowTrigger", { inputSource: "passthrough" }, [-1100, 400], { typeVersion: 1.1 });
    add("Operations", "n8n-nodes-base.webhook", { httpMethod: "POST", path: "darlart-kids-ops", authentication: "headerAuth", responseMode: "onReceived", options: {} }, [-1100, 600], { typeVersion: 2.1, webhookId: "darlart-kids-ops" });
    add("Select stages", "n8n-nodes-base.code", { jsCode: `const input = $input.first().json;
const mode = (input.body || input).mode || "maintenance";
const allowed = ["worker", "titling", "print", "upload", "prices", "translate", "batch-messages"];
if (mode !== "maintenance" && !allowed.includes(mode)) throw new Error("Unknown Kids stage: " + mode);
return [{ json: { mode } }];` }, [-850, 200]);
    for (const name of ["Run now", "Maintenance", "When called", "Operations"]) link(name, "Select stages");
    for (const stage of ["worker", "titling", "print", "upload", "prices", "translate"]) {
        add("Run " + stage, "n8n-nodes-base.if", { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose" }, conditions: [{ id: "kids-route-" + stage, leftValue: `={{ $json.mode === 'maintenance' || $json.mode === '${stage}'${stage === "upload" ? " || $json.mode === 'batch-messages'" : ""} }}`, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} }, [-600, Object.keys(stages).indexOf(stage) * 160], { typeVersion: 2 });
        link("Select stages", "Run " + stage);
    }
    return { name: "Darl'Art Kids Agent", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: "aokToPHKOa4MciN1", saveDataSuccessExecution: "none", saveManualExecutions: true }, pinData: {} };
}
if (require.main === module) {
    const config = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {};
    const w = buildKidsWorkflow(config);
    const out = path.join(root, "automation/n8n-darlart-kids-agent.json");
    fs.writeFileSync(out, JSON.stringify(w, null, 2) + "\n");
    console.log("Wrote " + out + ": " + w.nodes.length + " nodes");
}
module.exports = { buildKidsWorkflow, DEFAULTS };
