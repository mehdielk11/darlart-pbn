# Darl'Art Error Handler (n8n)

`n8n-darlart-error-handler.json` (built by `scripts/build-error-handler-workflow.js`): the error workflow (Workflow settings > Error workflow) of the Artwork Agent, the Artwork Worker, the Titling Agent, the Print Agent and the Shopify Uploader.

```
a run fails -> its queue lock is deleted at once (its name ends with the run's execution id)
            -> Telegram alert: workflow, step, error, what happens next, execution link
            -> Artwork Worker only: started again when the failure came after the reference's try was recorded
```

- Without it, a failed run's lock would block the next runs until it goes stale (15 to 45 min).
- The worker is not restarted after a failure before its try is recorded (e.g. Drive unreachable): the alert asks to click Run now once the cause is fixed. The queue is kept.
- n8n runs error workflows for production executions, not for manual test runs ("Run now" in the editor).
- `telegramChatId` in its Settings node; empty = no alert.
