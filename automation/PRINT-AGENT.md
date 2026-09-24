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
- Only one run works at a time, so the pbn API gets one job at a time. A run first creates `Artwork Agent/_print-agent.lock-<execution>`.
- If another fresh lock exists, it stops. The running worker starts itself again at the end and will pick up the new folder.
- The lock is refreshed before every job, and a lock not refreshed for `lockStaleMinutes` (45) counts as crashed and is ignored and removed.
- When two runs create a lock at the same moment, the older lock wins.
- A failed or timed-out job (30 min) is skipped and retried by the next run.

## Setup
- **Credentials:** Google Drive account (Drive calls), `x-api-key` (pbn API), `pbn-callback` (the API's callback into "Wait for pbn job").
- **Publish** the Print Agent: the published Artwork Agent can only call a published sub-workflow. Republish the Artwork Agent after it gained its "Run Print Agent" node.
- **Cost:** no AI calls; about 20–60 s of VM time per variant.
- Rebuild with `node scripts/build-print-agent-workflow.js`.
