# Kids Agent

Kids uses **16 actually used Darl'Art paints**, 24x30 cm portrait / 30x24 cm landscape, and HARD PBN detail. The target count and physical size are configured in `automation/kids-config.json`.

The Kids workflow is a thin upload/queue entry. The existing Artwork Worker, Titling, Print, Shopify Uploader, Price Sync, Translation Sync, Watchdog and Error Handler process both product families. The Classic form and settings stay the same.

- Same existing Artwork Agent root and numeric folder/SKU rules; no K prefix.
- Same existing price workbook and Kids tab (gid 188180018). At cutover, set the Kids rows to 16 colors; rolled 189 MAD and stretched 0 MAD remain the approved prices.
- Existing 18-color products require a staged migration; do not relabel 18-color production files or variants as 16.
- `scripts/ops/migrate-kids.cjs` reads the shared config. Its new revision, backup journal, staging folder and archive prevent reuse of completed 18-color migration output. Numeric folder IDs, Shopify product IDs and URLs are preserved.
- Build with `npm run build:workflows`. Prepare local imports with `scripts/ops/prepare-shared-imports.cjs`. The old combined-workflow deployment script is retired.

See [SHARED-KIDS-ROLLOUT.md](SHARED-KIDS-ROLLOUT.md) for manual publishing, validation, migration and rollback. Preparing these files does not publish n8n workflows, change the live price sheet or execute a migration.
