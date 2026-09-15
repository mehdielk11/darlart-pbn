# Task: Production Build Hardening for JS Code

**Goal:** Bundle, minify, and obfuscate all JavaScript (main.js, ui-handler.js) so that:
- Only a single hashed JS file is served (e.g., `main.[hash].js`).
- Variable and function names are obfuscated.
- Strings are encoded and control flow flattened.
- No source maps are generated.
- The result is production-ready and difficult to reverse-engineer.

**Steps to Implement:**

1. **Add Build Tool (Webpack / Esbuild)**
   - Install Webpack or Esbuild in the project.
   - Configure an entry file that imports `main.js` and `ui-handler.js`.
   - Output to `/dist` with a content hash in the filename.

2. **Enable Minification + Obfuscation**
   - Use `terser-webpack-plugin` (or Esbuild minify) for minification.
   - Use `webpack-obfuscator` (or `javascript-obfuscator` CLI) with options:
     ```js
     {
       compact: true,
       controlFlowFlattening: true,
       controlFlowFlatteningThreshold: 1,
       deadCodeInjection: true,
       deadCodeInjectionThreshold: 0.4,
       stringArray: true,
       stringArrayEncoding: ["base64"],
       stringArrayThreshold: 1,
       transformObjectKeys: true,
       renameGlobals: true,
     }
     ```

3. **Disable Source Maps**
   - Set `devtool: false` in Webpack config (or `--sourcemap=false` for Esbuild).

4. **Serve Hashed File**
   - Update `index.html` to reference the new `main.[hash].js` file automatically using Webpack `HtmlWebpackPlugin`.

5. **Verify**
   - Run `npm run build`.
   - Open `dist/index.html` and confirm there is **only one minified/obfuscated JS file** and nothing human-readable in DevTools Sources.

