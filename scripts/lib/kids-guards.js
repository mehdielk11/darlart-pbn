/** Small, idempotent ownership guards shared by generators and the live deployment. */
function applyClassicKidsGuards(workflow) {
    const get = (name) => workflow.nodes.find((n) => n.name === name);
    const listing = get("List Artwork Agent folders") || get("List Artwork Agent");
    const folders = get("Folders") || get("Recent folders");
    if (listing && folders) {
        const fields = listing.parameters.queryParameters.parameters.find((p) => p.name === "fields");
        if (!fields.value.includes("appProperties")) fields.value = fields.value.replace("files(", "files(appProperties,");
        if (!folders.parameters.jsCode.includes("darlart_family")) {
            const needle = '/^\\d+$/.test(String(f.name).trim())';
            if (!folders.parameters.jsCode.includes(needle)) throw new Error("Unknown folder filter in " + workflow.name);
            folders.parameters.jsCode = folders.parameters.jsCode.replace(needle,
                needle + ' && (f.appProperties || {}).darlart_family !== "kids"');
        }
    }
    const build = get("Build product JSON");
    if (build && !build.parameters.jsCode.includes("family is selected at upload")) {
        build.parameters.jsCode = build.parameters.jsCode.replace('const out = $json.output || {};',
            '// The family is selected at upload; the Classic form cannot create Kids products.\nconst out = { ...($json.output || {}), kids: false };');
        build.parameters.jsCode = build.parameters.jsCode.replace('if (clean && !tags.includes(clean))',
            'if (clean && clean !== "kids-kits" && !tags.includes(clean))');
    }
    const collect = get("Collect products");
    if (collect && get("Products page") && !collect.parameters.jsCode.includes("Kids are owned")) {
        const page = get("Products page");
        if (!page.parameters.jsonBody.includes("handle tags")) {
            page.parameters.jsonBody = page.parameters.jsonBody.replace("id title handle descriptionHtml", "id title handle tags descriptionHtml");
        }
        const code = collect.parameters.jsCode;
        if (code.includes("const mine = page.nodes.filter((p) => {")) {
            collect.parameters.jsCode = code.replace('const mine = page.nodes.filter((p) => {',
                'const mine = page.nodes.filter((p) => {\n    // Kids are owned by the independent Kids workflow.\n    if ((p.tags || []).includes("kids-kits")) return false;');
        } else if (code.includes("for (const p of page.nodes) {")) {
            collect.parameters.jsCode = code.replace('for (const p of page.nodes) {',
                'for (const p of page.nodes) {\n    // Kids are owned by the independent Kids workflow.\n    if ((p.tags || []).includes("kids-kits")) continue;');
        } else throw new Error("Unknown product ownership filter in " + workflow.name);
    }
    return workflow;
}
module.exports = { applyClassicKidsGuards };
