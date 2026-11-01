/** Offline import preparation. Copies credential REFERENCES, never tokens or decrypted credentials. */
const fs = require('fs');
const path = require('path');
const stages = ['artwork-worker','titling-agent','print-agent','shopify-uploader','price-sync','translation-sync','queue-watchdog','error-handler','kids-agent'];
function prepareImports(snapshotDir, outputDir, root = path.resolve(__dirname, '../..')) {
    fs.mkdirSync(outputDir, { recursive: true });
    const report = [];
    for (const stage of stages) {
        const file = 'n8n-darlart-' + stage + '.json';
        const live = JSON.parse(fs.readFileSync(path.join(snapshotDir, file)));
        const candidate = JSON.parse(fs.readFileSync(path.join(root, 'automation', file)));
        if (candidate.name !== live.name || !live.id) throw new Error('Unexpected target for ' + file);
        const credentials = {};
        for (const n of live.nodes) for (const [type, ref] of Object.entries(n.credentials || {})) {
            if (credentials[type] && credentials[type].id !== ref.id) throw new Error('Ambiguous credential type ' + type + ' in ' + live.name);
            credentials[type] = ref;
        }
        for (const n of candidate.nodes) {
            let auth = n.parameters.nodeCredentialType || n.parameters.genericAuthType;
            if (n.type.endsWith('.googleDrive')) auth = 'googleDriveOAuth2Api';
            if (n.type.endsWith('.telegram')) auth = 'telegramApi';
            if (n.type.includes('lmChatOpenAi')) auth = 'openAiApi';
            if (n.type.endsWith('.n8n')) auth = 'n8nApi';
            if (auth) {
                if (!credentials[auth]) throw new Error('Missing existing credential ' + auth + ' for ' + live.name + '/' + n.name);
                n.credentials = { [auth]: credentials[auth] };
            }
        }
        candidate.id = live.id;
        candidate.settings = { ...live.settings, ...candidate.settings };
        candidate.active = false;
        delete candidate.versionId; delete candidate.activeVersionId; delete candidate.meta; delete candidate.pinData;
        fs.writeFileSync(path.join(outputDir, file), JSON.stringify(candidate, null, 2) + '\n');
        report.push({ file, id: live.id, name: live.name, nodes: candidate.nodes.length, credentialTypes: Object.keys(credentials) });
    }
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
}
if (require.main === module) {
    const [snapshots, output] = process.argv.slice(2);
    if (!snapshots || !output) throw new Error('Usage: node scripts/ops/prepare-shared-imports.cjs SNAPSHOT_DIRECTORY OUTPUT_DIRECTORY');
    console.log(JSON.stringify(prepareImports(path.resolve(snapshots), path.resolve(output))));
}
module.exports = { prepareImports };
