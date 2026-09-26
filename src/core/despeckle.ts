/**
 * Speckle removal before the facet reduction.
 *
 * The facet reducer deletes small facets one at a time, and each deletion rebuilds every neighbouring facet: on a
 * very speckled image (tens of thousands of tiny facets, e.g. a heavily textured artwork) that costs roughly the
 * square of the facet count, and a job can take many minutes. Those tiny facets would be deleted anyway, so this pass
 * merges them into their surroundings all at once first: every connected area of one color smaller than maxSize
 * pixels takes the color most of its bordering pixels have (the closest color on a tie). It only runs when the image
 * has more than minAreas areas, so ordinary images are processed exactly as before.
 */
import { RGB } from "../common";
import { Uint8Array2D } from "../structs/typedarrays";

export interface DespeckleResult {
    /** connected areas of one color before the pass */
    areasBefore: number;
    /** areas smaller than maxSize merged into their surroundings */
    merged: number;
    /** passes made (0 when the image has few enough areas) */
    passes: number;
}

/** Labels the 4-connected areas of one color; returns the label of each pixel and each area's size */
function labelAreas(width: number, height: number, colors: Uint8Array2D) {
    const labels = new Int32Array(width * height).fill(-1);
    const sizes: number[] = [];
    const stack = new Int32Array(width * height);
    for (let start = 0; start < width * height; start++) {
        if (labels[start] !== -1) { continue; }
        const label = sizes.length;
        const color = colors.get(start % width, Math.floor(start / width));
        let top = 0;
        let size = 0;
        stack[top++] = start;
        labels[start] = label;
        while (top > 0) {
            const idx = stack[--top];
            size++;
            const x = idx % width;
            const y = (idx - x) / width;
            if (x > 0 && labels[idx - 1] === -1 && colors.get(x - 1, y) === color) { labels[idx - 1] = label; stack[top++] = idx - 1; }
            if (x < width - 1 && labels[idx + 1] === -1 && colors.get(x + 1, y) === color) { labels[idx + 1] = label; stack[top++] = idx + 1; }
            if (y > 0 && labels[idx - width] === -1 && colors.get(x, y - 1) === color) { labels[idx - width] = label; stack[top++] = idx - width; }
            if (y < height - 1 && labels[idx + width] === -1 && colors.get(x, y + 1) === color) { labels[idx + width] = label; stack[top++] = idx + width; }
        }
        sizes.push(size);
    }
    return { labels, sizes };
}

export function despeckle(width: number, height: number, colors: Uint8Array2D, colorsByIndex: RGB[], maxSize: number, minAreas: number, maxPasses: number = 3): DespeckleResult {
    const result: DespeckleResult = { areasBefore: 0, merged: 0, passes: 0 };
    if (maxSize <= 1) { return result; }
    const distance = (a: number, b: number) => {
        const ca = colorsByIndex[a];
        const cb = colorsByIndex[b];
        if (!ca || !cb) { return Number.MAX_VALUE; }
        return (ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2 + (ca[2] - cb[2]) ** 2;
    };
    for (let pass = 0; pass < maxPasses; pass++) {
        const { labels, sizes } = labelAreas(width, height, colors);
        if (pass === 0) {
            result.areasBefore = sizes.length;
            if (sizes.length <= minAreas) { return result; }
        }
        // per small area: how many of its border pixels touch each other color
        const counts = new Map<number, Map<number, number>>();
        const ownColor = new Map<number, number>();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const label = labels[idx];
                if (sizes[label] >= maxSize) { continue; }
                let byColor = counts.get(label);
                if (!byColor) { byColor = new Map(); counts.set(label, byColor); ownColor.set(label, colors.get(x, y)); }
                const add = (nIdx: number, nx: number, ny: number) => {
                    if (labels[nIdx] === label) { return; }
                    const c = colors.get(nx, ny);
                    byColor!.set(c, (byColor!.get(c) || 0) + 1);
                };
                if (x > 0) { add(idx - 1, x - 1, y); }
                if (x < width - 1) { add(idx + 1, x + 1, y); }
                if (y > 0) { add(idx - width, x, y - 1); }
                if (y < height - 1) { add(idx + width, x, y + 1); }
            }
        }
        // the new color of each small area: the most common bordering color, the closest one on a tie
        const target = new Map<number, number>();
        counts.forEach((byColor, label) => {
            let best = -1;
            let bestCount = -1;
            const own = ownColor.get(label)!;
            byColor.forEach((count, color) => {
                if (count > bestCount || (count === bestCount && distance(own, color) < distance(own, best))) {
                    best = color;
                    bestCount = count;
                }
            });
            if (best >= 0) { target.set(label, best); }
        });
        if (!target.size) { break; }
        // the new colors, set in one sweep
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = target.get(labels[y * width + x]);
                if (color !== undefined) { colors.set(x, y, color); }
            }
        }
        result.merged += target.size;
        result.passes = pass + 1;
    }
    return result;
}
