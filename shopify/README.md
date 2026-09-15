# Shopify crop widget

On the product page the customer:
1. chooses the canvas size (e.g. 40 × 50 cm), the orientation (portrait / paysage) and, if enabled, the number of colors;
2. uploads a photo;
3. frames it by dragging and zooming inside a frame with the exact canvas proportions.

The cropped photo (JPEG, up to 3000 px) is attached to the product form as a file line item property. Shopify stores it with the order, so no extra server or app is needed. "Add to cart" is blocked until the photo is attached.

The order line gets these properties, which the n8n workflow reads:

| Property | Example |
|---|---|
| `Photo` | `https://cdn.shopify.com/.../uploads/...jpg` (the cropped photo) |
| `Taille` | `40x50 cm` (`50x40 cm` in landscape) |
| `Orientation` | `Portrait`, `Paysage` or `Carré` |
| `Couleurs` | `24` (only when the color choice is shown) |

The generator uses the photo as-is (`cropMode: "center"`): it only trims the pixel or two that rounding can add.

## Install in the theme

1. **Upload the files** (Online Store → Themes → … → Edit code):
   - **Assets** → Add a new asset → upload `assets/darlart-canvas-crop.js` and `assets/darlart-canvas-crop.css`.
   - **Snippets** → Add a new snippet named `darlart-canvas-crop` → paste the content of `snippets/darlart-canvas-crop.liquid`.
2. **Add it to the product page** (Customize → product template used by your paint by numbers product):
   - In the product information section, add a **Custom Liquid** block where the widget should appear (usually above the buy buttons) with:
     ```liquid
     {%- assign dcc_form = 'product-form-' | append: section.id -%}
     {% render 'darlart-canvas-crop', form_id: dcc_form %}
     ```
   - `product-form-<section id>` is the product form id in Dawn and most Online Store 2.0 themes. If your theme uses another id, inspect the "Add to cart" `<form>` in the browser and use its `id`.
   - Use a dedicated product template for the paint by numbers product, so the widget doesn't appear on other products.
3. **Turn off "Show dynamic checkout buttons"** ("Buy it now") in the buy buttons block of that template. Those buttons go straight to checkout without the form, so the photo would be missing.
4. **Options:**
   ```liquid
   {% render 'darlart-canvas-crop', form_id: dcc_form, sizes: '30x40,40x50,50x50,60x70', colors: '12,24,36,48', default_colors: '24' %}
   ```
   - `sizes`: canvas sizes in cm. Landscape is offered automatically, and `50x50` hides the orientation choice.
   - `colors`: shows a color count choice. Leave it out when the number of colors is already a product variant.
   - When the product has a size variant (e.g. "40x50"), the widget selects the matching variant automatically. Add `sync_variant: false` to turn that off.
5. **Texts and colors:** the texts are at the top of `darlart-canvas-crop.js` (`TEXT`), and the colors are CSS variables at the top of `darlart-canvas-crop.css` (`--dcc-accent`…).

## Test before going live

- Open `shopify/demo.html` locally. It simulates the product form and shows what would be sent to the cart, including the cropped photo.
- On the store, preview the theme, add the product to the cart, and check that the cart/checkout lists `Photo`, `Taille` and `Orientation`. Place a test order, then check the order's line item properties in the admin.
