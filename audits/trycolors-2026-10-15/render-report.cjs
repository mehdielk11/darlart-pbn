const fs = require('fs');
const path = require('path');
const root = __dirname;
const markdown = fs.readFileSync(path.join(root, 'REPORT.md'), 'utf8');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => escape(s)
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');
const lines = markdown.split(/\r?\n/);
const toc = [];
const output = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  const heading = line.match(/^(#{1,3}) (.+)$/);
  if (heading) {
    const level = heading[1].length;
    const id = 'section-' + i;
    if (level === 2) toc.push(`<a href="#${id}">${inline(heading[2])}</a>`);
    output.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
    i++; continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    const cells = row => row.trim().slice(1,-1).split('|').map(c=>c.trim());
    const head = cells(rows[0]).map(c=>`<th scope="col">${inline(c)}</th>`).join('');
    const body = rows.slice(2).map(r=>`<tr>${cells(r).map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    output.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
    continue;
  }
  if (/^(- |\d+\. )/.test(line)) {
    const ordered = /^\d/.test(line);
    const items = [];
    while (i < lines.length && (ordered ? /^\d+\. / : /^- /).test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^(- |\d+\. )/,''))}</li>`);
    output.push(`<${ordered?'ol':'ul'}>${items.join('')}</${ordered?'ol':'ul'}>`);
    continue;
  }
  if (line.startsWith('![')) { output.push(inline(line)); i++; continue; }
  const paragraph = [];
  while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- |\d+\. |!\[)/.test(lines[i])) paragraph.push(lines[i++]);
  output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trycolors — Detailed Feature Audit • 15 October 2026</title><style>
:root{color-scheme:light;--ink:#172e34;--muted:#576b70;--accent:#00796c;--line:#dce6e5;--bg:#f4f7f6}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 system-ui,-apple-system,Segoe UI,sans-serif}header{background:#123f3e;color:#fff;padding:32px max(24px,calc((100vw - 1320px)/2));border-top:7px solid #9ed8bd}header small{letter-spacing:.15em;text-transform:uppercase;color:#bce8db}header p{margin:6px 0 0;color:#d5e8e4}nav{position:sticky;top:20px;align-self:start;background:#fff;padding:22px;border:1px solid var(--line);border-radius:12px;max-height:94vh;overflow:auto;font-size:13px;line-height:1.5}nav a{display:block;margin:9px 0;text-decoration:none;color:#3d6064}nav strong{font-size:14px}main{max-width:1370px;margin:30px auto;display:grid;grid-template-columns:250px minmax(0,1fr);gap:28px;padding:0 24px}article{background:#fff;border:1px solid var(--line);border-radius:12px;padding:36px 42px;min-width:0}h1{font-size:34px;line-height:1.2;letter-spacing:-.03em;margin-top:0}h2{font-size:25px;line-height:1.3;margin-top:55px;padding-top:22px;border-top:2px solid var(--line);scroll-margin-top:20px}h3{font-size:19px;margin-top:30px}a{color:var(--accent);text-underline-offset:3px}p,li{max-width:84ch}li{margin:8px 0}.table-wrap{overflow:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.55}th{background:#e8f3ef;text-align:left}td,th{border:1px solid var(--line);padding:11px 12px;vertical-align:top}tr:nth-child(even) td{background:#fafcfb}figure{margin:30px 0;padding:12px;background:#f0f4f3;border-radius:10px}figure img{display:block;max-width:100%;max-height:650px;margin:auto;object-fit:contain}figcaption{text-align:center;font-size:12px;color:var(--muted);margin-top:8px}code{background:#edf2f1;padding:2px 5px;border-radius:4px}footer{text-align:center;color:var(--muted);padding:20px 20px 50px;font-size:13px}@media(max-width:950px){main{display:block}nav{position:static;max-height:270px;margin-bottom:22px}article{padding:24px}h1{font-size:28px}}@media print{header,nav,footer{display:none}main{display:block;margin:0;padding:0}article{padding:0;border:0}body{background:#fff;font-size:10pt}h2{break-after:avoid}table{font-size:8pt}tr,figure{break-inside:avoid}figure img{max-height:600px}a{color:inherit}}
</style></head><body><header><small>Product research / feature audit</small><p>Trycolors • 15 October 2026 • Chrome desktop and mobile emulation</p></header><main><nav aria-label="Report contents"><strong>CONTENTS</strong>${toc.join('')}</nav><article>${output.join('\n')}</article></main><footer>Local audit report • Tested behavior, vendor claims, and unverified areas are identified separately.</footer></body></html>`;
const images = [...html.matchAll(/<img src="([^"]+)"/g)].map(m=>m[1]);
for (const image of images) if (!fs.existsSync(path.join(root,image))) throw new Error('Missing image: '+image);
const standalone = html.replace(/src="(screenshots\/[^\"]+)"/g, (_, file) => `src="data:image/jpeg;base64,${fs.readFileSync(path.join(root,file)).toString('base64')}"`);
fs.writeFileSync(path.join(root, 'REPORT.html'), standalone);
console.log(JSON.stringify({words:markdown.split(/\s+/).length,sections:toc.length,embeddedImages:images.length,htmlBytes:Buffer.byteLength(standalone)}));
