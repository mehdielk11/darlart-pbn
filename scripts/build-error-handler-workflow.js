/**
 * Builds automation/n8n-darlart-error-handler.json, the "Darl'Art Error Handler" n8n workflow: the error workflow
 * (Workflow settings > Error workflow) of the Artwork Agent, the Artwork Worker, the Titling Agent, the Print Agent
 * and the Shopify Uploader.
 *
 *   a run fails -> its queue lock is deleted at once (the lock name ends with the run's execution id), instead of
 *   blocking the next runs until it goes stale -> Telegram alert (workflow, step, error, what happens next)
 *   -> a failed Artwork Worker run starts the worker again when the failure came after the reference's try was
 *      recorded (a reference that keeps failing is set aside after 3 tries, so this never loops); an earlier failure
 *      (e.g. Drive unreachable) is only reported, so a lasting outage cannot restart the worker over and over
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const SETTINGS = {
    telegramChatId: "-5252292447", // the Telegram group the "Telegram account" bot reports to (empty = no alert)
};
const WORKFLOWS = {
    worker: "dO8EdyDM4ua2hRrA", // Darl'Art Artwork Worker
    form: "SLFvTtBEdGfSbgGu", // Darl'Art Artwork Agent
    titling: "tOSHbCt7hJ6ORh8a", // Darl'Art Titling Agent
    print: "ytxV3m341mDLCdt4", // Darl'Art Print Agent
    uploader: "XAwk67SiWmvVSu1d", // Darl'Art Shopify Uploader
};
// the worker's steps before the reference's try is saved: a failure there is not retried automatically
const WORKER_STEPS_BEFORE_TRY = ["Settings", "List locks", "Lock state", "Lock free?", "Create lock", "List locks again", "Won the lock?", "Lock won?",
    "Step back (drop my lock)", "Busy: try again?", "Retry?", "Wait before retry", "List queue", "Next reference", "Anything queued?", "Has manifest?",
    "Download manifest", "Start attempt", "Record the try?", "Save manifest (try)"];
const LOCK_PREFIXES = ["_artwork-worker.lock", "_titling-agent.lock", "_print-agent.lock", "_shopify-uploader.lock"];

let nextId = 1;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
    nodes.push({ id: "ee" + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
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

node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 0], {});
node("Settings", "n8n-nodes-base.set", 3.4, [220, 0], {
    assignments: { assignments: Object.entries(SETTINGS).map(([name, value], i) => ({ id: "set" + i, name, value, type: "string" })) },
    options: {},
}, { executeOnce: true });
connect("Error Trigger", "Settings");

code("Error details", [440, 0], `// What failed, where, and the run's execution id (its lock is named <prefix>-<execution id>)
const e = $('Error Trigger').first().json;
const execution = e.execution || {};
const workflow = e.workflow || {};
const triggerError = (e.trigger && e.trigger.error) || null;
return [{ json: {
    executionId: execution.id ? String(execution.id) : "",
    workflowId: String(workflow.id || ""),
    workflowName: workflow.name || "A workflow",
    step: execution.lastNodeExecuted || (triggerError && triggerError.node && triggerError.node.name) || "",
    message: (execution.error && execution.error.message) || (triggerError && triggerError.message) || "unknown error",
    url: execution.url || "",
} }];`);
connect("Settings", "Error details");

node("Find locks", "n8n-nodes-base.httpRequest", 4.2, [660, 0], {
    url: "https://www.googleapis.com/drive/v3/files",
    ...googleAuth,
    sendQuery: true,
    queryParameters: {
        parameters: [
            { name: "q", value: "(" + LOCK_PREFIXES.map((p) => `name contains '${p}'`).join(" or ") + ") and trashed = false" },
            { name: "fields", value: "files(id,name)" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("Error details", "Find locks");

code("Locks of the run", [880, 0], `// Only the failed run's own lock: its name ends with "-<execution id>"
const id = $('Error details').first().json.executionId;
const locks = id ? ($input.first().json.files || []).filter((f) => f.name.endsWith("-" + id)) : [];
return locks.length ? locks.map((f) => ({ json: { id: f.id, name: f.name } })) : [{ json: { none: true } }];`);
connect("Find locks", "Locks of the run");

ifNode("Any lock?", [1100, 0], "={{ !$json.none }}", { executeOnce: true });
connect("Locks of the run", "Any lock?");
node("Delete the run's lock", "n8n-nodes-base.httpRequest", 4.2, [1320, -80], {
    method: "DELETE",
    url: "=https://www.googleapis.com/drive/v3/files/{{ $json.id }}?supportsAllDrives=true",
    ...googleAuth,
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
// "Any lock?" hands all the run's locks on (executeOnce only decides the branch), so they are deleted item by item
code("Locks to delete", [1210, -200], `return $('Locks of the run').all().filter((item) => !item.json.none).map((item) => ({ json: item.json }));`, { executeOnce: true });
connect("Any lock?", "Locks to delete", 0);
connect("Locks to delete", "Delete the run's lock");

code("Next steps", [1540, 0], `// What happens now, for the alert; the worker is started again only after a failure past its recorded try
const d = $('Error details').first().json;
const W = ${JSON.stringify(WORKFLOWS)};
const beforeTry = ${JSON.stringify(WORKER_STEPS_BEFORE_TRY)};
const released = $('Locks to delete').isExecuted ? $('Locks to delete').all().length : 0;
let next = "";
let restartWorker = false;
if (d.workflowId === W.worker) {
    if (d.step && !beforeTry.includes(d.step)) {
        restartWorker = true;
        next = "The worker starts again: this reference is retried, and set aside in Artwork Ref/Failed after 3 failed runs.";
    } else {
        next = "The worker stopped before painting: fix the cause, then click Run now in the Artwork Worker (the queue is kept).";
    }
} else if (d.workflowId === W.print) next = "The next run (after the next artwork, or daily at 04:00) retries the unfinished folders.";
else if (d.workflowId === W.titling) next = "The next run (after the next artwork, or daily at 03:00) retries the folders without product texts.";
else if (d.workflowId === W.uploader) next = "The next run (after the next Print Agent run, or daily at 05:00) retries this folder.";
else if (d.workflowId === W.form) next = "This upload may not be queued: check Artwork Ref/Queue, and send the images again if they are missing.";
const lines = [
    "Workflow failed: " + d.workflowName,
    d.step ? "Step: " + d.step : "",
    "Error: " + String(d.message).slice(0, 600),
    released ? "Its queue lock was released, so the next runs are not blocked." : "",
    next,
    d.url,
].filter(Boolean);
return [{ json: { restartWorker, text: lines.join("\\n") } }];`, { executeOnce: true });
connect("Delete the run's lock", "Next steps");
connect("Any lock?", "Next steps", 1);

ifNode("Restart the worker?", [1760, -80], "={{ $json.restartWorker }}");
connect("Next steps", "Restart the worker?");
node("Start the worker", "n8n-nodes-base.executeWorkflow", 1.2, [1980, -80], {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: WORKFLOWS.worker },
    mode: "once",
    options: { waitForSubWorkflow: false },
}, { executeOnce: true, onError: "continueRegularOutput" });
connect("Restart the worker?", "Start the worker", 0);

ifNode("Telegram on?", [1760, 120], "={{ String($('Settings').first().json.telegramChatId || '').trim() !== '' }}");
connect("Next steps", "Telegram on?");
node("Telegram: failure alert", "n8n-nodes-base.telegram", 1.2, [1980, 120], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    text: "={{ $('Next steps').first().json.text }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true },
}, { onError: "continueRegularOutput" });
connect("Telegram on?", "Telegram: failure alert", 0);

const workflow = { name: "Darl'Art Error Handler", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca" }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-error-handler.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
