# Darl'Art Artwork Agent (n8n)

Upload up to 20 reference images in a form, get painted artworks that use **exactly 48 Darl'Art colors**, saved in Google Drive. Two workflows, built by `scripts/build-artwork-agent-workflow.js`:

- `n8n-darlart-artwork-agent.json`, **Darl'Art Artwork Agent** (the form): checks and queues the uploads, answers at once;
- `n8n-darlart-artwork-worker.json`, **Darl'Art Artwork Worker**: paints the queue, one reference per run.

```
Formulaire (1 to 20 files) -> Check uploads (each file: JPG/PNG/WEBP from its bytes, max 5 MB; max 20 files)
  -> queue the good ones in Drive "Artwork Ref/Queue" as <batchId>_<nn>.<ext> + <batchId>_batch.json (manifest)
  -> Start worker (not awaited) -> page: "N queued, M refused (reasons)"

Artwork Worker (called by the form, or Run now), one reference per run:
  queue lock (one worker at a time) -> oldest queued reference
  -> Generate ART (gpt-image-2 at 1024x1280 = 4:5: reference + fixed prompt, the reference's own colors)
  -> Check artwork (gpt-5-mini: no swatches/text/border, up to 3 tries)
  -> Snap to palette (pbn API /v1/recolor: exact 60x75 ratio, cropped never stretched; every pixel -> one of 48 Darl'Art colors)
  -> Create folder "Artwork Agent/1xxx" -> upload ref + art + palette JSON
                                        -> Run Titling Agent (product JSON, not awaited)
                                        -> Run Print Agent (print files + mockup, queued, not awaited)
  -> the reference moves to "Artwork Ref" (renamed <stamp>_ref.<ext>), or to "Artwork Ref/Failed"
  -> the manifest records the result; a batch with nothing left queued moves to "Artwork Ref/Queue/Done"
  -> release the lock, run again (stops when the queue is empty)
```

## Batches and the queue

- **One at a time:** the worker holds a Drive lock file in `Queue`, so two batches sent together are painted one after the other and folder numbers never repeat. A lock older than `lockStaleMinutes` (45) belongs to a crashed run and is removed.
- **Failures:** 3 paintings with swatches, text or borders set the reference aside in `Artwork Ref/Failed`. A reference whose run stopped midway `maxTries` times (3) is set aside too. The manifest records the reason.
- **Crashes:** a reference stays in `Queue` until it is painted or set aside: the next upload, or "Run now" in the worker, picks it up again.
- **The manifest** `<batchId>_batch.json` lists each reference (`queued`, `done` with its folder, `failed` with the reason) and the files refused at upload. Once nothing is queued, it moves to `Queue/Done`. The Shopify Uploader then sends **one Telegram message per batch** when all its drafts are in Shopify (see `SHOPIFY-UPLOADER.md`).
- Form uploads are limited by n8n's `N8N_FORMDATA_FILE_SIZE_MAX` (200 MB by default): 20 files of 5 MB fit.

## Why the palette is strict

An image model cannot be forced to use exact HEX values (and palette lists in the prompt get painted into the image as swatches), so it paints the reference's own colors. The **Snap to palette** step then measures the painting and repaints every pixel with the 48 distinct Darl'Art colors that represent it best (k-means in Lab, snapped to the palette, refined). "Check palette" stops the run if the result has anything other than 48 valid Darl'Art colors, so a saved artwork is always compliant. Codes 3801 (white) and 3811 (near black) are excluded; change `exclude` in **Settings** to allow them.

## Canvas ratio

Every artwork keeps its reference's shape (`orientation` "auto" in **Settings**):
- **Landscape reference** (wider than tall): a **75x60 cm landscape** artwork (5:4). The model paints at 1280x1024 and the prompt asks for a horizontal 5:4 canvas painting.
- **Portrait or square reference:** a **60x75 cm portrait** artwork (4:5), painted at 1024x1280.
- The reference's real shape comes from the pbn API (`/v1/analyze`, "Measure reference"), which also reads a phone photo's EXIF rotation. Setting `orientation` to "portrait" or "landscape" forces one shape for every artwork.
- The prompt tells the model to recompose the scene for that frame, never stretch it, and paint only the artwork, ignoring any background, wall, shadow, frame or canvas edge around it in the reference.
- **Snap to palette** then crops to the exact ratio (keeping the most interesting area) if the model's image is off by any pixel. Nothing is ever stretched.
- The rest follows the artwork's shape: the Print Agent's print files (75x60 or 60x75), the mockup and the featured image (landscape or portrait photo).

## Output

`Artwork Agent/1001`, `1002`, ... (next free number), each containing:
- `2026-09-23_14-05-33_ref.jpg`: the reference as uploaded (also kept in `Artwork Ref` under the same name);
- `2026-09-23_14-05-33_art.png`: the 48-color artwork;
- `2026-09-23_14-05-33_palette.json`: the 48 colors (code, hex, rgb, area percent).

## Setup

1. The pbn API must include `/v1/recolor` (redeploy the VM: `git pull && npm ci && npm run build:server && sudo systemctl restart pbn-api`).
2. Import both workflows, then pick the credentials: **OpenAI** on `Checker model` and `Generate ART`; **Google Drive** on every Drive node; the pbn API **x-api-key header** on `Snap to palette`.
3. **Settings** nodes: Drive folder IDs (`Artwork Ref`, its `Queue`, `Queue/Done` and `Failed`, `Artwork Agent`), colors (48), excluded codes, pbn API URL, image model. The form's "Start worker" node calls the worker by ID (`SETTINGS_WORKER_WORKFLOW_ID` in the generator).
4. Publish both, open the Formulaire production URL.

After changing `server/palettes/darlart-v3.json`, run `node scripts/build-artwork-agent-workflow.js` and re-import (Check palette embeds the palette).

Cost: `imageQuality` in Settings drives it. About $0.08 per artwork on `medium`, $0.20 on `high` (gpt-image-2 output dominates; the checker is ~$0.005).

## Telegram messages

To the group in `telegramChatId` (Settings of both workflows; empty = no messages), through the "Telegram account" bot. A Telegram error never stops a workflow.
- **Artwork Agent**, after each upload: the images queued and the ones refused (with the reason), how many images wait in the queue in all (and how many from earlier uploads come first), and roughly how long painting them takes. When nothing could be queued, the reasons.
- **Artwork Worker**, after each reference: the painted artwork as a photo, captioned with its product number (1xxx), the source file, its place in the batch and a link to the Drive folder. When a reference could not be painted, the reason. When a whole batch is painted, a summary (the Shopify Uploader sends the last message once its drafts are in Shopify).

## Busy and failed runs

A worker call that finds another run working waits 30 s and tries again (3 times). When a worker run fails, the Darl'Art Error Handler releases its lock, alerts on Telegram and starts the worker again (only when the failure came after the reference's try was recorded, so a reference that keeps failing is set aside after 3 tries and a lasting outage cannot loop).
