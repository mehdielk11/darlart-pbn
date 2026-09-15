/**
 * Job queue: persists jobs on disk, runs them in worker threads with a concurrency limit and a timeout,
 * notifies the callback URL when a job finishes and removes old jobs
 */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { config } from "./config";
import { GenerateRequest, GenerateResult } from "./generate";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobOptions = Omit<GenerateRequest, "inputPath" | "outputDir" | "customColors">;

export interface Job {
    id: string;
    status: JobStatus;
    progress: number;
    step: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    options: JobOptions;
    callbackUrl?: string;
    callback?: { delivered: boolean; attempts: number; lastError?: string };
    result?: GenerateResult;
    error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JobManager {
    private jobs = new Map<string, Job>();
    private queue: string[] = [];
    private running = 0;
    private readonly jobsDir: string;

    constructor(private resolveCustomColors: (paletteId: string) => string) {
        this.jobsDir = path.join(config.dataDir, "jobs");
    }

    /** Loads the jobs kept on disk; jobs that were running when the server stopped are marked as failed */
    public init() {
        fs.mkdirSync(this.jobsDir, { recursive: true });
        for (const id of fs.readdirSync(this.jobsDir)) {
            const file = path.join(this.jobsDir, id, "job.json");
            if (!fs.existsSync(file)) { continue; }
            try {
                const job = JSON.parse(fs.readFileSync(file, "utf8")) as Job;
                if (job.status === "queued" || job.status === "processing") {
                    job.status = "failed";
                    job.error = "Interrupted by a server restart, create the job again";
                    job.finishedAt = new Date().toISOString();
                    this.persist(job);
                }
                this.jobs.set(job.id, job);
            } catch (e) {
                // ignore unreadable job files
            }
        }
        this.cleanup();
        setInterval(() => this.cleanup(), 60 * 60 * 1000).unref();
    }

    public jobDir(id: string) {
        return path.join(this.jobsDir, id);
    }

    public get(id: string): Job | undefined {
        return this.jobs.get(id);
    }

    public stats() {
        return { queued: this.queue.length, running: this.running, concurrency: config.concurrency };
    }

    public create(image: Buffer, imageExtension: string, options: JobOptions, callbackUrl?: string): Job {
        const id = randomUUID();
        const dir = this.jobDir(id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "input" + imageExtension), image);
        const job: Job = {
            id,
            status: "queued",
            progress: 0,
            step: "queued",
            createdAt: new Date().toISOString(),
            options,
            callbackUrl,
        };
        this.jobs.set(id, job);
        this.persist(job);
        this.queue.push(id);
        this.pump();
        return job;
    }

    private persist(job: Job) {
        const dir = this.jobDir(job.id);
        if (!fs.existsSync(dir)) { return; }
        fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job, null, 2));
    }

    private pump() {
        while (this.running < config.concurrency && this.queue.length > 0) {
            const job = this.jobs.get(this.queue.shift()!);
            if (job) {
                this.running++;
                this.run(job).finally(() => {
                    this.running--;
                    this.pump();
                });
            }
        }
    }

    private run(job: Job): Promise<void> {
        return new Promise((resolve) => {
            const dir = this.jobDir(job.id);
            const inputFile = fs.readdirSync(dir).find((f) => f.startsWith("input"));
            let customColors = "";
            try {
                customColors = this.resolveCustomColors(job.options.paletteId);
            } catch (e) {
                this.finish(job, undefined, e instanceof Error ? e.message : String(e));
                resolve();
                return;
            }
            if (!inputFile) {
                this.finish(job, undefined, "Input image is missing");
                resolve();
                return;
            }

            job.status = "processing";
            job.step = "prepare";
            job.startedAt = new Date().toISOString();
            this.persist(job);

            const request: GenerateRequest = { ...job.options, inputPath: path.join(dir, inputFile), outputDir: dir, customColors };
            const worker = new Worker(path.join(__dirname, "worker.js"), { workerData: request });
            let settled = false;
            const settle = (result?: GenerateResult, error?: string) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                this.finish(job, result, error);
                resolve();
            };
            const timer = setTimeout(() => {
                worker.terminate();
                settle(undefined, `Timed out after ${Math.round(config.jobTimeoutMs / 1000)}s`);
            }, config.jobTimeoutMs);

            worker.on("message", (message: { type: string; step?: string; progress?: number; result?: GenerateResult; message?: string }) => {
                if (message.type === "progress") {
                    // steps repeat during the narrow pixel cleanup runs, keep the progress increasing
                    job.progress = Math.max(job.progress, Math.round((message.progress || 0) * 100) / 100);
                    job.step = message.step || job.step;
                } else if (message.type === "done") {
                    settle(message.result);
                } else if (message.type === "error") {
                    settle(undefined, message.message || "Generation failed");
                }
            });
            worker.on("error", (e) => settle(undefined, e.message));
            worker.on("exit", (code) => {
                if (code !== 0) {
                    settle(undefined, `Worker stopped with exit code ${code}`);
                }
            });
        });
    }

    private finish(job: Job, result?: GenerateResult, error?: string) {
        job.finishedAt = new Date().toISOString();
        if (result && !error) {
            job.status = "completed";
            job.progress = 1;
            job.step = "done";
            job.result = result;
        } else {
            job.status = "failed";
            job.step = "failed";
            job.error = error || "Generation failed";
        }
        this.persist(job);
        if (job.callbackUrl) {
            this.sendCallback(job, publicJob(job));
        }
    }

    private async sendCallback(job: Job, payload: object) {
        const delays = [0, 2000, 10000, 30000, 120000];
        job.callback = { delivered: false, attempts: 0 };
        for (const delay of delays) {
            await sleep(delay);
            job.callback.attempts++;
            try {
                const headers: { [key: string]: string } = { "content-type": "application/json" };
                if (config.callbackSecret) {
                    headers["x-callback-secret"] = config.callbackSecret;
                }
                const response = await fetch(job.callbackUrl!, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
                if (response.ok) {
                    job.callback.delivered = true;
                    job.callback.lastError = undefined;
                    break;
                }
                job.callback.lastError = `HTTP ${response.status}`;
            } catch (e) {
                job.callback.lastError = e instanceof Error ? e.message : String(e);
            }
        }
        this.persist(job);
    }

    private cleanup() {
        const maxAge = config.retentionDays * 24 * 60 * 60 * 1000;
        for (const job of Array.from(this.jobs.values())) {
            const finished = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
            if (!isNaN(finished) && Date.now() - finished > maxAge) {
                fs.rmSync(this.jobDir(job.id), { recursive: true, force: true });
                this.jobs.delete(job.id);
            }
        }
    }
}

/** Job as returned by the API, with absolute file URLs */
export function publicJob(job: Job) {
    const base = `${config.publicBaseUrl}/v1/jobs/${job.id}`;
    return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        step: job.step,
        orderId: job.options.orderId || undefined,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        options: job.options,
        error: job.error,
        callback: job.callback,
        result: job.result
            ? {
                ...job.result,
                files: job.result.files.map((f) => ({ ...f, url: `${base}/files/${f.name}` })),
            }
            : undefined,
        statusUrl: base,
    };
}
