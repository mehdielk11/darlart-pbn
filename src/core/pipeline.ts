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

    // k-means clustering
    const kmeansImage = callbacks.createImage
        ? callbacks.createImage(image.width, image.height)
        : { width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) };
    kmeansImage.data.fill(255);
    state.kmeansImage = kmeansImage;
    report("kmeans", 0);
    await ColorReducer.applyKMeansClustering(image as ImageData, kmeansImage as ImageData, null as any, settings, (kmeans) => {
        const delta = kmeans.currentDeltaDistanceDifference > 100 ? 100 : kmeans.currentDeltaDistanceDifference;
        report("kmeans", (100 - delta) / 100);
    });
    report("kmeans", 1);

    // build color map
    const colormapResult = ColorReducer.createColorMap(kmeansImage as ImageData);
    state.colormapResult = colormapResult;

    // If custom color restrictions were specified, ensure the color map covers all custom colors up to the requested count
    if (settings.kMeansColorRestrictions.length > 0) {
        const targetCount = Math.min(settings.kMeansNrOfClusters, settings.kMeansColorRestrictions.length);
        if (colormapResult.colorsByIndex.length < targetCount) {
            const presentKeys = new Set(colormapResult.colorsByIndex.map((c) => `${c[0]},${c[1]},${c[2]}`));
            for (const col of settings.kMeansColorRestrictions) {
                if (colormapResult.colorsByIndex.length >= targetCount) { break; }
                const rgb: RGB = typeof col === "string" ? settings.colorAliases[col] : col;
                if (rgb) {
                    const cleanRgb: RGB = [Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2])];
                    const key = `${cleanRgb[0]},${cleanRgb[1]},${cleanRgb[2]}`;
                    if (!presentKeys.has(key)) {
                        presentKeys.add(key);
                        colormapResult.colorsByIndex.push(cleanRgb);
                    }
                }
            }
        }
    }

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
    const colorsByIndex = reorderColorsByFamily(colormapResult.colorsByIndex, colorCodes, facetResult);

    return {
        facetResult,
        colorsByIndex,
        colorCodes,
        width: facetResult.width,
        height: facetResult.height,
    };
}
