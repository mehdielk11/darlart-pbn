# Digital-only migration: what is done, and what only you can do

The store sells printable paint-by-numbers files: the customer frames a photo, pays online, and receives the PDF, the preview and the paint list by e-mail within minutes. Nothing is shipped.

## Done, in the theme "Copy of Darl'Art" (never in the live theme)

- **Buy box (`sections/2.liquid`)**: a `digital_mode` setting hides the canvas type step, the canvas guide, the size comparison, the "Canvas Dimensions", "Every Kit Includes" and "Shipping Details" blocks, and the "What is Paint by Numbers?" block. The delivery date line is replaced by `digital_delivery_text`.
- **Print formats**: the widget and the generator work in A4 / A3 / A2. The crop has the exact proportions of the sheet, so the customer prints at 100 % and gets the real format. The order carries `Format: "A3 (29,7 × 42 cm)"`.
- **Product page template** (`templates/product.custom-pbn.json`): digital mode on, frame and paint add-ons off, the shipping section rewritten as "Your files, minutes after checkout", the FAQ rewritten for files, and the monthly mystery-kit block switched off.
- **Home page** (`templates/index.json`): same shipping section and FAQ rewrite, mystery-kit block off.
- **Header**: the top bar now reads "INSTANT DOWNLOAD · YOUR FILES BY E-MAIL IN MINUTES".
- **Footer**: the tagline now reads "Printable Paint by Numbers, made from your photo".
- **Automation**: n8n e-mails the customer their files when the order is paid, keeps your Drive copy, and alerts you if a delivery needs a human.
- **New product** (draft): "Custom Printable Paint by Numbers", options Format (A4/A3/A2) × Colors (12/24/36/48), 12 variants, all marked as not requiring shipping.

## Only you can do these

**In the admin, before going live**

1. **Prices** on the 12 variants of the new draft product, plus photos and a description.
2. **Turn off cash on delivery** and keep online payment only. A digital order must be paid before the files are sent.
3. **Publish "Copy of Darl'Art"**. Until then, customers still see the physical theme.
4. **Set the product to Active** and tick the Online Store sales channel.
5. **Archive or redirect** the old "Custom Paint by Numbers Kit" (it still offers canvas sizes in cm).

**Shared with the live theme — I did not touch these**

These live in the store, not in the theme, so changing them changes the live store too:

| Where | What it says today | Suggested |
|---|---|---|
| Menu "Legal" → Shipping Policy page | shipping and delivery times | Replace with a "Delivery of your files" page: files by e-mail within minutes, re-send on request |
| Menu "Help" → Track Your Order page | order tracking | Remove from the menu, or point it at Contact |
| Refund policy | returns of physical goods | Digital goods are not returnable once delivered; say what you do if a file can't be printed |
| Terms of service | physical sale | Mention the licence: personal use, printing as often as they like, no resale |
| FAQ page (`/pages/faq`) | kits, paints, shipping | Same rewrite as the product page FAQ |
| "How it works" page | painting a kit that arrives | Upload a photo → choose a format → print → paint |
| Order confirmation e-mail (Settings → Notifications) | "we'll ship it soon" | Tell the customer the files are on their way by e-mail, and to check spam |
| Home page hero (3 slides, EN/AR/FR) | "complete kits" | Brand copy in three languages — your call, tell me the wording and I'll apply it |
| Mini Kits banner and the physical products | kits that ship | Kept as they are, since the physical catalogue stays for now |

**On the server**

- `git pull && npm ci && npm run build:server && sudo systemctl restart pbn-api` so the API knows the print formats.
- Optionally raise `RETENTION_DAYS` to 30 in `/etc/pbn/api.env` so files can be re-sent for a month.
- Set SPF, DKIM and DMARC on the sending domain, otherwise the delivery e-mail lands in spam.

## Test before going live

1. In n8n, run the workflow once with a sample paid order carrying a `Format` property, and send the customer e-mail to yourself.
2. Place one real test order, paid online, and check that the files arrive and the Drive folder is created.
