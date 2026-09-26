# Darl'Art Error Handler (n8n)

`n8n-darlart-error-handler.json` (built by `scripts/build-error-handler-workflow.js`): the error workflow (Workflow settings > Error workflow) of the Artwork Agent, the Artwork Worker, the Titling Agent, the Print Agent and the Shopify Uploader.

```
a run fails -> its queue lock is deleted at once (its name ends with the run's execution id)
            -> Telegram alert: workflow, step, error, what happens next, execution link
            -> Artwork Worker only: started again when the failure came after the reference's try was recorded
```

- Without it, a failed run's lock would block the next runs until it goes stale (15 to 20 min).
- **Account or service problems** (no OpenAI credit, wrong key, missing permission, rate limit, service unreachable) are not the work's fault: the worker is not restarted at once, and the run's try markers (`_titling-try-<execution>`, `_upload-try-<execution>`) are deleted, so its folders are not given up for it.
- The worker is not restarted after a failure before its try is recorded (e.g. Drive unreachable) or in its queue clean-up, nor more than `maxRestarts` (5) times in `restartWindowMinutes` (30): the queue is kept, and the Queue Watchdog starts the worker again after 30 minutes.
- n8n runs error workflows for production executions, not for manual test runs ("Run now" in the editor).
- `telegramChatId` in its Settings node; empty = no alert. The same failure (workflow, step, error) is announced at most once every `alertEveryMinutes` (60).
- When the stage is not restarted at once, it leaves a marker `_failed-<stage>` (worker, titling, print, uploader) in Artwork Agent, or refreshes its date: the Queue Watchdog then waits 30 minutes before starting that stage again. The Print Agent leaves the same marker after a run whose jobs all failed.

# Darl'Art Queue Watchdog (n8n)

`n8n-darlart-queue-watchdog.json` (built by `scripts/build-queue-watchdog-workflow.js`): every 5 minutes, it starts a workflow that has waiting work and that nothing is working on.

| Stage | Waiting work |
|---|---|
| Artwork Worker | references in `Artwork Ref/Queue`, or a batch manifest left there over 10 min with no reference |
| Titling Agent | a recent 1xxx folder with `_art.png` and no `_product.json` |
| Print Agent | a recent 1xxx folder with `_art.png` and no `_featured.png` or no `_mockup.png` (the mockup is made last) |
| Shopify Uploader | a recent 1xxx folder with `_product.json`, `_featured.png` and `_mockup.png`, and no `_shopify.json` |

- A stage is started only when no run of it holds a fresh lock (a running workflow starts itself again until nothing is left), and not within 30 minutes of a failure marker.
- Recent folders: created in the last 7 days (`recentDays`). The daily runs of each workflow still cover older ones.
- Each lock says in its Drive description how long it stays fresh without a refresh (`staleMinutes=20`): worker 20, Titling 15, Uploader 20, Print 20. Every running workflow refreshes its lock while it works, so a long run (a 20-image batch) is never mistaken for a crashed one.
- Its successful runs are not kept in the n8n execution list (every 5 minutes); failed ones are, and they alert through the Error Handler.
- It must be **published** to run.

### Locks of cancelled or crashed runs

n8n doesn't call the Error Handler for a **cancelled** or **crashed** run, so its lock would stay in place until it expires. Every 5 minutes, the Watchdog cleans these up:

- It reads the execution id at the end of each lock's name (`<prefix>.lock-<execution id>`), for locks more than a minute old.
- It asks the n8n API about that execution (node "Run of the lock", credential **n8n API**: an API key from Settings → n8n API, Base URL `https://n8n-vm.taildc9f8f.ts.net/api/v1`).
- It deletes the lock when the execution is finished (success, error, canceled, crashed) or no longer exists (404).
- A lock is kept when its run is still going or waiting, or when the check itself fails (missing credential, API down).

