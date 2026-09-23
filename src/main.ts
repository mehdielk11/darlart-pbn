import { downloadPalettePng, downloadPNG, downloadSVG, loadExample, process, updateOutput } from "./gui";
import { Clipboard } from "./lib/clipboard";

$(document).ready(function () {

    $(".tabs").tabs();
    $(".tooltipped").tooltip();

    const clip = new Clipboard("canvas", true);

    $("#file").change(function (ev) {
        const files = (<HTMLInputElement>$("#file").get(0)).files;
        if (files !== null && files.length > 0) {
            (window as any).uploadedFileName = files[0].name;
            const reader = new FileReader();
            reader.onloadend = function () {
                const img = document.createElement("img");
                img.onload = () => {
                    const c = document.getElementById("canvas") as HTMLCanvasElement;
                    const ctx = c.getContext("2d")!;
                    c.width = img.naturalWidth;
                    c.height = img.naturalHeight;
                    ctx.drawImage(img, 0, 0);
                };
                img.onerror = () => {
                    alert("Unable to load image");
                }
                img.src = <string>reader.result;
            }
            reader.readAsDataURL(files[0]);
        }
    });

    loadExample("imgSmall");

    $("#btnProcess").click(async function () {
        try {
            await process();
        } catch (err) {
            alert("Error: " + err);
        }
    });

    $("#chkShowLabels, #chkFillFacets, #chkShowBorders, #txtSizeMultiplier, #txtLabelFontSize, #txtLabelFontColor").change(async () => {
        await updateOutput();
    });

    // Buttons of the hidden original UI. The site's own download buttons are wired in scripts/ui-handler.js:
    // binding these by their old ids added a second handler to them, so the PNG downloaded twice.
    $("#btnLegacyDownloadSVG").click(function () {
        downloadSVG();
    });

    $("#btnLegacyDownloadPNG").click(function () {
        downloadPNG();
    });

    $("#btnLegacyDownloadPalettePNG").click(function () {
        downloadPalettePng();
    });

    $("#lnkTrivial").click(() => { loadExample("imgTrivial"); return false; });
    $("#lnkSmall").click(() => { loadExample("imgSmall"); return false; });
    $("#lnkMedium").click(() => { loadExample("imgMedium"); return false; });
});
