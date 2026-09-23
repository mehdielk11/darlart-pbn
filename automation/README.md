# Darl'Art automation: customer photo → paint by numbers PDF

The customer frames their photo on the product page. When the order is paid, n8n sends that photo and their choices to pbn-api, which generates the template. The files are e-mailed to the customer and saved to Google Drive. No AI service is used.

The website, the API and the CLI all use the same code in `src/core/` (processing pipeline, family renumbering, SVG and PDF), so they produce the same template for the same photo and settings.

```
Product page: customer picks print format + orientation (+ colors), uploads and frames the photo   (shopify/ widget)
      │  order line properties: Photo (cropped image URL), Format, Orientation, Couleurs
      ▼
Shopify "orders/paid" ─┐
Webhook (other channel) ┴─► Normalize order ─► Ready? ─► for each photo:
    POST /v1/jobs (cropMode "center", fixed difficulty) ─► Wait (API calls back)
    ─► Drive folder "Orders/<order>" ─► download + upload files
    ─► fulfil the order so Shopify e-mails the customer the link ─► e-mail you when something needs a look
```

## 1. Customer crop widget

See `shopify/README.md` to install it in the theme. `shopify/demo.html` lets you try it locally.

## 2. Run the API

### On the n8n machine with Node (systemd)

```bash
cd /opt/pbn && npm ci && npm run build:server && npm test
```

Create `/etc/pbn/api.env`:

```
HOST=127.0.0.1
PORT=3000
API_KEY=<openssl rand -hex 32>
CALLBACK_SECRET=<openssl rand -hex 32>
PUBLIC_BASE_URL=http://127.0.0.1:3000
DATA_DIR=/var/lib/pbn-api
CONCURRENCY=2
```

Create `/etc/systemd/system/pbn-api.service`. Replace `ubuntu` with the Linux user, and `/usr/bin/node` with the output of `which node`:

```ini
[Unit]
Description=Darl'Art paint by numbers API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/pbn
EnvironmentFile=/etc/pbn/api.env
ExecStart=/usr/bin/node server/dist/server/src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable it and check that it answers:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now pbn-api
curl http://127.0.0.1:3000/health
```

To update after pulling changes:

```bash
npm ci && npm run build:server && sudo systemctl restart pbn-api
```

### With Docker (alternative)

```bash
cd server
echo "PBN_API_KEY=$(openssl rand -hex 32)" > .env
echo "PBN_CALLBACK_SECRET=$(openssl rand -hex 32)" >> .env
echo "N8N_NETWORK=n8n_default" >> .env   # the Docker network of the n8n container
docker compose up -d --build
```

n8n then reaches the API at `http://pbn-api:3000`. Set that address in **Normalize order**.

### Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `API_KEY` | (empty) | Required `x-api-key` header. Always set it in production. |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Use `127.0.0.1` when n8n runs on the same machine. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Base of the file links returned to n8n. |
| `CALLBACK_SECRET` | (empty) | Sent as `x-callback-secret` to the callback URL. |
| `CONCURRENCY` | CPU cores - 1 | Jobs processed at the same time. |
| `JOB_TIMEOUT_MS` | 600000 | A job taking longer is failed. |
| `RETENTION_DAYS` | 14 | Finished jobs and their files are deleted after this. |
| `MAX_IMAGE_BYTES` | 30 MB | Largest photo accepted. |
| `DATA_DIR` | `./data` | Job files. |
| `DEFAULT_PALETTE` | `darlart-v3` | Palette used when a job doesn't name one. |

Palettes live in `server/palettes/<id>.json` (same format as the website's custom colors). `darlart-v3` is the current paint range (566 colors, 38 families of 15 shades); `darlart-v2` is the previous one (409 colors). Use `"palette": "none"` to take the colors from the photo.

The paint families shown in the legend come from `src/palettefamilies.ts`, generated from the palette: after changing the paints, run `node scripts/generate-palette-families.js server/palettes/<id>.json`.

## 3. API

All `/v1` requests need the `x-api-key` header.

### `POST /v1/jobs` - create a canvas

Multipart form (`image` file) or JSON (`imageUrl`):

| Field | Default | |
|---|---|---|
| `image` / `imageUrl` | required | JPEG, PNG, WebP… EXIF rotation is applied. |
| `canvasSize` | required | `"40x50"` (cm). |
| `orientation` | `auto` | `portrait`, `landscape`, or `auto` (follows the photo). |
| `colors` | 24 | Number of paint colors (12, 24, 36, 48 on the website). |
| `difficulty` | `auto` | `easy`, `medium`, `hard`, or `auto` (from the photo's level of detail). |
| `cropMode` | `attention` | `center` for photos already cropped by the customer: kept as-is, only the pixels that don't fit the exact canvas ratio are trimmed from the middle. `attention` places the largest crop with the canvas ratio on the most interesting area. |
| `crop` | | Optional `{ "x": 0.1, "y": 0.05, "w": 0.6, "h": 0.9 }` (fractions of the photo) to crop an uncropped photo. Overrides `cropMode`. |
| `paperSize` | `a4` | `a2`, `a3`, `a4`, `a5`. |
| `palette` | `darlart-v3` | Server palette id or `none`. |
| `orderId` | | Used in file names: `<orderId> <colors> <difficulty> <size>.pdf`. |
| `callbackUrl` | | Receives the job (same JSON as `GET /v1/jobs/:id`) when it completes or fails. It's retried 5 times over ~2.5 min. |
| `randomSeed` | 7707 | Same photo + options + seed = same template. |

Returns `202` with `jobId`, `status` (`queued`, `processing`, `completed`, `failed`), `progress` and `statusUrl`.

```bash
curl -H "x-api-key: $KEY" -F image=@cropped.jpg -F canvasSize=40x50 -F orientation=portrait -F colors=24 -F difficulty=medium -F cropMode=center -F orderId=1042 http://127.0.0.1:3000/v1/jobs
```

### `GET /v1/jobs/:id`

Status and, when completed, `result`:
- `difficulty`, the `complexity` metrics, `canvas` and `crop`;
- `source`: size of the received photo;
- `colorsUsed` and `facets`;
- `palette`, grouped by family, with codes and the area percentage of each color;
- `files`: each has a `url` and a `downloadName`.

### `GET /v1/jobs/:id/files/:name`

Downloads one file:
- `template.pdf` (the website's **User PDF**): page 1 the finished painting (colors only, like `preview.png`), page 2 the painted template (colors, outlines and numbers, like `template.svg`), page 3+ the legend with numbers and colors only (no families, paint codes or hex values);
- `painting.pdf`: the painting guide, page 1 the colored template with its numbers (white on the dark regions), page 2 the palette;
- `template.svg`: colored template with numbers, written in white on the dark regions so they stay readable;
- `blank.svg`: the website's **Blank SVG**: grey outlines and black numbers on white, no colors;
- `canvas.svg`: the pre-printed canvas as vector: every region faintly tinted, with grey outlines and numbers on white. Same look as `canvas.png`, with slightly stronger colors since it's made to be printed;
- `preview.png`: the finished painting, colors only, without outlines or numbers;
- `canvas.png`: the pre-printed canvas look, with every region faintly tinted and grey outlines and numbers on white, up to 3508 px (A4 at 300 dpi);
- `mockup.png`: the "perfect kit" product photo (1254 × 1254) showing this template on the canvas, a grey print of it on the reference sheet and the customer's cropped photo on the image card. The landscape or portrait kit is picked from the painting's shape. The website's "Download mockup" button draws the same image. The kit photos are in `/mockups` and their placeholder positions in `src/core/mockup.ts`. After replacing a kit photo or moving a placeholder, run `npm run prepare:mockups` to rebuild its `-blank` (sheet drawing erased) and `-overlay` (brushes lying on the sheet) layers, and the `kit-*.js` script the website loads them from;
- `palette.json`: the palette with codes, families and area percentages.

### Other endpoints

- `POST /v1/analyze`: detail score, suggested difficulty and an automatic crop suggestion for a photo. The workflow doesn't use it.
- `POST /v1/recolor`: repaints an image with exactly `colors` palette colors (default 48, `palette` default darlart-v3, `exclude` = comma-separated codes never to use, `smooth` 0/3/5 median filter, `maxSide` default 2048). Multipart `image` file or `imageUrl`. Returns `{ colorCount, width, height, colors: [{ code, hex, rgb, pixels, percent }], image }` with the PNG as base64: every pixel of that PNG is one of the listed colors. Used by the Artwork Agent workflow (`ARTWORK-AGENT.md`).
- `GET /v1/palettes`: the palettes available on the server.
- `GET /health`: liveness check, no API key needed.

### CLI

```bash
node server/dist/server/src/cli.js -i cropped.jpg -o out/ --size 40x50 --orientation portrait --colors 24 --difficulty medium --crop-mode center --order 1042
```

## 4. n8n workflow

Import `n8n-darlart-canvas-workflow.json` (Workflows → Import from file), then:

1. **Normalize order** (top of the code):
   - `PBN_API_URL`: `http://127.0.0.1:3000` when n8n and the API run on the same machine.
   - `DIFFICULTY`: the level used for every order (`easy`, `medium` or `hard`).
   - `DEFAULT_COLORS`: used when the order has no color count.
   - The property names already match the crop widget (`Photo`, `Format`, `Orientation`, `Couleurs`). `FORMATS` maps each print format to the paper it is printed on: A4 = `21x29.7` cm, A3 = `29.7x42`, A2 = `42x59.4`, so the template fills the sheet exactly. Orders that still carry a canvas size in cm keep working.
2. **Delivery to the customer is sent by Shopify**, not by your SMTP: the workflow fulfils the order with the Drive folder as the tracking URL, and Shopify e-mails the customer from your store's sender. That's the part with the good deliverability, so nothing lands in spam.
   - **Prepare delivery** builds the link `https://drive.google.com/drive/folders/<order folder>`. Set `SHOP_DOMAIN` at the top of that node.
   - **Find fulfillment order** and **Notify customer (Shopify)** call the Admin API. Give them your Shopify credential (n8n predefined type "Shopify Access Token API"); the app needs the fulfillment scopes (`write_merchant_managed_fulfillment_orders`, `read_orders`).
   - **Share order folder** shares that one folder with "anyone with the link can view", through the Drive API with your Google credential. The parent "Orders" folder is never shared, so one customer's link can't reach another customer's order.
   - In the admin, edit **Settings → Notifications → Shipping confirmation**: that's the e-mail the customer receives, so replace the shipping wording with "your files are ready" and label the tracking link "Open my files".
   - **Email: files to customer** is still in the workflow but disabled: enable it if you ever want the files attached over SMTP instead.
2. **Credentials**
   - *Header Auth* "pbn-api": name `x-api-key`, value = `API_KEY`. Use it on **Create generation job** and **Download file**.
   - *Header Auth* "pbn-callback": name `x-callback-secret`, value = `CALLBACK_SECRET`. Use it on **Wait for job**.
   - *Header Auth* for **Webhook: order from another channel** (any secret you choose).
   - Shopify, Google Drive and SMTP credentials on their nodes.
3. **Create order folder**: replace `REPLACE_WITH_ORDERS_FOLDER_ID` with the id of your Drive "Orders" folder.
4. **Notify** nodes: set `fromEmail` / `toEmail`.
5. To store elsewhere (Dropbox, S3…), replace **Create order folder** and **Upload to Google Drive** with that service's nodes. The downloaded file is in the `data` binary property.

Other channels can POST an already cropped photo to the webhook:

```json
{ "orderId": "1042", "paid": true, "photoUrl": "https://…/cropped.jpg", "canvasSize": "40x50", "orientation": "portrait", "colors": 24, "customerEmail": "…" }
```

### What happens on errors

- **Unpaid order:** ignored.
- **Missing photo or size:** you get an email; nothing is generated.
- **Job failed, or no callback within 30 min:** you get an email.
- **Cropped photo under 800 px on its short side:** the canvas is still generated and saved, and you get an email to check the detail.
- **Wait node never resumes:** the API can't reach n8n's callback URL (built from n8n's `WEBHOOK_URL`). Check `journalctl -u pbn-api` and that the machine can reach that URL.

## 5. Tuning

- **Difficulty:** one fixed level set in **Normalize order**. The presets (facet sizes, border smoothing…) are in `src/core/settings.ts` (`DIFFICULTY_PRESETS`); the website and API both read them.
- **Photo quality:** the widget warns the customer below 1400 px (`MIN_RECOMMENDED_SIDE` in `shopify/assets/darlart-canvas-crop.js`), and so does **Summarize order** (`MIN_SHORT_SIDE`). The PDF is vector, so the upload resolution doesn't set print sharpness: it sets how much detail the tracer sees (the pipeline works at 1024 px).
- **Re-sending files:** the API deletes a job's files after `RETENTION_DAYS` (14 by default), so the Drive copy is the archive. Raise it to 30 in `/etc/pbn/api.env` if you want a longer window to re-send from the API itself.
