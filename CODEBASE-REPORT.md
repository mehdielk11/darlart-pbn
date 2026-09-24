# Darl'Art PBN — Codebase Report

_Snapshot of branch `claude/ecstatic-cray-hiambp` (HEAD `6774f01`), 2026-09-24._

## 1. What this project is

A fork of drake7707's open-source **paint-by-numbers generator**, grown into the production toolchain for **Darl'Art** (darlart.ma), a Moroccan shop selling paint-by-numbers kits and printable templates. It now has five parts that share one image-processing core:

| Part | Location | Runs on | Purpose |
|---|---|---|---|
| Website generator | `index.html`, `src/`, `scripts/`, `styles/` → `dist/` | Vercel / nginx (static) | In-browser photo → PBN template, SVG/PDF/mockup downloads |
| HTTP API (`pbn-api`) | `server/` | VM / Docker next to n8n | Same pipeline server-side: jobs, analyze, recolor |
| Shopify widget | `shopify/` | Shopify theme | Customer uploads and crops a photo at exact canvas/paper ratio |
| n8n automations | `automation/`, `scripts/build-*-workflow.js` | n8n | Order fulfilment, AI artwork, titling, print files, product upload |
| Custom GPT | `gpt/` | ChatGPT | Artwork generation in Darl'Art colors (manual tool) |

## 2. Architecture

```
            ┌──────────────── src/core/ (DOM-free, shared) ────────────────┐
            │ pipeline.ts  settings.ts  palette.ts  svg.ts  pdf.ts          │
            │ crop.ts  complexity.ts  mockup.ts                             │
            └───────┬──────────────────────┬────────────────────────────────┘
                    │ uses                 │ uses
  src/ algorithms (k-means, facets,   server/src/ (Fastify API, worker threads,
  border tracing, labels, polylabel)  sharp image prep, recolor, mockups)
                    │                      │
   website (tsc → AMD scripts/main.js)     │ HTTP  ◄── n8n workflows ◄── Shopify orders / Drive
```

### 2.1 Processing core (`src/`)
- Classic pipeline (from upstream): k-means color reduction (`colorreductionmanagement.ts`, `lib/clustering.ts`) → facet building (`facetCreator.ts`) → small-facet reduction (`facetReducer.ts`) → border tracing and segmentation with Haar-wavelet smoothing (`facetBorderTracer.ts`, `facetBorderSegmenter.ts`) → label placement via polylabel (`facetLabelPlacer.ts`).
- `src/core/` is the Darl'Art layer, with no DOM dependency so it runs in browser, API and tests:
  - `pipeline.ts` — `runPipeline` with progress/cancel callbacks.
  - `settings.ts` — `easy/medium/hard` difficulty presets, palette parsing (`parseCustomColors` handles the Darl'Art JSON, hex and rgb lines).
  - `palette.ts` + `palettefamilies.ts` — renumbers colors by paint "family" using Darl'Art paint codes.
  - `svg.ts` — full, faded and blank (print) SVGs; `pdf.ts` — user PDF and agency ("painting") PDF with palette page, A-series paper sizes.
  - `crop.ts` — canvas sizes, orientation, aspect-fit crops; `complexity.ts` — edge/texture score → suggested difficulty; `mockup.ts` — kit mockup compositing.
- Browser UI: `gui.ts`, `guiprocessmanager.ts`, plus a large hand-written `scripts/ui-handler.js` (2,819 lines) using jQuery, Materialize, Cropper.js, jsPDF and saveSvgAsPng (all vendored in `scripts/lib/`).

### 2.2 API (`server/src/`)
Fastify 5 app (`app.ts`):

| Endpoint | Purpose |
|---|---|
| `POST /v1/jobs` | Create a generation job (multipart `image` or JSON `imageUrl`, optional `callbackUrl`) |
| `GET /v1/jobs/:id` / `…/files/:name` | Status and downloads (template.pdf, svg, preview.png, palette.json, …) |
| `POST /v1/analyze` | Complexity, suggested difficulty, crop suggestion |
| `POST /v1/recolor` | Repaint an image with exactly N palette colors (histogram → weighted Lab k-means → palette snapping and refinement) |
| `GET /v1/palettes`, `GET /health` | Palettes list and liveness |

- `jobs.ts`: on-disk job persistence under `DATA_DIR`, worker-thread execution (`worker.ts`) with concurrency limit and timeout, callback with retries and `x-callback-secret`, retention cleanup; jobs interrupted by a restart are marked failed.
- `generate.ts`: photo → `sharp` prep (`image.ts`: center/attention crop) → pipeline → PDF/SVG/PNG/JSON + mockup.
- Auth: `x-api-key` compared in constant time (`timingSafeEqual`).
- Config via env (`config.ts`): `API_KEY`, `CALLBACK_SECRET`, `PUBLIC_BASE_URL`, `CONCURRENCY`, `JOB_TIMEOUT_MS`, `RETENTION_DAYS`, `MAX_IMAGE_BYTES`, palettes from `server/palettes/darlart-v2.json`/`v3.json` (default v3).
- Deploy: systemd (documented in `automation/README.md`) or `server/Dockerfile` + `docker-compose.yml` (non-root user, healthcheck, joins the n8n network, no public port by default). `server/src/cli.ts` is the current CLI.

### 2.3 Shopify widget (`shopify/`)
Vanilla JS/CSS + Liquid snippet (`darlart-canvas-crop.*`). Customers choose format (A4/A3/A2 or cm canvas), orientation and color count, then crop the photo at exact proportions. The cropped JPEG goes on the order as a line-item property, and "Add to cart" is blocked until it's there. `DIGITAL-MIGRATION.md` records the move to a digital-only (printable files by e-mail) offer and the remaining manual admin steps.

### 2.4 n8n automations (`automation/`)
Workflow JSONs, each with a Markdown guide. Several are generated by `scripts/build-*-workflow.js`:
- **Canvas workflow**: Shopify `orders/paid` → `POST /v1/jobs` → Drive folder → fulfil the order so Shopify e-mails the customer.
- **Artwork Agent** (form / Telegram / WhatsApp variants): reference image → gpt-image-2 → gpt-5-mini QA → `/v1/recolor` snaps it to exactly 48 Darl'Art colors → Drive.
- **Titling Agent**: gpt-5-mini writes the Shopify product JSON (title, handle, description, collections, tags).
- **Print Agent**: per artwork, blank SVG + catalog PDF + user PDF for each size × color count, plus a mockup. Uses a Drive-file lock so only one worker runs.
- **Shopify Uploader**: `productSet` draft products with variants priced from `shopify-prices.csv` and a fixed image order.

## 3. Build, deploy, test

| Command | What it does |
|---|---|
| `npm run build:frontend` | `tsc -p src` → single AMD file `scripts/main.js` |
| `npm run build` | `build.js`: concatenates `main.js` + `ui-handler.js` + AMD bootstrap → `dist/main.<md5>.js`, copies libs/styles/mockups, and rewrites `index.html` and `dist/index.html` |
| `npm run vercel-build` | Both of the above (Vercel, `outputDirectory: dist`) |
| `npm run build:server` / `start:server` | Compile and run the API |
| `npm test` | Builds the server, then `node --test test/core.test.js` |

**Verified in this session:** `npm ci` succeeds. `npm test` passes **16/16** (palette parsing, family renumbering, crop/canvas logic, recolor exactness, complexity scoring, and full generation of PDF/SVG/preview/palette). `tsc -p src` compiles cleanly, and its output matches the committed `scripts/main.js`, so they are in sync.

## 4. Strengths
- A real **shared core**: website, API and automations produce the same template for the same input, and the tests cover that path end to end.
- The API is careful: constant-time key check, upload size limits, worker isolation with timeouts, jobs that survive restarts, callback retries, retention cleanup, and a non-root Docker image.
- Strong operational docs: each workflow has a README covering its purpose, flow, settings and failure behavior.
- Palette handling is careful: exact-N recolor, excluded codes, and family-ordered numbering using real paint codes.

## 5. Issues and risks

### Security
1. **Auth turns off when `API_KEY` is empty** (`app.ts`, `config.ts`). Only the systemd path relies on the operator setting it, and a forgotten env var leaves every `/v1` route open. Suggestion: refuse to start without a key unless something like `NODE_ENV=development` is set.
2. **SSRF through `imageUrl` and `callbackUrl`.** The API fetches any `http(s)` URL (`redirect: "follow"`) and POSTs callbacks to any URL. Private and loopback addresses are not blocked. The API key limits the risk, but anyone holding a key can reach the internal network (for example n8n on the Docker network). Suggestion: allow only known hosts (Shopify CDN, Drive), or block private IP ranges after DNS resolution.
3. No rate limiting on `/v1/*`. This matters if the API is ever exposed through the optional nginx proxy.

### Repository hygiene
4. **Committed build and junk artifacts:** `scripts/main.obf*.js`, `ui-handler.obf*.js`, `*.min.js` (unused by `build.js`), `gpt/__pycache__/*.pyc`, `temp_overlay.css`, `src-cli/main.js.map`, and the whole `dist/` folder, which Vercel rebuilds anyway. They add noise and can go stale.
5. **Dead or legacy tooling:** `webpack.config.js`, `.babelrc` and the webpack/obfuscator/terser/babel devDependencies are not used by the real build. `obf.md` describes obfuscation that `build.js` deliberately doesn't do.
6. **Broken legacy CLI:** `package.json` `"bin": "./src-cli/main.js"` points to a file that does not exist, and `src-cli/main.ts` imports `canvas`, which isn't a dependency. The working CLI is `server/src/cli.ts`. Suggestion: remove `src-cli/` or repoint `bin`.
7. **README.md is still upstream's** ("not actively maintained", links to drake7707's demo). It doesn't describe Darl'Art, the API or the automations. The real docs are spread across `automation/README.md` and `shopify/README.md`.
8. `package.json` metadata (`name`, `author`) is still upstream's.

### Maintainability
9. `build.js` rewrites the tracked root `index.html` on every build, so each build produces a diff. The regex-based HTML editing is also fragile.
10. `scripts/ui-handler.js` is a 2.8k-line untyped jQuery file, outside the TypeScript build and tests. Most UI regressions will land here. The history shows many "fix ui" / "fix svg opacity" commits.
11. The frontend relies on jQuery 1.11 (2014, known XSS CVEs) and Materialize (unmaintained). The risk is low for a static tool, but worth noting.
12. **Commit messages** are mostly "fix", "fix ui" and "add many features XD", so the history is hard to use for debugging.
13. There is no CI config (`.github/workflows` is absent), so tests only run when someone remembers to.

## 6. Recommended next steps (by value / effort)
1. Require `API_KEY` at startup, and add a host allowlist or private-IP block for `imageUrl` and `callbackUrl`.
2. Add a GitHub Actions workflow that runs `npm ci && npm test && npm run build:frontend`.
3. Delete the obf/min/pyc/temp artifacts, `webpack.config.js`, `obf.md` and `src-cli/`, and add `dist/` and `__pycache__/` to `.gitignore`.
4. Rewrite `README.md` as the project overview (what's in the table in §1) linking to the sub-READMEs.
5. Stop `build.js` from modifying the tracked `index.html`, for example by using a template file.
6. Longer term: move `ui-handler.js` to TypeScript on top of `src/core`, and add some UI smoke tests (Playwright is available).

## 7. Size at a glance
About 19k lines of first-party code: TypeScript core ~5k, `scripts/main.js` (compiled) 4.9k, `ui-handler.js` 2.8k, server ~1.6k, Shopify widget ~1.2k, workflow builders ~1.6k, tests 290, GPT tool 433 (Python).
