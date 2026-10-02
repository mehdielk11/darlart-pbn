/**
 * The complete paint-by-numbers processing, without any DOM dependency.
 * Used by the website (which draws previews from the progress callbacks), the CLI and the API.
 */
import { ColorMapResult, ColorReducer } from "../colorreductionmanagement";
import { RGB } from "../common";
import { FacetBorderSegmenter } from "../facetBorderSegmenter";
import { FacetBorderTracer } from "../facetBorderTracer";
import { FacetCreator } from "../facetCreator";
import { FacetLabelPlacer } from "../facetLabelPlacer";
import { FacetResult } from "../facetmanagement";
import { FacetReducer } from "../facetReducer";
import { Settings } from "../settings";
import { despeckle, DespeckleResult } from "./despeckle";
import { reorderColorsByFamily } from "./palette";
import { correctTones, isPaintedWithPalette, matchToPalette } from "./palettematch";

export interface RGBAImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export type PipelineStep = "kmeans" | "facetBuilding" | "facetReduction" | "borderTracing" | "borderSegmentation" | "labelPlacement";

export const PIPELINE_STEPS: PipelineStep[] = ["kmeans", "facetBuilding", "facetReduction", "borderTracing", "borderSegmentation", "labelPlacement"];

export interface PipelineState {
    kmeansImage?: RGBAImage;
    colormapResult?: ColorMapResult;
    facetResult?: FacetResult;
}

export interface PipelineCallbacks {
    /** Called with the progress (0-1) of each step; throwing from it aborts the processing */
    onProgress?: (step: PipelineStep, progress: number, state: PipelineState) => void;
    /** Throws "Cancelled" when it returns true */
    isCancelled?: () => boolean;
    /** Creates the image that receives the quantized colors (the website passes ctx.createImageData to preview it) */
    createImage?: (width: number, height: number) => RGBAImage;
}

export interface PipelineResult {
    facetResult: FacetResult;
    colorsByIndex: RGB[];
    colorCodes: { [key: string]: string };
    width: number;
    height: number;
}

/** Above this many areas of one color, the tiny ones are merged at once before the facet reduction */
export const DESPECKLE_MIN_AREAS = 20000;

/** The palette's colors (custom colors and named aliases), without duplicates */
function paletteOf(settings: Settings): RGB[] {
    const seen = new Set<string>();
    const palette: RGB[] = [];
    for (const col of settings.kMeansColorRestrictions) {
        const rgb: RGB | undefined = typeof col === "string" ? settings.colorAliases[col] : col;
        if (!rgb) { continue; }
        const clean: RGB = [Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2])];
        const key = clean.join(",");
        if (!seen.has(key)) {
            seen.add(key);
            palette.push(clean);
        }
    }
    return palette;
}

/**
 * Drops the colors no region uses any more (the facet reduction can merge every area of a color away): the legend
 * and the kit then only list paints that are actually painted
 */
function keepUsedColors(colorsByIndex: RGB[], facetResult: FacetResult): RGB[] {
    const used = new Set<number>();
    for (const f of facetResult.facets) {
        if (f != null) { used.add(f.color); }
    }
    if (used.size === colorsByIndex.length) { return colorsByIndex; }
    const newIndex: number[] = new Array(colorsByIndex.length);
    const kept: RGB[] = [];
    colorsByIndex.forEach((color, index) => {
        if (used.has(index)) {
            newIndex[index] = kept.length;
            kept.push(color);
        }
    });
    for (const f of facetResult.facets) {
        if (f != null) { f.color = newIndex[f.color]; }
    }
    return kept;
}

export async function runPipeline(image: RGBAImage, settings: Settings, callbacks: PipelineCallbacks = {}): Promise<PipelineResult> {
    const state: PipelineState = {};
    const report = (step: PipelineStep, progress: number) => {
        if (callbacks.isCancelled && callbacks.isCancelled()) {
            throw new Error("Cancelled");
        }
        if (callbacks.onProgress) {
            callbacks.onProgress(step, progress, state);
        }
    };

    // color reduction: palette matching with a palette, k-means without one
    const kmeansImage = callbacks.createImage
        ? callbacks.createImage(image.width, image.height)
        : { width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) };
    kmeansImage.data.fill(255);
    state.kmeansImage = kmeansImage;
    report("kmeans", 0);
    const palette = paletteOf(settings);
    if (palette.length > 0) {
        // a photo first gets its white and black points; an artwork already painted with paints is matched as is
        const source = new Uint8ClampedArray(image.data);
        if (settings.paletteToneCorrection && !isPaintedWithPalette(source, 4, palette)) {
            correctTones(source, 4);
        }
        report("kmeans", 0.1);
        const match = matchToPalette(source, 4, settings.kMeansNrOfClusters, palette);
        for (let p = 0, o = 0; p < match.paintOfPixel.length; p++, o += 4) {
            const rgb = palette[match.paintOfPixel[p]];
            kmeansImage.data[o] = rgb[0];
            kmeansImage.data[o + 1] = rgb[1];
            kmeansImage.data[o + 2] = rgb[2];
            kmeansImage.data[o + 3] = 255;
        }
    } else {
        await ColorReducer.applyKMeansClustering(image as ImageData, kmeansImage as ImageData, null as any, settings, (kmeans) => {
            const delta = kmeans.currentDeltaDistanceDifference > 100 ? 100 : kmeans.currentDeltaDistanceDifference;
            report("kmeans", (100 - delta) / 100);
        });
    }
    report("kmeans", 1);

    // build color map
    const colormapResult = ColorReducer.createColorMap(kmeansImage as ImageData);
    state.colormapResult = colormapResult;

    let facetResult: FacetResult = new FacetResult();
    const buildAndReduceFacets = async () => {
        // a very speckled image: its tiny areas are merged into their surroundings at once, before the facet reduction
        // deletes them one by one (which grows with the square of their number; see despeckle.ts)
        const speckles: DespeckleResult | null = settings.despeckleTinyAreas
            ? despeckle(colormapResult.width, colormapResult.height, colormapResult.imgColorIndices, colormapResult.colorsByIndex,
                settings.removeFacetsSmallerThanNrOfPoints, DESPECKLE_MIN_AREAS)
            : null;
        if (speckles && speckles.passes > 0) {
            console.log(`Despeckle: ${speckles.areasBefore} areas, ${speckles.merged} tiny ones merged in ${speckles.passes} passes`);
        }
        facetResult = await FacetCreator.getFacets(colormapResult.width, colormapResult.height, colormapResult.imgColorIndices, (progress) => {
            report("facetBuilding", progress);
        });
        state.facetResult = facetResult;
        report("facetBuilding", 1);

        await FacetReducer.reduceFacets(settings.removeFacetsSmallerThanNrOfPoints, settings.removeFacetsFromLargeToSmall, settings.maximumNumberOfFacets,
            colormapResult.colorsByIndex, facetResult, colormapResult.imgColorIndices, (progress) => {
                report("facetReduction", progress);
            });
        report("facetReduction", 1);
    };

    if (settings.narrowPixelStripCleanupRuns === 0) {
        await buildAndReduceFacets();
    } else {
        for (let run = 0; run < settings.narrowPixelStripCleanupRuns; run++) {
            // clean up narrow pixel strips; imgColorIndices get updated as the facets are reduced, so do a few runs
            await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
            await buildAndReduceFacets();
        }
    }

    // facet border tracing
    await FacetBorderTracer.buildFacetBorderPaths(facetResult, (progress) => {
        report("borderTracing", progress);
    });
    report("borderTracing", 1);

    // facet border segmentation
    await FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments, (progress) => {
        report("borderSegmentation", progress);
    });
    report("borderSegmentation", 1);

    // facet label placement
    await FacetLabelPlacer.buildFacetLabelBounds(facetResult, (progress) => {
        report("labelPlacement", progress);
    });
    report("labelPlacement", 1);

    const colorCodes = settings.colorCodes || {};
    const colorsByIndex = reorderColorsByFamily(keepUsedColors(colormapResult.colorsByIndex, facetResult), colorCodes, facetResult);

    return {
        facetResult,
        colorsByIndex,
        colorCodes,
        width: facetResult.width,
        height: facetResult.height,
    };
}
