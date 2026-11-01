/** Durable accepted-job IDs, stored as Drive metadata under the existing Print lock. */
function attachPrintCheckpoints(workflow, { before, codeNode, idFor }) {
    const get = name => workflow.nodes.find(n => n.name === name);
    const find = structuredClone(get('Find print report'));
    find.name = 'Find PBN checkpoint'; find.id = idFor(find.name);
    find.position = [3800, -700];
    find.parameters.queryParameters.parameters.find(p => p.name === 'q').value = "='{{ $('Settings').first().json.agentFolderId }}' in parents and name = '_pbn-jobs-{{ $('Settings').first().json.family }}.json' and trashed = false";
    before(workflow, 'Plan jobs', find);
    const identity = `const key = j => [j.folderId, j.artworkId, j.size, j.colors, settings.family, settings.profileVersion, settings.difficulty, settings.palette, settings.cropMode].join('|');`;
    get('Plan jobs').parameters.jsCode = get('Plan jobs').parameters.jsCode.replace('return jobs.length ? jobs :', `
const checkpoint = ($('Find PBN checkpoint').first().json.files || [])[0];
let records = {};
if (checkpoint && checkpoint.description) {
    try { records = JSON.parse(checkpoint.description).records || {}; }
    catch { throw new Error('PBN checkpoint is malformed; refusing to submit duplicate jobs'); }
}
${identity}
for (const item of jobs) {
    const old = records[key(item.json)];
    if (old && old.jobId && ['sent', 'completed'].includes(old.status)) item.json.resumeJobId = old.jobId;
}
return jobs.length ? jobs :`);
    get('Job round').parameters.jsCode = get('Job round').parameters.jsCode.replace(
        'jobId: "", status: "pending", error: "", sentAt: 0,',
        'jobId: item.json.resumeJobId || "", status: item.json.resumeJobId ? "sent" : "pending", error: "", sentAt: item.json.resumeJobId ? Date.now() : 0,');
    // A polling budget is not a failed generation. Finish this execution, retain
    // the accepted ID, and let Watchdog poll that same job on the next run.
    get('Jobs checked').parameters.jsCode = get('Jobs checked').parameters.jsCode.replace(
        'status: "failed", error: "no result "', 'status: "deferred", error: "Polling deferred: no result "')
        .replace('j.status === "sent" || j.status === "failed"', 'j.status === "sent" || j.status === "failed" || j.status === "deferred"');
    for (const [source, target, suffix] of [['Jobs sent', 'Jobs running?', 'accepted'], ['Jobs checked', 'Files to download', 'polled']]) {
        const prepareName = 'Checkpoint ' + suffix + ' jobs';
        const storeName = 'Save ' + suffix + ' PBN checkpoint';
        const restoreName = 'Continue ' + suffix + ' jobs';
        const prepare = codeNode(prepareName, `const state = $input.first().json;
const settings = $('Settings').first().json;
const file = ($('Find PBN checkpoint').first().json.files || [])[0] || {};
let records = {};
if (file.description) records = JSON.parse(file.description).records || {};
${identity}
for (const j of state.jobs || []) if (j.jobId) records[key(j)] = { jobId: j.jobId, status: j.status === 'deferred' ? 'sent' : j.status, updatedAt: Date.now() };
records = Object.fromEntries(Object.entries(records).sort((a,b) => b[1].updatedAt - a[1].updatedAt).slice(0, 100));
const description = JSON.stringify({ version: 1, family: settings.family, records });
if (description.length > 30000) throw new Error('PBN checkpoint exceeds metadata budget');
let checkpointId = file.id || '';
for (const name of ['Save accepted PBN checkpoint', 'Save polled PBN checkpoint']) {
    if ($(name).isExecuted && $(name).last().json.id) checkpointId = $(name).last().json.id;
}
return [{ json: { checkpointId, description } }];`, [5000, -700]);
        const store = structuredClone(get('Store print report'));
        store.name = storeName; store.id = idFor(storeName); store.position = [5220, -700];
        store.parameters.method = "={{ $json.checkpointId ? 'PATCH' : 'POST' }}";
        store.parameters.url = "={{ 'https://www.googleapis.com/drive/v3/files' + ($json.checkpointId ? '/' + $json.checkpointId : '') + '?supportsAllDrives=true&fields=id' }}";
        store.parameters.jsonBody = "={{ JSON.stringify($json.checkpointId ? { description: $json.description } : { name: '_pbn-jobs-' + $('Settings').first().json.family + '.json', mimeType: 'application/json', parents: [$('Settings').first().json.agentFolderId], description: $json.description }) }}";
        delete store.onError; // Never continue polling without saving the accepted ID.
        store.retryOnFail = true; store.maxTries = 3; store.waitBetweenTries = 5000;
        const restore = codeNode(restoreName, 'return $("' + source + '").all();', [5440, -700]);
        workflow.nodes.push(prepare, store, restore);
        workflow.connections[source] = { main: [[{ node: prepareName, type: 'main', index: 0 }]] };
        workflow.connections[prepareName] = { main: [[{ node: storeName, type: 'main', index: 0 }]] };
        workflow.connections[storeName] = { main: [[{ node: restoreName, type: 'main', index: 0 }]] };
        workflow.connections[restoreName] = { main: [[{ node: target, type: 'main', index: 0 }]] };
    }
}
module.exports = { attachPrintCheckpoints };
