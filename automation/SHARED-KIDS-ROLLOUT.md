# Shared Kids pipeline

Kids Agent is an upload/queue handoff. Artwork Worker, Titling, Print, Shopify Uploader, Price Sync, Translation Sync, Watchdog and Error Handler process both families. Each execution selects one family and filters its folders/products before doing work. Manual/schedule triggers dispatch the two families; subworkflow calls retain their family. The Classic form remains unchanged.

## Configuration and guarantees

- `automation/kids-config.json`: one 4:5 portrait size from 20x25 to 32x40, currently 24x30. Landscape is reversed.
- Kids artwork and printing: 18 paints; HARD PBN; strict final used-paint check; physical SVG footer outside the painting area; matching paint packing sizes. These existing API capabilities need no server change for this refactor.
- Same Artwork Agent root, numeric folder names and numeric SKU rules. Family/state/size are internal Drive appProperties. Existing migrated folders and Shopify URLs remain intact.
- Same price workbook, Kids tab gid 188180018. Rolled 189, stretched 0: only the positive-price variant is enabled. Price Sync updates existing variant IDs.
- One existing lock per processing stage. Worker allocation always locks the existing Classic queue, even for Kids references.
- Print checkpoints in the existing root (`_pbn-jobs-classic.json`, `_pbn-jobs-kids.json`) preserve accepted PBN job IDs across polling budgets. Missing production files gate Kids upload. Explicit failed/missing API jobs can be retried; slow jobs are polled again using the same ID.
- Shopify upsert still uses the stable handle; retry lookup preserves the existing product ID/status.
- Existing Telegram destination and credential references are retained. Telegram nodes retry three times. Batch completion is marked notified only after a successful send. Production success/error history is explicitly saved.

## Build and prepare

```text
npm run build:workflows
npm test
node scripts/ops/prepare-shared-imports.cjs LIVE_SNAPSHOT_DIRECTORY LOCAL_IMPORT_DIRECTORY
```

The preparation script is offline. It copies credential IDs/names from freshly downloaded n8n snapshots, refuses ambiguous/missing mappings and retains workflow IDs/live settings. It never reads OAuth tokens or decrypts credentials. Keep bound imports and snapshots outside Git. The legacy `deploy-kids.cjs` now exits without changing anything.

## Cutover

1. Commit/push the reviewed generators, exports and tests first. No SSH/Ubuntu deployment is part of this change.
2. Pause intake. Verify no running Kids/stage executions, migration scripts or active API jobs can write conflicting outputs. Snapshot all current workflows and record their published states.
3. Unpublish the combined Kids workflow and Watchdog before shared ownership is published. During import, keep scheduled stage workflows unpublished too. Preserve their existing workflow IDs, credentials, call permissions, schedules and error-workflow reference.
4. Replace the eight shared agents with their matching bound JSON; replace the same Kids workflow ID with the thin entry last. Publish only after graph/credential validation. Publish Watchdog last, after the canary checks.
5. Run controlled Classic and Kids uploads through their production forms. Verify terminated forms, distinct numeric folders, correct family/size/colors, final SVG/PDF files, Shopify drafts/variants, Telegram milestones, translation and inspectable success/error history. Check both orientations and resume/retry behavior. Do not infer success just from a green execution badge.
6. Reconcile old incomplete batches using both timestamp-only and execution-qualified filenames. Existing review/migrating/validation states stay excluded until deliberately reconciled. No bulk regeneration is required for this refactor.

## Limits to verify in production

- A process crash after the API accepts POST but before n8n persists the response is an unavoidable gap without API-side idempotency. Inspect that accepted API job before resubmitting; checkpoint resume covers IDs successfully persisted to Drive. Drive metadata creation can similarly leave duplicate checkpoint files if the response is lost; the newest file is read.
- A Telegram send-success/persist-failure can repeat a notification. Upload completion remains in the durable manifest and can be retried; queued/progress messages have three immediate retries, not a separate durable outbox.
- Folder listings retain the existing 1000-item page limit. Work beyond that limit needs pagination before the catalog reaches it.
- Accepted-job checkpoint metadata retains the newest 100 entries per family. Active production runs are bounded to five folders; reconcile orphan API jobs before large manual recovery operations.

## Rollback

Pause intake and unpublish Watchdog/shared processing first. Reconcile active API jobs and locks. Restore the saved nine workflow snapshots together, including the original Kids exclusions, then restore their recorded publication states. Never run combined Kids ownership alongside shared Kids processing. Workflow rollback does not reverse completed Drive/Shopify writes. Preserve numeric folders, existing product IDs, queues and URLs.
