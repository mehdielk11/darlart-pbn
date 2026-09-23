# Darl'Art artwork from a WhatsApp photo (n8n)

`n8n-darlart-artwork-whatsapp.json` replaces the Custom GPT. Someone sends a photo on WhatsApp with the number of colors in the caption (12, 24, 36 or 48; 24 if missing). The workflow replies with:

1. the artwork, painted by OpenAI's image model with only the chosen Darl'Art colors;
2. a message with the Shopify product title, a short description and the palette JSON:

```json
{"colors": 24, "palette": [{"id": "2101", "hex": "#32B5E9", "use": "sky"}]}
```

## How it works

```
WhatsApp Trigger → Parse message (photo + color count) → Settings → Has photo?
  → Get photo URL → Download photo
  → Art director (AI Agent, gpt-5 vision): picks exactly N palette colors for the photo,
    describes the scene, writes the title and description (structured JSON)
  → Validate palette: every ID must exist in the Darl'Art palette, the HEX is always taken from the palette
    (never from the model), exactly N distinct colors. Otherwise it asks the art director once more.
  → Paint artwork (OpenAI /v1/images/edits, gpt-image-2): the photo + a fixed prompt that lists the N HEX colors,
    input_fidelity "high" to keep faces and likeness
  → Check artwork (AI Agent, gpt-5-mini vision): rejects any color bar, swatches, text, border or pixel-art look.
    It paints again, up to 3 images in all.
  → Upload and send the artwork → send title, description and palette JSON
```

The image model only ever receives the photo and the prompt: never the full palette, never the conversation. That's what made the Custom GPT draw palette strips.

## Setup

### 1. WhatsApp Cloud API (Meta)
1. In [Meta for Developers](https://developers.facebook.com/apps), create an app of type **Business** and add **WhatsApp**.
2. Note the **Phone number ID** and create a **permanent access token** (Business Settings → System users → generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`).
3. Add your own number as a test recipient while the app is in development.

### 2. Credentials in n8n
| Credential | Type | Used by |
|---|---|---|
| WhatsApp OAuth | *WhatsApp OAuth API* (app Client ID + Client Secret) | WhatsApp Trigger |
| WhatsApp Cloud API token | *Header Auth*: name `Authorization`, value `Bearer <permanent token>` | every Graph API call (download, upload, send) |
| OpenAI | *OpenAI API* (your API key) | both chat models and **Paint artwork** |

The OpenAI organization must be verified to use the GPT image models (platform.openai.com → Settings → Organization → Verify).

### 3. Import
Workflows → Import from file → `n8n-darlart-artwork-whatsapp.json`. Pick the three credentials on the nodes that show a warning, then activate the workflow. The WhatsApp Trigger registers its webhook with Meta when the workflow is activated, so n8n must be reachable over HTTPS.

### 4. Settings
- **Settings** node: `graphVersion` (Graph API version), `imageModel` (`gpt-image-2`), `imageQuality` (`high`, `medium` or `low`), `language` of the title and description (`English`, `French`…).
- **Parse message** node: `DEFAULT_COLORS`, and `ALLOWED_SENDERS`. Put your own numbers there: every request costs OpenAI credits, and anyone who finds the number could use it.
- **Art director model** / **Checker model**: the chat models (`gpt-5` and `gpt-5-mini`; any vision model works).
- **Count attempts** node: `MAX_ATTEMPTS` (3 images at most per request).

## Use

Send a photo to the WhatsApp number, with `24` (or 12, 36, 48) as the caption. The reply takes 1 to 3 minutes, depending on image quality and retries.

## Limits

- The image model paints with the listed colors, but it can't guarantee that every pixel is exactly one of them: edges are smoothed and flat areas can drift slightly. The palette JSON is exact: it's the list of Darl'Art colors the image is built on, all checked against the palette.
- WhatsApp compresses photos sent as images. For the best likeness, send the photo "as a document" (the workflow accepts image documents too).
- Meta only lets a business send free-form replies within 24 hours of the customer's last message, which is always the case here, since the reply answers the photo.
