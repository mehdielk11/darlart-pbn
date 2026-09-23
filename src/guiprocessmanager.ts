/**
 * Module that manages the GUI when processing: runs the shared pipeline (src/core/pipeline.ts)
 * and shows its progress and intermediate results
 */

import { ColorMapResult } from "./colorreductionmanagement";
import { CancellationToken, RGB } from "./common";
import { PipelineState, PipelineStep, runPipeline } from "./core/pipeline";
import { buildSvgString } from "./core/svg";
import { FacetResult } from "./facetmanagement";
import { time, timeEnd } from "./gui";
import { Settings } from "./settings";

export class ProcessResult {
    public facetResult!: FacetResult;
    public colorsByIndex!: RGB[];
    public colorCodes: { [key: string]: string } = {};
}

const STEP_UI: { [key in PipelineStep]: { status: string; bar: string; pane?: string; label: string } } = {
    kmeans: { status: "kMeans", bar: "statusKMeans", pane: "kmeans-pane", label: "K-means clustering" },
    facetBuilding: { status: "facetBuilding", bar: "statusFacetBuilding", label: "Facet building" },
    facetReduction: { status: "facetReduction", bar: "statusFacetReduction", pane: "reduction-pane", label: "Facet reduction" },
    borderTracing: { status: "facetBorderPath", bar: "statusFacetBorderPath", pane: "borderpath-pane", label: "Facet border tracing" },
    borderSegmentation: { status: "facetBorderSegmentation", bar: "statusFacetBorderSegmentation", pane: "bordersegmentation-pane", label: "Facet border segmentation" },
    labelPlacement: { status: "facetLabelPlacement", bar: "statusFacetLabelPlacement", pane: "labelplacement-pane", label: "Facet label placement" },
};

/**
 *  Manages the GUI states & processes the image step by step
 */
export class GUIProcessManager {

    public static async process(settings: Settings, cancellationToken: CancellationToken): Promise<ProcessResult> {
        const c = document.getElementById("canvas") as HTMLCanvasElement;
        const ctx = c.getContext("2d")!;
        let imgData = ctx.getImageData(0, 0, c.width, c.height);

        if (settings.resizeImageIfTooLarge && (c.width > settings.resizeImageWidth || c.height > settings.resizeImageHeight)) {
            let width = c.width;
            let height = c.height;
            if (width > settings.resizeImageWidth) {
                const newWidth = settings.resizeImageWidth;
                const newHeight = c.height / c.width * settings.resizeImageWidth;
                width = newWidth;
                height = newHeight;
            }
            if (height > settings.resizeImageHeight) {
                const newHeight = settings.resizeImageHeight;
                const newWidth = width / height * newHeight;
                width = newWidth;
                height = newHeight;
            }

            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = width;
            tempCanvas.height = height;
            tempCanvas.getContext("2d")!.drawImage(c, 0, 0, width, height);
            c.width = width;
            c.height = height;
            ctx.drawImage(tempCanvas, 0, 0, width, height);
            imgData = ctx.getImageData(0, 0, c.width, c.height);
        }

        // reset progress
        $(".status .progress .determinate").css("width", "0px");
        $(".status").removeClass("complete");

        const tabsOutput = M.Tabs.getInstance(document.getElementById("tabsOutput")!);
        const cKmeans = document.getElementById("cKMeans") as HTMLCanvasElement;
        const ctxKmeans = cKmeans.getContext("2d")!;
        // an object so TypeScript doesn't narrow the step to null after the callbacks
        const tracker: { step: PipelineStep | null } = { step: null };

        const result = await runPipeline(imgData, settings, {
            isCancelled: () => cancellationToken.isCancelled,
            createImage: (width, height) => {
                cKmeans.width = width;
                cKmeans.height = height;
                return ctxKmeans.createImageData(width, height);
            },
            onProgress: (step, progress, state) => {
                const ui = STEP_UI[step];
                if (step !== tracker.step) {
                    if (tracker.step !== null) {
                        timeEnd(STEP_UI[tracker.step].label);
                    }
                    tracker.step = step;
                    time(ui.label);
                    $(".status").removeClass("active");
                    $(`.status.${ui.status}`).removeClass("complete").addClass("active");
                    if (ui.pane) {
                        tabsOutput.select(ui.pane);
                    }
                }
                $(`#${ui.bar}`).css("width", Math.round(progress * 100) + "%");
                if (progress >= 1) {
                    $(`.status.${ui.status}`).removeClass("active").addClass("complete");
                    GUIProcessManager.drawPreview(step, state, ctxKmeans);
                }
            },
        });

        if (tracker.step !== null) {
            timeEnd(STEP_UI[tracker.step].label);
        }
        $(".status").removeClass("active");

        const processResult = new ProcessResult();
        processResult.facetResult = result.facetResult;
        processResult.colorsByIndex = result.colorsByIndex;
        processResult.colorCodes = result.colorCodes;
        return processResult;
    }

    /** Draws the intermediate result of a finished step on its (hidden) debug canvas */
    private static drawPreview(step: PipelineStep, state: PipelineState, ctxKmeans: CanvasRenderingContext2D) {
        if (step === "kmeans") {
            if (state.kmeansImage) {
                ctxKmeans.putImageData(state.kmeansImage as ImageData, 0, 0);
            }
            return;
        }
        const facetResult = state.facetResult;
        if (!facetResult) {
            return;
        }
        if (step === "facetReduction" && state.colormapResult) {
            GUIProcessManager.drawFacetColors(facetResult, state.colormapResult);
        } else if (step === "borderTracing") {
            GUIProcessManager.drawBorderPaths(facetResult);
        } else if (step === "borderSegmentation") {
            GUIProcessManager.drawBorderSegments(facetResult);
        } else if (step === "labelPlacement") {
            GUIProcessManager.drawLabelBounds(facetResult);
        }
    }

    private static getCanvas(id: string, facetResult: FacetResult) {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        canvas.width = facetResult.width;
        canvas.height = facetResult.height;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return { canvas, context };
    }

    private static drawFacetColors(facetResult: FacetResult, colormapResult: ColorMapResult) {
        const { context } = GUIProcessManager.getCanvas("cReduction", facetResult);
        const imageData = context.getImageData(0, 0, facetResult.width, facetResult.height);
        let idx = 0;
        for (let j: number = 0; j < facetResult.height; j++) {
            for (let i: number = 0; i < facetResult.width; i++) {
                const facet = facetResult.facets[facetResult.facetMap.get(i, j)];
                const rgb = facet ? colormapResult.colorsByIndex[facet.color] : [255, 255, 255];
                imageData.data[idx++] = rgb[0];
                imageData.data[idx++] = rgb[1];
                imageData.data[idx++] = rgb[2];
                idx++;
            }
        }
        context.putImageData(imageData, 0, 0);
    }

    private static drawBorderPaths(facetResult: FacetResult) {
        const { context } = GUIProcessManager.getCanvas("cBorderPath", facetResult);
        for (const f of facetResult.facets) {
            if (f != null && f.borderPath != null && f.borderPath.length > 0) {
                context.beginPath();
                context.moveTo(f.borderPath[0].getWallX(), f.borderPath[0].getWallY());
                for (let i: number = 1; i < f.borderPath.length; i++) {
                    context.lineTo(f.borderPath[i].getWallX(), f.borderPath[i].getWallY());
                }
                context.stroke();
            }
        }
    }

    private static drawBorderSegments(facetResult: FacetResult) {
        const { context } = GUIProcessManager.getCanvas("cBorderSegmentation", facetResult);
        for (const f of facetResult.facets) {
            if (f != null && f.borderSegments != null) {
                const path = f.getFullPathFromBorderSegments(false);
                if (path.length === 0) {
                    continue;
                }
                context.beginPath();
                context.moveTo(path[0].x, path[0].y);
                for (let i: number = 1; i < path.length; i++) {
                    context.lineTo(path[i].x, path[i].y);
                }
                context.stroke();
            }
        }
    }

    private static drawLabelBounds(facetResult: FacetResult) {
        const segmentation = document.getElementById("cBorderSegmentation") as HTMLCanvasElement;
        const { context } = GUIProcessManager.getCanvas("cLabelPlacement", facetResult);
        context.drawImage(segmentation, 0, 0);
        context.fillStyle = "red";
        for (const f of facetResult.facets) {
            if (f != null && f.labelBounds != null) {
                context.fillRect(f.labelBounds.minX, f.labelBounds.minY, f.labelBounds.width, f.labelBounds.height);
            }
        }
    }

    /**
     *  Creates a vector based SVG image of the facets with the given configuration (same markup as the API output)
     */
    public static async createSVG(facetResult: FacetResult, colorsByIndex: RGB[], sizeMultiplier: number, fill: boolean, stroke: boolean, addColorLabels: boolean, fontSize: number = 50, fontColor: string = "black", onUpdate: ((progress: number) => void) | null = null) {
        const svgString = buildSvgString(facetResult, colorsByIndex, { sizeMultiplier, fill, stroke, labels: addColorLabels, fontSize, fontColor, labelContrast: true });
        const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
        const svg = document.importNode(parsed.documentElement, true);
        if (onUpdate != null) {
            onUpdate(1);
        }
        return svg;
    }
}
