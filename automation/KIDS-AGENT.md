# Kids Agent

One independent n8n workflow: **Darl'Art Kids Agent**.

- Workflow: https://n8n-vm.taildc9f8f.ts.net/workflow/VzI0ECNgpUIrqyLD
- Upload form: https://n8n-vm.taildc9f8f.ts.net/form/darlart-kids-upload
- Prices: the **Kids** tab in the existing Darl'Art Prices spreadsheet.
- Output: the existing **Artwork Agent** folder, with ordinary numeric folder names and ordinary SKU construction.

## Current settings

18 Darl'Art paints selected per artwork, 24×30 cm portrait or 30×24 cm landscape, HARD detail.
Rolled costs 189 MAD. Stretched is 0 in the sheet, so there is no stretched variant for sale.
Change a canvas type's price to a positive value to offer it; the workflow checks prices every five minutes.
No Kids prices are added to the Classic tab.

## New uploads

The dedicated form accepts up to 20 JPG/PNG/WebP references, at most 5 MB each.
It validates the bytes and queues references in `Artwork Agent/_kids-queue`. Execution IDs make batch names unique.
OpenAI paints new uploads using the same image model and quality as the Classic worker. The PBN API then reduces
the painting to exactly 18 colors. The workflow generates print files, previews, Shopify drafts, French/Arabic
translations and subsequent price updates. A new product remains a draft for review.

The canvas SVG has physical dimensions for the painting. Its reference footer is additional space below the
painting. Catalog/customer guides retain A4 pages. Paint packing calculations cover only the configured Kids size.

## Exact-color holds

**18 is an exact requirement, not a maximum.** Strict generation selects the exact requested palette count,
then recovers painted areas of any selected color erased by cleanup before tracing borders and placing labels.
This preserves real numbered regions, including small ones, rather than adding unused paints to the legend.
Classic generation does not enable this preservation mode. The final exact-count assertion remains in place
to detect invalid inputs or a generation error; it no longer rejects a valid 18-paint raster just because cleanup
erased a color. Historical review holds need one explicit migration retry after deploying this server change.

Drive folder `appProperties` identify ownership and state without changing names:

- `darlart_family=kids`: owned by this workflow.
- `darlart_state=migrating`: staged migration; downstream stages skip it.
- `darlart_state=review`: manual review required; downstream stages skip it.
- `darlart_state=active`: migration completed.

The Classic Titling Agent, Print Agent, Uploader and Watchdog exclude Kids folder metadata. Classic Price Sync
and Translation Sync exclude `kids-kits` products. The Classic form cannot independently classify a new upload
as Kids. New Kids folders are marked when created, and numeric allocation shares the Classic worker's lock.

## Existing-product migration

Existing designs are recolored from their saved artwork: **no AI repainting**. The migration snapshots the product
and original Drive file references, stages complete replacements, validates the artwork/template palette match,
updates the existing Shopify product, and promotes its new assets. Product IDs, handles, status, manual copy,
translations and collections are preserved. New variants use the new size/count with the existing SKU format.

Original assets are moved into `Archive/classic-before-kids` in the same product folder, retaining their Drive
file IDs. Original references stay in place. Shopify variants get new IDs; old variant IDs cannot be restored.
Snapshots and resumable journals are in `/home/n8n/.n8n/backups/kids-migration-2026-10-31` on the server.
An exact-color exception leaves the original Shopify listing unchanged, marks the folder for review, and is
skipped on subsequent bulk runs. Use an explicit folder selection only after reviewing the artwork.

```bash
# On n8n-vm, as n8n, using its existing connections (credentials are never logged):
node scripts/ops/migrate-kids.cjs --inspect
node scripts/ops/migrate-kids.cjs --folders=1108,1150
node scripts/ops/migrate-kids.cjs --all
```

## Rebuilding and deployment

`automation/kids-config.json` stores the Drive IDs and optional `canvasSize`. The default size is 24x30. Sizes
must retain 4:5 and fall between 20x25 and 32x40. Set matching size/18-color rows in the Kids price tab before
deploying a new size. Existing products require a separately reviewed regeneration; changing config does not
silently resize an existing order's production files.

```bash
node scripts/build-kids-workflow.js automation/kids-config.json
npm test
```

The generator reads the maintained agent exports, prefixes each stage's nodes and routes calls back to this
same workflow. Stages are `worker`, `titling`, `print`, `upload`, `prices` and `translate`. They retain separate
locks, bounded retries and the scheduled recovery run. Its internal Operations webhook reuses the existing
PBN Header Auth connection; do not expose or copy its key into workflow JSON.

`scripts/ops/deploy-kids.cjs` runs on the server as n8n. It snapshots and patches the six live Classic workflows,
preserving their credentials and live parameters, and creates/updates/publishes the Kids workflow with existing
connections. Every agent generator also applies the guards, so rebuilding an export does not remove them.

The PBN API adds optional `requireExactColors`, `physicalSvg` and `paintCanvasSizes` job fields. Existing callers
retain their original behavior when those fields are omitted. Migration and new Kids print jobs enable them.

The existing Error Handler can release failed execution locks; scheduled Kids stages also recover stale locks.
Kids Telegram messages are disabled by default (`telegramChatId` is empty); the existing shared Error Handler
retains its current settings.
