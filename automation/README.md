# Darl'Art automation: photo → paint by numbers PDF

Paid order with a photo → n8n → Claude picks crop, orientation and difficulty → pbn-api generates the canvas → files saved to Google Drive.

The website, the API and the CLI all use the same code in `src/core/` (processing pipeline, family renumbering, SVG and PDF), so they produce the same template for the same photo, crop and settings.

```
Shopify "orders/paid"  ─┐
Webhook (other channel) ┴─► Normalize order ─► Ready? ─► for each photo:
    POST /v1/analyze ─► Claude (crop, orientation, difficulty as JSON) ─► POST /v1/jobs
    ─► Wait (API calls back) ─► Drive folder "Orders/<order>" ─► download + upload files
    ─► email when something needs a look
```

## 1. Run the API

### With Docker (on the n8n VPS)

```bash
cd server
echo "PBN_API_KEY=$(openssl rand -hex 32)" > .env
echo "PBN_CALLBACK_SECRET=$(openssl rand -hex 32)" >> .env
echo "N8N_NETWORK=n8n_default" >> .env   # docker network ls → the network of your n8n container
docker compose up -d --build
```

n8n reaches the API at `http://pbn-api:3000`. No port is published to the internet.

### Without Docker (development)

```bash
npm install
npm run build:server
API_KEY=dev-key npm run start:server      # http://localhost:3000
npm test                                  # core + generation tests
```

### Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `API_KEY` | (empty) | Required `x-api-key` header. Always set it in production. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Base of the file links returned to n8n. |
| `CALLBACK_SECRET` | (empty) | Sent as `x-callback-secret` to the callback URL. |
| `CONCURRENCY` | CPU cores - 1 | Jobs processed at the same time. |
| `JOB_TIMEOUT_MS` | 600000 | A job taking longer is failed. |
| `RETENTION_DAYS` | 14 | Finished jobs and their files are deleted after this. |
| `MAX_IMAGE_BYTES` | 30 MB | Largest photo accepted. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Job files. |
| `DEFAULT_PALETTE` | `darlart-v2` | Palette used when a job doesn't name one. |

Palettes live in `server/palettes/<id>.json` (same format as the website's custom colors). `darlart-v2` is `palette 2.json`. Use `"palette": "none"` to take the colors from the photo.

## 2. API

All `/v1` requests need the `x-api-key` header.

### `POST /v1/jobs` - create a canvas

Multipart form (`image` file) or JSON (`imageUrl`):

| Field | | |
|---|---|---|
| `image` / `imageUrl` | required | JPEG, PNG, WebP, HEIC… EXIF rotation is applied. |
| `canvasSize` | required | `"40x50"` (cm). |
| `colors` | 24 | Number of paint colors (website: 12, 24, 36, 48). |
| `orientation` | `auto` | `auto`, `portrait`, `landscape`. `auto` follows the photo. |
| `difficulty` | `auto` | `easy`, `medium`, `hard`, or `auto` (from the photo's level of detail). |
| `crop` | automatic | `{ "x": 0.1, "y": 0.05, "w": 0.6, "h": 0.9 }`, fractions of the photo. It's fixed to the canvas aspect ratio and kept inside the photo. Without it, the most interesting area is kept (sharp attention crop). |
| `paperSize` | `a4` | `a2`, `a3`, `a4`, `a5`. |
| `palette` | `darlart-v2` | Server palette id or `none`. |
| `orderId` | | Used in file names: `<orderId> <colors> <difficulty> <size>.pdf`. |
| `callbackUrl` | | Receives the job (same JSON as `GET /v1/jobs/:id`) when it completes or fails. It's retried 5 times over ~2.5 min. |
| `randomSeed` | 7707 | Same photo + options + seed = same template. |

Returns `202` with `jobId`, `status` (`queued`, `processing`, `completed`, `failed`), `progress` and `statusUrl`.

```bash
curl -H "x-api-key: $KEY" -F image=@photo.jpg -F canvasSize=40x50 -F colors=24 -F orderId=1042 http://localhost:3000/v1/jobs
```

### `GET /v1/jobs/:id`

Status and, when completed, `result`:
- `difficulty` and `difficultySource`, plus the `complexity` metrics;
- `canvas` and `crop`;
- `colorsUsed` and `facets`;
- `palette`, grouped by family, with codes and the area percentage of each color;
- `files`: each has a `url` and a `downloadName`.

### `GET /v1/jobs/:id/files/:name`

Downloads one file:
- `template.pdf`: page 1 colored, page 2 numbered outline, page 3+ legend by family;
- `template.svg`: colored template with numbers;
- `preview.png`: colored template without numbers;
- `palette.json`: the palette with codes, families and area percentages.

### `POST /v1/analyze`

Photo (+ optional `canvasSize`, `orientation`) in. It returns:
- `suggestedDifficulty` and the `complexity` metrics;
- `cropSuggestion` when `canvasSize` is given.

n8n sends this to Claude as a hint.

### `GET /v1/palettes`, `GET /health`

The palettes available on the server, and a liveness check (`/health` needs no API key).

### CLI

```bash
node server/dist/server/src/cli.js -i photo.jpg -o out/ --size 40x50 --colors 24 --difficulty auto --order 1042
```

## 3. n8n workflow

Import `n8n-darlart-canvas-workflow.json` (Workflows → Import from file), then:

1. **Credentials**
   - *Header Auth* named e.g. "pbn-api": name `x-api-key`, value = `PBN_API_KEY`. Use it on **Analyze photo**, **Create generation job** and **Download file**.
   - *Header Auth* "Anthropic": name `x-api-key`, value = your Anthropic API key. Use it on **Claude: crop & difficulty**.
   - *Header Auth* "pbn-callback": name `x-callback-secret`, value = `PBN_CALLBACK_SECRET`. Use it on **Wait for job**.
   - *Header Auth* for **Webhook: order from another channel** (use any secret you like).
   - Shopify, Google Drive and SMTP credentials on their nodes.
2. **Normalize order** (top of the code): `PBN_API_URL`, and the names of your Shopify photo upload property and size/colors options. The photo must be a line item property holding a public URL, as file upload apps for product options provide.
3. **Create order folder**: replace `REPLACE_WITH_ORDERS_FOLDER_ID` with the id of your Drive "Orders" folder.
4. **Notify** nodes: set `fromEmail` / `toEmail`.
5. To store elsewhere (Dropbox, S3…), replace **Create order folder** and **Upload to Google Drive** with that service's nodes. The downloaded file is in the `data` binary property.

Other channels (e.g. an order read from the store mailbox) can POST to the webhook:

```json
{ "orderId": "1042", "paid": true, "photoUrl": "https://…/photo.jpg", "canvasSize": "40x50", "colors": 24, "orientation": "auto", "customerEmail": "…" }
```

### What happens on errors

- **Unpaid order:** ignored.
- **Missing photo or size:** you get an email; nothing is generated.
- **Claude unavailable, refusal, or invalid crop:** generation continues with the automatic crop and difficulty, and you get an email with the reason. Claude requests use `fallbacks: "default"`, so a declined request is re-run on another Claude model first.
- **Photo Claude considers blurry/small/dark:** the canvas is still generated and saved, and you get an email.
- **Job failed, or no callback within 30 min:** you get an email.

## 4. Tuning

- **Difficulty:** Claude decides from the photo, following the rules in **Build Claude request**. The API's automatic score (`src/core/complexity.ts`, `COMPLEXITY_THRESHOLDS`) is a hint and a fallback. Its thresholds come from a first calibration on two sample images, so review the `complexity.score` of real orders and adjust.
- **Presets:** easy / medium / hard are in `src/core/settings.ts` (`DIFFICULTY_PRESETS`). The website and API both read them.
- **Cost:** one Claude Opus 5 request per photo (one image plus a short answer).
