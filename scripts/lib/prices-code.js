/**
 * The "Prices" code node shared by the Shopify Uploader and the Price Sync workflows: the prices Google Sheet (CSV
 * export) becomes the product's options and variants, Size / Canvas Type / Colors, like the store's other kits.
 *
 * A price of 0 means "not sold": that combination gets no variant in Shopify, so it never shows a 0 price anywhere
 * (collections, search, feeds) and cannot be bought; the product page shows it greyed out. The node needs a
 * "Settings" node (sizes, compareAtMultiplier) and a "Prices file" node (the sheet's name and modifiedTime), and
 * takes the CSV text in $json.data.
 *
 * Output: productOptions and variants (the sold combinations, productSet input), rows (every sheet row with its
 * key "size|canvas type|colors" and sold true/false) and pricesVersion (the sheet's modifiedTime).
 */
const PRICES_CODE = `// The CSV becomes the product's options and variants: Size / Canvas Type / Colors, like the store's other kits.
// A price of 0 means "not sold": no variant for that combination (the product page shows it greyed out).
const settings = $('Settings').first().json;
const file = $('Prices file').first().json;
const text = String($input.first().json.data || "").replace(/^\\uFEFF/, "");
// empty rows of the sheet export as ",,," lines
const lines = text.split(/\\r?\\n/).map((l) => l.trim()).filter((l) => l.replace(/[,;"\\s]/g, ""));
// one CSV line into cells; a quoted cell may hold a comma (e.g. "179,00" in a French-format sheet)
const split = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === "," || ch === ";") { cells.push(cell.trim()); cell = ""; }
        else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
};
const header = split(lines.shift() || "").map((h) => h.toLowerCase().replace(/\\s+/g, "_"));
const col = (name) => header.indexOf(name);
for (const name of ["canvas_type", "size", "colors", "price"]) {
    if (col(name) < 0) throw new Error(file.name + ": missing column " + name + " (columns: canvas_type,size,colors,price)");
}
// "179", "179.00", "179,00" or "179,00 MAD"; an empty price cell counts as 0 (not sold)
const money = (value) => Number(String(value).replace(/[^\\d,.-]/g, "").replace(",", ".") || "0");
const normSize = (value) => String(value || "").toLowerCase().trim().replace(/\\s*cm$/, "").replace(/\\s*[x×]\\s*/, "x");
const soldSizes = String(settings.sizes || "").split(",").map(normSize).filter(Boolean);
const rows = [];
const seen = new Set();
lines.forEach((line, i) => {
    const cells = split(line);
    const size = normSize(cells[col("size")]);
    if (soldSizes.length && !soldSizes.includes(size)) return; // not a size the store sells
    let canvasType = cells[col("canvas_type")];
    if (!/canvas$/i.test(canvasType)) canvasType += " Canvas"; // "Rolled" -> "Rolled Canvas", the store's wording
    const colors = String(parseInt(cells[col("colors")], 10));
    const price = money(cells[col("price")]);
    const compareCell = col("compare_at_price") >= 0 ? cells[col("compare_at_price")] : "";
    const compareAt = compareCell ? money(compareCell) : price * Number(settings.compareAtMultiplier || 0);
    const where = file.name + " line " + (i + 2);
    if (!/^\\d+x\\d+$/.test(size)) throw new Error(where + ": size must look like 30x40");
    if (colors === "NaN") throw new Error(where + ": colors must be a number");
    if (!(price >= 0)) throw new Error(where + ": price must be a number (0 = not sold)");
    const key = size + "|" + canvasType + "|" + colors;
    if (seen.has(key)) throw new Error(where + ": " + key.replace(/\\|/g, " / ") + " is listed twice");
    seen.add(key);
    const sold = price > 0;
    rows.push({ key, size, canvasType, colors, sold, price: price.toFixed(2), compareAtPrice: sold && compareAt > price ? compareAt.toFixed(2) : null });
});
if (!rows.length) throw new Error(file.name + " has no prices" + (soldSizes.length ? " for the sizes in Settings (" + soldSizes.join(", ") + ")" : ""));
const missing = soldSizes.filter((s) => !rows.some((r) => r.size === s));
if (missing.length) throw new Error(file.name + " has no prices for " + missing.join(", ") + " (sizes in Settings; a price of 0 marks a combination not sold)");
const soldRows = rows.filter((r) => r.sold);
if (!soldRows.length) throw new Error(file.name + ": every price is 0, a product needs at least one combination for sale");
if (soldRows.length > 100) throw new Error(file.name + ": Shopify allows 100 variants per product, the sheet has " + soldRows.length + " prices above 0");

const area = (s) => s.split("x").reduce((a, b) => a * Number(b), 1);
const unique = (values) => [...new Set(values)];
const order = (list) => {
    const sizes = unique(list.map((r) => r.size)).sort((a, b) => area(a) - area(b));
    const canvasTypes = unique(list.map((r) => r.canvasType)).sort();
    const colors = unique(list.map((r) => r.colors)).sort((a, b) => a - b);
    list.sort((a, b) => sizes.indexOf(a.size) - sizes.indexOf(b.size) || canvasTypes.indexOf(a.canvasType) - canvasTypes.indexOf(b.canvasType) || a.colors - b.colors);
    return { sizes, canvasTypes, colors };
};
order(rows);
// the options list only the values that have a combination for sale (Shopify has no option value without a variant)
const values = order(soldRows);
const productOptions = [
    { name: "Size", position: 1, values: values.sizes.map((name) => ({ name })) },
    { name: "Canvas Type", position: 2, values: values.canvasTypes.map((name) => ({ name })) },
    { name: "Colors", position: 3, values: values.colors.map((name) => ({ name })) },
];
const variants = soldRows.map((r, i) => ({
    optionValues: [
        { optionName: "Size", name: r.size },
        { optionName: "Canvas Type", name: r.canvasType },
        { optionName: "Colors", name: r.colors },
    ],
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    position: i + 1,
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: false, requiresShipping: true },
}));
return [{ json: { pricesVersion: file.modifiedTime, variantCount: variants.length, notSold: rows.length - soldRows.length, productOptions, variants, rows } }];`;

module.exports = { PRICES_CODE };
