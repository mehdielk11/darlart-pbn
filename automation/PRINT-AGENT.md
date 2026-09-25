# Darl'Art Print Agent (n8n)

`n8n-darlart-print-agent.json`: turns each artwork of `Artwork Agent/1xxx` into paint-by-numbers print files, with the pbn API on the VM (the same code as the website's buttons).

```
Artwork Agent finished / Run now / every day 04:00
  -> queue lock (one worker at a time)
  -> folders still missing print files, oldest first (maxPerRun per run)
  -> one pbn job at a time: canvasSizes x colorsList (default 60x75 x 12/24/36/48), HARD, orientation auto
  -> 1xxx/Print/<stamp>_<size>_<N>_blank.svg + _catalog.pdf + _user.pdf, then 1xxx/<stamp>_mockup.png
  -> release the lock; if files were saved, start again (picks up folders that arrived meanwhile)
```

## Files
- `Print/<stamp>_60x75_24_blank.svg`: the website's **Blank SVG** (`blank.svg`): grey outlines and black numbers on white, no colors (the file printed on the canvas);
- `Print/<stamp>_60x75_24_catalog.pdf`: the website's **Agency PDF** (`painting.pdf`): colored template with grey outlines and numbers, plus the palette page;
- `Print/<stamp>_60x75_24_user.pdf` (one per version): the website's **User PDF** (`template.pdf`): finished painting, painted template with numbers, legend with numbers and colors only;
- `<stamp>_mockup.png`: one kit mockup, from the first canvas size at `mockupColors` (48). It's saved last, so it also marks the folder as done.

## Orientation and crop
The job is sent with `orientation: auto`: the API compares the artwork's width and height, so a portrait artwork becomes **60x75** and a landscape (or square) one **75x60**. It crops automatically to the exact ratio without distortion (`cropMode: attention` keeps the most interesting area). The size the API chose is part of the file names.

## Canvas sizes and variants
`canvasSizes` and `colorsList` in **Settings** decide what is made, e.g. `30x40,40x50` and `12,24,36,48`. The website's size buttons play no part. A folder is complete when every size × color exists, in either orientation. Adding a size later makes every folder pending again, for that size only.

## Queue
- Only one run works at a time. A run first creates `Artwork Agent/_print-agent.lock-<execution>`.
- If another fresh lock exists, it waits 30 s and tries again (3 times), then stops. The running one starts itself again at the end and will pick up the new folder.
- **Jobs go to the pbn API `parallelJobs` at a time (1)**: the server has 1 GB of RAM, and a HARD 60x75 job takes a lot of it. As soon as a job is finished, its files are saved to Drive and the next job is sent. The API itself also runs one job at a time (`CONCURRENCY=1`) and one heavy image request at a time (`IMAGE_CONCURRENCY=1`), whatever n8n sends.
- The run checks its jobs every `pollSeconds` (30) and refreshes its lock at every check, so it can take as long as its jobs need: there is no limit on the run itself. `lockStaleMinutes` (20) only has to cover the longest step between two refreshes.
- A job with no result 2 × `jobTimeoutMinutes` + 5 (25 min) after it was sent, a failed job, or one the API no longer knows (restarted) is given up and retried by the next run.
- A folder's mockup is saved once all its jobs are done, and only if none failed: the mockup marks the folder done for the Queue Watchdog.
- Every request to the pbn API (featured images, jobs, files) is sent one item at a time.
- When two runs create a lock at the same moment, the older lock wins.

## Setup
- **Credentials:** Google Drive account (Drive calls), `x-api-key` (pbn API). No callback: the run asks the API for its jobs' state.
- **Publish** the Print Agent: the published Artwork Agent can only call a published sub-workflow. Republish the Artwork Agent after it gained its "Run Print Agent" node.
- **Cost:** no AI calls; about 20–60 s of VM time per variant.
- Rebuild with `node scripts/build-print-agent-workflow.js`.

## Featured image

Before its print jobs, each run makes the missing `1xxx/<date+time>_featured.png` (at most `maxPerRun` folders): the artwork on a blank stretched canvas against a light wall, 1600 x 1600, from the pbn API `POST /v1/featured` (the portrait photo, or the landscape one for an artwork wider than tall). It is the product's first image: the Shopify Uploader waits for it and uploads a WebP copy. Folders that already have their print files get one too. An API error leaves the folder without it, and the next run tries again. A run that made one starts the Shopify Uploader, like a run that saved print files.

## Telegram message

**One message for the whole job**, not one per run: the Print Agent handles `maxPerRun` folders per run and starts itself again while work remains, so each run that made something adds it to a tally (the description of the Drive file `Artwork Agent/_print-report.json`), and the run that finds nothing left to do sends the tally once to `telegramChatId`, then deletes it. It lists the successful generations per folder (print files, mockup, featured image) and how many folders are ready for the Shopify draft. Failed jobs are not reported: the next run retries them.

## Busy and failed runs

A call that finds another run working waits 30 s and tries again (3 times), so work that arrives while a run is finishing is never left behind. A failed run's lock is released at once by the Darl'Art Error Handler (`ERROR-HANDLER.md`).
