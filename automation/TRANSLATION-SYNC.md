# Darl'Art Translation Sync (n8n)

`n8n-darlart-translation-sync.json`, built by `scripts/build-translation-sync-workflow.js`. It gives the n8n products their **French and Arabic title and description**.

**When it runs:** every hour (at :40), or on "Run now". It handles 10 products per run and starts itself again while more are waiting.

## How it works

1. It reads every "Paint by Numbers Kit" product. Only the Shopify Uploader's products are handled (handle `…-<folder>`, SKUs starting with the folder number); manual products are never touched.
2. A product needs work when its **title** or **description** has **no** French or Arabic translation, or an **outdated** one. Shopify marks a translation outdated when the English text changes.
3. The AI (`gpt-5-mini`, the same model and OpenAI credential as the Titling Agent) translates the English text into natural sales copy:
   - it keeps the description's paragraphs (HTML tags);
   - it keeps "Darl'Art", sizes and colour counts as they are.
4. The answer is checked before saving: nothing empty, same paragraphs, title under 255 characters. A rejected translation is tried again the next hour, 3 times at most (see Cost control).
5. It saves the translations in Shopify (`translationsRegister`), where you can see and edit them in **Settings → Languages → Translate & Adapt → Products**.

## Rules

- **URLs are not translated:** a product keeps the same handle in every language.
- **Your manual edits are kept:** a translation you change by hand stays as it is until its English text changes.
- **Tags aren't translated:** Shopify doesn't support translating product tags.
- **Canvas option names** (Rolled/Stretched Canvas) are translated by the Price Sync.
- One run works at a time (lock `_translation-sync.lock-<execution>` in Artwork Agent). The Error Handler releases the lock of a failed run, and the Queue Watchdog releases that of a cancelled one.
- **Telegram** gets one message per run when something was translated or failed.

## Cost control

- **Only what is missing is sent:** a product whose French title alone is outdated sends only its English title, and asks only for French. A product with an empty description sends only its title.
- **3 tries per product** (`maxTries`): a failed translation counts as a try, kept in the product's metafield `darlart.translation_tries` with a fingerprint of its English text. After 3 tries the product is **given up** (the Telegram report says so): translate it by hand in Translate & Adapt. It is tried again by itself when its English title or description changes.
- Products never tried go first, so a product that fails never holds up the others.
- A failure of the **OpenAI account** (no credit, wrong key, rate limit) is not counted against the products; the report says to check the account.
- The workflow starts itself again only when it translated something, so a failing run never loops.
- **Runs that succeed are not kept** in the n8n execution list (one run an hour would fill the database); the Telegram report says what was done. Failed runs and "Run now" runs are kept.
