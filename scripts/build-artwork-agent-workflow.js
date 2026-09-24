/**
 * Builds the two n8n workflows of the Artwork Agent:
 *
 * automation/n8n-darlart-artwork-agent.json, "Darl'Art Artwork Agent" (the form): up to 20 references per upload
 *   Formulaire (upload) -> check every file (real JPG/PNG/WEBP, 5 MB max) -> queue the good ones in Drive
 *   "Artwork Ref/Queue" with a batch manifest -> start the worker -> the page answers right away (queued / refused)
 *
 * automation/n8n-darlart-artwork-worker.json, "Darl'Art Artwork Worker": one queued reference per run
 *   queue lock (one worker at a time) -> oldest queued reference
 *   -> gpt-image paints the artwork from the reference (fixed prompt, the reference's own colors) -> checker rejects swatches/text/borders (up to 3 tries)
 *   -> pbn API /v1/recolor: every pixel snapped to exactly 48 Darl'Art colors
 *   -> new folder "Artwork Agent/1xxx" with the reference, the artwork and the palette JSON
 *   -> the reference moves to "Artwork Ref" (or "Artwork Ref/Failed"), the batch manifest records the result
 *   -> Titling and Print agents start; the worker starts again while references are queued
 *
 * "Check palette" embeds the palette from server/palettes/darlart-v3.json: run `node scripts/build-artwork-agent-workflow.js`
 * again after changing it, then re-import the workflows.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
// "Darl'Art Error Handler" (scripts/build-error-handler-workflow.js): releases a failed run's lock and alerts on Telegram
const ERROR_WORKFLOW_ID = "aokToPHKOa4MciN1";
const palette = JSON.parse(fs.readFileSync(path.join(root, "server/palettes/darlart-v3.json"), "utf8"));

// ===== Settings written into the workflows (all editable later in their "Settings" node) =====
const SETTINGS = {
    colors: 48,
    exclude: "3801,3811", // pure white and near black are never used in the artwork
    paletteId: "darlart-v3",
    pbnApiUrl: "http://127.0.0.1:3000",
    refFolderId: "1iGdgyIplbyQx52QOK1jUcwOuwuYTlWM-", // Drive "Artwork Ref"
    queueFolderId: "13fjEqSw2tqYfKwn23RPDdItLigrRvjTb", // Drive "Artwork Ref/Queue": references waiting + batch manifests
    doneFolderId: "1qph_ttrwCa303b2GxsHGpdLujqUm2y_B", // Drive "Artwork Ref/Queue/Done": manifests of painted batches
    failedFolderId: "1CbfwyL5REPwYkSFEgR4iQpQSK38TZ89U", // Drive "Artwork Ref/Failed": references that could not be painted
    agentFolderId: "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH", // Drive "Artwork Agent"
    firstFolderNumber: 1001,
    imageModel: "gpt-image-2",
    imageQuality: "medium", // "high" costs ~4x more; the 48-color snap removes the fine texture it adds
    // the artwork is always this canvas: the model paints at imageSize (same 4:5 ratio as 60x75) and the snap
    // step crops (never stretches) to the exact ratio
    canvasSize: "60x75",
    orientation: "portrait",
    imageSize: "1024x1280", // multiples of 16, exactly 4:5
    maxTries: 3, // runs a queued reference may crash before it is set aside as failed
    lockStaleMinutes: 45, // a lock not refreshed for this long belongs to a crashed run
    telegramChatId: "-5252292447", // the Telegram group the "Telegram account" bot reports to (empty = no messages)
    timezone: "Africa/Casablanca",
};
const MAX_BATCH = 20; // references per upload, the rest are refused on the page
const MAX_MB = 5; // per reference
// ============================================================================================
const SETTINGS_TITLING_WORKFLOW_ID = "tOSHbCt7hJ6ORh8a"; // "Darl'Art Titling Agent" in n8n
const SETTINGS_PRINT_WORKFLOW_ID = "ytxV3m341mDLCdt4"; // "Darl'Art Print Agent" in n8n
const SETTINGS_WORKER_WORKFLOW_ID = "dO8EdyDM4ua2hRrA"; // "Darl'Art Artwork Worker" in n8n
const LOCK_PREFIX = "_artwork-worker.lock";
const QUEUED_IMAGE = "^\\\\d{4}-\\\\d{2}-\\\\d{2}_\\\\d{2}-\\\\d{2}-\\\\d{2}_\\\\d{2}\\\\.(jpg|png|webp)$"; // <batchId>_<nn>.<ext>

const excluded = new Set(SETTINGS.exclude.split(","));
const codeToHex = {};
for (const [hex, value] of Object.entries(palette)) {
    if (!excluded.has(value.code)) {
        codeToHex[value.code] = hex.toUpperCase();
    }
}
const codes = Object.keys(codeToHex).sort();

const drive = { __rl: true, mode: "list", value: "My Drive" };
const byId = (value) => ({ __rl: true, mode: "id", value });
const driveFiles = "https://www.googleapis.com/drive/v3/files";
const googleAuth = { authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api" };

function workflowBuilder(idPrefix) {
    let nextId = 1;
    const nodes = [];
    const connections = {};
    const node = (name, type, typeVersion, position, parameters, extra = {}) => {
        nodes.push({ id: idPrefix + String(nextId++).padStart(6, "0") + "-0000-4000-8000-000000000000", name, type, typeVersion, position, parameters, ...extra });
    };
    const connect = (from, to, output = 0, type = "main") => {
        connections[from] = connections[from] || {};
        const outputs = (connections[from][type] = connections[from][type] || []);
        while (outputs.length <= output) { outputs.push([]); }
        outputs[output].push({ node: to, type, index: 0 });
    };
    const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
    const ifNode = (name, position, left) => node(name, "n8n-nodes-base.if", 2, position, {
        conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
            conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
            combinator: "and",
        },
        options: {},
    });
    const settingsNode = (position, values) => node("Settings", "n8n-nodes-base.set", 3.4, position, {
        assignments: {
            assignments: Object.entries(values).map(([name, value], i) => ({
                id: "set" + i, name, value, type: typeof value === "number" ? "number" : "string",
            })),
        },
        options: {},
    }, { executeOnce: true });
    const runWorkflow = (name, position, workflowId) => node(name, "n8n-nodes-base.executeWorkflow", 1.2, position, {
        source: "database",
        workflowId: { __rl: true, mode: "id", value: workflowId },
        mode: "once",
        options: { waitForSubWorkflow: false },
    }, { executeOnce: true, onError: "continueRegularOutput" });
    const telegramOn = "={{ String($('Settings').first().json.telegramChatId || '').trim() !== '' }}";
    const telegramText = (name, position, textExpression) => node(name, "n8n-nodes-base.telegram", 1.2, position, {
        chatId: "={{ $('Settings').first().json.telegramChatId }}",
        text: textExpression,
        additionalFields: { appendAttribution: false, disable_web_page_preview: true },
    }, { onError: "continueRegularOutput" });
    const telegramPhoto = (name, position, captionExpression) => node(name, "n8n-nodes-base.telegram", 1.2, position, {
        operation: "sendPhoto",
        chatId: "={{ $('Settings').first().json.telegramChatId }}",
        binaryData: true,
        binaryPropertyName: "data",
        additionalFields: { caption: captionExpression },
    }, { onError: "continueRegularOutput" });
    const completionPage = (name, position, responseText) => node(name, "n8n-nodes-base.form", 2.3, position, { operation: "completion", respondWith: "showText", responseText });
    const save = (file, name) => {
        const out = path.join(root, file);
        fs.writeFileSync(out, JSON.stringify({ name, nodes, connections, settings: { executionOrder: "v1", timezone: SETTINGS.timezone, errorWorkflow: ERROR_WORKFLOW_ID }, pinData: {} }, null, 2) + "\n");
        console.log("Wrote " + path.relative(root, out) + ": " + nodes.length + " nodes");
    };
    return { nodes, connections, node, connect, code, ifNode, settingsNode, runWorkflow, completionPage, save, telegramOn, telegramText, telegramPhoto };
}

// =====================================================================================================
// "Darl'Art Artwork Agent": the form, receives and queues
// =====================================================================================================
{
    const { node, connect, code, ifNode, settingsNode, runWorkflow, completionPage, save, telegramOn, telegramText } = workflowBuilder("aa");

    node("Formulaire", "n8n-nodes-base.formTrigger", 2.2, [0, 0], {
        formTitle: "Darl'Art Artwork Agent",
        formDescription: "Upload up to " + MAX_BATCH + " artwork references (JPG, PNG or WEBP, " + MAX_MB + " MB each). Each one is painted with exactly " + SETTINGS.colors + " Darl'Art colors, one after another (about 2 minutes each), and saved in Drive (Artwork Agent/1xxx). You can close this page after sending.",
        formFields: { values: [{ fieldLabel: "Artwork references", fieldType: "file", multipleFiles: true, acceptFileTypes: ".jpg,.jpeg,.png,.webp", requiredField: true }] },
        options: { buttonLabel: "Queue artworks", appendAttribution: false },
    });

    // ---- every file checked: real image format (from the file's bytes, not its name) and size ----
    code("Check uploads", [220, 0], `// Every uploaded file is checked: a real JPG, PNG or WEBP (read from the file's first bytes, so a renamed PDF is
// refused) of MAX_MB at most. Up to MAX_FILES good files are queued, one item each; the refused ones are listed.
const MAX_MB = ${MAX_MB};
const MAX_FILES = ${MAX_BATCH};
const item = $input.first();
const keys = Object.keys(item.binary || {});
const batchId = $now.setZone("${SETTINGS.timezone}").toFormat("yyyy-MM-dd_HH-mm-ss");
const accepted = [];
const refused = [];
for (const key of keys) {
    const file = item.binary[key];
    const name = file.fileName || key;
    const bytes = await this.helpers.getBinaryDataBuffer(0, key);
    const head = bytes.subarray(0, 12);
    const ascii = (from, to) => head.subarray(from, to).toString("latin1");
    let format = "";
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) format = "jpg";
    else if (head[0] === 0x89 && ascii(1, 4) === "PNG") format = "png";
    else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") format = "webp";
    let reason = "";
    if (!format) reason = "not a JPG, PNG or WEBP image";
    else if (bytes.length > MAX_MB * 1024 * 1024) reason = (bytes.length / 1024 / 1024).toFixed(1) + " MB, the maximum is " + MAX_MB + " MB";
    else if (bytes.length < 100) reason = "empty or damaged";
    else if (accepted.length >= MAX_FILES) reason = "more than " + MAX_FILES + " files in one upload";
    if (reason) { refused.push({ name, reason }); continue; }
    const queueName = batchId + "_" + String(accepted.length + 1).padStart(2, "0") + "." + format;
    const mimeType = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[format];
    accepted.push({ json: { batchId, queueName, originalName: name }, binary: { reference: { ...file, mimeType, fileName: queueName, fileExtension: format } } });
}
if (!accepted.length) return [{ json: { none: true, batchId, refused } }];
return accepted.map((a) => ({ json: { ...a.json, refused }, binary: a.binary }));`);
    connect("Formulaire", "Check uploads");

    settingsNode([440, 0], { queueFolderId: SETTINGS.queueFolderId, agentFolderId: SETTINGS.agentFolderId, telegramChatId: SETTINGS.telegramChatId });
    connect("Check uploads", "Settings");

    ifNode("Anything to queue?", [660, 0], "={{ !$('Check uploads').first().json.none }}");
    connect("Settings", "Anything to queue?");

    code("Queue files", [880, -100], `// The accepted references, with their files, for the queue folder
return $('Check uploads').all().map((item) => ({ json: item.json, binary: item.binary }));`);
    connect("Anything to queue?", "Queue files", 0);

    node("Save queued references", "n8n-nodes-base.googleDrive", 3, [1100, -100], {
        name: "={{ $json.queueName }}",
        driveId: drive,
        folderId: byId("={{ $('Settings').first().json.queueFolderId }}"),
        inputDataFieldName: "reference",
        options: {},
    });
    connect("Queue files", "Save queued references");

    code("Batch manifest", [1320, -100], `// <batchId>_batch.json: what the worker paints and what it made of each reference
const accepted = $('Check uploads').all().map((item) => item.json);
const manifest = {
    batchId: accepted[0].batchId,
    submittedAt: $now.setZone("${SETTINGS.timezone}").toISO(),
    files: accepted.map((a) => ({ queueName: a.queueName, originalName: a.originalName, status: "queued", tries: 0 })),
    refused: accepted[0].refused,
};
const fileName = manifest.batchId + "_batch.json";
return [{
    json: { fileName },
    binary: { data: { data: Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64"), mimeType: "application/json", fileName } },
}];`);
    connect("Save queued references", "Batch manifest");

    node("Save batch manifest", "n8n-nodes-base.googleDrive", 3, [1540, -100], {
        name: "={{ $json.fileName }}",
        driveId: drive,
        folderId: byId("={{ $('Settings').first().json.queueFolderId }}"),
        inputDataFieldName: "data",
        options: {},
    });
    connect("Batch manifest", "Save batch manifest");

    // the worker paints the queue one reference after another; the page does not wait for it
    runWorkflow("Start worker", [1760, -100], SETTINGS_WORKER_WORKFLOW_ID);
    connect("Save batch manifest", "Start worker");

    const page = (body) => `// The page shown after sending: what was queued and what was refused
const checked = $('Check uploads').all().map((item) => item.json);
const first = checked[0];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const queued = first.none ? [] : checked.map((c) => c.originalName);
const refused = first.refused || [];
const folderUrl = "https://drive.google.com/drive/folders/" + $('Settings').first().json.agentFolderId;
${body}
return [{ json: { html: '<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;text-align:left">' + html + "</div>" } }];`;
    code("Build queued page", [1980, -100], page(`let html = "<h2>" + queued.length + " artwork" + (queued.length > 1 ? "s" : "") + " queued</h2>"
    + "<p>They are painted one after another, about 2 minutes each, and appear in Drive as Artwork Agent/1xxx. You can close this page.</p>"
    + "<ul>" + queued.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>";
if (refused.length) html += "<h3>" + refused.length + " refused</h3><ul>" + refused.map((r) => "<li>" + esc(r.name) + ": " + esc(r.reason) + "</li>").join("") + "</ul>";
html += '<p><a href="' + folderUrl + '" target="_blank">Open Artwork Agent in Drive</a></p>';`), { executeOnce: true });
    connect("Start worker", "Build queued page");
    completionPage("Page: queued", [2200, -100], "={{ $json.html }}");
    connect("Build queued page", "Page: queued");

    code("Build refused page", [880, 160], page(`let html = "<h2>Nothing was queued</h2><p>None of the files can be used:</p>"
    + "<ul>" + refused.map((r) => "<li>" + esc(r.name) + ": " + esc(r.reason) + "</li>").join("") + "</ul>"
    + '<p><a href="javascript:history.back()">Try again</a></p>';`));
    connect("Anything to queue?", "Build refused page", 1);

    // ---- Telegram: what this upload queued, what it refused, and how long the queue is ----------------------------
    ifNode("Telegram on?", [1980, 120], telegramOn);
    connect("Start worker", "Telegram on?");
    node("List queue", "n8n-nodes-base.httpRequest", 4.2, [2200, 120], {
        url: driveFiles,
        ...googleAuth,
        sendQuery: true,
        queryParameters: {
            parameters: [
                { name: "q", value: "='{{ $('Settings').first().json.queueFolderId }}' in parents and trashed = false" },
                { name: "fields", value: "files(id,name)" },
                { name: "pageSize", value: "1000" },
                { name: "supportsAllDrives", value: "true" },
                { name: "includeItemsFromAllDrives", value: "true" },
            ],
        },
        options: { timeout: 30000 },
    }, { onError: "continueRegularOutput" });
    connect("Telegram on?", "List queue", 0);
    code("Queued message", [2420, 120], `// Queued, refused, and the whole queue: how many references wait (earlier batches first) and roughly how long
const checked = $('Check uploads').all().map((item) => item.json);
const first = checked[0];
const refused = first.refused || [];
const queued = checked.map((c) => c.originalName);
const waiting = ($input.first().json.files || []).filter((f) => new RegExp("${QUEUED_IMAGE}").test(f.name));
const ahead = waiting.filter((f) => f.name.slice(0, 19) < first.batchId).length;
const lines = ["Artwork Agent: " + queued.length + " image" + (queued.length === 1 ? "" : "s") + " queued for painting (batch " + first.batchId + ")"];
for (const name of queued) lines.push("- " + name);
if (refused.length) {
    lines.push("", refused.length + " refused:");
    for (const r of refused) lines.push("- " + r.name + ": " + r.reason);
}
lines.push("", "Queue: " + waiting.length + " image" + (waiting.length === 1 ? "" : "s") + " waiting" + (ahead ? ", " + ahead + " from earlier uploads first" : "") + ". About " + (waiting.length * 2) + " min to paint them all, one after another.");
lines.push("Each one gets its folder Artwork Agent/1xxx; you get the painted artwork here.");
return [{ json: { text: lines.join("\\n") } }];`);
    connect("List queue", "Queued message");
    telegramText("Telegram: queued", [2640, 120], "={{ $json.text }}");
    connect("Queued message", "Telegram: queued");

    ifNode("Telegram on? (refused)", [1100, 320], telegramOn);
    connect("Anything to queue?", "Telegram on? (refused)", 1);
    code("Refused message", [1320, 320], `const refused = $('Check uploads').first().json.refused || [];
const lines = ["Artwork Agent: nothing queued, none of the " + refused.length + " file" + (refused.length === 1 ? "" : "s") + " can be used:"];
for (const r of refused) lines.push("- " + r.name + ": " + r.reason);
return [{ json: { text: lines.join("\\n") } }];`);
    connect("Telegram on? (refused)", "Refused message", 0);
    telegramText("Telegram: refused", [1540, 320], "={{ $json.text }}");
    connect("Refused message", "Telegram: refused");
    completionPage("Page: nothing queued", [1100, 160], "={{ $json.html }}");
    connect("Build refused page", "Page: nothing queued");

    save("automation/n8n-darlart-artwork-agent.json", "Darl'Art Artwork Agent");
}

// =====================================================================================================
// "Darl'Art Artwork Worker": one queued reference per run
// =====================================================================================================
{
    const { nodes, node, connect, code, ifNode, settingsNode, runWorkflow, save, telegramOn, telegramText, telegramPhoto } = workflowBuilder("ab");
    const driveList = (name, position, q, fields) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
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
    // moves (and renames) a Drive file: the body gives the new name, the query the old and new folders
    const moveFile = (name, position, idExpression, toExpression, fromExpression, bodyExpression) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
        method: "PATCH",
        url: `={{ '${driveFiles}/' + ${idExpression} + '?supportsAllDrives=true&fields=id,name,parents&addParents=' + ${toExpression} + '&removeParents=' + ${fromExpression} }}`,
        ...googleAuth,
        sendBody: true,
        specifyBody: "json",
        jsonBody: bodyExpression,
        options: { timeout: 30000 },
    });
    // replaces a Drive file's content with the binary "manifest"
    const saveManifest = (name, position) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
        method: "PATCH",
        url: `={{ 'https://www.googleapis.com/upload/drive/v3/files/' + $('Next reference').first().json.manifestId + '?uploadType=media&supportsAllDrives=true' }}`,
        ...googleAuth,
        sendBody: true,
        contentType: "binaryData",
        inputDataFieldName: "manifest",
        options: { timeout: 30000 },
    });

    // ---- 1. triggers, settings ---------------------------------------------------------------------
    node("When called by Artwork Agent", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 0], { inputSource: "passthrough" });
    // after a crashed run, "Run now" paints what is left in the queue (the next upload does too)
    node("Run now", "n8n-nodes-base.manualTrigger", 1, [0, 200], {});
    settingsNode([220, 200], SETTINGS);
    for (const trigger of ["When called by Artwork Agent", "Run now"]) { connect(trigger, "Settings"); }

    // ---- 2. queue lock: one worker at a time, so folder numbers never repeat -------------------------
    const lockQuery = `='{{ $('Settings').first().json.queueFolderId }}' in parents and name contains '${LOCK_PREFIX}' and trashed = false`;
    driveList("List locks", [440, 200], lockQuery, "files(id,name,createdTime,modifiedTime)");
    connect("Settings", "List locks");

    code("Lock state", [660, 200], `// Another worker holds a fresh lock (less than lockStaleMinutes old): it also paints the references just queued
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
        jsonBody: `={{ JSON.stringify({ name: '${LOCK_PREFIX}-' + $execution.id, mimeType: 'text/plain', parents: [$('Settings').first().json.queueFolderId] }) }}`,
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
    node("Step back (drop my lock)", "n8n-nodes-base.httpRequest", 4.2, [1980, 280], {
        method: "DELETE",
        url: `=${driveFiles}/{{ $json.lockId }}?supportsAllDrives=true`,
        ...googleAuth,
        options: { timeout: 30000 },
    }, { onError: "continueRegularOutput" });
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

    // ---- 3. the oldest queued reference and its batch manifest ---------------------------------------
    driveList("List queue", [1980, 40], "='{{ $('Settings').first().json.queueFolderId }}' in parents and trashed = false", "files(id,name,mimeType)");
    connect("Lock won?", "List queue", 0);

    code("Next reference", [2200, 40], `// The oldest queued reference (<batchId>_<nn>.<ext>, oldest batch first) and its batch manifest
const files = $input.first().json.files || [];
const images = files.filter((f) => new RegExp("${QUEUED_IMAGE}").test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
if (!images.length) return [{ json: { none: true } }];
const image = images[0];
const batchId = image.name.slice(0, 19);
const manifest = files.find((f) => f.name === batchId + "_batch.json");
return [{ json: { none: false, fileId: image.id, queueName: image.name, extension: image.name.split(".").pop(), batchId, manifestId: manifest ? manifest.id : "", remaining: images.length - 1 } }];`);
    connect("List queue", "Next reference");

    ifNode("Anything queued?", [2420, 40], "={{ !$json.none }}");
    connect("Next reference", "Anything queued?");

    ifNode("Has manifest?", [2640, -40], "={{ !!$json.manifestId }}");
    connect("Anything queued?", "Has manifest?", 0);
    node("Download manifest", "n8n-nodes-base.httpRequest", 4.2, [2860, -120], {
        url: "=https://www.googleapis.com/drive/v3/files/{{ $json.manifestId }}?alt=media&supportsAllDrives=true",
        ...googleAuth,
        options: { response: { response: { responseFormat: "json" } }, timeout: 30000 },
    });
    connect("Has manifest?", "Download manifest", 0);

    code("Start attempt", [3080, -40], `// One more try for this reference: after maxTries runs that stopped midway, it is set aside as failed
const settings = $('Settings').first().json;
const next = $('Next reference').first().json;
const manifest = next.manifestId && $('Download manifest').isExecuted ? $('Download manifest').first().json : null;
let tries = 1;
let originalName = next.queueName;
if (manifest && Array.isArray(manifest.files)) {
    const entry = manifest.files.find((e) => e.queueName === next.queueName);
    if (entry) {
        entry.tries = (Number(entry.tries) || 0) + 1;
        tries = entry.tries;
        originalName = entry.originalName || originalName;
    }
}
const out = { json: { tries, giveUp: tries > Number(settings.maxTries), originalName, manifest, hasManifest: !!manifest } };
if (manifest) out.binary = { manifest: { data: Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64"), mimeType: "application/json", fileName: next.batchId + "_batch.json" } };
return [out];`);
    connect("Has manifest?", "Start attempt", 1);
    connect("Download manifest", "Start attempt");

    ifNode("Record the try?", [3300, -40], "={{ $json.hasManifest }}");
    connect("Start attempt", "Record the try?");
    saveManifest("Save manifest (try)", [3520, -120]);
    connect("Record the try?", "Save manifest (try)", 0);

    ifNode("Tries left?", [3740, -40], "={{ !$('Start attempt').first().json.giveUp }}");
    connect("Save manifest (try)", "Tries left?");
    connect("Record the try?", "Tries left?", 1);

    node("Download reference", "n8n-nodes-base.httpRequest", 4.2, [3960, -120], {
        url: "=https://www.googleapis.com/drive/v3/files/{{ $('Next reference').first().json.fileId }}?alt=media&supportsAllDrives=true",
        ...googleAuth,
        options: { response: { response: { responseFormat: "file", outputPropertyName: "reference" } }, timeout: 60000 },
    });
    connect("Tries left?", "Download reference", 0);

    code("Result: stopped too often", [3960, 120], `const settings = $('Settings').first().json;
return [{ json: { status: "failed", reason: "the run stopped before the end " + settings.maxTries + " times" } }];`);
    connect("Tries left?", "Result: stopped too often", 1);

    // ---- 4. the painting pipeline (one reference) ------------------------------------------------------
    const X = 4180; // pipeline start
    code("Prepare", [X, -120], `// The queued image becomes the "reference" file, and the run gets its date+time stamp
const settings = $('Settings').first().json;
const next = $('Next reference').first().json;
const file = $input.first().binary && $input.first().binary.reference;
if (!file) throw new Error("Could not download the queued reference " + next.queueName);
const stamp = $now.setZone(settings.timezone).toFormat("yyyy-MM-dd_HH-mm-ss");
const referenceName = stamp + "_ref." + next.extension;
return [{
    json: {
        stamp,
        referenceName,
        artworkName: stamp + "_art.png",
        paletteName: stamp + "_palette.json",
    },
    binary: { reference: { ...file, fileName: referenceName } },
}];`);
    connect("Download reference", "Prepare");

    // No color instructions: the model paints the reference's own colors, and "Snap to palette" then picks the
    // 48 Darl'Art colors that fit the painting best. Palette lists in the prompt risk swatches painted into the image.
    code("Build image prompt", [X + 220, -120], `// A fixed prompt: the model sees the reference itself, so no scene description is needed
const imagePrompt = [
    "Repaint this image as a highly detailed digital painting in flat cel-shaded color, like a fine gouache or screen-print illustration made for a paint-by-numbers canvas.",
    "The output is a vertical canvas painting in a 4:5 ratio (60 x 75 cm). Recompose the scene to fit this frame naturally: keep every subject whole and in proportion, extend the surrounding scenery where the frame needs more room, and never stretch, squash or distort anything.",
    "Paint only the artwork itself: ignore any white or grey background, wall, shadow, frame or canvas edge around it in the reference.",
    "Keep everything from the artwork exactly: the same subjects, likeness, expressions, poses, objects and background, with realistic proportions.",
    "Keep the original colors of the image.",
    "Each area is painted in flat solid tones with crisp, clean, smooth edges, and shading is built from distinct flat tone steps.",
    "Preserve every fine detail: facial features, eyes, lips, fingers, hair strands, clothing folds, individual leaves, reflections, architecture.",
    "Smooth high-resolution shapes, not pixel art, no blocks, no mosaic, no gradients, no blur, no texture, no grain, no brush strokes, no outlines.",
    "The painting fills the entire image edge to edge. Do not add anything to the image: no color bar, no swatches, no palette, no legend, no labels, no text, no numbers, no border, no margin.",
].join("\\n");
return [{ json: { imagePrompt }, binary: $('Prepare').first().binary }];`);
    connect("Prepare", "Build image prompt");

    node("Generate ART", "n8n-nodes-base.httpRequest", 4.2, [X + 440, -120], {
        method: "POST",
        url: "https://api.openai.com/v1/images/edits",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "openAiApi",
        sendBody: true,
        contentType: "multipart-form-data",
        bodyParameters: {
            parameters: [
                { name: "model", value: "={{ $('Settings').first().json.imageModel }}" },
                { name: "prompt", value: "={{ $('Build image prompt').last().json.imagePrompt }}" },
                { name: "size", value: "={{ $('Settings').first().json.imageSize }}" },
                { name: "quality", value: "={{ $('Settings').first().json.imageQuality }}" },
                { name: "output_format", value: "png" },
                { name: "n", value: "1" },
                { parameterType: "formBinaryData", name: "image", inputDataFieldName: "reference" },
            ],
        },
        options: { timeout: 300000 },
    });
    connect("Build image prompt", "Generate ART");

    node("Raw artwork file", "n8n-nodes-base.convertToFile", 1.1, [X + 660, -120], {
        operation: "toBinary",
        sourceProperty: "data[0].b64_json",
        binaryPropertyName: "artwork",
        options: { fileName: "artwork.png", mimeType: "image/png" },
    });
    connect("Generate ART", "Raw artwork file");

    node("Check artwork", "@n8n/n8n-nodes-langchain.agent", 2.2, [X + 880, -120], {
        promptType: "define",
        text: "Check the attached image.\nclean = false if it contains ANY of these:\n- a color palette, color swatches, color chips, a color bar or strip, or a legend;\n- any text, letters, numbers, labels, logo, signature or watermark;\n- a border, frame, white margin, mockup, canvas edge or paper around the painting;\n- a pixel-art, blocky or mosaic look (visible square pixels or blocks).\nOtherwise clean = true. \"problems\" lists what you found, or is empty.",
        hasOutputParser: true,
        options: {
            systemMessage: "You check artwork files before they go to a paint-by-numbers production tool. You look at the image and report problems. Be strict.",
            passthroughBinaryImages: true,
        },
    });
    connect("Raw artwork file", "Check artwork");

    node("Checker model", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.2, [X + 840, 100], { model: { __rl: true, value: "gpt-5-mini", mode: "id" }, options: {} });
    connect("Checker model", "Check artwork", 0, "ai_languageModel");

    node("Check format", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.2, [X + 1020, 100], {
        schemaType: "manual",
        inputSchema: JSON.stringify({ type: "object", properties: { clean: { type: "boolean" }, problems: { type: "string" } }, required: ["clean", "problems"] }, null, 2),
    });
    connect("Check format", "Check artwork", 0, "ai_outputParser");

    ifNode("Artwork clean?", [X + 1200, -120], "={{ $json.output.clean }}");
    connect("Check artwork", "Artwork clean?");

    code("Count attempts", [X + 1420, 80], `// A problem was found in the artwork: paint again, at most MAX_ATTEMPTS images in all
const MAX_ATTEMPTS = 3;
const attempt = $runIndex + 2; // this node runs after attempt 1, 2...
return [{
    json: { retry: attempt <= MAX_ATTEMPTS, attempt, problems: $json.output ? $json.output.problems : "" },
    binary: $('Prepare').first().binary,
}];`);
    connect("Artwork clean?", "Count attempts", 1);
    ifNode("Paint again?", [X + 1640, 80], "={{ $json.retry }}");
    connect("Count attempts", "Paint again?");
    connect("Paint again?", "Generate ART", 0);

    code("Result: not painted", [X + 1860, 180], `// 3 paintings, none clean: the reference is set aside in Artwork Ref/Failed
const last = $('Count attempts').last().json;
return [{ json: { status: "failed", reason: "not painted cleanly in 3 tries" + (last.problems ? " (" + last.problems + ")" : "") } }];`);
    connect("Paint again?", "Result: not painted", 1);

    // ---- strict palette ---------------------------------------------------------------------------------
    code("Approved artwork", [X + 1420, -320], `// The checker (AI Agent) only outputs its verdict: take the approved image from the latest paint attempt
return [{ json: {}, binary: { artwork: $('Raw artwork file').last().binary.artwork } }];`);
    connect("Artwork clean?", "Approved artwork", 0);

    node("Snap to palette (48 colors)", "n8n-nodes-base.httpRequest", 4.2, [X + 1640, -320], {
        method: "POST",
        url: "={{ $('Settings').first().json.pbnApiUrl }}/v1/recolor",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        contentType: "multipart-form-data",
        bodyParameters: {
            parameters: [
                { name: "colors", value: "={{ $('Settings').first().json.colors }}" },
                { name: "palette", value: "={{ $('Settings').first().json.paletteId }}" },
                { name: "exclude", value: "={{ $('Settings').first().json.exclude }}" },
                { name: "smooth", value: "3" },
                // the final artwork always has the exact canvas ratio (cropped, never stretched)
                { name: "canvasSize", value: "={{ $('Settings').first().json.canvasSize }}" },
                { name: "orientation", value: "={{ $('Settings').first().json.orientation }}" },
                { parameterType: "formBinaryData", name: "image", inputDataFieldName: "artwork" },
            ],
        },
        options: { timeout: 180000 },
    });
    connect("Approved artwork", "Snap to palette (48 colors)");

    code("Check palette", [X + 1860, -320], `// Every pixel of the final artwork is a Darl'Art color: check the count and the codes before saving
const PALETTE = ${JSON.stringify(codeToHex)};
const settings = $('Settings').first().json;
const result = $input.first().json;
const colors = result.colors || [];
const bad = colors.filter((c) => PALETTE[c.code] !== c.hex);
if (bad.length) throw new Error("Colors outside the Darl'Art palette: " + bad.map((c) => c.code + " " + c.hex).join(", "));
if (colors.length !== Number(settings.colors)) throw new Error("The artwork has " + colors.length + " colors instead of " + settings.colors);
const prepared = $('Prepare').first().json;
const paletteJson = {
    artwork: prepared.artworkName,
    reference: prepared.referenceName,
    palette: settings.paletteId,
    colorCount: colors.length,
    width: result.width,
    height: result.height,
    colors: colors.map((c) => ({ code: c.code, hex: c.hex, rgb: c.rgb, percent: c.percent })),
};
return [{ json: { image: result.image, paletteJson } }];`);
    connect("Snap to palette (48 colors)", "Check palette");

    node("Artwork file", "n8n-nodes-base.convertToFile", 1.1, [X + 2080, -320], {
        operation: "toBinary",
        sourceProperty: "image",
        binaryPropertyName: "artwork",
        options: { fileName: "={{ $('Prepare').first().json.artworkName }}", mimeType: "image/png" },
    });
    connect("Check palette", "Artwork file");

    // ---- Drive folder Artwork Agent/1xxx ------------------------------------------------------------------
    driveList("List Artwork Agent folders", [X + 2300, -320], "='{{ $('Settings').first().json.agentFolderId }}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false", "files(id,name)");
    connect("Artwork file", "List Artwork Agent folders");

    code("Next folder number", [X + 2520, -320], `// The new folder is the next free number: 1001, 1002, ... (folders with other names are ignored)
const first = Number($('Settings').first().json.firstFolderNumber) || 1001;
const numbers = (($input.first().json.files) || []).map((f) => String(f.name).trim()).filter((n) => /^\\d+$/.test(n)).map(Number);
const next = numbers.length ? Math.max(first - 1, ...numbers) + 1 : first;
return [{ json: { folderName: String(next) } }];`);
    connect("List Artwork Agent folders", "Next folder number");

    node("Create folder (Artwork Agent/1xxx)", "n8n-nodes-base.googleDrive", 3, [X + 2740, -320], {
        resource: "folder",
        name: "={{ $json.folderName }}",
        driveId: drive,
        folderId: byId("={{ $('Settings').first().json.agentFolderId }}"),
        options: {},
    });
    connect("Next folder number", "Create folder (Artwork Agent/1xxx)");

    code("Files for the folder", [X + 2960, -320], `// Artwork Ref + Artwork Gen (+ the palette JSON), one item per file
const folderId = $input.first().json.id;
const prepared = $('Prepare').first();
const paletteJson = $('Check palette').first().json.paletteJson;
return [
    { json: { folderId, name: prepared.json.referenceName }, binary: { data: prepared.binary.reference } },
    { json: { folderId, name: prepared.json.artworkName }, binary: { data: $('Artwork file').first().binary.artwork } },
    {
        json: { folderId, name: prepared.json.paletteName },
        binary: { data: { data: Buffer.from(JSON.stringify(paletteJson, null, 2)).toString("base64"), mimeType: "application/json", fileName: prepared.json.paletteName } },
    },
];`);
    connect("Create folder (Artwork Agent/1xxx)", "Files for the folder");

    node("Upload to folder", "n8n-nodes-base.googleDrive", 3, [X + 3180, -320], {
        name: "={{ $json.name }}",
        driveId: drive,
        folderId: byId("={{ $json.folderId }}"),
        inputDataFieldName: "data",
        options: {},
    });
    connect("Files for the folder", "Upload to folder");

    // product texts, then print files and mockup: started without waiting, an error there can't fail this run
    runWorkflow("Run Titling Agent", [X + 3400, -480], SETTINGS_TITLING_WORKFLOW_ID);
    connect("Upload to folder", "Run Titling Agent");
    runWorkflow("Run Print Agent", [X + 3620, -480], SETTINGS_PRINT_WORKFLOW_ID);
    connect("Upload to folder", "Run Print Agent");

    code("Result: painted", [X + 3400, -320], `const folder = $('Create folder (Artwork Agent/1xxx)').first().json;
return [{ json: { status: "done", folder: folder.name, folderId: folder.id, referenceName: $('Prepare').first().json.referenceName } }];`, { executeOnce: true });
    connect("Upload to folder", "Result: painted");

    // ---- 5. record the result, move the reference out of the queue ----------------------------------------
    const Y = X + 3620;
    code("Update entry", [Y, 0], `// The manifest records what became of the reference; the batch is painted once nothing of it is queued
const settings = $('Settings').first().json;
const next = $('Next reference').first().json;
const result = $input.first().json;
const manifest = $('Start attempt').first().json.manifest;
const now = $now.setZone(settings.timezone).toISO();
let painted = false;
if (manifest && Array.isArray(manifest.files)) {
    const entry = manifest.files.find((e) => e.queueName === next.queueName);
    if (entry) Object.assign(entry, { status: result.status, reason: result.reason || "", folder: result.folder || "", folderId: result.folderId || "", finishedAt: now });
    painted = manifest.files.every((e) => e.status !== "queued");
    if (painted) Object.assign(manifest, { paintedAt: now, notified: false });
}
// a painted reference goes to Artwork Ref under its new name, a failed one to Artwork Ref/Failed as it is
const move = result.status === "done"
    ? { to: settings.refFolderId, name: result.referenceName }
    : { to: settings.failedFolderId, name: next.queueName };
const out = { json: { status: result.status, folder: result.folder || "", painted, hasManifest: !!manifest, move, manifest } };
if (manifest) out.binary = { manifest: { data: Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64"), mimeType: "application/json", fileName: next.batchId + "_batch.json" } };
return [out];`);
    for (const result of ["Result: painted", "Result: not painted", "Result: stopped too often"]) { connect(result, "Update entry"); }

    // ---- Telegram: the painted artwork with its product number, or why the reference was set aside ----------------
    ifNode("Telegram on?", [Y + 220, 360], telegramOn);
    connect("Update entry", "Telegram on?");
    code("Artwork message", [Y + 440, 360], `// The artwork (a photo with its product number) or, when it could not be painted, the reason
const next = $('Next reference').first().json;
const entryResult = $('Update entry').first().json;
const manifest = $('Start attempt').first().json.manifest;
const originalName = $('Start attempt').first().json.originalName;
let position = "";
if (manifest && Array.isArray(manifest.files)) {
    const i = manifest.files.findIndex((e) => e.queueName === next.queueName);
    if (i >= 0) position = ", " + (i + 1) + " of " + manifest.files.length;
}
const from = "From: " + originalName + " (batch " + next.batchId + position + ")";
if (entryResult.status === "done") {
    const folder = $('Create folder (Artwork Agent/1xxx)').first().json;
    const colors = $('Check palette').first().json.paletteJson.colorCount;
    const caption = [
        "Artwork " + folder.name + " painted, " + colors + " Darl'Art colors",
        from,
        "Next: product texts, print files and mockup, then the Shopify draft.",
        "https://drive.google.com/drive/folders/" + folder.id,
    ].join("\\n");
    return [{ json: { painted: true, caption }, binary: { data: $('Artwork file').first().binary.artwork } }];
}
const reason = $('Result: not painted').isExecuted ? $('Result: not painted').first().json.reason : $('Result: stopped too often').isExecuted ? $('Result: stopped too often').first().json.reason : "";
return [{ json: { painted: false, text: ["Not painted: " + originalName, from, "Reason: " + reason, "The reference is in Artwork Ref/Failed."].join("\\n") } }];`);
    connect("Telegram on?", "Artwork message", 0);
    ifNode("Painted?", [Y + 660, 360], "={{ $json.painted }}");
    connect("Artwork message", "Painted?");
    telegramPhoto("Telegram: artwork", [Y + 880, 280], "={{ $json.caption }}");
    connect("Painted?", "Telegram: artwork", 0);
    telegramText("Telegram: not painted", [Y + 880, 440], "={{ $json.text }}");
    connect("Painted?", "Telegram: not painted", 1);

    ifNode("Record the result?", [Y + 220, 0], "={{ $json.hasManifest }}");
    connect("Update entry", "Record the result?");
    saveManifest("Save manifest (result)", [Y + 440, -80]);
    connect("Record the result?", "Save manifest (result)", 0);

    moveFile("Move reference out of the queue", [Y + 660, 0],
        "$('Next reference').first().json.fileId",
        "$('Update entry').first().json.move.to",
        "$('Settings').first().json.queueFolderId",
        "={{ JSON.stringify({ name: $('Update entry').first().json.move.name }) }}");
    connect("Save manifest (result)", "Move reference out of the queue");
    connect("Record the result?", "Move reference out of the queue", 1);

    ifNode("Batch painted?", [Y + 880, 0], "={{ $('Update entry').first().json.painted }}");
    connect("Move reference out of the queue", "Batch painted?");
    // the Shopify Uploader reads Queue/Done to send one Telegram message per batch once its drafts are in Shopify
    moveFile("Move manifest to Done", [Y + 1100, -80],
        "$('Next reference').first().json.manifestId",
        "$('Settings').first().json.doneFolderId",
        "$('Settings').first().json.queueFolderId",
        "={{ JSON.stringify({}) }}");
    connect("Batch painted?", "Move manifest to Done", 0);

    // the whole batch is painted: a summary (the Shopify Uploader reports again once all its drafts are in Shopify)
    ifNode("Telegram on? (batch)", [Y + 1100, -240], telegramOn);
    connect("Batch painted?", "Telegram on? (batch)", 0);
    code("Batch message", [Y + 1320, -240], `const next = $('Next reference').first().json;
const manifest = $('Update entry').first().json.manifest;
const done = manifest.files.filter((e) => e.status === "done");
const failed = manifest.files.filter((e) => e.status === "failed");
const lines = ["Batch " + next.batchId + " painted: " + done.length + " artwork" + (done.length === 1 ? "" : "s") + (done.length ? " (" + done.map((e) => e.folder).join(", ") + ")" : "")];
if (failed.length) {
    lines.push("", failed.length + " not painted:");
    for (const e of failed) lines.push("- " + e.originalName + ": " + (e.reason || "failed"));
}
if (done.length) lines.push("", "You get one more message when all their drafts are in Shopify.");
return [{ json: { text: lines.join("\\n") } }];`);
    connect("Telegram on? (batch)", "Batch message", 0);
    telegramText("Telegram: batch painted", [Y + 1540, -240], "={{ $json.text }}");
    connect("Batch message", "Telegram: batch painted");

    // ---- 6. release the lock, start again while references are queued ---------------------------------------
    code("Locks to delete", [Y + 1320, 160], `// My lock, plus locks left behind by crashed runs
const processed = $('Next reference').isExecuted && !$('Next reference').first().json.none;
const ids = [$('Won the lock?').first().json.lockId, ...$('Lock state').first().json.stale];
return ids.map((id) => ({ json: { id, processed } }));`);
    connect("Move manifest to Done", "Locks to delete");
    connect("Batch painted?", "Locks to delete", 1);
    connect("Anything queued?", "Locks to delete", 1);

    node("Release lock", "n8n-nodes-base.httpRequest", 4.2, [Y + 1540, 160], {
        method: "DELETE",
        url: `=${driveFiles}/{{ $json.id }}?supportsAllDrives=true`,
        ...googleAuth,
        options: { timeout: 30000 },
    }, { onError: "continueRegularOutput" });
    connect("Locks to delete", "Release lock");

    // references may have been queued while this run worked: a run that painted one starts the next
    // (which finds an empty queue and stops, when all is done)
    ifNode("Start again?", [Y + 1760, 160], "={{ $('Locks to delete').first().json.processed }}");
    connect("Release lock", "Start again?");
    node("Start next run", "n8n-nodes-base.executeWorkflow", 1.2, [Y + 1980, 80], {
        source: "database",
        workflowId: { __rl: true, mode: "id", value: "={{ $workflow.id }}" },
        mode: "once",
        options: { waitForSubWorkflow: false },
    }, { executeOnce: true, onError: "continueRegularOutput" });
    connect("Start again?", "Start next run", 0);

    // "Start again?" runs once per released lock otherwise
    nodes.find((n) => n.name === "Start again?").executeOnce = true;

    save("automation/n8n-darlart-artwork-worker.json", "Darl'Art Artwork Worker");
}

console.log(codes.length + " palette colors in Check palette");
