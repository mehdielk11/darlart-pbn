# Darl'Art Titling Agent (n8n)

`n8n-darlart-titling-agent.json`: writes the Shopify product texts for every artwork made by the Artwork Agent.

```
Run now / every hour -> Shopify collections (themes) -> Drive "Artwork Agent" folders
  -> folders with <date+time>_art.png and no <date+time>_product.json, one by one:
     download the artwork -> Titling agent (gpt-5-mini, sees the artwork)
     -> <date+time>_product.json saved in the same folder
```

Result: `Artwork Agent/1xxx` = Artwork Ref + Artwork Gen + palette JSON + product JSON.

## The product JSON

Shopify's own field names, so a later workflow can create the product as is:
- `title`, `handle`, `descriptionHtml` (two paragraphs);
- `productType` "Paint by Numbers Kit", `vendor` "Darl'Art";
- `category`: Shopify standard taxonomy "Paint by Number Kits" (`gid://shopify/TaxonomyCategory/tg-5-2-5`);
- `themes` and `collections`: 1 or 2 themes chosen from the store's live collections (Animals, Flowers, Morocco...), with the main collection's id;
- `tags`: `paint-by-numbers`, the theme tags (the Kids Kits smart collections match on them, e.g. `animals`) and the agent's keywords;
- `needsReview`: set when no store theme matched;
- `source`: the folder and its artwork, reference and palette files.

## Notes

- A folder is done once its `_product.json` exists: delete that file to have it rewritten.
- New collections in Shopify are picked up automatically. Non-theme collections are listed in `skipCollections` (Settings).
- About $0.005 per artwork. Publish the workflow to run it every hour; "Run now" works anytime.
- Credentials: "Shopify darlart.ma" (Shopify OAuth2, store smgi0i-0a = darlart.ma), Google Drive account, OpenAI.
- Rebuild the file with `node scripts/build-titling-agent-workflow.js`.
