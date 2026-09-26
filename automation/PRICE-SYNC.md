# Darl'Art Price Sync (n8n)

`n8n-darlart-price-sync.json`, built by `scripts/build-price-sync-workflow.js`. It keeps the products the Shopify Uploader made in line with the prices Google Sheet ("Darl'Art Prices").

**When it runs:** every hour (at :20), or on "Run now".

## What it does

- It reads the sheet exactly like the Uploader does (`scripts/lib/prices-code.js`).
- It only touches products made by the Uploader: those whose handle ends with the folder number (`…-1003`) and whose SKUs all start with that number. Manual products are never touched.
- Per product, only what differs from the sheet:

| In the sheet | In Shopify |
|---|---|
| Price or compare-at price changed | The variant is updated. It keeps its ID, so carts and orders are safe. |
| Price set to **0** (or left empty) | The variant is deleted: the combination is not sold. |
| Price above 0 again | The variant is created again with the Uploader's SKU, and the options are put back in order. |
| Combination missing from the sheet | Nothing happens. A mistake in the sheet can never empty the store. |

- A product always keeps at least one variant.
- It sends one Telegram message when something changed or failed, and nothing when everything already matches.
- One run works at a time, using a Drive lock (`_price-sync.lock-<execution>`) that the Error Handler releases if a run fails.

## "Not sold" (price 0)

A price of 0 means the combination gets no variant at all, from the Uploader (new products) and from this sync (existing products). Because of that:

- no "0 MAD" ever appears on product cards, in search or in Google Shopping, and the combination can't be bought;
- on the product page, the choice is greyed out, labelled "Not available" ("Non disponible" / "غير متوفر") and can't be clicked. This is done by the theme script `shopify/darlart-variant-gate.js`, which the theme stores as `assets/darlart-variant-gate.js`. It loads on product pages from `snippets/global-script-2.liquid`.
- Choices are made top to bottom (canvas, then size, then colours). A choice is greyed only when no variant for sale matches it and the choices above it. After a click, the choices below move to the nearest variant for sale.
- If **every** combination of a value is 0 (for example all of 20x25), that value no longer appears on the page.

## Execution list

Runs that succeed are not kept in the n8n execution list (one run an hour would fill the database); the Telegram report says what changed. Failed runs and "Run now" runs are kept.
