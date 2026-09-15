/**
 * Color reduction management of the process: clustering to reduce colors & creating color map
 */
import { delay, IMap, RGB } from "./common";
import { KMeans, Vector } from "./lib/clustering";
import { hslToRgb, lab2rgb, rgb2lab, rgbToHsl } from "./lib/colorconversion";
import { ClusteringColorSpace, Settings } from "./settings";
import { Uint8Array2D } from "./structs/typedarrays";
import { Random } from "./random";

export class ColorMapResult {
    public imgColorIndices!: Uint8Array2D;
    public colorsByIndex!: RGB[];
    public width!: number;
    public height!: number;
}

export class ColorReducer {

    /**
     *  Creates a map of the various colors used
     */
    public static createColorMap(kmeansImgData: ImageData) {
        const imgColorIndices = new Uint8Array2D(kmeansImgData.width, kmeansImgData.height);
        let colorIndex = 0;
        const colors: IMap<number> = {};
        const colorsByIndex: RGB[] = [];

        let idx = 0;
        for (let j: number = 0; j < kmeansImgData.height; j++) {
            for (let i: number = 0; i < kmeansImgData.width; i++) {
                const r = kmeansImgData.data[idx++];
                const g = kmeansImgData.data[idx++];
                const b = kmeansImgData.data[idx++];
                const a = kmeansImgData.data[idx++];
                let currentColorIndex;
                const color = r + "," + g + "," + b;
                if (typeof colors[color] === "undefined") {
                    currentColorIndex = colorIndex;
                    colors[color] = colorIndex;
                    colorsByIndex.push([r, g, b]);
                    colorIndex++;
                } else {
                    currentColorIndex = colors[color];
                }
                imgColorIndices.set(i, j, currentColorIndex);
            }
        }

        const result = new ColorMapResult();
        result.imgColorIndices = imgColorIndices;
        result.colorsByIndex = colorsByIndex;
        result.width = kmeansImgData.width;
        result.height = kmeansImgData.height;

        return result;
    }

    /**
     *  Applies K-means clustering on the imgData to reduce the colors to
     *  k clusters and then output the result to the given outputImgData
     */
    public static async applyKMeansClustering(imgData: ImageData, outputImgData: ImageData, ctx: CanvasRenderingContext2D, settings: Settings, onUpdate: ((kmeans: KMeans) => void) | null = null) {
        const vectors: Vector[] = [];
        let idx = 0;
        let vIdx = 0;

        const bitsToChopOff = 2; // r,g,b gets rounded to every 4 values, 0,4,8,...

        // group by color, add points as 1D index to prevent Point object allocation
        const pointsByColor: IMap<number[]> = {};
        for (let j: number = 0; j < imgData.height; j++) {
            for (let i: number = 0; i < imgData.width; i++) {
                let r = imgData.data[idx++];
                let g = imgData.data[idx++];
                let b = imgData.data[idx++];
                const a = imgData.data[idx++];

                // small performance boost: reduce bitness of colors by chopping off the last bits
                // this will group more colors with only slight variation in color together, reducing the size of the points

                r = r >> bitsToChopOff << bitsToChopOff;
                g = g >> bitsToChopOff << bitsToChopOff;
                b = b >> bitsToChopOff << bitsToChopOff;

                const color = `${r},${g},${b}`;
                if (!(color in pointsByColor)) {
                    pointsByColor[color] = [j * imgData.width + i];
                } else {
                    pointsByColor[color].push(j * imgData.width + i);
                }
            }
        }

        for (const color of Object.keys(pointsByColor)) {
            const rgb: number[] = color.split(",").map((v) => parseInt(v));

            // determine vector data based on color space conversion
            let data: number[];
            if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.RGB) {
                data = rgb;
            } else if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.HSL) {
                data = rgbToHsl(rgb[0], rgb[1], rgb[2]);
            } else if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.LAB) {
                data = rgb2lab(rgb);
            } else {
                data = rgb;
            }
            // determine the weight (#pointsOfColor / #totalpoints) of each color
            const weight = pointsByColor[color].length / (imgData.width * imgData.height);

            const vec = new Vector(data, weight);
            vec.tag = rgb;
            vectors[vIdx++] = vec;
        }

        const random = new Random(settings.randomSeed === 0 ? new Date().getTime() : settings.randomSeed);
        // vectors of all the unique colors are built, time to cluster them
        const kmeans = new KMeans(vectors, settings.kMeansNrOfClusters, random);

        let curTime = new Date().getTime();

        kmeans.step();
        while (kmeans.currentDeltaDistanceDifference > settings.kMeansMinDeltaDifference) {
            kmeans.step();

            // update GUI every 500ms
            if (new Date().getTime() - curTime > 500) {
                curTime = new Date().getTime();

                await delay(0);
                if (onUpdate != null) {
                    ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, false);
                    onUpdate(kmeans);
                }
            }

        }

        // Ensure all centroids have points by reseeding any empty clusters from the largest cluster
        for (let c = 0; c < kmeans.pointsPerCategory.length; c++) {
            if (!kmeans.pointsPerCategory[c] || kmeans.pointsPerCategory[c].length === 0) {
                let maxLen = 0;
                let maxC = -1;
                for (let j = 0; j < kmeans.pointsPerCategory.length; j++) {
                    const len = kmeans.pointsPerCategory[j] ? kmeans.pointsPerCategory[j].length : 0;
                    if (len > maxLen) {
                        maxLen = len;
                        maxC = j;
                    }
                }
                if (maxC !== -1 && maxLen > 1) {
                    const sourceCat = kmeans.pointsPerCategory[maxC];
                    let maxDist = -1;
                    let bestIdx = -1;
                    for (let pIdx = 0; pIdx < sourceCat.length; pIdx++) {
                        const d = kmeans.centroids[maxC].distanceTo(sourceCat[pIdx]);
                        if (d > maxDist) {
                            maxDist = d;
                            bestIdx = pIdx;
                        }
                    }
                    if (bestIdx !== -1) {
                        const movedPoint = sourceCat.splice(bestIdx, 1)[0];
                        kmeans.pointsPerCategory[c] = [movedPoint];
                        kmeans.centroids[c] = movedPoint;
                    }
                }
            }
        }

        // update the output image data (because it will be used for further processing)
        ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, true);

        if (onUpdate != null) {
            onUpdate(kmeans);
        }
    }

    /**
     *  Updates the image data from the current kmeans centroids and their respective associated colors (vectors)
     */
    public static updateKmeansOutputImageData(kmeans: KMeans, settings: Settings, pointsByColor: IMap<number[]>, imgData: ImageData, outputImgData: ImageData, restrictToSpecifiedColors: boolean) {

        // Compute base RGB and Lab values for each centroid
        const centroidRGBs: RGB[] = [];
        const centroidLabs: number[][] = [];
        const centroidWeights: number[] = [];

        for (let c: number = 0; c < kmeans.centroids.length; c++) {
            const centroid = kmeans.centroids[c];
            let rgb: number[];
            if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.RGB) {
                rgb = centroid.values;
            } else if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.HSL) {
                const hsl = centroid.values;
                rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
            } else if (settings.kMeansClusteringColorSpace === ClusteringColorSpace.LAB) {
                const lab = centroid.values;
                rgb = lab2rgb(lab);
            } else {
                rgb = centroid.values;
            }
            const cleanRgb: RGB = [Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2])];
            centroidRGBs.push(cleanRgb);
            centroidLabs.push(rgb2lab(cleanRgb));

            let weight = 0;
            const pts = kmeans.pointsPerCategory[c];
            if (pts) {
                for (const v of pts) {
                    const ptRGB: number[] = v.tag;
                    const pointColor = `${Math.floor(ptRGB[0])},${Math.floor(ptRGB[1])},${Math.floor(ptRGB[2])}`;
                    if (pointsByColor[pointColor]) {
                        weight += pointsByColor[pointColor].length;
                    }
                }
            }
            centroidWeights.push(weight);
        }

        const assignedRGBByCentroid: RGB[] = new Array(kmeans.centroids.length);

        if (restrictToSpecifiedColors && settings.kMeansColorRestrictions.length > 0) {
            // Collect unique restricted colors
            const restrictedRGBs: RGB[] = [];
            const restrictedLabs: number[][] = [];
            const seenRestricted = new Set<string>();

            for (const col of settings.kMeansColorRestrictions) {
                let rgbVal: RGB;
                if (typeof col === "string") {
                    rgbVal = settings.colorAliases[col];
                } else {
                    rgbVal = col;
                }
                if (rgbVal) {
                    const key = `${Math.floor(rgbVal[0])},${Math.floor(rgbVal[1])},${Math.floor(rgbVal[2])}`;
                    if (!seenRestricted.has(key)) {
                        seenRestricted.add(key);
                        const cleanVal: RGB = [Math.floor(rgbVal[0]), Math.floor(rgbVal[1]), Math.floor(rgbVal[2])];
                        restrictedRGBs.push(cleanVal);
                        restrictedLabs.push(rgb2lab(cleanVal));
                    }
                }
            }

            const K = kmeans.centroids.length;
            const M = restrictedRGBs.length;

            if (M > 0) {
                // Sort centroid indices by cluster weight descending so visually prominent clusters get preferred colors
                const sortedCentroidIndices = Array.from({ length: K }, (_, i) => i)
                    .sort((a, b) => centroidWeights[b] - centroidWeights[a]);

                const usedRestricted = new Set<number>();

                // Phase 1: Assign a unique restricted color to each centroid up to min(K, M)
                const uniqueCount = Math.min(K, M);
                for (let i = 0; i < uniqueCount; i++) {
                    const c = sortedCentroidIndices[i];
                    const cLab = centroidLabs[c];
                    let minDistance = Number.MAX_VALUE;
                    let bestR = -1;

                    for (let r = 0; r < M; r++) {
                        if (usedRestricted.has(r)) continue;
                        const rLab = restrictedLabs[r];
                        const distance = Math.sqrt(
                            (cLab[0] - rLab[0]) * (cLab[0] - rLab[0]) +
                            (cLab[1] - rLab[1]) * (cLab[1] - rLab[1]) +
                            (cLab[2] - rLab[2]) * (cLab[2] - rLab[2])
                        );
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestR = r;
                        }
                    }

                    if (bestR !== -1) {
                        assignedRGBByCentroid[c] = restrictedRGBs[bestR];
                        usedRestricted.add(bestR);
                    } else {
                        assignedRGBByCentroid[c] = centroidRGBs[c];
                    }
                }

                // Phase 2: If K > M, map remaining centroids to their closest restricted color (allowing duplicates)
                for (let i = uniqueCount; i < K; i++) {
                    const c = sortedCentroidIndices[i];
                    const cLab = centroidLabs[c];
                    let minDistance = Number.MAX_VALUE;
                    let bestR = 0;

                    for (let r = 0; r < M; r++) {
                        const rLab = restrictedLabs[r];
                        const distance = Math.sqrt(
                            (cLab[0] - rLab[0]) * (cLab[0] - rLab[0]) +
                            (cLab[1] - rLab[1]) * (cLab[1] - rLab[1]) +
                            (cLab[2] - rLab[2]) * (cLab[2] - rLab[2])
                        );
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestR = r;
                        }
                    }
                    assignedRGBByCentroid[c] = restrictedRGBs[bestR];
                }
            } else {
                for (let c = 0; c < K; c++) {
                    assignedRGBByCentroid[c] = centroidRGBs[c];
                }
            }
        } else {
            for (let c = 0; c < kmeans.centroids.length; c++) {
                assignedRGBByCentroid[c] = centroidRGBs[c];
            }
        }

        // Apply assigned colors to output image data
        for (let c: number = 0; c < kmeans.centroids.length; c++) {
            const rgb = assignedRGBByCentroid[c];
            const pts = kmeans.pointsPerCategory[c];
            if (!pts) continue;

            for (const v of pts) {
                const pointRGB: number[] = v.tag;
                const pointColor = `${Math.floor(pointRGB[0])},${Math.floor(pointRGB[1])},${Math.floor(pointRGB[2])}`;
                const pixelIndices = pointsByColor[pointColor];
                if (pixelIndices) {
                    for (const pt of pixelIndices) {
                        const ptx = pt % imgData.width;
                        const pty = Math.floor(pt / imgData.width);
                        let dataOffset = (pty * imgData.width + ptx) * 4;
                        outputImgData.data[dataOffset++] = rgb[0];
                        outputImgData.data[dataOffset++] = rgb[1];
                        outputImgData.data[dataOffset++] = rgb[2];
                    }
                }
            }
        }
    }

    /**
     *  Builds a distance matrix for each color to each other
     */
    public static buildColorDistanceMatrix(colorsByIndex: RGB[]) {
        const colorDistances: number[][] = new Array(colorsByIndex.length);
        for (let j: number = 0; j < colorsByIndex.length; j++) {
            colorDistances[j] = new Array(colorDistances.length);
        }
        for (let j: number = 0; j < colorsByIndex.length; j++) {
            for (let i: number = j; i < colorsByIndex.length; i++) {
                const c1 = colorsByIndex[j];
                const c2 = colorsByIndex[i];
                const distance = Math.sqrt((c1[0] - c2[0]) * (c1[0] - c2[0]) +
                    (c1[1] - c2[1]) * (c1[1] - c2[1]) +
                    (c1[2] - c2[2]) * (c1[2] - c2[2]));
                colorDistances[i][j] = distance;
                colorDistances[j][i] = distance;
            }
        }
        return colorDistances;
    }

    public static async processNarrowPixelStripCleanup(colormapResult: ColorMapResult) {
        // build the color distance matrix, which describes the distance of each color to each other
        const colorDistances: number[][] = ColorReducer.buildColorDistanceMatrix(colormapResult.colorsByIndex);

        let count = 0;
        const imgColorIndices = colormapResult.imgColorIndices;
        for (let j: number = 1; j < colormapResult.height - 1; j++) {
            for (let i: number = 1; i < colormapResult.width - 1; i++) {
                const top = imgColorIndices.get(i, j - 1);
                const bottom = imgColorIndices.get(i, j + 1);
                const left = imgColorIndices.get(i - 1, j);
                const right = imgColorIndices.get(i + 1, j);
                const cur = imgColorIndices.get(i, j);
                if (cur !== top && cur !== bottom && cur !== left && cur !== right) {
                    // single pixel
                } else if (cur !== top && cur !== bottom) {
                    // check the color distance whether the top or bottom color is closer
                    const topColorDistance = colorDistances[cur][top];
                    const bottomColorDistance = colorDistances[cur][bottom];
                    imgColorIndices.set(i, j, topColorDistance < bottomColorDistance ? top : bottom);
                    count++;
                } else if (cur !== left && cur !== right) {
                    // check the color distance whether the top or bottom color is closer
                    const leftColorDistance = colorDistances[cur][left];
                    const rightColorDistance = colorDistances[cur][right];
                    imgColorIndices.set(i, j, leftColorDistance < rightColorDistance ? left : right);
                    count++;
                }
            }
        }
        console.log(count + " pixels replaced to remove narrow pixel strips");
    }
}
