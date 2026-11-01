const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveFamily, folderContext, parseQueueName, resolveStageSettings, validateKidsConfig, embeddedHelpers } = require('../scripts/lib/product-profiles');
const { buildKidsWorkflow } = require('../scripts/build-kids-workflow');
const config = validateKidsConfig(require('../automation/kids-config.json'));
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const { adaptWorker, adaptTitling, adaptPrint, adaptUploader, adaptPriceSync, adaptTranslation, adaptWatchdog, adaptErrorHandler } = require('../scripts/lib/shared-agents');
const baseline = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shared-baseline/n8n-darlart-' + name + '.json')));

function checkGraph(w) {
    const names = new Set(w.nodes.map(n => n.name));
    assert.equal(names.size, w.nodes.length);
    for (const [from, outputs] of Object.entries(w.connections)) {
        assert.ok(names.has(from), from);
        for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) assert.ok(names.has(edge.node), edge.node);
    }
    for (const n of w.nodes) {
        if (n.type.endsWith('.code')) new AsyncFunction(n.parameters.jsCode);
        if (typeof n.parameters.jsonBody === 'string' && n.parameters.jsonBody.startsWith('={{')) new Function('$', '$json', '$execution', 'return (' + n.parameters.jsonBody.slice(3, -2) + ');');
        for (const match of JSON.stringify(n.parameters).matchAll(/\$\((?:'([^']+)'|\\"([^\\"]+)\\")\)/g)) assert.ok(names.has(match[1] || match[2]), n.name + ' references missing ' + (match[1] || match[2]));
    }
}

test('all six shared processing adapters preserve graph and embedded-code validity', () => {
    for (const [stage, adapt] of [['artwork-worker', adaptWorker], ['titling-agent', adaptTitling], ['print-agent', adaptPrint], ['shopify-uploader', adaptUploader], ['price-sync', adaptPriceSync], ['translation-sync', adaptTranslation]]) {
        const w = adapt(baseline(stage), config);
        checkGraph(w);
        assert.equal(w.active, false, 'candidate export must not activate a workflow');
        assert.equal(w.settings.saveDataSuccessExecution, 'all');
        assert.equal(w.settings.saveDataErrorExecution, 'all');
        for (const n of w.nodes.filter(n => n.type.endsWith('.executeWorkflow') && n.name !== 'Run shared family stage')) {
            assert.ok(w.nodes.some(x => x.name === 'Context for ' + n.name), stage + ' ' + n.name);
        }
    }
});

test('accepted PBN jobs survive a polling budget and resume without another POST', async () => {
    const w = adaptPrint(baseline('print-agent'), config);
    const get = name => w.nodes.find(n => n.name === name);
    const settings = (await new AsyncFunction('$input', get('Settings').parameters.jsCode)({first:()=>({json:{family:'kids'}})}))[0].json;
    let state = { jobs: [{ folderId:'f', artworkId:'art', folder:'1201', stamp:'1201', size:'24x30', colors:16, jobId:'accepted-job', status:'sent', sentAt:0 }], send:[], saved:[], errors:[] };
    const ctx = {Settings:settings, 'Find PBN checkpoint':{files:[]}, 'Jobs sent':state};
    const dollar = name => ({first:()=>({json:ctx[name]||{}}),last:()=>({json:ctx[name]||{}}),all:()=>name==='Jobs to check'?[{json:{jobId:'accepted-job'}}]:[],isExecuted: !!ctx[name]});
    const accepted = await new AsyncFunction('$input','$',get('Checkpoint accepted jobs').parameters.jsCode)({first:()=>({json:state})},dollar);
    const record=JSON.parse(accepted[0].json.description);
    assert.equal(Object.values(record.records)[0].jobId,'accepted-job');
    assert.equal(get('Save accepted PBN checkpoint').onError, undefined);
    const deferred=await new AsyncFunction('$input','$',get('Jobs checked').parameters.jsCode)({first:()=>({json:{jobId:'accepted-job',status:'processing'}}),all:()=>[{json:{jobId:'accepted-job',status:'processing'}}]},dollar);
    assert.equal(deferred[0].json.jobs[0].status,'deferred');
    assert.equal(deferred[0].json.finished,true);
    const saved=await new AsyncFunction('$input','$',get('Checkpoint polled jobs').parameters.jsCode)({first:()=>deferred[0]},dollar);
    ctx['Find PBN checkpoint']={files:[{id:'checkpoint',description:saved[0].json.description}]};
    ctx['Folder states']=[{json:{folderId:'f',artworkId:'art',folder:'1201',stamp:'1201',printFolderId:'print',rootFiles:[]}}];
    const plannerDollar=name=>name==='Folder states'?{all:()=>ctx[name]}:name==='List Print files'?{all:()=>[{json:{files:[]}}]}:dollar(name);
    const planned=await new AsyncFunction('$',get('Plan jobs').parameters.jsCode)(plannerDollar);
    assert.equal(planned[0].json.resumeJobId,'accepted-job');
    const round=await new AsyncFunction('$input','$',get('Job round').parameters.jsCode)({first:()=>planned[0],all:()=>planned},dollar);
    assert.deepEqual(round[0].json.send,[],'a resumed job must not reach a create-job POST');
    assert.equal(round[0].json.jobs[0].jobId,'accepted-job');
    assert.equal(round[0].json.jobs[0].status,'sent');
    ctx['Find PBN checkpoint'].files[0].description='{bad';
    await assert.rejects(new AsyncFunction('$',get('Plan jobs').parameters.jsCode)(plannerDollar),/malformed/);
});

test('Uploader retry preserves an existing ACTIVE product and rejects an uncertain lookup', async () => {
    const w=adaptUploader(baseline('shopify-uploader'),config);
    const get=name=>w.nodes.find(n=>n.name===name);
    const built={handle:'rocket-1033',input:{status:'DRAFT',title:'Rocket'}};
    const run=new AsyncFunction('$input','$',get('Preserve existing product status').parameters.jsCode);
    const dollar=()=>({first:()=>({json:built})});
    const response=product=>({first:()=>({json:{data:{productByIdentifier:product}}})});
    const retry=await run(response({id:'existing',handle:'rocket-1033',status:'ACTIVE'}),dollar);
    assert.equal(retry[0].json.input.id,'existing');
    assert.equal(retry[0].json.input.status,'ACTIVE');
    assert.equal((await run(response(null),dollar))[0].json.input.status,'DRAFT');
    await assert.rejects(run({first:()=>({json:{errors:[{message:'unavailable'}]}})},dollar),/safely reconcile/);
    assert.equal(w.connections['Build product'].main[0][0].node,'Find existing product');
    assert.equal(w.connections['Find existing product'].main[0][0].node,'Preserve existing product status');
});

test('price and translation scans select their own family from a mixed catalog', async () => {
    const make=(id,family,colors='16')=>({id,title:id,handle:'art-'+id,tags:family==='kids'?['kids-kits']:[],descriptionHtml:'A painting',variants:{nodes:[{sku:id+'243016R',selectedOptions:[{name:'Colors',value:colors},{name:'Size',value:'24x30'}]}]}});
    const products=[make('1201','classic'),make('1202','kids'),make('1203','kids','24')];
    for(const [stage,adapt] of [['price-sync',adaptPriceSync],['translation-sync',adaptTranslation]]) {
        const w=adapt(baseline(stage),config), code=w.nodes.find(n=>n.name==='Collect products').parameters.jsCode;
        for(const family of ['classic','kids']) {
            const ctx={Settings:{family,kidsColors:16,sizes:'24x30',locales:'fr,ar'},'Next page':{products:[]}};
            const result=await new AsyncFunction('$input','$',code)({first:()=>({json:{data:{products:{nodes:products,pageInfo:{hasNextPage:false}}}}})},name=>({first:()=>({json:ctx[name]})}));
            assert.deepEqual(result[0].json.products.map(p=>p.id),family==='classic'?['1201']:stage==='price-sync'?['1202']:['1202','1203']);
        }
    }
});

test('maintained generators rebuild valid deterministic shared exports', () => {
    const {execFileSync}=require('child_process');
    const root=path.resolve(__dirname,'..');
    execFileSync(process.execPath,[path.join(root,'scripts/build-shared-workflows.js')],{cwd:root});
    const files=fs.readdirSync(path.join(root,'automation')).filter(f=>/^n8n-darlart-.*[.]json$/.test(f));
    const first=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'automation',f),'utf8')]));
    execFileSync(process.execPath,[path.join(root,'scripts/build-shared-workflows.js')],{cwd:root});
    for(const f of files){
        assert.equal(fs.readFileSync(path.join(root,'automation',f),'utf8'),first[f],f);
        const w=JSON.parse(first[f]); checkGraph(w);
        if(f!=='n8n-darlart-artwork-agent.json')assert.equal(w.active,false);
    }
});

test('Watchdog preserves all routed stages, checks the common allocation lock and resumes old Kids manifests', async () => {
    const w = adaptWatchdog(baseline('queue-watchdog'), config);
    checkGraph(w);
    const get = name => w.nodes.find(n => n.name === name);
    const settings = (await new AsyncFunction('$input', get('Settings').parameters.jsCode)({ first: () => ({ json: { family: 'kids' } }) }))[0].json;
    const routed = await new AsyncFunction('$input', '$', get('Context for Start stage').parameters.jsCode)(
        { all: () => [{ json: { workflowId: 'worker', stage: 'worker' } }, { json: { workflowId: 'print', stage: 'print' } }] },
        () => ({ first: () => ({ json: settings }) }));
    assert.deepEqual(routed.map(i => i.json.workflowId), ['worker', 'print']);
    assert.ok(routed.every(i => i.json.family === 'kids'));
    const context = { Settings: settings, 'List queue': { files: [{ name: '2026-10-31_01-02-03_14739_batch.json', createdTime: '2026-10-31T00:00:00Z' }] }, 'List Artwork Agent': { files: [] }, 'List allocation locks': { files: [] } };
    const dollar = name => ({ first: () => ({ json: context[name] || {} }), all: () => name === 'Recent folders' ? [{ json: { none: true } }] : [], isExecuted: name !== 'Locks of finished runs' });
    const run = () => new AsyncFunction('$input', '$', get('Stages to start').parameters.jsCode)({ all: () => [{ json: {} }] }, dollar);
    const stages = await run();
    assert.equal(stages[0].json.stage, 'worker');
    context['List allocation locks'].files.push({ id: 'lock', name: '_artwork-worker.lock-1', description: 'staleMinutes=20;family=kids', modifiedTime: new Date().toISOString() });
    assert.equal((await run()).length, 0, 'a fresh common worker lock blocks dispatch');
});

test('Error Handler recovers the recorded family and refuses an unqualified restart', async () => {
    const w = adaptErrorHandler(baseline('error-handler'));
    checkGraph(w);
    const get = name => w.nodes.find(n => n.name === name);
    assert.match(JSON.stringify(get('Find locks').parameters), /_kids-/);
    const context = { 'Error details': { workflowId: 'dO8EdyDM4ua2hRrA', workflowName: 'Shared Worker', executionId: '42', step: 'Generate ART', message: 'fixture failure' },
        'Find locks': { files: [{ id: 'lock', name: '_artwork-worker.lock-42', description: 'staleMinutes=20;family=kids' }] },
        Settings: { restartWindowMinutes: 30, maxRestarts: 5, alertEveryMinutes: 60, agentFolderId: 'root' } };
    const dollar = name => ({ first: () => ({ json: context[name] || {} }), all: () => [], isExecuted: false });
    const memory = {};
    const result = await new AsyncFunction('$', '$getWorkflowStaticData', get('Next steps').parameters.jsCode)(dollar, () => memory);
    assert.equal(result[0].json.family, 'kids');
    assert.equal(result[0].json.restartWorker, true);
    const route = new AsyncFunction('$input', get('Restart family context').parameters.jsCode);
    assert.equal((await route({ first: () => result[0] }))[0].json.family, 'kids');
    await assert.rejects(route({ first: () => ({ json: {} }) }), /recorded family/);
});

test('shared Print leaves Classic API inputs intact and plans exactly one Kids color/size job', async () => {
    const original = baseline('print-agent'), w = adaptPrint(original, config);
    const get = name => w.nodes.find(n => n.name === name);
    assert.deepEqual(get('Create pbn job').parameters, original.nodes.find(n => n.name === 'Create pbn job').parameters);
    const kidsFields = get('Create Kids pbn job').parameters.bodyParameters.parameters;
    for (const name of ['requireExactColors', 'physicalSvg', 'paintCanvasSizes']) assert.ok(kidsFields.some(f => f.name === name));
    assert.match(get('Store print report').parameters.jsonBody, /_print-report-kids/);
    for (const family of ['classic', 'kids']) {
        const settings = (await new AsyncFunction('$input', get('Settings').parameters.jsCode)({ first: () => ({ json: { family } }) }))[0].json;
        const context = name => ({ first: () => ({ json: settings }), all: () => name === 'Folder states' ? [{ json: { folderId: 'f', folder: '1201', stamp: '1201', artworkId: 'art', printFolderId: '', rootFiles: ['1201_art.png'] } }] : [{ json: { files: [] } }] });
        const jobs = await new AsyncFunction('$', get('Plan jobs').parameters.jsCode)(context);
        assert.deepEqual([...new Set(jobs.map(j => j.json.colors))], family === 'kids' ? [16] : [12,24,36,48]);
        assert.ok(jobs.every(j => j.json.size === (family === 'kids' ? '24x30' : '60x75')));
    }
});

test('shared Kids price parser disables stretched at zero and rejects other paint counts', async () => {
    for (const [stage, adapt] of [['shopify-uploader', adaptUploader], ['price-sync', adaptPriceSync]]) {
        const source = baseline(stage), w = adapt(source, config);
        const get = name => w.nodes.find(n => n.name === name);
        const settings = (await new AsyncFunction('$input', get('Settings').parameters.jsCode)({ first: () => ({ json: { family: 'kids' } }) }))[0].json;
        const dollar = name => ({ first: () => ({ json: name === 'Settings' ? settings : { name: 'Kids prices', modifiedTime: 'fixture' } }) });
        const run = text => new AsyncFunction('$input', '$', get('Prices').parameters.jsCode)({ first: () => ({ json: { data: text } }) }, dollar);
        const csv = 'canvas_type,size,colors,price\nRolled,24x30,16,189\nStretched,24x30,16,0';
        const result = (await run(csv))[0].json;
        assert.equal(result.variants.length, 1);
        assert.equal(result.variants[0].price, '189.00');
        assert.ok(result.variants[0].optionValues.some(o => o.optionName === 'Colors' && o.name === '16'));
        await assert.rejects(run(csv.replaceAll(',16,', ',12,')), /16 colors/);
        await assert.rejects(run(csv.replaceAll(',16,', ',18,')), /16 colors/);
        if (stage === 'shopify-uploader') assert.deepEqual(get('Create draft product').parameters, source.nodes.find(n => n.name === 'Create draft product').parameters);
    }
});

test('Kids upload waits for all three print artifacts, including landscape files', async () => {
    const w = adaptUploader(baseline('shopify-uploader'), config);
    const code = w.nodes.find(n => n.name === 'Kids production readiness').parameters.jsCode;
    const dollar = name => ({ first: () => ({ json: name === 'Settings' ? { sizes: '24x30', kidsColors: 16 } : { folder: '1201', stamp: '1201', printFolderId: 'print' } }) });
    const run = names => new AsyncFunction('$input', '$', code)({ first: () => ({ json: { files: names.map(name => ({ name })) } }) }, dollar);
    assert.equal((await run(['1201_16_blank.svg', '1201_16_catalog.pdf']))[0].json.ready, false);
    assert.equal((await run(['1201_12_blank.svg', '1201_12_catalog.pdf', '1201_12_user.pdf']))[0].json.ready, false);
    assert.equal((await run(['1201_16_blank.svg', '1201_16_catalog.pdf', '1201_16_user.pdf']))[0].json.ready, true);
    assert.equal((await run(['1201_30x24_16_blank.svg', '1201_30x24_16_catalog.pdf', '1201_30x24_16_user.pdf']))[0].json.ready, true);
    const gate = w.connections['Kids print files ready?'].main;
    assert.equal(gate[1][0].node, 'Loop over folders');
    assert.equal(gate[0][0].node, 'Heartbeat (refresh lock)');
});

test('notifications retry transient failures and only successful batch sends persist notified state', () => {
    for (const w of [buildKidsWorkflow(config), adaptWorker(baseline('artwork-worker'), config), adaptUploader(baseline('shopify-uploader'), config), adaptErrorHandler(baseline('error-handler'))]) {
        for (const n of w.nodes.filter(n => n.type.endsWith('.telegram'))) {
            assert.equal(n.retryOnFail, true);
            assert.equal(n.maxTries, 3);
        }
    }
    const uploader = adaptUploader(baseline('shopify-uploader'), config);
    const sender = uploader.nodes.find(n => n.name === 'Send batch message');
    assert.equal(sender.onError, 'continueErrorOutput');
    assert.equal(uploader.connections[sender.name].main[0][0].node, 'Sent batches');
    assert.ok(!uploader.connections[sender.name].main[1]?.length, 'failure output must not mark the batch as notified');
    assert.notEqual(uploader.connections.Summary.main[0][0].node, 'Telegram: upload report');
    assert.ok(uploader.connections.Summary.main[0].some(e => e.node === 'Batch messages mode'), 'lock-release route is independent of the optional report');
});

test('Price Sync updates the existing variant ID and does not recreate an unchanged Kids variant', async () => {
    const w = adaptPriceSync(baseline('price-sync'), config);
    const code = w.nodes.find(n => n.name === 'Changes').parameters.jsCode;
    const options = [{ name: 'Size', value: '24x30' }, { name: 'Canvas Type', value: 'Rolled Canvas' }, { name: 'Colors', value: '16' }];
    const product = { id: 'product', folder: '1201', title: 'Kids', tags: ['kids-kits'], variants: { nodes: [{ id: 'existing-variant', price: '189.00', compareAtPrice: null, selectedOptions: options }] } };
    const row = { key: '24x30|Rolled Canvas|16', size: '24x30', canvasType: 'Rolled Canvas', colors: '16', sold: true, price: '189.00', compareAtPrice: null };
    const context = { Prices: { rows: [row] }, 'Collect products': { products: [product] } };
    const dollar = name => ({ first: () => ({ json: context[name] }) });
    const run = () => new AsyncFunction('$', code)(dollar);
    const unchanged = await run();
    assert.ok(unchanged.length === 0 || unchanged[0].json.none, 'same price must not recreate the variant');
    row.price = '199.00';
    const changed = await run();
    assert.ok(JSON.stringify(changed).includes('existing-variant'));
    assert.ok(!JSON.stringify(changed).includes('productVariantsBulkCreate'));
});

test('shared Worker preserves the allocation lock and accepts both queue formats', async () => {
    const source = baseline('artwork-worker');
    const w = adaptWorker(source, config);
    checkGraph(w);
    const get = name => w.nodes.find(n => n.name === name);
    const resolve = async family => (await new AsyncFunction('$input', get('Settings').parameters.jsCode)({ first: () => ({ json: { family } }) }))[0].json;
    assert.equal((await resolve('kids')).colors, 16);
    assert.equal((await resolve('kids')).queueFolderId, config.queueFolderId);
    assert.equal((await resolve('classic')).colors, 48);
    const originalQueue = source.nodes.find(n => n.name === 'Settings').parameters.assignments.assignments.find(a => a.name === 'queueFolderId').value;
    for (const name of ['List locks', 'List locks again', 'Create lock']) {
        const parameters = JSON.stringify(get(name).parameters);
        assert.ok(parameters.includes(originalQueue));
        assert.ok(!parameters.includes(config.queueFolderId));
    }
    for (const batchId of ['2026-11-01_01-02-03', '2026-11-01_01-02-03_14739']) {
        const files = [{ id: 'reference', name: batchId + '_01.png' }, { id: 'manifest', name: batchId + '_batch.json' }];
        const result = await new AsyncFunction('$input', get('Next reference').parameters.jsCode)({ first: () => ({ json: { files } }) });
        assert.equal(result[0].json.batchId, batchId);
        assert.equal(result[0].json.manifestId, 'manifest');
    }
    assert.match(JSON.stringify(get('Create folder (Artwork Agent/1xxx)').parameters), /darlart_family/);
    assert.deepEqual(get('Create folder (Artwork Agent/1xxx)').credentials, source.nodes.find(n => n.name === 'Create folder (Artwork Agent/1xxx)').credentials);
    assert.match(get('Context for Run Print Agent').parameters.jsCode, /family/);
    const hasPredicate = source.nodes.find(n => n.name === 'OpenAI account problem?');
    assert.deepEqual(get(hasPredicate.name).parameters, hasPredicate.parameters);
});

test('family-scoped Titling cannot mix folders or let the model choose the family', async () => {
    const w = adaptTitling(baseline('titling-agent'), config);
    checkGraph(w);
    const get = name => w.nodes.find(n => n.name === name);
    const folders = [{ id: 'c', name: '1200' }, { id: 'k', name: '1201', appProperties: { darlart_family: 'kids', darlart_size: '24x30', darlart_colors: '16' } }, { id: 'v', name: '1202', appProperties: { darlart_family: 'kids', darlart_state: 'validation' } }, {id:'old18',name:'1203',appProperties:{darlart_family:'kids',darlart_size:'24x30',darlart_colors:'18'}}];
    for (const family of ['classic', 'kids']) {
        const settings = { family, baseTags: 'paint-by-numbers', productType: 'Paint by Numbers Kit', vendor: "Darl'Art" };
        const dollar = name => ({ first: () => ({ json: name === 'Settings' ? settings : name === 'Themes' ? { themes: [], categoryChoices: [], difficultyChoices: [] } : { folder: '1201', artworkName: '1201_art.png', stamp: '1201', productName: '1201_product.json' } }) });
        const chosen = await new AsyncFunction('$input', '$', get('Folders').parameters.jsCode)({ first: () => ({ json: { files: folders } }) }, dollar);
        assert.deepEqual(chosen.map(x => x.json.id), [family === 'kids' ? 'k' : 'c']);
        const result = await new AsyncFunction('$json', '$', '$now', 'Buffer', get('Build product JSON').parameters.jsCode)({ output: { title: 'Test', kids: family !== 'kids', tags: ['kids-kits'], difficulty: 'Intermediate' } }, dollar, { setZone: () => ({ toISO: () => 'fixture' }) }, Buffer);
        const product = JSON.parse(Buffer.from(result[0].binary.data.data, 'base64').toString());
        assert.equal(product.kids, family === 'kids');
        assert.equal(product.tags.includes('kids-kits'), family === 'kids');
    }
});

test('family resolution rejects unknown families and excludes non-production states', () => {
    assert.equal(resolveFamily(undefined), 'classic');
    assert.equal(resolveFamily('kids'), 'kids');
    assert.throws(() => resolveFamily('unknown'));
    assert.throws(() => resolveFamily({ family: 'kids' }));
    for (const state of ['validation', 'migrating', 'review']) assert.equal(folderContext({ appProperties: { darlart_family: 'kids', darlart_state: state } }).eligible, false);
    assert.deepEqual(folderContext({ appProperties: { darlart_family: 'kids', darlart_state: 'active' } }), { family: 'kids', eligible: true });
});

test('migration uses configured 16-color prices and a separate revision journal', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/ops/migrate-kids.cjs'), 'utf8');
    const body = /function prices\(csv\) \{[\s\S]*?\n\}/.exec(source)[0];
    const prices = new Function('SIZE','COLORS','return (' + body + ')')(config.canvasSize, config.colors);
    assert.equal(config.colors,16);
    assert.deepEqual(prices('canvas_type,size,colors,price\nRolled,24x30,16,189\nStretched,24x30,16,0'),[{canvasType:'Rolled Canvas',price:189}]);
    assert.throws(()=>prices('canvas_type,size,colors,price\nRolled,24x30,18,189'),/Configure positive Kids prices/);
    assert.match(source, /const COLORS = PROFILE.colors/);
    assert.match(source, /"kids-" \+ COLORS \+ "-" \+ SIZE \+ "-hard-v2"/);
    assert.match(source, /"kids-migration-" \+ REVISION/);
    assert.match(source, /"_kids-staging-" \+ REVISION/);
    assert.ok(!source.includes('kids-migration-2026-10-31'));
    assert.ok(!source.includes('remains held for exact-color review'));
});

test('both timestamp-only Classic and execution-qualified Kids queue names resolve safely', () => {
    assert.equal(parseQueueName('2026-11-01_01-02-03_01.jpg').batchId, '2026-11-01_01-02-03');
    assert.equal(parseQueueName('2026-11-01_01-02-03_14739_01.png').batchId, '2026-11-01_01-02-03_14739');
    for (const name of ['a.png', '../01.jpg', '2026-11-01_01-02-03_batch.json']) assert.equal(parseQueueName(name), null);
});

test('Kids profile is configuration-owned and Classic defaults remain intact', () => {
    const base = { colors: 48, canvasSize: '60x75', queueFolderId: 'classic-queue', sizes: '20x25,32x40,40x50', telegramChatId: 'existing-destination' };
    const classic = resolveStageSettings(base, {}, config);
    for (const k of Object.keys(base)) assert.equal(classic[k], base[k]);
    const kids = resolveStageSettings(base, { family: 'kids', colors: 4, canvasSize: '1x1', queueFolderId: 'attacker-input', telegramChatId: 'other' }, config);
    assert.equal(kids.colors, 16);
    assert.equal(kids.canvasSize, '24x30');
    assert.equal(kids.sizes, '24x30');
    assert.equal(kids.queueFolderId, config.queueFolderId);
    assert.equal(kids.telegramChatId, base.telegramChatId);
    assert.throws(() => validateKidsConfig({ ...config, canvasSize: '24x31' }));
    assert.equal(validateKidsConfig({ ...config, canvasSize: '20x25' }).canvasSize, '20x25');
    assert.equal(validateKidsConfig({ ...config, canvasSize: '32x40' }).canvasSize, '32x40');
    new Function(embeddedHelpers());
});

test('thin Kids entry queues durable family data and calls the actual shared Worker', async () => {
    const w = buildKidsWorkflow(config);
    assert.ok(w.nodes.length <= 24);
    const get = name => w.nodes.find(n => n.name === name);
    const calls = w.nodes.filter(n => n.type.endsWith('.executeWorkflow'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parameters.workflowId.value, 'dO8EdyDM4ua2hRrA');
    assert.equal(calls[0].parameters.options.waitForSubWorkflow, false);
    assert.ok(!w.nodes.some(n => n.type.endsWith('.scheduleTrigger')));
    assert.ok(get('Settings').parameters.assignments.assignments.find(a => a.name === 'telegramChatId').value);
    const old = baseline('kids-agent');
    assert.equal(get('Formulaire').webhookId, old.nodes.find(n => n.type.endsWith('.formTrigger')).webhookId);
    const names = new Set(w.nodes.map(n => n.name));
    for (const [from, outputs] of Object.entries(w.connections)) {
        assert.ok(names.has(from));
        for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) assert.ok(names.has(edge.node));
    }
    for (const n of w.nodes.filter(n => n.type.endsWith('.code'))) new AsyncFunction(n.parameters.jsCode);
    const checked = [{ json: { batchId: '2026-11-01_01-02-03_14739', queueName: '2026-11-01_01-02-03_14739_01.png', originalName: 'input.png', refused: [] } }];
    const result = await new AsyncFunction('$', '$now', 'Buffer', get('Batch manifest').parameters.jsCode)(() => ({ all: () => checked }), { setZone: () => ({ toISO: () => '2026-11-01T01:02:03+01:00' }) }, Buffer);
    const manifest = JSON.parse(Buffer.from(result[0].binary.data.data, 'base64').toString());
    assert.equal(manifest.family, 'kids');
    assert.equal(manifest.files[0].status, 'queued');
    assert.equal(manifest.profileVersion, config.version);
});
