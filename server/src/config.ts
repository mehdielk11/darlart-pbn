import os from "os";
import path from "path";

const int = (value: string | undefined, fallback: number) => {
    const parsed = parseInt(value || "", 10);
    return isNaN(parsed) ? fallback : parsed;
};

const port = int(process.env.PORT, 3000);

export const config = {
    port,
    host: process.env.HOST || "0.0.0.0",
    /** Required on every /v1 request as the x-api-key header. Leave empty only for local development. */
    apiKey: process.env.API_KEY || "",
    /** Base URL used in the file links returned to n8n, e.g. http://pbn-api:3000 inside Docker */
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
    palettesDir: process.env.PALETTES_DIR || path.join(__dirname, "../../../palettes"),
    mockupsDir: process.env.MOCKUPS_DIR || path.join(__dirname, "../../../../mockups"),
    defaultPalette: process.env.DEFAULT_PALETTE || "darlart-v2",
    concurrency: Math.max(1, int(process.env.CONCURRENCY, Math.max(1, os.cpus().length - 1))),
    jobTimeoutMs: int(process.env.JOB_TIMEOUT_MS, 10 * 60 * 1000),
    retentionDays: int(process.env.RETENTION_DAYS, 14),
    maxImageBytes: int(process.env.MAX_IMAGE_BYTES, 30 * 1024 * 1024),
    /** Sent as the x-callback-secret header so the n8n webhook can check the call comes from this API */
    callbackSecret: process.env.CALLBACK_SECRET || "",
};
