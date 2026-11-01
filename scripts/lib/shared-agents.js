const crypto = require('crypto');
const { validateKidsConfig, embeddedHelpers } = require('./product-profiles');
const idFor = name => crypto.createHash('sha256').update('shared-profiles:' + name).digest('hex').slice(0, 32);
const codeNode = (name, code, position = [-300, 0]) => ({ id: idFor(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { jsCode: code } });
const ifNode = (name, expression, position = [0, 0]) => ({ id: idFor(name), name, type: 'n8n-nodes-base.if', typeVersion: 2, position,
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: idFor(name + ':condition'), leftValue: expression, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const edgeTo = node => ({ node, type: 'main', index: 0 });

function notificationRetries(workflow) {
    for (const n of workflow.nodes.filter(n => n.type.endsWith('.telegram'))) {
        n.retryOnFail = true; n.maxTries = 3; n.waitBetweenTries = 5000;
    }
}

function before(workflow, target, node) {
    if (workflow.nodes.some(n => n.name === node.name)) throw new Error('Duplicate adapter node: ' + node.name);
    for (const outputs of Object.values(workflow.connections)) for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) if (edge.node === target) edge.node = node.name;
    workflow.nodes.push(node);
    workflow.connections[node.name] = { main: [[{ node: target, type: 'main', index: 0 }]] };
}

function mapStrings(value, fn) {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map(v => mapStrings(v, fn));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
    return value;
}

function adaptCommon(source, rawConfig) {
    const workflow = structuredClone(source);
    const config = validateKidsConfig(rawConfig);
    const get = name => workflow.nodes.find(n => n.name === name);
    const settings = get('Settings');
    const assignments = settings?.parameters.assignments?.assignments;
    if (!assignments) throw new Error('Missing baseline Settings: ' + source.name);
    const base = Object.fromEntries(assignments.map(a => [a.name, a.value]));
    settings.type = 'n8n-nodes-base.code'; settings.typeVersion = 2;
    settings.parameters = { jsCode: embeddedHelpers() + '\nconst base = ' + JSON.stringify(base) + ';\nconst config = ' + JSON.stringify(config) + ';\nreturn [{ json: resolveStageSettings(base, $input.first().json || {}, config) }];' };
    // Calls execute one family at a time. A scan is strictly family-filtered, so
    // Classic settings cannot be applied to a mixed list of Kids folders.
    const folders = get('Folders');
    if (folders) folders.parameters.jsCode = embeddedHelpers() + `
const family = $('Settings').first().json.family;
const expectedSize = ${JSON.stringify(config.canvasSize)};
const expectedColors = ${JSON.stringify(String(config.colors))};
const files = $input.first().json.files || [];
const folders = files.filter(f => /^\\d+$/.test(String(f.name).trim()))
    .filter(f => { const c = folderContext(f); return c.eligible && c.family === family; })
    .filter(f => family !== 'kids' || ((f.appProperties || {}).darlart_size === expectedSize && (f.appProperties || {}).darlart_colors === expectedColors))
    .sort((a,b) => Number(a.name) - Number(b.name));
return folders.length ? folders.map(f => ({ json: { id: f.id, name: String(f.name).trim(), family } })) : [{ json: { none: true } }];`;
    for (const n of [...workflow.nodes]) if (n.type.endsWith('.executeWorkflow')) {
        before(workflow, n.name, codeNode('Context for ' + n.name,
            'return $input.all().map((item, index) => ({ json: { ...item.json, family: $("Settings").first().json.family, mode: item.json.mode || "run" }, pairedItem: { item: index } }));', [n.position[0] - 110, n.position[1]]));
        n.parameters.source = 'database'; n.parameters.mode ||= 'once';
    }
    // Explicit invocation context is accepted through the existing trigger.
    let trigger = workflow.nodes.find(n => n.type.endsWith('.executeWorkflowTrigger'));
    if (!trigger) {
        trigger = { id: idFor('When called'), name: 'When called', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [-700, 400], parameters: { inputSource: 'passthrough' } };
        workflow.nodes.push(trigger);
        workflow.connections[trigger.name] = { main: [[{ node: 'Settings', type: 'main', index: 0 }]] };
    }
    trigger.parameters = { inputSource: 'passthrough' };
    // Existing schedules/manual entry run both profiles; subworkflow calls run
    // only the explicit family. This is bounded dispatch, not recursive polling.
    const dispatchName = 'Dispatch product families';
    workflow.nodes.push(codeNode(dispatchName, 'return [{ json: { family: "classic" } }, { json: { family: "kids" } }];', [-700, -200]));
    const invokeName = 'Run shared family stage';
    workflow.nodes.push({ id: idFor(invokeName), name: invokeName, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [-450, -200], parameters: {
        source: 'database', workflowId: { __rl: true, mode: 'id', value: '={{ $workflow.id }}' }, mode: 'each', options: { waitForSubWorkflow: false },
    } });
    workflow.connections[dispatchName] = { main: [[{ node: invokeName, type: 'main', index: 0 }]] };
    for (const n of workflow.nodes.filter(n => n.type.endsWith('.manualTrigger') || n.type.endsWith('.scheduleTrigger'))) {
        workflow.connections[n.name] = { main: [[{ node: dispatchName, type: 'main', index: 0 }]] };
    }
    // The shared stage uses a single existing lock, with family in its metadata.
    const lock = get('Create lock');
    if (lock?.parameters.jsonBody) lock.parameters.jsonBody = lock.parameters.jsonBody.replace(/description: ([\s\S]*?) \}\)/,
        'description: ($1) + ";family=" + $("Settings").first().json.family })');
    const failureLookup = get('Find failure marker');
    if (failureLookup) failureLookup.parameters = mapStrings(failureLookup.parameters, s => s.replace(/_failed-([a-z]+)/g, '_failed-{{ $("Settings").first().json.family === "kids" ? "kids-" : "" }}$1'));
    const failureWrite = get('Mark the failure');
    if (failureWrite?.parameters.jsonBody) failureWrite.parameters.jsonBody = failureWrite.parameters.jsonBody.replace(/name: '_failed-([a-z]+)'/g,
        'name: "_failed-" + ($("Settings").first().json.family === "kids" ? "kids-" : "") + "$1"');
    workflow.settings = { ...source.settings, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveManualExecutions: true };
    workflow.active = false;
    notificationRetries(workflow);
    delete workflow.versionId; delete workflow.activeVersionId; delete workflow.pinData;
    return { workflow, config, base, get };
}

function adaptWorker(source, config) {
    const a = adaptCommon(source, config), { workflow, get, base } = a;
    for (const name of ['List locks', 'List locks again', 'Create lock']) {
        const n = get(name);
        n.parameters = mapStrings(n.parameters, s => s.replaceAll("$('Settings').first().json.queueFolderId", JSON.stringify(base.queueFolderId)));
    }
    get('Next reference').parameters.jsCode = embeddedHelpers() + `
const files = $input.first().json.files || [];
const images = files.filter(f => parseQueueName(f.name)).sort((a,b) => a.name.localeCompare(b.name));
if (!images.length) return [{ json: { none: true } }];
const image = images[0], parsed = parseQueueName(image.name);
const manifest = files.find(f => f.name === parsed.batchId + '_batch.json');
if (!manifest) throw new Error('Queued reference has no durable batch manifest');
return [{ json: { none: false, fileId: image.id, queueName: image.name, extension: parsed.extension,
    batchId: parsed.batchId, manifestId: manifest.id, remaining: images.length - 1 } }];`;
    get('Leftover manifests').parameters.jsCode = `const files = $('List queue').first().json.files || [];
const manifests = files.filter(f => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?_batch[.]json$/.test(f.name));
return manifests.length ? manifests.map(f => ({ json: { manifestId: f.id, name: f.name } })) : [{ json: { none: true } }];`;
    const create = get('Create folder (Artwork Agent/1xxx)');
    const driveCredential = create.credentials;
    create.type = 'n8n-nodes-base.httpRequest'; create.typeVersion = 4.2;
    create.credentials = driveCredential;
    create.parameters = { method: 'POST', url: 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,appProperties', authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api', sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ name: $json.folderName, mimeType: 'application/vnd.google-apps.folder', parents: [$('Settings').first().json.agentFolderId], appProperties: { darlart_family: $('Settings').first().json.family, darlart_state: 'active', darlart_profile: $('Settings').first().json.profileVersion, darlart_size: $('Settings').first().json.canvasSize, darlart_colors: String($('Settings').first().json.colors) } }) }}`, options: { timeout: 30000 } };
    const prompt = get('Build image prompt');
    const start = prompt.parameters.jsCode.indexOf('const frame =');
    const end = prompt.parameters.jsCode.indexOf('const imagePrompt =', start);
    if (start < 0 || end < 0) throw new Error('Unknown artwork prompt schema');
    prompt.parameters.jsCode = prompt.parameters.jsCode.slice(0, start) + `const physical = String(settings.canvasSize).split('x').map(Number);
const portraitSize = Math.min(...physical) + ' x ' + Math.max(...physical);
const landscapeSize = Math.max(...physical) + ' x ' + Math.min(...physical);
const frame = orientation === 'landscape'
    ? 'The output is a horizontal canvas painting in a 5:4 ratio (' + landscapeSize + ' cm), wider than tall.'
    : 'The output is a vertical canvas painting in a 4:5 ratio (' + portraitSize + ' cm), taller than wide.';
` + prompt.parameters.jsCode.slice(end);
    before(workflow, 'Start attempt', codeNode('Validate batch family', `const manifest = $input.first().json;
const family = $('Settings').first().json.family;
if (manifest.family && manifest.family !== family) throw new Error('Batch family does not match its queue');
return $input.all();`, [700, 0]));
    return workflow;
}

function adaptTitling(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    const build = get('Build product JSON');
    build.parameters.jsCode = build.parameters.jsCode.replace('kids: false', 'kids: settings.family === "kids"')
        .replace('clean !== "kids-kits" && ', '(clean !== "kids-kits" || kids) && ')
        .replace('const difficulty = kids ?', 'const difficulty = false ?');
    return workflow;
}

function adaptPrint(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    const original = get('Create pbn job');
    const kids = structuredClone(original);
    kids.name = 'Create Kids pbn job'; kids.id = idFor(kids.name);
    kids.position = [original.position[0], original.position[1] - 220];
    kids.parameters.bodyParameters.parameters.push(
        { name: 'requireExactColors', value: 'true' }, { name: 'physicalSvg', value: 'true' },
        { name: 'paintCanvasSizes', value: "={{ $('Settings').first().json.canvasSizes }}" }
    );
    const gate = { id: idFor('Kids print profile?'), name: 'Kids print profile?', type: 'n8n-nodes-base.if', typeVersion: 2,
        position: [original.position[0] - 230, original.position[1]], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'kids-print', leftValue: '={{ $("Settings").first().json.family === "kids" }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } };
    before(workflow, original.name, gate);
    workflow.nodes.push(kids);
    workflow.connections[gate.name] = { main: [[{ node: kids.name, type: 'main', index: 0 }], [{ node: original.name, type: 'main', index: 0 }]] };
    workflow.connections[kids.name] = structuredClone(workflow.connections[original.name]);
    const checked = get('Jobs checked');
    if (!checked.parameters.jsCode.includes('job.status = "completed";')) throw new Error('Unknown print job result schema');
    checked.parameters.jsCode = checked.parameters.jsCode.replace('job.status = "completed";',
        'if ($("Settings").first().json.family === "kids" && (a.result.colorsUsed !== $("Settings").first().json.kidsColors || a.result.colorsRequested !== $("Settings").first().json.kidsColors)) { Object.assign(job, { status: "failed", error: "Kids template must contain " + $("Settings").first().json.kidsColors + " actually used paints" }); return; }\n            job.status = "completed";');
    // Separate durable tally per family; both use the same shared Print lock.
    const find = get('Find print report');
    const q = find.parameters.queryParameters.parameters.find(p => p.name === 'q');
    q.value = q.value.replace('_print-report.json', '{{ $("Settings").first().json.family === "kids" ? "_print-report-kids.json" : "_print-report.json" }}');
    const store = get('Store print report');
    store.parameters.jsonBody = store.parameters.jsonBody.replace("name: '_print-report.json'", "name: ($('Settings').first().json.family === 'kids' ? '_print-report-kids.json' : '_print-report.json')");
    require('./print-checkpoints').attachPrintCheckpoints(workflow, { before, codeNode, idFor });
    return workflow;
}

function adaptPriceSource(get) {
    get('Export prices sheet').parameters.url = '={{ $("Settings").first().json.family === "kids" ? "https://docs.google.com/spreadsheets/d/" + $("Settings").first().json.pricesSheetId + "/export?format=csv&gid=188180018" : "https://www.googleapis.com/drive/v3/files/" + $json.id + "/export?mimeType=text/csv" }}';
    const parser = get('Prices');
    parser.parameters.jsCode = parser.parameters.jsCode.replace('if (colors === "NaN")',
        'if (settings.family === "kids" && colors !== String(settings.kidsColors)) throw new Error(where + ": Kids price rows must use " + settings.kidsColors + " colors");\n    if (colors === "NaN")');
    parser.parameters.jsCode = parser.parameters.jsCode.replace('/^\\d+x\\d+$/', '/^\\d+(?:[.]\\d+)?x\\d+(?:[.]\\d+)?$/');
}

function adaptUploader(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    adaptPriceSource(get);
    // Preserve the existing productSet identifier-by-handle upsert and credentials.
    get('Build product').parameters.jsCode = get('Build product').parameters.jsCode.replace('value("Size").replace("x", "")', 'value("Size").replace(/[^0-9]/g, "")')
        .replace("const product = $('Download product JSON').first().json;", "const product = $('Download product JSON').first().json;\nif ((product.kids === true) !== (settings.family === 'kids')) throw new Error('Product metadata family conflicts with its folder');");
    const pending = get('Pending folders');
    pending.parameters.jsCode = pending.parameters.jsCode.replace('folderId: folder.id, folder:',
        'printFolderId: (files.find(f => f.name === "Print" && f.mimeType === "application/vnd.google-apps.folder") || {}).id || "", folderId: folder.id, folder:');
    const existing = structuredClone(get('Create draft product'));
    existing.name = 'Find existing product'; existing.id = idFor(existing.name);
    existing.position = [5050, 650];
    existing.parameters.jsonBody = `={{ JSON.stringify({ query: 'query ExistingProduct($identifier: ProductIdentifierInput!) { productByIdentifier(identifier: $identifier) { id handle status } }', variables: { identifier: { handle: $json.handle } } }) }}`;
    delete existing.onError;
    before(workflow, 'Create draft product', existing);
    const preserve = codeNode('Preserve existing product status', `const built = $('Build product').first().json;
const response = $input.first().json;
if (response.errors?.length || !response.data || !Object.prototype.hasOwnProperty.call(response.data, 'productByIdentifier')) throw new Error('Cannot safely reconcile existing Shopify product');
const product = response.data.productByIdentifier;
if (product && product.handle !== built.handle) throw new Error('Shopify handle mismatch during retry');
return [{ json: { ...built, input: { ...built.input, ...(product ? { id: product.id, status: product.status } : {}) } } }];`, [5270, 650]);
    before(workflow, 'Create draft product', preserve);
    const familyGate = ifNode('Validate Kids print files?', '={{ $("Settings").first().json.family === "kids" }}', [2600, 360]);
    before(workflow, 'Heartbeat (refresh lock)', familyGate);
    const hasPrint = ifNode('Kids Print folder exists?', '={{ !!$("Loop over folders").first().json.printFolderId }}', [2820, 360]);
    const listing = structuredClone(get('List folder files'));
    listing.name = 'List Kids production files'; listing.id = idFor(listing.name); listing.position = [3040, 360];
    listing.parameters.queryParameters.parameters.find(p => p.name === 'q').value = "='{{ $('Loop over folders').first().json.printFolderId }}' in parents and trashed = false";
    const readiness = codeNode('Kids production readiness', `const folder = $('Loop over folders').first().json;
const size = $('Settings').first().json.sizes;
const reverse = size.split('x').reverse().join('x');
const colors = String($('Settings').first().json.kidsColors);
const names = new Set(($input.first().json.files || []).map(f => f.name));
const missing = ['_blank.svg', '_catalog.pdf', '_user.pdf'].filter(suffix =>
    ![folder.stamp + '_' + colors + suffix, folder.stamp + '_' + size + '_' + colors + suffix, folder.stamp + '_' + reverse + '_' + colors + suffix].some(name => names.has(name)));
return [{ json: { ...folder, ready: missing.length === 0, missing } }];`, [3260, 360]);
    const ready = ifNode('Kids print files ready?', '={{ $json.ready === true }}', [3480, 360]);
    workflow.nodes.push(hasPrint, listing, readiness, ready);
    workflow.connections[familyGate.name] = { main: [[edgeTo(hasPrint.name)], [edgeTo('Heartbeat (refresh lock)')]] };
    workflow.connections[hasPrint.name] = { main: [[edgeTo(listing.name)], [edgeTo('Loop over folders')]] };
    workflow.connections[listing.name] = { main: [[edgeTo(readiness.name)]] };
    workflow.connections[readiness.name] = { main: [[edgeTo(ready.name)]] };
    workflow.connections[ready.name] = { main: [[edgeTo('Heartbeat (refresh lock)')], [edgeTo('Loop over folders')]] };
    return workflow;
}

function adaptPriceSync(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    adaptPriceSource(get);
    const collect = get('Collect products');
    collect.parameters.jsCode = collect.parameters.jsCode.replace('if ((p.tags || []).includes("kids-kits")) return false;',
        'if (((p.tags || []).includes("kids-kits") ? "kids" : "classic") !== $("Settings").first().json.family) return false;\n    if ($("Settings").first().json.family === "kids" && !p.variants.nodes.every(v => v.selectedOptions.some(o => o.name === "Colors" && o.value === String($("Settings").first().json.kidsColors)) && v.selectedOptions.some(o => o.name === "Size" && o.value === $("Settings").first().json.sizes))) return false;');
    collect.parameters.jsCode = collect.parameters.jsCode.replace('// Kids are owned by the independent Kids workflow.', '// Select the execution\'s product family.');
    get('Changes').parameters.jsCode = get('Changes').parameters.jsCode.replace('row.size.replace("x", "")', 'row.size.replace(/[^0-9]/g, "")');
    return workflow;
}

function adaptTranslation(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    const collect = get('Collect products');
    collect.parameters.jsCode = collect.parameters.jsCode.replace('if ((p.tags || []).includes("kids-kits")) continue;',
        'if (((p.tags || []).includes("kids-kits") ? "kids" : "classic") !== settings.family) continue;');
    collect.parameters.jsCode = collect.parameters.jsCode.replace('// Kids are owned by the independent Kids workflow.', '// Select the execution\'s product family.');
    return workflow;
}

function adaptWatchdog(source, config) {
    const { workflow, get } = adaptCommon(source, config);
    const recent = get('Recent folders');
    recent.parameters.jsCode = embeddedHelpers() + recent.parameters.jsCode
        .replace('(f.appProperties || {}).darlart_family !== "kids" && new Date(f.createdTime).getTime() >= since',
            'folderContext(f).family === settings.family && folderContext(f).eligible && (settings.family !== "kids" || ((f.appProperties || {}).darlart_colors === String(settings.kidsColors) && (f.appProperties || {}).darlart_size === ' + JSON.stringify(validateKidsConfig(config).canvasSize) + '))');
    const plan = get('Stages to start');
    plan.parameters.jsCode = embeddedHelpers() + plan.parameters.jsCode
        .replace(/pending\.worker = queueFiles\.filter[^\n]+;/,
            'pending.worker = queueFiles.filter(f => parseQueueName(f.name)).map(f => f.name);')
        .replace(/if \(!pending\.worker\.length\) pending\.worker = [^\n]+;/,
            'if (!pending.worker.length) pending.worker = queueFiles.filter(f => /^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?_batch[.]json$/.test(f.name) && age(f) > 10).map(f => f.name);')
        .replace('f.name === "_failed-" + stage', 'f.name === "_failed-" + (settings.family === "kids" ? "kids-" : "") + stage')
        .replace('if ((!has("_featured.png") || !has("_mockup.png")) && !givenUp)',
            'if ((!has("_shopify.json") || !has("_featured.png") || !has("_mockup.png")) && !givenUp)');
    // Worker locks always live in the Classic allocation queue. Kids queue
    // references remain in the Kids queue, but its lock must be checked globally.
    const originalList = get('List queue');
    const allocation = structuredClone(originalList);
    allocation.name = 'List allocation locks'; allocation.id = idFor(allocation.name);
    allocation.position = [originalList.position[0] + 150, originalList.position[1] + 180];
    const originalSettings = source.nodes.find(n => n.name === 'Settings').parameters.assignments.assignments;
    const queueId = originalSettings.find(a => a.name === 'queueFolderId').value;
    allocation.parameters = mapStrings(allocation.parameters, s => s.replaceAll("$('Settings').first().json.queueFolderId", JSON.stringify(queueId)));
    // Keep the main stream intact after inserting the extra read.
    before(workflow, 'List Artwork Agent', allocation);
    plan.parameters.jsCode = plan.parameters.jsCode.replace('[...queueFiles, ...rootFiles].some',
        '[...queueFiles, ...rootFiles, ...($("List allocation locks").first().json.files || [])].some');
    return workflow;
}

function adaptErrorHandler(source) {
    const workflow = structuredClone(source);
    const get = name => workflow.nodes.find(n => n.name === name);
    const query = get('Find locks').parameters.queryParameters.parameters;
    query.find(p => p.name === 'fields').value = 'files(id,name,parents,description)';
    query.find(p => p.name === 'q').value = query.find(p => p.name === 'q').value.replace("(name contains '_artwork-worker.lock'", "(name contains '_kids-' or name contains '_artwork-worker.lock'");
    const next = get('Next steps');
    next.parameters.jsCode = next.parameters.jsCode.replace("const d = $('Error details').first().json;", `const d = $('Error details').first().json;
const owned = ($('Find locks').first().json.files || []).filter(f => f.name.endsWith('-' + d.executionId));
const familyMatch = owned.map(f => /(?:^|;)family=(classic|kids)(?:;|$)/.exec(f.description || '')).find(Boolean);
d.family = familyMatch ? familyMatch[1] : undefined;`)
        .replace('if (d.workflowId === W.worker) {', 'if (d.workflowId === W.worker && d.family) {')
        .replace('f.name === "_failed-" + stage', 'f.name === "_failed-" + (d.family === "kids" ? "kids-" : "") + stage')
        .replace('const key = d.workflowId + "|"', 'const key = d.workflowId + "|" + (d.family || "unknown") + "|"')
        .replace('json: { restartWorker, sendAlert,', 'json: { family: d.family, restartWorker, sendAlert,');
    const mark = get('Mark the failure');
    mark.parameters.jsonBody = mark.parameters.jsonBody.replace("name: '_failed-' + $json.stage", "name: '_failed-' + ($json.family === 'kids' ? 'kids-' : '') + $json.stage");
    before(workflow, 'Start the worker', codeNode('Restart family context', `const family = $input.first().json.family;
if (family !== 'classic' && family !== 'kids') throw new Error('Cannot restart a worker without its recorded family');
return [{ json: { family } }];`, [1800, -180]));
    workflow.settings = { ...source.settings, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' };
    workflow.active = false;
    notificationRetries(workflow);
    delete workflow.versionId; delete workflow.activeVersionId; delete workflow.pinData;
    return workflow;
}

module.exports = { adaptCommon, adaptWorker, adaptTitling, adaptPrint, adaptUploader, adaptPriceSync, adaptTranslation, adaptWatchdog, adaptErrorHandler, before, codeNode, mapStrings, notificationRetries };
