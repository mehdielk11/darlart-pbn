/** Resumable, staged migration of existing Kids products. Run on n8n-vm as n8n.
 * --inspect only reads. --folders=1150,1108 selects pilots. --all migrates remaining Kids.
 * Originals are moved into Archive/classic-before-kids, never deleted.
 */
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { google, shopify, pbnKey, n8n } = require("./n8n-connection.cjs");
const Q = require("./kids-shopify.cjs");
const ROOT = "1OwvTpeI7Y2a7FV_VWvYZmsgrY2tWS2HH";
const SHEET = "1iv2qOUSHPMWgdlZ5ZoCxx9WPljK9V3eWKZp7cYlB9Pk";
const BACKUP = "/home/n8n/.n8n/backups/kids-migration-2026-10-31";
const SIZE = "24x30";
const REVISION = "kids-18-24x30-hard-v1";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function list(folder) {
    const out = []; let page;
    do {
        const q = new URLSearchParams({ q: "'" + folder + "' in parents and trashed=false", fields: "nextPageToken,files(id,name,mimeType,appProperties,parents)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(page ? { pageToken: page } : {}) });
        const r = await google(DRIVE + "?" + q); out.push(...r.files); page = r.nextPageToken;
    } while (page);
    return out;
}
const file = (id) => google(DRIVE + "/" + id + "?alt=media&supportsAllDrives=true", {}, true);
const jsonFile = async (id) => JSON.parse((await file(id)).toString("utf8"));
async function folder(parent, name) {
    const existing = (await list(parent)).find((f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder");
    return existing || google(DRIVE + "?supportsAllDrives=true&fields=id,name", { method: "POST", json: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] } });
}
async function upload(parent, name, bytes, mimeType) {
    const existing = (await list(parent)).find((f) => f.name === name);
    if (existing) return existing;
    const boundary = "kids-" + randomUUID();
    const body = Buffer.concat([Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name, parents: [parent] }) + "\r\n--" + boundary + "\r\nContent-Type: " + mimeType + "\r\n\r\n"), bytes, Buffer.from("\r\n--" + boundary + "--\r\n")]);
    return google("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { "content-type": "multipart/related; boundary=" + boundary }, body });
}
async function saveJson(parent, name, value) { return upload(parent, name, Buffer.from(JSON.stringify(value, null, 2)), "application/json"); }
async function move(f, from, to) { return google(DRIVE + "/" + f.id + "?supportsAllDrives=true&addParents=" + to + "&removeParents=" + from + "&fields=id,name", { method: "PATCH", json: {} }); }
async function properties(id, value) { return google(DRIVE + "/" + id + "?supportsAllDrives=true&fields=id,name,appProperties", { method: "PATCH", json: { appProperties: value } }); }
async function pbn(route, fields, image, binary = false) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append("image", new Blob([image], { type: "image/png" }), "art.png");
    const r = await fetch("http://127.0.0.1:3000" + route, { method: "POST", headers: { "x-api-key": pbnKey() }, body: form, signal: AbortSignal.timeout(600000) });
    if (!r.ok) throw new Error("PBN " + route + ": HTTP " + r.status + " " + (await r.text()).slice(0, 400));
    return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
}
async function job(image, number) {
    const created = await pbn("/v1/jobs", { canvasSize: SIZE, colors: 18, difficulty: "hard", orientation: "auto", cropMode: "center", paperSize: "a4", palette: "darlart-v3", orderId: number, requireExactColors: true, physicalSvg: true, paintCanvasSizes: SIZE }, image);
    const started = Date.now();
    while (Date.now() - started < 15 * 60000) {
        await sleep(3000);
        const r = await fetch("http://127.0.0.1:3000/v1/jobs/" + created.jobId, { headers: { "x-api-key": pbnKey() } }).then((r) => r.json());
        if (r.status === "failed") throw new Error("PBN template: " + r.error);
        if (r.status === "completed") {
            if (r.result.colorsUsed !== 18) throw new Error("Final template does not use exactly 18 paints");
            return { id: created.jobId, result: r.result };
        }
    }
    throw new Error("PBN job exceeded migration timeout");
}
async function jobFile(id, name) {
    const r = await fetch("http://127.0.0.1:3000/v1/jobs/" + id + "/files/" + encodeURIComponent(name), { headers: { "x-api-key": pbnKey() } });
    if (!r.ok) throw new Error("Missing production file " + name);
    return Buffer.from(await r.arrayBuffer());
}
async function shopImage(bytes, filename) {
    const staged = await shopify(Q.stage, { input: [{ filename, mimeType: "image/webp", resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }] });
    const target = staged.stagedUploadsCreate.stagedTargets[0];
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const form = new FormData(); for (const p of target.parameters) form.append(p.name, p.value);
            form.append("file", new Blob([bytes], { type: "image/webp" }), filename);
            const r = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
            if (!r.ok) throw new Error("Shopify image upload failed: HTTP " + r.status);
            return target.resourceUrl;
        } catch (e) {
            if (attempt === 2) throw e;
            await sleep((attempt + 1) * 2000);
        }
    }
    throw new Error("Shopify image upload did not complete");
}
function prices(csv) {
    const lines = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
    const rows = lines.filter((r) => r[1] === SIZE && r[2] === "18").map((r) => ({ canvasType: r[0].replace(/ Canvas$/, "") + " Canvas", price: Number(r[3]) }));
    if (rows.some((r) => !Number.isFinite(r.price) || r.price < 0) || !rows.some((r) => r.price > 0)) throw new Error("Configure positive Kids prices before migration");
    return rows.filter((r) => r.price > 0);
}
async function main() {
    let after = null, products = [];
    do { const r = (await shopify(Q.list, { after })).products; products.push(...r.nodes); after = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null; } while (after);
    const folders = await list(ROOT);
    const selected = process.argv.find((s) => s.startsWith("--folders="))?.split("=")[1].split(",");
    const todo = products.map((p) => ({ ...p, number: /-(\d{4,})$/.exec(p.handle)?.[1] })).filter((p) => p.number && (!selected || selected.includes(p.number)));
    if (process.argv.includes("--inspect")) {
        for (const p of todo) {
            const f = folders.find((f) => f.name === p.number);
            const files = f ? await list(f.id) : [];
            const pal = files.find((f) => f.name.endsWith("_palette.json"));
            const data = pal ? await jsonFile(pal.id) : {};
            console.log(JSON.stringify({ number: p.number, title: p.title, productId: p.id, folderId: f?.id, width: data.width, height: data.height, colors: data.colorCount, variants: p.variants.nodes.length, family: f?.appProperties?.darlart_family }));
        }
        return;
    }
    if (!selected && !process.argv.includes("--all")) throw new Error("Select --folders=<numbers>, --all or --inspect");
    const active = (await n8n("executions?status=running&limit=100")).data;
    const shared = new Set(["tOSHbCt7hJ6ORh8a", "ytxV3m341mDLCdt4", "XAwk67SiWmvVSu1d", "HbKP2SZ1ZF4ZhgCf", "8uovjpS8dNC8RkZL"]);
    if (active.some((e) => shared.has(e.workflowId))) throw new Error("A shared agent is running; retry migration when it finishes");
    const sold = prices((await google("https://docs.google.com/spreadsheets/d/" + SHEET + "/export?format=csv&gid=188180018", {}, true)).toString("utf8"));
    fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 });
    const report = [];
    for (const p of todo) {
        const f = folders.find((f) => f.name === p.number);
        if (!f) throw new Error("No Drive folder for " + p.number);
        if (f.appProperties?.darlart_revision === REVISION && f.appProperties?.darlart_state === "active") { console.log(p.number + " already migrated"); continue; }
        if (!selected && f.appProperties?.darlart_state === "review" && f.appProperties?.darlart_review_reason === "exact-colors") {
            console.log(p.number + " remains held for exact-color review");
            report.push({ number: p.number, status: "held", error: "Exact-color review; original listing unchanged" });
            continue;
        }
        console.log(p.number + " staging: " + p.title);
        const journalPath = path.join(BACKUP, p.number + ".json");
        const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath)) : { originalProduct: p, originalFolder: f, originalFiles: await list(f.id) };
        const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
        save();
        await properties(f.id, { ...(f.appProperties || {}), darlart_family: "kids", darlart_state: "migrating" });
        try {
            const original = journal.originalFiles;
            const art = original.find((x) => x.name.endsWith("_art.png"));
            if (!art) throw new Error("Artwork missing for " + p.number);
            const stem = art.name.slice(0, -"_art.png".length);
            const stage = await folder(f.id, "_kids-staging-v1");
            const output = {};
            if (!journal.staged) {
                const recolored = await pbn("/v1/recolor", { colors: 18, palette: "darlart-v3", canvasSize: SIZE, orientation: "auto", smooth: 3 }, await file(art.id));
                if (recolored.colorCount !== 18) throw new Error("Artwork must use exactly 18 paints");
                const image = Buffer.from(recolored.image, "base64");
                output[art.name] = [image, "image/png"];
                output[stem + "_palette.json"] = [Buffer.from(JSON.stringify({ artwork: art.name, reference: original.find((x) => /_ref\./.test(x.name))?.name, palette: "darlart-v3", colorCount: 18, width: recolored.width, height: recolored.height, colors: recolored.colors, canvasSize: SIZE, difficulty: "hard", revision: REVISION }, null, 2)), "application/json"];
                const productFile = original.find((x) => x.name.endsWith("_product.json"));
                if (!productFile) throw new Error("Product metadata missing");
                const data = await jsonFile(productFile.id);
                output[productFile.name] = [Buffer.from(JSON.stringify({ ...data, kids: true, generation: { colors: 18, canvasSize: SIZE, difficulty: "hard", revision: REVISION } }, null, 2)), "application/json"];
                console.log(p.number + " generating HARD print at " + SIZE);
                const generated = await job(image, p.number);
                const print = await folder(stage.id, "Print");
                for (const [name, suffix, mime] of [["blank.svg", "_blank.svg", "image/svg+xml"], ["painting.pdf", "_catalog.pdf", "application/pdf"], ["template.pdf", "_user.pdf", "application/pdf"]]) await upload(print.id, stem + "_18" + suffix, await jobFile(generated.id, name), mime);
                const templatePalette = generated.result.palette.flatMap((g) => g.colors).filter((c) => c.used).map((c) => c.code).sort();
                if (templatePalette.join(",") !== recolored.colors.map((c) => c.code).sort().join(",")) throw new Error("Artwork and print palettes differ");
                output[stem + "_mockup.png"] = [await jobFile(generated.id, "mockup.png"), "image/png"];
                const featured = await pbn("/v1/featured", {}, image);
                output[stem + "_featured.png"] = [Buffer.from(featured.image, "base64"), "image/png"];
                for (const kind of ["featured", "mockup"]) {
                    const webp = await pbn("/v1/webp", { quality: 88 }, output[stem + "_" + kind + ".png"][0]);
                    output[stem + "_" + kind + ".webp"] = [Buffer.from(webp.image, "base64"), "image/webp"];
                }
                for (const [name, [bytes, mime]] of Object.entries(output)) await upload(stage.id, name, bytes, mime);
                journal.staged = { folderId: stage.id, stem, result: { colorsUsed: generated.result.colorsUsed, canvas: generated.result.canvas, paints: generated.result.paints } }; save();
            }
            const stageFiles = await list(stage.id);
            if (!journal.updatedProduct) {
                const urls = {};
                for (const kind of ["featured", "mockup"]) {
                    const media = stageFiles.find((x) => x.name === stem + "_" + kind + ".webp");
                    if (!media) throw new Error("Staged image missing: " + kind);
                    urls[kind] = await shopImage(await file(media.id), p.number + "-" + kind + "-18.webp");
                }
                const sale = (p.tags || []).map((t) => /^sale-(\d{1,2})$/.exec(t)).find((m) => m && Number(m[1]) > 0);
                const variants = sold.map((row, i) => ({ optionValues: [{ optionName: "Size", name: SIZE }, { optionName: "Canvas Type", name: row.canvasType }, { optionName: "Colors", name: "18" }], price: row.price.toFixed(2), compareAtPrice: sale ? Math.round(row.price / (1 - Number(sale[1]) / 100)).toFixed(2) : null, position: i + 1, inventoryPolicy: "DENY", inventoryItem: { tracked: false, requiresShipping: true, sku: p.number + SIZE.replace("x", "") + "18" + row.canvasType[0] } }));
                const input = { productOptions: [{ name: "Size", position: 1, values: [{ name: SIZE }] }, { name: "Canvas Type", position: 2, values: sold.map((r) => ({ name: r.canvasType })) }, { name: "Colors", position: 3, values: [{ name: "18" }] }], variants,
                    files: [{ originalSource: urls.featured, contentType: "IMAGE", alt: p.title + " — 18 colors" }, { originalSource: urls.mockup, contentType: "IMAGE", alt: p.title + " — 18-color kit" }, ...journal.originalProduct.media.nodes.slice(2).map((m) => ({ id: m.id }))] };
                journal.updatedProduct = (await shopify(Q.update, { identifier: { id: p.id }, input })).productSet.product; save();
            }
            let check;
            for (let i = 0; i < 12; i++) {
                check = (await shopify(Q.media, { id: p.id })).product;
                const first = check.media.nodes.find((m) => m.alt === p.title + " — 18 colors");
                const second = check.media.nodes.find((m) => m.alt === p.title + " — 18-color kit");
                if (first && second && check.media.nodes[0].id === first.id && check.media.nodes[1].id === second.id) break;
                if (first && second) {
                    const r = await shopify(Q.reorder, { id: p.id, moves: [{ id: first.id, newPosition: "0" }, { id: second.id, newPosition: "1" }] });
                    if (r.productReorderMedia.mediaUserErrors?.length) throw new Error(JSON.stringify(r.productReorderMedia.mediaUserErrors));
                }
                await sleep(3000);
            }
            if (check.handle !== journal.originalProduct.handle || check.status !== journal.originalProduct.status || check.variants.nodes.length !== sold.length || check.variants.nodes.some((v) => !v.selectedOptions.some((o) => o.name === "Colors" && o.value === "18"))) throw new Error("Shopify readback failed");
            if (check.media.nodes[0].alt !== p.title + " — 18 colors" || check.media.nodes[1].alt !== p.title + " — 18-color kit") throw new Error("Shopify image order not confirmed");
            const marker = { productId: p.id, handle: p.handle, title: p.title, status: p.status, adminUrl: "https://admin.shopify.com/store/smgi0i-0a/products/" + p.id.split("/").pop(), variants: sold.length, images: check.media.nodes.map((m) => m.id), onlineStore: "preserved", revision: REVISION, uploadedAt: new Date().toISOString() };
            const oldMarker = original.find((x) => x.name.endsWith("_shopify.json"));
            await saveJson(stage.id, oldMarker?.name || stem + "_shopify.json", marker);
            const archive = await folder((await folder(f.id, "Archive")).id, "classic-before-kids");
            const replacing = new Set((await list(stage.id)).map((x) => x.name));
            if (!journal.promoted) {
                const current = await list(f.id);
                for (const old of current.filter((x) => replacing.has(x.name))) await move(old, f.id, archive.id);
                for (const next of await list(stage.id)) await move(next, stage.id, f.id);
                journal.promoted = true; save();
            }
            await properties(f.id, { ...(f.appProperties || {}), darlart_family: "kids", darlart_state: "active", darlart_size: SIZE, darlart_colors: "18", darlart_revision: REVISION });
            journal.completedAt = new Date().toISOString(); journal.verified = check; save();
            await google(DRIVE + "/" + stage.id + "?supportsAllDrives=true", { method: "PATCH", json: { trashed: true } });
            console.log(p.number + " migrated: " + sold.length + " variant, 18 paints, " + journal.staged.result.canvas.label + ", URL preserved");
            report.push({ number: p.number, status: "complete", variants: sold.length });
        } catch (e) {
            journal.error = e.message; save();
            await properties(f.id, { ...(f.appProperties || {}), darlart_family: "kids", darlart_state: "review", darlart_review_reason: /Exact color validation failed|18 paints/.test(e.message) ? "exact-colors" : "migration-error" });
            console.error(p.number + " held for review: " + e.message); report.push({ number: p.number, status: "held", error: e.message });
            // Stop the batch if Shopify was updated but Drive promotion has not yet completed.
            if (journal.updatedProduct && !journal.promoted) break;
        }
    }
    fs.writeFileSync(path.join(BACKUP, "last-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ backup: BACKUP, report }));
    if (report.some((r) => r.status === "held")) process.exitCode = 1;
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
