/**
 * Builds automation/n8n-darlart-error-handler.json, the "Darl'Art Error Handler" n8n workflow: the error workflow
 * (Workflow settings > Error workflow) of the Artwork Agent, the Artwork Worker, the Titling Agent, the Print Agent
 * and the Shopify Uploader.
 *
 *   a run fails -> its queue lock is deleted at once (the lock name ends with the run's execution id), instead of
 *   blocking the next runs until it goes stale -> Telegram alert (workflow, step, error, what happens next)
 *   -> a failed Artwork Worker run starts the worker again when the failure came after the reference's try was
 *      recorded (a reference that keeps failing is set aside after 3 tries, so this never loops); an earlier failure
 *      (e.g. Drive unreachable) is only reported, so a lasting outage cannot restart the worker over and over; and
 *      the worker is restarted at most maxRestarts times in restartWindowMinutes, whatever the step
 *   -> a stage that is not restarted at once gets a marker "_failed-<stage>" in Artwork Agent (created, or its date
 *      refreshed): the Queue Watchdog does not start it again for 30 minutes, so a lasting problem is not retried
 *      every 5 minutes
 *   -> the same failure (workflow, step, error) is announced at most once an hour
 *   -> a failure of an account or a service (no OpenAI credit, wrong key, missing permission, rate limit, service
 *      unreachable) is not the work's fault: the worker is not restarted at once (it would fail the same way), and
 *      the run's try markers ("_titling-try-<execution>", "_upload-try-<execution>") are deleted, so the folders it
 *      was working on are not given up for it
 */
const fs = require("fs");
const path = require("path");
const { SERVICE_PROBLEM } = require("./lib/n8n-queue-lock");

const root = path.join(__dirname, "..");

const SETTINGS = {
    telegramChatId: "-1003952514058", // the Telegram group the "Telegram account" bot reports to (empty = no alert)
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent": where the "_failed-<stage>" markers live
    alertEveryMinutes: "60", // the same failure is announced at most once in this time
    maxRestarts: "5", // the worker is restarted at most this many times...
    restartWindowMinutes: "30", // ...in this time; after that the Queue Watchdog takes over (30 min later)
};
const WORKFLOWS = {
    worker: "dO8EdyDM4ua2hRrA", // Darl'Art Artwork Worker
    form: "SLFvTtBEdGfSbgGu", // Darl'Art Artwork Agent
    titling: "tOSHbCt7hJ6ORh8a", // Darl'Art Titling Agent
    print: "ytxV3m341mDLCdt4", // Darl'Art Print Agent
    uploader: "XAwk67SiWmvVSu1d", // Darl'Art Shopify Uploader
};
// the worker's steps before the reference's try is saved, and its queue clean-up: a failure there is not retried at
// once (it would fail the same way), the Queue Watchdog tries again later
const WORKER_STEPS_BEFORE_TRY = ["Settings", "List locks", "Lock state", "Lock free?", "Create lock", "List locks again", "Won the lock?", "Lock won?",
    "Step back (drop my lock)", "Busy: try again?", "Retry?", "Wait before retry", "List queue", "Next reference", "Anything queued?", "Has manifest?",
    "Download manifest", "Start attempt", "Record the try?", "Save manifest (try)",
    "Leftover manifests", "Any leftover?", "Download leftover", "Finished batches", "Any finished?", "Save finished manifest", "Move finished manifest",
    // the OpenAI account can't be used: the try was given back, the queue waits
    "Stop: OpenAI unavailable", "Save manifest (try given back)"];
// the try markers a run leaves in the folders it works on (deleted when the run failed on an account or service problem)
const TRY_PREFIXES = ["_titling-try-", "_upload-try-"];
const LOCK_PREFIXES = ["_artwork-worker.lock", "_titling-agent.lock", "_print-agent.lock", "_shopify-uploader.lock", "_price-sync.lock", "_translation-sync.lock"];

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
            { name: "q", value: "(" + [...LOCK_PREFIXES, ...TRY_PREFIXES].map((p) => `name contains '${p}'`).join(" or ") + " or name contains '_failed-') and trashed = false" },
            { name: "fields", value: "files(id,name,parents)" },
            { name: "pageSize", value: "1000" },
            { name: "supportsAllDrives", value: "true" },
            { name: "includeItemsFromAllDrives", value: "true" },
        ],
    },
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput", retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });
connect("Error details", "Find locks");

code("Locks of the run", [880, 0], `// Only the failed run's own lock: its name ends with "-<execution id>"; and its try markers when the failure was an
// account or service problem (the folders are not given up for it)
const d = $('Error details').first().json;
const id = d.executionId;
const service = d.step === "Stop: OpenAI unavailable" || ${SERVICE_PROBLEM}.test(d.message);
const TRY = ${JSON.stringify(TRY_PREFIXES)};
const locks = id ? ($input.first().json.files || []).filter((f) => f.name.endsWith("-" + id) && (f.name.includes(".lock-") || (service && TRY.some((p) => f.name.startsWith(p))))) : [];
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
const released = $('Locks to delete').isExecuted ? $('Locks to delete').all().filter((item) => item.json.name.includes(".lock-")).length : 0;
const service = d.step === "Stop: OpenAI unavailable" || ${SERVICE_PROBLEM}.test(d.message);
const settings = $('Settings').first().json;
const memory = $getWorkflowStaticData("global");
const now = Date.now();
let next = "";
let restartWorker = false;
if (d.workflowId === W.worker) {
    // restarts of the last restartWindowMinutes: a failure that repeats whatever the reference stops being retried at once
    memory.restarts = (memory.restarts || []).filter((t) => now - t < Number(settings.restartWindowMinutes) * 60000);
    if (service) {
        next = "An account or service problem (credit, key, permission, rate limit): the worker is not restarted at once, the queue is kept.";
    } else if (d.step && !beforeTry.includes(d.step) && memory.restarts.length < Number(settings.maxRestarts)) {
        restartWorker = true;
        memory.restarts.push(now);
        next = "The worker starts again: this reference is retried, and set aside in Artwork Ref/Failed after 3 failed runs.";
    } else if (d.step && !beforeTry.includes(d.step)) {
        next = "The worker failed " + memory.restarts.length + " times in " + settings.restartWindowMinutes + " minutes, so it is not restarted at once; the queue is kept.";
    } else {
        next = "The worker stopped before painting; the queue is kept.";
    }
} else if (d.workflowId === W.print) next = "The next run (after the next artwork, or daily at 04:00) retries the unfinished folders.";
else if (d.workflowId === W.titling) next = "The next run (after the next artwork, or daily at 03:00) retries the folders without product texts.";
else if (d.workflowId === W.uploader) next = "The next run (after the next Print Agent run, or daily at 05:00) retries this folder.";
else if (d.workflowId === W.form) next = "This upload may not be queued: check Artwork Ref/Queue, and send the images again if they are missing.";
// the stage, for the Queue Watchdog's backoff marker (the form has none: it holds no queue)
const stage = { [W.worker]: "worker", [W.titling]: "titling", [W.print]: "print", [W.uploader]: "uploader" }[d.workflowId] || "";
const marker = stage ? (($('Find locks').first().json.files || []).find((f) => f.name === "_failed-" + stage && (f.parents || []).includes(settings.agentFolderId)) || null) : null;
// the same failure is announced at most once every alertEveryMinutes (kept in this workflow's static data)
memory.alerts = memory.alerts || {};
const key = d.workflowId + "|" + d.step + "|" + String(d.message).slice(0, 120);
for (const [k, t] of Object.entries(memory.alerts)) if (now - t > 24 * 3600000) delete memory.alerts[k];
const sendAlert = !memory.alerts[key] || now - memory.alerts[key] >= Number(settings.alertEveryMinutes) * 60000;
if (sendAlert) memory.alerts[key] = now;
if (stage && !restartWorker) next += " The Queue Watchdog starts it again in 30 minutes if work is still waiting (click Run now to go sooner).";
if (service && d.workflowId !== W.worker) next += " This looks like an account or service problem (OpenAI credit or key, Shopify or Drive permission, rate limit): it does not count as a try on the folders.";
const lines = [
    "Workflow failed: " + d.workflowName,
    d.step ? "Step: " + d.step : "",
    "Error: " + String(d.message).slice(0, 600),
    released ? "Its queue lock was released, so the next runs are not blocked." : "",
    next,
    d.url,
].filter(Boolean);
// a worker restarted at once needs no backoff marker: the Queue Watchdog must not hold its queue back
return [{ json: { restartWorker, sendAlert, stage: restartWorker ? "" : stage, markerId: marker ? marker.id : "", text: lines.join("\\n") } }];`, { executeOnce: true });
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

ifNode("Telegram on?", [1760, 120], "={{ $json.sendAlert && String($('Settings').first().json.telegramChatId || '').trim() !== '' }}");
connect("Next steps", "Telegram on?");
node("Telegram: failure alert", "n8n-nodes-base.telegram", 1.2, [1980, 120], {
    chatId: "={{ $('Settings').first().json.telegramChatId }}",
    // HTML with the text escaped: Markdown (n8n's default) refuses texts with "_"
    text: "={{ String($('Next steps').first().json.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: "HTML" },
}, { onError: "continueRegularOutput" });
connect("Telegram on?", "Telegram: failure alert", 0);

// the backoff marker: created, or its date refreshed (a metadata-only Drive file)
ifNode("A queue stage?", [1760, 300], "={{ !!$json.stage }}");
connect("Next steps", "A queue stage?");
node("Mark the failure", "n8n-nodes-base.httpRequest", 4.2, [1980, 300], {
    method: "={{ $json.markerId ? 'PATCH' : 'POST' }}",
    url: "={{ 'https://www.googleapis.com/drive/v3/files' + ($json.markerId ? '/' + $json.markerId : '') + '?supportsAllDrives=true&fields=id,name,modifiedTime' }}",
    ...googleAuth,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.markerId ? { modifiedTime: $now.toUTC().toISO() } : { name: '_failed-' + $json.stage, mimeType: 'text/plain', parents: [$('Settings').first().json.agentFolderId] }) }}",
    options: { timeout: 30000 },
}, { onError: "continueRegularOutput" });
connect("A queue stage?", "Mark the failure", 0);

const workflow = { name: "Darl'Art Error Handler", nodes, connections, settings: { executionOrder: "v1", timezone: "Africa/Casablanca" }, pinData: {} };
const out = path.join(root, "automation/n8n-darlart-error-handler.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
