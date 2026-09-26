/**
 * Builds automation/n8n-darlart-print-agent.json, the "Print Agent" n8n workflow:
 *
 *   Artwork Agent finished / Run now / every day
 *   -> queue lock (one worker at a time, a Drive lock file refreshed every 30 s while jobs run)
 *   -> folders "Artwork Agent/1xxx" still missing print files
 *   -> the pbn API jobs, parallelJobs at a time (1: the server has little memory), checked every pollSeconds:
 *      12/24/36/48 colors, HARD, 60x75 (portrait or landscape from the artwork itself). A finished job's files are
 *      saved at once and the next job is sent. No fixed time limit for the run: it takes as long as its jobs need,
 *      only a job with no result 2 x jobTimeoutMinutes + 5 after it was sent is given up (retried by the next run)
 *   -> 1xxx/<stamp>_featured.png (pbn API /v1/featured: the artwork on a canvas photo, the product's first image)
 *   -> 1xxx/Print/<stamp>_<size>_<N>_blank.svg + _catalog.pdf + _user.pdf, and one 1xxx/<stamp>_mockup.png
 *   -> a folder with failed jobs gets a marker "<stamp>_print-failed-<execution>"; after maxFailedRuns of them it is
 *      given up (one Telegram alert), instead of being retried by every run: delete its markers to try it again
 *   -> release the lock; if work was done, start again to pick up folders that arrived meanwhile
 *
 * Rebuild with `node scripts/build-print-agent-workflow.js`, then re-import the workflow.
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
    // runs with failed jobs before a folder is given up (its markers "<stamp>_print-failed-*" are in the folder)
    maxFailedRuns: 3,
    // the lock is refreshed every 30 s while jobs run, so this only covers the longest step between two refreshes
    // (the featured images, a few minutes), not the whole run
    lockStaleMinutes: 20,
    // jobs in the pbn API at the same time. Keep 1 on a small server (1 GB RAM): a HARD 60x75 job takes a lot of
    // memory, and the API itself runs CONCURRENCY jobs at a time (set CONCURRENCY=1 in its env file too)
    parallelJobs: 1,
    jobTimeoutMinutes: 10, // the pbn API stops a job after this long (JOB_TIMEOUT_MS on the VM)
    pollSeconds: 30, // how often the run checks its jobs
    telegramChatId: "-1003952514058", // the Telegram group the "Telegram account" bot reports to (empty = no messages)
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
            // newest first: a listing holds 1000 files at most, and the newest are the ones still to do
            { name: "orderBy", value: "createdTime desc" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
}, RETRY);
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
// n8n sends the requests of all a node's items at once unless told otherwise: the pbn API gets them one by one
const ONE_BY_ONE = { batching: { batch: { batchSize: 1, batchInterval: 0 } } };

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
const lock = queueLock({ node, connect }, {
    prefix: LOCK_PREFIX,
    folderExpression: "$('Settings').first().json.agentFolderId",
    staleMinutes: "Number($('Settings').first().json.lockStaleMinutes)",
    x: 440,
    y: 200,
});
connect("Settings", "List locks");

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
}, RETRY);
connect("Featured to make?", "Artwork for featured", 0);

node("Make featured image", "n8n-nodes-base.httpRequest", 4.2, [3520, -420], {
    method: "POST",
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/featured",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: { parameters: [{ parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" }] },
    // the API serves heavy requests one at a time: a wait behind another one is included
    options: { timeout: 600000, ...ONE_BY_ONE },
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
    // given up after maxFailedRuns runs with failed jobs (delete its "_print-failed-" markers to try again)
    if (state.rootFiles.filter((n) => n.startsWith(state.stamp + "_print-failed-")).length >= Number(settings.maxFailedRuns || 3)) return;
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

// ---- 4. the jobs, parallelJobs at a time: a loop of rounds. Each round sends jobs into the free places, waits
// pollSeconds, checks the jobs sent, saves the files of those finished, and goes again until none is left. The state of
// all jobs travels through the loop as one item. -----------------------------------------------------------------
code("Job round", [4180, -40], `// The jobs' state (built from the planned jobs the first time), and the jobs to send now: as many as there are free
// places among parallelJobs
const settings = $('Settings').first().json;
const first = $input.first().json;
const state = Array.isArray(first.jobs) ? first : {
    jobs: $input.all().map((item) => ({ ...item.json, jobId: "", status: "pending", error: "", sentAt: 0, result: null, saved: false })),
    saved: [],
    errors: [],
};
const places = Math.max(1, Number(settings.parallelJobs) || 1) - state.jobs.filter((j) => j.status === "sent").length;
const send = [];
state.jobs.forEach((j, i) => { if (j.status === "pending" && send.length < places) send.push(i); });
return [{ json: { ...state, send } }];`);
connect("Jobs ready", "Job round");

code("Jobs to send", [4400, -40], `const state = $input.first().json;
return state.send.length ? state.send.map((i) => ({ json: { ...state.jobs[i], index: i } })) : [{ json: { none: true } }];`);
connect("Job round", "Jobs to send");
ifNode("Send now?", [4620, -40], "={{ !$json.none }}");
connect("Jobs to send", "Send now?");

node("Download artwork", "n8n-nodes-base.httpRequest", 4.2, [4840, -120], {
    url: `=${driveFiles}/{{ $json.artworkId }}?alt=media&supportsAllDrives=true`,
    ...googleAuth,
    options: { response: { response: { responseFormat: "file", outputPropertyName: "image" } }, timeout: 120000, ...ONE_BY_ONE },
}, RETRY);
connect("Send now?", "Download artwork", 0);

const setting = (field) => `={{ $('Settings').first().json.${field} }}`;
const sending = (field) => `={{ $('Jobs to send').item.json.${field} }}`;
node("Create pbn job", "n8n-nodes-base.httpRequest", 4.2, [5060, -120], {
    method: "POST",
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/jobs",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    contentType: "multipart-form-data",
    bodyParameters: {
        parameters: [
            { name: "canvasSize", value: sending("size") },
            { name: "orientation", value: setting("orientation") },
            { name: "colors", value: sending("colors") },
            { name: "difficulty", value: setting("difficulty") },
            { name: "palette", value: setting("palette") },
            { name: "cropMode", value: setting("cropMode") },
            { name: "paperSize", value: setting("paperSize") },
            { name: "orderId", value: sending("folder") },
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" },
        ],
    },
    options: { timeout: 120000, ...ONE_BY_ONE },
}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: "continueRegularOutput" });
connect("Download artwork", "Create pbn job");

code("Jobs sent", [5280, -40], `// The sent jobs get their pbn job id; a job the API did not accept has failed (the next run tries it again)
const state = JSON.parse(JSON.stringify($('Job round').first().json));
const answers = $input.first().json.none ? [] : $input.all().map((item) => item.json);
state.send.forEach((index, k) => {
    const job = state.jobs[index];
    const a = answers[k] || {};
    if (a.jobId) Object.assign(job, { jobId: a.jobId, status: "sent", sentAt: Date.now() });
    else Object.assign(job, { status: "failed", error: String((a.error && (a.error.message || a.error)) || a.message || "pbn job not accepted").slice(0, 300) });
});
state.send = [];
return [{ json: state }];`);
connect("Create pbn job", "Jobs sent");
connect("Send now?", "Jobs sent", 1);

ifNode("Jobs running?", [5500, -40], "={{ $json.jobs.some((j) => j.status === 'sent') }}");
connect("Jobs sent", "Jobs running?");
node("Wait for jobs", "n8n-nodes-base.wait", 1.1, [5720, -120], { resume: "timeInterval", amount: "={{ $('Settings').first().json.pollSeconds }}", unit: "seconds" });
connect("Jobs running?", "Wait for jobs", 0);
// the lock is refreshed at every check: the run keeps it for as long as its jobs need
lock.heartbeat("Heartbeat (refresh lock)", [5940, -300]);
connect("Wait for jobs", "Heartbeat (refresh lock)");
code("Jobs to check", [5940, -120], `return $('Jobs sent').first().json.jobs.filter((j) => j.status === "sent").map((j) => ({ json: { jobId: j.jobId } }));`);
connect("Wait for jobs", "Jobs to check");
node("Job status", "n8n-nodes-base.httpRequest", 4.2, [6160, -120], {
    url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/jobs/{{ $json.jobId }}",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    options: { timeout: 30000, ...ONE_BY_ONE },
}, { onError: "continueRegularOutput" });
connect("Jobs to check", "Job status");

code("Jobs checked", [6380, -40], `// Each sent job's state. A job the API no longer knows (restarted) has failed; so has one with no result
// 2 x jobTimeoutMinutes + 5 after it was sent (the API gives up on a job after jobTimeoutMinutes itself).
// The files of the jobs finished now are saved this round; a folder's mockup (it marks the folder done for the
// Watchdog) once all the folder's jobs are finished, and only if none failed.
const settings = $('Settings').first().json;
const checked = !Array.isArray($input.first().json.jobs);
const state = JSON.parse(JSON.stringify($('Jobs sent').first().json));
if (checked) {
    const asked = $('Jobs to check').all().map((item) => item.json.jobId);
    const answers = $input.all().map((item) => item.json);
    const limit = (2 * Number(settings.jobTimeoutMinutes || 10) + 5) * 60000;
    asked.forEach((jobId, k) => {
        const job = state.jobs.find((j) => j.jobId === jobId);
        const a = answers[k] || {};
        if (!job) return;
        if (a.jobId === jobId && a.status === "completed" && a.result) {
            job.status = "completed";
            job.result = { label: (a.result.canvas && a.result.canvas.label) || job.size, files: (a.result.files || []).map((x) => ({ name: x.name, url: x.url })) };
        } else if (a.jobId === jobId && a.status === "failed") Object.assign(job, { status: "failed", error: String(a.error || "failed").slice(0, 300) });
        else if (JSON.stringify(a).includes("Job not found")) Object.assign(job, { status: "failed", error: "the pbn API no longer has this job (restarted?)" });
        else if (Date.now() - job.sentAt > limit) Object.assign(job, { status: "failed", error: "no result " + Math.round(limit / 60000) + " min after it was sent" });
    });
}
const files = [];
for (const job of state.jobs) {
    if (job.status !== "completed" || job.saved) continue;
    const url = (name) => (job.result.files.find((x) => x.name === name) || {}).url;
    const want = [];
    // the Blank SVG (grey outlines, black numbers, no colors): the file printed on the canvas
    if (job.needSvg) want.push({ url: url("blank.svg"), name: job.stamp + "_" + job.result.label + "_" + job.colors + "_blank.svg", parent: job.printFolderId });
    if (job.needPdf) want.push({ url: url("painting.pdf"), name: job.stamp + "_" + job.result.label + "_" + job.colors + "_catalog.pdf", parent: job.printFolderId });
    if (job.needUser) want.push({ url: url("template.pdf"), name: job.stamp + "_" + job.result.label + "_" + job.colors + "_user.pdf", parent: job.printFolderId });
    if (job.needMockup && !url("mockup.png")) want.push({ url: "" });
    if (want.some((w) => !w.url)) {
        Object.assign(job, { status: "failed", error: "the pbn API result is missing a file" });
        continue;
    }
    files.push(...want);
    job.saved = true;
}
// mockups: a folder whose jobs are all finished, none failed
for (const job of state.jobs) {
    if (!job.needMockup || job.status !== "completed" || job.mockupSaved) continue;
    const folderJobs = state.jobs.filter((j) => j.folder === job.folder);
    if (folderJobs.some((j) => j.status === "pending" || j.status === "sent" || j.status === "failed")) continue;
    files.push({ url: job.result.files.find((x) => x.name === "mockup.png").url, name: job.stamp + "_mockup.png", parent: job.folderId });
    job.mockupSaved = true;
}
state.finished = !state.jobs.some((j) => j.status === "pending" || j.status === "sent");
state.checks = (state.checks || 0) + (checked ? 1 : 0);
return [{ json: { ...state, toSave: files } }];`);
connect("Job status", "Jobs checked");
connect("Jobs running?", "Jobs checked", 1);

code("Files to download", [6600, -40], `const files = $input.first().json.toSave;
return files.length ? files.map((f) => ({ json: f })) : [{ json: { none: true } }];`);
connect("Jobs checked", "Files to download");
ifNode("Any file?", [6820, -40], "={{ !$json.none }}");
connect("Files to download", "Any file?");

node("Download file", "n8n-nodes-base.httpRequest", 4.2, [7040, -120], {
    url: "={{ $json.url }}",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    options: { response: { response: { responseFormat: "file", outputPropertyName: "data" } }, timeout: 120000, ...ONE_BY_ONE },
}, { ...RETRY, onError: "continueRegularOutput" });
connect("Any file?", "Download file", 0);

node("Save to Drive", "n8n-nodes-base.googleDrive", 3, [7260, -120], {
    name: "={{ $('Files to download').item.json.name }}",
    driveId: { __rl: true, mode: "list", value: "My Drive" },
    folderId: { __rl: true, mode: "id", value: "={{ $('Files to download').item.json.parent }}" },
    inputDataFieldName: "data",
    options: {},
}, { onError: "continueRegularOutput" });
connect("Download file", "Save to Drive");

code("Round saved", [7480, -40], `// The files saved this round (a file Drive or the API refused comes back as an error item: the next run retries it)
const state = JSON.parse(JSON.stringify($('Jobs checked').first().json));
if (!$input.first().json.none) {
    for (const item of $input.all()) {
        const j = item.json;
        if (j.id && j.name) state.saved.push(j.name);
        else state.errors.push(String((j.error && (j.error.message || j.error)) || "file not saved").slice(0, 300));
    }
}
// the jobs' results are no longer needed once saved: the state stays small
for (const job of state.jobs) if (job.saved && (!job.needMockup || job.mockupSaved)) job.result = null;
state.toSave = [];
return [{ json: state }];`);
connect("Save to Drive", "Round saved");
connect("Any file?", "Round saved", 1);

ifNode("All jobs done?", [7700, -40], "={{ $json.finished }}");
connect("Round saved", "All jobs done?");
connect("All jobs done?", "Job round", 1);

// ---- 5. release the lock, start again if work was done -------------------------------------------------
code("Run summary", [4400, -220], `// Files saved in this run, and the jobs that failed (retried by the next run)
const state = $('Round saved').first().json;
const failed = state.jobs.filter((j) => j.status === "failed").map((j) => ({ folder: j.folder, job: j.size + " " + j.colors + " colors", reason: j.error }));
return [{ json: { saved: state.saved.length, files: state.saved, failed, errors: state.errors } }];`, { executeOnce: true });
connect("All jobs done?", "Run summary", 0);

// ---- one Telegram message for the whole chain: each run that made something adds it to a tally (the description
// of the Drive file "_print-report.json" in Artwork Agent), and the run that finds nothing left sends it once ----
driveList("Find print report", [4620, -420], "='{{ $('Settings').first().json.agentFolderId }}' in parents and name = '_print-report.json' and trashed = false", "files(id,name,description)");
connect("Run summary", "Find print report");

// a run whose jobs all failed (nothing saved) leaves the backoff marker "_failed-print": the Queue Watchdog then waits
// 30 minutes before starting the Print Agent again, instead of retrying the same failing jobs every 5 minutes
ifNode("No progress?", [4620, -640], "={{ $('Run summary').first().json.saved === 0 && (($('Run summary').first().json.failed || []).length + ($('Run summary').first().json.errors || []).length) > 0 }}");
connect("Run summary", "No progress?");

// ---- a folder whose jobs failed gets a marker; after maxFailedRuns markers it is given up, with one alert --------
code("Failed folders", [4620, -860], `// One marker per folder with failed jobs in this run, and the folders given up now
const settings = $('Settings').first().json;
const summary = $('Run summary').first().json;
const states = $('Folder states').all().map((item) => item.json).filter((s) => !s.none);
const byFolder = {};
for (const f of summary.failed || []) (byFolder[f.folder] = byFolder[f.folder] || []).push(f.job + ": " + f.reason);
const out = [];
for (const [folder, reasons] of Object.entries(byFolder)) {
    const state = states.find((s) => s.folder === folder);
    if (!state) continue;
    const before = state.rootFiles.filter((n) => n.startsWith(state.stamp + "_print-failed-")).length;
    out.push({ json: {
        folder, folderId: state.folderId, name: state.stamp + "_print-failed-" + $execution.id,
        description: reasons.join("; ").slice(0, 900),
        givenUp: before + 1 >= Number(settings.maxFailedRuns || 3), runs: before + 1, reasons,
    } });
}
return out.length ? out : [{ json: { none: true } }];`, { executeOnce: true });
connect("Run summary", "Failed folders");
ifNode("Any failed folder?", [4840, -860], "={{ !$json.none }}");
connect("Failed folders", "Any failed folder?");
node("Mark failed folder", "n8n-nodes-base.httpRequest", 4.2, [5060, -940], {
    method: "POST",
    url: `${driveFiles}?supportsAllDrives=true&fields=id`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ name: $json.name, mimeType: 'text/plain', parents: [$json.folderId], description: $json.description }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Any failed folder?", "Mark failed folder", 0);
code("Given up message", [5280, -940], `// One alert per folder given up in this run
const settings = $('Settings').first().json;
const up = $('Failed folders').all().map((item) => item.json).filter((f) => f.givenUp);
if (!up.length || !String(settings.telegramChatId || "").trim()) return [{ json: { none: true } }];
const lines = ["Print Agent: gave up on " + up.length + " folder" + (up.length === 1 ? "" : "s") + " after " + settings.maxFailedRuns + " failed runs"];
for (const f of up) lines.push("", "- " + f.folder + ": " + f.reasons.slice(0, 4).join("; "));
lines.push("", "Its print files and mockup are not made, so no Shopify draft. To try again, delete the files named ..._print-failed-... in the folder.");
return [{ json: { text: lines.join("\\n").slice(0, 4000) } }];`, { executeOnce: true });
connect("Mark failed folder", "Given up message");
ifNode("Alert?", [5500, -940], "={{ !$json.none }}");
connect("Given up message", "Alert?");
node("Telegram: given up", "n8n-nodes-base.telegram", 1.2, [5720, -1020], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    text: "={{ String($json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
}, { onError: "continueRegularOutput" });
connect("Alert?", "Telegram: given up", 0);
driveList("Find failure marker", [4840, -640], "='{{ $('Settings').first().json.agentFolderId }}' in parents and name = '_failed-print' and trashed = false", "files(id)");
connect("No progress?", "Find failure marker", 0);
node("Mark the failure", "n8n-nodes-base.httpRequest", 4.2, [5060, -640], {
    method: "={{ ($json.files || []).length ? 'PATCH' : 'POST' }}",
    url: `={{ '${driveFiles}' + (($json.files || []).length ? '/' + $json.files[0].id : '') + '?supportsAllDrives=true&fields=id' }}`,
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify(($json.files || []).length ? { modifiedTime: $now.toUTC().toISO() } : { name: '_failed-print', mimeType: 'text/plain', parents: [$('Settings').first().json.agentFolderId] }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Find failure marker", "Mark the failure");
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
    // HTML with the text escaped: Markdown (n8n's default) refuses texts with "_"
    text: "={{ String($json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
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

// featured images count as work done too: the run starts again and the Shopify Uploader goes
lock.release([4840, -220], "(($('Run summary').isExecuted ? $('Run summary').first().json.saved : 0) + ($('Save featured image').isExecuted ? $('Save featured image').all().filter((item) => item.json.id).length : 0)) > 0");

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
