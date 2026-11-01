/** Common hook used by every maintained workflow generator. No network access. */
const fs = require('fs');
const path = require('path');
const adapters = require('./shared-agents');
const { applyClassicKidsGuards } = require('./kids-guards');
const functions = {
    "Darl'Art Artwork Worker": adapters.adaptWorker,
    "Darl'Art Titling Agent": adapters.adaptTitling,
    "Darl'Art Print Agent": adapters.adaptPrint,
    "Darl'Art Shopify Uploader": adapters.adaptUploader,
    "Darl'Art Price Sync": adapters.adaptPriceSync,
    "Darl'Art Translation Sync": adapters.adaptTranslation,
    "Darl'Art Queue Watchdog": adapters.adaptWatchdog,
    "Darl'Art Error Handler": adapters.adaptErrorHandler,
};
function applySharedProductProfiles(workflow) {
    const apply = functions[workflow.name];
    if (!apply) throw new Error('Unsupported shared workflow: ' + workflow.name);
    const settings = workflow.nodes.find(n => n.name === 'Settings');
    if (settings?.parameters.jsCode?.includes('resolveStageSettings(base,')) return workflow;
    applyClassicKidsGuards(workflow);
    if (workflow.name === "Darl'Art Artwork Worker") {
        const condition = workflow.nodes.find(n => n.name === 'OpenAI account problem?');
        if (condition) Object.assign(condition.parameters.conditions.options, { typeValidation: 'strict', version: 1 });
    }
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../automation/kids-config.json')));
    Object.assign(workflow, apply(workflow, config));
    return workflow;
}
module.exports = { applySharedProductProfiles };
