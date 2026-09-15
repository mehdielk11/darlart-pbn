/**
 * Estimates how detailed a photo is to choose the difficulty automatically:
 * simple shapes with little depth → easy/medium, busy or photographic images → hard
 */
import { Difficulty } from "./settings";

export interface RGBALike {
    width: number;
    height: number;
    data: Uint8Array | Uint8ClampedArray;
}

export interface ComplexityMetrics {
    /** Share of pixels on a strong edge (0-1) */
    edgeDensity: number;
    /** Share of 16x16 blocks that contain a lot of edges (0-1) */
    detailedBlockRatio: number;
    /** Share of blocks with visible texture/gradients (0-1) */
    texturedBlockRatio: number;
    /** Combined score (0-1), higher means more detail */
    score: number;
}

export interface DifficultySuggestion {
    difficulty: Difficulty;
    metrics: ComplexityMetrics;
}

/**
 * Score thresholds. First calibration: a flat illustration scores ~0.05 (easy), a detailed photo ~0.19 (hard).
 * Refine them with real customer photos; the n8n AI vision step can also override the difficulty.
 */
export const COMPLEXITY_THRESHOLDS = { medium: 0.08, hard: 0.16 };

const STRONG_EDGE = 60;
const WEAK_EDGE = 16;
const BLOCK = 16;

export function measureComplexity(image: RGBALike, maxSide: number = 512): ComplexityMetrics {
    // grayscale, downsampled with a box filter so the result doesn't depend on the photo resolution
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const w = Math.max(3, Math.round(image.width * scale));
    const h = Math.max(3, Math.round(image.height * scale));
    const gray = new Float32Array(w * h);
    const counts = new Uint16Array(w * h);
    for (let y = 0; y < image.height; y++) {
        const gy = Math.min(h - 1, Math.floor(y * scale));
        for (let x = 0; x < image.width; x++) {
            const gx = Math.min(w - 1, Math.floor(x * scale));
            const i = (y * image.width + x) * 4;
            const g = gy * w + gx;
            gray[g] += 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
            counts[g]++;
        }
    }
    for (let i = 0; i < gray.length; i++) {
        gray[i] = counts[i] > 0 ? gray[i] / counts[i] : 0;
    }

    const blocksX = Math.max(1, Math.floor(w / BLOCK));
    const blocksY = Math.max(1, Math.floor(h / BLOCK));
    const strongPerBlock = new Uint32Array(blocksX * blocksY);
    const weakPerBlock = new Uint32Array(blocksX * blocksY);
    let strongEdges = 0;
    let measured = 0;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const tl = gray[(y - 1) * w + x - 1], t = gray[(y - 1) * w + x], tr = gray[(y - 1) * w + x + 1];
            const l = gray[y * w + x - 1], r = gray[y * w + x + 1];
            const bl = gray[(y + 1) * w + x - 1], b = gray[(y + 1) * w + x], br = gray[(y + 1) * w + x + 1];
            const sx = (tr + 2 * r + br) - (tl + 2 * l + bl);
            const sy = (bl + 2 * b + br) - (tl + 2 * t + tr);
            const magnitude = Math.sqrt(sx * sx + sy * sy) / 4;
            const block = Math.min(blocksY - 1, Math.floor(y / BLOCK)) * blocksX + Math.min(blocksX - 1, Math.floor(x / BLOCK));
            measured++;
            if (magnitude > STRONG_EDGE) {
                strongEdges++;
                strongPerBlock[block]++;
            }
            if (magnitude > WEAK_EDGE) {
                weakPerBlock[block]++;
            }
        }
    }

    const pixelsPerBlock = BLOCK * BLOCK;
    let detailed = 0;
    let textured = 0;
    for (let i = 0; i < strongPerBlock.length; i++) {
        if (strongPerBlock[i] / pixelsPerBlock > 0.12) { detailed++; }
        if (weakPerBlock[i] / pixelsPerBlock > 0.3) { textured++; }
    }

    const edgeDensity = measured > 0 ? strongEdges / measured : 0;
    const detailedBlockRatio = detailed / strongPerBlock.length;
    const texturedBlockRatio = textured / strongPerBlock.length;
    const score = Math.min(1, 0.4 * Math.min(1, edgeDensity * 4) + 0.35 * detailedBlockRatio + 0.25 * texturedBlockRatio);
    return { edgeDensity, detailedBlockRatio, texturedBlockRatio, score };
}

export function suggestDifficulty(image: RGBALike): DifficultySuggestion {
    const metrics = measureComplexity(image);
    let difficulty: Difficulty = "easy";
    if (metrics.score >= COMPLEXITY_THRESHOLDS.hard) {
        difficulty = "hard";
    } else if (metrics.score >= COMPLEXITY_THRESHOLDS.medium) {
        difficulty = "medium";
    }
    return { difficulty, metrics };
}
