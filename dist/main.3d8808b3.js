var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
define("common", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CancellationToken = void 0;
    exports.delay = delay;
    function delay(ms) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof window !== "undefined") {
                return new Promise((exec) => window.setTimeout(exec, ms));
            }
            else {
                return new Promise((exec) => exec());
            }
        });
    }
    class CancellationToken {
        constructor() {
            this.isCancelled = false;
        }
    }
    exports.CancellationToken = CancellationToken;
});
define("random", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Random = void 0;
    class Random {
        constructor(seed) {
            if (typeof seed === "undefined") {
                this.seed = new Date().getTime();
            }
            else {
                this.seed = seed;
            }
        }
        next() {
            const x = Math.sin(this.seed++) * 10000;
            return x - Math.floor(x);
        }
    }
    exports.Random = Random;
});
define("lib/clustering", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KMeans = exports.Vector = void 0;
    class Vector {
        constructor(values, weight = 1) {
            this.values = values;
            this.weight = weight;
        }
        distanceTo(p) {
            let sumSquares = 0;
            for (let i = 0; i < this.values.length; i++) {
                sumSquares += (p.values[i] - this.values[i]) * (p.values[i] - this.values[i]);
            }
            return Math.sqrt(sumSquares);
        }
        /**
         *  Calculates the weighted average of the given points
         */
        static average(pts) {
            if (pts.length === 0) {
                throw Error("Can't average 0 elements");
            }
            const dims = pts[0].values.length;
            const values = [];
            for (let i = 0; i < dims; i++) {
                values.push(0);
            }
            let weightSum = 0;
            for (const p of pts) {
                weightSum += p.weight;
                for (let i = 0; i < dims; i++) {
                    values[i] += p.weight * p.values[i];
                }
            }
            for (let i = 0; i < values.length; i++) {
                values[i] /= weightSum;
            }
            return new Vector(values);
        }
    }
    exports.Vector = Vector;
    class KMeans {
        constructor(points, k, random, centroids = null) {
            this.points = points;
            this.k = k;
            this.random = random;
            this.currentIteration = 0;
            this.pointsPerCategory = [];
            this.centroids = [];
            this.currentDeltaDistanceDifference = 0;
            if (centroids != null) {
                this.centroids = centroids;
                for (let i = 0; i < this.k; i++) {
                    this.pointsPerCategory.push([]);
                }
            }
            else {
                this.initCentroids();
            }
        }
        initCentroids() {
            for (let i = 0; i < this.k; i++) {
                this.centroids.push(this.points[Math.floor(this.points.length * this.random.next())]);
                this.pointsPerCategory.push([]);
            }
        }
        step() {
            // clear category
            for (let i = 0; i < this.k; i++) {
                this.pointsPerCategory[i] = [];
            }
            // calculate points per centroid
            for (const p of this.points) {
                let minDist = Number.MAX_VALUE;
                let centroidIndex = -1;
                for (let k = 0; k < this.k; k++) {
                    const dist = this.centroids[k].distanceTo(p);
                    if (dist < minDist) {
                        centroidIndex = k;
                        minDist = dist;
                    }
                }
                this.pointsPerCategory[centroidIndex].push(p);
            }
            let totalDistanceDiff = 0;
            // adjust centroids
            for (let k = 0; k < this.pointsPerCategory.length; k++) {
                const cat = this.pointsPerCategory[k];
                if (cat.length > 0) {
                    const avg = Vector.average(cat);
                    const dist = this.centroids[k].distanceTo(avg);
                    totalDistanceDiff += dist;
                    this.centroids[k] = avg;
                }
            }
            this.currentDeltaDistanceDifference = totalDistanceDiff;
            this.currentIteration++;
        }
    }
    exports.KMeans = KMeans;
});
// From https://stackoverflow.com/a/9493060/694640
define("lib/colorconversion", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.rgbToHsl = rgbToHsl;
    exports.hslToRgb = hslToRgb;
    exports.lab2rgb = lab2rgb;
    exports.rgb2lab = rgb2lab;
    /**
      * Converts an RGB color value to HSL. Conversion formula
      * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
      * Assumes r, g, and b are contained in the set [0, 255] and
      * returns h, s, and l in the set [0, 1].
      *
      * @param   Number  r       The red color value
      * @param   Number  g       The green color value
      * @param   Number  b       The blue color value
      * @return  Array           The HSL representation
      */
    function rgbToHsl(r, g, b) {
        r /= 255, g /= 255, b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0; // achromatic
        }
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
                default: h = 0;
            }
            h /= 6;
        }
        return [h, s, l];
    }
    /**
     * Converts an HSL color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes h, s, and l are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param   Number  h       The hue
     * @param   Number  s       The saturation
     * @param   Number  l       The lightness
     * @return  Array           The RGB representation
     */
    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l; // achromatic
        }
        else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) {
                    t += 1;
                }
                if (t > 1) {
                    t -= 1;
                }
                if (t < 1 / 6) {
                    return p + (q - p) * 6 * t;
                }
                if (t < 1 / 2) {
                    return q;
                }
                if (t < 2 / 3) {
                    return p + (q - p) * (2 / 3 - t) * 6;
                }
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [r * 255, g * 255, b * 255];
    }
    // From https://github.com/antimatter15/rgb-lab/blob/master/color.js
    function lab2rgb(lab) {
        let y = (lab[0] + 16) / 116, x = lab[1] / 500 + y, z = y - lab[2] / 200, r, g, b;
        x = 0.95047 * ((x * x * x > 0.008856) ? x * x * x : (x - 16 / 116) / 7.787);
        y = 1.00000 * ((y * y * y > 0.008856) ? y * y * y : (y - 16 / 116) / 7.787);
        z = 1.08883 * ((z * z * z > 0.008856) ? z * z * z : (z - 16 / 116) / 7.787);
        r = x * 3.2406 + y * -1.5372 + z * -0.4986;
        g = x * -0.9689 + y * 1.8758 + z * 0.0415;
        b = x * 0.0557 + y * -0.2040 + z * 1.0570;
        r = (r > 0.0031308) ? (1.055 * Math.pow(r, 1 / 2.4) - 0.055) : 12.92 * r;
        g = (g > 0.0031308) ? (1.055 * Math.pow(g, 1 / 2.4) - 0.055) : 12.92 * g;
        b = (b > 0.0031308) ? (1.055 * Math.pow(b, 1 / 2.4) - 0.055) : 12.92 * b;
        return [Math.max(0, Math.min(1, r)) * 255,
            Math.max(0, Math.min(1, g)) * 255,
            Math.max(0, Math.min(1, b)) * 255];
    }
    function rgb2lab(rgb) {
        let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
        r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
        x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
        y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
        z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
        x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
        y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
        z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;
        return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
    }
});
define("settings", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Settings = exports.ClusteringColorSpace = void 0;
    var ClusteringColorSpace;
    (function (ClusteringColorSpace) {
        ClusteringColorSpace[ClusteringColorSpace["RGB"] = 0] = "RGB";
        ClusteringColorSpace[ClusteringColorSpace["HSL"] = 1] = "HSL";
        ClusteringColorSpace[ClusteringColorSpace["LAB"] = 2] = "LAB";
    })(ClusteringColorSpace || (exports.ClusteringColorSpace = ClusteringColorSpace = {}));
    class Settings {
        constructor() {
            this.kMeansNrOfClusters = 16;
            this.kMeansMinDeltaDifference = 1;
            this.kMeansClusteringColorSpace = ClusteringColorSpace.RGB;
            this.kMeansColorRestrictions = [];
            this.colorAliases = {};
            this.colorCodes = {};
            this.narrowPixelStripCleanupRuns = 3; // 3 seems like a good compromise between removing enough narrow pixel strips to convergence. This fixes e.g. https://i.imgur.com/dz4ANz1.png
            this.removeFacetsSmallerThanNrOfPoints = 20;
            this.removeFacetsFromLargeToSmall = true;
            this.maximumNumberOfFacets = Number.MAX_VALUE;
            this.nrOfTimesToHalveBorderSegments = 2;
            this.resizeImageIfTooLarge = true;
            this.resizeImageWidth = 1024;
            this.resizeImageHeight = 1024;
            this.randomSeed = new Date().getTime();
        }
    }
    exports.Settings = Settings;
});
define("structs/typedarrays", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BooleanArray2D = exports.Uint8Array2D = exports.Uint32Array2D = void 0;
    class Uint32Array2D {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.arr = new Uint32Array(width * height);
        }
        get(x, y) {
            return this.arr[y * this.width + x];
        }
        set(x, y, value) {
            this.arr[y * this.width + x] = value;
        }
    }
    exports.Uint32Array2D = Uint32Array2D;
    class Uint8Array2D {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.arr = new Uint8Array(width * height);
        }
        get(x, y) {
            return this.arr[y * this.width + x];
        }
        set(x, y, value) {
            this.arr[y * this.width + x] = value;
        }
        matchAllAround(x, y, value) {
            const idx = y * this.width + x;
            return (x - 1 >= 0 && this.arr[idx - 1] === value) &&
                (y - 1 >= 0 && this.arr[idx - this.width] === value) &&
                (x + 1 < this.width && this.arr[idx + 1] === value) &&
                (y + 1 < this.height && this.arr[idx + this.width] === value);
        }
    }
    exports.Uint8Array2D = Uint8Array2D;
    class BooleanArray2D {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.arr = new Uint8Array(width * height);
        }
        get(x, y) {
            return this.arr[y * this.width + x] !== 0;
        }
        set(x, y, value) {
            this.arr[y * this.width + x] = value ? 1 : 0;
        }
    }
    exports.BooleanArray2D = BooleanArray2D;
});
define("colorreductionmanagement", ["require", "exports", "common", "lib/clustering", "lib/colorconversion", "settings", "structs/typedarrays", "random"], function (require, exports, common_1, clustering_1, colorconversion_1, settings_1, typedarrays_1, random_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ColorReducer = exports.ColorMapResult = void 0;
    class ColorMapResult {
    }
    exports.ColorMapResult = ColorMapResult;
    class ColorReducer {
        /**
         *  Creates a map of the various colors used
         */
        static createColorMap(kmeansImgData) {
            const imgColorIndices = new typedarrays_1.Uint8Array2D(kmeansImgData.width, kmeansImgData.height);
            let colorIndex = 0;
            const colors = {};
            const colorsByIndex = [];
            let idx = 0;
            for (let j = 0; j < kmeansImgData.height; j++) {
                for (let i = 0; i < kmeansImgData.width; i++) {
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
                    }
                    else {
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
        static applyKMeansClustering(imgData_1, outputImgData_1, ctx_1, settings_2) {
            return __awaiter(this, arguments, void 0, function* (imgData, outputImgData, ctx, settings, onUpdate = null) {
                const vectors = [];
                let idx = 0;
                let vIdx = 0;
                const bitsToChopOff = 2; // r,g,b gets rounded to every 4 values, 0,4,8,...
                // group by color, add points as 1D index to prevent Point object allocation
                const pointsByColor = {};
                for (let j = 0; j < imgData.height; j++) {
                    for (let i = 0; i < imgData.width; i++) {
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
                        }
                        else {
                            pointsByColor[color].push(j * imgData.width + i);
                        }
                    }
                }
                for (const color of Object.keys(pointsByColor)) {
                    const rgb = color.split(",").map((v) => parseInt(v));
                    // determine vector data based on color space conversion
                    let data;
                    if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.RGB) {
                        data = rgb;
                    }
                    else if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.HSL) {
                        data = (0, colorconversion_1.rgbToHsl)(rgb[0], rgb[1], rgb[2]);
                    }
                    else if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.LAB) {
                        data = (0, colorconversion_1.rgb2lab)(rgb);
                    }
                    else {
                        data = rgb;
                    }
                    // determine the weight (#pointsOfColor / #totalpoints) of each color
                    const weight = pointsByColor[color].length / (imgData.width * imgData.height);
                    const vec = new clustering_1.Vector(data, weight);
                    vec.tag = rgb;
                    vectors[vIdx++] = vec;
                }
                const random = new random_1.Random(settings.randomSeed === 0 ? new Date().getTime() : settings.randomSeed);
                // vectors of all the unique colors are built, time to cluster them
                const kmeans = new clustering_1.KMeans(vectors, settings.kMeansNrOfClusters, random);
                let curTime = new Date().getTime();
                kmeans.step();
                while (kmeans.currentDeltaDistanceDifference > settings.kMeansMinDeltaDifference) {
                    kmeans.step();
                    // update GUI every 500ms
                    if (new Date().getTime() - curTime > 500) {
                        curTime = new Date().getTime();
                        yield (0, common_1.delay)(0);
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
            });
        }
        /**
         *  Updates the image data from the current kmeans centroids and their respective associated colors (vectors)
         */
        static updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, restrictToSpecifiedColors) {
            // Compute base RGB and Lab values for each centroid
            const centroidRGBs = [];
            const centroidLabs = [];
            const centroidWeights = [];
            for (let c = 0; c < kmeans.centroids.length; c++) {
                const centroid = kmeans.centroids[c];
                let rgb;
                if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.RGB) {
                    rgb = centroid.values;
                }
                else if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.HSL) {
                    const hsl = centroid.values;
                    rgb = (0, colorconversion_1.hslToRgb)(hsl[0], hsl[1], hsl[2]);
                }
                else if (settings.kMeansClusteringColorSpace === settings_1.ClusteringColorSpace.LAB) {
                    const lab = centroid.values;
                    rgb = (0, colorconversion_1.lab2rgb)(lab);
                }
                else {
                    rgb = centroid.values;
                }
                const cleanRgb = [Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2])];
                centroidRGBs.push(cleanRgb);
                centroidLabs.push((0, colorconversion_1.rgb2lab)(cleanRgb));
                let weight = 0;
                const pts = kmeans.pointsPerCategory[c];
                if (pts) {
                    for (const v of pts) {
                        const ptRGB = v.tag;
                        const pointColor = `${Math.floor(ptRGB[0])},${Math.floor(ptRGB[1])},${Math.floor(ptRGB[2])}`;
                        if (pointsByColor[pointColor]) {
                            weight += pointsByColor[pointColor].length;
                        }
                    }
                }
                centroidWeights.push(weight);
            }
            const assignedRGBByCentroid = new Array(kmeans.centroids.length);
            if (restrictToSpecifiedColors && settings.kMeansColorRestrictions.length > 0) {
                // Collect unique restricted colors
                const restrictedRGBs = [];
                const restrictedLabs = [];
                const seenRestricted = new Set();
                for (const col of settings.kMeansColorRestrictions) {
                    let rgbVal;
                    if (typeof col === "string") {
                        rgbVal = settings.colorAliases[col];
                    }
                    else {
                        rgbVal = col;
                    }
                    if (rgbVal) {
                        const key = `${Math.floor(rgbVal[0])},${Math.floor(rgbVal[1])},${Math.floor(rgbVal[2])}`;
                        if (!seenRestricted.has(key)) {
                            seenRestricted.add(key);
                            const cleanVal = [Math.floor(rgbVal[0]), Math.floor(rgbVal[1]), Math.floor(rgbVal[2])];
                            restrictedRGBs.push(cleanVal);
                            restrictedLabs.push((0, colorconversion_1.rgb2lab)(cleanVal));
                        }
                    }
                }
                const K = kmeans.centroids.length;
                const M = restrictedRGBs.length;
                if (M > 0) {
                    // Sort centroid indices by cluster weight descending so visually prominent clusters get preferred colors
                    const sortedCentroidIndices = Array.from({ length: K }, (_, i) => i)
                        .sort((a, b) => centroidWeights[b] - centroidWeights[a]);
                    const usedRestricted = new Set();
                    // Phase 1: Assign a unique restricted color to each centroid up to min(K, M)
                    const uniqueCount = Math.min(K, M);
                    for (let i = 0; i < uniqueCount; i++) {
                        const c = sortedCentroidIndices[i];
                        const cLab = centroidLabs[c];
                        let minDistance = Number.MAX_VALUE;
                        let bestR = -1;
                        for (let r = 0; r < M; r++) {
                            if (usedRestricted.has(r))
                                continue;
                            const rLab = restrictedLabs[r];
                            const distance = Math.sqrt((cLab[0] - rLab[0]) * (cLab[0] - rLab[0]) +
                                (cLab[1] - rLab[1]) * (cLab[1] - rLab[1]) +
                                (cLab[2] - rLab[2]) * (cLab[2] - rLab[2]));
                            if (distance < minDistance) {
                                minDistance = distance;
                                bestR = r;
                            }
                        }
                        if (bestR !== -1) {
                            assignedRGBByCentroid[c] = restrictedRGBs[bestR];
                            usedRestricted.add(bestR);
                        }
                        else {
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
                            const distance = Math.sqrt((cLab[0] - rLab[0]) * (cLab[0] - rLab[0]) +
                                (cLab[1] - rLab[1]) * (cLab[1] - rLab[1]) +
                                (cLab[2] - rLab[2]) * (cLab[2] - rLab[2]));
                            if (distance < minDistance) {
                                minDistance = distance;
                                bestR = r;
                            }
                        }
                        assignedRGBByCentroid[c] = restrictedRGBs[bestR];
                    }
                }
                else {
                    for (let c = 0; c < K; c++) {
                        assignedRGBByCentroid[c] = centroidRGBs[c];
                    }
                }
            }
            else {
                for (let c = 0; c < kmeans.centroids.length; c++) {
                    assignedRGBByCentroid[c] = centroidRGBs[c];
                }
            }
            // Apply assigned colors to output image data
            for (let c = 0; c < kmeans.centroids.length; c++) {
                const rgb = assignedRGBByCentroid[c];
                const pts = kmeans.pointsPerCategory[c];
                if (!pts)
                    continue;
                for (const v of pts) {
                    const pointRGB = v.tag;
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
        static buildColorDistanceMatrix(colorsByIndex) {
            const colorDistances = new Array(colorsByIndex.length);
            for (let j = 0; j < colorsByIndex.length; j++) {
                colorDistances[j] = new Array(colorDistances.length);
            }
            for (let j = 0; j < colorsByIndex.length; j++) {
                for (let i = j; i < colorsByIndex.length; i++) {
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
        static processNarrowPixelStripCleanup(colormapResult) {
            return __awaiter(this, void 0, void 0, function* () {
                // build the color distance matrix, which describes the distance of each color to each other
                const colorDistances = ColorReducer.buildColorDistanceMatrix(colormapResult.colorsByIndex);
                let count = 0;
                const imgColorIndices = colormapResult.imgColorIndices;
                for (let j = 1; j < colormapResult.height - 1; j++) {
                    for (let i = 1; i < colormapResult.width - 1; i++) {
                        const top = imgColorIndices.get(i, j - 1);
                        const bottom = imgColorIndices.get(i, j + 1);
                        const left = imgColorIndices.get(i - 1, j);
                        const right = imgColorIndices.get(i + 1, j);
                        const cur = imgColorIndices.get(i, j);
                        if (cur !== top && cur !== bottom && cur !== left && cur !== right) {
                            // single pixel
                        }
                        else if (cur !== top && cur !== bottom) {
                            // check the color distance whether the top or bottom color is closer
                            const topColorDistance = colorDistances[cur][top];
                            const bottomColorDistance = colorDistances[cur][bottom];
                            imgColorIndices.set(i, j, topColorDistance < bottomColorDistance ? top : bottom);
                            count++;
                        }
                        else if (cur !== left && cur !== right) {
                            // check the color distance whether the top or bottom color is closer
                            const leftColorDistance = colorDistances[cur][left];
                            const rightColorDistance = colorDistances[cur][right];
                            imgColorIndices.set(i, j, leftColorDistance < rightColorDistance ? left : right);
                            count++;
                        }
                    }
                }
                console.log(count + " pixels replaced to remove narrow pixel strips");
            });
        }
    }
    exports.ColorReducer = ColorReducer;
});
define("structs/point", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Point = void 0;
    class Point {
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
        distanceTo(pt) {
            // don't do euclidean because then neighbours should be diagonally as well
            // because sqrt(2) < 2
            //  return Math.sqrt((pt.x - this.x) * (pt.x - this.x) + (pt.y - this.y) * (pt.y - this.y));
            return Math.abs(pt.x - this.x) + Math.abs(pt.y - this.y);
        }
        distanceToCoord(x, y) {
            // don't do euclidean because then neighbours should be diagonally as well
            // because sqrt(2) < 2
            //  return Math.sqrt((pt.x - this.x) * (pt.x - this.x) + (pt.y - this.y) * (pt.y - this.y));
            return Math.abs(x - this.x) + Math.abs(y - this.y);
        }
    }
    exports.Point = Point;
});
define("structs/boundingbox", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BoundingBox = void 0;
    class BoundingBox {
        constructor() {
            this.minX = Number.MAX_VALUE;
            this.minY = Number.MAX_VALUE;
            this.maxX = Number.MIN_VALUE;
            this.maxY = Number.MIN_VALUE;
        }
        get width() {
            return this.maxX - this.minX + 1;
        }
        get height() {
            return this.maxY - this.minY + 1;
        }
    }
    exports.BoundingBox = BoundingBox;
});
define("facetmanagement", ["require", "exports", "structs/point"], function (require, exports, point_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetResult = exports.Facet = exports.PathPoint = exports.OrientationEnum = void 0;
    var OrientationEnum;
    (function (OrientationEnum) {
        OrientationEnum[OrientationEnum["Left"] = 0] = "Left";
        OrientationEnum[OrientationEnum["Top"] = 1] = "Top";
        OrientationEnum[OrientationEnum["Right"] = 2] = "Right";
        OrientationEnum[OrientationEnum["Bottom"] = 3] = "Bottom";
    })(OrientationEnum || (exports.OrientationEnum = OrientationEnum = {}));
    /**
     * PathPoint is a point with an orientation that indicates which wall border is set
     */
    class PathPoint extends point_1.Point {
        constructor(pt, orientation) {
            super(pt.x, pt.y);
            this.orientation = orientation;
        }
        getWallX() {
            let x = this.x;
            if (this.orientation === OrientationEnum.Left) {
                x -= 0.5;
            }
            else if (this.orientation === OrientationEnum.Right) {
                x += 0.5;
            }
            return x;
        }
        getWallY() {
            let y = this.y;
            if (this.orientation === OrientationEnum.Top) {
                y -= 0.5;
            }
            else if (this.orientation === OrientationEnum.Bottom) {
                y += 0.5;
            }
            return y;
        }
        getNeighbour(facetResult) {
            switch (this.orientation) {
                case OrientationEnum.Left:
                    if (this.x - 1 >= 0) {
                        return facetResult.facetMap.get(this.x - 1, this.y);
                    }
                    break;
                case OrientationEnum.Right:
                    if (this.x + 1 < facetResult.width) {
                        return facetResult.facetMap.get(this.x + 1, this.y);
                    }
                    break;
                case OrientationEnum.Top:
                    if (this.y - 1 >= 0) {
                        return facetResult.facetMap.get(this.x, this.y - 1);
                    }
                    break;
                case OrientationEnum.Bottom:
                    if (this.y + 1 < facetResult.height) {
                        return facetResult.facetMap.get(this.x, this.y + 1);
                    }
                    break;
            }
            return -1;
        }
        toString() {
            return this.x + "," + this.y + " " + this.orientation;
        }
    }
    exports.PathPoint = PathPoint;
    /**
     *  A facet that represents an area of pixels of the same color
     */
    class Facet {
        constructor() {
            this.pointCount = 0;
            /**
             * Flag indicating if the neighbourfacets array is dirty. If it is, the neighbourfacets *have* to be rebuild
             * Before it can be used. This is useful to defer the rebuilding of the array until it's actually needed
             * and can remove a lot of duplicate building of the array because multiple facets were hitting the same neighbour
             * (over 50% on test images)
             */
            this.neighbourFacetsIsDirty = false;
        }
        getFullPathFromBorderSegments(useWalls) {
            const newpath = [];
            const addPoint = (pt) => {
                if (useWalls) {
                    newpath.push(new point_1.Point(pt.getWallX(), pt.getWallY()));
                }
                else {
                    newpath.push(new point_1.Point(pt.x, pt.y));
                }
            };
            let lastSegment = null;
            for (const seg of this.borderSegments) {
                // fix for the continuitity of the border segments. If transition points between border segments on the path aren't repeated, the
                // borders of the facets aren't always matching up leaving holes when rendered
                if (lastSegment != null) {
                    if (lastSegment.reverseOrder) {
                        addPoint(lastSegment.originalSegment.points[0]);
                    }
                    else {
                        addPoint(lastSegment.originalSegment.points[lastSegment.originalSegment.points.length - 1]);
                    }
                }
                for (let i = 0; i < seg.originalSegment.points.length; i++) {
                    const idx = seg.reverseOrder ? (seg.originalSegment.points.length - 1 - i) : i;
                    addPoint(seg.originalSegment.points[idx]);
                }
                lastSegment = seg;
            }
            return newpath;
        }
    }
    exports.Facet = Facet;
    /**
     *  Result of the facet construction, both as a map and as an array.
     *  Facets in the array can be null when they've been deleted
     */
    class FacetResult {
    }
    exports.FacetResult = FacetResult;
});
define("facetBorderSegmenter", ["require", "exports", "common", "structs/point", "facetmanagement"], function (require, exports, common_2, point_2, facetmanagement_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetBorderSegmenter = exports.FacetBoundarySegment = exports.PathSegment = void 0;
    /**
     *  Path segment is a segment of a border path that is adjacent to a specific neighbour facet
     */
    class PathSegment {
        constructor(points, neighbour) {
            this.points = points;
            this.neighbour = neighbour;
        }
    }
    exports.PathSegment = PathSegment;
    /**
     * Facet boundary segment describes the matched segment that is shared between 2 facets
     * When 2 segments are matched, one will be the original segment and the other one is removed
     * This ensures that all facets share the same segments, but sometimes in reverse order to ensure
     * the correct continuity of its entire oborder path
     */
    class FacetBoundarySegment {
        constructor(originalSegment, neighbour, reverseOrder) {
            this.originalSegment = originalSegment;
            this.neighbour = neighbour;
            this.reverseOrder = reverseOrder;
        }
    }
    exports.FacetBoundarySegment = FacetBoundarySegment;
    class FacetBorderSegmenter {
        /**
         *  Builds border segments that are shared between facets
         *  While border paths are all nice and fancy, they are not linked to neighbour facets
         *  So any change in the paths makes a not so nice gap between the facets, which makes smoothing them out impossible
         */
        static buildFacetBorderSegments(facetResult_1) {
            return __awaiter(this, arguments, void 0, function* (facetResult, nrOfTimesToHalvePoints = 2, onUpdate = null) {
                // first chop up the border path in segments each time the neighbour at that point changes
                // (and sometimes even when it doesn't on that side but does on the neighbour's side)
                const segmentsPerFacet = FacetBorderSegmenter.prepareSegmentsPerFacet(facetResult);
                // now reduce the segment complexity with Haar wavelet reduction to smooth them out and make them
                // more curvy with data points instead of zig zag of a grid
                FacetBorderSegmenter.reduceSegmentComplexity(facetResult, segmentsPerFacet, nrOfTimesToHalvePoints);
                // now see which segments of facets with the prepared segments of the neighbour facets
                // and point them to the same one
                yield FacetBorderSegmenter.matchSegmentsWithNeighbours(facetResult, segmentsPerFacet, onUpdate);
            });
        }
        /**
         *  Chops up the border paths per facet into segments adjacent tothe same neighbour
         */
        static prepareSegmentsPerFacet(facetResult) {
            const segmentsPerFacet = new Array(facetResult.facets.length);
            for (const f of facetResult.facets) {
                if (f != null) {
                    const segments = [];
                    if (f.borderPath.length > 1) {
                        let currentPoints = [];
                        currentPoints.push(f.borderPath[0]);
                        for (let i = 1; i < f.borderPath.length; i++) {
                            const prevBorderPoint = f.borderPath[i - 1];
                            const curBorderPoint = f.borderPath[i];
                            const oldNeighbour = prevBorderPoint.getNeighbour(facetResult);
                            const curNeighbour = curBorderPoint.getNeighbour(facetResult);
                            let isTransitionPoint = false;
                            if (oldNeighbour !== curNeighbour) {
                                isTransitionPoint = true;
                            }
                            else {
                                // it's possible that due to inner facets inside the current facet that the
                                // border is interrupted on that facet's side, but not on the neighbour's side
                                if (oldNeighbour !== -1) {
                                    // check for tight rotations to break path if diagonals contain a different neighbour,
                                    // see https://i.imgur.com/o6Srqwj.png for visual path of the issue
                                    if (prevBorderPoint.x === curBorderPoint.x &&
                                        prevBorderPoint.y === curBorderPoint.y) {
                                        // rotation turn
                                        // check the diagonal neighbour to see if it remains the same
                                        //   +---+---+
                                        //   | dN|   |
                                        //   +---xxxx> (x = wall, dN = diagNeighbour)
                                        //   |   x f |
                                        //   +---v---+
                                        if ((prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Top && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Left) ||
                                            (prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Left && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Top)) {
                                            const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x - 1, curBorderPoint.y - 1);
                                            if (diagNeighbour !== oldNeighbour) {
                                                isTransitionPoint = true;
                                            }
                                        }
                                        else if ((prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Top && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Right) ||
                                            (prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Right && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Top)) {
                                            const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x + 1, curBorderPoint.y - 1);
                                            if (diagNeighbour !== oldNeighbour) {
                                                isTransitionPoint = true;
                                            }
                                        }
                                        else if ((prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Bottom && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Left) ||
                                            (prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Left && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Bottom)) {
                                            const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x - 1, curBorderPoint.y + 1);
                                            if (diagNeighbour !== oldNeighbour) {
                                                isTransitionPoint = true;
                                            }
                                        }
                                        else if ((prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Bottom && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Right) ||
                                            (prevBorderPoint.orientation === facetmanagement_1.OrientationEnum.Right && curBorderPoint.orientation === facetmanagement_1.OrientationEnum.Bottom)) {
                                            const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x + 1, curBorderPoint.y + 1);
                                            if (diagNeighbour !== oldNeighbour) {
                                                isTransitionPoint = true;
                                            }
                                        }
                                    }
                                }
                            }
                            currentPoints.push(curBorderPoint);
                            if (isTransitionPoint) {
                                // aha! a transition point, create the current points as new segment
                                // and start a new list
                                if (currentPoints.length > 1) {
                                    const segment = new PathSegment(currentPoints, oldNeighbour);
                                    segments.push(segment);
                                    currentPoints = [curBorderPoint];
                                }
                            }
                        }
                        // finally check if there is a remainder partial segment and either prepend
                        // the points to the first segment if they have the same neighbour or construct a
                        // new segment
                        if (currentPoints.length > 1) {
                            const oldNeighbour = f.borderPath[f.borderPath.length - 1].getNeighbour(facetResult);
                            if (segments.length > 0 && segments[0].neighbour === oldNeighbour) {
                                // the first segment and the remainder of the last one are the same part
                                // add the current points to the first segment by prefixing it
                                const mergedPoints = currentPoints.concat(segments[0].points);
                                segments[0].points = mergedPoints;
                            }
                            else {
                                // add the remainder as final segment
                                const segment = new PathSegment(currentPoints, oldNeighbour);
                                segments.push(segment);
                                currentPoints = [];
                            }
                        }
                    }
                    segmentsPerFacet[f.id] = segments;
                }
            }
            return segmentsPerFacet;
        }
        /**
         * Reduces each segment border path points
         */
        static reduceSegmentComplexity(facetResult, segmentsPerFacet, nrOfTimesToHalvePoints) {
            for (const f of facetResult.facets) {
                if (f != null) {
                    for (const segment of segmentsPerFacet[f.id]) {
                        for (let i = 0; i < nrOfTimesToHalvePoints; i++) {
                            segment.points = FacetBorderSegmenter.reduceSegmentHaarWavelet(segment.points, true, facetResult.width, facetResult.height);
                        }
                    }
                }
            }
        }
        /**
         *  Remove the points by taking the average per pair and using that as a new point
         *  in the reduced segment. The delta values that create the Haar wavelet are not tracked
         *  because they are unneeded.
         */
        static reduceSegmentHaarWavelet(newpath, skipOutsideBorders, width, height) {
            if (newpath.length <= 5) {
                return newpath;
            }
            const reducedPath = [];
            reducedPath.push(newpath[0]);
            for (let i = 1; i < newpath.length - 2; i += 2) {
                if (!skipOutsideBorders || (skipOutsideBorders && !FacetBorderSegmenter.isOutsideBorderPoint(newpath[i], width, height))) {
                    const cx = (newpath[i].x + newpath[i + 1].x) / 2;
                    const cy = (newpath[i].y + newpath[i + 1].y) / 2;
                    reducedPath.push(new facetmanagement_1.PathPoint(new point_2.Point(cx, cy), facetmanagement_1.OrientationEnum.Left));
                }
                else {
                    reducedPath.push(newpath[i]);
                    reducedPath.push(newpath[i + 1]);
                }
            }
            // close the loop
            reducedPath.push(newpath[newpath.length - 1]);
            return reducedPath;
        }
        static isOutsideBorderPoint(point, width, height) {
            return point.x === 0 || point.y === 0 || point.x === width - 1 || point.y === height - 1;
        }
        static calculateArea(path) {
            let total = 0;
            for (let i = 0; i < path.length; i++) {
                const addX = path[i].x;
                const addY = path[i === path.length - 1 ? 0 : i + 1].y;
                const subX = path[i === path.length - 1 ? 0 : i + 1].x;
                const subY = path[i].y;
                total += (addX * addY * 0.5);
                total -= (subX * subY * 0.5);
            }
            return Math.abs(total);
        }
        /**
         *  Matches all segments with each other between facets and their neighbour
         *  A segment matches when the start and end match or the start matches with the end and vice versa
         *  (then the segment will need to be traversed in reverse order)
         */
        static matchSegmentsWithNeighbours(facetResult_1, segmentsPerFacet_1) {
            return __awaiter(this, arguments, void 0, function* (facetResult, segmentsPerFacet, onUpdate = null) {
                // max distance of the start/end points of the segment that it can be before the segments don't match up
                const MAX_DISTANCE = 4;
                // reserve room
                for (const f of facetResult.facets) {
                    if (f != null) {
                        f.borderSegments = new Array(segmentsPerFacet[f.id].length);
                    }
                }
                let count = 0;
                // and now the fun begins to match segments from 1 facet to its neighbours and vice versa
                for (const f of facetResult.facets) {
                    if (f != null) {
                        const debug = false;
                        for (let s = 0; s < segmentsPerFacet[f.id].length; s++) {
                            const segment = segmentsPerFacet[f.id][s];
                            if (segment != null && f.borderSegments[s] == null) {
                                f.borderSegments[s] = new FacetBoundarySegment(segment, segment.neighbour, false);
                                if (debug) {
                                    console.log("Setting facet " + f.id + " segment " + s + " to " + f.borderSegments[s]);
                                }
                                if (segment.neighbour !== -1) {
                                    const neighbourFacet = facetResult.facets[segment.neighbour];
                                    // see if there is a match to be found
                                    let matchFound = false;
                                    if (neighbourFacet != null) {
                                        const neighbourSegments = segmentsPerFacet[segment.neighbour];
                                        for (let ns = 0; ns < neighbourSegments.length; ns++) {
                                            const neighbourSegment = neighbourSegments[ns];
                                            // only try to match against the segments that aren't processed yet
                                            // and which are adjacent to the boundary of the current facet
                                            if (neighbourSegment != null && neighbourSegment.neighbour === f.id) {
                                                const segStartPoint = segment.points[0];
                                                const segEndPoint = segment.points[segment.points.length - 1];
                                                const nSegStartPoint = neighbourSegment.points[0];
                                                const nSegEndPoint = neighbourSegment.points[neighbourSegment.points.length - 1];
                                                let matchesStraight = (segStartPoint.distanceTo(nSegStartPoint) <= MAX_DISTANCE &&
                                                    segEndPoint.distanceTo(nSegEndPoint) <= MAX_DISTANCE);
                                                let matchesReverse = (segStartPoint.distanceTo(nSegEndPoint) <= MAX_DISTANCE &&
                                                    segEndPoint.distanceTo(nSegStartPoint) <= MAX_DISTANCE);
                                                if (matchesStraight && matchesReverse) {
                                                    // dang it , both match, it must be a tiny segment, but when placed wrongly it'll overlap in the path creating an hourglass 
                                                    //  e.g. https://i.imgur.com/XZQhxRV.png
                                                    // determine which is the closest
                                                    if (segStartPoint.distanceTo(nSegStartPoint) + segEndPoint.distanceTo(nSegEndPoint) <
                                                        segStartPoint.distanceTo(nSegEndPoint) + segEndPoint.distanceTo(nSegStartPoint)) {
                                                        matchesStraight = true;
                                                        matchesReverse = false;
                                                    }
                                                    else {
                                                        matchesStraight = false;
                                                        matchesReverse = true;
                                                    }
                                                }
                                                if (matchesStraight) {
                                                    // start & end points match
                                                    if (debug) {
                                                        console.log("Match found for facet " + f.id + " to neighbour " + neighbourFacet.id);
                                                    }
                                                    neighbourFacet.borderSegments[ns] = new FacetBoundarySegment(segment, f.id, false);
                                                    if (debug) {
                                                        console.log("Setting facet " + neighbourFacet.id + " segment " + ns + " to " + neighbourFacet.borderSegments[ns]);
                                                    }
                                                    segmentsPerFacet[neighbourFacet.id][ns] = null;
                                                    matchFound = true;
                                                    break;
                                                }
                                                else if (matchesReverse) {
                                                    // start & end points match  but in reverse order
                                                    if (debug) {
                                                        console.log("Reverse match found for facet " + f.id + " to neighbour " + neighbourFacet.id);
                                                    }
                                                    neighbourFacet.borderSegments[ns] = new FacetBoundarySegment(segment, f.id, true);
                                                    if (debug) {
                                                        console.log("Setting facet " + neighbourFacet.id + " segment " + ns + " to " + neighbourFacet.borderSegments[ns]);
                                                    }
                                                    segmentsPerFacet[neighbourFacet.id][ns] = null;
                                                    matchFound = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    if (!matchFound && debug) {
                                        // it's possible that the border is not shared with its neighbour
                                        // this can happen when the segment fully falls inside the other facet
                                        // though the above checks in the preparation of the segments should probably
                                        // cover all cases
                                        console.error("No match found for segment of " + f.id + ": " +
                                            ("siding " + segment.neighbour + " " + segment.points[0] + " -> " + segment.points[segment.points.length - 1]));
                                    }
                                }
                            }
                            // clear the current segment so it can't be processed again when processing the neighbour facet
                            segmentsPerFacet[f.id][s] = null;
                        }
                        if (count % 100 === 0) {
                            yield (0, common_2.delay)(0);
                            if (onUpdate != null) {
                                onUpdate(f.id / facetResult.facets.length);
                            }
                        }
                    }
                    count++;
                }
                if (onUpdate != null) {
                    onUpdate(1);
                }
            });
        }
    }
    exports.FacetBorderSegmenter = FacetBorderSegmenter;
});
define("facetBorderTracer", ["require", "exports", "common", "structs/point", "structs/typedarrays", "facetmanagement"], function (require, exports, common_3, point_3, typedarrays_2, facetmanagement_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetBorderTracer = void 0;
    class FacetBorderTracer {
        /**
         *  Traces the border path of the facet from the facet border points.
         *  Imagine placing walls around the outer side of the border points.
         */
        static buildFacetBorderPaths(facetResult_1) {
            return __awaiter(this, arguments, void 0, function* (facetResult, onUpdate = null) {
                let count = 0;
                const borderMask = new typedarrays_2.BooleanArray2D(facetResult.width, facetResult.height);
                // sort by biggest facets first
                const facetProcessingOrder = facetResult.facets.filter((f) => f != null).slice(0).sort((a, b) => b.pointCount > a.pointCount ? 1 : (b.pointCount < a.pointCount ? -1 : 0)).map((f) => f.id);
                for (let fidx = 0; fidx < facetProcessingOrder.length; fidx++) {
                    const f = facetResult.facets[facetProcessingOrder[fidx]];
                    if (f != null) {
                        for (const bp of f.borderPoints) {
                            borderMask.set(bp.x, bp.y, true);
                        }
                        // keep track of which walls are already set on each pixel
                        // e.g. xWall.get(x,y) is the left wall of point x,y
                        // as the left wall of (x+1,y) and right wall of (x,y) is the same
                        // the right wall of x,y can be set with xWall.set(x+1,y).
                        // Analogous for the horizontal walls in yWall
                        const xWall = new typedarrays_2.BooleanArray2D(facetResult.width + 1, facetResult.height + 1);
                        const yWall = new typedarrays_2.BooleanArray2D(facetResult.width + 1, facetResult.height + 1);
                        // the first border point will guaranteed be one of the outer ones because
                        // it will be the first point that is encountered of the facet when building
                        // them in buildFacet with DFS.
                        // --> Or so I thought, which is apparently not the case in rare circumstances
                        // sooooo go look for a border that edges with the bounding box, this is definitely
                        // on the outer side then.
                        let borderStartIndex = -1;
                        for (let i = 0; i < f.borderPoints.length; i++) {
                            if ((f.borderPoints[i].x === f.bbox.minX || f.borderPoints[i].x === f.bbox.maxX) ||
                                (f.borderPoints[i].y === f.bbox.minY || f.borderPoints[i].y === f.bbox.maxY)) {
                                borderStartIndex = i;
                                break;
                            }
                        }
                        // determine the starting point orientation (the outside of facet)
                        const pt = new facetmanagement_2.PathPoint(f.borderPoints[borderStartIndex], facetmanagement_2.OrientationEnum.Left);
                        // L T R B
                        if (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id) {
                            pt.orientation = facetmanagement_2.OrientationEnum.Left;
                        }
                        else if (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id) {
                            pt.orientation = facetmanagement_2.OrientationEnum.Top;
                        }
                        else if (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id) {
                            pt.orientation = facetmanagement_2.OrientationEnum.Right;
                        }
                        else if (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id) {
                            pt.orientation = facetmanagement_2.OrientationEnum.Bottom;
                        }
                        // build a border path from that point
                        const path = FacetBorderTracer.getPath(pt, facetResult, f, borderMask, xWall, yWall);
                        f.borderPath = path;
                        if (count % 100 === 0) {
                            yield (0, common_3.delay)(0);
                            if (onUpdate != null) {
                                onUpdate(fidx / facetProcessingOrder.length);
                            }
                        }
                    }
                    count++;
                }
                if (onUpdate != null) {
                    onUpdate(1);
                }
            });
        }
        /**
         * Returns a border path starting from the given point
         */
        static getPath(pt, facetResult, f, borderMask, xWall, yWall) {
            const debug = false;
            let finished = false;
            const count = 0;
            const path = [];
            FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
            // check rotations first, then straight along the ouside and finally diagonally
            // this ensures that bends are always taken as tight as possible
            // so it doesn't skip border points to later loop back to and get stuck (hopefully)
            while (!finished) {
                if (debug) {
                    console.log(pt.x + " " + pt.y + " " + pt.orientation);
                }
                // yes, technically i could do some trickery to only get the left/top cases
                // by shifting the pixels but that means some more shenanigans in correct order of things
                // so whatever. (And yes I tried it but it wasn't worth the debugging hell that ensued)
                const possibleNextPoints = [];
                //   +---+---+
                //   |  <|   |
                //   +---+---+
                if (pt.orientation === facetmanagement_2.OrientationEnum.Left) {
                    // check rotate to top
                    //   +---+---+
                    //   |   |   |
                    //   +---xnnnn (x = old wall, n = new wall, F = current facet x,y)
                    //   |   x F |
                    //   +---x---+
                    if (((pt.y - 1 >= 0 && facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id) // top exists and is a neighbour facet
                        || pt.y - 1 < 0) // or top doesn't exist, which is the boundary of the image
                        && !yWall.get(pt.x, pt.y)) { // and the wall isn't set yet
                        // can place top _ wall at x,y
                        if (debug) {
                            console.log("can place top _ wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rotate to bottom
                    //   +---+---+
                    //   |   |   |
                    //   +---x---+ (x = old wall, n = new wall, F = current facet x,y)
                    //   |   x F |
                    //   +---xnnnn
                    if (((pt.y + 1 < facetResult.height && facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id) // bottom exists and is a neighbour facet
                        || pt.y + 1 >= facetResult.height) // or bottom doesn't exist, which is the boundary of the image
                        && !yWall.get(pt.x, pt.y + 1)) { // and the wall isn't set yet
                        // can place bottom  _ wall at x,y
                        if (debug) {
                            console.log("can place bottom _ wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check upwards
                    //   +---n---+
                    //   |   n   |
                    //   +---x---+ (x = old wall, n = new wall, F = current facet x,y)
                    //   |   x F |
                    //   +---x---+
                    if (pt.y - 1 >= 0 // top exists
                        && facetResult.facetMap.get(pt.x, pt.y - 1) === f.id // and is part of the same facet
                        && (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y - 1) !== f.id) // and
                        && borderMask.get(pt.x, pt.y - 1)
                        && !xWall.get(pt.x, pt.y - 1)) {
                        // can place | wall at x,y-1
                        if (debug) {
                            console.log(`can place left | wall at x,y-1`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y - 1), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                    // check downwards
                    //   +---x---+
                    //   |   x F |
                    //   +---x---+ (x = old wall, n = new wall, F = current facet x,y)
                    //   |   n   |
                    //   +---n---+
                    if (pt.y + 1 < facetResult.height
                        && facetResult.facetMap.get(pt.x, pt.y + 1) === f.id
                        && (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y + 1) !== f.id)
                        && borderMask.get(pt.x, pt.y + 1)
                        && !xWall.get(pt.x, pt.y + 1)) {
                        // can place | wall at x,y+1
                        if (debug) {
                            console.log("can place left | wall at x,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y + 1), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                    // check left upwards
                    //   +---+---+
                    //   |   |   |
                    //   nnnnx---+ (x = old wall, n = new wall, F = current facet x,y)
                    //   |   x F |
                    //   +---x---+
                    if (pt.y - 1 >= 0 && pt.x - 1 >= 0 // there is a left upwards
                        && facetResult.facetMap.get(pt.x - 1, pt.y - 1) === f.id // and it belongs to the same facet
                        && borderMask.get(pt.x - 1, pt.y - 1) // and is on the border
                        && !yWall.get(pt.x - 1, pt.y - 1 + 1) // and the bottom wall isn't set yet
                        && !yWall.get(pt.x, pt.y) // and the path didn't come from the top of the current one to prevent getting a T shaped path (issue: https://i.imgur.com/ggUWuXi.png)
                    ) {
                        // can place bottom _ wall at x-1,y-1
                        if (debug) {
                            console.log("can place bottom _ wall at x-1,y-1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y - 1), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check left downwards
                    //   +---x---+
                    //   |   x F |
                    //   nnnnx---+ (x = old wall, n = new wall, F = current facet x,y)
                    //   |   |   |
                    //   +---+---+
                    if (pt.y + 1 < facetResult.height && pt.x - 1 >= 0 // there is a left downwards
                        && facetResult.facetMap.get(pt.x - 1, pt.y + 1) === f.id // and belongs to the same facet
                        && borderMask.get(pt.x - 1, pt.y + 1) // and is on the border
                        && !yWall.get(pt.x - 1, pt.y + 1) // and the top wall isn't set yet
                        && !yWall.get(pt.x, pt.y + 1) // and the path didn't come from the bottom of the current point to prevent T shape
                    ) {
                        // can place top _ wall at x-1,y+1
                        if (debug) {
                            console.log("can place top _ wall at x-1,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y + 1), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                }
                else if (pt.orientation === facetmanagement_2.OrientationEnum.Top) {
                    // check rotate to left
                    if (((pt.x - 1 >= 0
                        && facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id)
                        || pt.x - 1 < 0)
                        && !xWall.get(pt.x, pt.y)) {
                        // can place left | wall at x,y
                        if (debug) {
                            console.log("can place left | wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rotate to right
                    if (((pt.x + 1 < facetResult.width
                        && facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id)
                        || pt.x + 1 >= facetResult.width)
                        && !xWall.get(pt.x + 1, pt.y)) {
                        // can place right | wall at x,y
                        if (debug) {
                            console.log("can place right | wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check leftwards
                    if (pt.x - 1 >= 0
                        && facetResult.facetMap.get(pt.x - 1, pt.y) === f.id
                        && (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y - 1) !== f.id)
                        && borderMask.get(pt.x - 1, pt.y)
                        && !yWall.get(pt.x - 1, pt.y)) {
                        // can place top _ wall at x-1,y
                        if (debug) {
                            console.log(`can place top _ wall at x-1,y`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rightwards
                    if (pt.x + 1 < facetResult.width
                        && facetResult.facetMap.get(pt.x + 1, pt.y) === f.id
                        && (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x + 1, pt.y - 1) !== f.id)
                        && borderMask.get(pt.x + 1, pt.y)
                        && !yWall.get(pt.x + 1, pt.y)) {
                        // can place top _ wall at x+1,y
                        if (debug) {
                            console.log(`can place top _ wall at x+1,y`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                    // check left upwards
                    if (pt.y - 1 >= 0 && pt.x - 1 >= 0 // there is a left upwards
                        && facetResult.facetMap.get(pt.x - 1, pt.y - 1) === f.id // and it belongs to the same facet
                        && borderMask.get(pt.x - 1, pt.y - 1) // and it's part of the border
                        && !xWall.get(pt.x - 1 + 1, pt.y - 1) // the right wall isn't set yet
                        && !xWall.get(pt.x, pt.y) // and the left wall of the current point isn't set yet to prevent |- path
                    ) {
                        // can place right | wall at x-1,y-1
                        if (debug) {
                            console.log("can place right | wall at x-1,y-1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y - 1), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check right upwards
                    if (pt.y - 1 >= 0 && pt.x + 1 < facetResult.width // there is a right upwards
                        && facetResult.facetMap.get(pt.x + 1, pt.y - 1) === f.id // and it belongs to the same facet
                        && borderMask.get(pt.x + 1, pt.y - 1) // and it's on the border
                        && !xWall.get(pt.x + 1, pt.y - 1) // and the left wall isn't set yet
                        && !xWall.get(pt.x + 1, pt.y) // and the right wall of the current point isn't set yet to prevent -| path
                    ) {
                        // can place left |  wall at x+1,y-1
                        if (debug) {
                            console.log("can place left |  wall at x+1,y-1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y - 1), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                }
                else if (pt.orientation === facetmanagement_2.OrientationEnum.Right) {
                    // check rotate to top
                    if (((pt.y - 1 >= 0
                        && facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id)
                        || pt.y - 1 < 0)
                        && !yWall.get(pt.x, pt.y)) {
                        // can place top _ wall at x,y
                        if (debug) {
                            console.log("can place top _ wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rotate to bottom
                    if (((pt.y + 1 < facetResult.height
                        && facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id)
                        || pt.y + 1 >= facetResult.height)
                        && !yWall.get(pt.x, pt.y + 1)) {
                        // can place bottom  _ wall at x,y
                        if (debug) {
                            console.log("can place bottom _ wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check upwards
                    if (pt.y - 1 >= 0
                        && facetResult.facetMap.get(pt.x, pt.y - 1) === f.id
                        && (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y - 1) !== f.id)
                        && borderMask.get(pt.x, pt.y - 1)
                        && !xWall.get(pt.x + 1, pt.y - 1)) {
                        // can place right | wall at x,y-1
                        if (debug) {
                            console.log(`can place right | wall at x,y-1`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y - 1), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check downwards
                    if (pt.y + 1 < facetResult.height
                        && facetResult.facetMap.get(pt.x, pt.y + 1) === f.id
                        && (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y + 1) !== f.id)
                        && borderMask.get(pt.x, pt.y + 1)
                        && !xWall.get(pt.x + 1, pt.y + 1)) {
                        // can place right | wall at x,y+1
                        if (debug) {
                            console.log("can place right | wall at x,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y + 1), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check right upwards
                    if (pt.y - 1 >= 0 && pt.x + 1 < facetResult.width // there is a right upwards
                        && facetResult.facetMap.get(pt.x + 1, pt.y - 1) === f.id // and belongs to the same facet
                        && borderMask.get(pt.x + 1, pt.y - 1) // and is on the border
                        && !yWall.get(pt.x + 1, pt.y - 1 + 1) // and the bottom wall isn't set yet
                        && !yWall.get(pt.x, pt.y) // and the top wall of the current point isn't set to prevent a T shape
                    ) {
                        // can place bottom _ wall at x+1,y-1
                        if (debug) {
                            console.log("can place bottom _ wall at x+1,y-1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y - 1), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check right downwards
                    if (pt.y + 1 < facetResult.height && pt.x + 1 < facetResult.width // there is a right downwards
                        && facetResult.facetMap.get(pt.x + 1, pt.y + 1) === f.id // and belongs to the same facet
                        && borderMask.get(pt.x + 1, pt.y + 1) // and is on the border
                        && !yWall.get(pt.x + 1, pt.y + 1) // and the top wall isn't visited yet
                        && !yWall.get(pt.x, pt.y + 1) // and the bottom wall of the current point isn't set to prevent a T shape
                    ) {
                        // can place top _ wall at x+1,y+1
                        if (debug) {
                            console.log("can place top _ wall at x+1,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y + 1), facetmanagement_2.OrientationEnum.Top);
                        possibleNextPoints.push(nextpt);
                    }
                }
                else if (pt.orientation === facetmanagement_2.OrientationEnum.Bottom) {
                    // check rotate to left
                    if (((pt.x - 1 >= 0
                        && facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id)
                        || pt.x - 1 < 0)
                        && !xWall.get(pt.x, pt.y)) {
                        // can place left | wall at x,y
                        if (debug) {
                            console.log("can place left | wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rotate to right
                    if (((pt.x + 1 < facetResult.width
                        && facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id)
                        || pt.x + 1 >= facetResult.width)
                        && !xWall.get(pt.x + 1, pt.y)) {
                        // can place right | wall at x,y
                        if (debug) {
                            console.log("can place right | wall at x,y");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x, pt.y), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check leftwards
                    if (pt.x - 1 >= 0
                        && facetResult.facetMap.get(pt.x - 1, pt.y) === f.id
                        && (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x - 1, pt.y + 1) !== f.id)
                        && borderMask.get(pt.x - 1, pt.y)
                        && !yWall.get(pt.x - 1, pt.y + 1)) {
                        // can place bottom _ wall at x-1,y
                        if (debug) {
                            console.log(`can place bottom _ wall at x-1,y`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check rightwards
                    if (pt.x + 1 < facetResult.width
                        && facetResult.facetMap.get(pt.x + 1, pt.y) === f.id
                        && (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x + 1, pt.y + 1) !== f.id)
                        && borderMask.get(pt.x + 1, pt.y)
                        && !yWall.get(pt.x + 1, pt.y + 1)) {
                        // can place top _ wall at x+1,y
                        if (debug) {
                            console.log(`can place bottom _ wall at x+1,y`);
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y), facetmanagement_2.OrientationEnum.Bottom);
                        possibleNextPoints.push(nextpt);
                    }
                    // check left downwards
                    if (pt.y + 1 < facetResult.height && pt.x - 1 >= 0 // there is a left downwards
                        && facetResult.facetMap.get(pt.x - 1, pt.y + 1) === f.id // and it's the same facet
                        && borderMask.get(pt.x - 1, pt.y + 1) // and it's on the border
                        && !xWall.get(pt.x - 1 + 1, pt.y + 1) // and the right wall isn't set yet
                        && !xWall.get(pt.x, pt.y) // and the left wall of the current point isn't set yet to prevent |- path
                    ) {
                        // can place right | wall at x-1,y-1
                        if (debug) {
                            console.log("can place right | wall at x-1,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x - 1, pt.y + 1), facetmanagement_2.OrientationEnum.Right);
                        possibleNextPoints.push(nextpt);
                    }
                    // check right downwards
                    if (pt.y + 1 < facetResult.height && pt.x + 1 < facetResult.width // there is a right downwards
                        && facetResult.facetMap.get(pt.x + 1, pt.y + 1) === f.id // and it's the same facet
                        && borderMask.get(pt.x + 1, pt.y + 1) // and it's on the border
                        && !xWall.get(pt.x + 1, pt.y + 1) // and the left wall isn't set yet
                        && !xWall.get(pt.x + 1, pt.y) // and the right wall of the current point isn't set yet to prevent -| path
                    ) {
                        // can place left |  wall at x+1,y+1
                        if (debug) {
                            console.log("can place left |  wall at x+1,y+1");
                        }
                        const nextpt = new facetmanagement_2.PathPoint(new point_3.Point(pt.x + 1, pt.y + 1), facetmanagement_2.OrientationEnum.Left);
                        possibleNextPoints.push(nextpt);
                    }
                }
                if (possibleNextPoints.length > 1) {
                    // TODO it's now not necessary anymore to aggregate all possibilities, the first one is going to be the correct
                    // selection to trace the entire border, so the if checks above can include a skip once ssible point is found again
                    pt = possibleNextPoints[0];
                    FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
                }
                else if (possibleNextPoints.length === 1) {
                    pt = possibleNextPoints[0];
                    FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
                }
                else {
                    finished = true;
                }
            }
            // clear up the walls set for the path so the array can be reused
            for (const pathPoint of path) {
                switch (pathPoint.orientation) {
                    case facetmanagement_2.OrientationEnum.Left:
                        xWall.set(pathPoint.x, pathPoint.y, false);
                        break;
                    case facetmanagement_2.OrientationEnum.Top:
                        yWall.set(pathPoint.x, pathPoint.y, false);
                        break;
                    case facetmanagement_2.OrientationEnum.Right:
                        xWall.set(pathPoint.x + 1, pathPoint.y, false);
                        break;
                    case facetmanagement_2.OrientationEnum.Bottom:
                        yWall.set(pathPoint.x, pathPoint.y + 1, false);
                        break;
                }
            }
            return path;
        }
        /**
         * Add a point to the border path and ensure the correct xWall/yWalls is set
         */
        static addPointToPath(path, pt, xWall, f, yWall) {
            path.push(pt);
            switch (pt.orientation) {
                case facetmanagement_2.OrientationEnum.Left:
                    xWall.set(pt.x, pt.y, true);
                    break;
                case facetmanagement_2.OrientationEnum.Top:
                    yWall.set(pt.x, pt.y, true);
                    break;
                case facetmanagement_2.OrientationEnum.Right:
                    xWall.set(pt.x + 1, pt.y, true);
                    break;
                case facetmanagement_2.OrientationEnum.Bottom:
                    yWall.set(pt.x, pt.y + 1, true);
                    break;
            }
        }
    }
    exports.FacetBorderTracer = FacetBorderTracer;
});
// Faster flood fill from
// http://www.adammil.net/blog/v126_A_More_Efficient_Flood_Fill.html
define("lib/fill", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fill = fill;
    function fill(x, y, width, height, visited, setFill) {
        // at this point, we know array[y,x] is clear, and we want to move as far as possible to the upper-left. moving
        // up is much more important than moving left, so we could try to make this smarter by sometimes moving to
        // the right if doing so would allow us to move further up, but it doesn't seem worth the complexit
        let xx = x;
        let yy = y;
        while (true) {
            const ox = xx;
            const oy = yy;
            while (yy !== 0 && !visited(xx, yy - 1)) {
                yy--;
            }
            while (xx !== 0 && !visited(xx - 1, yy)) {
                xx--;
            }
            if (xx === ox && yy === oy) {
                break;
            }
        }
        fillCore(xx, yy, width, height, visited, setFill);
    }
    function fillCore(x, y, width, height, visited, setFill) {
        // at this point, we know that array[y,x] is clear, and array[y-1,x] and array[y,x-1] are set.
        // we'll begin scanning down and to the right, attempting to fill an entire rectangular block
        let lastRowLength = 0; // the number of cells that were clear in the last row we scanned
        do {
            let rowLength = 0;
            let sx = x; // keep track of how long this row is. sx is the starting x for the main scan below
            // now we want to handle a case like |***|, where we fill 3 cells in the first row and then after we move to
            // the second row we find the first  | **| cell is filled, ending our rectangular scan. rather than handling
            // this via the recursion below, we'll increase the starting value of 'x' and reduce the last row length to
            // match. then we'll continue trying to set the narrower rectangular block
            if (lastRowLength !== 0 && visited(x, y)) {
                do {
                    if (--lastRowLength === 0) {
                        return;
                    } // shorten the row. if it's full, we're done
                } while (visited(++x, y)); // otherwise, update the starting point of the main scan to match
                sx = x;
            }
            else {
                for (; x !== 0 && !visited(x - 1, y); rowLength++, lastRowLength++) {
                    x--;
                    setFill(x, y); // to avoid scanning the cells twice, we'll fill them and update rowLength here
                    // if there's something above the new starting point, handle that recursively. this deals with cases
                    // like |* **| when we begin filling from (2,0), move down to (2,1), and then move left to (0,1).
                    // the  |****| main scan assumes the portion of the previous row from x to x+lastRowLength has already
                    // been filled. adjusting x and lastRowLength breaks that assumption in this case, so we must fix it
                    if (y !== 0 && !visited(x, y - 1)) {
                        fill(x, y - 1, width, height, visited, setFill);
                    } // use _Fill since there may be more up and left
                }
            }
            // now at this point we can begin to scan the current row in the rectangular block. the span of the previous
            // row from x (inclusive) to x+lastRowLength (exclusive) has already been filled, so we don't need to
            // check it. so scan across to the right in the current row
            for (; sx < width && !visited(sx, y); rowLength++, sx++) {
                setFill(sx, y);
            }
            // now we've scanned this row. if the block is rectangular, then the previous row has already been scanned,
            // so we don't need to look upwards and we're going to scan the next row in the next iteration so we don't
            // need to look downwards. however, if the block is not rectangular, we may need to look upwards or rightwards
            // for some portion of the row. if this row was shorter than the last row, we may need to look rightwards near
            // the end, as in the case of |*****|, where the first row is 5 cells long and the second row is 3 cells long.
            // we must look to the right  |*** *| of the single cell at the end of the second row, i.e. at (4,1)
            if (rowLength < lastRowLength) {
                for (const end = x + lastRowLength; ++sx < end;) { // there. any clear cells would have been connected to the previous
                    if (!visited(sx, y)) {
                        fillCore(sx, y, width, height, visited, setFill);
                    } // row. the cells up and left must be set so use FillCore
                }
            }
            else if (rowLength > lastRowLength && y !== 0) {
                for (let ux = x + lastRowLength; ++ux < sx;) {
                    if (!visited(ux, y - 1)) {
                        fill(ux, y - 1, width, height, visited, setFill);
                    } // since there may be clear cells up and left, use _Fill
                }
            }
            lastRowLength = rowLength; // record the new row length
        } while (lastRowLength !== 0 && ++y < height); // if we get to a full row or to the bottom, we're done
    }
});
define("facetReducer", ["require", "exports", "colorreductionmanagement", "common", "facetCreator", "structs/typedarrays"], function (require, exports, colorreductionmanagement_1, common_4, facetCreator_1, typedarrays_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetReducer = void 0;
    class FacetReducer {
        /**
         *  Remove all facets that have a pointCount smaller than the given number.
         */
        static reduceFacets(smallerThan_1, removeFacetsFromLargeToSmall_1, maximumNumberOfFacets_1, colorsByIndex_1, facetResult_1, imgColorIndices_1) {
            return __awaiter(this, arguments, void 0, function* (smallerThan, removeFacetsFromLargeToSmall, maximumNumberOfFacets, colorsByIndex, facetResult, imgColorIndices, onUpdate = null) {
                const visitedCache = new typedarrays_3.BooleanArray2D(facetResult.width, facetResult.height);
                // build the color distance matrix, which describes the distance of each color to each other
                const colorDistances = colorreductionmanagement_1.ColorReducer.buildColorDistanceMatrix(colorsByIndex);
                // process facets from large to small. This results in better consistency with the original image
                // because the small facets act as boundary for the large merges keeping them mostly in place of where they should remain
                // then afterwards the smaller ones are deleted which will just end up completely isolated and thus entirely replaced
                // with the outer facet. But then again, what do I know, I'm just a comment.
                const facetProcessingOrder = facetResult.facets.filter((f) => f != null).slice(0).sort((a, b) => b.pointCount > a.pointCount ? 1 : (b.pointCount < a.pointCount ? -1 : 0)).map((f) => f.id);
                if (!removeFacetsFromLargeToSmall) {
                    facetProcessingOrder.reverse();
                }
                let curTime = new Date().getTime();
                for (let fidx = 0; fidx < facetProcessingOrder.length; fidx++) {
                    const f = facetResult.facets[facetProcessingOrder[fidx]];
                    // facets can be removed by merging by others due to a previous facet deletion
                    if (f != null && f.pointCount < smallerThan) {
                        FacetReducer.deleteFacet(f.id, facetResult, imgColorIndices, colorDistances, visitedCache);
                        if (new Date().getTime() - curTime > 500) {
                            curTime = new Date().getTime();
                            yield (0, common_4.delay)(0);
                            if (onUpdate != null) {
                                onUpdate(0.5 * fidx / facetProcessingOrder.length);
                            }
                        }
                    }
                }
                let facetCount = facetResult.facets.filter(f => f != null).length;
                if (facetCount > maximumNumberOfFacets) {
                    console.log(`There are still ${facetCount} facets, more than the maximum of ${maximumNumberOfFacets}. Removing the smallest facets`);
                }
                const startFacetCount = facetCount;
                while (facetCount > maximumNumberOfFacets) {
                    // because facets can be merged, reevaluate the order of facets to make sure the smallest one is removed 
                    // this is slower but more accurate
                    const facetProcessingOrder = facetResult.facets.filter((f) => f != null).slice(0)
                        .sort((a, b) => b.pointCount > a.pointCount ? 1 : (b.pointCount < a.pointCount ? -1 : 0))
                        .map((f) => f.id)
                        .reverse();
                    const facetToRemove = facetResult.facets[facetProcessingOrder[0]];
                    FacetReducer.deleteFacet(facetToRemove.id, facetResult, imgColorIndices, colorDistances, visitedCache);
                    facetCount = facetResult.facets.filter(f => f != null).length;
                    if (new Date().getTime() - curTime > 500) {
                        curTime = new Date().getTime();
                        yield (0, common_4.delay)(0);
                        if (onUpdate != null) {
                            onUpdate(0.5 + 0.5 - (facetCount - maximumNumberOfFacets) / (startFacetCount - maximumNumberOfFacets));
                        }
                    }
                }
                // this.trimFacets(facetResult, imgColorIndices, colorDistances, visitedCache);
                if (onUpdate != null) {
                    onUpdate(1);
                }
            });
        }
        // /**
        //  * Trims facets with narrow paths either horizontally or vertically, potentially splitting the facet into multiple facets
        //  */
        // public static trimFacets(facetResult: FacetResult, imgColorIndices: Uint8Array2D, colorDistances: number[][], visitedArrayCache: BooleanArray2D) {
        //     for (const facet of facetResult.facets) {
        //         if (facet !== null) {
        //             const facetPointsToReallocate: Point[] = [];
        //             for (let y: number = facet.bbox.minY; y <= facet.bbox.maxY; y++) {
        //                 for (let x: number = facet.bbox.minX; x <= facet.bbox.maxX; x++) {
        //                     if (x > 0 && y > 0 && x < facetResult.width - 1 && y < facetResult.height - 1 &&
        //                         facetResult.facetMap.get(x, y) === facet.id) {
        //                         // check if isolated horizontally
        //                         const top = facetResult.facetMap.get(x, y - 1);
        //                         const bottom = facetResult.facetMap.get(x, y + 1);
        //                         if (top !== facet.id && bottom !== facet.id) {
        //                             // . ? .
        //                             // . F .
        //                             // . ? .
        //                             // mark pixel of facet that it should be removed
        //                             facetPointsToReallocate.push(new Point(x, y));
        //                             const closestNeighbour = FacetReducer.getClosestNeighbourForPixel(facet, facetResult, x, y, colorDistances);
        //                             // copy over color of closest neighbour
        //                             imgColorIndices.set(x, y, facetResult.facets[closestNeighbour]!.color);
        //                             console.log("Flagged " + x + "," + y + " to trim");
        //                         }
        //                     }
        //                 }
        //             }
        //             if (facetPointsToReallocate.length > 0) {
        //                 FacetReducer.rebuildForFacetChange(visitedArrayCache, facet, imgColorIndices, facetResult);
        //             }
        //         }
        //     }
        // }
        /**
         * Deletes a facet. All points belonging to the facet are moved to the nearest neighbour facet
         * based on the distance of the neighbour border points. This results in a voronoi like filling in of the
         * void the deletion made
         */
        static deleteFacet(facetIdToRemove, facetResult, imgColorIndices, colorDistances, visitedArrayCache) {
            const facetToRemove = facetResult.facets[facetIdToRemove];
            if (facetToRemove === null) { // already removed
                return;
            }
            if (facetToRemove.neighbourFacetsIsDirty) {
                facetCreator_1.FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
            }
            if (facetToRemove.neighbourFacets.length > 0) {
                // there are many small facets, it's faster to just iterate over all points within its bounding box
                // and seeing which belong to the facet than to keep track of the inner points (along with the border points)
                // per facet, because that generates a lot of extra heap objects that need to be garbage collected each time
                // a facet is rebuilt
                for (let j = facetToRemove.bbox.minY; j <= facetToRemove.bbox.maxY; j++) {
                    for (let i = facetToRemove.bbox.minX; i <= facetToRemove.bbox.maxX; i++) {
                        if (facetResult.facetMap.get(i, j) === facetToRemove.id) {
                            const closestNeighbour = FacetReducer.getClosestNeighbourForPixel(facetToRemove, facetResult, i, j, colorDistances);
                            if (closestNeighbour !== -1) {
                                // copy over color of closest neighbour
                                imgColorIndices.set(i, j, facetResult.facets[closestNeighbour].color);
                            }
                            else {
                                console.warn(`No closest neighbour found for point ${i},${j}`);
                            }
                        }
                    }
                }
            }
            else {
                console.warn(`Facet ${facetToRemove.id} does not have any neighbours`);
            }
            // Rebuild all the neighbour facets that have been changed. While it could probably be faster by just adding the points manually
            // to the facet map and determine if the border points are still valid, it's more complex than that. It's possible that due to the change in points
            // that 2 neighbours of the same colors have become linked and need to merged as well. So it's easier to just rebuild the entire facet
            FacetReducer.rebuildForFacetChange(visitedArrayCache, facetToRemove, imgColorIndices, facetResult);
            // now mark the facet to remove as deleted
            facetResult.facets[facetToRemove.id] = null;
        }
        static rebuildForFacetChange(visitedArrayCache, facet, imgColorIndices, facetResult) {
            FacetReducer.rebuildChangedNeighbourFacets(visitedArrayCache, facet, imgColorIndices, facetResult);
            // sanity check: make sure that all points have been replaced by neighbour facets. It's possible that some points will have
            // been left out because there is no continuity with the neighbour points
            // this occurs for diagonal points to the neighbours and more often when the closest
            // color is chosen when distances are equal.
            // It's probably possible to enforce that this will never happen in the above code but
            // this is a constraint that is expensive to enforce and doesn't happen all that much
            // so instead try and merge if with any of its direct neighbours if possible
            let needsToRebuild = false;
            for (let y = facet.bbox.minY; y <= facet.bbox.maxY; y++) {
                for (let x = facet.bbox.minX; x <= facet.bbox.maxX; x++) {
                    if (facetResult.facetMap.get(x, y) === facet.id) {
                        console.warn(`Point ${x},${y} was reallocated to neighbours for facet ${facet.id}`);
                        needsToRebuild = true;
                        if (x - 1 >= 0 && facetResult.facetMap.get(x - 1, y) !== facet.id && facetResult.facets[facetResult.facetMap.get(x - 1, y)] !== null) {
                            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x - 1, y)].color);
                        }
                        else if (y - 1 >= 0 && facetResult.facetMap.get(x, y - 1) !== facet.id && facetResult.facets[facetResult.facetMap.get(x, y - 1)] !== null) {
                            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x, y - 1)].color);
                        }
                        else if (x + 1 < facetResult.width && facetResult.facetMap.get(x + 1, y) !== facet.id && facetResult.facets[facetResult.facetMap.get(x + 1, y)] !== null) {
                            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x + 1, y)].color);
                        }
                        else if (y + 1 < facetResult.height && facetResult.facetMap.get(x, y + 1) !== facet.id && facetResult.facets[facetResult.facetMap.get(x, y + 1)] !== null) {
                            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x, y + 1)].color);
                        }
                        else {
                            console.error(`Unable to reallocate point ${x},${y}`);
                        }
                    }
                }
            }
            // now we need to go through the thing again to build facets and update the neighbours
            if (needsToRebuild) {
                FacetReducer.rebuildChangedNeighbourFacets(visitedArrayCache, facet, imgColorIndices, facetResult);
            }
        }
        /**
         * Determines the closest neighbour for a given pixel of a facet, based on the closest distance to the neighbour AND the when tied, the closest color
         */
        static getClosestNeighbourForPixel(facetToRemove, facetResult, x, y, colorDistances) {
            let closestNeighbour = -1;
            let minDistance = Number.MAX_VALUE;
            let minColorDistance = Number.MAX_VALUE;
            // ensure the neighbour facets is up to date if it was marked as dirty
            if (facetToRemove.neighbourFacetsIsDirty) {
                facetCreator_1.FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
            }
            // determine which neighbour will receive the current point based on the distance, and if there are more with the same
            // distance, then take the neighbour with the closes color
            for (const neighbourIdx of facetToRemove.neighbourFacets) {
                const neighbour = facetResult.facets[neighbourIdx];
                if (neighbour != null) {
                    for (const bpt of neighbour.borderPoints) {
                        const distance = bpt.distanceToCoord(x, y);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestNeighbour = neighbourIdx;
                            minColorDistance = Number.MAX_VALUE; // reset color distance
                        }
                        else if (distance === minDistance) {
                            // if the distance is equal as the min distance
                            // then see if the neighbour's color is closer to the current color
                            // note: this causes morepoints to be reallocated to different neighbours
                            // in the sanity check later, but still yields a better visual result
                            const colorDistance = colorDistances[facetToRemove.color][neighbour.color];
                            if (colorDistance < minColorDistance) {
                                minColorDistance = colorDistance;
                                closestNeighbour = neighbourIdx;
                            }
                        }
                    }
                }
            }
            return closestNeighbour;
        }
        /**
         *  Rebuilds the given changed facets
         */
        static rebuildChangedNeighbourFacets(visitedArrayCache, facetToRemove, imgColorIndices, facetResult) {
            const changedNeighboursSet = {};
            if (facetToRemove.neighbourFacetsIsDirty) {
                facetCreator_1.FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
            }
            for (const neighbourIdx of facetToRemove.neighbourFacets) {
                const neighbour = facetResult.facets[neighbourIdx];
                if (neighbour != null) {
                    // re-evaluate facet
                    // track all the facets that needs to have their neighbour list updated, which is also going to be all the neighbours of the neighbours that are being updated
                    changedNeighboursSet[neighbourIdx] = true;
                    if (neighbour.neighbourFacetsIsDirty) {
                        facetCreator_1.FacetCreator.buildFacetNeighbour(neighbour, facetResult);
                    }
                    for (const n of neighbour.neighbourFacets) {
                        changedNeighboursSet[n] = true;
                    }
                    // rebuild the neighbour facet
                    const newFacet = facetCreator_1.FacetCreator.buildFacet(neighbourIdx, neighbour.color, neighbour.borderPoints[0].x, neighbour.borderPoints[0].y, visitedArrayCache, imgColorIndices, facetResult);
                    facetResult.facets[neighbourIdx] = newFacet;
                    // it's possible that any of the neighbour facets are now overlapping
                    // because if for example facet Red - Green - Red, Green is removed
                    // then it will become Red - Red and both facets will overlap
                    // this means the facet will have 0 points remaining
                    if (newFacet.pointCount === 0) {
                        // remove the empty facet as well
                        facetResult.facets[neighbourIdx] = null;
                    }
                }
            }
            // reset the visited array for all neighbours
            // while the visited array could be recreated per facet to remove, it's quite big and introduces
            // a lot of allocation / cleanup overhead. Due to the size of the facets it's usually faster
            // to just flag every point of the facet as false again
            if (facetToRemove.neighbourFacetsIsDirty) {
                facetCreator_1.FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
            }
            for (const neighbourIdx of facetToRemove.neighbourFacets) {
                const neighbour = facetResult.facets[neighbourIdx];
                if (neighbour != null) {
                    for (let y = neighbour.bbox.minY; y <= neighbour.bbox.maxY; y++) {
                        for (let x = neighbour.bbox.minX; x <= neighbour.bbox.maxX; x++) {
                            if (facetResult.facetMap.get(x, y) === neighbour.id) {
                                visitedArrayCache.set(x, y, false);
                            }
                        }
                    }
                }
            }
            // rebuild neighbour array for affected neighbours
            for (const k of Object.keys(changedNeighboursSet)) {
                if (changedNeighboursSet.hasOwnProperty(k)) {
                    const neighbourIdx = parseInt(k);
                    const f = facetResult.facets[neighbourIdx];
                    if (f != null) {
                        // it's a lot faster when deferring the neighbour array updates
                        // because a lot of facets that are deleted share the same facet neighbours
                        // and removing the unnecessary neighbour array checks until they it's needed
                        // speeds things up significantly
                        // FacetCreator.buildFacetNeighbour(f, facetResult);
                        f.neighbourFacets = null;
                        f.neighbourFacetsIsDirty = true;
                    }
                }
            }
        }
    }
    exports.FacetReducer = FacetReducer;
});
define("facetCreator", ["require", "exports", "common", "lib/fill", "structs/boundingbox", "structs/point", "structs/typedarrays", "facetmanagement"], function (require, exports, common_5, fill_1, boundingbox_1, point_4, typedarrays_4, facetmanagement_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetCreator = void 0;
    class FacetCreator {
        /**
         *  Constructs the facets with its border points for each area of pixels of the same color
         */
        static getFacets(width_1, height_1, imgColorIndices_1) {
            return __awaiter(this, arguments, void 0, function* (width, height, imgColorIndices, onUpdate = null) {
                const result = new facetmanagement_3.FacetResult();
                result.width = width;
                result.height = height;
                // setup visited mask
                const visited = new typedarrays_4.BooleanArray2D(result.width, result.height);
                // setup facet map & array
                result.facetMap = new typedarrays_4.Uint32Array2D(result.width, result.height);
                result.facets = [];
                // depth first traversal to find the different facets
                let count = 0;
                for (let j = 0; j < result.height; j++) {
                    for (let i = 0; i < result.width; i++) {
                        const colorIndex = imgColorIndices.get(i, j);
                        if (!visited.get(i, j)) {
                            const facetIndex = result.facets.length;
                            // build a facet starting at point i,j
                            const facet = FacetCreator.buildFacet(facetIndex, colorIndex, i, j, visited, imgColorIndices, result);
                            result.facets.push(facet);
                            if (count % 100 === 0) {
                                yield (0, common_5.delay)(0);
                                if (onUpdate != null) {
                                    onUpdate(count / (result.width * result.height));
                                }
                            }
                        }
                        count++;
                    }
                }
                yield (0, common_5.delay)(0);
                // fill in the neighbours of all facets by checking the neighbours of the border points
                for (const f of result.facets) {
                    if (f != null) {
                        FacetCreator.buildFacetNeighbour(f, result);
                    }
                }
                if (onUpdate != null) {
                    onUpdate(1);
                }
                return result;
            });
        }
        /**
         *  Builds a facet at given x,y using depth first search to visit all pixels of the same color
         */
        static buildFacet(facetIndex, facetColorIndex, x, y, visited, imgColorIndices, facetResult) {
            const facet = new facetmanagement_3.Facet();
            facet.id = facetIndex;
            facet.color = facetColorIndex;
            facet.bbox = new boundingbox_1.BoundingBox();
            facet.borderPoints = [];
            facet.neighbourFacetsIsDirty = true; // not built neighbours yet
            facet.neighbourFacets = null;
            (0, fill_1.fill)(x, y, facetResult.width, facetResult.height, (ptx, pty) => visited.get(ptx, pty) || imgColorIndices.get(ptx, pty) !== facetColorIndex, (ptx, pty) => {
                visited.set(ptx, pty, true);
                facetResult.facetMap.set(ptx, pty, facetIndex);
                facet.pointCount++;
                // determine if the point is a border or not
                /*  const isInnerPoint = (ptx - 1 >= 0 && imgColorIndices.get(ptx - 1, pty) === facetColorIndex) &&
                      (pty - 1 >= 0 && imgColorIndices.get(ptx, pty - 1) === facetColorIndex) &&
                      (ptx + 1 < facetResult.width && imgColorIndices.get(ptx + 1, pty) === facetColorIndex) &&
                      (pty + 1 < facetResult.height && imgColorIndices.get(ptx, pty + 1) === facetColorIndex);
                */
                const isInnerPoint = imgColorIndices.matchAllAround(ptx, pty, facetColorIndex);
                if (!isInnerPoint) {
                    facet.borderPoints.push(new point_4.Point(ptx, pty));
                }
                // update bounding box of facet
                if (ptx > facet.bbox.maxX) {
                    facet.bbox.maxX = ptx;
                }
                if (pty > facet.bbox.maxY) {
                    facet.bbox.maxY = pty;
                }
                if (ptx < facet.bbox.minX) {
                    facet.bbox.minX = ptx;
                }
                if (pty < facet.bbox.minY) {
                    facet.bbox.minY = pty;
                }
            });
            /*
               // using a 1D flattened stack (x*width+y), we can avoid heap allocations of Point objects, which halves the garbage collection time
             let stack: number[] = [];
             stack.push(y * facetResult.width + x);
    
             while (stack.length > 0) {
                 let pt = stack.pop()!;
                 let ptx = pt % facetResult.width;
                 let pty = Math.floor(pt / facetResult.width);
    
                 // if the point wasn't visited before and matches
                 // the same color
                 if (!visited.get(ptx, pty) &&
                     imgColorIndices.get(ptx, pty) == facetColorIndex) {
    
                     visited.set(ptx, pty, true);
                     facetResult.facetMap.set(ptx, pty, facetIndex);
                     facet.pointCount++;
    
                     // determine if the point is a border or not
                     let isInnerPoint = (ptx - 1 >= 0 && imgColorIndices.get(ptx - 1, pty) == facetColorIndex) &&
                         (pty - 1 >= 0 && imgColorIndices.get(ptx, pty - 1) == facetColorIndex) &&
                         (ptx + 1 < facetResult.width && imgColorIndices.get(ptx + 1, pty) == facetColorIndex) &&
                         (pty + 1 < facetResult.height && imgColorIndices.get(ptx, pty + 1) == facetColorIndex);
    
                     if (!isInnerPoint)
                         facet.borderPoints.push(new Point(ptx, pty));
    
                     // update bounding box of facet
                     if (ptx > facet.bbox.maxX) facet.bbox.maxX = ptx;
                     if (pty > facet.bbox.maxY) facet.bbox.maxY = pty;
                     if (ptx < facet.bbox.minX) facet.bbox.minX = ptx;
                     if (pty < facet.bbox.minY) facet.bbox.minY = pty;
    
                     // visit direct adjacent points
                     if (ptx - 1 >= 0 && !visited.get(ptx - 1, pty))
                         stack.push(pty * facetResult.width + (ptx - 1)); //stack.push(new Point(pt.x - 1, pt.y));
                     if (pty - 1 >= 0 && !visited.get(ptx, pty - 1))
                         stack.push((pty - 1) * facetResult.width + ptx); //stack.push(new Point(pt.x, pt.y - 1));
                     if (ptx + 1 < facetResult.width && !visited.get(ptx + 1, pty))
                         stack.push(pty * facetResult.width + (ptx + 1));//stack.push(new Point(pt.x + 1, pt.y));
                     if (pty + 1 < facetResult.height && !visited.get(ptx, pty + 1))
                         stack.push((pty + 1) * facetResult.width + ptx); //stack.push(new Point(pt.x, pt.y + 1));
                 }
             }
             */
            return facet;
        }
        /**
         * Check which neighbour facets the given facet has by checking the neighbour facets at each border point
         */
        static buildFacetNeighbour(facet, facetResult) {
            facet.neighbourFacets = [];
            const uniqueFacets = {}; // poor man's set
            for (const pt of facet.borderPoints) {
                if (pt.x - 1 >= 0) {
                    const leftFacetId = facetResult.facetMap.get(pt.x - 1, pt.y);
                    if (leftFacetId !== facet.id) {
                        uniqueFacets[leftFacetId] = true;
                    }
                }
                if (pt.y - 1 >= 0) {
                    const topFacetId = facetResult.facetMap.get(pt.x, pt.y - 1);
                    if (topFacetId !== facet.id) {
                        uniqueFacets[topFacetId] = true;
                    }
                }
                if (pt.x + 1 < facetResult.width) {
                    const rightFacetId = facetResult.facetMap.get(pt.x + 1, pt.y);
                    if (rightFacetId !== facet.id) {
                        uniqueFacets[rightFacetId] = true;
                    }
                }
                if (pt.y + 1 < facetResult.height) {
                    const bottomFacetId = facetResult.facetMap.get(pt.x, pt.y + 1);
                    if (bottomFacetId !== facet.id) {
                        uniqueFacets[bottomFacetId] = true;
                    }
                }
            }
            for (const k of Object.keys(uniqueFacets)) {
                if (uniqueFacets.hasOwnProperty(k)) {
                    facet.neighbourFacets.push(parseInt(k));
                }
            }
            // the neighbour array is updated so it's not dirty anymore
            facet.neighbourFacetsIsDirty = false;
        }
    }
    exports.FacetCreator = FacetCreator;
});
define("lib/datastructs", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PriorityQueue = exports.Map = void 0;
    class Map {
        constructor() {
            this.obj = {};
        }
        containsKey(key) {
            return key in this.obj;
        }
        getKeys() {
            const keys = [];
            for (const el in this.obj) {
                if (this.obj.hasOwnProperty(el)) {
                    keys.push(el);
                }
            }
            return keys;
        }
        get(key) {
            const o = this.obj[key];
            if (typeof o === "undefined") {
                return null;
            }
            else {
                return o;
            }
        }
        put(key, value) {
            this.obj[key] = value;
        }
        remove(key) {
            delete this.obj[key];
        }
        clone() {
            const m = new Map();
            m.obj = {};
            for (const p in this.obj) {
                m.obj[p] = this.obj[p];
            }
            return m;
        }
    }
    exports.Map = Map;
    class Heap {
        constructor() {
            this.array = [];
            this.keyMap = new Map();
        }
        add(obj) {
            if (this.keyMap.containsKey(obj.getKey())) {
                throw new Error("Item with key " + obj.getKey() + " already exists in the heap");
            }
            this.array.push(obj);
            this.keyMap.put(obj.getKey(), this.array.length - 1);
            this.checkParentRequirement(this.array.length - 1);
        }
        replaceAt(idx, newobj) {
            this.array[idx] = newobj;
            this.keyMap.put(newobj.getKey(), idx);
            this.checkParentRequirement(idx);
            this.checkChildrenRequirement(idx);
        }
        shift() {
            return this.removeAt(0);
        }
        remove(obj) {
            const idx = this.keyMap.get(obj.getKey());
            if (idx === -1) {
                return;
            }
            this.removeAt(idx);
        }
        removeWhere(predicate) {
            const itemsToRemove = [];
            for (let i = this.array.length - 1; i >= 0; i--) {
                if (predicate(this.array[i])) {
                    itemsToRemove.push(this.array[i]);
                }
            }
            for (const el of itemsToRemove) {
                this.remove(el);
            }
            for (const el of this.array) {
                if (predicate(el)) {
                    console.log("Idx of element not removed: " + this.keyMap.get(el.getKey()));
                    throw new Error("element not removed: " + el.getKey());
                }
            }
        }
        removeAt(idx) {
            const obj = this.array[idx];
            this.keyMap.remove(obj.getKey());
            const isLastElement = idx === this.array.length - 1;
            if (this.array.length > 0) {
                const newobj = this.array.pop();
                if (!isLastElement && this.array.length > 0) {
                    this.replaceAt(idx, newobj);
                }
            }
            return obj;
        }
        foreach(func) {
            const arr = this.array.sort((e, e2) => e.compareTo(e2));
            for (const el of arr) {
                func(el);
            }
        }
        peek() {
            return this.array[0];
        }
        contains(key) {
            return this.keyMap.containsKey(key);
        }
        at(key) {
            const obj = this.keyMap.get(key);
            if (typeof obj === "undefined") {
                return null;
            }
            else {
                return this.array[obj];
            }
        }
        size() {
            return this.array.length;
        }
        checkHeapRequirement(item) {
            const idx = this.keyMap.get(item.getKey());
            if (idx != null) {
                this.checkParentRequirement(idx);
                this.checkChildrenRequirement(idx);
            }
        }
        checkChildrenRequirement(idx) {
            let stop = false;
            while (!stop) {
                const left = this.getLeftChildIndex(idx);
                let right = left === -1 ? -1 : left + 1;
                if (left === -1) {
                    return;
                }
                if (right >= this.size()) {
                    right = -1;
                }
                let minIdx;
                if (right === -1) {
                    minIdx = left;
                }
                else {
                    minIdx = (this.array[left].compareTo(this.array[right]) < 0) ? left : right;
                }
                if (this.array[idx].compareTo(this.array[minIdx]) > 0) {
                    this.swap(idx, minIdx);
                    idx = minIdx; // iteratively instead of recursion for this.checkChildrenRequirement(minIdx);
                }
                else {
                    stop = true;
                }
            }
        }
        checkParentRequirement(idx) {
            let curIdx = idx;
            let parentIdx = Heap.getParentIndex(curIdx);
            while (parentIdx >= 0 && this.array[parentIdx].compareTo(this.array[curIdx]) > 0) {
                this.swap(curIdx, parentIdx);
                curIdx = parentIdx;
                parentIdx = Heap.getParentIndex(curIdx);
            }
        }
        dump() {
            if (this.size() === 0) {
                return;
            }
            const idx = 0;
            const leftIdx = this.getLeftChildIndex(idx);
            const rightIdx = leftIdx + 1;
            console.log(this.array);
            console.log("--- keymap ---");
            console.log(this.keyMap);
        }
        swap(i, j) {
            this.keyMap.put(this.array[i].getKey(), j);
            this.keyMap.put(this.array[j].getKey(), i);
            const tmp = this.array[i];
            this.array[i] = this.array[j];
            this.array[j] = tmp;
        }
        getLeftChildIndex(curIdx) {
            const idx = ((curIdx + 1) * 2) - 1;
            if (idx >= this.array.length) {
                return -1;
            }
            else {
                return idx;
            }
        }
        static getParentIndex(curIdx) {
            if (curIdx === 0) {
                return -1;
            }
            return Math.floor((curIdx + 1) / 2) - 1;
        }
        clone() {
            const h = new Heap();
            h.array = this.array.slice(0);
            h.keyMap = this.keyMap.clone();
            return h;
        }
    }
    class PriorityQueue {
        constructor() {
            this.heap = new Heap();
        }
        enqueue(obj) {
            this.heap.add(obj);
        }
        peek() {
            return this.heap.peek();
        }
        updatePriority(key) {
            this.heap.checkHeapRequirement(key);
        }
        get(key) {
            return this.heap.at(key);
        }
        get size() {
            return this.heap.size();
        }
        dequeue() {
            return this.heap.shift();
        }
        dump() {
            this.heap.dump();
        }
        contains(key) {
            return this.heap.contains(key);
        }
        removeWhere(predicate) {
            this.heap.removeWhere(predicate);
        }
        foreach(func) {
            this.heap.foreach(func);
        }
        clone() {
            const p = new PriorityQueue();
            p.heap = this.heap.clone();
            return p;
        }
    }
    exports.PriorityQueue = PriorityQueue;
});
define("lib/polylabel", ["require", "exports", "lib/datastructs"], function (require, exports, datastructs_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.polylabel = polylabel;
    exports.pointToPolygonDist = pointToPolygonDist;
    function polylabel(polygon, precision = 1.0) {
        // find the bounding box of the outer ring
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;
        for (let i = 0; i < polygon[0].length; i++) {
            const p = polygon[0][i];
            if (p.x < minX) {
                minX = p.x;
            }
            if (p.y < minY) {
                minY = p.y;
            }
            if (p.x > maxX) {
                maxX = p.x;
            }
            if (p.y > maxY) {
                maxY = p.y;
            }
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const cellSize = Math.min(width, height);
        let h = cellSize / 2;
        // a priority queue of cells in order of their "potential" (max distance to polygon)
        const cellQueue = new datastructs_1.PriorityQueue();
        if (cellSize === 0) {
            return { pt: { x: minX, y: minY }, distance: 0 };
        }
        // cover polygon with initial cells
        for (let x = minX; x < maxX; x += cellSize) {
            for (let y = minY; y < maxY; y += cellSize) {
                cellQueue.enqueue(new Cell(x + h, y + h, h, polygon));
            }
        }
        // take centroid as the first best guess
        let bestCell = getCentroidCell(polygon);
        // special case for rectangular polygons
        const bboxCell = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
        if (bboxCell.d > bestCell.d) {
            bestCell = bboxCell;
        }
        let numProbes = cellQueue.size;
        while (cellQueue.size > 0) {
            // pick the most promising cell from the queue
            const cell = cellQueue.dequeue();
            // update the best cell if we found a better one
            if (cell.d > bestCell.d) {
                bestCell = cell;
            }
            // do not drill down further if there's no chance of a better solution
            if (cell.max - bestCell.d <= precision) {
                continue;
            }
            // split the cell into four cells
            h = cell.h / 2;
            cellQueue.enqueue(new Cell(cell.x - h, cell.y - h, h, polygon));
            cellQueue.enqueue(new Cell(cell.x + h, cell.y - h, h, polygon));
            cellQueue.enqueue(new Cell(cell.x - h, cell.y + h, h, polygon));
            cellQueue.enqueue(new Cell(cell.x + h, cell.y + h, h, polygon));
            numProbes += 4;
        }
        return { pt: { x: bestCell.x, y: bestCell.y }, distance: bestCell.d };
    }
    class Cell {
        constructor(x, y, h, polygon) {
            this.x = x;
            this.y = y;
            this.h = h;
            this.d = pointToPolygonDist(x, y, polygon);
            this.max = this.d + this.h * Math.SQRT2;
        }
        compareTo(other) {
            return other.max - this.max;
        }
        getKey() {
            return this.x + "," + this.y;
        }
    }
    // get squared distance from a point px,py to a segment [a-b]
    function getSegDistSq(px, py, a, b) {
        let x = a.x;
        let y = a.y;
        let dx = b.x - x;
        let dy = b.y - y;
        if (dx !== 0 || dy !== 0) {
            const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = b.x;
                y = b.y;
            }
            else if (t > 0) {
                x += dx * t;
                y += dy * t;
            }
        }
        dx = px - x;
        dy = py - y;
        return dx * dx + dy * dy;
    }
    /**
     * Signed distance from point to polygon outline (negative if point is outside)
     */
    function pointToPolygonDist(x, y, polygon) {
        let inside = false;
        let minDistSq = Infinity;
        for (let k = 0; k < polygon.length; k++) {
            const ring = polygon[k];
            for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
                const a = ring[i];
                const b = ring[j];
                if ((a.y > y !== b.y > y) &&
                    (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) {
                    inside = !inside;
                }
                minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b));
            }
        }
        return (inside ? 1 : -1) * Math.sqrt(minDistSq);
    }
    // get polygon centroid
    function getCentroidCell(polygon) {
        let area = 0;
        let x = 0;
        let y = 0;
        const points = polygon[0];
        for (let i = 0, len = points.length, j = len - 1; i < len; j = i++) {
            const a = points[i];
            const b = points[j];
            const f = a.x * b.y - b.x * a.y;
            x += (a.x + b.x) * f;
            y += (a.y + b.y) * f;
            area += f * 3;
        }
        if (area === 0) {
            return new Cell(points[0].x, points[0].y, 0, polygon);
        }
        return new Cell(x / area, y / area, 0, polygon);
    }
});
define("facetLabelPlacer", ["require", "exports", "common", "lib/polylabel", "structs/boundingbox", "facetCreator"], function (require, exports, common_6, polylabel_1, boundingbox_2, facetCreator_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FacetLabelPlacer = void 0;
    class FacetLabelPlacer {
        /**
         *  Determines where to place the labels for each facet. This is done by calculating where
         *  in the polygon the largest circle can be contained, also called the pole of inaccessibility
         *  That's the spot where there will be the most room for the label.
         *  One tricky gotcha: neighbour facets can lay completely inside other facets and can overlap the label
         *  if only the outer border of the facet is taken in account. This is solved by adding the neighbours facet polygon that fall
         *  within the facet as additional polygon rings (why does everything look so easy to do yet never is under the hood :/)
         */
        static buildFacetLabelBounds(facetResult_1) {
            return __awaiter(this, arguments, void 0, function* (facetResult, onUpdate = null) {
                let count = 0;
                for (const f of facetResult.facets) {
                    if (f != null) {
                        const polyRings = [];
                        // get the border path from the segments (that can have been reduced compared to facet actual border path)
                        const borderPath = f.getFullPathFromBorderSegments(true);
                        // outer path must be first ring
                        polyRings.push(borderPath);
                        const onlyOuterRing = [borderPath];
                        // now add all the neighbours of the facet as "inner" rings,
                        // regardless if they are inner or not. These are seen as areas where the label
                        // cannot be placed
                        if (f.neighbourFacetsIsDirty) {
                            facetCreator_2.FacetCreator.buildFacetNeighbour(f, facetResult);
                        }
                        for (const neighbourIdx of f.neighbourFacets) {
                            const neighbourPath = facetResult.facets[neighbourIdx].getFullPathFromBorderSegments(true);
                            const fallsInside = FacetLabelPlacer.doesNeighbourFallInsideInCurrentFacet(neighbourPath, f, onlyOuterRing);
                            if (fallsInside) {
                                polyRings.push(neighbourPath);
                            }
                        }
                        const result = (0, polylabel_1.polylabel)(polyRings);
                        f.labelBounds = new boundingbox_2.BoundingBox();
                        // determine inner square within the circle
                        const innerPadding = 2 * Math.sqrt(2 * result.distance);
                        f.labelBounds.minX = result.pt.x - innerPadding;
                        f.labelBounds.maxX = result.pt.x + innerPadding;
                        f.labelBounds.minY = result.pt.y - innerPadding;
                        f.labelBounds.maxY = result.pt.y + innerPadding;
                        if (count % 100 === 0) {
                            yield (0, common_6.delay)(0);
                            if (onUpdate != null) {
                                onUpdate(f.id / facetResult.facets.length);
                            }
                        }
                    }
                    count++;
                }
                if (onUpdate != null) {
                    onUpdate(1);
                }
            });
        }
        /**
         *  Checks whether a neighbour border path is fully within the current facet border path
         */
        static doesNeighbourFallInsideInCurrentFacet(neighbourPath, f, onlyOuterRing) {
            let fallsInside = true;
            // fast test to see if the neighbour falls inside the bbox of the facet
            for (let i = 0; i < neighbourPath.length && fallsInside; i++) {
                if (neighbourPath[i].x >= f.bbox.minX && neighbourPath[i].x <= f.bbox.maxX &&
                    neighbourPath[i].y >= f.bbox.minY && neighbourPath[i].y <= f.bbox.maxY) {
                    // ok
                }
                else {
                    fallsInside = false;
                }
            }
            if (fallsInside) {
                // do a more fine grained but more expensive check to see if each of the points fall within the polygon
                for (let i = 0; i < neighbourPath.length && fallsInside; i++) {
                    const distance = (0, polylabel_1.pointToPolygonDist)(neighbourPath[i].x, neighbourPath[i].y, onlyOuterRing);
                    if (distance < 0) {
                        // falls outside
                        fallsInside = false;
                    }
                }
            }
            return fallsInside;
        }
    }
    exports.FacetLabelPlacer = FacetLabelPlacer;
});
/**
 * Darl'Art paint families, generated from the palette file (566 colors, 38 families).
 * Each family lists its [code, hex] swatches in code order.
 * Regenerate with scripts/generate-palette-families.js when the palette changes.
 */
define("palettefamilies", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PALETTE_FAMILIES = void 0;
    exports.findPaletteFamily = findPaletteFamily;
    exports.PALETTE_FAMILIES = [
        { label: "Famille 01", colors: [
                ["0101", "#FFBBE4"], ["0102", "#FFA8CA"], ["0103", "#FF93B5"], ["0104", "#FF80A3"], ["0105", "#FC6286"], ["0106", "#F95379"], ["0107", "#F4446B"], ["0108", "#F02252"], ["0109", "#E20030"], ["0110", "#DC0000"], ["0111", "#5A0000"], ["0112", "#470000"], ["0113", "#350000"], ["0114", "#240000"], ["0115", "#140000"],
            ] },
        { label: "Famille 02", colors: [
                ["0201", "#FFC6CD"], ["0202", "#FFAFB8"], ["0203", "#FF9BA7"], ["0204", "#FE8992"], ["0205", "#FF7A83"], ["0206", "#FC737D"], ["0207", "#FB6570"], ["0208", "#F54C53"], ["0209", "#F1404A"], ["0210", "#DF0207"], ["0211", "#561920"], ["0212", "#45141A"], ["0213", "#340F13"], ["0214", "#270B0E"], ["0215", "#1C080A"],
            ] },
        { label: "Famille 03", colors: [
                ["0301", "#FFC6CC"], ["0302", "#FEACB2"], ["0303", "#FFA0A6"], ["0304", "#FF8F95"], ["0305", "#FF9188"], ["0306", "#FF8B82"], ["0307", "#FF7C74"], ["0308", "#FF665E"], ["0309", "#FF5F53"], ["0310", "#FA3218"], ["0311", "#64352F"], ["0312", "#502A26"], ["0313", "#3C201C"], ["0314", "#2D1815"], ["0315", "#20110F"],
            ] },
        { label: "Famille 04", colors: [
                ["0401", "#FED1CC"], ["0402", "#FFBDB1"], ["0403", "#FEAA9F"], ["0404", "#FF9F93"], ["0405", "#FF957D"], ["0406", "#FF8C71"], ["0407", "#FF8168"], ["0408", "#FE7155"], ["0409", "#FF6040"], ["0410", "#F94C21"], ["0411", "#684531"], ["0412", "#533727"], ["0413", "#3E291D"], ["0414", "#2F1F16"], ["0415", "#211610"],
            ] },
        { label: "Famille 05", colors: [
                ["0501", "#FFD9C6"], ["0502", "#FEC4B0"], ["0503", "#FFB39C"], ["0504", "#FFA88D"], ["0505", "#FEB080"], ["0506", "#FEAA7B"], ["0507", "#FF9A64"], ["0508", "#FF915E"], ["0509", "#FF8752"], ["0510", "#FF692A"], ["0511", "#685836"], ["0512", "#53462B"], ["0513", "#3E3520"], ["0514", "#2F2818"], ["0515", "#211C11"],
            ] },
        { label: "Famille 06", colors: [
                ["0601", "#FFE2C0"], ["0602", "#FED3A9"], ["0603", "#FFC796"], ["0604", "#FFBC87"], ["0605", "#FEC182"], ["0606", "#FEB775"], ["0607", "#FFAE6C"], ["0608", "#FFA157"], ["0609", "#FF9348"], ["0610", "#FF812A"], ["0611", "#756937"], ["0612", "#5E542C"], ["0613", "#463F21"], ["0614", "#352F19"], ["0615", "#252212"],
            ] },
        { label: "Famille 07", colors: [
                ["0701", "#FFEFC3"], ["0702", "#FFE0A7"], ["0703", "#FFD799"], ["0704", "#FFCE89"], ["0705", "#FFCB7F"], ["0706", "#FFC571"], ["0707", "#FEBC66"], ["0708", "#FFB35B"], ["0709", "#FEAA48"], ["0710", "#FF9E33"], ["0711", "#837D3F"], ["0712", "#696432"], ["0713", "#4F4B26"], ["0714", "#3B381C"], ["0715", "#2A2814"],
            ] },
        { label: "Famille 08", colors: [
                ["0801", "#FFF7C5"], ["0802", "#FFF2AC"], ["0803", "#FFEA9E"], ["0804", "#FFE18B"], ["0805", "#FEDC7B"], ["0806", "#FFD573"], ["0807", "#FFCC63"], ["0808", "#FFC557"], ["0809", "#FEC049"], ["0810", "#FFB636"], ["0811", "#7A7940"], ["0812", "#626133"], ["0813", "#494926"], ["0814", "#37361D"], ["0815", "#272714"],
            ] },
        { label: "Famille 09", colors: [
                ["0901", "#FFFFC7"], ["0902", "#FFFFAF"], ["0903", "#FEFE9A"], ["0904", "#FFFF8D"], ["0905", "#FFFF81"], ["0906", "#FFFF71"], ["0907", "#FFFF69"], ["0908", "#FEFF5B"], ["0909", "#FFF643"], ["0910", "#FFF12E"], ["0911", "#85853F"], ["0912", "#66652F"], ["0913", "#4D4C23"], ["0914", "#39391A"], ["0915", "#292913"],
            ] },
        { label: "Famille 10", colors: [
                ["1001", "#F5FAC4"], ["1002", "#EBF5B0"], ["1003", "#DFF39E"], ["1004", "#D3F191"], ["1005", "#CCEE8D"], ["1006", "#C3E87E"], ["1007", "#BAE476"], ["1008", "#B0DD66"], ["1009", "#A2D959"], ["1010", "#97D147"], ["1011", "#6A7042"], ["1012", "#555A35"], ["1013", "#404328"], ["1014", "#30321E"], ["1015", "#222415"],
            ] },
        { label: "Famille 11", colors: [
                ["1101", "#EBFFCC"], ["1102", "#DAF9B5"], ["1103", "#CCF3A2"], ["1104", "#BFED93"], ["1105", "#B0E78A"], ["1106", "#A6DF7E"], ["1107", "#9ADC72"], ["1108", "#8ED366"], ["1109", "#82D15C"], ["1110", "#6EC449"], ["1111", "#597B3E"], ["1112", "#476232"], ["1113", "#354A25"], ["1114", "#28371C"], ["1115", "#1C2714"],
            ] },
        { label: "Famille 12", colors: [
                ["1201", "#D5F6C9"], ["1202", "#C1EEB3"], ["1203", "#B3E8A4"], ["1204", "#A4E297"], ["1205", "#ACF393"], ["1206", "#A0E885"], ["1207", "#96E57C"], ["1208", "#8DE074"], ["1209", "#77D364"], ["1210", "#60C752"], ["1211", "#527A45"], ["1212", "#426237"], ["1213", "#314929"], ["1214", "#25371F"], ["1215", "#1A2716"],
            ] },
        { label: "Famille 13", colors: [
                ["1301", "#BFEFD9"], ["1302", "#A4E4BF"], ["1303", "#96DFB2"], ["1304", "#85D8A2"], ["1305", "#85D691"], ["1306", "#7CCF87"], ["1307", "#71C97F"], ["1308", "#5CBF6C"], ["1309", "#4CB862"], ["1310", "#2EA555"], ["1311", "#336C4C"], ["1312", "#29563D"], ["1313", "#1F412E"], ["1314", "#173122"], ["1315", "#102318"],
            ] },
        { label: "Famille 14", colors: [
                ["1401", "#B9F1D6"], ["1402", "#9FE7C2"], ["1403", "#8CDFB5"], ["1404", "#7AD5AA"], ["1405", "#68CC9A"], ["1406", "#5DC391"], ["1407", "#4EBB84"], ["1408", "#41B47B"], ["1409", "#23A565"], ["1410", "#079A53"], ["1411", "#166D43"], ["1412", "#125736"], ["1413", "#0D4128"], ["1414", "#0A311E"], ["1415", "#072315"],
            ] },
        { label: "Famille 15", colors: [
                ["1501", "#ADEFD4"], ["1502", "#8EE2C8"], ["1503", "#79D6B7"], ["1504", "#66CDAF"], ["1505", "#57C69B"], ["1506", "#4CC093"], ["1507", "#3DB285"], ["1508", "#26A97D"], ["1509", "#02946D"], ["1510", "#028B5F"], ["1511", "#04634D"], ["1512", "#034F3E"], ["1513", "#023B2E"], ["1514", "#022D23"], ["1515", "#012019"],
            ] },
        { label: "Famille 16", colors: [
                ["1601", "#9AE6E2"], ["1602", "#81DCD5"], ["1603", "#69CEC8"], ["1604", "#55C3BA"], ["1605", "#4FC0AE"], ["1606", "#42B6A3"], ["1607", "#37AE9B"], ["1608", "#189D88"], ["1609", "#059885"], ["1610", "#007D6B"], ["1611", "#00574F"], ["1612", "#00463F"], ["1613", "#00342F"], ["1614", "#002724"], ["1615", "#001C19"],
            ] },
        { label: "Famille 17", colors: [
                ["1701", "#98E7EB"], ["1702", "#7AD9DB"], ["1703", "#5ECECF"], ["1704", "#4CC4C2"], ["1705", "#4DC0BB"], ["1706", "#3EB7B0"], ["1707", "#2AA9A2"], ["1708", "#0B9D93"], ["1709", "#008D84"], ["1710", "#007972"], ["1711", "#005A58"], ["1712", "#004846"], ["1713", "#003635"], ["1714", "#002828"], ["1715", "#001D1C"],
            ] },
        { label: "Famille 18", colors: [
                ["1801", "#8DE4F5"], ["1802", "#68D3E5"], ["1803", "#52C9DD"], ["1804", "#3ABBD1"], ["1805", "#3BB6C8"], ["1806", "#2AADC1"], ["1807", "#119FB3"], ["1808", "#0093A7"], ["1809", "#008298"], ["1810", "#016F88"], ["1811", "#00525D"], ["1812", "#00424A"], ["1813", "#003138"], ["1814", "#00252A"], ["1815", "#001A1E"],
            ] },
        { label: "Famille 19", colors: [
                ["1901", "#8DE3FA"], ["1902", "#69D2EF"], ["1903", "#4EC5E3"], ["1904", "#34BBD9"], ["1905", "#32B3D3"], ["1906", "#15A3C7"], ["1907", "#029CC0"], ["1908", "#0090B5"], ["1909", "#007BA5"], ["1910", "#006A92"], ["1911", "#004C5C"], ["1912", "#003D4A"], ["1913", "#002E37"], ["1914", "#002229"], ["1915", "#00181D"],
            ] },
        { label: "Famille 20", colors: [
                ["2001", "#87E1FC"], ["2002", "#63CFF3"], ["2003", "#49C4ED"], ["2004", "#35BAE5"], ["2005", "#2DB0DA"], ["2006", "#11A4D0"], ["2007", "#009DCA"], ["2008", "#008CBD"], ["2009", "#017DB1"], ["2010", "#0068A1"], ["2011", "#004B60"], ["2012", "#003C4D"], ["2013", "#002D3A"], ["2014", "#00222B"], ["2015", "#00181F"],
            ] },
        { label: "Famille 21", colors: [
                ["2101", "#8CE3FF"], ["2102", "#66D2F9"], ["2103", "#48C2F1"], ["2104", "#35B9EA"], ["2105", "#32B5E9"], ["2106", "#06A0DC"], ["2107", "#0394D3"], ["2108", "#0388CB"], ["2109", "#007CC2"], ["2110", "#0064B0"], ["2111", "#004C66"], ["2112", "#003D52"], ["2113", "#002E3D"], ["2114", "#00222E"], ["2115", "#001821"],
            ] },
        { label: "Famille 22", colors: [
                ["2201", "#8EE1FF"], ["2202", "#6DD0F0"], ["2203", "#51C1EF"], ["2204", "#3CB6E7"], ["2205", "#32A7DC"], ["2206", "#129BD2"], ["2207", "#038FCA"], ["2208", "#0084C2"], ["2209", "#0172B6"], ["2210", "#005DA3"], ["2211", "#004763"], ["2212", "#00394F"], ["2213", "#002B3B"], ["2214", "#00202D"], ["2215", "#001720"],
            ] },
        { label: "Famille 23", colors: [
                ["2301", "#8AD9F8"], ["2302", "#70C9F1"], ["2303", "#56BDE8"], ["2304", "#43ADDD"], ["2305", "#30A6D8"], ["2306", "#269BD0"], ["2307", "#018CC3"], ["2308", "#007CB8"], ["2309", "#025798"], ["2310", "#005A99"], ["2311", "#01445F"], ["2312", "#01364C"], ["2313", "#012939"], ["2314", "#001F2B"], ["2315", "#00161E"],
            ] },
        { label: "Famille 24", colors: [
                ["2401", "#93D5F5"], ["2402", "#72C1E8"], ["2403", "#58B1DD"], ["2404", "#43A4D1"], ["2405", "#329CCC"], ["2406", "#3395C6"], ["2407", "#0083B7"], ["2408", "#0176AC"], ["2409", "#00649F"], ["2410", "#004E87"], ["2411", "#00405C"], ["2412", "#00334A"], ["2413", "#002637"], ["2414", "#001D29"], ["2415", "#00141D"],
            ] },
        { label: "Famille 25", colors: [
                ["2501", "#9ED1F0"], ["2502", "#7ABADD"], ["2503", "#65A8D2"], ["2504", "#529BC6"], ["2505", "#539AC4"], ["2506", "#4089B4"], ["2507", "#2F7DAD"], ["2508", "#166A99"], ["2509", "#025A8C"], ["2510", "#023F75"], ["2511", "#013453"], ["2512", "#012A42"], ["2513", "#011F32"], ["2514", "#001725"], ["2515", "#00111B"],
            ] },
        { label: "Famille 26", colors: [
                ["2601", "#A2D1EB"], ["2602", "#82BADB"], ["2603", "#6BABCF"], ["2604", "#5C9DC3"], ["2605", "#558AB4"], ["2606", "#467DA6"], ["2607", "#3D749D"], ["2608", "#236391"], ["2609", "#205F8B"], ["2610", "#01366A"], ["2611", "#00243C"], ["2612", "#001D30"], ["2613", "#001624"], ["2614", "#00101B"], ["2615", "#000C13"],
            ] },
        { label: "Famille 27", colors: [
                ["2701", "#B4C1E4"], ["2702", "#99ACD6"], ["2703", "#8099C2"], ["2704", "#728AB6"], ["2705", "#527CA6"], ["2706", "#4E78A2"], ["2707", "#406B95"], ["2708", "#38638D"], ["2709", "#1C4670"], ["2710", "#002454"], ["2711", "#011132"], ["2712", "#010E28"], ["2713", "#010A1E"], ["2714", "#000816"], ["2715", "#000510"],
            ] },
        { label: "Famille 28", colors: [
                ["2801", "#C0BFDE"], ["2802", "#A8A8CA"], ["2803", "#9696BA"], ["2804", "#8484AA"], ["2805", "#7779A0"], ["2806", "#676992"], ["2807", "#64668F"], ["2808", "#51537A"], ["2809", "#3C3E65"], ["2810", "#0E093F"], ["2811", "#040426"], ["2812", "#03031E"], ["2813", "#020217"], ["2814", "#020211"], ["2815", "#01010C"],
            ] },
        { label: "Famille 29", colors: [
                ["2901", "#CAC9D7"], ["2902", "#B0B1C5"], ["2903", "#A0A0B8"], ["2904", "#8F8FA7"], ["2905", "#8281A0"], ["2906", "#727191"], ["2907", "#656182"], ["2908", "#554F71"], ["2909", "#443A5F"], ["2910", "#250034"], ["2911", "#180322"], ["2912", "#13021B"], ["2913", "#0E0214"], ["2914", "#0B010F"], ["2915", "#08010B"],
            ] },
        { label: "Famille 30", colors: [
                ["3001", "#F1CFDF"], ["3002", "#E0B9CC"], ["3003", "#D0A3B8"], ["3004", "#C494AE"], ["3005", "#A67892"], ["3006", "#9A6883"], ["3007", "#905976"], ["3008", "#7E4764"], ["3009", "#672C4C"], ["3010", "#3E0019"], ["3011", "#280008"], ["3012", "#220007"], ["3013", "#1B0006"], ["3014", "#150005"], ["3015", "#0F0004"],
            ] },
        { label: "Famille 31", colors: [
                ["3101", "#EEC0DA"], ["3102", "#E1A6C4"], ["3103", "#D392B4"], ["3104", "#CA82A7"], ["3105", "#B97197"], ["3106", "#AE6489"], ["3107", "#9F5179"], ["3108", "#8F3C66"], ["3109", "#7C234F"], ["3110", "#5A000A"], ["3111", "#370005"], ["3112", "#2C0004"], ["3113", "#210003"], ["3114", "#190002"], ["3115", "#120002"],
            ] },
        { label: "Famille 32", colors: [
                ["3201", "#F4B9D7"], ["3202", "#EAA2C7"], ["3203", "#E18CB6"], ["3204", "#D67BA6"], ["3205", "#C76C98"], ["3206", "#BE5D8A"], ["3207", "#B6517D"], ["3208", "#A73862"], ["3209", "#97224F"], ["3210", "#710002"], ["3211", "#460002"], ["3212", "#380002"], ["3213", "#2A0001"], ["3214", "#200001"], ["3215", "#160001"],
            ] },
        { label: "Famille 33", colors: [
                ["3301", "#F8D0CE"], ["3302", "#EFBAB6"], ["3303", "#E7AAA7"], ["3304", "#E09B96"], ["3305", "#DF928C"], ["3306", "#CD746E"], ["3307", "#CE756F"], ["3308", "#C56660"], ["3309", "#BB544F"], ["3310", "#A63E35"], ["3311", "#633631"], ["3312", "#4F2B27"], ["3313", "#3B201D"], ["3314", "#2D1816"], ["3315", "#201110"],
            ] },
        { label: "Famille 34", colors: [
                ["3401", "#FCDBCA"], ["3402", "#F6C7B5"], ["3403", "#F0B9A4"], ["3404", "#E9AB94"], ["3405", "#EA9882"], ["3406", "#E99179"], ["3407", "#E3836A"], ["3408", "#DB775F"], ["3409", "#CE644C"], ["3410", "#C15234"], ["3411", "#6C4935"], ["3412", "#4B3B2B"], ["3413", "#3A3728"], ["3414", "#25251B"], ["3415", "#14130E"],
            ] },
        { label: "Famille 35", colors: [
                ["3501", "#F0DACD"], ["3502", "#E7C8B6"], ["3503", "#DCB7A4"], ["3504", "#D4A996"], ["3505", "#D59E89"], ["3506", "#CC937F"], ["3507", "#C4866F"], ["3508", "#B87660"], ["3509", "#A9674D"], ["3510", "#98573B"], ["3511", "#6E4B37"], ["3512", "#474030"], ["3513", "#30312B"], ["3514", "#23241F"], ["3515", "#0E130D"],
            ] },
        { label: "Famille 36", colors: [
                ["3601", "#ECDCCF"], ["3602", "#DDC7B9"], ["3603", "#D5BAA5"], ["3604", "#CAAB97"], ["3605", "#C19E8A"], ["3606", "#B8927F"], ["3607", "#AB8570"], ["3608", "#A67C66"], ["3609", "#916B56"], ["3610", "#7C563F"], ["3611", "#664C3B"], ["3612", "#523D2F"], ["3613", "#3D2E23"], ["3614", "#2E221B"], ["3615", "#211813"],
            ] },
        { label: "Famille 37", colors: [
                ["3701", "#D4D4D4"], ["3702", "#C0C0C0"], ["3703", "#B1B1B1"], ["3704", "#A5A5A3"], ["3705", "#9E9E92"], ["3706", "#919185"], ["3707", "#838377"], ["3708", "#78786C"], ["3709", "#68685C"], ["3710", "#545547"], ["3711", "#43443F"], ["3712", "#363632"], ["3713", "#282926"], ["3714", "#1E1F1C"], ["3715", "#151614"],
            ] },
        { label: "Famille 38 — Échelle blanc / gris / noir", colors: [
                ["3801", "#FFFFFF"], ["3802", "#F3F3F3"], ["3803", "#E7E7E7"], ["3804", "#DADADA"], ["3805", "#CCCCCC"], ["3806", "#BCBCBC"], ["3807", "#AAAAAA"], ["3808", "#959595"], ["3809", "#7C7C7C"], ["3810", "#5A5A5A"], ["3811", "#0A0A0C"],
            ] },
    ];
    const matchesByCodeAndHex = {};
    const matchesByHex = {};
    /** Family index by the first 2 digits of a paint code, so older palette versions still group correctly */
    const familyIndexByCodePrefix = {};
    exports.PALETTE_FAMILIES.forEach((family, familyIndex) => {
        family.colors.forEach(([code, hex], position) => {
            const match = { familyIndex, label: family.label, position };
            matchesByCodeAndHex[code + "|" + hex] = match;
            if (!(hex in matchesByHex)) {
                matchesByHex[hex] = match;
            }
            if (!(code.substring(0, 2) in familyIndexByCodePrefix)) {
                familyIndexByCodePrefix[code.substring(0, 2)] = familyIndex;
            }
        });
    });
    /**
     * Finds the paint family of a color. The paint code is checked first: it names the family even when the
     * color comes from another version of the palette, and some families can share a hex value.
     */
    function findPaletteFamily(hex, code) {
        const hexKey = hex.trim().toUpperCase();
        const codeKey = code ? code.trim() : "";
        if (codeKey) {
            const exactMatch = matchesByCodeAndHex[codeKey + "|" + hexKey];
            if (exactMatch) {
                return exactMatch;
            }
            // a code from another palette version: its first 2 digits still name the family, the last 2 the shade
            if (/^\d{4}$/.test(codeKey)) {
                const familyIndex = familyIndexByCodePrefix[codeKey.substring(0, 2)];
                if (familyIndex !== undefined) {
                    return { familyIndex, label: exports.PALETTE_FAMILIES[familyIndex].label, position: parseInt(codeKey.substring(2), 10) - 1 };
                }
            }
        }
        return matchesByHex[hexKey] || null;
    }
});
define("core/palette", ["require", "exports", "palettefamilies"], function (require, exports, palettefamilies_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.colorToHex = colorToHex;
    exports.getColorCode = getColorCode;
    exports.reorderColorsByFamily = reorderColorsByFamily;
    exports.buildPaletteEntries = buildPaletteEntries;
    exports.groupPaletteEntries = groupPaletteEntries;
    function colorToHex(color) {
        const r = Math.floor(color[0]);
        const g = Math.floor(color[1]);
        const b = Math.floor(color[2]);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    function getColorCode(color, colorCodes = {}) {
        const hexValue = colorToHex(color);
        return (colorCodes && (colorCodes[`${color[0]},${color[1]},${color[2]}`] || colorCodes[hexValue.toUpperCase()] || colorCodes[hexValue.toLowerCase()])) || "";
    }
    /**
     * Renumbers the colors so they follow the Darl'Art paint family order: family by family, in the order of each family's swatches.
     * Colors that don't belong to a family keep their relative order after the family colors.
     * The facet colors are remapped in place (they determine the label numbers) and the reordered colors are returned.
     */
    function reorderColorsByFamily(colorsByIndex, colorCodes, facetResult) {
        const entries = colorsByIndex.map((color, index) => {
            const family = (0, palettefamilies_1.findPaletteFamily)(colorToHex(color), getColorCode(color, colorCodes));
            return {
                index,
                familyIndex: family ? family.familyIndex : Number.MAX_VALUE,
                position: family ? family.position : 0,
            };
        });
        if (!entries.some((e) => e.familyIndex !== Number.MAX_VALUE)) {
            return colorsByIndex;
        }
        entries.sort((a, b) => (a.familyIndex - b.familyIndex) || (a.position - b.position) || (a.index - b.index));
        const newIndexByOldIndex = new Array(entries.length);
        entries.forEach((e, newIndex) => { newIndexByOldIndex[e.index] = newIndex; });
        for (const f of facetResult.facets) {
            if (f != null) {
                f.color = newIndexByOldIndex[f.color];
            }
        }
        return entries.map((e) => colorsByIndex[e.index]);
    }
    function buildPaletteEntries(colorsByIndex, colorCodes = {}) {
        return colorsByIndex.map((color, index) => {
            const hex = colorToHex(color);
            const code = getColorCode(color, colorCodes);
            return { number: index + 1, color, hex, code, family: (0, palettefamilies_1.findPaletteFamily)(hex, code) };
        });
    }
    /**
     * One row per paint family (in family order), colors without a family in a last row.
     * When no color belongs to a family, the entries are split in unlabelled rows of `ungroupedRowSize`.
     */
    function groupPaletteEntries(entries, otherLabel = "Other colors", ungroupedRowSize = 9) {
        if (!entries.some((e) => e.family !== null)) {
            const rows = [];
            for (let i = 0; i < entries.length; i += ungroupedRowSize) {
                rows.push({ label: "", entries: entries.slice(i, i + ungroupedRowSize) });
            }
            return rows;
        }
        const rowsByKey = {};
        for (const entry of entries) {
            const key = entry.family ? entry.family.familyIndex : Number.MAX_VALUE;
            if (!rowsByKey[key]) {
                rowsByKey[key] = { key, row: { label: entry.family ? entry.family.label : otherLabel, entries: [] } };
            }
            rowsByKey[key].row.entries.push(entry);
        }
        return Object.keys(rowsByKey)
            .map((k) => rowsByKey[k])
            .sort((a, b) => a.key - b.key)
            .map((r) => {
            r.row.entries.sort((a, b) => a.number - b.number);
            return r.row;
        });
    }
});
define("core/svg", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FADED_CANVAS_STYLE = void 0;
    exports.labelColorFor = labelColorFor;
    exports.getFacetOutline = getFacetOutline;
    exports.buildFacetPathData = buildFacetPathData;
    exports.getLabelFontSize = getLabelFontSize;
    exports.buildSvgString = buildSvgString;
    exports.fadeColors = fadeColors;
    exports.buildFadedSvgString = buildFadedSvgString;
    exports.buildBlankSvgString = buildBlankSvgString;
    /** Numbers stay readable on any fill: white on a dark region, the normal color on a light one */
    function labelColorFor(color, fontColor) {
        const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
        return luminance < 140 ? "#ffffff" : fontColor;
    }
    /** The faded "pre-printed canvas" look: pale colors with grey outlines and grey numbers */
    exports.FADED_CANVAS_STYLE = {
        /** Share of each color that is kept, the rest being white: 1 keeps the color, 0 turns it white */
        colorStrength: 0.22,
        strokeColor: "#a2a7ad",
        fontColor: "#868b92",
        background: "#ffffff",
    };
    /** Closed outline of a facet built from its (smoothed) border segments, in image pixel coordinates */
    function getFacetOutline(f) {
        const path = f.getFullPathFromBorderSegments(false);
        if (path.length > 0 && (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y)) {
            path.push(path[0]);
        }
        return path;
    }
    function buildFacetPathData(outline, sizeMultiplier) {
        let data = "M ";
        data += outline[0].x * sizeMultiplier + " " + outline[0].y * sizeMultiplier + " ";
        for (let i = 1; i < outline.length; i++) {
            const midpointX = (outline[i].x + outline[i - 1].x) / 2;
            const midpointY = (outline[i].y + outline[i - 1].y) / 2;
            data += "Q " + (midpointX * sizeMultiplier) + " " + (midpointY * sizeMultiplier) + " " + (outline[i].x * sizeMultiplier) + " " + (outline[i].y * sizeMultiplier) + " ";
        }
        data += "Z";
        return data;
    }
    /** Font size of a facet label, in the -50..50 viewBox units of its label box */
    function getLabelFontSize(f, fontSize) {
        return fontSize / ((f.color + 1) + "").length;
    }
    function rgbString(color) {
        return `rgb(${color[0]},${color[1]},${color[2]})`;
    }
    function buildSvgString(facetResult, colorsByIndex, options = {}) {
        const sizeMultiplier = options.sizeMultiplier !== undefined ? options.sizeMultiplier : 3;
        const fill = options.fill !== undefined ? options.fill : true;
        const stroke = options.stroke !== undefined ? options.stroke : true;
        const labels = options.labels !== undefined ? options.labels : true;
        const fontSize = options.fontSize !== undefined ? options.fontSize : 50;
        const fontColor = options.fontColor || "#000";
        const strokeColor = options.strokeColor || "#000";
        const strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 1;
        const fontFamily = (options.fontFamily || "Tahoma").replace(/"/g, "'");
        const parts = [];
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMultiplier * facetResult.width}" height="${sizeMultiplier * facetResult.height}">`);
        if (options.background) {
            parts.push(`<rect width="100%" height="100%" fill="${options.background}"></rect>`);
        }
        for (const f of facetResult.facets) {
            if (f == null || f.borderSegments.length === 0) {
                continue;
            }
            const outline = getFacetOutline(f);
            const color = rgbString(colorsByIndex[f.color]);
            let style = "";
            if (stroke) {
                style += `stroke: ${strokeColor}; `;
            }
            else if (fill) {
                // make the border the same color as the fill color if there is no border stroke to not have gaps in between facets
                style += `stroke: ${color}; `;
            }
            style += `stroke-width: ${strokeWidth}px; `;
            style += `fill: ${fill ? color : "none"};`;
            parts.push(`<path data-facetId="${f.id}" d="${buildFacetPathData(outline, sizeMultiplier)}" style="${style}"></path>`);
            if (labels) {
                const labelFill = fill && options.labelContrast ? labelColorFor(colorsByIndex[f.color], fontColor) : fontColor;
                parts.push(`<g class="label" transform="translate(${f.labelBounds.minX * sizeMultiplier},${f.labelBounds.minY * sizeMultiplier})">` +
                    `<svg width="${f.labelBounds.width * sizeMultiplier}" height="${f.labelBounds.height * sizeMultiplier}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
                    `<text font-family="${fontFamily}" font-size="${getLabelFontSize(f, fontSize)}" dominant-baseline="middle" text-anchor="middle" fill="${labelFill}">${f.color + 1}</text>` +
                    `</svg></g>`);
            }
        }
        parts.push("</svg>");
        return parts.join("");
    }
    /** Mixes each color toward white, keeping `strength` of the original (0 = white, 1 = unchanged) */
    function fadeColors(colorsByIndex, strength) {
        const kept = Math.max(0, Math.min(1, strength));
        return colorsByIndex.map((color) => color.map((channel, i) => (i < 3 ? Math.round(255 - (255 - channel) * kept) : channel)));
    }
    /**
     * The template as a pre-printed canvas: every region faintly tinted with its color, with grey outlines and
     * numbers on white. Painters see where each color goes while the numbers stay readable.
     */
    function buildFadedSvgString(facetResult, colorsByIndex, options = {}) {
        const strength = options.colorStrength !== undefined ? options.colorStrength : exports.FADED_CANVAS_STYLE.colorStrength;
        const svgOptions = {
            strokeColor: exports.FADED_CANVAS_STYLE.strokeColor,
            fontColor: exports.FADED_CANVAS_STYLE.fontColor,
            background: exports.FADED_CANVAS_STYLE.background,
        };
        for (const key of Object.keys(options)) {
            if (key !== "colorStrength" && options[key] !== undefined) {
                svgOptions[key] = options[key];
            }
        }
        svgOptions.fill = true;
        svgOptions.stroke = true;
        svgOptions.labels = true;
        return buildSvgString(facetResult, fadeColors(colorsByIndex, strength), svgOptions);
    }
    /**
     * The template to paint on: black outlines and black numbers on white, no colors at all.
     * Same geometry as the colored SVG, so both line up.
     */
    function buildBlankSvgString(facetResult, colorsByIndex, options = {}) {
        return buildSvgString(facetResult, colorsByIndex, Object.assign(Object.assign({ strokeColor: "#000000", fontColor: "#000000", background: "#ffffff", 
            // thicker than the colored template: nothing but the lines shows where to paint
            strokeWidth: 1.5 }, options), { fill: false, stroke: true, labels: true, labelContrast: false }));
    }
});
define("core/pdf", ["require", "exports", "core/palette", "core/svg"], function (require, exports, palette_1, svg_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PAPER_SIZES = void 0;
    exports.buildPdf = buildPdf;
    exports.buildPaintingPdf = buildPaintingPdf;
    exports.addLegendPages = addLegendPages;
    exports.PAPER_SIZES = ["a2", "a3", "a4", "a5"];
    const PAGE_MARGIN = 36; // 0.5 inch
    function hexToRgb(hex) {
        const clean = hex.replace(/^#/, "");
        const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
        return [parseInt(full.substring(0, 2), 16), parseInt(full.substring(2, 4), 16), parseInt(full.substring(4, 6), 16)];
    }
    /** Page setup shared by the PDFs: the template scaled and centered on the paper, with its facets ready to trace */
    function layoutTemplate(JsPDF, template, options) {
        const paperSize = options.paperSize || "a4";
        const sizeMultiplier = options.sizeMultiplier || 3;
        const fontSize = options.fontSize || 50;
        const borderColor = hexToRgb(options.borderColor || "#000000");
        const outlineColor = hexToRgb(options.outlineColor || "#bcc0ca");
        const { facetResult, colorsByIndex } = template;
        // Template geometry in SVG units (image pixels * multiplier) with a small padding so strokes aren't clipped at the edges
        const svgWidth = facetResult.width * sizeMultiplier;
        const svgHeight = facetResult.height * sizeMultiplier;
        const pad = Math.max(2, Math.min(svgWidth, svgHeight) * 0.01);
        const paddedWidth = svgWidth + pad * 2;
        const paddedHeight = svgHeight + pad * 2;
        // compress: the vector outlines of hundreds of facets are several MB uncompressed
        const doc = new JsPDF({ orientation: paddedWidth > paddedHeight ? "landscape" : "portrait", unit: "pt", format: paperSize, compress: true });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const scale = Math.min((pageWidth - PAGE_MARGIN * 2) / paddedWidth, (pageHeight - PAGE_MARGIN * 2) / paddedHeight);
        const offsetX = (pageWidth - paddedWidth * scale) / 2;
        const offsetY = (pageHeight - paddedHeight * scale) / 2;
        // image pixel coordinate → page coordinate
        const toPageX = (x) => offsetX + (x * sizeMultiplier + pad) * scale;
        const toPageY = (y) => offsetY + (y * sizeMultiplier + pad) * scale;
        const lineWidth = scale; // 1px stroke in SVG units
        const traceFacet = (outline) => {
            doc.moveTo(toPageX(outline[0].x), toPageY(outline[0].y));
            for (let i = 1; i < outline.length; i++) {
                doc.lineTo(toPageX(outline[i].x), toPageY(outline[i].y));
            }
            doc.close();
        };
        const drawableFacets = facetResult.facets.filter((f) => f != null && f.borderSegments.length > 0);
        /** Every facet's number, centered in its label box, the same way the SVG places it */
        const drawLabels = (color) => {
            doc.setFont("helvetica", "normal");
            if (color !== "contrast") {
                doc.setTextColor(color[0], color[1], color[2]);
            }
            for (const f of drawableFacets) {
                const bounds = f.labelBounds;
                // the label is centered in its box and scaled like the SVG viewBox "-50 -50 100 100" (meet)
                const boxScale = Math.min(bounds.width, bounds.height) * sizeMultiplier / 100;
                const labelSize = (0, svg_1.getLabelFontSize)(f, fontSize) * boxScale * scale;
                if (labelSize < 0.5) {
                    continue;
                }
                if (color === "contrast") {
                    // white on a dark region, dark on a light one
                    doc.setTextColor((0, svg_1.labelColorFor)(colorsByIndex[f.color], "#111111"));
                }
                doc.setFontSize(labelSize);
                doc.text(String(f.color + 1), toPageX(bounds.minX + bounds.width / 2), toPageY(bounds.minY + bounds.height / 2), { align: "center", baseline: "middle" });
            }
        };
        /** The colored template, one filled and stroked shape per facet */
        const drawColoredTemplate = () => {
            doc.setLineJoin("round");
            doc.setLineWidth(lineWidth);
            doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
            for (const f of drawableFacets) {
                const color = colorsByIndex[f.color];
                doc.setFillColor(color[0], color[1], color[2]);
                traceFacet((0, svg_1.getFacetOutline)(f));
                doc.fillStroke();
            }
        };
        /** The outlines only, in the outline color */
        const drawOutlines = () => {
            doc.setLineJoin("round");
            doc.setLineWidth(lineWidth);
            doc.setDrawColor(outlineColor[0], outlineColor[1], outlineColor[2]);
            for (const f of drawableFacets) {
                traceFacet((0, svg_1.getFacetOutline)(f));
                doc.stroke();
            }
        };
        const addLegend = () => {
            const rows = (0, palette_1.groupPaletteEntries)((0, palette_1.buildPaletteEntries)(colorsByIndex, template.colorCodes));
            addLegendPages(doc, rows, options.legendTitle || "Legend & Palette");
        };
        return { doc, drawColoredTemplate, drawOutlines, drawLabels, addLegend, outlineColor };
    }
    /** Page 1: colored without numbers. Page 2: numbered outline. Page 3+: legend & palette by family. */
    function buildPdf(JsPDF, template, options = {}) {
        const page = layoutTemplate(JsPDF, template, options);
        page.drawColoredTemplate();
        page.doc.addPage();
        page.drawOutlines();
        page.drawLabels(page.outlineColor);
        page.addLegend();
        return page.doc;
    }
    /**
     * The painting guide: page 1 is the colored template with its numbers (white on the dark regions),
     * page 2 is the palette.
     */
    function buildPaintingPdf(JsPDF, template, options = {}) {
        const page = layoutTemplate(JsPDF, template, options);
        page.drawColoredTemplate();
        page.drawLabels("contrast");
        page.addLegend();
        return page.doc;
    }
    /**
     * Legend as vector content. Family cards are packed into full-width lines and a new page
     * is only started when the next line doesn't fit on the current one.
     */
    function addLegendPages(doc, rows, title) {
        if (rows.length === 0) {
            return;
        }
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const contentWidth = pageWidth - PAGE_MARGIN * 2;
        const isGrouped = rows.some((row) => !!row.label);
        const maxSwatches = Math.max(...rows.map((row) => row.entries.length));
        // Sizes are tuned for A4 and scale down (k < 1) when the largest family doesn't fit a smaller paper size
        const cardPadding = 8;
        const cardGap = 8;
        const cellWidth = Math.min(44, (contentWidth - cardPadding * 2) / maxSwatches);
        const k = cellWidth / 44;
        const radius = 12 * k;
        const labelFontSize = Math.max(6, 8.5 * k);
        const labelLineHeight = labelFontSize * 1.25;
        const hasCodes = rows.some((row) => row.entries.some((e) => !!e.code));
        const cellHeight = radius * 2 + 10 * k + (hasCodes ? 8.5 * k : 0) + 8 * k + 3 * k;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(labelFontSize);
        const cards = rows.map((row) => {
            // +1pt slack so splitTextToSize doesn't wrap a label that exactly fits
            const labelWidth = row.label ? Math.min(doc.getTextWidth(row.label) + 1, contentWidth - cardPadding * 2) : 0;
            return { row, width: cardPadding * 2 + Math.max(row.entries.length * cellWidth, labelWidth), labelLines: [] };
        });
        // Pack cards into lines, keeping the family order
        const lines = [];
        let current = [];
        let usedWidth = 0;
        for (const card of cards) {
            const gap = current.length ? cardGap : 0;
            if (current.length && usedWidth + gap + card.width > contentWidth) {
                lines.push({ cards: current, labelHeight: 0, height: 0 });
                current = [];
                usedWidth = 0;
            }
            usedWidth += (current.length ? cardGap : 0) + card.width;
            current.push(card);
        }
        if (current.length) {
            lines.push({ cards: current, labelHeight: 0, height: 0 });
        }
        // Stretch cards so every line spans the full width (a short last line keeps its natural widths)
        lines.forEach((line, lineIndex) => {
            const lineWidth = line.cards.reduce((sum, card) => sum + card.width, 0) + cardGap * (line.cards.length - 1);
            const isShortLastLine = lineIndex === lines.length - 1 && lineWidth < contentWidth * 0.75;
            const extra = isShortLastLine ? 0 : (contentWidth - lineWidth) / line.cards.length;
            for (const card of line.cards) {
                card.width += extra;
                card.labelLines = card.row.label ? doc.splitTextToSize(card.row.label, card.width - cardPadding * 2) : [];
            }
            const maxLabelLines = Math.max(...line.cards.map((card) => card.labelLines.length));
            line.labelHeight = maxLabelLines ? maxLabelLines * labelLineHeight + 6 * k : 0;
            line.height = cardPadding + line.labelHeight + cellHeight + cardPadding * 0.5;
        });
        const drawCard = (card, x, y, line) => {
            doc.setLineWidth(0.75);
            doc.setDrawColor("#e5e7eb");
            doc.setFillColor("#fafafa");
            doc.roundedRect(x, y, card.width, line.height, 6, 6, "FD");
            if (card.labelLines.length) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(labelFontSize);
                doc.setTextColor("#1e293b");
                card.labelLines.forEach((text, i) => {
                    doc.text(text, x + cardPadding, y + cardPadding + labelFontSize * 0.8 + i * labelLineHeight);
                });
            }
            const top = y + cardPadding + line.labelHeight;
            let cellX = x + (card.width - card.row.entries.length * cellWidth) / 2;
            for (const entry of card.row.entries) {
                const cx = cellX + cellWidth / 2;
                doc.setLineWidth(0.6);
                doc.setDrawColor("#9ca3af");
                doc.setFillColor(entry.color[0], entry.color[1], entry.color[2]);
                doc.circle(cx, top + radius, radius, "FD");
                let textY = top + radius * 2 + 10 * k;
                doc.setFont("helvetica", "bold");
                doc.setFontSize(Math.max(6, 9 * k));
                doc.setTextColor("#111827");
                doc.text(String(entry.number), cx, textY, { align: "center" });
                if (hasCodes) {
                    textY += 8.5 * k;
                    if (entry.code) {
                        doc.setFontSize(Math.max(5, 7.5 * k));
                        doc.setTextColor("#334155");
                        doc.text(entry.code, cx, textY, { align: "center" });
                    }
                }
                textY += 8 * k;
                doc.setFont("helvetica", "normal");
                doc.setFontSize(Math.max(4.5, 6.5 * k));
                doc.setTextColor("#6b7280");
                doc.text(entry.hex, cx, textY, { align: "center" });
                cellX += cellWidth;
            }
        };
        doc.addPage();
        let y = PAGE_MARGIN;
        const colorCount = rows.reduce((sum, row) => sum + row.entries.length, 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor("#111827");
        doc.text(title, PAGE_MARGIN, y + 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor("#6b7280");
        doc.text(colorCount + " colors" + (isGrouped ? " · " + rows.length + " families" : ""), pageWidth - PAGE_MARGIN, y + 12, { align: "right" });
        y += 22;
        doc.setDrawColor("#e5e7eb");
        doc.setLineWidth(0.75);
        doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
        y += 12;
        for (const line of lines) {
            if (y + line.height > pageHeight - PAGE_MARGIN) {
                doc.addPage();
                y = PAGE_MARGIN;
            }
            let x = PAGE_MARGIN;
            for (const card of line.cards) {
                drawCard(card, x, y, line);
                x += card.width + cardGap;
            }
            y += line.height + cardGap;
        }
    }
});
/**
 * Product mockup geometry, shared by the website and the API: the "perfect kit" photos and where the canvas,
 * the image card and the reference sheet sit on them.
 *
 * The kit photos are flat lays shot from above, so every placeholder is an upright or rotated rectangle: the
 * mockup only needs resizing, one rotation and masking. The costly part (erasing the drawing printed on the
 * template's sheet, cutting out the brushes lying on it) is done once by server/scripts/prepare-mockups.js,
 * which writes the "-blank" and "-overlay" images next to the kit photos in /mockups, and a script embedding
 * both for the website.
 */
define("core/mockup", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MOCKUP_KITS_GLOBAL = exports.MOCKUP_STYLE = exports.MOCKUP_TEMPLATES = void 0;
    exports.pickMockupTemplate = pickMockupTemplate;
    exports.insetBox = insetBox;
    exports.sheetGeometry = sheetGeometry;
    exports.darkenForSheet = darkenForSheet;
    exports.coverSource = coverSource;
    exports.containBox = containBox;
    /** Placeholder positions, measured on the 1254 x 1254 kit photos */
    exports.MOCKUP_TEMPLATES = {
        landscape: {
            name: "landscape",
            source: "kit-landscape.webp",
            blank: "kit-landscape-blank.webp",
            overlay: "kit-landscape-overlay.png",
            script: "kit-landscape.js",
            size: 1254,
            canvas: { left: 288, top: 321, width: 683, height: 534 },
            card: { left: 53, top: 324, width: 184, height: 183 },
            sheet: [[628, 189], [1213, 330], [1083.4, 868.5], [498.4, 727.5]],
        },
        portrait: {
            name: "portrait",
            source: "kit-portrait.webp",
            blank: "kit-portrait-blank.webp",
            overlay: "kit-portrait-overlay.png",
            script: "kit-portrait.js",
            size: 1254,
            canvas: { left: 313, top: 172, width: 629, height: 752 },
            card: { left: 68, top: 356, width: 172, height: 187 },
            sheet: [[784.1, 184.4], [1167, 357], [884.4, 886.3], [501.5, 713.6]],
        },
    };
    exports.MOCKUP_STYLE = {
        /** The art covers the canvas face exactly: its box is measured on the face, bevel included */
        canvasEdge: 0,
        /** Pixels kept free along the image card's border, so its edge and shadow stay visible */
        cardEdge: 2,
        /** The reference sheet print is darker than the canvas: 1 keeps the tone, higher is darker (white stays white) */
        sheetDarken: 1.15,
        /** White margin around the print on the reference sheet, as a share of the sheet's shorter side */
        sheetMargin: 0.035,
    };
    /** The kit whose canvas shape is closest to the painting's (width / height) */
    function pickMockupTemplate(aspect) {
        const distance = (t) => Math.abs(Math.log((t.canvas.width / t.canvas.height) / aspect));
        return distance(exports.MOCKUP_TEMPLATES.landscape) <= distance(exports.MOCKUP_TEMPLATES.portrait) ? exports.MOCKUP_TEMPLATES.landscape : exports.MOCKUP_TEMPLATES.portrait;
    }
    function insetBox(box, by) {
        return { left: box.left + by, top: box.top + by, width: box.width - 2 * by, height: box.height - 2 * by };
    }
    /**
     * The reference sheet as an upright rectangle (width x height, with the print's margin) and the affine
     * matrix [a, b, c, d, e, f] that maps it onto the rotated sheet in the photo.
     */
    function sheetGeometry(template) {
        const [topLeft, topRight, , bottomLeft] = template.sheet;
        const width = Math.round(Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]));
        const height = Math.round(Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]));
        return {
            width,
            height,
            margin: Math.round(Math.min(width, height) * exports.MOCKUP_STYLE.sheetMargin),
            matrix: [
                (topRight[0] - topLeft[0]) / width,
                (topRight[1] - topLeft[1]) / width,
                (bottomLeft[0] - topLeft[0]) / height,
                (bottomLeft[1] - topLeft[1]) / height,
                topLeft[0],
                topLeft[1],
            ],
        };
    }
    /** Darkens a grey value for the reference sheet print, keeping white white */
    function darkenForSheet(value) {
        return Math.max(0, Math.min(255, 255 - (255 - value) * exports.MOCKUP_STYLE.sheetDarken));
    }
    /** The source rectangle to draw so that an image fills a box without distortion (CSS "cover", centred) */
    function coverSource(sourceWidth, sourceHeight, boxWidth, boxHeight) {
        const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
        const width = boxWidth / scale;
        const height = boxHeight / scale;
        return { left: (sourceWidth - width) / 2, top: (sourceHeight - height) / 2, width, height };
    }
    /** Where a kit's script (see MockupTemplate.script) puts its layers, as data URLs */
    exports.MOCKUP_KITS_GLOBAL = "DARLART_MOCKUP_KITS";
    /** Where to draw an image so it fits whole in a box, keeping its ratio (CSS "contain", centred), in whole pixels */
    function containBox(sourceWidth, sourceHeight, box) {
        const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        return { left: box.left + Math.round((box.width - width) / 2), top: box.top + Math.round((box.height - height) / 2), width, height };
    }
});
define("core/settings", ["require", "exports", "settings"], function (require, exports, settings_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DEFAULT_RANDOM_SEED = exports.DIFFICULTIES = exports.DIFFICULTY_PRESETS = void 0;
    exports.parseCustomColors = parseCustomColors;
    exports.applyDifficultyPreset = applyDifficultyPreset;
    exports.buildSettings = buildSettings;
    exports.DIFFICULTY_PRESETS = {
        // Simple shapes, large paint areas
        easy: {
            resizeImageIfTooLarge: true,
            resizeImageWidth: 1024,
            resizeImageHeight: 1024,
            kMeansMinDeltaDifference: 1,
            kMeansClusteringColorSpace: settings_2.ClusteringColorSpace.RGB,
            narrowPixelStripCleanupRuns: 3,
            removeFacetsSmallerThanNrOfPoints: 160,
            maximumNumberOfFacets: 10000,
            removeFacetsFromLargeToSmall: true,
            nrOfTimesToHalveBorderSegments: 3,
        },
        // Balanced detail and simplicity
        medium: {
            resizeImageIfTooLarge: true,
            resizeImageWidth: 1024,
            resizeImageHeight: 1024,
            kMeansMinDeltaDifference: 1,
            kMeansClusteringColorSpace: settings_2.ClusteringColorSpace.RGB,
            narrowPixelStripCleanupRuns: 3,
            removeFacetsSmallerThanNrOfPoints: 110,
            maximumNumberOfFacets: 35000,
            removeFacetsFromLargeToSmall: true,
            nrOfTimesToHalveBorderSegments: 2,
        },
        // Detailed patterns with many small areas
        hard: {
            resizeImageIfTooLarge: true,
            resizeImageWidth: 1024,
            resizeImageHeight: 1024,
            kMeansMinDeltaDifference: 1,
            kMeansClusteringColorSpace: settings_2.ClusteringColorSpace.RGB,
            narrowPixelStripCleanupRuns: 5,
            removeFacetsSmallerThanNrOfPoints: 30,
            maximumNumberOfFacets: 100000,
            removeFacetsFromLargeToSmall: true,
            nrOfTimesToHalveBorderSegments: 2,
        },
    };
    exports.DIFFICULTIES = ["easy", "medium", "hard"];
    /** Fixed seed so the same photo and options always give the same template */
    exports.DEFAULT_RANDOM_SEED = 7707;
    function parseHexToRgb(hexStr) {
        let clean = hexStr.trim().replace(/^#/, "");
        if (clean.length === 3) {
            clean = clean.split("").map((ch) => ch + ch).join("");
        }
        if (clean.length === 6) {
            const r = parseInt(clean.substring(0, 2), 16);
            const g = parseInt(clean.substring(2, 4), 16);
            const b = parseInt(clean.substring(4, 6), 16);
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                return [r, g, b];
            }
        }
        return null;
    }
    function toHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    /**
     * Parses the custom colors text: a JSON dictionary / array, or one color per line
     * as "#hex", "#hex, code", "r,g,b" or "r,g,b, code". Lines starting with // are comments.
     */
    function parseCustomColors(text) {
        const result = { restrictions: [], codes: {} };
        const rawText = text || "";
        const rawTrimmed = rawText.trim();
        const seenColors = new Set();
        function addColor(r, g, b, code) {
            if (isNaN(r) || isNaN(g) || isNaN(b)) {
                return;
            }
            r = Math.max(0, Math.min(255, Math.floor(r)));
            g = Math.max(0, Math.min(255, Math.floor(g)));
            b = Math.max(0, Math.min(255, Math.floor(b)));
            const rgbKey = `${r},${g},${b}`;
            const hexKey = toHex(r, g, b).toUpperCase();
            if (!seenColors.has(rgbKey)) {
                seenColors.add(rgbKey);
                result.restrictions.push([r, g, b]);
            }
            if (code && code.trim()) {
                const cleanCode = code.trim().replace(/^["']|["']$/g, "");
                result.codes[rgbKey] = cleanCode;
                result.codes[hexKey] = cleanCode;
                result.codes[hexKey.toLowerCase()] = cleanCode;
            }
        }
        /** The paint code of a JSON value: "0101", { code: "0101" }, { id: … } or { name: … } */
        function codeFromValue(value) {
            if (value === undefined || value === null) {
                return undefined;
            }
            if (typeof value === "object") {
                const code = value.code !== undefined ? value.code : (value.id !== undefined ? value.id : value.name);
                return code === undefined || code === null ? undefined : String(code);
            }
            return String(value);
        }
        /** The color of a JSON value when the key isn't one: { rgb: [r, g, b] } or { hex: "#…" } */
        function rgbFromValue(value) {
            if (!value || typeof value !== "object") {
                return null;
            }
            if (Array.isArray(value.rgb) && value.rgb.length >= 3) {
                return [Number(value.rgb[0]), Number(value.rgb[1]), Number(value.rgb[2])];
            }
            return parseHexToRgb(value.hex || value.color || "");
        }
        // 1. JSON: { "#FC6286": "0101" }, { "#FC6286": { "code": "0101", "rgb": [252,98,134] } }
        //    or [ { "color": "#FC6286", "code": "0101" } ]
        let jsonParsed = false;
        if (rawTrimmed.startsWith("{") || rawTrimmed.startsWith("[")) {
            try {
                const parsed = JSON.parse(rawTrimmed);
                if (typeof parsed === "object" && parsed !== null) {
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            if (typeof item === "string") {
                                const rgb = parseHexToRgb(item);
                                if (rgb) {
                                    addColor(rgb[0], rgb[1], rgb[2]);
                                }
                            }
                            else if (typeof item === "object" && item !== null) {
                                const rgb = parseHexToRgb(item.color || item.hex || "") || rgbFromValue(item);
                                if (rgb) {
                                    addColor(rgb[0], rgb[1], rgb[2], codeFromValue(item));
                                }
                            }
                        }
                    }
                    else {
                        for (const key of Object.keys(parsed)) {
                            const val = parsed[key];
                            const codeVal = codeFromValue(val);
                            if (key.startsWith("#")) {
                                const rgb = parseHexToRgb(key);
                                if (rgb) {
                                    addColor(rgb[0], rgb[1], rgb[2], codeVal);
                                }
                            }
                            else if (key.includes(",")) {
                                const parts = key.split(",");
                                if (parts.length === 3) {
                                    addColor(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), codeVal);
                                }
                            }
                            else {
                                // the key is a name or a code: the color itself is in the value
                                const rgb = rgbFromValue(val);
                                if (rgb) {
                                    addColor(rgb[0], rgb[1], rgb[2], codeVal || key);
                                }
                            }
                        }
                    }
                    jsonParsed = result.restrictions.length > 0;
                }
            }
            catch (e) {
                // not valid JSON, fall back to line-by-line parsing
            }
        }
        // 2. Line-by-line
        if (!jsonParsed) {
            for (const line of rawText.split("\n")) {
                const tline = line.trim();
                if (!tline || tline.startsWith("//")) {
                    continue;
                }
                if (tline.startsWith("#")) {
                    // "#FC6286, 0101" or "#FC6286: 0101" or "#FC6286 0101" or "#FC6286"
                    const match = tline.match(/^#([0-9a-fA-F]{3,8})([,:\s]+(.+))?$/);
                    if (match) {
                        const rgb = parseHexToRgb("#" + match[1]);
                        if (rgb) {
                            addColor(rgb[0], rgb[1], rgb[2], match[3] ? match[3].trim() : undefined);
                        }
                    }
                }
                else if (tline.includes(",")) {
                    // "252, 98, 134, 0101" or "252, 98, 134: 0101" or "252, 98, 134"
                    const parts = tline.split(",");
                    if (parts.length >= 4) {
                        addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(parts[2].trim()), parts.slice(3).join(",").trim());
                    }
                    else if (parts.length === 3) {
                        const p2 = parts[2].trim();
                        const submatch = p2.match(/^(\d+)([:\s]+(.+))?$/);
                        if (submatch) {
                            addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(submatch[1]), submatch[3] ? submatch[3].trim() : undefined);
                        }
                        else {
                            addColor(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(p2));
                        }
                    }
                }
            }
        }
        return result;
    }
    function applyDifficultyPreset(settings, difficulty) {
        const preset = exports.DIFFICULTY_PRESETS[difficulty];
        settings.resizeImageIfTooLarge = preset.resizeImageIfTooLarge;
        settings.resizeImageWidth = preset.resizeImageWidth;
        settings.resizeImageHeight = preset.resizeImageHeight;
        settings.kMeansMinDeltaDifference = preset.kMeansMinDeltaDifference;
        settings.kMeansClusteringColorSpace = preset.kMeansClusteringColorSpace;
        settings.narrowPixelStripCleanupRuns = preset.narrowPixelStripCleanupRuns;
        settings.removeFacetsSmallerThanNrOfPoints = preset.removeFacetsSmallerThanNrOfPoints;
        settings.maximumNumberOfFacets = preset.maximumNumberOfFacets;
        settings.removeFacetsFromLargeToSmall = preset.removeFacetsFromLargeToSmall;
        settings.nrOfTimesToHalveBorderSegments = preset.nrOfTimesToHalveBorderSegments;
    }
    function buildSettings(options) {
        const settings = new settings_2.Settings();
        applyDifficultyPreset(settings, options.difficulty);
        settings.kMeansNrOfClusters = options.colors;
        settings.randomSeed = typeof options.randomSeed === "number" ? options.randomSeed : exports.DEFAULT_RANDOM_SEED;
        if (options.customColors && options.customColors.trim()) {
            const parsed = parseCustomColors(options.customColors);
            settings.kMeansColorRestrictions = parsed.restrictions;
            settings.colorCodes = parsed.codes;
        }
        return settings;
    }
});
define("core/pipeline", ["require", "exports", "colorreductionmanagement", "facetBorderSegmenter", "facetBorderTracer", "facetCreator", "facetLabelPlacer", "facetmanagement", "facetReducer", "core/palette"], function (require, exports, colorreductionmanagement_2, facetBorderSegmenter_1, facetBorderTracer_1, facetCreator_3, facetLabelPlacer_1, facetmanagement_4, facetReducer_1, palette_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PIPELINE_STEPS = void 0;
    exports.runPipeline = runPipeline;
    exports.PIPELINE_STEPS = ["kmeans", "facetBuilding", "facetReduction", "borderTracing", "borderSegmentation", "labelPlacement"];
    function runPipeline(image_1, settings_3) {
        return __awaiter(this, arguments, void 0, function* (image, settings, callbacks = {}) {
            const state = {};
            const report = (step, progress) => {
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
            yield colorreductionmanagement_2.ColorReducer.applyKMeansClustering(image, kmeansImage, null, settings, (kmeans) => {
                const delta = kmeans.currentDeltaDistanceDifference > 100 ? 100 : kmeans.currentDeltaDistanceDifference;
                report("kmeans", (100 - delta) / 100);
            });
            report("kmeans", 1);
            // build color map
            const colormapResult = colorreductionmanagement_2.ColorReducer.createColorMap(kmeansImage);
            state.colormapResult = colormapResult;
            // If custom color restrictions were specified, ensure the color map covers all custom colors up to the requested count
            if (settings.kMeansColorRestrictions.length > 0) {
                const targetCount = Math.min(settings.kMeansNrOfClusters, settings.kMeansColorRestrictions.length);
                if (colormapResult.colorsByIndex.length < targetCount) {
                    const presentKeys = new Set(colormapResult.colorsByIndex.map((c) => `${c[0]},${c[1]},${c[2]}`));
                    for (const col of settings.kMeansColorRestrictions) {
                        if (colormapResult.colorsByIndex.length >= targetCount) {
                            break;
                        }
                        const rgb = typeof col === "string" ? settings.colorAliases[col] : col;
                        if (rgb) {
                            const cleanRgb = [Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2])];
                            const key = `${cleanRgb[0]},${cleanRgb[1]},${cleanRgb[2]}`;
                            if (!presentKeys.has(key)) {
                                presentKeys.add(key);
                                colormapResult.colorsByIndex.push(cleanRgb);
                            }
                        }
                    }
                }
            }
            let facetResult = new facetmanagement_4.FacetResult();
            const buildAndReduceFacets = () => __awaiter(this, void 0, void 0, function* () {
                facetResult = yield facetCreator_3.FacetCreator.getFacets(colormapResult.width, colormapResult.height, colormapResult.imgColorIndices, (progress) => {
                    report("facetBuilding", progress);
                });
                state.facetResult = facetResult;
                report("facetBuilding", 1);
                yield facetReducer_1.FacetReducer.reduceFacets(settings.removeFacetsSmallerThanNrOfPoints, settings.removeFacetsFromLargeToSmall, settings.maximumNumberOfFacets, colormapResult.colorsByIndex, facetResult, colormapResult.imgColorIndices, (progress) => {
                    report("facetReduction", progress);
                });
                report("facetReduction", 1);
            });
            if (settings.narrowPixelStripCleanupRuns === 0) {
                yield buildAndReduceFacets();
            }
            else {
                for (let run = 0; run < settings.narrowPixelStripCleanupRuns; run++) {
                    // clean up narrow pixel strips; imgColorIndices get updated as the facets are reduced, so do a few runs
                    yield colorreductionmanagement_2.ColorReducer.processNarrowPixelStripCleanup(colormapResult);
                    yield buildAndReduceFacets();
                }
            }
            // facet border tracing
            yield facetBorderTracer_1.FacetBorderTracer.buildFacetBorderPaths(facetResult, (progress) => {
                report("borderTracing", progress);
            });
            report("borderTracing", 1);
            // facet border segmentation
            yield facetBorderSegmenter_1.FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments, (progress) => {
                report("borderSegmentation", progress);
            });
            report("borderSegmentation", 1);
            // facet label placement
            yield facetLabelPlacer_1.FacetLabelPlacer.buildFacetLabelBounds(facetResult, (progress) => {
                report("labelPlacement", progress);
            });
            report("labelPlacement", 1);
            const colorCodes = settings.colorCodes || {};
            const colorsByIndex = (0, palette_2.reorderColorsByFamily)(colormapResult.colorsByIndex, colorCodes, facetResult);
            return {
                facetResult,
                colorsByIndex,
                colorCodes,
                width: facetResult.width,
                height: facetResult.height,
            };
        });
    }
});
/**
 * Module that manages the GUI when processing: runs the shared pipeline (src/core/pipeline.ts)
 * and shows its progress and intermediate results
 */
define("guiprocessmanager", ["require", "exports", "core/pipeline", "core/svg", "gui"], function (require, exports, pipeline_1, svg_2, gui_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.GUIProcessManager = exports.ProcessResult = void 0;
    class ProcessResult {
        constructor() {
            this.colorCodes = {};
        }
    }
    exports.ProcessResult = ProcessResult;
    const STEP_UI = {
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
    class GUIProcessManager {
        static process(settings, cancellationToken) {
            return __awaiter(this, void 0, void 0, function* () {
                const c = document.getElementById("canvas");
                const ctx = c.getContext("2d");
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
                    tempCanvas.getContext("2d").drawImage(c, 0, 0, width, height);
                    c.width = width;
                    c.height = height;
                    ctx.drawImage(tempCanvas, 0, 0, width, height);
                    imgData = ctx.getImageData(0, 0, c.width, c.height);
                }
                // reset progress
                $(".status .progress .determinate").css("width", "0px");
                $(".status").removeClass("complete");
                const tabsOutput = M.Tabs.getInstance(document.getElementById("tabsOutput"));
                const cKmeans = document.getElementById("cKMeans");
                const ctxKmeans = cKmeans.getContext("2d");
                // an object so TypeScript doesn't narrow the step to null after the callbacks
                const tracker = { step: null };
                const result = yield (0, pipeline_1.runPipeline)(imgData, settings, {
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
                                (0, gui_1.timeEnd)(STEP_UI[tracker.step].label);
                            }
                            tracker.step = step;
                            (0, gui_1.time)(ui.label);
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
                    (0, gui_1.timeEnd)(STEP_UI[tracker.step].label);
                }
                $(".status").removeClass("active");
                const processResult = new ProcessResult();
                processResult.facetResult = result.facetResult;
                processResult.colorsByIndex = result.colorsByIndex;
                processResult.colorCodes = result.colorCodes;
                return processResult;
            });
        }
        /** Draws the intermediate result of a finished step on its (hidden) debug canvas */
        static drawPreview(step, state, ctxKmeans) {
            if (step === "kmeans") {
                if (state.kmeansImage) {
                    ctxKmeans.putImageData(state.kmeansImage, 0, 0);
                }
                return;
            }
            const facetResult = state.facetResult;
            if (!facetResult) {
                return;
            }
            if (step === "facetReduction" && state.colormapResult) {
                GUIProcessManager.drawFacetColors(facetResult, state.colormapResult);
            }
            else if (step === "borderTracing") {
                GUIProcessManager.drawBorderPaths(facetResult);
            }
            else if (step === "borderSegmentation") {
                GUIProcessManager.drawBorderSegments(facetResult);
            }
            else if (step === "labelPlacement") {
                GUIProcessManager.drawLabelBounds(facetResult);
            }
        }
        static getCanvas(id, facetResult) {
            const canvas = document.getElementById(id);
            canvas.width = facetResult.width;
            canvas.height = facetResult.height;
            const context = canvas.getContext("2d");
            context.fillStyle = "white";
            context.fillRect(0, 0, canvas.width, canvas.height);
            return { canvas, context };
        }
        static drawFacetColors(facetResult, colormapResult) {
            const { context } = GUIProcessManager.getCanvas("cReduction", facetResult);
            const imageData = context.getImageData(0, 0, facetResult.width, facetResult.height);
            let idx = 0;
            for (let j = 0; j < facetResult.height; j++) {
                for (let i = 0; i < facetResult.width; i++) {
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
        static drawBorderPaths(facetResult) {
            const { context } = GUIProcessManager.getCanvas("cBorderPath", facetResult);
            for (const f of facetResult.facets) {
                if (f != null && f.borderPath != null && f.borderPath.length > 0) {
                    context.beginPath();
                    context.moveTo(f.borderPath[0].getWallX(), f.borderPath[0].getWallY());
                    for (let i = 1; i < f.borderPath.length; i++) {
                        context.lineTo(f.borderPath[i].getWallX(), f.borderPath[i].getWallY());
                    }
                    context.stroke();
                }
            }
        }
        static drawBorderSegments(facetResult) {
            const { context } = GUIProcessManager.getCanvas("cBorderSegmentation", facetResult);
            for (const f of facetResult.facets) {
                if (f != null && f.borderSegments != null) {
                    const path = f.getFullPathFromBorderSegments(false);
                    if (path.length === 0) {
                        continue;
                    }
                    context.beginPath();
                    context.moveTo(path[0].x, path[0].y);
                    for (let i = 1; i < path.length; i++) {
                        context.lineTo(path[i].x, path[i].y);
                    }
                    context.stroke();
                }
            }
        }
        static drawLabelBounds(facetResult) {
            const segmentation = document.getElementById("cBorderSegmentation");
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
        static createSVG(facetResult_1, colorsByIndex_1, sizeMultiplier_1, fill_2, stroke_1, addColorLabels_1) {
            return __awaiter(this, arguments, void 0, function* (facetResult, colorsByIndex, sizeMultiplier, fill, stroke, addColorLabels, fontSize = 50, fontColor = "black", onUpdate = null) {
                const svgString = (0, svg_2.buildSvgString)(facetResult, colorsByIndex, { sizeMultiplier, fill, stroke, labels: addColorLabels, fontSize, fontColor, labelContrast: true });
                const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
                const svg = document.importNode(parsed.documentElement, true);
                if (onUpdate != null) {
                    onUpdate(1);
                }
                return svg;
            });
        }
    }
    exports.GUIProcessManager = GUIProcessManager;
});
/**
 * Module that provides function the GUI uses and updates the DOM accordingly
 */
define("gui", ["require", "exports", "common", "core/palette", "core/pdf", "core/mockup", "core/settings", "core/svg", "guiprocessmanager", "palettefamilies"], function (require, exports, common_7, palette_3, pdf_1, mockup_1, settings_3, svg_3, guiprocessmanager_1, palettefamilies_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.time = time;
    exports.timeEnd = timeEnd;
    exports.log = log;
    exports.parseSettings = parseSettings;
    exports.process = process;
    exports.updateOutput = updateOutput;
    exports.downloadPalettePng = downloadPalettePng;
    exports.downloadPNG = downloadPNG;
    exports.downloadBlankSVG = downloadBlankSVG;
    exports.downloadCanvasPNG = downloadCanvasPNG;
    exports.buildMockupCanvas = buildMockupCanvas;
    exports.downloadMockupPNG = downloadMockupPNG;
    exports.downloadSVG = downloadSVG;
    exports.loadExample = loadExample;
    exports.buildTemplatePdf = buildTemplatePdf;
    exports.buildPaintingPdfDoc = buildPaintingPdfDoc;
    let processResult = null;
    /** The (cropped) photo that processResult was made from, for the mockup's image card */
    let processedPhoto = null;
    let cancellationToken = new common_7.CancellationToken();
    const timers = {};
    function time(name) {
        console.time(name);
        timers[name] = new Date();
    }
    function timeEnd(name) {
        console.timeEnd(name);
        const ms = new Date().getTime() - timers[name].getTime();
        log(name + ": " + ms + "ms");
        delete timers[name];
    }
    function log(str) {
        $("#log").append("<br/><span>" + str + "</span>");
    }
    /**
     * Settings from the website controls, built by the shared core (same presets and seed as the API)
     */
    function parseSettings() {
        const colors = parseInt($("#colorsSlider").val() + "", 10) || parseInt($("#txtNrOfClusters").val() + "", 10) || 24;
        const difficultyValue = Math.round(parseFloat($("#difficultySlider").val() + ""));
        const difficulty = difficultyValue === 1 ? "easy" : (difficultyValue === 3 ? "hard" : "medium");
        const customColors = ($("#colorRestrictionsInput").val() ? $("#colorRestrictionsInput").val() : $("#txtKMeansColorRestrictions").val()) + "";
        return (0, settings_3.buildSettings)({ colors, difficulty, customColors });
    }
    function process() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const settings = parseSettings();
                // cancel old process & create new
                cancellationToken.isCancelled = true;
                cancellationToken = new common_7.CancellationToken();
                const photo = snapshotCanvas(document.getElementById("canvas"));
                processResult = yield guiprocessmanager_1.GUIProcessManager.process(settings, cancellationToken);
                processedPhoto = photo;
                yield updateOutput();
                const tabsOutput = M.Tabs.getInstance(document.getElementById("tabsOutput"));
                tabsOutput.select("output-pane");
            }
            catch (e) {
                log("Error: " + e.message + " at " + e.stack);
            }
        });
    }
    function updateOutput() {
        return __awaiter(this, void 0, void 0, function* () {
            if (processResult != null) {
                const showLabels = $("#chkShowLabels").prop("checked");
                const fill = $("#chkFillFacets").prop("checked");
                const stroke = $("#chkShowBorders").prop("checked");
                const sizeMultiplier = parseInt($("#txtSizeMultiplier").val() + "");
                const fontSize = parseInt($("#txtLabelFontSize").val() + "");
                const fontColor = $("#txtLabelFontColor").val() + "";
                $("#statusSVGGenerate").css("width", "0%");
                $(".status.SVGGenerate").removeClass("complete");
                $(".status.SVGGenerate").addClass("active");
                const svg = yield guiprocessmanager_1.GUIProcessManager.createSVG(processResult.facetResult, processResult.colorsByIndex, sizeMultiplier, fill, stroke, showLabels, fontSize, fontColor, (progress) => {
                    if (cancellationToken.isCancelled) {
                        throw new Error("Cancelled");
                    }
                    $("#statusSVGGenerate").css("width", Math.round(progress * 100) + "%");
                });
                $("#svgContainer").empty().append(svg);
                const paletteElements = createPaletteHtml(processResult.colorsByIndex, processResult.colorCodes);
                $("#palette").empty().append(paletteElements.clone());
                $("#newPalette").empty().append(paletteElements);
                try {
                    $("#palette .color, #newPalette .color").tooltip();
                }
                catch (_) { }
                if (typeof window.groupPalettesByFamily === "function") {
                    window.groupPalettesByFamily();
                }
                $(".status").removeClass("active");
                $(".status.SVGGenerate").addClass("complete");
            }
        });
    }
    function createPaletteHtml(colorsByIndex, colorCodes = {}) {
        let html = "";
        for (let c = 0; c < colorsByIndex.length; c++) {
            const r = colorsByIndex[c][0];
            const g = colorsByIndex[c][1];
            const b = colorsByIndex[c][2];
            const colorValue = `rgb(${r},${g},${b})`;
            const hexValue = rgbToHex(colorValue);
            const code = (0, palette_3.getColorCode)(colorsByIndex[c], colorCodes);
            const codeHtml = code ? `<div class="color-code">${code}</div>` : "";
            html += `
            <div class="color" data-tooltip="${r},${g},${b}">
                <div class="color-swatch" style="background-color: ${colorValue}"></div>
                <div class="color-number">${c + 1}</div>
                ${codeHtml}
                <div class="color-hex">${hexValue}</div>
            </div>
        `;
        }
        return $(html);
    }
    // Helper function to convert RGB to hex (matches ui-handler.js implementation)
    function rgbToHex(rgb) {
        if (!rgb)
            return '#000000';
        // Convert rgb(r,g,b) to hex
        const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }
        return '#000000';
    }
    function downloadPalettePng() {
        if (processResult == null) {
            return;
        }
        const colorsByIndex = processResult.colorsByIndex;
        const canvas = document.createElement("canvas");
        const nrOfItemsPerRow = 10;
        const nrRows = Math.ceil(colorsByIndex.length / nrOfItemsPerRow);
        const margin = 10;
        const cellWidth = 80;
        const cellHeight = 70;
        canvas.width = margin + nrOfItemsPerRow * (cellWidth + margin);
        canvas.height = margin + nrRows * (cellHeight + margin);
        const ctx = canvas.getContext("2d");
        ctx.translate(0.5, 0.5);
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < colorsByIndex.length; i++) {
            const color = colorsByIndex[i];
            const x = margin + (i % nrOfItemsPerRow) * (cellWidth + margin);
            const y = margin + Math.floor(i / nrOfItemsPerRow) * (cellHeight + margin);
            ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            ctx.fillRect(x, y, cellWidth, cellHeight - 20);
            ctx.strokeStyle = "#888";
            ctx.strokeRect(x, y, cellWidth, cellHeight - 20);
            const nrText = (i + 1) + "";
            ctx.fillStyle = "black";
            ctx.strokeStyle = "#CCC";
            ctx.font = "20px Tahoma";
            const nrTextSize = ctx.measureText(nrText);
            ctx.lineWidth = 2;
            ctx.strokeText(nrText, x + cellWidth / 2 - nrTextSize.width / 2, y + cellHeight / 2 - 5);
            ctx.fillText(nrText, x + cellWidth / 2 - nrTextSize.width / 2, y + cellHeight / 2 - 5);
            ctx.lineWidth = 1;
            ctx.font = "10px Tahoma";
            const rgbText = "RGB: " + Math.floor(color[0]) + "," + Math.floor(color[1]) + "," + Math.floor(color[2]);
            const rgbTextSize = ctx.measureText(rgbText);
            ctx.fillStyle = "black";
            ctx.fillText(rgbText, x + cellWidth / 2 - rgbTextSize.width / 2, y + cellHeight - 10);
        }
        const dataURL = canvas.toDataURL("image/png");
        const dl = document.createElement("a");
        document.body.appendChild(dl);
        dl.setAttribute("href", dataURL);
        dl.setAttribute("download", "palette.png");
        dl.click();
    }
    /** The finished painting: colors only, without outlines or numbers */
    function downloadPNG(filename) {
        if (processResult == null) {
            return;
        }
        const svgString = (0, svg_3.buildSvgString)(processResult.facetResult, processResult.colorsByIndex, { fill: true, stroke: false, labels: false });
        const svg = document.importNode(new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement, true);
        const defaultName = (typeof window.getOutputFilename === "function")
            ? window.getOutputFilename("png")
            : "paintbynumbers.png";
        saveSvgAsPng(svg, filename || defaultName, { backgroundColor: "#ffffff" });
    }
    /** The template to paint on: black outlines and numbers on white, no colors */
    function downloadBlankSVG(filename) {
        if (processResult == null) {
            return;
        }
        const svgString = (0, svg_3.buildBlankSvgString)(processResult.facetResult, processResult.colorsByIndex);
        const defaultName = (typeof window.getOutputFilename === "function")
            ? String(window.getOutputFilename("svg")).replace(/\.svg$/i, "-blank.svg")
            : "paintbynumbers-blank.svg";
        saveTextFile('<?xml version="1.0" standalone="no"?>\r\n' + svgString, filename || defaultName, "image/svg+xml;charset=utf-8");
    }
    function saveTextFile(content, filename, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    /** The template as a pre-printed canvas: faint colors, grey outlines and numbers (same look as the API's canvas.png) */
    function downloadCanvasPNG(filename) {
        if (processResult == null) {
            return;
        }
        const svgString = (0, svg_3.buildFadedSvgString)(processResult.facetResult, processResult.colorsByIndex, { sizeMultiplier: 3, strokeWidth: 1.2 });
        const svg = document.importNode(new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement, true);
        const defaultName = (typeof window.getOutputFilename === "function")
            ? String(window.getOutputFilename("png")).replace(/\.png$/i, "-canvas.png")
            : "paintbynumbers-canvas.png";
        saveSvgAsPng(svg, filename || defaultName, { backgroundColor: "#ffffff" });
    }
    function snapshotCanvas(source) {
        const copy = document.createElement("canvas");
        copy.width = source.width;
        copy.height = source.height;
        copy.getContext("2d").drawImage(source, 0, 0);
        return copy;
    }
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Could not load " + src));
            img.src = src;
        });
    }
    /** A kit's layers, from its script (loaded once): data URLs keep the canvas exportable even from a page opened as a file */
    function loadMockupKit(template) {
        const kits = () => window[mockup_1.MOCKUP_KITS_GLOBAL] || {};
        if (kits()[template.name]) {
            return Promise.resolve(kits()[template.name]);
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "mockups/" + template.script;
            script.onload = () => kits()[template.name] ? resolve(kits()[template.name]) : reject(new Error("Empty " + template.script));
            script.onerror = () => reject(new Error("Could not load " + script.src));
            document.head.appendChild(script);
        });
    }
    function drawCover(ctx, image, box) {
        const source = (0, mockup_1.coverSource)(image.width, image.height, box.width, box.height);
        ctx.drawImage(image, source.left, source.top, source.width, source.height, box.left, box.top, box.width, box.height);
    }
    /**
     * The "perfect kit" product photo for the last result, drawn the same way as the API's mockup.png: the faded
     * canvas on the canvas, a darker grey print of it on the reference sheet and the photo on the image card.
     */
    function buildMockupCanvas() {
        return __awaiter(this, void 0, void 0, function* () {
            if (processResult == null || processedPhoto == null) {
                return null;
            }
            const facets = processResult.facetResult;
            const template = (0, mockup_1.pickMockupTemplate)(facets.width / facets.height);
            const svgString = (0, svg_3.buildFadedSvgString)(facets, processResult.colorsByIndex, { sizeMultiplier: 2, strokeWidth: 1, background: "#ffffff" });
            // a data URL, not a blob: URL, which would block the export when the page is opened as a file
            const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
            const kit = yield loadMockupKit(template);
            const [blank, overlay, faded] = yield Promise.all([loadImage(kit.blank), loadImage(kit.overlay), loadImage(svgUrl)]);
            // the SVG as pixels, so it's rasterised once
            const art = document.createElement("canvas");
            art.width = faded.naturalWidth || facets.width * 2;
            art.height = faded.naturalHeight || facets.height * 2;
            const artCtx = art.getContext("2d");
            artCtx.fillStyle = "#ffffff";
            artCtx.fillRect(0, 0, art.width, art.height);
            artCtx.drawImage(faded, 0, 0, art.width, art.height);
            // the reference sheet print: grey, darker, with a white margin
            const sheet = (0, mockup_1.sheetGeometry)(template);
            const print = document.createElement("canvas");
            print.width = sheet.width;
            print.height = sheet.height;
            const printCtx = print.getContext("2d");
            printCtx.fillStyle = "#ffffff";
            printCtx.fillRect(0, 0, sheet.width, sheet.height);
            drawCover(printCtx, art, { left: sheet.margin, top: sheet.margin, width: sheet.width - 2 * sheet.margin, height: sheet.height - 2 * sheet.margin });
            const pixels = printCtx.getImageData(0, 0, sheet.width, sheet.height);
            const data = pixels.data;
            for (let i = 0; i < data.length; i += 4) {
                const grey = (0, mockup_1.darkenForSheet)(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
                data[i] = data[i + 1] = data[i + 2] = grey;
            }
            printCtx.putImageData(pixels, 0, 0);
            const out = document.createElement("canvas");
            out.width = template.size;
            out.height = template.size;
            const ctx = out.getContext("2d");
            ctx.drawImage(blank, 0, 0, template.size, template.size);
            ctx.save();
            ctx.beginPath();
            template.sheet.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
            ctx.closePath();
            ctx.clip();
            ctx.globalCompositeOperation = "multiply";
            const [a, b, c, d, e, f] = sheet.matrix;
            ctx.setTransform(a, b, c, d, e, f);
            ctx.drawImage(print, 0, 0);
            ctx.restore();
            // the canvas lies on top of the sheet, and the brushes and callout arcs on top of both
            const cv = template.canvas;
            ctx.drawImage(blank, cv.left, cv.top, cv.width, cv.height, cv.left, cv.top, cv.width, cv.height);
            ctx.drawImage(overlay, 0, 0, template.size, template.size);
            // the canvas covered edge to edge, the card with the whole photo at its own ratio; multiplied, so the
            // canvas weave and the card's edges still show through
            ctx.globalCompositeOperation = "multiply";
            drawCover(ctx, art, (0, mockup_1.insetBox)(template.canvas, mockup_1.MOCKUP_STYLE.canvasEdge));
            const card = (0, mockup_1.containBox)(processedPhoto.width, processedPhoto.height, (0, mockup_1.insetBox)(template.card, mockup_1.MOCKUP_STYLE.cardEdge));
            ctx.drawImage(processedPhoto, card.left, card.top, card.width, card.height);
            ctx.globalCompositeOperation = "source-over";
            return out;
        });
    }
    function downloadMockupPNG(filename) {
        return __awaiter(this, void 0, void 0, function* () {
            const canvas = yield buildMockupCanvas();
            if (canvas == null) {
                return;
            }
            const defaultName = (typeof window.getOutputFilename === "function")
                ? String(window.getOutputFilename("png")).replace(/\.png$/i, "-mockup.png")
                : "paintbynumbers-mockup.png";
            const blob = yield new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
            if (blob == null) {
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename || defaultName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    function downloadSVG(filename) {
        if ($("#svgContainer svg").length > 0) {
            const svgEl = $("#svgContainer svg").get(0);
            svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            const svgData = svgEl.outerHTML;
            const preface = '<?xml version="1.0" standalone="no"?>\r\n';
            const svgBlob = new Blob([preface, svgData], { type: "image/svg+xml;charset=utf-8" });
            const svgUrl = URL.createObjectURL(svgBlob);
            const downloadLink = document.createElement("a");
            downloadLink.href = svgUrl;
            const defaultName = (typeof window.getOutputFilename === "function")
                ? window.getOutputFilename("svg")
                : "paintbynumbers.svg";
            downloadLink.download = filename || defaultName;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            /*
            var svgAsXML = (new XMLSerializer).serializeToString(<any>$("#svgContainer svg").get(0));
            let dataURL = "data:image/svg+xml," + encodeURIComponent(svgAsXML);
            var dl = document.createElement("a");
            document.body.appendChild(dl);
            dl.setAttribute("href", dataURL);
            dl.setAttribute("download", "paintbynumbers.svg");
            dl.click();
            */
        }
    }
    function loadExample(imgId) {
        // load image
        const img = document.getElementById(imgId);
        if (img === null) {
            return;
        }
        const c = document.getElementById("canvas");
        const ctx = c.getContext("2d");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
    }
    /** PDF built by the shared core from the last result (same document as the API) */
    function buildTemplatePdf(paperSize = "a4") {
        const jspdf = window.jspdf;
        if (processResult == null || !jspdf || !jspdf.jsPDF) {
            return null;
        }
        const size = (pdf_1.PAPER_SIZES.indexOf(paperSize) >= 0 ? paperSize : "a4");
        return (0, pdf_1.buildPdf)(jspdf.jsPDF, processResult, { paperSize: size });
    }
    /** The painting guide: colored template with its numbers, then the palette */
    function buildPaintingPdfDoc(paperSize = "a4") {
        const jspdf = window.jspdf;
        if (processResult == null || !jspdf || !jspdf.jsPDF) {
            return null;
        }
        const size = (pdf_1.PAPER_SIZES.indexOf(paperSize) >= 0 ? paperSize : "a4");
        return (0, pdf_1.buildPaintingPdf)(jspdf.jsPDF, processResult, { paperSize: size });
    }
    try {
        window.downloadSVG = downloadSVG;
        window.downloadPNG = downloadPNG;
        window.downloadCanvasPNG = downloadCanvasPNG;
        window.buildMockupCanvas = buildMockupCanvas;
        window.downloadMockupPNG = downloadMockupPNG;
        window.findPaletteFamily = palettefamilies_2.findPaletteFamily;
        window.downloadPalettePng = downloadPalettePng;
        window.buildTemplatePdf = buildTemplatePdf;
        window.buildPaintingPdf = buildPaintingPdfDoc;
        window.downloadBlankSVG = downloadBlankSVG;
    }
    catch (_) { }
});
define("lib/clipboard", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Clipboard = void 0;
    // From https://stackoverflow.com/a/35576409/694640
    /**
     * image pasting into canvas
     *
     * @param {string} canvas_id - canvas id
     * @param {boolean} autoresize - if canvas will be resized
     */
    class Clipboard {
        constructor(canvas_id, autoresize) {
            this.ctrl_pressed = false;
            this.command_pressed = false;
            this.paste_event_support = false;
            const _self = this;
            this.canvas = document.getElementById(canvas_id);
            this.ctx = this.canvas.getContext("2d");
            this.autoresize = autoresize;
            // handlers
            // document.addEventListener("keydown", function (e) {
            //     _self.on_keyboard_action(e);
            // }, false); // firefox fix
            // document.addEventListener("keyup", function (e) {
            //     _self.on_keyboardup_action(e);
            // }, false); // firefox fix
            document.addEventListener("paste", function (e) {
                _self.paste_auto(e);
            }, false); // official paste handler
            this.init();
        }
        // constructor - we ignore security checks here
        init() {
            this.pasteCatcher = document.createElement("div");
            this.pasteCatcher.setAttribute("id", "paste_ff");
            this.pasteCatcher.setAttribute("contenteditable", "");
            this.pasteCatcher.style.cssText = "opacity:0;position:fixed;top:0px;left:0px;width:10px;margin-left:-20px;";
            document.body.appendChild(this.pasteCatcher);
            const _self = this;
            // create an observer instance
            const observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    if (_self.paste_event_support === true || _self.ctrl_pressed === false || mutation.type !== "childList") {
                        // we already got data in paste_auto()
                        return true;
                    }
                    // if paste handle failed - capture pasted object manually
                    if (mutation.addedNodes.length === 1) {
                        if (mutation.addedNodes[0].src !== undefined) {
                            // image
                            _self.paste_createImage(mutation.addedNodes[0].src);
                        }
                        // register cleanup after some time.
                        setTimeout(function () {
                            _self.pasteCatcher.innerHTML = "";
                        }, 20);
                    }
                    return false;
                });
            });
            const target = document.getElementById("paste_ff");
            const config = { attributes: true, childList: true, characterData: true };
            observer.observe(target, config);
        }
        // default paste action
        paste_auto(e) {
            this.paste_event_support = false;
            if (this.pasteCatcher !== undefined) {
                this.pasteCatcher.innerHTML = "";
            }
            if (e.clipboardData) {
                const items = e.clipboardData.items;
                if (items) {
                    this.paste_event_support = true;
                    // access data directly
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf("image") !== -1) {
                            // image
                            const blob = items[i].getAsFile();
                            const URLObj = window.URL || window.webkitURL;
                            const source = URLObj.createObjectURL(blob);
                            this.paste_createImage(source);
                            e.preventDefault();
                            return false;
                        }
                    }
                }
                else {
                    // wait for DOMSubtreeModified event
                    // https://bugzilla.mozilla.org/show_bug.cgi?id=891247
                }
            }
            return true;
        }
        // on keyboard press
        on_keyboard_action(event) {
            const k = event.keyCode;
            // ctrl
            if (k === 17 || event.metaKey || event.ctrlKey) {
                if (this.ctrl_pressed === false) {
                    this.ctrl_pressed = true;
                }
            }
            // v
            if (k === 86) {
                if (document.activeElement !== undefined && document.activeElement.type === "text") {
                    // let user paste into some input
                    return false;
                }
                if (this.ctrl_pressed === true && this.pasteCatcher !== undefined) {
                    this.pasteCatcher.focus();
                }
            }
            return true;
        }
        // on keyboard release
        on_keyboardup_action(event) {
            // ctrl
            if (event.ctrlKey === false && this.ctrl_pressed === true) {
                this.ctrl_pressed = false;
            }
            else if (event.metaKey === false && this.command_pressed === true) {
                this.command_pressed = false;
                this.ctrl_pressed = false;
            }
        }
        // draw pasted image to canvas
        paste_createImage(source) {
            const pastedImage = new Image();
            const self = this;
            pastedImage.onload = function () {
                if (self.autoresize === true) {
                    // resize
                    self.canvas.width = pastedImage.width;
                    self.canvas.height = pastedImage.height;
                }
                else {
                    // clear canvas
                    self.ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);
                }
                self.ctx.drawImage(pastedImage, 0, 0);
            };
            pastedImage.src = source;
        }
    }
    exports.Clipboard = Clipboard;
});
define("main", ["require", "exports", "gui", "lib/clipboard"], function (require, exports, gui_2, clipboard_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    $(document).ready(function () {
        $(".tabs").tabs();
        $(".tooltipped").tooltip();
        const clip = new clipboard_1.Clipboard("canvas", true);
        $("#file").change(function (ev) {
            const files = $("#file").get(0).files;
            if (files !== null && files.length > 0) {
                window.uploadedFileName = files[0].name;
                const reader = new FileReader();
                reader.onloadend = function () {
                    const img = document.createElement("img");
                    img.onload = () => {
                        const c = document.getElementById("canvas");
                        const ctx = c.getContext("2d");
                        c.width = img.naturalWidth;
                        c.height = img.naturalHeight;
                        ctx.drawImage(img, 0, 0);
                    };
                    img.onerror = () => {
                        alert("Unable to load image");
                    };
                    img.src = reader.result;
                };
                reader.readAsDataURL(files[0]);
            }
        });
        (0, gui_2.loadExample)("imgSmall");
        $("#btnProcess").click(function () {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    yield (0, gui_2.process)();
                }
                catch (err) {
                    alert("Error: " + err);
                }
            });
        });
        $("#chkShowLabels, #chkFillFacets, #chkShowBorders, #txtSizeMultiplier, #txtLabelFontSize, #txtLabelFontColor").change(() => __awaiter(this, void 0, void 0, function* () {
            yield (0, gui_2.updateOutput)();
        }));
        $("#btnDownloadSVG").click(function () {
            (0, gui_2.downloadSVG)();
        });
        $("#btnDownloadPNG").click(function () {
            (0, gui_2.downloadPNG)();
        });
        $("#btnDownloadPalettePNG").click(function () {
            (0, gui_2.downloadPalettePng)();
        });
        $("#lnkTrivial").click(() => { (0, gui_2.loadExample)("imgTrivial"); return false; });
        $("#lnkSmall").click(() => { (0, gui_2.loadExample)("imgSmall"); return false; });
        $("#lnkMedium").click(() => { (0, gui_2.loadExample)("imgMedium"); return false; });
    });
});
define("core/complexity", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.COMPLEXITY_THRESHOLDS = void 0;
    exports.measureComplexity = measureComplexity;
    exports.suggestDifficulty = suggestDifficulty;
    /**
     * Score thresholds. First calibration: a flat illustration scores ~0.05 (easy), a detailed photo ~0.19 (hard).
     * Refine them with real customer photos; the n8n AI vision step can also override the difficulty.
     */
    exports.COMPLEXITY_THRESHOLDS = { medium: 0.08, hard: 0.16 };
    const STRONG_EDGE = 60;
    const WEAK_EDGE = 16;
    const BLOCK = 16;
    function measureComplexity(image, maxSide = 512) {
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
            if (strongPerBlock[i] / pixelsPerBlock > 0.12) {
                detailed++;
            }
            if (weakPerBlock[i] / pixelsPerBlock > 0.3) {
                textured++;
            }
        }
        const edgeDensity = measured > 0 ? strongEdges / measured : 0;
        const detailedBlockRatio = detailed / strongPerBlock.length;
        const texturedBlockRatio = textured / strongPerBlock.length;
        const score = Math.min(1, 0.4 * Math.min(1, edgeDensity * 4) + 0.35 * detailedBlockRatio + 0.25 * texturedBlockRatio);
        return { edgeDensity, detailedBlockRatio, texturedBlockRatio, score };
    }
    function suggestDifficulty(image) {
        const metrics = measureComplexity(image);
        let difficulty = "easy";
        if (metrics.score >= exports.COMPLEXITY_THRESHOLDS.hard) {
            difficulty = "hard";
        }
        else if (metrics.score >= exports.COMPLEXITY_THRESHOLDS.medium) {
            difficulty = "medium";
        }
        return { difficulty, metrics };
    }
});
/**
 * Canvas sizes and crop geometry shared by the website and the API
 */
define("core/crop", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PRINT_FORMAT_IDS = exports.PRINT_FORMATS = exports.CANVAS_SIZES = void 0;
    exports.parseCanvasSize = parseCanvasSize;
    exports.parsePrintFormat = parsePrintFormat;
    exports.printFormatForCanvas = printFormatForCanvas;
    exports.resolveCanvasSize = resolveCanvasSize;
    exports.fitCropToAspect = fitCropToAspect;
    /** Canvas sizes in cm, as offered in the crop dialog (portrait form; landscape swaps them) */
    exports.CANVAS_SIZES = ["30x40", "40x50", "50x50", "60x70"];
    exports.PRINT_FORMATS = [
        { id: "a4", label: "A4", canvasSize: "21x29.7", widthCm: 21, heightCm: 29.7 },
        { id: "a3", label: "A3", canvasSize: "29.7x42", widthCm: 29.7, heightCm: 42 },
        { id: "a2", label: "A2", canvasSize: "42x59.4", widthCm: 42, heightCm: 59.4 },
    ];
    exports.PRINT_FORMAT_IDS = exports.PRINT_FORMATS.map((format) => format.id);
    function parseCanvasSize(size) {
        const match = (size || "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/);
        if (!match) {
            return null;
        }
        const a = parseFloat(match[1]);
        const b = parseFloat(match[2]);
        if (!(a > 0) || !(b > 0)) {
            return null;
        }
        return { a, b };
    }
    /** The print format named in a text, e.g. "A3", "Format A4 — 21 × 29,7 cm" */
    function parsePrintFormat(text) {
        const match = (text || "").match(/\ba\s*([234])\b/i);
        if (!match) {
            return null;
        }
        return exports.PRINT_FORMATS.find((format) => format.id === `a${match[1]}`) || null;
    }
    /** The print format of a canvas size in either orientation, e.g. "29.7x42" and "42x29.7" are both A3 */
    function printFormatForCanvas(size) {
        const parsed = parseCanvasSize(size);
        if (!parsed) {
            return null;
        }
        const short = Math.min(parsed.a, parsed.b);
        const long = Math.max(parsed.a, parsed.b);
        return exports.PRINT_FORMATS.find((format) => Math.abs(format.widthCm - short) < 0.05 && Math.abs(format.heightCm - long) < 0.05) || null;
    }
    /**
     * Resolves the canvas dimensions for a size like "40x50" and an orientation.
     * "auto" follows the photo: landscape when it's at least as wide as it is tall (same rule as the crop dialog).
     */
    function resolveCanvasSize(size, orientation, imageWidth, imageHeight) {
        const parsed = parseCanvasSize(size);
        if (!parsed) {
            throw new Error(`Invalid canvas size "${size}", expected e.g. "40x50"`);
        }
        const short = Math.min(parsed.a, parsed.b);
        const long = Math.max(parsed.a, parsed.b);
        let resolved;
        if (short === long) {
            resolved = "square";
        }
        else if (orientation === "auto") {
            resolved = imageWidth >= imageHeight ? "landscape" : "portrait";
        }
        else {
            resolved = orientation;
        }
        const widthCm = resolved === "landscape" ? long : short;
        const heightCm = resolved === "landscape" ? short : long;
        return { widthCm, heightCm, orientation: resolved, aspect: widthCm / heightCm, label: `${widthCm}x${heightCm}` };
    }
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    /**
     * Turns a (possibly imprecise, e.g. AI-proposed) crop box into a valid pixel box with the exact aspect ratio:
     * keeps the box center, grows the short side to match the aspect, shrinks when it doesn't fit the image and clamps inside the image.
     * Without a box, the largest centered crop is returned.
     */
    function fitCropToAspect(box, aspect, imageWidth, imageHeight) {
        let cx = imageWidth / 2;
        let cy = imageHeight / 2;
        let w = imageWidth;
        let h = imageHeight;
        const valid = box && [box.x, box.y, box.w, box.h].every((v) => typeof v === "number" && isFinite(v)) && box.w > 0 && box.h > 0;
        if (valid && box) {
            const x = clamp(box.x, 0, 1);
            const y = clamp(box.y, 0, 1);
            const bw = clamp(box.w, 0, 1 - x);
            const bh = clamp(box.h, 0, 1 - y);
            if (bw > 0 && bh > 0) {
                w = bw * imageWidth;
                h = bh * imageHeight;
                cx = (x + bw / 2) * imageWidth;
                cy = (y + bh / 2) * imageHeight;
            }
        }
        // grow the short side to the requested aspect
        if (w / h > aspect) {
            h = w / aspect;
        }
        else {
            w = h * aspect;
        }
        // shrink to fit inside the image
        if (w > imageWidth) {
            w = imageWidth;
            h = w / aspect;
        }
        if (h > imageHeight) {
            h = imageHeight;
            w = h * aspect;
        }
        const width = Math.max(1, Math.round(w));
        const height = Math.max(1, Math.round(h));
        const left = Math.round(clamp(cx - width / 2, 0, imageWidth - width));
        const top = Math.round(clamp(cy - height / 2, 0, imageHeight - height));
        return { left, top, width, height };
    }
});


// UI Handler for the new Davincified-style interface
// This file handles the new UI interactions while preserving existing functionality

// Initialize immediately if DOM is already ready (since RequireJS can delay this script)
(function(init){
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(function() {
    // Get references to UI elements
    const uploadArea = document.getElementById('uploadArea');
    const uploadContent = document.getElementById('uploadContent');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const fileInput = document.getElementById('file');
    const removeImageBtn = document.getElementById('removeImage');
    const changeImageBtn = document.getElementById('changeImage');
    const generateBtn = document.getElementById('generateBtn');
    const colorsSlider = document.getElementById('colorsSlider');
    const colorsValue = document.getElementById('colorsValue');
    const colorRestrictionsInput = document.getElementById('colorRestrictionsInput');
    const difficultySlider = document.getElementById('difficultySlider');
    const difficultyValue = document.getElementById('difficultyValue');
    const difficultyDescription = document.getElementById('difficultyDescription');
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const resultsSection = document.getElementById('resultsSection');
    const paperSizeSelect = document.getElementById('paperSize');
    const downloadBtn = document.getElementById('btnDownloadPDF');
    const downloadPngBtn = document.getElementById('btnDownloadPNG');
    const downloadCanvasBtn = document.getElementById('btnDownloadCanvasPNG');
    const downloadBlankSvgBtn = document.getElementById('btnDownloadBlankSVG');
    const downloadPaintingPdfBtn = document.getElementById('btnDownloadPaintingPDF');
    const downloadMockupBtn = document.getElementById('btnDownloadMockup');
    const downloadOutlineBtn = document.getElementById('btnDownloadOutline');
    const downloadPaletteBtn = document.getElementById('btnDownloadPalette');
    const toggleColorRestrictionsBtn = document.getElementById('toggleColorRestrictions');
    const colorRestrictionsContent = document.getElementById('colorRestrictionsContent');
    const imageControls = document.getElementById('imageControls');

    // Track generation state to avoid other observers resetting the button mid-process
    let isGenerating = false;

    let currentGenerationId = 0;
    let svgBaselineContents = [];

    function getSvgSourcesArray() {
        return [
            document.querySelector('#output-pane #svgContainer'),
            document.querySelector('.hidden-processing #svgContainer'),
            document.querySelector('svg')
        ];
    }

    // Difficulty descriptions
    const difficultyDescriptions = {
        1: 'Perfect for beginners - simple shapes and few colors',
        2: 'Good balance between detail and simplicity',
        3: 'Challenging - detailed patterns with many small areas'
    };

    function getSelectedCanvasSizeString() {
        if (typeof window.confirmedCanvasSize === 'string' && window.confirmedCanvasSize.trim()) {
            return window.confirmedCanvasSize.trim();
        }
        if (typeof currentCanvasSize !== 'undefined' && currentCanvasSize) {
            if (currentCanvasSize === 'custom') {
                const wInput = document.getElementById('customWidth');
                const hInput = document.getElementById('customHeight');
                const w = parseFloat(wInput ? wInput.value : '') || 40;
                const h = parseFloat(hInput ? hInput.value : '') || 40;
                return `${w}x${h}`;
            }
            return currentCanvasSize;
        }
        if (typeof window.selectedCanvasSize === 'string' && window.selectedCanvasSize.trim()) {
            return window.selectedCanvasSize.trim();
        }
        return '';
    }

    // Generate output filename formatted as: "<originalName> <colorCount> <difficulty> <canvasSize>.<ext>"
    function getOutputFilename(extension) {
        let baseName = '';
        if (window.uploadedFileName && typeof window.uploadedFileName === 'string') {
            baseName = window.uploadedFileName.trim();
        }
        if (!baseName && fileInput && fileInput.files && fileInput.files[0] && fileInput.files[0].name) {
            baseName = fileInput.files[0].name.trim();
        }
        if (!baseName) {
            const f = document.getElementById('file');
            if (f && f.files && f.files[0] && f.files[0].name) {
                baseName = f.files[0].name.trim();
            }
        }
        if (!baseName && previewImg && previewImg.dataset && previewImg.dataset.filename) {
            baseName = previewImg.dataset.filename.trim();
        }
        if (baseName) {
            baseName = baseName.replace(/\.[^/.]+$/, '');
        }
        if (!baseName) {
            baseName = 'paintbynumbers';
        }

        let colors = 24;
        if (colorsValue && colorsValue.textContent && colorsValue.textContent.trim()) {
            colors = parseInt(colorsValue.textContent.trim(), 10) || 24;
        } else if (colorsSlider && colorsSlider.value) {
            colors = parseInt(colorsSlider.value, 10) || 24;
        }

        let difficulty = 'medium';
        if (difficultySlider && difficultySlider.value) {
            const diffMap = { '1': 'easy', '2': 'medium', '3': 'hard' };
            const key = String(Math.round(parseFloat(difficultySlider.value) || 2));
            difficulty = diffMap[key] || 'medium';
        } else if (difficultyValue && difficultyValue.textContent && difficultyValue.textContent.trim()) {
            difficulty = difficultyValue.textContent.trim().toLowerCase();
        }

        const canvasSize = getSelectedCanvasSizeString();
        const sizePart = canvasSize ? ` ${canvasSize}` : '';

        const ext = (extension || '').replace(/^\./, '');
        return `${baseName} ${colors} ${difficulty}${sizePart}.${ext}`;
    }
    window.getOutputFilename = getOutputFilename;

    // Initialize UI
    initializeUI();
    

    function initializeUI() {
        // Set up file upload
        setupFileUpload();
        
        // Set up sliders
        setupSliders();
        
        // Set up color restrictions
        setupColorRestrictions();
        
        // Set up color restrictions toggle
        setupColorRestrictionsToggle();
        
        // Ensure change button is properly initialized
        initializeChangeButton();
        
        // Set up generate button
        setupGenerateButton();
        
        
        // Set up download functionality
        setupDownload();
        
        // Initialize existing app functionality
        initializeExistingApp();
        
        // Ensure upload area starts in correct state
        initializeUploadArea();
    }

    // Copy colors from the processed palette in the hidden output, enforcing 0-based numbering
    function copyPaletteFromOutputPane(targetContainer) {
        try {
            const outputPalette = document.querySelector('#output-pane #palette');
            if (!outputPalette || outputPalette.children.length === 0) return false;
            const items = Array.from(outputPalette.children);
            // Some builds render an extra placeholder at the end; trim to slider value if available
            let desiredCount;
            const txtNrOfClusters = document.getElementById('txtNrOfClusters');
            if (txtNrOfClusters && txtNrOfClusters.value) {
                const n = parseInt(txtNrOfClusters.value, 10);
                if (!isNaN(n) && n > 0) desiredCount = n;
            }
            // Fallback to slider value mapping
            if (desiredCount === undefined) {
                const slider = document.getElementById('colorsSlider');
                if (slider && slider.value !== undefined) {
                    const n = parseInt(slider.value, 10);
                    if (!isNaN(n) && n > 0) desiredCount = n;
                }
            }
            // Collect actually used indices from the generated outline (labels inside SVG)
            var used = null;
            var indexCounts = null;
            try {
                var outlineSvg = document.querySelector('#output-pane #svgContainer svg');
                if (outlineSvg) {
                    used = new Set();
                    indexCounts = {};
                    Array.from(outlineSvg.querySelectorAll('text')).forEach(function(t){
                        var n = parseInt((t.textContent || '').trim(), 10);
                        if (!isNaN(n)) {
                            used.add(n);
                            indexCounts[n] = (indexCounts[n] || 0) + 1;
                        }
                    });
                }
            } catch(e) { used = null; }

            // Extract number and color from each source element
            var entries = [];
            items.forEach(function(el){
                var swatchStyle = el.getAttribute('style') || '';
                var match = swatchStyle.match(/background-color:\s*([^;]+)/i);
                if (!match) {
                    var swatch = el.querySelector('.color') || el.querySelector('.color-swatch') || el;
                    var bg = (swatch && swatch.style ? swatch.style.backgroundColor : '');
                    if (bg) match = ['bg', bg];
                }
                var bgColor = match ? match[1] : '';
                var codeEl = el.querySelector('.color-code');
                var code = codeEl ? codeEl.textContent.trim() : '';
                if (!isNaN(num)) {
                    entries.push({ index: num, color: bgColor, code: code });
                }
            });

            // Sort by actual color index
            entries.sort(function(a,b){ return a.index - b.index; });
            if (desiredCount !== undefined && entries.length > desiredCount) {
                entries = entries.slice(0, desiredCount);
            }

            // Rebuild swatches in container
            entries.forEach(function(e){
                if (!e || !e.color) return;
                var colorElement = document.createElement('div');
                colorElement.className = 'color';
                var codeHtml = e.code ? `<div class="color-code">${e.code}</div>` : '';
                colorElement.innerHTML = `
                    <div class="color-swatch" style="background-color: ${e.color}"></div>
                    <div class="color-number">${e.index}</div>
                    ${codeHtml}
                    <div class="color-hex">${rgbToHex(e.color)}</div>
                `;
                targetContainer.appendChild(colorElement);
            });
            return targetContainer.children.length > 0;
        } catch (e) {
            console.warn('Failed to copy palette from output pane', e);
            return false;
        }
    }

    // ==============================
    // Crop Modal state and helpers
    // ==============================
    const cropModal = document.getElementById('cropModal');
    const cropImgEl = document.getElementById('cropImage');
    const btnPortrait = document.getElementById('btnPortrait');
    const btnLandscape = document.getElementById('btnLandscape');
    const btnSquare = document.getElementById('btnSquare');
    const customSizeInputs = document.getElementById('customSizeInputs');
    const customWidthInput = document.getElementById('customWidth');
    const customHeightInput = document.getElementById('customHeight');
    const cropZoom = document.getElementById('cropZoom');
    const cropZoomLabel = document.getElementById('cropZoomLabel');
    const cropCancel = document.getElementById('cropCancel');
    const cropConfirm = document.getElementById('cropConfirm');
    const cropModalClose = document.getElementById('cropModalClose');
    let cropper = null;
    let allowZoomFromSlider = false;
    let baseZoomRatio = 1; // ratio used when slider is at 100%
    let currentAspect = 3/4; // default aspect ratio
    let currentCanvasSize = '30x40';
    let currentOrientation = 'portrait';
    let pendingObjectUrl = null;

    const CANVAS_SIZES = {
        '30x40': { w: 30, h: 40, partner: '40x30', orientation: 'portrait' },
        '40x30': { w: 40, h: 30, partner: '30x40', orientation: 'landscape' },
        '50x50': { w: 50, h: 50, partner: null, orientation: 'square' },
        '40x50': { w: 40, h: 50, partner: '50x40', orientation: 'portrait' },
        '50x40': { w: 50, h: 40, partner: '40x50', orientation: 'landscape' },
        '60x70': { w: 60, h: 70, partner: '70x60', orientation: 'portrait' },
        '70x60': { w: 70, h: 60, partner: '60x70', orientation: 'landscape' },
        'custom': { w: null, h: null, partner: null, orientation: null }
    };

    function fitCropBoxToMaxHeight() {
        try {
            if (!cropper) return;
            const canvas = cropper.getCanvasData();
            const aspect = currentAspect || (canvas.width / canvas.height) || 1;
            let boxH = canvas.height;
            let boxW = boxH * aspect;
            let left = canvas.left + Math.max(0, (canvas.width - boxW) / 2);
            let top = canvas.top;
            if (boxW > canvas.width) {
                boxW = canvas.width;
                boxH = boxW / aspect;
                left = canvas.left;
                top = canvas.top + Math.max(0, (canvas.height - boxH) / 2);
            }
            const minW = Math.max(cropper.options.minCropBoxWidth || 0, 1);
            const minH = Math.max(cropper.options.minCropBoxHeight || 0, 1);
            if (boxW < minW) { boxW = minW; boxH = minW / aspect; }
            if (boxH < minH) { boxH = minH; boxW = minH * aspect; }
            const target = { left: Math.round(left), top: Math.round(top), width: Math.round(boxW), height: Math.round(boxH) };
            cropper.setCropBoxData(target);
            // Ensure final centering after Cropper internal constraints settle
            const centerAfterLayout = () => {
                try {
                    const cnv = cropper.getCanvasData();
                    const box = cropper.getCropBoxData();
                    const centered = {
                        left: Math.round(cnv.left + Math.max(0, (cnv.width - box.width) / 2)),
                        top: Math.round(cnv.top + Math.max(0, (cnv.height - box.height) / 2))
                    };
                    cropper.setCropBoxData(centered);
                } catch (_) {}
            };
            requestAnimationFrame(() => requestAnimationFrame(centerAfterLayout));
        } catch (_) { /* ignore */ }
    }

    // Expose to legacy code path as global as well
    window.showCropModal = function(src) {
        if (!cropModal || !cropImgEl) return;
        // Ensure modal is in <body> to avoid parent stacking/overflow issues
        try { if (cropModal.parentNode !== document.body) document.body.appendChild(cropModal); } catch(e) {}
        cropModal.classList.add('show');
        cropModal.style.display = 'block';
        // Reset UI
        cropZoom.value = '1';
        cropZoomLabel.textContent = '100%';
        // Create cropper when image is ready
        if (cropper) { try { cropper.destroy(); } catch(e){} finally { cropper = null; } }
        cropImgEl.onload = () => {
            const isLandscape = (cropImgEl.naturalWidth || 1) >= (cropImgEl.naturalHeight || 1);
            if (isLandscape) {
                currentCanvasSize = '40x30';
                currentOrientation = 'landscape';
            } else {
                currentCanvasSize = '30x40';
                currentOrientation = 'portrait';
            }
            updateCropAspect(false);
            cropper = new Cropper(cropImgEl, {
                viewMode: 1, // Restrict canvas to container size
                dragMode: 'move',
                autoCropArea: 1.0, // Start with full crop area
                responsive: true,
                background: false,
                movable: true,
                zoomable: true,
                zoomOnTouch: false, // Disable touch zoom
                zoomOnWheel: false, // Disable wheel zoom
                scalable: false,
                rotatable: false,
                checkCrossOrigin: false,
                checkOrientation: false,
                aspectRatio: currentAspect,
                // Disable crop box manipulation - make it fixed unless custom
                cropBoxMovable: isNaN(currentAspect),
                cropBoxResizable: isNaN(currentAspect),
                // Set reasonable minimum crop box sizes
                minCropBoxWidth: 100,
                minCropBoxHeight: 75,
                ready: function() {
                    // Ensure image fits within container bounds
                    ensureImageFitsInContainer();
                    // Set fixed crop box size and position (defer one frame to avoid instant shrink)
                    requestAnimationFrame(() => setFixedCropBox());
                },
                zoom: function(e) {
                    // Allow slider-initiated zooms
                    if (allowZoomFromSlider) {
                        return true;
                    }
                    
                    // Block pinch/wheel zooms but allow other user interactions
                    if (e.detail && (e.detail.type === 'wheel' || e.detail.type === 'touch')) {
                        e.preventDefault();
                        return false;
                    }
                    
                    // For fixed crop box, maintain image position during zoom
                    if (cropper) {
                        const imageData = cropper.getImageData();
                        const cropBoxData = cropper.getCropBoxData();
                        
                        // Calculate the center of the crop box
                        const cropCenterX = cropBoxData.left + cropBoxData.width / 2;
                        const cropCenterY = cropBoxData.top + cropBoxData.height / 2;
                        
                        // Calculate the new image position to keep it centered in the crop box
                        const newLeft = cropCenterX - (imageData.width * imageData.scaleX) / 2;
                        const newTop = cropCenterY - (imageData.height * imageData.scaleY) / 2;
                        
                        // Set the new position
                        cropper.setCanvasData({
                            left: newLeft,
                            top: newTop
                        });
                        
                        // Update baseZoomRatio and slider
                        const currentZoom = cropper.getImageData().scaleX;
                        baseZoomRatio = currentZoom;
                        
                        if (cropZoom) {
                            const sliderValue = Math.max(0.1, Math.min(2.0, currentZoom / baseZoomRatio));
                            cropZoom.value = sliderValue.toFixed(2);
                            if (cropZoomLabel) {
                                cropZoomLabel.textContent = Math.round(sliderValue * 100) + '%';
                            }
                        }
                    }
                    
                    return true;
                }
            });
        };
        // Set src AFTER onload to avoid missing the event for data URLs
        cropImgEl.src = src;
    }

    function setupCropBoxConstraints() {
        // Simple crop box setup - let CropperJS handle constraints with proper min/max settings
        try {
            if (!cropper) return;
            
            // The crop box constraints are handled by CropperJS's built-in logic
            // with the minCropBoxWidth and minCropBoxHeight settings
            // and the viewMode: 3 ensures proper containment
        } catch (_) { /* ignore */ }
    }

    function ensureImageFitsInContainer() {
        // Ensure the image is scaled to fit completely within the container
        try {
            if (!cropper) return;
            
            const container = cropper.getContainerData();
            const image = cropper.getImageData();
            
            // Calculate the scale needed to fit the image within the container
            const scaleX = container.width / image.naturalWidth;
            const scaleY = container.height / image.naturalHeight;
            const scale = Math.min(scaleX, scaleY);
            
            // Set the zoom to ensure the image fits within the container
            cropper.zoomTo(scale);
            
            // Center the image within the container
            const canvas = cropper.getCanvasData();
            const centerX = (container.width - canvas.width) / 2;
            const centerY = (container.height - canvas.height) / 2;
            cropper.setCanvasData({ left: centerX, top: centerY });
            
            // Set up zoom slider
            if (cropZoom) {
                cropZoom.min = '1.0';
                cropZoom.max = '2.0';
                cropZoom.step = '0.01';
                cropZoom.value = '1.0';
                if (cropZoomLabel) cropZoomLabel.textContent = '100%';
            }
            
            // Set base zoom ratio to the scale we just applied
            baseZoomRatio = scale;
            
        } catch (_) { /* ignore */ }
    }

    function setFixedCropBox() {
        // Maximize crop box to the visible image (canvas) area with current aspect ratio
        try {
            if (!cropper) return;
            const canvas = cropper.getCanvasData();
            const aspectRatio = currentAspect;
            if (isNaN(aspectRatio)) {
                cropper.setCropBoxData({
                    left: Math.round(canvas.left),
                    top: Math.round(canvas.top),
                    width: Math.round(canvas.width),
                    height: Math.round(canvas.height)
                });
                return;
            }
            
            let cropWidth, cropHeight;
            const widthBasedHeight = canvas.width / aspectRatio;
            const heightBasedWidth = canvas.height * aspectRatio;
            if (widthBasedHeight <= canvas.height) {
                cropWidth = canvas.width;
                cropHeight = widthBasedHeight;
            } else {
                cropHeight = canvas.height;
                cropWidth = heightBasedWidth;
            }
            
            const left = canvas.left + (canvas.width - cropWidth) / 2;
            const top = canvas.top + (canvas.height - cropHeight) / 2;
            cropper.setCropBoxData({ left: Math.round(left), top: Math.round(top), width: Math.round(cropWidth), height: Math.round(cropHeight) });

            // Re-apply on next frame to counteract internal constraint adjustments
            requestAnimationFrame(() => {
                try {
                    if (isNaN(currentAspect)) return;
                    const c = cropper.getCanvasData();
                    let w = cropWidth, h = cropHeight;
                    if (w > c.width) { w = c.width; h = w / aspectRatio; }
                    if (h > c.height) { h = c.height; w = h * aspectRatio; }
                    const l = c.left + (c.width - w) / 2;
                    const t = c.top + (c.height - h) / 2;
                    cropper.setCropBoxData({ left: Math.round(l), top: Math.round(t), width: Math.round(w), height: Math.round(h) });
                } catch (_) { /* ignore */ }
            });
            
        } catch (_) { /* ignore */ }
    }

    function maximizeCropBoxToFullWidth() {
        // Maximize the crop box to use the full available width
        try {
            if (!cropper) return;
            
            const canvas = cropper.getCanvasData();
            const container = cropper.getContainerData();
            const aspectRatio = currentAspect;
            
            // Calculate the maximum width the crop box can have
            const maxWidth = Math.min(canvas.width, container.width);
            const maxHeight = maxWidth / aspectRatio;
            
            // If the calculated height exceeds the canvas height, adjust
            let finalWidth = maxWidth;
            let finalHeight = maxHeight;
            
            if (maxHeight > canvas.height) {
                finalHeight = canvas.height;
                finalWidth = finalHeight * aspectRatio;
            }
            
            // Center the crop box
            const left = canvas.left + (canvas.width - finalWidth) / 2;
            const top = canvas.top + (canvas.height - finalHeight) / 2;
            
            // Set the crop box to maximum size
            cropper.setCropBoxData({
                left: left,
                top: top,
                width: finalWidth,
                height: finalHeight
            });
            
        } catch (_) { /* ignore */ }
    }

    function hideCropModal() {
        if (cropper) { try { cropper.destroy(); } catch(e){} finally { cropper = null; } }
        if (cropModal) {
            cropModal.classList.remove('show');
            cropModal.style.display = 'none';
        }
        if (pendingObjectUrl) { try { URL.revokeObjectURL(pendingObjectUrl); } catch(e){} pendingObjectUrl = null; }
    }

    function updateCropAspect(notifyCropper = true) {
        // Toggle custom size inputs visibility
        if (customSizeInputs) {
            customSizeInputs.style.display = (currentCanvasSize === 'custom') ? 'inline-flex' : 'none';
        }

        // Highlight active size button
        const sizeButtons = document.querySelectorAll('.canvas-size-toggle .size-btn');
        sizeButtons.forEach(btn => {
            const isMatch = btn.getAttribute('data-size') === currentCanvasSize;
            btn.classList.toggle('active', isMatch);
            btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        // Determine aspect ratio and square condition
        let isSquare = false;
        if (currentCanvasSize === 'custom') {
            const wVal = parseFloat(customWidthInput ? customWidthInput.value : '40') || 40;
            const hVal = parseFloat(customHeightInput ? customHeightInput.value : '40') || 40;
            const w = Math.max(1, wVal);
            const h = Math.max(1, hVal);
            isSquare = (Math.abs(w - h) < 0.001);
            if (isSquare) {
                currentOrientation = 'square';
            } else if (currentOrientation === 'square') {
                currentOrientation = (w > h) ? 'landscape' : 'portrait';
            }
            currentAspect = w / h;
        } else if (currentCanvasSize === '50x50') {
            isSquare = true;
            currentOrientation = 'square';
            currentAspect = 1.0;
        } else {
            isSquare = false;
            if (currentOrientation === 'square') {
                const cfg = CANVAS_SIZES[currentCanvasSize];
                currentOrientation = (cfg && cfg.orientation) ? cfg.orientation : 'portrait';
            }
            const cfg = CANVAS_SIZES[currentCanvasSize];
            if (cfg && cfg.w && cfg.h) {
                let w = cfg.w;
                let h = cfg.h;
                // If orientation is landscape, ensure horizontal (w >= h); if portrait, vertical (w <= h)
                if (currentOrientation === 'landscape' && w < h) {
                    const temp = w; w = h; h = temp;
                } else if (currentOrientation === 'portrait' && w > h) {
                    const temp = w; w = h; h = temp;
                }
                currentAspect = w / h;
            } else {
                currentAspect = currentOrientation === 'portrait' ? 3/4 : 4/3;
            }
        }

        // Manage orientation buttons:
        // Square option is selected solely when ratio is 1:1 square, otherwise disabled (greyed out)
        // When ratio is 1:1 square (e.g. 50x50), landscape and portrait are disabled (greyed out)
        if (btnSquare) {
            btnSquare.disabled = !isSquare;
            const isSquareActive = isSquare && currentOrientation === 'square';
            btnSquare.classList.toggle('active', isSquareActive);
            btnSquare.setAttribute('aria-selected', isSquareActive ? 'true' : 'false');
        }
        if (btnPortrait) {
            btnPortrait.disabled = isSquare;
            const isPortraitActive = !isSquare && currentOrientation === 'portrait';
            btnPortrait.classList.toggle('active', isPortraitActive);
            btnPortrait.setAttribute('aria-selected', isPortraitActive ? 'true' : 'false');
        }
        if (btnLandscape) {
            btnLandscape.disabled = isSquare;
            const isLandscapeActive = !isSquare && currentOrientation === 'landscape';
            btnLandscape.classList.toggle('active', isLandscapeActive);
            btnLandscape.setAttribute('aria-selected', isLandscapeActive ? 'true' : 'false');
        }

        window.selectedCanvasSize = currentCanvasSize;
        window.selectedCanvasOrientation = currentOrientation;

        if (notifyCropper && cropper) {
            cropper.options.cropBoxResizable = false;
            cropper.options.cropBoxMovable = false;
            cropper.setAspectRatio(currentAspect);
            setTimeout(() => {
                setFixedCropBox();
            }, 80);
        }
    }

    function selectCanvasSize(sizeKey) {
        if (!CANVAS_SIZES[sizeKey]) return;
        currentCanvasSize = sizeKey;
        const cfg = CANVAS_SIZES[sizeKey];
        if (cfg.orientation) {
            currentOrientation = cfg.orientation;
        }
        updateCropAspect(true);
    }

    function setOrientation(orientation) {
        currentOrientation = orientation;
        const currentCfg = CANVAS_SIZES[currentCanvasSize];
        if (currentCfg && currentCfg.partner) {
            const partnerCfg = CANVAS_SIZES[currentCfg.partner];
            if (partnerCfg && partnerCfg.orientation === orientation) {
                currentCanvasSize = currentCfg.partner;
            }
        }
        updateCropAspect(true);
    }

    function setupCropToolbar() {
        if (btnPortrait) {
            btnPortrait.addEventListener('click', () => {
                if (btnPortrait.disabled) return;
                if (currentCanvasSize === 'custom' && customWidthInput && customHeightInput) {
                    let w = parseFloat(customWidthInput.value) || 40;
                    let h = parseFloat(customHeightInput.value) || 40;
                    if (w > h) {
                        customWidthInput.value = h;
                        customHeightInput.value = w;
                    }
                }
                setOrientation('portrait');
            });
        }
        if (btnLandscape) {
            btnLandscape.addEventListener('click', () => {
                if (btnLandscape.disabled) return;
                if (currentCanvasSize === 'custom' && customWidthInput && customHeightInput) {
                    let w = parseFloat(customWidthInput.value) || 40;
                    let h = parseFloat(customHeightInput.value) || 40;
                    if (w < h) {
                        customWidthInput.value = h;
                        customHeightInput.value = w;
                    }
                }
                setOrientation('landscape');
            });
        }
        if (btnSquare) {
            btnSquare.addEventListener('click', () => {
                if (btnSquare.disabled) return;
                if (currentCanvasSize === 'custom' && customWidthInput && customHeightInput) {
                    customHeightInput.value = customWidthInput.value;
                }
                setOrientation('square');
            });
        }
        if (customWidthInput) {
            customWidthInput.addEventListener('input', () => {
                if (currentCanvasSize === 'custom') updateCropAspect(true);
            });
        }
        if (customHeightInput) {
            customHeightInput.addEventListener('input', () => {
                if (currentCanvasSize === 'custom') updateCropAspect(true);
            });
        }
        const sizeButtons = document.querySelectorAll('.canvas-size-toggle .size-btn');
        sizeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const size = btn.getAttribute('data-size');
                if (size) selectCanvasSize(size);
            });
        });
    }
    setupCropToolbar();
    if (cropZoom) {
        cropZoom.addEventListener('input', () => {
            const sliderVal = parseFloat(cropZoom.value || '1');
            cropZoomLabel.textContent = Math.round(sliderVal * 100) + '%';
            if (cropper) {
                allowZoomFromSlider = true;
                // Map slider value to zoom: 1.0 = 100% = baseZoomRatio (fits in container)
                // 0.5 = 50% of baseZoomRatio, 2.0 = 200% of baseZoomRatio
                const zoomRatio = Math.max(0.1, baseZoomRatio * sliderVal);
                cropper.zoomTo(zoomRatio);
                
                // For fixed crop box, ensure image stays centered
                const cropBoxData = cropper.getCropBoxData();
                const imageData = cropper.getImageData();
                
                // Calculate the center of the crop box
                const cropCenterX = cropBoxData.left + cropBoxData.width / 2;
                const cropCenterY = cropBoxData.top + cropBoxData.height / 2;
                
                // Calculate the new image position to keep it centered in the crop box
                const newLeft = cropCenterX - (imageData.width * imageData.scaleX) / 2;
                const newTop = cropCenterY - (imageData.height * imageData.scaleY) / 2;
                
                // Set the new position
                cropper.setCanvasData({
                    left: newLeft,
                    top: newTop
                });
                
                // Reset gate on next frame so only slider triggers are allowed
                requestAnimationFrame(() => { allowZoomFromSlider = false; });
            }
        });
    }
    const closeCrop = () => hideCropModal();
    if (cropCancel) cropCancel.addEventListener('click', closeCrop);
    if (cropModalClose) cropModalClose.addEventListener('click', closeCrop);
    if (cropModal) {
        cropModal.addEventListener('click', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('crop-modal-backdrop')) hideCropModal();
        });
    }
    if (cropConfirm) {
        cropConfirm.addEventListener('click', () => {
            try {
                if (!cropper) return hideCropModal();
                window.confirmedCanvasSize = getSelectedCanvasSizeString();
                const croppedCanvas = cropper.getCroppedCanvas({
                    imageSmoothingEnabled: true,
                    imageSmoothingQuality: 'high'
                });
                if (!croppedCanvas) return hideCropModal();
                const dataUrl = croppedCanvas.toDataURL('image/jpeg', 0.95);
                // Apply result to preview and app
                previewImg.src = dataUrl;
                uploadContent.style.display = 'none';
                imagePreview.style.display = 'block';
                imageControls.classList.add('show');
                imageControls.style.display = 'block';
                setTimeout(syncChangeButtonWidthToImage, 0);
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Paint by Numbers';
                loadImageIntoApp(dataUrl);
            } finally {
                hideCropModal();
                if (fileInput) fileInput.value = '';
            }
        });
    }

    function setupFileUpload() {
        // Click to upload
        uploadArea.addEventListener('click', () => {
            if (!imagePreview.style.display || imagePreview.style.display === 'none') {
                fileInput.click();
            }
        });

        // File input change - work with existing app's handler
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                window.uploadedFileName = file.name;
                handleFile(file);
            }
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                window.uploadedFileName = files[0].name;
                // Set the file input to the dropped file
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                fileInput.files = dataTransfer.files;
                
                // Trigger the change event
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        });

        // Remove/change image buttons
        removeImageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeImage();
        });
    }


    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }
        if (file && file.name) {
            window.uploadedFileName = file.name;
        }
        // Prefer object URL for reliability
        try {
            pendingObjectUrl = URL.createObjectURL(file);
            showCropModal(pendingObjectUrl);
            return;
        } catch(e) {
            // Fallback to FileReader
            const reader = new FileReader();
            reader.onload = (ev) => {
                try { showCropModal(ev.target.result); } catch (err) { console.error('Failed to open crop modal', err); }
            };
            reader.readAsDataURL(file);
        }
    }

    function removeImage() {
        window.uploadedFileName = '';
        window.confirmedCanvasSize = '';
        uploadContent.style.display = 'flex';
        imagePreview.style.display = 'none';
        imageControls.classList.remove('show');
        imageControls.style.display = 'none'; // Fallback to ensure hiding
        imageControls.style.width = 'auto';
        generateBtn.disabled = true;
        generateBtn.textContent = 'Upload image first';
        fileInput.value = '';
        previewImg.src = '';
        
        // Clear the existing app's canvas
        clearAppCanvas();
    }

    function setupSliders() {
        // Track drag state for difficulty so we can allow free thumb motion
        let isDifficultyDragging = false;
        let difficultyPrevStep = (difficultySlider && difficultySlider.step) ? difficultySlider.step : '1';
        // Colors slider - maps 10-50 directly to number of colors
        colorsSlider.addEventListener('input', (e) => {
            const selectedColors = parseInt(e.target.value);
            
            colorsValue.textContent = selectedColors;
            // Update the existing app's number of clusters
            updateNumberOfClusters(selectedColors);

            // Update filled track
            updateSliderFill(colorsSlider);
        });
        // Improve mobile drag reliability
        try { colorsSlider.style.touchAction = 'pan-x'; } catch(_) {}
        colorsSlider.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
        colorsSlider.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        
        // Initialize the default value in the hidden input field
        const initialColors = parseInt(colorsSlider ? colorsSlider.value : '24', 10) || 24;
        updateNumberOfClusters(initialColors);
        requestAnimationFrame(() => updateSliderFill(colorsSlider));

        // Difficulty slider
        difficultySlider.addEventListener('input', (e) => {
            // While dragging, only animate the fill and let the thumb follow freely
            if (isDifficultyDragging) {
                updateSliderFill(difficultySlider);
                return;
            }
            const value = parseInt(e.target.value);
            const difficulties = ['Easy', 'Medium', 'Hard'];
            difficultyValue.textContent = difficulties[value - 1];
            difficultyDescription.textContent = difficultyDescriptions[value];
            // Update filled track
            updateSliderFill(difficultySlider);
        });
        // Improve mobile drag reliability
        try { difficultySlider.style.touchAction = 'pan-x'; } catch(_) {}
        difficultySlider.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
        difficultySlider.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

        // Live drag fill animation even between steps
        (function enableDifficultyLiveFill(){
            let dragging = false;
            const clampPct = (p) => Math.max(0, Math.min(100, p));
            const setFillByClientX = (clientX) => {
                const rect = difficultySlider.getBoundingClientRect();
                if (!rect || rect.width === 0) return;
                const percent = clampPct(((clientX - rect.left) / rect.width) * 100);
                // Move the native thumb by updating the value continuously
                const min = parseFloat(difficultySlider.min || '1');
                const max = parseFloat(difficultySlider.max || '3');
                const continuousValue = min + (percent / 100) * (max - min);
                try { difficultySlider.value = String(continuousValue.toFixed(2)); } catch(_) { difficultySlider.value = String(continuousValue); }
                updateSliderFillPercent(difficultySlider, percent);
            };
            const onPointerDown = (e) => {
                dragging = true;
                isDifficultyDragging = true;
                difficultyPrevStep = difficultySlider.step || '1';
                // Allow continuous tracking between discrete ticks
                difficultySlider.step = '0.01';
                try { difficultySlider.setPointerCapture && difficultySlider.setPointerCapture(e.pointerId); } catch(_) {}
                setFillByClientX(e.clientX);
                e.preventDefault();
            };
            const onPointerMove = (e) => {
                if (!dragging) return;
                setFillByClientX(e.clientX);
                e.preventDefault();
            };
            const onPointerUp = () => {
                if (!dragging) return;
                dragging = false;
                isDifficultyDragging = false;
                // Snap to nearest discrete value and restore step
                const v = parseFloat(difficultySlider.value || '2');
                const snapped = Math.max(1, Math.min(3, Math.round(v)));
                difficultySlider.value = String(snapped);
                difficultySlider.step = difficultyPrevStep || '1';
                // Commit UI and settings
                const difficulties = ['Easy', 'Medium', 'Hard'];
                difficultyValue.textContent = difficulties[snapped - 1];
                difficultyDescription.textContent = difficultyDescriptions[snapped];
                updateSliderFill(difficultySlider);
            };
            if (window.PointerEvent) {
                difficultySlider.addEventListener('pointerdown', onPointerDown);
                window.addEventListener('pointermove', onPointerMove, { passive: false });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            } else {
                // Mouse fallback
                const onMouseDown = (e) => { dragging = true; isDifficultyDragging = true; difficultyPrevStep = difficultySlider.step || '1'; difficultySlider.step = '0.01'; setFillByClientX(e.clientX); e.preventDefault(); };
                const onMouseMove = (e) => { if (dragging) { setFillByClientX(e.clientX); e.preventDefault(); } };
                const onMouseUp = () => { if (!dragging) return; dragging = false; isDifficultyDragging = false; const v = parseFloat(difficultySlider.value || '2'); const snapped = Math.max(1, Math.min(3, Math.round(v))); difficultySlider.value = String(snapped); difficultySlider.step = difficultyPrevStep || '1'; const difficulties = ['Easy', 'Medium', 'Hard']; difficultyValue.textContent = difficulties[snapped - 1]; difficultyDescription.textContent = difficultyDescriptions[snapped]; updateSliderFill(difficultySlider); };
                difficultySlider.addEventListener('mousedown', onMouseDown);
                window.addEventListener('mousemove', onMouseMove, { passive: false });
                window.addEventListener('mouseup', onMouseUp);
                // Touch fallback
                const getTouchX = (ev) => (ev.touches && ev.touches[0] ? ev.touches[0].clientX : (ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : 0));
                const onTouchStart = (e) => { dragging = true; isDifficultyDragging = true; difficultyPrevStep = difficultySlider.step || '1'; difficultySlider.step = '0.01'; setFillByClientX(getTouchX(e)); e.preventDefault(); };
                const onTouchMove = (e) => { if (dragging) { setFillByClientX(getTouchX(e)); e.preventDefault(); } };
                const onTouchEnd = () => { if (!dragging) return; dragging = false; isDifficultyDragging = false; const v = parseFloat(difficultySlider.value || '2'); const snapped = Math.max(1, Math.min(3, Math.round(v))); difficultySlider.value = String(snapped); difficultySlider.step = difficultyPrevStep || '1'; const difficulties = ['Easy', 'Medium', 'Hard']; difficultyValue.textContent = difficulties[snapped - 1]; difficultyDescription.textContent = difficultyDescriptions[snapped]; updateSliderFill(difficultySlider); };
                difficultySlider.addEventListener('touchstart', onTouchStart, { passive: false });
                window.addEventListener('touchmove', onTouchMove, { passive: false });
                window.addEventListener('touchend', onTouchEnd);
                window.addEventListener('touchcancel', onTouchEnd);
            }
        })();
        
        requestAnimationFrame(() => updateSliderFill(difficultySlider));

        // Paper size select
        if (paperSizeSelect) {
            
            paperSizeSelect.addEventListener('change', (e) => {
                const selectedSize = e.target.value;
                // Store the selected paper size globally for PDF generation
                window.selectedPaperSize = selectedSize;
            });
            
            // Initialize with default A4
            window.selectedPaperSize = 'a4';
        }
    }

    function updateSliderFill(sliderEl) {
        if (!sliderEl) return;
        const min = parseFloat(sliderEl.min || '0');
        const max = parseFloat(sliderEl.max || '100');
        const val = parseFloat(sliderEl.value || '0');
        const percent = ((val - min) / (max - min)) * 100;
        // Set gradient with filled color up to percent
        sliderEl.style.background = `linear-gradient(to right, #1e3a8a 0%, #3498db ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`;
    }

    function updateSliderFillPercent(sliderEl, percent) {
        if (!sliderEl) return;
        const p = Math.max(0, Math.min(100, percent || 0));
        sliderEl.style.background = `linear-gradient(to right, #1e3a8a 0%, #3498db ${p}%, #e5e7eb ${p}%, #e5e7eb 100%)`;
    }

    function setupColorRestrictions() {
        // Set up color restrictions textarea
        colorRestrictionsInput.addEventListener('input', (e) => {
            updateColorRestrictions(e.target.value);
        });
    }

    function updateColorRestrictions(value) {
        // Update the hidden txtKMeansColorRestrictions field
        const txtKMeansColorRestrictions = document.getElementById('txtKMeansColorRestrictions');
        if (txtKMeansColorRestrictions) {
            txtKMeansColorRestrictions.value = value;
        }
    }

    function setupColorRestrictionsToggle() {
        toggleColorRestrictionsBtn.addEventListener('click', () => {
            const isVisible = colorRestrictionsContent.style.display !== 'none';
            
            if (isVisible) {
                colorRestrictionsContent.style.display = 'none';
                toggleColorRestrictionsBtn.textContent = 'Add custom colors';
            } else {
                colorRestrictionsContent.style.display = 'block';
                toggleColorRestrictionsBtn.textContent = 'Hide custom colors';
            }
        });
    }

    function initializeChangeButton() {
        // Check if there's already a valid image loaded (not just empty src)
        if (previewImg.src && previewImg.src !== '' && previewImg.src.startsWith('data:image/')) {
            imageControls.classList.add('show');
            imageControls.style.display = 'block';
            syncChangeButtonWidthToImage();
        } else {
            // Ensure button is hidden on page load
            imageControls.classList.remove('show');
            imageControls.style.display = 'none';
        }
        
        // Set up change button click handler
        changeImageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        // When the preview image loads, sync the button width
        previewImg.addEventListener('load', syncChangeButtonWidthToImage);
        // On window resize, keep them in sync
        window.addEventListener('resize', syncChangeButtonWidthToImage);
    }

    function syncChangeButtonWidthToImage() {
        try {
            if (!imagePreview || imagePreview.style.display === 'none') return;
            if (!previewImg || !previewImg.complete || previewImg.naturalWidth === 0) return;

            // Use the rendered width of the image for accurate sizing
            const renderedWidth = previewImg.getBoundingClientRect().width;
            if (renderedWidth > 0) {
                imageControls.style.width = Math.round(renderedWidth) + 'px';
            }
        } catch (err) {
            console.warn('Failed to sync change button width:', err);
        }
    }

    function setupGenerateButton() {
        generateBtn.addEventListener('click', () => {
            if (!generateBtn.disabled) {
                startGeneration();
            }
        });
    }


    // Downloads the PDF (colored page, numbered outline, legend grouped by family) built by the shared core,
    // so the website and the API produce the same document
    function downloadPaintingPdf() {
        if (typeof window.buildPaintingPdf !== 'function' || !(window.jspdf && window.jspdf.jsPDF)) {
            console.warn('PDF generation is not available yet');
            return;
        }
        const doc = window.buildPaintingPdf(window.selectedPaperSize || 'a4');
        if (doc) {
            doc.save(getOutputFilename('pdf').replace(/\.pdf$/i, '-painting.pdf'));
        }
    }

    function downloadPdf() {
        if (typeof window.buildTemplatePdf !== 'function' || !(window.jspdf && window.jspdf.jsPDF)) {
            console.warn('PDF generation is not available yet');
            return;
        }
        const doc = window.buildTemplatePdf(window.selectedPaperSize || 'a4');
        if (doc) {
            doc.save(getOutputFilename('pdf'));
        }
    }

    function downloadPalettePNG() {
        if (typeof window.downloadPalettePng === 'function') {
            window.downloadPalettePng();
        }
    }

    function setupDownload() {
        if (downloadBtn) downloadBtn.addEventListener('click', () => {
            const filename = getOutputFilename('svg');
            if (typeof window.downloadSVG === 'function') {
                window.downloadSVG(filename);
            } else {
                const downloadSVGBtn = document.getElementById('btnDownloadSVG');
                if (downloadSVGBtn) {
                    downloadSVGBtn.click();
                }
            }
        });
        
        if (downloadPngBtn) downloadPngBtn.addEventListener('click', () => {
            const filename = getOutputFilename('png');
            if (typeof window.downloadPNG === 'function') {
                window.downloadPNG(filename);
            } else {
                const hiddenPngBtn = document.querySelector('.hidden-processing #btnDownloadPNG');
                if (hiddenPngBtn) {
                    hiddenPngBtn.click();
                }
            }
        });

        // pre-printed canvas look: faint colors with grey outlines and numbers
        if (downloadCanvasBtn) downloadCanvasBtn.addEventListener('click', () => {
            const filename = getOutputFilename('png').replace(/\.png$/i, '-canvas.png');
            if (typeof window.downloadCanvasPNG === 'function') {
                window.downloadCanvasPNG(filename);
            }
        });

        if (downloadBlankSvgBtn) downloadBlankSvgBtn.addEventListener('click', () => {
            const filename = getOutputFilename('svg').replace(/\.svg$/i, '-blank.svg');
            if (typeof window.downloadBlankSVG === 'function') {
                window.downloadBlankSVG(filename);
            }
        });

        if (downloadPaintingPdfBtn) downloadPaintingPdfBtn.addEventListener('click', () => {
            downloadPaintingPdf();
        });

        if (downloadMockupBtn) downloadMockupBtn.addEventListener('click', () => {
            const filename = getOutputFilename('png').replace(/.png$/i, '-mockup.png');
            if (typeof window.downloadMockupPNG === 'function') {
                window.downloadMockupPNG(filename).catch((e) => console.error('Mockup failed', e));
            }
        });

        if (downloadOutlineBtn) downloadOutlineBtn.addEventListener('click', () => {
            downloadPdf();
        });
        
        if (downloadPaletteBtn) downloadPaletteBtn.addEventListener('click', () => {
            downloadPalettePNG();
        });
    }

    function initializeUploadArea() {
        // Ensure upload area starts in the correct state
        uploadContent.style.display = 'flex';
        imagePreview.style.display = 'none';
        generateBtn.disabled = true;
        generateBtn.textContent = 'Upload image first';
        fileInput.value = '';
    }

    function initializeExistingApp() {
        // Wait for the existing app to load
        setTimeout(() => {
            // Set up example image links
            setupExampleImages();
            
            // Note: Default values are now initialized in setupSliders()
            // to avoid timing conflicts and duplicate initialization
            
            // Monitor for image changes in the existing app
            monitorExistingAppImage();
        }, 1000);
    }

    function monitorExistingAppImage() {
        // Only monitor if we're already showing a preview (user has uploaded an image)
        if (imagePreview.style.display === 'block') {
            // Check if the existing app has loaded an image
            const canvas = document.getElementById('canvas');
            if (canvas && canvas.width > 0 && canvas.height > 0) {
                // Convert canvas to image and update preview
                const dataURL = canvas.toDataURL();
            previewImg.src = dataURL;
            // Only enable if not in the middle of a generation run
            if (!isGenerating) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Paint by Numbers';
            }
            }
        }
        
        // Check again after a short delay
        setTimeout(monitorExistingAppImage, 500);
    }

    function setupExampleImages() {
        // Create example image links
        const exampleImages = [
            { id: 'lnkTrivial', name: 'trivial' },
            { id: 'lnkSmall', name: 'small' },
            { id: 'lnkMedium', name: 'medium' }
        ];

        exampleImages.forEach(img => {
            const link = document.createElement('a');
            link.id = img.id;
            link.href = '#';
            link.textContent = img.name;
            link.style.margin = '0 10px';
            link.addEventListener('click', (e) => {
                e.preventDefault();
                loadExampleImage(img.name);
            });
            
            // Add to header
            const header = document.querySelector('.header p');
            if (header) {
                header.innerHTML += '<br><br>Example images: ';
                header.appendChild(link);
            }
        });
    }

    function loadExampleImage(name) {
        const imageMap = {
            'trivial': 'https://i.imgur.com/o5CqO57.png',
            'small': 'https://i.imgur.com/YgYLDGP.png',
            'medium': 'https://i.imgur.com/nLeNgYbr.jpg'
        };

        const imageUrl = imageMap[name];
        if (imageUrl) {
            previewImg.src = imageUrl;
            uploadContent.style.display = 'none';
            imagePreview.style.display = 'block';
            if (!isGenerating) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Paint by Numbers';
            }
            
            // Load image into the existing app
            loadImageIntoApp(imageUrl);
        }
    }

    function loadImageIntoApp(imageSrc) {
        // Load the image into the processing canvas at full native resolution
        const canvas = document.getElementById('canvas');
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height) { return; }
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            // Store original for downstream consumers (e.g., downloads)
            window.currentImage = img;
        };
        img.src = imageSrc;
    }

    function clearAppCanvas() {
        const canvas = document.getElementById('canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    function updateNumberOfClusters(value) {
        const txtNrOfClusters = document.getElementById('txtNrOfClusters');
        if (txtNrOfClusters) {
            txtNrOfClusters.value = value;
        } else {
            console.error('txtNrOfClusters element not found!');
        }
    }

    function startGeneration() {
        
        // Disable generate button and show spinner state
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.setAttribute('aria-busy', 'true');
            generateBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>Generating...';
        }
        isGenerating = true;
        currentGenerationId++;
        const myRunId = currentGenerationId;
        
        // Show progress section
        progressSection.style.display = 'block';
        // Hide previous results immediately for a clean start
        resultsSection.style.display = 'none';
        // Clear any previously mirrored results in our UI containers
        const templateImage = document.getElementById('templateImage');
        const newSvgContainer = document.getElementById('svgContainer');
        if (templateImage) { templateImage.src = ''; templateImage.style.display = 'none'; }
        if (newSvgContainer) { newSvgContainer.innerHTML = ''; newSvgContainer.style.display = 'none'; }
        // Reset image comparison slider container
        const imgCompContainer = document.getElementById('imgCompContainer');
        const imgCompOverlay = document.getElementById('imgCompOverlay');
        const imgCompSlider = document.getElementById('imgCompSlider');
        const imgCompBase = document.getElementById('imgCompBase');
        const imgCompOverlayImg = document.getElementById('imgCompOverlayImg');
        if (imgCompContainer && imgCompOverlay && imgCompSlider && imgCompBase && imgCompOverlayImg) {
            // Prepare comparison default: SVG on right, PNG on left
            imgCompOverlay.style.width = '100%';
            imgCompSlider.style.left = '50%';
            const mask = document.getElementById('imgCompMask');
            if (mask) {
                mask.style.clipPath = 'inset(0 0 0 50%)';
                mask.style.webkitClipPath = 'inset(0 0 0 50%)';
            }
            // Don't hide the slider - it will be shown when comparison is built
            try { imgCompBase.removeAttribute('src'); } catch(_) {}
            try { imgCompOverlayImg.removeAttribute('src'); } catch(_) {}
            try { const prev = imgCompOverlay.querySelectorAll('svg'); prev.forEach(function(n){ n.remove(); }); } catch(_) {}
        }
        
        // Reset progress
        progressFill.style.width = '0%';
        progressText.textContent = '0% complete';
        
        // Ensure color restrictions and cluster count are synced
        const colorRestrictionsInput = document.getElementById('colorRestrictionsInput');
        const txtKMeansColorRestrictions = document.getElementById('txtKMeansColorRestrictions');
        if (colorRestrictionsInput && txtKMeansColorRestrictions) {
            txtKMeansColorRestrictions.value = colorRestrictionsInput.value;
        }
        const colorsSlider = document.getElementById('colorsSlider');
        const txtNrOfClusters = document.getElementById('txtNrOfClusters');
        if (colorsSlider && txtNrOfClusters) {
            txtNrOfClusters.value = colorsSlider.value;
        }

        // Start the existing app's processing
        const processBtn = document.getElementById('btnProcess');
        if (processBtn) {
            // Simulate click on the process button
            processBtn.click();
        } else {
            // Fallback: try to trigger processing directly
            if (window.MyApp && window.MyApp.processImage) {
                window.MyApp.processImage();
            } else {
                // No processing method available
            }
        }
        
        // Start aggressive monitoring for SVG generation
        startAggressiveMonitoring(myRunId);
    }

    function startAggressiveMonitoring(runId) {
        let checkCount = 0;
        const maxChecks = 150; // ~30 seconds at 200ms
        let svgShown = false;
        // Take baseline snapshot of source containers to detect fresh output
        svgBaselineContents = getSvgSourcesArray().map(function(src){
            return src && src.innerHTML ? src.innerHTML : '';
        });

        const aggressiveInterval = setInterval(() => {
            // If a new run started, stop this watcher
            if (runId !== currentGenerationId) { clearInterval(aggressiveInterval); return; }
            checkCount++;
            
            // Update progress based on status elements
            const statusElements = document.querySelectorAll('.status .determinate');
            let totalProgress = 0;
            let completedSteps = 0;
            
            statusElements.forEach(element => {
                const width = element.style.width;
                if (width) {
                    const percentage = parseInt(width.replace('%', ''));
                    totalProgress += percentage;
                    if (percentage === 100) completedSteps++;
                }
            });
            
            const averageProgress = statusElements.length > 0 ? totalProgress / statusElements.length : 0;
            progressFill.style.width = averageProgress + '%';
            progressText.textContent = Math.round(averageProgress) + '% complete';
            
            // Check for SVG becoming available to display results early (but keep button disabled)
            if (!svgShown) {
                const svgSources = getSvgSourcesArray();
                for (let i = 0; i < svgSources.length; i++) {
                    const source = svgSources[i];
                    if (source && source.innerHTML && source.innerHTML.trim() !== '') {
                        const isNewContent = source.innerHTML !== svgBaselineContents[i];
                        if (isNewContent && source.innerHTML.includes('<svg') && (source.innerHTML.includes('<path') || source.innerHTML.includes('<text'))) {
                            showResults();
                            svgShown = true;
                            break;
                        }
                    }
                }
            }
            
            // Determine completion
            const allComplete = statusElements.length > 0 && completedSteps === statusElements.length;
            const timedOut = checkCount >= maxChecks;
            const nearlyDone = averageProgress >= 99; // guard for small rounding errors
            
            if (allComplete || timedOut || nearlyDone) {
                clearInterval(aggressiveInterval);
                // Ensure progress UI looks finished
                progressFill.style.width = '100%';
                progressText.textContent = '100% complete';
                finishGenerationUI();
                // If we haven't shown results yet (e.g. SVG identical to baseline), show them now
                try {
                    if (!svgShown) {
                        showResults();
                        svgShown = true;
                    }
                } catch (_) { /* ignore */ }
            }
        }, 200);
    }


    function showResults() {
        // Hide progress section
        progressSection.style.display = 'none';
        
        // Show results section
        resultsSection.style.display = 'block';
        
        // Auto-scroll to results section on mobile as soon as title appears
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                const resultsSection = document.getElementById('resultsSection');
                if (resultsSection) {
                    resultsSection.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                }
            }, 100); // Small delay to ensure smooth transition
        }
        
        // Show comparison container immediately and reset mask/slider to center
        const container = document.getElementById('imgCompContainer');
        const slider = document.getElementById('imgCompSlider');
        const mask = document.getElementById('imgCompMask');
        if (container) {
            container.style.display = 'block';
            try {
                const rect = container.getBoundingClientRect();
                const center = Math.round(rect.width / 2);
                if (slider) slider.style.left = center + 'px';
                if (mask) {
                    mask.style.clipPath = `inset(0 0 0 ${center}px)`;
                    mask.style.webkitClipPath = `inset(0 0 0 ${center}px)`;
                }
            } catch(_) { /* ignore */ }
        }
        
        // Wait a bit for SVG to be generated, then copy
        setTimeout(() => {
            copyGeneratedResults();
        }, 500);
        
        // Template is ready for display
        
        // Update color palette with a delay to ensure SVG is ready
        setTimeout(() => {
            updateColorPalette();
        }, 1000);
        
        // Ensure comparison view is shown after results are ready
        setTimeout(() => {
            const svgContainer = document.getElementById('svgContainer');
            if (svgContainer && svgContainer.innerHTML) {
                const svgContent = svgContainer.innerHTML;
                buildComparisonView(svgContent);
            } else {
                // Try alternative approach - show comparison with just the original image
                const container = document.getElementById('imgCompContainer');
                const baseImg = document.getElementById('imgCompBase');
                const originalImg = document.getElementById('previewImg');
                if (container && baseImg && originalImg && originalImg.src) {
                    baseImg.src = originalImg.src;
                    container.style.display = 'block';
                }
            }
        }, 1000);
    }

    function finishGenerationUI() {
        if (!generateBtn) return;
        isGenerating = false;
        generateBtn.disabled = false;
        generateBtn.removeAttribute('aria-busy');
        generateBtn.textContent = 'Generate Paint by Numbers';
    }

    function copyGeneratedResults() {
        
        const templateImage = document.getElementById('templateImage');
        const newSvgContainer = document.getElementById('svgContainer');
        const newCanvas = document.getElementById('canvas');
        
        // Try multiple sources for the SVG
        let svgContent = '';
        let svgSource = '';
        
        // 1. Check main output pane first (most likely location)
        const mainSvgContainer = document.querySelector('#output-pane #svgContainer');
        if (mainSvgContainer && mainSvgContainer.innerHTML.trim() !== '') {
            svgContent = mainSvgContainer.innerHTML;
            svgSource = 'main output pane';
        }
        
        // 2. Check hidden processing area
        if (!svgContent) {
            const existingSvgContainer = document.querySelector('.hidden-processing #svgContainer');
            if (existingSvgContainer && existingSvgContainer.innerHTML.trim() !== '') {
                svgContent = existingSvgContainer.innerHTML;
                svgSource = 'hidden processing area';
            }
        }
        
        // 3. Check for any SVG in the document
        if (!svgContent) {
            const anySvg = document.querySelector('svg');
            if (anySvg && anySvg.outerHTML.includes('path')) {
                svgContent = anySvg.outerHTML;
                svgSource = 'document SVG';
            }
        }
        
        // 4. Check for SVG in hidden processing area more broadly
        if (!svgContent) {
            const hiddenProcessing = document.querySelector('.hidden-processing');
            if (hiddenProcessing) {
                const svgInHidden = hiddenProcessing.querySelector('svg');
                if (svgInHidden && svgInHidden.outerHTML.includes('path')) {
                    svgContent = svgInHidden.outerHTML;
                    svgSource = 'hidden processing SVG';
                }
            }
        }
        
        // 5. Check for SVG in any container
        if (!svgContent) {
            const allSvgs = document.querySelectorAll('svg');
            for (let svg of allSvgs) {
                if (svg.outerHTML.includes('path') && svg.outerHTML.length > 100) {
                    svgContent = svg.outerHTML;
                    svgSource = 'any container SVG';
                    break;
                }
            }
        }
        
        // Store SVG content in container (hidden) for palette creation
        if (svgContent && newSvgContainer) {
            newSvgContainer.innerHTML = svgContent;
            newSvgContainer.style.display = 'none'; // Hidden but content available
        }
        
        // Copy palette from output pane to new UI
        copyPaletteToNewUI();
        
        // Prefer the new comparison view. Only render legacy single image if the new compare container is not present.
        const imgCompContainerEl = document.getElementById('imgCompContainer');
        if (svgContent && templateImage && !imgCompContainerEl) {
            convertSvgToPng(svgContent, templateImage);
        }

        // Build comparison slider with colored and outline images
        if (svgContent && imgCompContainerEl) {
            try {
                buildComparisonView(svgContent);
            } catch(e) { /* Failed to build comparison view */ }
        }
        
        // Copy the colored reference image from canvas
        const existingCanvas = document.querySelector('.hidden-processing #canvas');
        if (existingCanvas && newCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
            const ctx = newCanvas.getContext('2d');
            newCanvas.width = existingCanvas.width;
            newCanvas.height = existingCanvas.height;
            ctx.drawImage(existingCanvas, 0, 0);
        }
    }

    function copyPaletteToNewUI() {
        try {
            const outputPalette = document.querySelector('#output-pane #palette');
            const newPalette = document.getElementById('newPalette');
            
            if (outputPalette && newPalette && outputPalette.innerHTML.trim() !== '') {
                newPalette.innerHTML = outputPalette.innerHTML;
            }
            enforceCustomPaletteSwatches();
            groupPalettesByFamily();
        } catch (e) {
            // Failed to copy palette - not critical
        }
    }

    function convertSvgToPng(svgContent, imageElement, targetWidth, targetHeight) {
        try {
            // Create a temporary SVG element
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = svgContent;
            const svgElement = tempDiv.querySelector('svg');
            
            if (!svgElement) {
                console.log('No SVG element found in content');
                return;
            }
            
            // Compute size using viewBox when available for consistent pixel output
            const parseDim = (v) => {
                if (!v) return NaN; const s = (v + '').trim();
                if (s.endsWith('px')) return parseFloat(s);
                if (s.endsWith('%')) return NaN; const n = parseFloat(s);
                return isNaN(n) ? NaN : n;
            };
            let width = NaN, height = NaN;
            const vb = svgElement.getAttribute('viewBox');
            if (vb) {
                const parts = vb.split(/[\s,]+/).map(parseFloat);
                if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { width = parts[2]; height = parts[3]; }
            }
            if (isNaN(width) || isNaN(height)) { width = parseDim(svgElement.getAttribute('width')); height = parseDim(svgElement.getAttribute('height')); }
            if (!width || !height || isNaN(width) || isNaN(height)) { width = 2048; height = 1536; }
            // If caller provided target dimensions (e.g., base image size), use them for the canvas
            // Render at a higher pixel density for sharper display (especially in 600px viewport)
            const pixelScale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
            const outW = Math.min(4096, Math.round((targetWidth || width) * pixelScale));
            const outH = Math.min(4096, Math.round((targetHeight || height) * pixelScale));
            
            // Create a canvas to render the SVG
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set canvas size to output dimensions
            canvas.width = outW;
            canvas.height = outH;
            
            // Force SVG to render at canvas size to avoid contain-scaling letterbox
            if (!svgElement.getAttribute('viewBox')) {
                svgElement.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            }
            svgElement.setAttribute('width', outW);
            svgElement.setAttribute('height', outH);
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            
            // Create an image from the SVG
            const svgData = new XMLSerializer().serializeToString(svgElement);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);
            
            const img = new Image();
            img.onload = function() {
                // Paint white background for consistent visual
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                // High quality rasterization hints
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                // Draw at full canvas size — SVG viewBox handles aspect ratio
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Convert canvas to PNG data URL
                const pngDataUrl = canvas.toDataURL('image/png');
                
                // Set the PNG as the source of the template image (no download here)
                imageElement.src = pngDataUrl;
                imageElement.style.display = 'block';
                
                // Clean up
                URL.revokeObjectURL(svgUrl);
                
                console.log('SVG converted to PNG successfully');
            };
            
            img.onerror = function() {
                console.log('Error loading SVG for conversion');
                URL.revokeObjectURL(svgUrl);
            };
            
            img.src = svgUrl;
            
        } catch (error) {
            console.log('Error converting SVG to PNG:', error);
        }
    }

    function convertSvgToPngNoLabels(svgContent, imageElement, targetWidth, targetHeight) {
        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = svgContent;
            const svgElement = tempDiv.querySelector('svg');
            if (!svgElement) { console.log('No SVG element found in content'); return; }

            // Remove label texts
            svgElement.querySelectorAll('text').forEach(function(t){ t.parentNode && t.parentNode.removeChild(t); });

            // Ensure all outlines render in gray instead of black (keep fills)
            try {
                const selectors = ['path', 'polygon', 'rect', 'circle', 'ellipse', 'polyline', 'line'];
                selectors.forEach(function(sel){
                    svgElement.querySelectorAll(sel).forEach(function(el){
                        let st = el.getAttribute('style') || '';
                        st = st
                            .replace(/stroke-width\s*:[^;]*;?/gi, '')
                            .replace(/stroke\s*:[^;]*;?/gi, '');
                        el.setAttribute('style', st);
                        el.setAttribute('stroke', '#9CA3AF');
                        el.setAttribute('stroke-width', '0.8');
                        el.setAttribute('vector-effect', 'non-scaling-stroke');
                    });
                });
            } catch(_) { /* non-fatal */ }

            // Use same conversion pipeline as convertSvgToPng
            const parseDim = (v) => {
                if (!v) return NaN; const s = (v + '').trim();
                if (s.endsWith('px')) return parseFloat(s);
                if (s.endsWith('%')) return NaN; const n = parseFloat(s);
                return isNaN(n) ? NaN : n;
            };
            let width = NaN, height = NaN;
            const vb = svgElement.getAttribute('viewBox');
            if (vb) {
                const parts = vb.split(/[\s,]+/).map(parseFloat);
                if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { width = parts[2]; height = parts[3]; }
            }
            if (isNaN(width) || isNaN(height)) { width = parseDim(svgElement.getAttribute('width')); height = parseDim(svgElement.getAttribute('height')); }
            if (!width || !height || isNaN(width) || isNaN(height)) { width = 2048; height = 1536; }

            const pixelScale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
            const outW = Math.min(4096, Math.round((targetWidth || width) * pixelScale));
            const outH = Math.min(4096, Math.round((targetHeight || height) * pixelScale));

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = outW; canvas.height = outH;

            // Force SVG to render at canvas size to avoid contain-scaling letterbox
            if (!svgElement.getAttribute('viewBox')) {
                svgElement.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            }
            svgElement.setAttribute('width', outW);
            svgElement.setAttribute('height', outH);
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            const svgData = new XMLSerializer().serializeToString(svgElement);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = function() {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                // Draw at full canvas size — SVG viewBox handles aspect ratio
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const pngDataUrl = canvas.toDataURL('image/png');
                imageElement.src = pngDataUrl;
                imageElement.style.display = 'block';
                URL.revokeObjectURL(svgUrl);
            };
            img.onerror = function(){ URL.revokeObjectURL(svgUrl); };
            img.src = svgUrl;
        } catch (error) {
            console.log('Error converting SVG to PNG (no labels):', error);
        }
    }



    function updateColorPalette() {
        const palette = document.getElementById('palette');
        const newPalette = document.getElementById('newPalette');
        const source = document.querySelector('#output-pane #palette');
        if (source && source.innerHTML.trim() !== '') {
            if (palette && palette !== source) {
                palette.innerHTML = source.innerHTML;
            }
            if (newPalette) {
                newPalette.innerHTML = source.innerHTML;
            }
            // Apply style similar to PDF (circle swatches + labels)
            const style = document.createElement('style');
            style.textContent = `
                #palette, #newPalette { display: grid; grid-template-columns: repeat(9, minmax(64px,1fr)); gap: 16px 20px; justify-items: center; }
                #palette .color, #newPalette .color { text-align: center; }
                #palette .color-swatch, #newPalette .color-swatch { width: 48px; height: 48px; border-radius: 9999px; border: 2px solid #333; margin: 0 auto 8px; }
                #palette .color-number, #newPalette .color-number { font-weight: 700; font-size: 15px; line-height: 1; margin-bottom: 2px; }
                #palette .color-code, #newPalette .color-code { font-weight: 700; font-size: 13px; color: #1e293b; line-height: 1.2; margin-bottom: 2px; }
                #palette .color-hex, #newPalette .color-hex { font-size: 13px; color: #667085; }
            `;
            // Inject styling once per page
            if (!document.getElementById('palette-style')) {
                style.id = 'palette-style';
                document.head.appendChild(style);
            }
        }
        enforceCustomPaletteSwatches();
        groupPalettesByFamily();
    }

    // Rebuilds a palette container so each Darl'Art paint family sits on its own labelled line
    function groupPaletteByFamily(container) {
        if (!container || typeof window.findPaletteFamily !== 'function') return;
        const swatches = Array.from(container.querySelectorAll('.color'));
        if (swatches.length === 0) return;

        const rowsByKey = new Map();
        let matchedCount = 0;
        swatches.forEach(function(el) {
            const hexEl = el.querySelector('.color-hex');
            const codeEl = el.querySelector('.color-code');
            const numberEl = el.querySelector('.color-number');
            const hex = hexEl ? hexEl.textContent.trim() : '';
            const code = codeEl ? codeEl.textContent.trim() : '';
            const family = hex ? window.findPaletteFamily(hex, code) : null;
            if (family) matchedCount++;
            const key = family ? family.familyIndex : Number.MAX_VALUE;
            if (!rowsByKey.has(key)) {
                rowsByKey.set(key, { key: key, label: family ? family.label : 'Other colors', items: [] });
            }
            rowsByKey.get(key).items.push({ el: el, number: numberEl ? (parseInt(numberEl.textContent, 10) || 0) : 0 });
        });

        container.innerHTML = '';
        if (matchedCount === 0) {
            // No Darl'Art colors in this palette: keep the plain grid
            container.classList.remove('palette--grouped');
            swatches.forEach(function(el) { container.appendChild(el); });
            return;
        }

        container.classList.add('palette--grouped');
        Array.from(rowsByKey.values())
            .sort(function(a, b) { return a.key - b.key; })
            .forEach(function(row) {
                const rowEl = document.createElement('div');
                rowEl.className = 'palette-family';
                const headerEl = document.createElement('div');
                headerEl.className = 'palette-family-header';
                const labelEl = document.createElement('div');
                labelEl.className = 'palette-family-label';
                labelEl.textContent = row.label;
                const countEl = document.createElement('span');
                countEl.className = 'palette-family-count';
                countEl.textContent = String(row.items.length);
                countEl.title = row.items.length + (row.items.length > 1 ? ' colors' : ' color');
                headerEl.appendChild(labelEl);
                headerEl.appendChild(countEl);
                const swatchesEl = document.createElement('div');
                swatchesEl.className = 'palette-family-swatches';
                row.items
                    .sort(function(a, b) { return a.number - b.number; })
                    .forEach(function(item) { swatchesEl.appendChild(item.el); });
                rowEl.appendChild(headerEl);
                rowEl.appendChild(swatchesEl);
                container.appendChild(rowEl);
            });
    }

    function groupPalettesByFamily() {
        [document.getElementById('newPalette'), document.getElementById('palette')].forEach(groupPaletteByFamily);
    }
    window.groupPalettesByFamily = groupPalettesByFamily;

    function enforceCustomPaletteSwatches() {
        try {
            let desiredCount = 0;
            const txtNrOfClusters = document.getElementById('txtNrOfClusters');
            if (txtNrOfClusters && txtNrOfClusters.value) {
                desiredCount = parseInt(txtNrOfClusters.value, 10) || 0;
            }
            if (!desiredCount) {
                const colorsSlider = document.getElementById('colorsSlider');
                if (colorsSlider && colorsSlider.value) {
                    desiredCount = parseInt(colorsSlider.value, 10) || 0;
                }
            }
            if (!desiredCount) return;

            const targets = [
                document.getElementById('newPalette'),
                document.getElementById('palette'),
                document.querySelector('#output-pane #palette')
            ].filter((el, idx, arr) => el && arr.indexOf(el) === idx);

            // Read custom colors from input
            const colorRestrictionsInput = document.getElementById('colorRestrictionsInput');
            const customText = (colorRestrictionsInput ? colorRestrictionsInput.value : '') ||
                               (document.getElementById('txtKMeansColorRestrictions') ? document.getElementById('txtKMeansColorRestrictions').value : '');
            if (!customText || !customText.trim()) return;

            const customColors = [];
            const seenCustom = new Set();

            function addCustomItem(r, g, b, code) {
                if (isNaN(r) || isNaN(g) || isNaN(b)) return;
                r = Math.max(0, Math.min(255, Math.floor(r)));
                g = Math.max(0, Math.min(255, Math.floor(g)));
                b = Math.max(0, Math.min(255, Math.floor(b)));
                const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                if (!seenCustom.has(hex.toLowerCase())) {
                    seenCustom.add(hex.toLowerCase());
                    const cleanCode = code ? String(code).trim().replace(/^["']|["']$/g, '') : '';
                    customColors.push({ r: r, g: g, b: b, hex: hex, rgb: `rgb(${r},${g},${b})`, code: cleanCode });
                }
            }

            function parseHex(h) {
                let clean = (h || '').trim().replace(/^#/, '');
                if (clean.length === 3) clean = clean.split('').map(x => x + x).join('');
                if (clean.length === 6) {
                    const r = parseInt(clean.substring(0, 2), 16);
                    const g = parseInt(clean.substring(2, 4), 16);
                    const b = parseInt(clean.substring(4, 6), 16);
                    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r, g, b];
                }
                return null;
            }

            const trimmed = customText.trim();
            let parsedJson = false;
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(item => {
                            if (typeof item === 'string') {
                                const rgb = parseHex(item);
                                if (rgb) addCustomItem(rgb[0], rgb[1], rgb[2]);
                            } else if (item && typeof item === 'object') {
                                const rgb = parseHex(item.color || item.hex || item.rgb || '');
                                if (rgb) addCustomItem(rgb[0], rgb[1], rgb[2], item.code || item.id || '');
                            }
                        });
                    } else if (parsed && typeof parsed === 'object') {
                        Object.entries(parsed).forEach(([k, v]) => {
                            const codeVal = (v !== undefined && v !== null) ? String(v) : '';
                            if (k.startsWith('#')) {
                                const rgb = parseHex(k);
                                if (rgb) addCustomItem(rgb[0], rgb[1], rgb[2], codeVal);
                            } else if (k.includes(',')) {
                                const p = k.split(',');
                                if (p.length === 3) addCustomItem(parseInt(p[0]), parseInt(p[1]), parseInt(p[2]), codeVal);
                            }
                        });
                    }
                    if (customColors.length > 0) parsedJson = true;
                } catch(_) {}
            }

            if (!parsedJson) {
                const lines = customText.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('//')) continue;
                    if (line.startsWith('#')) {
                        const m = line.match(/^#([0-9a-fA-F]{3,8})([,:\s]+(.+))?$/);
                        if (m) {
                            const rgb = parseHex('#' + m[1]);
                            if (rgb) addCustomItem(rgb[0], rgb[1], rgb[2], m[3]);
                        }
                    } else if (line.includes(',')) {
                        const parts = line.split(',');
                        if (parts.length >= 4) {
                            addCustomItem(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), parts.slice(3).join(','));
                        } else if (parts.length === 3) {
                            const submatch = parts[2].trim().match(/^(\d+)([:\s]+(.+))?$/);
                            if (submatch) {
                                addCustomItem(parseInt(parts[0]), parseInt(parts[1]), parseInt(submatch[1]), submatch[3]);
                            } else {
                                addCustomItem(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
                            }
                        }
                    }
                }
            }

            if (customColors.length === 0) return;

            targets.forEach(function(target) {
                const swatches = Array.from(target.querySelectorAll('.color'));
                if (swatches.length === 0) return;
                if (swatches.length < desiredCount) {
                    const existingHexes = new Set();
                    swatches.forEach(function(s) {
                        const hexEl = s.querySelector('.color-hex');
                        if (hexEl && hexEl.textContent) {
                            existingHexes.add(hexEl.textContent.trim().toLowerCase());
                        }
                    });

                    let nextNumber = swatches.length + 1;
                    for (let c = 0; c < customColors.length; c++) {
                        if (target.querySelectorAll('.color').length >= desiredCount) break;
                        const col = customColors[c];
                        if (!existingHexes.has(col.hex.toLowerCase())) {
                            existingHexes.add(col.hex.toLowerCase());
                            const colorElement = document.createElement('div');
                            colorElement.className = 'color';
                            colorElement.setAttribute('data-tooltip', `${col.r},${col.g},${col.b}`);
                            const codeHtml = col.code ? `<div class="color-code">${col.code}</div>` : '';
                            colorElement.innerHTML = `
                                <div class="color-swatch" style="background-color: ${col.rgb}"></div>
                                <div class="color-number">${nextNumber++}</div>
                                ${codeHtml}
                                <div class="color-hex">${col.hex}</div>
                            `;
                            target.appendChild(colorElement);
                        }
                    }
                }
            });
        } catch(e) {
            console.warn('Error enforcing palette swatches:', e);
        }
    }
    
    function createPaletteFromSvg() {
        const palette = document.getElementById('palette');
        const svgContainer = document.getElementById('svgContainer');
        
        console.log('createPaletteFromSvg called');
        console.log('palette element:', palette);
        console.log('svgContainer element:', svgContainer);
        
        if (!palette || !svgContainer) {
            console.log('Missing palette or svgContainer elements');
            return;
        }
        
        const svg = svgContainer.querySelector('svg');
        console.log('SVG element found:', svg);
        
        if (!svg) {
            console.log('No SVG found in container, trying fallback method');
            createPaletteFallback();
            return;
        }
        
        // Extract colors from SVG paths
        const paths = svg.querySelectorAll('path[fill]');
        console.log(`Found ${paths.length} paths with fill attributes`);
        
        const colors = new Map();
        
        paths.forEach((path, index) => {
            const fill = path.getAttribute('fill');
            console.log(`Path ${index}: fill="${fill}"`);
            if (fill && fill !== 'none' && !colors.has(fill)) {
                colors.set(fill, colors.size);
            }
        });
        
        console.log(`Extracted ${colors.size} unique colors from SVG`);
        
        // If no colors found from paths, try other elements
        if (colors.size === 0) {
            console.log('No colors found in paths, trying other elements...');
            const allElements = svg.querySelectorAll('*');
            allElements.forEach((element, index) => {
                const fill = element.getAttribute('fill');
                const style = element.getAttribute('style');
                let color = fill;
                
                if (!color && style) {
                    const fillMatch = style.match(/fill:\s*([^;]+)/);
                    if (fillMatch) color = fillMatch[1];
                }
                
                if (color && color !== 'none' && color !== 'transparent' && !colors.has(color)) {
                    colors.set(color, colors.size);
                    console.log(`Found color from element ${index}: ${color}`);
                }
            });
        }
        
        // If still no colors, use fallback
        if (colors.size === 0) {
            console.log('Still no colors found, using fallback method');
            createPaletteFallback();
            return;
        }
        
        // Create palette items
        colors.forEach((index, color) => {
            const colorElement = document.createElement('div');
            colorElement.className = 'color';
            
            colorElement.innerHTML = `
                <div class="color-swatch" style="background-color: ${color}"></div>
                <div class="color-number">${index + 1}</div>
                <div class="color-hex">${rgbToHex(color)}</div>
                `;
                
                palette.appendChild(colorElement);
            });
        
        console.log(`Created palette with ${colors.size} colors from SVG`);
        console.log(`Palette now has ${palette.children.length} children`);
    }
    
    function createPaletteFromSvgInContainer(container) {
        const svgContainer = document.getElementById('svgContainer');
        
        console.log('createPaletteFromSvgInContainer called');
        console.log('container element:', container);
        console.log('svgContainer element:', svgContainer);
        
        if (!container || !svgContainer) {
            console.log('Missing container or svgContainer elements');
            createPaletteFallbackInContainer(container);
            return;
        }
        
        const svg = svgContainer.querySelector('svg');
        console.log('SVG element found:', svg);
        
        if (!svg) {
            console.log('No SVG found in container, trying fallback method');
            createPaletteFallbackInContainer(container);
            return;
        }
        
        // Extract colors from SVG paths
        const paths = svg.querySelectorAll('path[fill]');
        console.log(`Found ${paths.length} paths with fill attributes`);
        
        const colors = new Map();
        
        paths.forEach((path, index) => {
            const fill = path.getAttribute('fill');
            console.log(`Path ${index}: fill="${fill}"`);
            if (fill && fill !== 'none' && !colors.has(fill)) {
                colors.set(fill, colors.size);
            }
        });
        
        console.log(`Extracted ${colors.size} unique colors from SVG`);
        
        // If no colors found from paths, try other elements
        if (colors.size === 0) {
            console.log('No colors found in paths, trying other elements...');
            const allElements = svg.querySelectorAll('*');
            allElements.forEach((element, index) => {
                const fill = element.getAttribute('fill');
                const style = element.getAttribute('style');
                let color = fill;
                
                if (!color && style) {
                    const fillMatch = style.match(/fill:\s*([^;]+)/);
                    if (fillMatch) color = fillMatch[1];
                }
                
                if (color && color !== 'none' && color !== 'transparent' && !colors.has(color)) {
                    colors.set(color, colors.size);
                    console.log(`Found color from element ${index}: ${color}`);
                }
            });
        }
        
        // If still no colors, use fallback
        if (colors.size === 0) {
            console.log('Still no colors found, using fallback method');
            createPaletteFallbackInContainer(container);
            return;
        }
        
        // Create palette items
        colors.forEach((index, color) => {
            const colorElement = document.createElement('div');
            colorElement.className = 'color';
            
            colorElement.innerHTML = `
                <div class="color-swatch" style="background-color: ${color}"></div>
                <div class="color-number">${index + 1}</div>
                <div class="color-hex">${rgbToHex(color)}</div>
            `;
            
            container.appendChild(colorElement);
        });
        
        console.log(`Created palette with ${colors.size} colors from SVG`);
        console.log(`Container now has ${container.children.length} children`);
    }
    
    function createPaletteFallbackInContainer(container) {
        if (!container) return;
        
        console.log('Creating fallback palette in container...');
        
        // Create a vibrant palette with 16 diverse colors (1-16)
        const colors = [
            '#352B50', // Dark purple
            '#1B3671', // Dark blue
            '#275699', // Medium blue
            '#0F1B4A', // Very dark blue
            '#070E2A', // Almost black
            '#3B1119', // Dark reddish-brown
            '#5F3753', // Dark purplish-brown
            '#2E7FB4', // Teal/light blue
            '#6B617D', // Muted purple-gray
            '#8FC0B3', // Light mint green
            '#F1D28F', // Pale yellow
            '#B37574', // Muted rose-pink
            '#A04850', // Dark red/maroon
            '#45ACC5', // Bright teal
            '#E76548', // Orange
            '#F1A063'  // Light orange/peach
        ];
        
        colors.forEach((color, index) => {
            const colorElement = document.createElement('div');
            colorElement.className = 'color';
            
            colorElement.innerHTML = `
                <div class="color-swatch" style="background-color: ${color}"></div>
                <div class="color-number">${index + 1}</div>
                <div class="color-hex">${color}</div>
            `;
            
            container.appendChild(colorElement);
        });
        
        console.log(`Created fallback palette with ${colors.length} colors in container`);
    }
    
    function createPaletteFallback() {
        const palette = document.getElementById('palette');
        if (!palette) return;
        
        console.log('Creating fallback palette...');
        
        // Create a vibrant palette with 16 diverse colors (1-16)
        const colors = [
            '#352B50', // Dark purple
            '#1B3671', // Dark blue
            '#275699', // Medium blue
            '#0F1B4A', // Very dark blue
            '#070E2A', // Almost black
            '#3B1119', // Dark reddish-brown
            '#5F3753', // Dark purplish-brown
            '#2E7FB4', // Teal/light blue
            '#6B617D', // Muted purple-gray
            '#8FC0B3', // Light mint green
            '#F1D28F', // Pale yellow
            '#B37574', // Muted rose-pink
            '#A04850', // Dark red/maroon
            '#45ACC5', // Bright teal
            '#E76548', // Orange
            '#F1A063'  // Light orange/peach
        ];
        
        colors.forEach((color, index) => {
            const colorElement = document.createElement('div');
            colorElement.className = 'color';
            
            colorElement.innerHTML = `
                <div class="color-swatch" style="background-color: ${color}"></div>
                <div class="color-number">${index + 1}</div>
                <div class="color-hex">${color}</div>
            `;
            
            palette.appendChild(colorElement);
        });
        
        console.log(`Created fallback palette with ${colors.length} colors`);
    }

    function rgbToHex(rgb) {
        if (!rgb) return '#000000';
        
        // Convert rgb(r,g,b) to hex
        const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }
        
        return rgb;
    }

    function buildComparisonView(svgContent) {
        const container = document.getElementById('imgCompContainer');
        const overlay = document.getElementById('imgCompOverlay');
        let overlayImg = document.getElementById('imgCompOverlayImg');
        const baseImg = document.getElementById('imgCompBase');
        const slider = document.getElementById('imgCompSlider');
        // Do NOT require overlayImg to exist. Earlier runs could have replaced overlay contents.
        if (!container || !overlay || !baseImg || !slider) {
            console.warn('Comparison elements not found');
            return;
        }


        // Hide legacy image
        const legacyImage = document.getElementById('templateImage');
        if (legacyImage) legacyImage.style.display = 'none';

        // Base (LEFT) should be the colored PNG (no labels) derived from the template SVG
        const originalImg = document.getElementById('previewImg');
        if (originalImg && originalImg.src) {
            try {
                convertSvgToPngNoLabels(svgContent, baseImg, originalImg.naturalWidth, originalImg.naturalHeight);
                baseImg.alt = 'Colored template (no labels)';
            } catch (e) {
                console.warn('Failed to set base to colored PNG, falling back to original image');
                baseImg.src = originalImg.src;
                baseImg.alt = 'Original image';
            }
        } else {
            try {
                convertSvgToPngNoLabels(svgContent, baseImg);
                baseImg.alt = 'Colored template (no labels)';
            } catch(_) { console.warn('No original image found'); }
        }

        // Render outline as a high-resolution PNG on the RIGHT overlay (no inline SVGs)
        try {
            // Ensure the overlay <img> exists (we only use PNGs now)
                    if (!overlayImg) {
                        overlayImg = document.createElement('img');
                        overlayImg.id = 'imgCompOverlayImg';
                        overlayImg.alt = 'Paint by numbers template';
                        overlay.appendChild(overlayImg);
                    }
            // Remove any previously appended inline SVGs
            try { const prevSvgs = overlay.querySelectorAll('svg'); prevSvgs.forEach(function(n){ n.remove(); }); } catch(_) {}

            // Build an outline-only SVG and rasterize it to PNG at base image size
            const outlineSvgMarkup = createOutlineSvg(svgContent);
            const targetW = (originalImg && originalImg.naturalWidth) || (baseImg && baseImg.naturalWidth) || undefined;
            const targetH = (originalImg && originalImg.naturalHeight) || (baseImg && baseImg.naturalHeight) || undefined;
            convertSvgToPng(outlineSvgMarkup, overlayImg, targetW, targetH);
            // Ensure overlay starts hidden until we reveal the container to prevent brief full-frame flash
            overlayImg.style.display = 'block';
        } catch (e) {
            console.warn('Failed to render PNG overlay', e);
            if (!overlayImg) {
                overlayImg = document.createElement('img');
                overlayImg.id = 'imgCompOverlayImg';
                overlayImg.alt = 'Paint by numbers template';
                overlay.appendChild(overlayImg);
            }
            convertSvgToPng(svgContent, overlayImg, (originalImg && originalImg.naturalWidth) || baseImg.naturalWidth, (originalImg && originalImg.naturalHeight) || baseImg.naturalHeight);
        }

        // Show container & slider immediately but mask real images with placeholders until both are ready
        const showPlaceholders = () => {
        container.style.display = 'block';
        slider.style.display = 'block';
            // Use a neutral background so the user sees a stable frame
            try { container.classList.add('img-comp-loading'); } catch(_) {}
        };
        showPlaceholders();

        // Reveal images atomically when both are ready
        const revealIfReady = () => {
            const ready = baseImg && baseImg.complete && baseImg.naturalWidth > 0 && overlayImg && overlayImg.complete && overlayImg.naturalWidth > 0;
            if (!ready) return false;
            try { container.classList.remove('img-comp-loading'); } catch(_) {}
            return true;
        };
        if (!revealIfReady()) {
            const tryAgain = () => { revealIfReady(); };
            requestAnimationFrame(tryAgain);
            if (baseImg) baseImg.onload = tryAgain;
            if (overlayImg) overlayImg.onload = tryAgain;
        }

        // Initialize at 50% edge position without moving image sizes
        slider.style.left = '50%';
        slider.setAttribute('aria-valuenow', '50');
        // Force default orientation immediately (SVG on right, PNG on left)
        try {
            const maskInit = document.getElementById('imgCompMask');
            if (maskInit) {
                maskInit.style.clipPath = 'inset(0 0 0 50%)';
                maskInit.style.webkitClipPath = 'inset(0 0 0 50%)';
            }
        } catch (_) { /* ignore */ }

        // Ensure container keeps the aspect ratio of the base image
        const resizeToBase = () => {
            try {
                if (!baseImg || !baseImg.naturalWidth || !baseImg.naturalHeight) return;
                const ratio = baseImg.naturalHeight / baseImg.naturalWidth;
                // Base available width is the current container (capped by CSS max-width: 600px)
                const parentWidth = (container.parentElement ? container.parentElement.clientWidth : container.clientWidth) || 600;
                const cssMaxWidth = 600; // keep in sync with .img-comp-container max-width
                const availableWidth = Math.min(parentWidth, cssMaxWidth);
                const desiredHeight = Math.round(availableWidth * ratio);
                const maxHeightPx = Math.round(window.innerHeight * 0.70); // match CSS max-height: 70vh

                let finalWidth = availableWidth;
                let finalHeight = desiredHeight;
                if (desiredHeight > maxHeightPx) {
                    finalHeight = maxHeightPx;
                    finalWidth = Math.round(finalHeight / ratio);
                }

                // Apply calculated size so the container always matches the image aspect
                container.style.width = finalWidth + 'px';
                container.style.height = Math.max(200, finalHeight) + 'px';

                // Recenter slider after resize to avoid drift and ensure it's within image bounds
                const rect = container.getBoundingClientRect();
                const center = Math.round(rect.width / 2);
                const mask = document.getElementById('imgCompMask');
                if (mask) {
                    const leftInset = Math.max(0, center);
                    mask.style.clipPath = `inset(0 0 0 ${leftInset}px)`;
                    mask.style.webkitClipPath = `inset(0 0 0 ${leftInset}px)`;
                }
                // Vertically size slider to exactly match the image's drawn box
                try {
                    // Compute letterbox using container size and the base image natural ratio
                    const naturalW = baseImg.naturalWidth || 1;
                    const naturalH = baseImg.naturalHeight || 1;
                const ar = naturalW / naturalH;
                    const cw = rect.width;
                    const ch = rect.height;
                    let drawnW = cw, drawnH = cw / ar;
                    if (drawnH > ch) { // fits by height
                        drawnH = ch;
                        drawnW = ch * ar;
                    }
                    const topInset = Math.max(0, Math.round((ch - drawnH) / 2));
                    const leftInsetX = Math.max(0, Math.round((cw - drawnW) / 2));
                // If overlay contains an inline SVG, align its viewBox aspect to base image
                try {
                    const svgOverlay = overlay.querySelector('svg');
                    if (svgOverlay) {
                        svgOverlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                        // Make sure SVG letterboxes the same way as base image by using 100% sizing
                        svgOverlay.setAttribute('width', '100%');
                        svgOverlay.setAttribute('height', '100%');
                    }
                } catch (_) { /* ignore */ }
                    slider.style.top = topInset + 'px';
                    slider.style.height = Math.round(drawnH) + 'px';
                    // Persist drawn box so interaction logic can clamp to image bounds
                    try {
                        container.setAttribute('data-drawn-left', String(leftInsetX));
                        container.setAttribute('data-drawn-top', String(topInset));
                        container.setAttribute('data-drawn-width', String(Math.round(drawnW)));
                        container.setAttribute('data-drawn-height', String(Math.round(drawnH)));
                    } catch(_) {}
                } catch (_) { /* ignore */ }
                slider.style.left = center + 'px';
            } catch (e) { /* noop */ }
        };
        if (baseImg.complete && baseImg.naturalWidth > 0) {
            resizeToBase();
        } else {
            const onBaseLoad = () => { resizeToBase(); revealIfReady(); };
            baseImg.onload = onBaseLoad;
        }
        window.addEventListener('resize', resizeToBase);

        // Both sides are PNG now; overlay is a rasterized outline image

        // Initialize the comparison functionality (pixel-based clipping like W3Schools)
        initImgCompare(container, overlay, slider);
        
    }

    function createOutlineSvg(svgContent) {
        try {
            const temp = document.createElement('div');
            temp.innerHTML = svgContent;
            const svg = temp.querySelector('svg');
            if (!svg) return svgContent;

            // Ensure white background
            const bboxWidth = svg.getAttribute('width') || '100%';
            const bboxHeight = svg.getAttribute('height') || '100%';
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', '0');
            bg.setAttribute('y', '0');
            bg.setAttribute('width', typeof bboxWidth === 'string' ? bboxWidth : String(bboxWidth));
            bg.setAttribute('height', typeof bboxHeight === 'string' ? bboxHeight : String(bboxHeight));
            bg.setAttribute('fill', '#ffffff');
            svg.insertBefore(bg, svg.firstChild);

            const setStroke = (el) => {
                el.removeAttribute('fill');
                el.removeAttribute('fill-opacity');
                let style = el.getAttribute('style') || '';
                // Strip any existing fill/stroke declarations so our attributes take effect
                style = style
                    .replace(/stroke-width\s*:[^;]*;?/gi, '')
                    .replace(/stroke\s*:[^;]*;?/gi, '')
                    .replace(/fill[^;]*;?/gi, '');
                el.setAttribute('style', style);
                el.setAttribute('fill', 'none');
                el.setAttribute('stroke', '#9CA3AF');
                el.setAttribute('stroke-width', '0.8');
                el.setAttribute('vector-effect', 'non-scaling-stroke');
            };

            const selectors = ['path', 'polygon', 'rect', 'circle', 'ellipse', 'polyline'];
            selectors.forEach(sel => svg.querySelectorAll(sel).forEach(setStroke));

            // Style label texts (keep labels visible) and make them gray like outlines
            const textColor = '#9CA3AF';
            svg.querySelectorAll('text').forEach(function(t){
                let tStyle = t.getAttribute('style') || '';
                tStyle = tStyle
                    .replace(/stroke\s*:[^;]*;?/gi, '')
                    .replace(/fill[^;]*;?/gi, '');
                t.setAttribute('style', tStyle);
                t.setAttribute('fill', textColor);
            });
            svg.querySelectorAll('tspan').forEach(function(ts){
                let s = ts.getAttribute('style') || '';
                s = s
                    .replace(/stroke\s*:[^;]*;?/gi, '')
                    .replace(/fill[^;]*;?/gi, '');
                ts.setAttribute('style', s);
                ts.setAttribute('fill', textColor);
            });

            return svg.outerHTML;
        } catch(e) {
            console.warn('Failed to create outline SVG, using original', e);
            return svgContent;
        }
    }

    function initImgCompare(container, overlay, slider) {
        let clicked = false;
        const getPosX = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const mask = document.getElementById('imgCompMask');
        // Touch action will be managed dynamically during drag

        // Only allow starting drag within the actually drawn image box (letterboxed vertically)
        const isInsideDrawnImage = (clientX, clientY) => {
            const rect = container.getBoundingClientRect();
            // Read the precise drawn image box stored by resizeToBase
            const leftInset = parseFloat(container.getAttribute('data-drawn-left') || '0');
            const topInset = parseFloat(container.getAttribute('data-drawn-top') || '0');
            const drawnW = parseFloat(container.getAttribute('data-drawn-width') || String(rect.width));
            const drawnH = parseFloat(container.getAttribute('data-drawn-height') || String(rect.height));
            const xLeft = rect.left + (isNaN(leftInset) ? 0 : leftInset);
            const xRight = xLeft + (isNaN(drawnW) ? rect.width : drawnW);
            const yTop = rect.top + (isNaN(topInset) ? 0 : topInset);
            const yBottom = yTop + (isNaN(drawnH) ? rect.height : drawnH);
            return clientX >= xLeft && clientX <= xRight && clientY >= yTop && clientY <= yBottom;
        };

        const slide = (x) => {
            const rect = container.getBoundingClientRect();
            // Clamp horizontally to drawn image box
            const leftInset = parseFloat(container.getAttribute('data-drawn-left') || '0');
            const drawnW = parseFloat(container.getAttribute('data-drawn-width') || String(rect.width));
            const minX = rect.left + (isNaN(leftInset) ? 0 : leftInset);
            const maxX = minX + (isNaN(drawnW) ? rect.width : drawnW);
            const clampedClientX = clamp(x, minX, maxX);
            const pos = Math.round(clampedClientX - rect.left);
            // Apply clip-path to reveal overlay from the RIGHT side
            const leftInsetPx = Math.max(0, pos);
            if (mask) {
                mask.style.clipPath = `inset(0 0 0 ${leftInsetPx}px)`;
                mask.style.webkitClipPath = `inset(0 0 0 ${leftInsetPx}px)`;
            }
            // Keep slider aligned to the mask edge
            slider.style.left = pos + 'px';
            const percent = (pos / rect.width) * 100;
            slider.setAttribute('aria-valuenow', String(Math.round(percent)));
        };

        const startSlide = (e) => { 
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (!isInsideDrawnImage(clientX, clientY)) return; // ignore starts outside the image area
            clicked = true; 
            slide(getPosX(e)); 
            e.preventDefault(); 
            e.stopPropagation();
        };
        
        const moveSlide = (e) => { 
            if (!clicked) return; 
            slide(getPosX(e)); 
            e.preventDefault();
        };
        
        const endSlide = () => { 
            clicked = false; 
        };

        // Mouse events
        slider.addEventListener('mousedown', startSlide);
        document.addEventListener('mousemove', moveSlide);
        document.addEventListener('mouseup', endSlide);
        
        // No touch events - let browser handle scrolling naturally

        // Pointer events (unify pen/mouse/touch on modern browsers)
        if (window.PointerEvent) {
            let gestureStarted = false; // any pointer active
            let gestureDecided = false; // whether we determined H-drag vs V-scroll
            let horizontalDrag = false;
            let startX = 0;
            let startY = 0;
            const decisionThresholdPx = 6; // small slop to distinguish intent

            const onPointerDown = (e) => {
                // Let touch gestures be handled by explicit touch handlers below (iOS reliability)
                if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
                const clientX = e.clientX;
                const clientY = e.clientY;
                if (!isInsideDrawnImage(clientX, clientY)) return; // ignore starts outside
                gestureStarted = true;
                gestureDecided = false;
                horizontalDrag = false;
                startX = clientX;
                startY = clientY;
                clicked = false; // not yet dragging horizontally
                // Move the slider immediately to the tapped position for quick one-tap adjustments
                slide(clientX);
                // Do NOT preventDefault yet; allow browser to decide until we detect horizontal intent
            };

            const onPointerMove = (e) => {
                if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
                if (!gestureStarted) return;

                const cx = e.clientX;
                const cy = e.clientY;

                if (!gestureDecided) {
                    const dx = Math.abs(cx - startX);
                    const dy = Math.abs(cy - startY);
                    if (dx + dy < decisionThresholdPx) {
                        // Not enough movement to decide yet
                        return;
                    }
                    if (dx > dy + 2) {
                        // Horizontal drag -> engage slider
                        gestureDecided = true;
                        horizontalDrag = true;
                        clicked = true;
                        // During horizontal drag, disable touch scrolling so the slider follows the finger
                        try { container.style.touchAction = 'none'; } catch(_) {}
                        try { (slider.setPointerCapture ? slider : container).setPointerCapture(e.pointerId); } catch(_) {}
                        slide(cx);
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    } else {
                        // Vertical scroll -> let browser handle it
                        gestureDecided = true;
                        horizontalDrag = false;
                        clicked = false;
                        return;
                    }
                }

                if (horizontalDrag) {
                    slide(cx);
                    e.preventDefault();
                    e.stopPropagation();
                }
            };

            const onPointerUp = () => {
                gestureStarted = false;
                gestureDecided = false;
                horizontalDrag = false;
                clicked = false;
                // Re-enable normal scrolling behavior after drag
                try { container.style.touchAction = ''; } catch(_) {}
            };

            slider.addEventListener('pointerdown', onPointerDown);
            container.addEventListener('pointerdown', onPointerDown);
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        }

        // Touch handlers (also used on browsers that support Pointer Events, for mobile reliability)
        {
            let tActive = false;
            let tDecided = false;
            let tHorizontal = false;
            let tStartX = 0;
            let tStartY = 0;
            const threshold = 6;

            const getTouchXY = (ev) => {
                const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
                return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
            };

            const onTouchStart = (e) => {
                const { x, y } = getTouchXY(e);
                if (!isInsideDrawnImage(x, y)) return;
                tActive = true; tDecided = false; tHorizontal = false; clicked = false;
                tStartX = x; tStartY = y;
                // Snap immediately to tapped position
                slide(x);
            };

            const onTouchMove = (e) => {
                if (!tActive) return;
                const { x, y } = getTouchXY(e);
                if (!tDecided) {
                    const dx = Math.abs(x - tStartX);
                    const dy = Math.abs(y - tStartY);
                    if (dx + dy < threshold) return;
                    if (dx > dy + 2) {
                        tDecided = true; tHorizontal = true; clicked = true;
                        // Disable scrolling during horizontal drag so the slider follows the finger
                        try { container.style.touchAction = 'none'; } catch(_) {}
                        slide(x); e.preventDefault();
                        return;
                    } else {
                        tDecided = true; tHorizontal = false; clicked = false; // allow scroll
                        return;
                    }
                }
                if (tHorizontal) { slide(x); e.preventDefault(); }
            };

            const onTouchEnd = () => { tActive = false; tDecided = false; tHorizontal = false; clicked = false; try { container.style.touchAction = ''; } catch(_) {} };

            slider.addEventListener('touchstart', onTouchStart, { passive: true });
            container.addEventListener('touchstart', onTouchStart, { passive: true });
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
            document.addEventListener('touchcancel', onTouchEnd);
        }
    }
});



(function(){
  function boot(){
    if (typeof requirejs !== 'function') { setTimeout(boot, 10); return; }
    try {
      requirejs(['main'], function (MyApp) { try { window.MyApp = MyApp; } catch(_) {} });
    } catch(_) { setTimeout(boot, 50); }
  }
  boot();
})();
