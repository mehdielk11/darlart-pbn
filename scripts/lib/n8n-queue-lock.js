/**
 * One-run-at-a-time queue lock for the n8n workflow generators (scripts/build-*-workflow.js), the same scheme as the
 * Print Agent and the Artwork Worker:
 *
 *   List locks -> Lock free? -> Create lock "<prefix>-<execution id>" -> List locks again -> Won the lock?
 *     - won: the caller connects "Lock won?" (output 0) to its work
 *     - busy, or lost a tie: wait retrySeconds and try again, up to retries times, then stop (the run holding the lock
 *       did real work if it is still busy after that, and it starts itself again when it is done)
 *   release(): my lock + stale locks deleted, then the workflow starts itself again when the run did something
 *
 * A lock not refreshed for staleMinutes belongs to a crashed run and is removed; heartbeat() refreshes it. The
 * "Darl'Art Error Handler" workflow deletes the lock of a failed run at once (the lock name ends with its execution id).
 */
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const googleAuth = { authentication: "predefinedCredentialType", nodeCredentialType: "googleDriveOAuth2Api" };

function queueLock({ node, connect }, { prefix, folderExpression, staleMinutes, retries = 3, retrySeconds = 30, x = 0, y = 0 }) {
    const lockQuery = `='{{ ${folderExpression} }}' in parents and name contains '${prefix}' and trashed = false`;
    const list = (name, position) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
        url: DRIVE_FILES,
        ...googleAuth,
        sendQuery: true,
        queryParameters: {
            parameters: [
                { name: "q", value: lockQuery },
                { name: "fields", value: "files(id,name,createdTime,modifiedTime)" },
                { name: "pageSize", value: "1000" },
                { name: "supportsAllDrives", value: "true" },
                { name: "includeItemsFromAllDrives", value: "true" },
            ],
        },
        options: { timeout: 30000 },
    });
    const ifTrue = (name, position, left, extra) => node(name, "n8n-nodes-base.if", 2, position, {
        conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
            conditions: [{ id: name.replace(/\W/g, ""), leftValue: left, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
            combinator: "and",
        },
        options: {},
    }, extra);
    const code = (name, position, jsCode, extra) => node(name, "n8n-nodes-base.code", 2, position, { jsCode }, extra);
    const del = (name, position, idExpression) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
        method: "DELETE",
        url: `=${DRIVE_FILES}/{{ ${idExpression} }}?supportsAllDrives=true`,
        ...googleAuth,
        options: { timeout: 30000 },
    }, { onError: "continueRegularOutput" });

    list("List locks", [x, y]);
    code("Lock state", [x + 220, y], `// Another run holds a fresh lock (refreshed less than ${staleMinutes} min ago)
const limit = Date.now() - ${staleMinutes} * 60000;
const locks = $input.first().json.files || [];
const fresh = locks.filter((l) => new Date(l.modifiedTime || l.createdTime).getTime() > limit);
const stale = locks.filter((l) => !fresh.includes(l)).map((l) => l.id);
return [{ json: { free: fresh.length === 0, fresh: fresh.length, stale } }];`);
    connect("List locks", "Lock state");
    ifTrue("Lock free?", [x + 440, y], "={{ $json.free }}");
    connect("Lock state", "Lock free?");

    node("Create lock", "n8n-nodes-base.httpRequest", 4.2, [x + 660, y - 80], {
        method: "POST",
        url: `${DRIVE_FILES}?supportsAllDrives=true&fields=id,name,createdTime`,
        ...googleAuth,
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={{ JSON.stringify({ name: '${prefix}-' + $execution.id, mimeType: 'text/plain', parents: [${folderExpression}] }) }}`,
        options: { timeout: 30000 },
    });
    connect("Lock free?", "Create lock", 0);
    list("List locks again", [x + 880, y - 80]);
    connect("Create lock", "List locks again");
    code("Won the lock?", [x + 1100, y - 80], `// Two runs can create a lock at the same moment: the oldest fresh lock wins, the other run steps back
const mine = $('Create lock').last().json;
const limit = Date.now() - ${staleMinutes} * 60000;
const fresh = ($input.first().json.files || [])
    .filter((l) => l.id === mine.id || new Date(l.modifiedTime || l.createdTime).getTime() > limit)
    .sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1));
return [{ json: { won: fresh.length > 0 && fresh[0].id === mine.id, lockId: mine.id } }];`);
    connect("List locks again", "Won the lock?");
    ifTrue("Lock won?", [x + 1320, y - 80], "={{ $json.won }}");
    connect("Won the lock?", "Lock won?");
    del("Step back (drop my lock)", [x + 1540, y + 60], "$json.lockId");
    connect("Lock won?", "Step back (drop my lock)", 1);

    // busy: try again a little later (a run about to finish with nothing done does not start itself again)
    code("Busy: try again?", [x + 660, y + 180], `const attempt = $runIndex + 1;
return [{ json: { retry: attempt <= ${retries}, attempt } }];`);
    connect("Lock free?", "Busy: try again?", 1);
    connect("Step back (drop my lock)", "Busy: try again?");
    ifTrue("Retry?", [x + 880, y + 180], "={{ $json.retry }}");
    connect("Busy: try again?", "Retry?");
    node("Wait before retry", "n8n-nodes-base.wait", 1.1, [x + 1100, y + 280], { resume: "timeInterval", amount: retrySeconds, unit: "seconds" });
    connect("Retry?", "Wait before retry", 0);
    connect("Wait before retry", "List locks");
    node("Busy: another run is working", "n8n-nodes-base.noOp", 1, [x + 1100, y + 120], {});
    connect("Retry?", "Busy: another run is working", 1);

    return {
        // refreshes the lock while a long run works (a stale lock would let another run in)
        heartbeat(name, position) {
            node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
                method: "PATCH",
                url: `=${DRIVE_FILES}/{{ $('Won the lock?').first().json.lockId }}?supportsAllDrives=true&fields=id,modifiedTime`,
                ...googleAuth,
                sendBody: true,
                specifyBody: "json",
                jsonBody: "={{ JSON.stringify({ modifiedTime: $now.toUTC().toISO() }) }}",
                options: { timeout: 30000 },
            }, { onError: "continueRegularOutput", executeOnce: true });
        },
        // my lock and the stale ones deleted; the workflow starts itself again when processedExpression is true
        release(position, processedExpression) {
            const [rx, ry] = position;
            code("Locks to delete", [rx, ry], `// My lock, plus locks left behind by crashed runs
const processed = ${processedExpression};
const ids = [$('Won the lock?').first().json.lockId, ...$('Lock state').first().json.stale];
return ids.map((id) => ({ json: { id, processed: !!processed } }));`, { executeOnce: true });
            del("Release lock", [rx + 220, ry], "$json.id");
            connect("Locks to delete", "Release lock");
            ifTrue("Start again?", [rx + 440, ry], "={{ $('Locks to delete').first().json.processed }}", { executeOnce: true });
            connect("Release lock", "Start again?");
            node("Start next run", "n8n-nodes-base.executeWorkflow", 1.2, [rx + 660, ry - 80], {
                source: "database",
                workflowId: { __rl: true, mode: "id", value: "={{ $workflow.id }}" },
                mode: "once",
                options: { waitForSubWorkflow: false },
            }, { executeOnce: true, onError: "continueRegularOutput" });
            connect("Start again?", "Start next run", 0);
            return "Locks to delete";
        },
    };
}

module.exports = { queueLock };
