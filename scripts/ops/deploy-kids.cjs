/** Deploy on n8n-vm. Preserves live settings/credentials; snapshots every changed workflow. */
const fs = require("fs");
const path = require("path");
const { n8n } = require("./n8n-connection.cjs");
const { applyClassicKidsGuards } = require("../lib/kids-guards.js");
const targetNames = ["Titling Agent", "Print Agent", "Shopify Uploader", "Price Sync", "Translation Sync", "Queue Watchdog"].map((s) => "Darl'Art " + s);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = "/home/n8n/.n8n/backups/kids-" + stamp;
const bodyOf = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => !["binaryMode", "availableInMCP"].includes(k))) });
async function main() {
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const listed = (await n8n("workflows?limit=100")).data;
    const lives = [];
    for (const w of listed.filter((w) => w.active && w.name.startsWith("Darl'Art"))) lives.push(await n8n("workflows/" + w.id));
    const credentialByType = {};
    for (const w of lives) for (const n of w.nodes) Object.assign(credentialByType, n.credentials || {});
    // Price/translation guards are deployed first; no stale Classic pricing can reach migrated Kids.
    for (const name of [...targetNames].sort((a, b) => Number(!a.includes("Sync")) - Number(!b.includes("Sync")))) {
        const original = lives.find((w) => w.name === name);
        if (!original) throw new Error("Missing active workflow: " + name);
        fs.writeFileSync(path.join(backup, original.id + ".json"), JSON.stringify(original, null, 2), { mode: 0o600 });
        const changed = applyClassicKidsGuards(structuredClone(original));
        if (JSON.stringify(original.nodes) === JSON.stringify(changed.nodes)) { console.log("Already guarded: " + name); continue; }
        await n8n("workflows/" + original.id, "PUT", bodyOf(changed));
        await n8n("workflows/" + original.id + "/deactivate", "POST");
        await n8n("workflows/" + original.id + "/activate", "POST");
        const check = await n8n("workflows/" + original.id);
        if (!check.active) throw new Error("Workflow failed to reactivate: " + name);
        console.log("Guarded and published: " + name);
    }
    const kids = JSON.parse(fs.readFileSync(path.join(__dirname, "../../automation/n8n-darlart-kids-agent.json"), "utf8"));
    for (const n of kids.nodes) {
        const auth = n.parameters.nodeCredentialType || n.parameters.genericAuthType;
        if (auth && credentialByType[auth]) n.credentials = { [auth]: credentialByType[auth] };
        if (n.type === "n8n-nodes-base.googleDrive") n.credentials = { googleDriveOAuth2Api: credentialByType.googleDriveOAuth2Api };
        if (n.type.includes("lmChatOpenAi")) n.credentials = { openAiApi: credentialByType.openAiApi };
        if (n.type === "n8n-nodes-base.telegram") n.credentials = { telegramApi: credentialByType.telegramApi };
        if (n.name === "Operations") n.credentials = { httpHeaderAuth: credentialByType.httpHeaderAuth };
    }
    // The existing x-api-key credential is selected explicitly; other Header Auth connections are unrelated.
    const key = lives.find((w) => w.name === "Darl'Art Artwork Worker").nodes.find((n) => n.name === "Snap to palette (48 colors)").credentials.httpHeaderAuth;
    for (const n of kids.nodes) if (n.parameters.genericAuthType === "httpHeaderAuth" || n.name === "Operations") n.credentials = { httpHeaderAuth: key };
    let existing = listed.find((w) => w.name === kids.name);
    if (existing) {
        const original = await n8n("workflows/" + existing.id);
        fs.writeFileSync(path.join(backup, existing.id + ".json"), JSON.stringify(original, null, 2), { mode: 0o600 });
        existing = await n8n("workflows/" + existing.id, "PUT", bodyOf(kids));
        if (original.active) await n8n("workflows/" + existing.id + "/deactivate", "POST");
    } else existing = await n8n("workflows", "POST", bodyOf(kids));
    await n8n("workflows/" + existing.id + "/activate", "POST");
    const verified = await n8n("workflows/" + existing.id);
    if (!verified.active) throw new Error("Kids workflow is not published");
    const report = { workflowId: verified.id, name: verified.name, nodes: verified.nodes.length, active: verified.active, backup, formUrl: "https://n8n-vm.taildc9f8f.ts.net/form/darlart-kids-upload" };
    fs.writeFileSync(path.join(backup, "deployment.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    fs.writeFileSync("/home/n8n/.n8n/backups/kids-deployment-latest.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
