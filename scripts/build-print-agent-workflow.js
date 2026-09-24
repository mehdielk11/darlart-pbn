/**
 * Builds automation/n8n-darlart-print-agent.json, the "Print Agent" n8n workflow:
 *
 *   Artwork Agent finished / Run now / every day
 *   -> queue lock (one worker at a time, a Drive lock file with a heartbeat)
 *   -> folders "Artwork Agent/1xxx" still missing print files
 *   -> one pbn API job at a time: 12/24/36/48 colors, HARD, 60x75 (portrait or landscape from the artwork itself)
 *   -> 1xxx/<stamp>_featured.png (pbn API /v1/featured: the artwork on a canvas photo, the product's first image)
 *   -> 1xxx/Print/<stamp>_<size>_<N>_blank.svg + _catalog.pdf + _user.pdf, and one 1xxx/<stamp>_mockup.png
 *   -> release the lock; if work was done, start again to pick up folders that arrived meanwhile
 *
 * Rebuild with `node scripts/build-print-agent-workflow.js`, then re-import the workflow.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
// "Darl'Art Error Handler" (scripts/build-error-handler-workflow.js): releases a failed run's lock and alerts on Telegram
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1";

// ===== Settings written into the workflow (all editable later in the "Settings" node) =====
const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    pbnApiUrl: "http://127.0.0.1:3000",
    colorsList: "12,24,36,48",
    canvasSizes: "60x75", // comma-separated; each size is orientation-neutral (60x75 = 75x60)
    difficulty: "hard",
    orientation: "auto", // portrait or landscape from the artwork's own shape
    palette: "darlart-v3",
    cropMode: "attention",
    paperSize: "a4", // page size of the PDFs (Agency / User)
    mockupColors: 48, // the single mockup comes from the first canvas size at this color count
    maxPerRun: 5, // folders per run; the next run starts by itself when work remains
    lockStaleMinutes: 45, // a lock not refreshed for this long belongs to a crashed run
    telegramChatId: "-5252292447", // the Telegram group the "Telegram account" bot reports to (empty = no messages)
};
// the "Darl'Art Shopify Uploader" workflow, started when a run saved new files
const SHOPIFY_UPLOADER_WORKFLOW_ID = "XAwk67SiWmvVSu1d";
// ============================================================================================
const LOCK_PREFIX = "_print-agent.lock";

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
const googleAuth = { authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api" };
const driveFiles = "https://www.googleapis.com/drive/v3/files";
// Drive listing; `q` is an expression, "none" items list nothing
const driveList = (name, position, q, fields = "files(id,name,mimeType)") => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    url: driveFiles,
    ...googleAuth,
    sendQuery: true,
    queryParameters: {
        parameters: [
            { name: "q", value: q },
            { name: "fields", value: fields },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
});
const ifNode = (name, position, left) => node(name, "n8n-nodes-base.if", 2, position, {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
const deleteFile = (name, position, idExpression) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    method: "DELETE",
    url: `=${driveFiles}/{{ ${idExpression} }}?supportsAllDrives=true`,
    ...googleAuth,
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
const NONE_Q = "name = '__none__' and trashed = false";

// ---- 1. triggers, settings -----------------------------------------------------------------------
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 0], {});
node("Every day", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 200], { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 4 }] } });
node("When called by another workflow", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 400], { inputSource: "passthrough" });
node("Settings", "n8n-nodes-base.set", 3.4, [220, 200], {
    assignments: {
        assignments: Object.entries(SETTINGS).map(([name, value], i) => ({
            id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string",
        })),
    },
    options: {},
});
for (const trigger of ["Run now", "Every day", "When called by another workflow"]) { connect(trigger, "Settings"); }

// ---- 2. queue lock ------------------------------------------------------------------------------------
const lockQuery = `='{{ $('Settings').first().json.agentFolderId }}' in parents and name contains '${LOCK_PREFIX}' and trashed = false`;
driveList("List locks", [440, 200], lockQuery, "files(id,name,createdTime,modifiedTime)");
connect("Settings", "List locks");

code("Lock state", [660, 200], `// Another worker holds a fresh lock (refreshed less than lockStaleMinutes ago): it will also pick up new folders
const settings = $('Settings').first().json;
const limit = Date.now() - Number(settings.lockStaleMinutes) * 60000;
const locks = $input.first().json.files || [];
const fresh = locks.filter((l) => new Date(l.modifiedTime || l.createdTime).getTime() > limit);
const stale = locks.filter((l) => !fresh.includes(l)).map((l) => l.id);
return [{ json: { free: fresh.length === 0, fresh: fresh.length, stale } }];`);
connect("List locks", "Lock state");

ifNode("Lock free?", [880, 200], "={{ $json.free }}");
connect("Lock state", "Lock free?");
node("Busy: another run is working", "n8n-nodes-base.noOp", 1, [1760, 360], {});

node("Create lock", "n8n-nodes-base.httpRequest", 4.2, [1100, 120], {
    method: "POST",
    url: `${driveFiles}?supportsAllDrives=true&fields=id,name,createdTime`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({ name: '${LOCK_PREFIX}-' + $execution.id, mimeType: 'text/plain', parents: [$('Settings').first().json.agentFolderId] }) }}`,
    options: { timeout: 30000 },
});
connect("Lock free?", "Create lock", 0);

driveList("List locks again", [1320, 120], lockQuery, "files(id,name,createdTime,modifiedTime)");
connect("Create lock", "List locks again");

code("Won the lock?", [1540, 120], `// Two runs can create a lock at the same moment: the oldest fresh lock wins, the other run steps back
const settings = $('Settings').first().json;
const mine = $('Create lock').first().json;
const limit = Date.now() - Number(settings.lockStaleMinutes) * 60000;
const fresh = ($input.first().json.files || [])
    .filter((l) => l.id === mine.id || new Date(l.modifiedTime || l.createdTime).getTime() > limit)
    .sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1));
return [{ json: { won: fresh.length > 0 && fresh[0].id === mine.id, lockId: mine.id } }];`);
connect("List locks again", "Won the lock?");

ifNode("Lock won?", [1760, 120], "={{ $json.won }}");
connect("Won the lock?", "Lock won?");
deleteFile("Step back (drop my lock)", [1980, 280], "$json.lockId");
connect("Lock won?", "Step back (drop my lock)", 1);

// busy, or lost a tie: try again a little later (a run about to finish with nothing done does not start itself again)
code("Busy: try again?", [1320, 440], `const attempt = $runIndex + 1;
return [{ json: { retry: attempt <= 3, attempt } }];`);
connect("Lock free?", "Busy: try again?", 1);
connect("Step back (drop my lock)", "Busy: try again?");
ifNode("Retry?", [1540, 440], "={{ $json.retry }}");
connect("Busy: try again?", "Retry?");
node("Wait before retry", "n8n-nodes-base.wait", 1.1, [1760, 520], { resume: "timeInterval", amount: 30, unit: "seconds" });
connect("Retry?", "Wait before retry", 0);
connect("Wait before retry", "List locks");
connect("Retry?", "Busy: another run is working", 1);

// ---- 3. what is left to do ------------------------------------------------------------------------------
driveList("List Artwork Agent folders", [1980, 40], "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
connect("Lock won?", "List Artwork Agent folders", 0);

code("Folders", [2200, 40], `// One item per numbered folder (1001, 1002...), oldest first
const folders = ($input.first().json.files || []).filter((f) => /^\\d+$/.test(String(f.name).trim()));
folders.sort((a, b) => Number(a.name) - Number(b.name));
if (!folders.length) return [{ json: { none: true } }];
return folders.map((f) => ({ json: { id: f.id, name: String(f.name).trim() } }));`);
connect("List Artwork Agent folders", "Folders");

driveList("List folder files", [2420, 40], `={{ $json.none ? "${NONE_Q}" : "'" + $json.id + "' in parents and trashed = false" }}`);
connect("Folders", "List folder files");

code("Folder states", [2640, 40], `// Folders with an artwork: its date+time stamp, the Print subfolder (if any) and the files already there
const folders = $('Folders').all();
const states = [];
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    if (folder.none) return;
    const files = item.json.files || [];
    const art = files.find((f) => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_art\\.png$/.test(f.name));
    if (!art) return;
    const print = files.find((f) => f.name === "Print" && f.mimeType === "application/vnd.google-apps.folder");
    states.push({ json: { folderId: folder.id, folder: folder.name, stamp: art.name.slice(0, 19), artworkId: art.id, printFolderId: print ? print.id : "", rootFiles: files.map((f) => f.name) } });
});
return states.length ? states : [{ json: { none: true } }];`);
connect("List folder files", "Folder states");

driveList("List Print files", [2860, 40], `={{ $json.printFolderId ? "'" + $json.printFolderId + "' in parents and trashed = false" : "${NONE_Q}" }}`);
connect("Folder states", "List Print files");

// ---- the featured image (the artwork on a canvas photo), made once per folder, before the print jobs --------------
code("Featured to make", [2860, -300], `// Folders with an artwork and no <date+time>_featured.png yet (at most maxPerRun per run)
const settings = $('Settings').first().json;
const todo = $('Folder states').all().map((item) => item.json)
    .filter((state) => !state.none && !state.rootFiles.includes(state.stamp + "_featured.png"))
    .slice(0, Number(settings.maxPerRun) || 5)
    .map((state) => ({ json: { folderId: state.folderId, folder: state.folder, artworkId: state.artworkId, name: state.stamp + "_featured.png" } }));
return todo.length ? todo : [{ json: { none: true } }];`);
connect("List Print files", "Featured to make");

ifNode("Featured to make?", [3080, -300], "={{ !$json.none }}");
connect("Featured to make", "Featured to make?");

node("Artwork for featured", "n8n-nodes-base.httpRequest", 4.2, [3300, -420], {
    url: `=${driveFiles}/{{ $json.artworkId }}?alt=media&supportsAllDrives=true`,
    ...googleAuth,
    options: { response: { response: { responseFormat: "file", outputPropertyName: "image" } }, timeout: 120000 },
});
connect("Featured to make?", "Artwork for featured", 0);

node("Make featured image", "n8n-nodes-base.httpRequest", 4.2, [3520, -420], {
    method: "POST",
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/featured",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: { parameters: [{ parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" }] },
    options: { timeout: 120000 },
}, { onError: "continueRegularOutput" });
connect("Artwork for featured", "Make featured image");

code("Featured files", [3740, -420], `// The API's PNGs (base64) as files; a folder whose image failed is retried by the next run
const todo = $('Featured to make').all();
const out = [];
$input.all().forEach((item, i) => {
    const folder = todo[i].json;
    if (!item.json.image) return;
    out.push({ json: folder, binary: { data: { data: item.json.image, mimeType: "image/png", fileName: folder.name, fileExtension: "png" } } });
});
return out.length ? out : [{ json: { none: true } }];`);
connect("Make featured image", "Featured files");

ifNode("Any featured image?", [3960, -420], "={{ !$json.none }}");
connect("Featured files", "Any featured image?");

node("Save featured image", "n8n-nodes-base.googleDrive", 3, [4180, -500], {
    name: "={{ $json.name }}",
    driveId: { __rl: true, mode: "list", value: "My Drive" },
    folderId: { __rl: true, mode: "id", value: "={{ $json.folderId }}" },
    inputDataFieldName: "data",
    options: {},
}, { onError: "continueRegularOutput" });
connect("Any featured image?", "Save featured image", 0);

code("Plan jobs", [3080, 40], `// One job per canvas size x color count still missing; the mockup job goes last in its folder (it marks the folder done)
const settings = $('Settings').first().json;
const states = $('Folder states').all();
const colors = String(settings.colorsList).split(",").map((c) => Number(c.trim())).filter((c) => c > 1);
const sizes = String(settings.canvasSizes).split(",").map((s) => s.trim().toLowerCase().replace(/\\s+/g, "")).filter(Boolean);
const mockupColors = Number(settings.mockupColors);
const flip = (size) => size.split("x").reverse().join("x");
const jobs = [];
let folderCount = 0;
$('List Print files').all().forEach((item, i) => {
    const state = states[i].json;
    if (state.none || folderCount >= Number(settings.maxPerRun)) return;
    const printFiles = new Set((item.json.files || []).map((f) => f.name));
    const has = (size, n, suffix) => printFiles.has(state.stamp + "_" + size + "_" + n + suffix) || printFiles.has(state.stamp + "_" + flip(size) + "_" + n + suffix);
    const needMockupFile = !state.rootFiles.includes(state.stamp + "_mockup.png");
    const folderJobs = [];
    sizes.forEach((size, s) => {
        for (const n of colors) {
            const needSvg = !has(size, n, "_blank.svg");
            const needPdf = !has(size, n, "_catalog.pdf");
            const needUser = !has(size, n, "_user.pdf");
            const needMockup = needMockupFile && s === 0 && n === mockupColors;
            if (needSvg || needPdf || needUser || needMockup) folderJobs.push({ size, colors: n, needSvg, needPdf, needUser, needMockup });
        }
    });
    if (needMockupFile && !folderJobs.some((j) => j.needMockup)) {
        folderJobs.push({ size: sizes[0], colors: mockupColors, needSvg: false, needPdf: false, needUser: false, needMockup: true });
    }
    if (!folderJobs.length) return;
    folderCount++;
    folderJobs.sort((a, b) => Number(a.needMockup) - Number(b.needMockup));
    for (const job of folderJobs) {
        jobs.push({ json: { folderId: state.folderId, folder: state.folder, stamp: state.stamp, artworkId: state.artworkId, printFolderId: state.printFolderId, ...job } });
    }
});
return jobs.length ? jobs : [{ json: { none: true } }];`, { executeOnce: true });
connect("Featured to make?", "Plan jobs", 1);
connect("Any featured image?", "Plan jobs", 1);
connect("Save featured image", "Plan jobs");

ifNode("Anything to do?", [3300, 40], "={{ !$json.none }}");
connect("Plan jobs", "Anything to do?");

code("Folders to prepare", [3520, -40], `// One item per folder with jobs, to make sure its Print subfolder exists
const seen = new Set();
const out = [];
for (const item of $input.all()) {
    if (seen.has(item.json.folderId)) continue;
    seen.add(item.json.folderId);
    out.push({ json: { folderId: item.json.folderId, printFolderId: item.json.printFolderId } });
}
return out;`);
connect("Anything to do?", "Folders to prepare", 0);

node("Ensure Print folder", "n8n-nodes-base.httpRequest", 4.2, [3740, -40], {
    // an existing Print folder gets an empty update (changes nothing, returns its id); a missing one is created
    method: "={{ $json.printFolderId ? 'PATCH' : 'POST' }}",
    url: `={{ '${driveFiles}' + ($json.printFolderId ? '/' + $json.printFolderId : '') + '?supportsAllDrives=true&fields=id,name,mimeType' }}`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.printFolderId ? {} : { name: 'Print', mimeType: 'application/vnd.google-apps.folder', parents: [$json.folderId] }) }}",
    options: { timeout: 30000 },
});
connect("Folders to prepare", "Ensure Print folder");

code("Jobs ready", [3960, -40], `// Every job now knows its Print folder
const prepared = $('Folders to prepare').all();
const printIds = {};
$input.all().forEach((item, i) => {
    if (item.json.mimeType !== "application/vnd.google-apps.folder") throw new Error("Print folder for " + prepared[i].json.folderId + " is not a folder: " + JSON.stringify(item.json));
    printIds[prepared[i].json.folderId] = item.json.id;
});
return $('Plan jobs').all().map((item) => ({ json: { ...item.json, printFolderId: printIds[item.json.folderId] } }));`);
connect("Ensure Print folder", "Jobs ready");

// ---- 4. one pbn job at a time --------------------------------------------------------------------------
node("Loop over jobs", "n8n-nodes-base.splitInBatches", 3, [4180, -40], { options: {} });
connect("Jobs ready", "Loop over jobs");

node("Heartbeat (refresh lock)", "n8n-nodes-base.httpRequest", 4.2, [4400, 60], {
    method: "PATCH",
    url: `=${driveFiles}/{{ $('Won the lock?').first().json.lockId }}?supportsAllDrives=true&fields=id,modifiedTime`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ modifiedTime: $now.toUTC().toISO() }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Loop over jobs", "Heartbeat (refresh lock)", 1);

node("Download artwork", "n8n-nodes-base.httpRequest", 4.2, [4620, 60], {
    url: `=${driveFiles}/{{ $('Loop over jobs').first().json.artworkId }}?alt=media&supportsAllDrives=true`,
    ...googleAuth,
    options: { response: { response: { responseFormat: "file", outputPropertyName: "image" } }, timeout: 120000 },
});
connect("Heartbeat (refresh lock)", "Download artwork");

const job = (field) => `={{ $('Loop over jobs').first().json.${field} }}`;
const setting = (field) => `={{ $('Settings').first().json.${field} }}`;
node("Create pbn job", "n8n-nodes-base.httpRequest", 4.2, [4840, 60], {
    method: "POST",
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/jobs",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: {
        parameters: [
            { name: "canvasSize", value: job("size") },
            { name: "orientation", value: setting("orientation") },
            { name: "colors", value: job("colors") },
            { name: "difficulty", value: setting("difficulty") },
            { name: "palette", value: setting("palette") },
            { name: "cropMode", value: setting("cropMode") },
            { name: "paperSize", value: setting("paperSize") },
            { name: "orderId", value: job("folder") },
            { name: "callbackUrl", value: "={{ $execution.resumeUrl }}" },
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" },
        ],
    },
    options: { timeout: 120000 },
}, { onError: "continueRegularOutput" });
connect("Download artwork", "Create pbn job");

ifNode("Job accepted?", [5060, 60], "={{ !!$json.jobId }}");
connect("Create pbn job", "Job accepted?");

node("Wait for pbn job", "n8n-nodes-base.wait", 1.1, [5280, 0], {
    resume: "webhook",
    httpMethod: "POST",
    incomingAuthentication: "headerAuth",
    limitWaitTime: true,
    limitType: "afterTimeInterval",
    resumeAmount: 30,
    resumeUnit: "minutes",
    options: {},
}, { webhookId: "9a91f456-a1de-4a78-9791-1af5a8aad073" });
connect("Job accepted?", "Wait for pbn job", 0);

code("Files to save", [5500, 0], `// The finished job's files, named with the size the API chose (40x50 portrait or 50x40 landscape)
const task = $('Loop over jobs').first().json;
const result = ($json.body && $json.body.status === "completed" && $json.body.result) || null;
if (!result) return [{ json: { skip: true, folder: task.folder, job: task.size + " " + task.colors + " colors", reason: ($json.body && ($json.body.error || $json.body.status)) || "no answer from the pbn API within 30 minutes" } }];
const url = (name) => (result.files.find((f) => f.name === name) || {}).url;
const label = (result.canvas && result.canvas.label) || task.size;
const files = [];
if (task.needSvg) {
    // the Blank SVG (grey outlines, black numbers, no colors): the file printed on the canvas
    files.push({ url: url("blank.svg"), name: task.stamp + "_" + label + "_" + task.colors + "_blank.svg", parent: task.printFolderId, mimeType: "image/svg+xml" });
}
if (task.needPdf) {
    files.push({ url: url("painting.pdf"), name: task.stamp + "_" + label + "_" + task.colors + "_catalog.pdf", parent: task.printFolderId, mimeType: "application/pdf" });
}
if (task.needUser) {
    files.push({ url: url("template.pdf"), name: task.stamp + "_" + label + "_" + task.colors + "_user.pdf", parent: task.printFolderId, mimeType: "application/pdf" });
}
if (task.needMockup) {
    files.push({ url: url("mockup.png"), name: task.stamp + "_mockup.png", parent: task.folderId, mimeType: "image/png" });
}
const ready = files.filter((f) => f.url);
if (ready.length !== files.length) return [{ json: { skip: true, folder: task.folder, job: task.size + " " + task.colors + " colors", reason: "the pbn API result is missing a file" } }];
return ready.map((f) => ({ json: f }));`);
connect("Wait for pbn job", "Files to save");

ifNode("Job done?", [5720, 0], "={{ !$json.skip }}");
connect("Files to save", "Job done?");

node("Download file", "n8n-nodes-base.httpRequest", 4.2, [5940, -60], {
    url: "={{ $json.url }}",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    options: { response: { response: { responseFormat: "file", outputPropertyName: "data" } }, timeout: 120000 },
}, { onError: "continueRegularOutput" });
connect("Job done?", "Download file", 0);

node("Save to Drive", "n8n-nodes-base.googleDrive", 3, [6160, -60], {
    name: "={{ $('Files to save').item.json.name }}",
    driveId: { __rl: true, mode: "list", value: "My Drive" },
    folderId: { __rl: true, mode: "id", value: "={{ $('Files to save').item.json.parent }}" },
    inputDataFieldName: "data",
    options: {},
}, { onError: "continueRegularOutput" });
connect("Download file", "Save to Drive");
connect("Save to Drive", "Loop over jobs");
// a failed or timed-out job is skipped: the next run retries it
connect("Job done?", "Loop over jobs", 1);
connect("Job accepted?", "Loop over jobs", 1);

// ---- 5. release the lock, start again if work was done -------------------------------------------------
code("Run summary", [4400, -220], `// Files saved in this run, and the jobs that failed (retried by the next run)
const items = $input.all().map((item) => item.json);
const saved = items.filter((j) => j.id && j.name).map((j) => j.name);
const failed = items.filter((j) => j.skip).map((j) => ({ folder: j.folder || "", job: j.job || "", reason: j.reason || "" }));
// a job the pbn API did not accept, or a file Drive refused, comes back as an error item
const errors = items.filter((j) => !j.skip && !(j.id && j.name)).map((j) => (j.error && (j.error.message || j.error)) || "pbn job not accepted");
return [{ json: { saved: saved.length, files: saved, failed, errors } }];`);
connect("Loop over jobs", "Run summary", 0);

code("Locks to delete", [4620, -220], `// My lock, plus locks left behind by crashed runs
const featured = $('Save featured image').isExecuted ? $('Save featured image').all().filter((item) => item.json.id).length : 0;
const saved = ($('Run summary').isExecuted ? $('Run summary').first().json.saved : 0) + featured;
const ids = [$('Won the lock?').first().json.lockId, ...$('Lock state').first().json.stale];
return ids.map((id) => ({ json: { id, saved } }));`, { executeOnce: true });
// ---- one Telegram message for the whole chain: each run that made something adds it to a tally (the description
// of the Drive file "_print-report.json" in Artwork Agent), and the run that finds nothing left sends it once ----
driveList("Find print report", [4620, -420], "='{{ $('Settings').first().json.agentFolderId }}' in parents and name = '_print-report.json' and trashed = false", "files(id,name,description)");
connect("Run summary", "Find print report");
connect("Anything to do?", "Find print report", 1);

code("Print report", [4840, -420], `// This run's successful generations, added to the tally; sent once when a run finds nothing left to do
const settings = $('Settings').first().json;
const file = ($input.first().json.files || [])[0] || null;
let tally = { folders: {}, since: $now.toISO() };
try { if (file && file.description) tally = JSON.parse(file.description); } catch (e) {}
const stampToFolder = {};
if ($('Plan jobs').isExecuted) for (const item of $('Plan jobs').all()) if (!item.json.none) stampToFolder[item.json.stamp] = item.json.folder;
const add = (folder, kind) => { const f = (tally.folders[folder] = tally.folders[folder] || {}); f[kind] = (f[kind] || 0) + 1; };
let made = 0;
const files = $('Run summary').isExecuted ? $('Run summary').first().json.files || [] : [];
for (const name of files) {
    const kind = name.endsWith("_blank.svg") ? "blank SVG" : name.endsWith("_catalog.pdf") ? "catalog PDF" : name.endsWith("_user.pdf") ? "user PDF" : name.endsWith("_mockup.png") ? "mockup" : "file";
    add(stampToFolder[name.slice(0, 19)] || name.slice(0, 19), kind);
    made++;
}
if ($('Save featured image').isExecuted) {
    const todo = $('Featured to make').all().map((item) => item.json);
    for (const item of $('Save featured image').all()) {
        if (!item.json.id) continue;
        add((todo.find((t) => t.name === item.json.name) || {}).folder || item.json.name, "featured image");
        made++;
    }
}
const telegram = String(settings.telegramChatId || "").trim() !== "";
if (made) return [{ json: { action: "save", reportId: file ? file.id : "", description: JSON.stringify(tally) } }];
const folders = Object.keys(tally.folders);
if (!file || !folders.length) return [{ json: { action: "none" } }];
if (!telegram) return [{ json: { action: "drop", reportId: file.id } }];
const lines = ["Print Agent: finished, " + folders.length + " folder" + (folders.length === 1 ? "" : "s") + " done"];
let ready = 0;
for (const folder of folders.sort()) {
    const kinds = tally.folders[folder];
    const parts = [];
    for (const kind of ["blank SVG", "catalog PDF", "user PDF", "file"]) if (kinds[kind]) parts.push(kinds[kind] + " " + kind);
    if (kinds["mockup"]) parts.push("mockup");
    if (kinds["featured image"]) parts.push("featured image");
    if (kinds["mockup"]) ready++;
    lines.push("- " + folder + ": " + parts.join(", "));
}
if (ready) lines.push("", ready + " folder" + (ready === 1 ? "" : "s") + " ready for the Shopify draft.");
return [{ json: { action: "send", reportId: file.id, text: lines.join("\\n").slice(0, 4000) } }];`, { executeOnce: true });
connect("Find print report", "Print report");

ifNode("Save the tally?", [5060, -420], "={{ $json.action === 'save' }}");
connect("Print report", "Save the tally?");
// an existing tally gets its description updated, a missing one is created (a metadata-only file)
node("Store print report", "n8n-nodes-base.httpRequest", 4.2, [5280, -500], {
    method: "={{ $json.reportId ? 'PATCH' : 'POST' }}",
    url: `={{ '${driveFiles}' + ($json.reportId ? '/' + $json.reportId : '') + '?supportsAllDrives=true&fields=id' }}`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.reportId ? { description: $json.description } : { name: '_print-report.json', mimeType: 'application/json', parents: [$('Settings').first().json.agentFolderId], description: $json.description }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Save the tally?", "Store print report", 0);
connect("Store print report", "Locks to delete");

ifNode("Send the report?", [5280, -340], "={{ $json.action === 'send' }}");
connect("Save the tally?", "Send the report?", 1);
node("Telegram: print report", "n8n-nodes-base.telegram", 1.2, [5500, -400], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    text: "={{ $json.text }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true },
}, { onError: "continueRegularOutput" });
connect("Send the report?", "Telegram: print report", 0);

ifNode("Drop the tally?", [5500, -260], "={{ $json.action === 'drop' }}");
connect("Send the report?", "Drop the tally?", 1);
// sent (or no chat set): the tally starts again from zero
deleteFile("Drop print report", [5720, -340], "$('Print report').first().json.reportId");
connect("Telegram: print report", "Drop print report");
connect("Drop the tally?", "Drop print report", 0);
connect("Drop print report", "Locks to delete");
connect("Drop the tally?", "Locks to delete", 1);

deleteFile("Release lock", [4840, -220], "$json.id");
connect("Locks to delete", "Release lock");

code("More to do?", [5060, -220], `// Folders may have arrived while this run worked: start a new run (which finds nothing and stops if all is done)
const saved = $('Locks to delete').first().json.saved;
return [{ json: { again: saved > 0, saved } }];`, { executeOnce: true });
connect("Release lock", "More to do?");



ifNode("Start again?", [5280, -220], "={{ $json.again }}");
connect("More to do?", "Start again?");

node("Start next run", "n8n-nodes-base.executeWorkflow", 1.2, [5500, -300], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: "={{ $workflow.id }}" },
    mode: "once",
    options: { waitForSubWorkflow: false },
}, { executeOnce: true, onError: "continueRegularOutput" });
connect("Start again?", "Start next run", 0);

// New mockups were saved: the Shopify Uploader turns the finished folders into draft products, without waiting
node("Run Shopify Uploader", "n8n-nodes-base.executeWorkflow", 1.2, [5500, -120], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: SHOPIFY_UPLOADER_WORKFLOW_ID },
    mode: "once",
    options: { waitForSubWorkflow: false },
}, { executeOnce: true, onError: "continueRegularOutput" });
connect("Start again?", "Run Shopify Uploader", 0);

const workflow = { name: "Darl'Art Print Agent", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: ERROR_WORKFLOW_ID }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-print-agent.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
