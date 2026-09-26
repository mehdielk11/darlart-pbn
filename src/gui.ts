/**
 * Module that provides function the GUI uses and updates the DOM accordingly
 */

import { CancellationToken, IMap, RGB } from "./common";
import { getColorCode } from "./core/palette";
import { buildPaintingPdf, buildPdf, JsPdfConstructor, PAPER_SIZES, PaperSize } from "./core/pdf";
import { containBox, coverSource, darkenForSheet, insetBox, MOCKUP_KITS_GLOBAL, MOCKUP_STYLE, MockupBox, MockupTemplate, pickMockupTemplate, sheetGeometry } from "./core/mockup";
import { buildSettings, Difficulty } from "./core/settings";
import { buildBlankSvgString, buildFadedSvgString, buildSvgString, FADED_CANVAS_STYLE } from "./core/svg";
import { GUIProcessManager, ProcessResult } from "./guiprocessmanager";
import { findPaletteFamily } from "./palettefamilies";
import { Settings } from "./settings";

declare function saveSvgAsPng(el: Node, filename: string, options?: { backgroundColor?: string; scale?: number }): void;

let processResult: ProcessResult | null = null;
/** The (cropped) photo that processResult was made from, for the mockup's image card */
let processedPhoto: HTMLCanvasElement | null = null;
let cancellationToken: CancellationToken = new CancellationToken();

const timers: IMap<Date> = {};
export function time(name: string) {
    console.time(name);
    timers[name] = new Date();
}

export function timeEnd(name: string) {
    console.timeEnd(name);
    const ms = new Date().getTime() - timers[name].getTime();
    log(name + ": " + ms + "ms");
    delete timers[name];
}

export function log(str: string) {
    $("#log").append("<br/><span>" + str + "</span>");
}

/**
 * Settings from the website controls, built by the shared core (same presets and seed as the API)
 */
export function parseSettings(): Settings {
    const colors = parseInt($("#colorsSlider").val() + "", 10) || parseInt($("#txtNrOfClusters").val() + "", 10) || 24;
    const difficultyValue = Math.round(parseFloat($("#difficultySlider").val() + ""));
    const difficulty: Difficulty = difficultyValue === 1 ? "easy" : (difficultyValue === 3 ? "hard" : "medium");
    const customColors = ($("#colorRestrictionsInput").val() ? $("#colorRestrictionsInput").val() : $("#txtKMeansColorRestrictions").val()) + "";
    const settings = buildSettings({ colors, difficulty, customColors });
    // like the API: a very speckled image has its tiny areas merged at once before the facet reduction (src/core/despeckle.ts).
    // Add ?despeckle=0 to the page URL to compare with the result without it.
    settings.despeckleTinyAreas = new URLSearchParams(window.location.search).get("despeckle") !== "0";
    return settings;
}

export async function process() {
    try {
        const settings: Settings = parseSettings();
        // cancel old process & create new
        cancellationToken.isCancelled = true;
        cancellationToken = new CancellationToken();
        const photo = snapshotCanvas(document.getElementById("canvas") as HTMLCanvasElement);
        processResult = await GUIProcessManager.process(settings, cancellationToken);
        processedPhoto = photo;
        await updateOutput();
        const tabsOutput = M.Tabs.getInstance(document.getElementById("tabsOutput")!);
        tabsOutput.select("output-pane");
    } catch (e: any) {
        log("Error: " + e.message + " at " + e.stack);
    }
}

export async function updateOutput() {

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

        const svg = await GUIProcessManager.createSVG(processResult.facetResult, processResult.colorsByIndex, sizeMultiplier, fill, stroke, showLabels, fontSize, fontColor, (progress) => {
            if (cancellationToken.isCancelled) { throw new Error("Cancelled"); }
            $("#statusSVGGenerate").css("width", Math.round(progress * 100) + "%");
        });
        $("#svgContainer").empty().append(svg);
        const paletteElements = createPaletteHtml(processResult.colorsByIndex, processResult.colorCodes);
        $("#palette").empty().append(paletteElements.clone());
        $("#newPalette").empty().append(paletteElements);
        try { ($("#palette .color, #newPalette .color") as any).tooltip(); } catch(_) {}
        if (typeof (window as any).groupPalettesByFamily === "function") {
            (window as any).groupPalettesByFamily();
        }
        $(".status").removeClass("active");
        $(".status.SVGGenerate").addClass("complete");
    }
}

function createPaletteHtml(colorsByIndex: RGB[], colorCodes: { [key: string]: string } = {}) {
    let html = "";
    for (let c: number = 0; c < colorsByIndex.length; c++) {
        const r = colorsByIndex[c][0];
        const g = colorsByIndex[c][1];
        const b = colorsByIndex[c][2];
        const colorValue = `rgb(${r},${g},${b})`;
        const hexValue = rgbToHex(colorValue);
        const code = getColorCode(colorsByIndex[c], colorCodes);
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
function rgbToHex(rgb: string): string {
    if (!rgb) return '#000000';
    
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

export function downloadPalettePng() {
    if (processResult == null) { return; }
    const colorsByIndex: RGB[] = processResult.colorsByIndex;

    const canvas = document.createElement("canvas");

    const nrOfItemsPerRow = 10;
    const nrRows = Math.ceil(colorsByIndex.length / nrOfItemsPerRow);
    const margin = 10;
    const cellWidth = 80;
    const cellHeight = 70;

    canvas.width = margin + nrOfItemsPerRow * (cellWidth + margin);
    canvas.height = margin + nrRows * (cellHeight + margin);
    const ctx = canvas.getContext("2d")!;
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
export function downloadPNG(filename?: string) {
    if (processResult == null) {
        return;
    }
    const svgString = buildSvgString(processResult.facetResult, processResult.colorsByIndex, { fill: true, stroke: false, labels: false });
    const svg = document.importNode(new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement, true);
    const defaultName = (typeof (window as any).getOutputFilename === "function")
        ? (window as any).getOutputFilename("png")
        : "paintbynumbers.png";
    saveSvgAsPng(svg, filename || defaultName, { backgroundColor: "#ffffff" });
}

/** The pre-printed canvas as vector: the same faint look as the Preview PNG, with slightly stronger colors */
export function downloadFadedSVG(filename?: string) {
    if (processResult == null) {
        return;
    }
    const svgString = buildFadedSvgString(processResult.facetResult, processResult.colorsByIndex, {
        colorStrength: FADED_CANVAS_STYLE.svgColorStrength,
        strokeWidth: 1.2,
        fontFamily: "Tahoma, 'DejaVu Sans', Arial, sans-serif",
    });
    const defaultName = (typeof (window as any).getOutputFilename === "function")
        ? String((window as any).getOutputFilename("svg")).replace(/\.svg$/i, "-canvas.svg")
        : "paintbynumbers-canvas.svg";
    saveTextFile('<?xml version="1.0" standalone="no"?>\r\n' + svgString, filename || defaultName, "image/svg+xml;charset=utf-8");
}

/** The blank template: dark grey outlines and black numbers on white, no colors */
export function downloadBlankSVG(filename?: string) {
    if (processResult == null) {
        return;
    }
    const svgString = buildBlankSvgString(processResult.facetResult, processResult.colorsByIndex, {
        fontFamily: "Tahoma, 'DejaVu Sans', Arial, sans-serif",
    });
    const defaultName = (typeof (window as any).getOutputFilename === "function")
        ? String((window as any).getOutputFilename("svg")).replace(/\.svg$/i, "-blank.svg")
        : "paintbynumbers-blank.svg";
    saveTextFile('<?xml version="1.0" standalone="no"?>\r\n' + svgString, filename || defaultName, "image/svg+xml;charset=utf-8");
}

function saveTextFile(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function snapshotCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")!.drawImage(source, 0, 0);
    return copy;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load " + src));
        img.src = src;
    });
}

/** A kit's layers, from its script (loaded once): data URLs keep the canvas exportable even from a page opened as a file */
function loadMockupKit(template: MockupTemplate): Promise<{ blank: string; overlay: string }> {
    const kits = () => (window as any)[MOCKUP_KITS_GLOBAL] || {};
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

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, box: MockupBox) {
    const source = coverSource(image.width, image.height, box.width, box.height);
    ctx.drawImage(image, source.left, source.top, source.width, source.height, box.left, box.top, box.width, box.height);
}

/**
 * The "perfect kit" product photo for the last result, drawn the same way as the API's mockup.png: the faded
 * canvas on the canvas, a darker grey print of it on the reference sheet and the photo on the image card.
 */
export async function buildMockupCanvas(): Promise<HTMLCanvasElement | null> {
    if (processResult == null || processedPhoto == null) {
        return null;
    }
    const facets = processResult.facetResult;
    const template = pickMockupTemplate(facets.width / facets.height);
    const svgString = buildFadedSvgString(facets, processResult.colorsByIndex, { sizeMultiplier: 2, strokeWidth: 1, background: "#ffffff" });
    // a data URL, not a blob: URL, which would block the export when the page is opened as a file
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    const kit = await loadMockupKit(template);
    const [blank, overlay, faded] = await Promise.all([loadImage(kit.blank), loadImage(kit.overlay), loadImage(svgUrl)]);
    // the SVG as pixels, so it's rasterised once
    const art = document.createElement("canvas");
    art.width = faded.naturalWidth || facets.width * 2;
    art.height = faded.naturalHeight || facets.height * 2;
    const artCtx = art.getContext("2d")!;
    artCtx.fillStyle = "#ffffff";
    artCtx.fillRect(0, 0, art.width, art.height);
    artCtx.drawImage(faded, 0, 0, art.width, art.height);

    // the reference sheet print: grey, darker, with a white margin
    const sheet = sheetGeometry(template);
    const print = document.createElement("canvas");
    print.width = sheet.width;
    print.height = sheet.height;
    const printCtx = print.getContext("2d")!;
    printCtx.fillStyle = "#ffffff";
    printCtx.fillRect(0, 0, sheet.width, sheet.height);
    drawCover(printCtx, art, { left: sheet.margin, top: sheet.margin, width: sheet.width - 2 * sheet.margin, height: sheet.height - 2 * sheet.margin });
    const pixels = printCtx.getImageData(0, 0, sheet.width, sheet.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
        const grey = darkenForSheet(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        data[i] = data[i + 1] = data[i + 2] = grey;
    }
    printCtx.putImageData(pixels, 0, 0);

    const out = document.createElement("canvas");
    out.width = template.size;
    out.height = template.size;
    const ctx = out.getContext("2d")!;
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
    drawCover(ctx, art, insetBox(template.canvas, MOCKUP_STYLE.canvasEdge));
    const card = containBox(processedPhoto.width, processedPhoto.height, insetBox(template.card, MOCKUP_STYLE.cardEdge));
    ctx.drawImage(processedPhoto, card.left, card.top, card.width, card.height);
    ctx.globalCompositeOperation = "source-over";
    return out;
}

export async function downloadMockupPNG(filename?: string) {
    const canvas = await buildMockupCanvas();
    if (canvas == null) {
        return;
    }
    const defaultName = (typeof (window as any).getOutputFilename === "function")
        ? String((window as any).getOutputFilename("png")).replace(/\.png$/i, "-mockup.png")
        : "paintbynumbers-mockup.png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
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
}

export function downloadSVG(filename?: string) {
    if ($("#svgContainer svg").length > 0) {
        const svgEl = $("#svgContainer svg").get(0) as any;

        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const svgData = svgEl.outerHTML;
        const preface = '<?xml version="1.0" standalone="no"?>\r\n';
        const svgBlob = new Blob([preface, svgData], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = svgUrl;
        const defaultName = (typeof (window as any).getOutputFilename === "function")
            ? (window as any).getOutputFilename("svg")
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

export function loadExample(imgId: string) {
    // load image
    const img = document.getElementById(imgId) as HTMLImageElement | null;
    if (img === null) {
        return;
    }
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
}

/** PDF built by the shared core from the last result (same document as the API) */
export function buildTemplatePdf(paperSize: string = "a4") {
    const jspdf = (window as any).jspdf;
    if (processResult == null || !jspdf || !jspdf.jsPDF) {
        return null;
    }
    const size = (PAPER_SIZES.indexOf(paperSize as PaperSize) >= 0 ? paperSize : "a4") as PaperSize;
    return buildPdf(jspdf.jsPDF as JsPdfConstructor, processResult, { paperSize: size });
}

/** The painting guide: colored template with its numbers, then the palette */
export function buildPaintingPdfDoc(paperSize: string = "a4") {
    const jspdf = (window as any).jspdf;
    if (processResult == null || !jspdf || !jspdf.jsPDF) {
        return null;
    }
    const size = (PAPER_SIZES.indexOf(paperSize as PaperSize) >= 0 ? paperSize : "a4") as PaperSize;
    return buildPaintingPdf(jspdf.jsPDF as JsPdfConstructor, processResult, { paperSize: size });
}

try {
    (window as any).downloadSVG = downloadSVG;
    (window as any).downloadPNG = downloadPNG;
    (window as any).buildMockupCanvas = buildMockupCanvas;
    (window as any).downloadMockupPNG = downloadMockupPNG;
    (window as any).findPaletteFamily = findPaletteFamily;
    (window as any).downloadPalettePng = downloadPalettePng;
    (window as any).buildTemplatePdf = buildTemplatePdf;
    (window as any).buildPaintingPdf = buildPaintingPdfDoc;
    (window as any).downloadFadedSVG = downloadFadedSVG;
    (window as any).downloadBlankSVG = downloadBlankSVG;
} catch (_) {}
