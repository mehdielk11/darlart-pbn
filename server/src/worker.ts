/**
 * Worker thread entry: runs one generation job so the API stays responsive while the CPU-heavy processing runs
 */
import { parentPort, workerData } from "worker_threads";
import { generate, GenerateRequest } from "./generate";

async function main() {
    const port = parentPort;
    if (!port) {
        throw new Error("worker.ts must run as a worker thread");
    }
    let lastSent = 0;
    try {
        const result = await generate(workerData as GenerateRequest, (step, progress) => {
            const now = Date.now();
            if (now - lastSent > 500 || progress >= 1) {
                lastSent = now;
                port.postMessage({ type: "progress", step, progress });
            }
        });
        port.postMessage({ type: "done", result });
    } catch (e) {
        port.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
}

main();
