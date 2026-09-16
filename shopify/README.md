# Shopify crop widget

On the product page the customer:
1. chooses the print format (A4 / A3 / A2, or a canvas size in cm), the orientation (portrait / paysage) and, if enabled, the number of colors;
2. uploads a photo;
3. frames it by dragging and zooming inside a frame with the exact canvas proportions;
4. clicks "Valider le cadrage" and sees the result: the framed photo at the canvas proportions, with the size, orientation and number of colors under it. "Modifier le cadrage" reopens the editor, "Changer de photo" starts over. The result stays in step with the canvas: changing the size, orientation or colors re-frames the photo and updates the card.

The cropped photo (JPEG, up to 3000 px) is attached to the product form as a file line item property. Shopify stores it with the order, so no extra server or app is needed. "Add to cart" is blocked until the photo is attached.

The order line gets these properties, which the n8n workflow reads:

| Property | Example |
|---|---|
| `Photo` | `https://cdn.shopify.com/.../uploads/...jpg` (the cropped photo) |
| `Format` | `A3 (29,7 × 42 cm)`, or `40x50 cm` (`50x40 cm` in landscape) for a canvas |
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

## Darl'Art theme (custom product section "section 2 - product")

That section has no product form: its "Add to cart" button sends the cart with its own Ajax call. It was changed (theme "Copy of Darl'Art", `sections/2.liquid`) so it can ask for the photo:

- New settings under **Customer photo (custom kits)**: *Ask for the customer's photo* (off by default) and *Photo step heading*.
- When the setting is on, the widget is rendered as step 4, after the colors, with
  `{% render 'darlart-canvas-crop', size_group: '.pcp-size-group', colors_group: '.pcp-palette-group', sync_variant: false %}`.
  The widget hides its own size buttons and follows the section's Size and Colors pickers.
- "Add to cart" waits for `widget.dccGetProperties()`. Without a photo, nothing is added and the widget shows a message. With one, the kit line is sent as multipart form data (the photo file can't go in JSON), then any add-ons as JSON.

The template `templates/product.custom-pbn.json` is a copy of `product.json` with the setting turned on.

### Digital products

A second setting, **Digital product (files by e-mail, nothing is shipped)** (`digital_mode`), turns the page into a digital one: it hides the canvas type step (and with it the canvas guide and the frame add-on), the size comparison, the "Canvas Dimensions", "Every Kit Includes" and "Shipping Details" blocks, the "What is Paint by Numbers?" block, and replaces the delivery date line with `digital_delivery_text`. Size values that are not `NNxNN` (like `A4`) no longer get " cm" appended.

The digital product uses print formats instead of canvas sizes: option `Format` (A4 / A3 / A2) and `Colors` (12 / 24 / 36 / 48). The widget maps each format to its paper size in cm (A4 = 21 × 29,7), so the crop has exactly the proportions of the sheet the customer prints on, and the order carries `Format: "A3 (29,7 × 42 cm)"`.

## Test before going live

- Open `shopify/demo.html` locally. It simulates the product form and shows what would be sent to the cart, including the cropped photo.
- On the store, preview the theme, add the product to the cart, and check that the cart/checkout lists `Photo`, `Taille` and `Orientation`. Place a test order, then check the order's line item properties in the admin.
