/** Build from maintained source templates, never from a deployed workflow or API. */
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const names = ['artwork-agent', 'titling-agent', 'print-agent', 'shopify-uploader', 'price-sync', 'translation-sync', 'queue-watchdog', 'error-handler', 'kids'];
for (const name of names) {
    execFileSync(process.execPath, [path.join(__dirname, 'build-' + name + '-workflow.js')], { cwd: root, stdio: 'inherit' });
}
console.log('Generated shared workflows and thin Kids entry locally. Nothing was deployed.');
