# Darl'Art Shopify Uploader (n8n)

`n8n-darlart-shopify-uploader.json` (built by `scripts/build-shopify-uploader-workflow.js`): turns every finished `Artwork Agent/1xxx` folder into a **draft** product on darlart.ma.

```
Print Agent finished / Run now / every day 05:00 -> "Darl'Art Prices" sheet (Drive) -> Drive "Artwork Agent" folders
  -> folders with _product.json + _art.png + _mockup.png and no _shopify.json, one by one:
     staged upload of the artwork and the mockup to Shopify
     -> productSet: draft product (texts, collections, variants + prices, images)
     -> image order enforced (productReorderMedia), then read back until it is right
     -> <date+time>_shopify.json saved in the folder (product id, admin link)
```

## The product

- From `_product.json` (Titling Agent): title, description (paragraphs wrapped in `<p>`), tags, collections, product type, vendor. No Shopify category is set.
- Never added to a Mini Kits or Kids Kits collection (filled by hand later): those collections are dropped, and so are tags they match on (`mini-kit`, `kids-kits`...).
- Handle: the product JSON's handle plus the folder number, e.g. `blue-iris-1003`. A rerun updates that same draft instead of creating a second one, and an existing product with the plain handle is never touched.
- Images, in an enforced order: 1 the artwork, 2 the mockup, 3-5 the shared images (`sharedImages` order in Settings). After creating the product, the workflow reorders its images and reads the order back every 3 seconds until it matches. If it still doesn't match after 30 seconds, the run stops and that folder gets no marker, so the next run tries it again.
- Options Size / Canvas Type / Colors with one variant per sheet row of a size the store sells (`sizes` in Settings: 20x25, 32x40, 40x50; 3 sizes x 2 canvas types x 4 color counts = 24 variants), the same as the store's other kits (not tracked, inventory policy DENY).
- SKU per variant: folder + size digits + color count + canvas type initial (R Rolled, S Stretched), e.g. folder 1001, 20x25, 12 colors, Rolled = `1001202512R`.
- Status `DRAFT`: review it in Shopify and publish it yourself.

## Prices: Google Sheet "Darl'Art Prices"

In the Drive "Artwork Agent" folder (`pricesSheetId` in Settings). Its first tab is read on every run, so edit the sheet directly: every product uploaded after the change gets the new prices. Products already uploaded keep their prices.

| canvas_type | size | colors | price | compare_at_price (optional) |
|---|---|---|---|---|
| Rolled | 20x25 | 12 | 179 | |

- `canvas_type`: `Rolled` becomes "Rolled Canvas" (the store's wording).
- `price`: 179, 179.00 or 179,00 all work.
- `compare_at_price`: optional. Without it the compare-at price is `price x compareAtMultiplier` (2).
- Each row of a size listed in `sizes` (Settings) becomes one variant (Shopify allows 100 at most). Rows of other sizes (e.g. 60x75, kept for the PBN generator only) are skipped, and every size in `sizes` must have prices. Empty rows are ignored; a wrong row stops the run with its line number.
- Keep the column names in row 1 and the prices on the first tab.

## Shared images

Upload the 3 images once in Shopify admin > Content > Files, copy each link, and paste them comma-separated into `sharedImages` in the Settings node. A file ID (`gid://shopify/MediaImage/...`) works too, and keeps Shopify from storing a new copy for each product.

## Notes

- A folder is done once its `_shopify.json` exists: delete that file to upload the folder again (it updates the same draft).
- The Shopify credential needs the `write_products` and `write_files` scopes.
- Must be **published** for the Print Agent's production runs to call it.
