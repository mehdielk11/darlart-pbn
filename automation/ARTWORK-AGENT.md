# Darl'Art Artwork Agent (n8n)

`n8n-darlart-artwork-agent.json`: upload a reference image in a form, get a painted artwork that uses **exactly 48 Darl'Art colors**, saved in Google Drive.

```
Formulaire (upload) -> Save reference (Drive "Artwork Ref")
  -> Generate ART (gpt-image-2: reference + fixed prompt, the reference's own colors)
  -> Check artwork (gpt-5-mini: no swatches/text/border, up to 3 tries)
  -> Snap to palette (pbn API /v1/recolor: every pixel -> one of 48 Darl'Art colors)
  -> Create folder "Artwork Agent/1xxx" -> upload ref + art + palette JSON -> result page
```

## Why the palette is strict

An image model cannot be forced to use exact HEX values (and palette lists in the prompt get painted into the image as swatches), so it paints the reference's own colors. The **Snap to palette** step then measures the painting and repaints every pixel with the 48 distinct Darl'Art colors that represent it best (k-means in Lab, snapped to the palette, refined). "Check palette" stops the run if the result has anything other than 48 valid Darl'Art colors, so a saved artwork is always compliant. Codes 3801 (white) and 3811 (near black) are excluded; change `exclude` in **Settings** to allow them.

## Output

`Artwork Agent/1001`, `1002`, ... (next free number), each containing:
- `2026-09-23_14-05-33_ref.jpg`: the reference as uploaded (also kept in `Artwork Ref`);
- `2026-09-23_14-05-33_art.png`: the 48-color artwork;
- `2026-09-23_14-05-33_palette.json`: the 48 colors (code, hex, rgb, area percent).

## Setup

1. The pbn API must include `/v1/recolor` (redeploy the VM: `git pull && npm ci && npm run build:server && sudo systemctl restart pbn-api`).
2. Import the workflow, then pick the credentials: **OpenAI** on `Checker model` and `Generate ART`; **Google Drive** on `Save reference`, `List Artwork Agent folders`, `Create folder`, `Upload to folder`; the pbn API **x-api-key header** on `Snap to palette`.
3. **Settings** node: Drive folder IDs (`Artwork Ref`, `Artwork Agent` already created in My Drive), colors (48), excluded codes, pbn API URL, image model.
4. Activate, open the Formulaire production URL.

After changing `server/palettes/darlart-v3.json`, run `node scripts/build-artwork-agent-workflow.js` and re-import (Check palette embeds the palette).

Cost: `imageQuality` in Settings drives it. About $0.08 per artwork on `medium`, $0.20 on `high` (gpt-image-2 output dominates; the checker is ~$0.005).
