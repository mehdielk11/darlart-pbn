import { buildApp } from "./app";
import { config } from "./config";
import { JobManager } from "./jobs";
import { loadPalette } from "./palettes";

async function main() {
    if (!config.apiKey) {
        console.warn("WARNING: API_KEY is not set, the API accepts requests without authentication");
    }
    // fail fast when the default palette is missing
    loadPalette(config.defaultPalette);

    const jobs = new JobManager(loadPalette);
    jobs.init();

    const app = await buildApp(jobs);
    await app.listen({ port: config.port, host: config.host });

    const shutdown = async () => {
        await app.close();
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
