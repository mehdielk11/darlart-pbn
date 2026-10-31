/** Server-side operational access through the store's existing n8n connections.
 * Never logs, exports or persists decrypted credentials. Run on n8n-vm as n8n.
 */
const fs = require("fs");
const { execFileSync } = require("child_process");
const { Cipher } = require("/usr/lib/node_modules/n8n/node_modules/n8n-core/dist/encryption/cipher.js");
const config = JSON.parse(fs.readFileSync("/home/n8n/.n8n/config", "utf8"));
const cipher = new Cipher({ encryptionKey: config.encryptionKey });
const cache = new Map();
function credential(id) {
    if (!cache.has(id)) {
        const py = "import sqlite3,sys; c=sqlite3.connect('file:/home/n8n/.n8n/database.sqlite?mode=ro',uri=True); r=c.execute('select data from credentials_entity where id=?',(sys.argv[1],)).fetchone(); print(r[0] if r else '')";
        const encrypted = execFileSync("python3", ["-c", py, id], { encoding: "utf8" }).trim();
        if (!encrypted) throw new Error("Missing existing connection " + id);
        cache.set(id, JSON.parse(cipher.decrypt(encrypted)));
    }
    return cache.get(id);
}
async function googleToken(force = false) {
    const c = credential("GTur437Dbf15PYS0");
    const token = c.oauthTokenData;
    if (!token) throw new Error("Google Drive connection needs authentication");
    if (!force && (!token.expires_at || token.expires_at * 1000 > Date.now() + 60000)) return token.access_token;
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: c.clientId, client_secret: c.clientSecret }) });
    if (!r.ok) throw new Error("Google Drive token refresh failed: HTTP " + r.status);
    const fresh = await r.json();
    Object.assign(token, fresh, { expires_at: Date.now() / 1000 + fresh.expires_in });
    return token.access_token;
}
async function response(r, binary = false) {
    if (!r.ok) throw new Error("Service request failed: HTTP " + r.status + " " + (await r.text()).slice(0, 500));
    if (binary) return Buffer.from(await r.arrayBuffer());
    if (r.status === 204) return null;
    return r.json();
}
async function google(url, options = {}, binary = false) {
    const headers = { authorization: "Bearer " + await googleToken(), ...options.headers };
    if (options.json) { headers["content-type"] = "application/json"; options = { ...options, body: JSON.stringify(options.json) }; delete options.json; }
    let r = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(options.timeout || 120000) });
    if (r.status === 401) {
        headers.authorization = "Bearer " + await googleToken(true);
        r = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(options.timeout || 120000) });
    }
    return response(r, binary);
}
async function shopify(query, variables = {}) {
    const c = credential("yCalNsUyqYeDSyYz");
    const token = c.oauthTokenData?.access_token || c.accessToken;
    const r = await response(await fetch("https://smgi0i-0a.myshopify.com/admin/api/2026-07/graphql.json", { method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(120000) }));
    if (r.errors) throw new Error("Shopify GraphQL: " + JSON.stringify(r.errors));
    for (const value of Object.values(r.data || {})) if (value?.userErrors?.length) throw new Error("Shopify: " + JSON.stringify(value.userErrors));
    return r.data;
}
async function n8n(route, method = "GET", body) {
    const c = credential("ZQKDMQcHEIJ9bQXW");
    return response(await fetch("http://127.0.0.1:5678/api/v1/" + route, { method, headers: { "x-n8n-api-key": c.apiKey, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
const pbnKey = () => credential("Y6SSoddfQZVMFkDa").value;
module.exports = { credential, google, shopify, n8n, pbnKey };
