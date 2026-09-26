/**
 * Builds automation/n8n-darlart-queue-watchdog.json, the "Darl'Art Queue Watchdog" n8n workflow: every 5 minutes it
 * looks for work that is waiting while nothing is working on it, and starts the workflow that does that work.
 *
 *   Artwork Worker   : references in "Artwork Ref/Queue", or a batch manifest left there over 10 minutes with none
 *                      (the worker finishes it and moves it to Done)
 *   Titling Agent    : a recent 1xxx folder with an artwork and no <date+time>_product.json
 *   Print Agent      : a recent 1xxx folder with an artwork and no featured image or no mockup (the mockup is made last)
 *   Shopify Uploader : a recent 1xxx folder with product JSON, featured image and mockup, and no <date+time>_shopify.json
 *
 * A stage is started only when none of its runs holds a fresh lock (a running workflow already starts itself again
 * until nothing is left; each lock says in its description how long it stays fresh without a refresh, the values
 * below are only for older locks without one), and not within backoffMinutes of a failure: the Darl'Art Error Handler leaves a marker
 * "_failed-<stage>" in Artwork Agent, so a lasting problem is not retried every 5 minutes. Recent folders are those
 * created in the last recentDays days (the daily runs of each workflow still cover older ones). Successful runs of
 * the watchdog are not kept in the n8n execution list; failed ones are.
 *
 * Every run also removes the locks left behind by runs that are over: a cancelled or crashed run does not reach its
 * "Release lock" step, and n8n does not call the Error Handler for it, so its lock would block its workflow until the
 * lock goes stale. Each lock is named "<prefix>-<execution id>": the watchdog asks the n8n API (credential "n8n API")
 * about that execution and deletes the lock when the execution is finished (success, error, canceled, crashed) or no
 * longer exists. A lock whose execution cannot be checked (no credential, API down) is kept: nothing is deleted blindly.
 */
const fs = require("fs");
const path = require("path");
const { RETRY } = require("./lib/n8n-queue-lock");

const root = path.join(__dirname, "..");
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1"; // "Darl'Art Error Handler"

const SETTINGS = {
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    queueFolderId: "13fjEqSw2tqYfKwn23RPDdItLigrRvjTb", // Drive "Artwork Ref/Queue"
    recentDays: 7,
    backoffMinutes: 30,
};
// each stage: its workflow, its lock prefix, and how old a lock may be before it belongs to a crashed run
const STAGES = {
    worker: { workflowId: "dO8EdyDM4ua2hRrA", lock: "_artwork-worker.lock", staleMinutes: 20 },
    titling: { workflowId: "tOSHbCt7hJ6ORh8a", lock: "_titling-agent.lock", staleMinutes: 15 },
    print: { workflowId: "ytxV3m341mDLCdt4", lock: "_print-agent.lock", staleMinutes: 20 },
    uploader: { workflowId: "XAwk67SiWmvVSu1d", lock: "_shopify-uploader.lock", staleMinutes: 20 },
};
const NONE_Q = "name = '__none__' and trashed = false";

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "dd" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
}
function connect(from, to, output = 0, type = "main") {
    connections[from] = connections[from] || {};
    const outputs = (connections[from][type] = connections[from][type] || []);
    while (outputs.length <= output) { outputs.push([]); }
    outputs[output].push({ node: to, type, index: 0 });
}
const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
const driveList = (name, position, q, fields) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
    url: "https://www.googleapis.com/drive/v3/files",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
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

node("Every 5 minutes", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } });
node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 200], {});
node("Settings", "n8n-nodes-base.set", 3.4, [220, 100], {
    assignments: {
        assignments: Object.entries(SETTINGS).map(([name, value], i) => ({ id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string" })),
    },
    options: {},
}, { executeOnce: true });
connect("Every 5 minutes", "Settings");
connect("Run now", "Settings");

driveList("List queue", [440, 100], "='{{ $('Settings').first().json.queueFolderId }}' in parents and trashed = false", "files(id,name,description,createdTime,modifiedTime)");
connect("Settings", "List queue");
driveList("List Artwork Agent", [660, 100], "='{{ $('Settings').first().json.agentFolderId }}' in parents and trashed = false", "files(id,name,mimeType,description,createdTime,modifiedTime)");
connect("List queue", "List Artwork Agent");

// ---- locks of runs that are over (cancelled, crashed...): checked with the n8n API, then deleted ----------------
code("Locks to check", [880, -200], `// Every lock ("<prefix>.lock-<execution id>") in the queue and Artwork Agent folders, a minute old or more
const files = [...($('List queue').first().json.files || []), ...($('List Artwork Agent').first().json.files || [])];
const locks = files.filter((f) => /\\.lock-\\d+$/.test(f.name) && Date.now() - new Date(f.createdTime).getTime() > 60000)
    .map((f) => ({ json: { id: f.id, name: f.name, executionId: f.name.split("-").pop() } }));
return locks.length ? locks : [{ json: { none: true } }];`, { executeOnce: true });
connect("List Artwork Agent", "Locks to check");
node("Any lock?", "n8n-nodes-base.if", 2, [1100, -200], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "anylock", leftValue: "={{ !$json.none }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
connect("Locks to check", "Any lock?");
// the n8n API: needs the credential "n8n API" (Settings > n8n API > API key); without it every lock is kept
node("Run of the lock", "n8n-nodes-base.n8n", 1, [1320, -280], {
    resource: "execution",
    operation: "get",
    executionId: "={{ $json.executionId }}",
    options: {},
}, { onError: "continueRegularOutput" });
connect("Any lock?", "Run of the lock", 0);
code("Locks of finished runs", [1540, -280], `// A run that is over no longer needs its lock; a run still going (or one that cannot be checked) keeps it
const locks = $('Locks to check').all().map((item) => item.json);
const out = [];
$input.all().forEach((item, i) => {
    const lock = locks[i];
    const r = item.json || {};
    if (!lock) return;
    if (r.error) {
        // gone from n8n (deleted or pruned): the run is long over
        const text = JSON.stringify(r.error);
        if (!/credential/i.test(text) && /404|could not be found/i.test(text)) out.push({ json: { ...lock, status: "gone" } });
        return;
    }
    const status = String(r.status || "");
    if (["success", "error", "canceled", "crashed"].includes(status)) out.push({ json: { ...lock, status } });
});
return out.length ? out : [{ json: { none: true } }];`, { executeOnce: true });
connect("Run of the lock", "Locks of finished runs");
node("Any to delete?", "n8n-nodes-base.if", 2, [1760, -280], {
    conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ id: "anytodelete", leftValue: "={{ !$json.none }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
    },
    options: {},
});
connect("Locks of finished runs", "Any to delete?");
node("Delete lock", "n8n-nodes-base.httpRequest", 4.2, [1980, -360], {
    method: "DELETE",
    url: "=https://www.googleapis.com/drive/v3/files/{{ $json.id }}?supportsAllDrives=true",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleDriveOAuth2Api",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Any to delete?", "Delete lock", 0);

code("Recent folders", [880, 100], `// Numbered folders created in the last recentDays days, oldest first (one empty item when there is none)
const settings = $('Settings').first().json;
const since = Date.now() - Number(settings.recentDays) * 86400000;
const folders = ($('List Artwork Agent').first().json.files || [])
    .filter((f) => f.mimeType === "application/vnd.google-apps.folder" && /^\\d+$/.test(String(f.name).trim()) && new Date(f.createdTime).getTime() >= since)
    .sort((a, b) => Number(a.name) - Number(b.name));
return folders.length ? folders.map((f) => ({ json: { id: f.id, name: String(f.name).trim() } })) : [{ json: { none: true } }];`, { executeOnce: true });
connect("Delete lock", "Recent folders");
connect("Any to delete?", "Recent folders", 1);
connect("Any lock?", "Recent folders", 1);

driveList("List folder files", [1100, 100], `={{ $json.none ? "${NONE_Q}" : "'" + $json.id + "' in parents and trashed = false" }}`, "files(name)");
connect("Recent folders", "List folder files");

code("Stages to start", [1320, 100], `// Which stages have waiting work, no fresh lock and no recent failure
const settings = $('Settings').first().json;
const STAGES = ${JSON.stringify(STAGES)};
const now = Date.now();
const queueFiles = $('List queue').first().json.files || [];
const rootFiles = $('List Artwork Agent').first().json.files || [];
const age = (f) => (now - new Date(f.modifiedTime || f.createdTime).getTime()) / 60000;
// a lock's own stale time is in its description ("staleMinutes=20"); older locks use the stage's value
const staleOf = (f, stage) => { const m = /staleMinutes=(\\d+)/.exec(f.description || ""); return m ? Number(m[1]) : STAGES[stage].staleMinutes; };
const cleared = $('Locks of finished runs').isExecuted ? $('Locks of finished runs').all().map((item) => item.json.id).filter(Boolean) : [];
const locked = (stage) => [...queueFiles, ...rootFiles].some((f) => f.name.startsWith(STAGES[stage].lock + "-") && age(f) < staleOf(f, stage) && !cleared.includes(f.id));
const failedRecently = (stage) => rootFiles.some((f) => f.name === "_failed-" + stage && age(f) < Number(settings.backoffMinutes));

const pending = { worker: [], titling: [], print: [], uploader: [] };
pending.worker = queueFiles.filter((f) => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_\\d{2}\\.(jpg|png|webp)$/.test(f.name)).map((f) => f.name);
// no reference left but a batch manifest still there: the worker finishes the batch (moves it to Done)
if (!pending.worker.length) pending.worker = queueFiles.filter((f) => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_batch\\.json$/.test(f.name) && age(f) > 10).map((f) => f.name);
const folders = $('Recent folders').all();
$input.all().forEach((item, i) => {
    const folder = folders[i].json;
    if (folder.none) return;
    const names = (item.json.files || []).map((f) => f.name);
    const art = names.find((n) => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_art\\.png$/.test(n));
    if (!art) return;
    const stamp = art.slice(0, 19);
    const has = (suffix) => names.includes(stamp + suffix);
    if (!has("_product.json")) pending.titling.push(folder.name);
    // a folder the Print Agent gave up on (3 runs with failed jobs) is not waiting for it any more
    const givenUp = names.filter((n) => n.startsWith(stamp + "_print-failed-")).length >= 3;
    if ((!has("_featured.png") || !has("_mockup.png")) && !givenUp) pending.print.push(folder.name);
    if (has("_product.json") && has("_featured.png") && has("_mockup.png") && !has("_shopify.json")) pending.uploader.push(folder.name);
});

const start = [];
for (const stage of Object.keys(STAGES)) {
    if (!pending[stage].length) continue;
    if (locked(stage) || failedRecently(stage)) continue;
    start.push({ json: { stage, workflowId: STAGES[stage].workflowId, waiting: pending[stage].slice(0, 20) } });
}
return start;`);
connect("List folder files", "Stages to start");

// one run per stage with waiting work, not awaited; a call that meets another run's lock waits and tries again
node("Start stage", "n8n-nodes-base.executeWorkflow", 1.2, [1540, 100], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: "={{ $json.workflowId }}" },
    mode: "each",
    options: { waitForSubWorkflow: false },
}, { onError: "continueRegularOutput" });
connect("Stages to start", "Start stage");

const workflow = {
    name: "Darl'Art Queue Watchdog",
    nodes,
    connections,
    settings: { executionOrder: "v1", timezone: "Africa/Casablanca", errorWorkflow: ERROR_WORKFLOW_ID, saveDataSuccessExecution: "none", saveManualExecutions: true },
    pinData: {},
};
const out = path.join(root, "automation/n8n-darlart-queue-watchdog.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
