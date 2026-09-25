/**
 * At most `limit` tasks at a time; the others wait their turn in order. The API's heavy image requests (analyze,
 * recolor, featured, webp) go through one gate, so a burst of calls cannot run side by side and exhaust the memory of
 * a small server: they are served one after another instead.
 */
export interface Gate {
    run<T>(task: () => Promise<T>): Promise<T>;
    stats(): { running: number; waiting: number; limit: number };
}

export function createGate(limit: number): Gate {
    const max = Math.max(1, Math.floor(limit) || 1);
    let running = 0;
    const waiting: Array<() => void> = [];
    const release = () => {
        running--;
        const next = waiting.shift();
        if (next) {
            running++;
            next();
        }
    };
    return {
        async run<T>(task: () => Promise<T>): Promise<T> {
            if (running < max) {
                running++;
            } else {
                await new Promise<void>((resolve) => waiting.push(resolve));
            }
            try {
                return await task();
            } finally {
                release();
            }
        },
        stats: () => ({ running, waiting: waiting.length, limit: max }),
    };
}
