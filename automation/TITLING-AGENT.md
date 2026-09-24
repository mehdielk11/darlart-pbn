# Darl'Art Titling Agent (n8n)

`n8n-darlart-titling-agent.json`: writes the Shopify product texts for every artwork made by the Artwork Agent.

```
Artwork Agent finished / Run now / every day 03:00 -> Shopify collections (themes) -> Drive "Artwork Agent" folders
  -> folders with <date+time>_art.png and no <date+time>_product.json, one by one:
     download the artwork -> Titling agent (gpt-5-mini, sees the artwork)
     -> <date+time>_product.json saved in the same folder
```

Result: `Artwork Agent/1xxx` = Artwork Ref + Artwork Gen + palette JSON + product JSON.

## The product JSON

Shopify's own field names, so a later workflow can create the product as is:
- `title`, `handle`, `descriptionHtml` (two paragraphs);
- `productType` "Paint by Numbers Kit", `vendor` "Darl'Art";
- `themes` and `collections`: 1 to 3 collections that genuinely fit the painting, best fit first, chosen from the store's live main collections (Animals, Flowers, Morocco...). A theme with only Mini Kits / Kids Kits collections (e.g. Nature, Cities) is not offered: create its main collection to make it available;
- `tags`: `paint-by-numbers`, the theme tags (the Kids Kits smart collections match on them, e.g. `animals`) and the agent's keywords;
- `needsReview`: set when no store theme matched;
- `source`: the folder and its artwork, reference and palette files.

## Notes

- A folder is done once its `_product.json` exists: delete that file to have it rewritten.
- New collections in Shopify are picked up automatically. Non-theme collections are listed in `skipCollections` (Settings).
- About $0.005 per artwork.
- Triggers: the Artwork Agent calls it after saving each artwork ("When called by Artwork Agent", no waiting), a daily run at 03:00 catches anything a failed run left behind, and "Run now" works anytime. It must be **published** for the Artwork Agent's production runs to call it.
- Credentials: "Shopify darlart.ma" (Shopify OAuth2, store smgi0i-0a = darlart.ma), Google Drive account, OpenAI.
- Rebuild the file with `node scripts/build-titling-agent-workflow.js`.
