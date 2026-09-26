const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Read the main files
const mainContent = fs.readFileSync('./scripts/main.js', 'utf8');
const uiHandlerContent = fs.readFileSync('./scripts/ui-handler.js', 'utf8');

// Combine the files and append an AMD bootstrap that loads the "main" module
// We rely on scripts/lib/require.js already being included in index.html.
const amdBootstrap = `
(function(){
  function boot(){
    if (typeof requirejs !== 'function') { setTimeout(boot, 10); return; }
    try {
      requirejs(['main'], function (MyApp) { try { window.MyApp = MyApp; } catch(_) {} });
    } catch(_) { setTimeout(boot, 50); }
  }
  boot();
})();
`;
const combinedContent = mainContent + '\n\n' + uiHandlerContent + '\n\n' + amdBootstrap;

// No obfuscation - just minification for maximum performance
// The image processing algorithms are too sensitive to any obfuscation
const obfuscationResult = {
  getObfuscatedCode: () => combinedContent // Return original code without any obfuscation
};

// Generate a hash for the filename
const crypto = require('crypto');
const hash = crypto.createHash('md5').update(combinedContent).digest('hex').substring(0, 8);

// Ensure dist directory exists
if (!fs.existsSync('./dist')) {
  fs.mkdirSync('./dist');
}

// Copy styles and static assets to dist so Vercel deployment has latest CSS & libraries.
// scripts/lib also holds the n8n workflow generators' helpers: they are not part of the website
const NOT_WEBSITE = ["n8n-queue-lock.js", "prices-code.js"];
const websiteFile = (src) => !NOT_WEBSITE.includes(path.basename(src));
if (fs.cpSync) {
  fs.cpSync('./styles', './dist/styles', { recursive: true, force: true });
  fs.cpSync('./scripts/lib', './dist/scripts/lib', { recursive: true, force: true, filter: websiteFile });
} else {
  const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDir(srcPath, destPath);
      else if (websiteFile(srcPath)) fs.copyFileSync(srcPath, destPath);
    }
  };
  copyDir('./styles', './dist/styles');
  copyDir('./scripts/lib', './dist/scripts/lib');
}
// Kit layers for the "Download mockup" button (the scripts made by server/scripts/prepare-mockups.js)
fs.mkdirSync('./dist/mockups', { recursive: true });
for (const file of fs.existsSync('./mockups') ? fs.readdirSync('./mockups') : []) {
  if (/\.js$/.test(file)) fs.copyFileSync(`./mockups/${file}`, `./dist/mockups/${file}`);
}
console.log('Copied styles, scripts/lib and mockups to dist/');

// Write the obfuscated file
const outputFilename = `main.${hash}.js`;
fs.writeFileSync(`./dist/${outputFilename}`, obfuscationResult.getObfuscatedCode());

// Drop the bundles of previous builds so only the current one is deployed
for (const file of fs.readdirSync('./dist')) {
  if (/^main\.[0-9a-f]+\.js$/.test(file) && file !== outputFilename) {
    fs.unlinkSync(`./dist/${file}`);
    console.log(`Removed old bundle: dist/${file}`);
  }
}

console.log(`Build complete! Generated: dist/${outputFilename}`);

// Update the HTML file to reference the new file
let htmlContent = fs.readFileSync('./index.html', 'utf8');

// Remove the old script references
htmlContent = htmlContent.replace(/<script src='dist\/main\.[^']+\.js'><\/script>/g, '');
htmlContent = htmlContent.replace(/<script src='scripts\/main\.js'><\/script>/g, '');
htmlContent = htmlContent.replace(/<script src='scripts\/ui-handler\.js'><\/script>/g, '');

// Remove any inline RequireJS bootstrap blocks (we bootstrap inside the bundle)
htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?requirejs[\s\S]*?<\/script>/gi, '');

// Cache-bust styles/main.css with build hash so mobile browsers and CDNs never serve stale CSS
htmlContent = htmlContent.replace(/styles\/main\.css(\?v=[^'" >]+)?/g, `styles/main.css?v=${hash}`);

// Ensure required library scripts are present (jQuery, Materialize, Cropper, RequireJS, saveSvgAsPng, jsPDF)
function ensureScript(src) {
  if (!new RegExp(`<script\\s+src=["']${src.replace(/[.*+?^${}()|[\\]\\\\]/g, r=>`\\${r}`)}["']><\\/script>`, 'i').test(htmlContent)) {
    htmlContent = htmlContent.replace('</body>', `    <script src="${src}"></script>\n</body>`);
  }
}

// Insert vendor libs first, AMD loader last to avoid mismatched anonymous define() from UMD libs
// All of them are served from this domain, so the page works without cdnjs or unpkg
ensureScript('scripts/lib/saveSvgAsPng.js');
ensureScript('scripts/lib/jspdf.umd.min.js');
ensureScript('scripts/lib/jquery-1.11.0.min.js');
ensureScript('scripts/lib/materialize.min.js');
ensureScript('scripts/lib/cropper.min.js');
ensureScript('scripts/lib/require.js');

// Write the updated dist/index.html
const distScriptTag = `<script src='${outputFilename}'></script>`;
const distHtml = htmlContent.replace('</body>', `    ${distScriptTag}\n</body>`);
fs.writeFileSync('./dist/index.html', distHtml);
console.log('Updated dist/index.html with new script reference');

// Also update root index.html to point to dist/${outputFilename} so local server runs current bundle
const rootScriptTag = `<script src='dist/${outputFilename}'></script>`;
const rootHtml = htmlContent.replace('</body>', `    ${rootScriptTag}\n</body>`);
fs.writeFileSync('./index.html', rootHtml);
console.log('Updated index.html with new script reference');

