# Kids rollout handoff — 31 October 2026

The separate Kids workflow is published and its upload form is live:
https://n8n-vm.taildc9f8f.ts.net/form/darlart-kids-upload

Settings: exactly 18 paints, HARD detail, 24×30 cm (30×24 landscape), Rolled 189 MAD,
Stretched 0 (disabled). Pricing uses the Kids tab in the existing price workbook.
Numeric Drive folder names and SKU format are retained inside Artwork Agent.

## Latest confirmed migration status

12 completed: 1036, 1041, 1053, 1054, 1056, 1090, 1108, 1109, 1140, 1143, 1145, 1150.

7 held, with original listings and production assets unchanged:

| Folder | Artwork | Paints after cleanup |
| --- | --- | --- |
| 1033 | Rocket to the Stars | 9 |
| 1034 | Smiling Blue Dinosaur | 9 |
| 1035 | Four Friendly Bears | 9 |
| 1037 | Sunny Palm Cove | 14 |
| 1038 | Crimson Sail | 12 |
| 1039 | Sunlit Red Lighthouse | 17 |
| 1040 | Rowing Among Lilies | 17 |

2 remain in the current serial batch: 1146 and 1149. This is a progress snapshot,
not a claim that the batch has finished. Server journals are authoritative:
`/home/n8n/.n8n/backups/kids-migration-2026-10-31/<folder>.json`.
A `completedAt` value means complete even if a historical retry error remains.

Existing artwork is recolored with the Ubuntu PBN tool; migration does not ask AI
to redraw it. Exact-color failures remain held, as requested. Completed products
retain product IDs and URLs; replaced Drive assets are archived in each original
folder under `Archive/classic-before-kids`.

## Verification already completed

37 tests passed. A complete form-to-Shopify test produced an 18-paint kit at 189 MAD.
Its temporary product 1208 was subsequently archived and excluded from processing.
The production form and a migrated storefront product were checked in Chrome.

## Resume without repeating completed work

First check whether a migration is still running. Do not launch a second batch.
If the current batch has ended with unfinished products, run on the server:

```bash
sudo -H -u n8n node /opt/pbn/scripts/ops/migrate-kids.cjs --all
```

This resumes journals, skips completed products and leaves exact-color review holds
alone. No workflow redesign or further feature work is needed. After the last two
finish, read their journals and update these counts. Do not loosen the 18-paint gate.

Implementation and operating details: [KIDS-AGENT.md](KIDS-AGENT.md).
