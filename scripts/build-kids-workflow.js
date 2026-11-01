/** Thin Kids upload: enqueue and call the existing Artwork Worker. No processing copies. */
const fs = require('fs');
const path = require('path');
const { validateKidsConfig } = require('./lib/product-profiles');
const { notificationRetries } = require('./lib/shared-agents');
const root = path.join(__dirname, '..');

function buildKidsWorkflow(config) {
    const settings = validateKidsConfig(config);
    const source = JSON.parse(fs.readFileSync(path.join(root, 'automation/n8n-darlart-artwork-agent.json')));
    const get = name => source.nodes.find(n => n.name === name);
    const node = get('Settings');
    for (const field of node.parameters.assignments.assignments) {
        if (field.name === 'queueFolderId') field.value = settings.queueFolderId;
    }
    node.parameters.assignments.assignments.push({ id: 'family', name: 'family', value: 'kids', type: 'string' });
    const form = get('Formulaire');
    form.parameters.formTitle = "Darl'Art Kids Artwork Agent";
    form.parameters.formDescription = 'Upload Kids references. Exactly ' + settings.colors + ' paints, ' + settings.canvasSize + ' cm (landscape reversed). Progress is reported in Telegram.';
    form.parameters.formFields.values[0].multipleFiles = true;
    form.webhookId = config.formWebhookId || 'darlart-kids-upload';
    // Keep the production endpoint even when n8n derives the path from a separate field.
    if (form.parameters.options?.path) form.parameters.options.path = 'darlart-kids-upload';
    get('Check uploads').parameters.jsCode = get('Check uploads').parameters.jsCode.replace(
        /const batchId = [^\n]+;/,
        'const batchId = $now.setZone("Africa/Casablanca").toFormat("yyyy-MM-dd_HH-mm-ss") + "_" + $execution.id;'
    );
    const manifest = get('Batch manifest');
    // Keep the original manifest schema; family remains durable across retries.
    if (!manifest.parameters.jsCode.includes('const manifest = {')) throw new Error('Unknown manifest schema');
    manifest.parameters.jsCode = manifest.parameters.jsCode.replace('const manifest = {',
        'const manifest = {\n    family: "kids", profileVersion: ' + JSON.stringify(settings.version) + ',');
    const worker = get('Start worker');
    worker.parameters = {
        source: 'database', workflowId: { __rl: true, mode: 'id', value: 'dO8EdyDM4ua2hRrA' },
        mode: 'once',
        options: { waitForSubWorkflow: false },
    };
    // Explicit route data works with an Accept-all-data trigger, without relying on n8n input mapping.
    const routeName = 'Kids worker context';
    source.nodes.push({ id: 'kids-worker-context', name: routeName, type: 'n8n-nodes-base.code', typeVersion: 2,
        position: [worker.position[0] - 100, worker.position[1]], parameters: { jsCode: 'return [{ json: { family: "kids" } }];' } });
    for (const outputs of Object.values(source.connections)) for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) if (edge.node === 'Start worker') edge.node = routeName;
    source.connections[routeName] = { main: [[{ node: 'Start worker', type: 'main', index: 0 }]] };
    get('Build queued page').parameters.jsCode = get('Build queued page').parameters.jsCode.replace('about 2 minutes each', 'generation time varies by design');
    delete source.id;
    source.name = "Darl'Art Kids Agent";
    source.active = false; // A candidate export is never an instruction to publish.
    source.settings = { ...source.settings, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' };
    delete source.versionId;
    delete source.activeVersionId;
    delete source.meta;
    delete source.pinData;
    source.nodes.forEach(n => { n.id = 'kids-entry-' + n.id; });
    notificationRetries(source);
    return source;
}

if (require.main === module) {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'automation/kids-config.json')));
    const workflow = buildKidsWorkflow(config);
    fs.writeFileSync(path.join(root, 'automation/n8n-darlart-kids-agent.json'), JSON.stringify(workflow, null, 2) + '\n');
    console.log('Wrote thin Kids entry: ' + workflow.nodes.length + ' nodes. Candidate only; shared agents must be adapted before import.');
}
module.exports = { buildKidsWorkflow };
