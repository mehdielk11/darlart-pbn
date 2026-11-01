/** Shared build-time contract. Embedded functions must remain self-contained for n8n Code nodes. */
function validateKidsConfig(config) {
    const colors = Number(config.colors ?? 16);
    if (!Number.isInteger(colors) || colors < 2 || colors > 64) throw new Error('Kids colors must be an integer from 2 to 64');
    const size = String(config.canvasSize || '24x30').toLowerCase();
    if (!/^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/.test(size)) throw new Error('Invalid Kids canvas size');
    const [w, h] = size.split('x').map(Number);
    if (w < 20 || w > 32 || Math.abs(h / w - 1.25) > 1e-8) throw new Error('Kids canvas must be 4:5 from 20x25 to 32x40');
    for (const field of ['queueFolderId', 'doneFolderId', 'refFolderId', 'failedFolderId']) {
        if (!String(config[field] || '').trim()) throw new Error('Missing Kids ' + field);
    }
    return { ...config, colors, canvasSize: size, version: 'shared-kids-' + colors + '-v2' };
}

function resolveFamily(value) {
    const family = value === undefined || value === null || value === '' ? 'classic' : value;
    if (family !== 'classic' && family !== 'kids') throw new Error('Unknown product family');
    return family;
}

function folderContext(folder) {
    const metadata = folder.appProperties || {};
    const family = resolveFamily(metadata.darlart_family);
    return { family, eligible: !['migrating', 'review', 'validation'].includes(metadata.darlart_state) };
}

function parseQueueName(name) {
    const match = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?)_(\d{2})\.(jpg|jpeg|png|webp)$/i.exec(name);
    return match ? { batchId: match[1], index: Number(match[2]), extension: match[3].toLowerCase() } : null;
}

function resolveStageSettings(base, input, config) {
    const family = resolveFamily(input.family);
    // Invocation cannot override prices, physical dimensions, colors or destination IDs.
    const settings = { ...base, family, profileVersion: family === 'kids' ? config.version : 'classic-v1' };
    if (Object.prototype.hasOwnProperty.call(base, 'runMode')) settings.runMode = input.mode || 'upload';
    if (family === 'kids') {
        settings.kidsColors = config.colors;
        const overrides = {
            colors: config.colors, canvasSize: config.canvasSize, colorsList: String(config.colors), canvasSizes: config.canvasSize,
            mockupColors: config.colors, difficulty: 'hard', sizes: config.canvasSize, cropMode: 'center',
            queueFolderId: config.queueFolderId, doneFolderId: config.doneFolderId,
            refFolderId: config.refFolderId, failedFolderId: config.failedFolderId,
            batchDoneFolderId: config.doneFolderId,
        };
        for (const key of Object.keys(overrides)) if (Object.prototype.hasOwnProperty.call(base, key)) settings[key] = overrides[key];
    }
    return settings;
}

function embeddedHelpers() {
    return [resolveFamily, folderContext, parseQueueName, resolveStageSettings].map(fn => fn.toString()).join('\n');
}

module.exports = { validateKidsConfig, resolveFamily, folderContext, parseQueueName, resolveStageSettings, embeddedHelpers };
