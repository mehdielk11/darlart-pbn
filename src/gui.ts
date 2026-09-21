/**
 * Module that provides function the GUI uses and updates the DOM accordingly
 */

import { CancellationToken, IMap, RGB } from "./common";
import { getColorCode } from "./core/palette";
import { buildPdf, JsPdfConstructor, PAPER_SIZES, PaperSize } from "./core/pdf";
import { buildSettings, Difficulty } from "./core/settings";
import { buildFadedSvgString } from "./core/svg";
import { GUIProcessManager, ProcessResult } from "./guiprocessmanager";
import { findPaletteFamily } from "./palettefamilies";
import { Settings } from "./settings";

declare function saveSvgAsPng(el: Node, filename: string, options?: { backgroundColor?: string; scale?: number }): void;

let processResult: ProcessResult | null = null;
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
    return buildSettings({ colors, difficulty, customColors });
}

export async function process() {
    try {
        const settings: Settings = parseSettings();
        // cancel old process & create new
        cancellationToken.isCancelled = true;
        cancellationToken = new CancellationToken();
        processResult = await GUIProcessManager.process(settings, cancellationToken);
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

export function downloadPNG(filename?: string) {
    if ($("#svgContainer svg").length > 0) {
        const original = $("#svgContainer svg").get(0) as unknown as SVGSVGElement;
        const clone = original.cloneNode(true) as SVGSVGElement;

        // Remove all labels/numbers before exporting
        const labelGroups = clone.querySelectorAll('g.label');
        labelGroups.forEach((el) => el.parentNode && el.parentNode.removeChild(el));
        const texts = clone.querySelectorAll('text');
        texts.forEach((el) => el.parentNode && el.parentNode.removeChild(el));

        const defaultName = (typeof (window as any).getOutputFilename === "function")
            ? (window as any).getOutputFilename("png")
            : "paintbynumbers.png";
        saveSvgAsPng(clone, filename || defaultName);
    }
}

/** The template as a pre-printed canvas: faint colors, grey outlines and numbers (same look as the API's canvas.png) */
export function downloadCanvasPNG(filename?: string) {
    if (processResult == null) {
        return;
    }
    const svgString = buildFadedSvgString(processResult.facetResult, processResult.colorsByIndex, { sizeMultiplier: 3, strokeWidth: 1.2 });
    const svg = document.importNode(new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement, true);
    const defaultName = (typeof (window as any).getOutputFilename === "function")
        ? String((window as any).getOutputFilename("png")).replace(/\.png$/i, "-canvas.png")
        : "paintbynumbers-canvas.png";
    saveSvgAsPng(svg, filename || defaultName, { backgroundColor: "#ffffff" });
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

try {
    (window as any).downloadSVG = downloadSVG;
    (window as any).downloadPNG = downloadPNG;
    (window as any).downloadCanvasPNG = downloadCanvasPNG;
    (window as any).findPaletteFamily = findPaletteFamily;
    (window as any).downloadPalettePng = downloadPalettePng;
    (window as any).buildTemplatePdf = buildTemplatePdf;
} catch (_) {}
