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
