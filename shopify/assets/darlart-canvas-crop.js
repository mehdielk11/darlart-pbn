/*
 * Darl'Art canvas crop widget (Shopify product page)
 *
 * The customer chooses the canvas size, the orientation (and optionally the number of colors), uploads a photo
 * and frames it with drag and zoom. The cropped photo is attached to the product form as a file line item property,
 * so Shopify stores it with the order, next to the size and orientation properties. The n8n workflow reads them
 * and sends the photo straight to the generator (cropMode "center").
 *
 * Requires Cropper.js 1.6 (loaded by the snippet) and a browser that supports DataTransfer file assignment.
 */
(() => {
  'use strict';

  const TEXT = {
    size: 'Taille du tableau',
    orientation: 'Orientation',
    portrait: 'Portrait',
    landscape: 'Paysage',
    square: 'Carré',
    colors: 'Nombre de couleurs',
    upload: 'Importer ma photo',
    uploadHint: 'JPG ou PNG, de préférence en bonne qualité',
    crop: 'Cadrage',
    cropHint: 'Déplacez et zoomez la photo pour choisir la partie à peindre.',
    change: 'Changer de photo',
    zoom: 'Zoom',
    preparing: 'Préparation de la photo…',
    ready: 'Votre photo cadrée sera jointe à la commande.',
    lowResolution: 'Photo de faible résolution : le tableau risque de manquer de détails.',
    missingPhoto: "Importez et cadrez votre photo avant d'ajouter au panier.",
    notImage: "Ce fichier n'est pas une image. Choisissez une photo JPG ou PNG.",
    tooLarge: 'Photo trop volumineuse (40 Mo maximum).',
    unreadable: 'Impossible de lire cette photo. Essayez une photo JPG ou PNG.',
    unsupported: 'Votre navigateur ne permet pas de joindre la photo. Essayez avec un autre navigateur.',
  };

  // names of the line item properties read by the n8n workflow
  const PROPERTIES = { photo: 'Photo', size: 'Taille', orientation: 'Orientation', colors: 'Couleurs' };

  const MAX_OUTPUT_SIDE = 3000; // longest side of the cropped photo sent with the order
  const MIN_RECOMMENDED_SIDE = 800; // shorter crops get a low resolution notice
  const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
  const JPEG_QUALITY = 0.92;
  const MAX_ZOOM = 4;

  const ICONS = {
    portrait: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="3.5" width="11" height="17" rx="1.5"/></svg>',
    landscape: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
  };

  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** "40x50" / "40 x 50 cm" → { short: 40, long: 50 } */
  const parseSize = (text) => {
    const match = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i.exec(String(text || ''));
    if (!match) return null;
    const a = parseFloat(match[1].replace(',', '.'));
    const b = parseFloat(match[2].replace(',', '.'));
    return a > 0 && b > 0 ? { short: Math.min(a, b), long: Math.max(a, b) } : null;
  };

  const canAttachFiles = () => {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(new File([''], 'test.txt', { type: 'text/plain' }));
      return transfer.files.length === 1;
    } catch (e) {
      return false;
    }
  };

  function init(root) {
    if (root.dataset.dccReady) return;
    root.dataset.dccReady = 'true';

    const formId = root.dataset.formId || '';
    const form = (formId && document.getElementById(formId)) || root.closest('form');
    const sizes = (root.dataset.sizes || '30x40,40x50,50x50,60x70').split(',').map((s) => ({ key: s.trim(), size: parseSize(s) })).filter((s) => s.size);
    const colorChoices = (root.dataset.colors || '').split(',').map((c) => parseInt(c, 10)).filter((c) => c > 0);
    // optional: follow the theme's own size / colors option pickers instead of showing our buttons
    const pickerScope = root.closest('.shopify-section') || document;
    const sizeGroup = root.dataset.sizeGroup ? pickerScope.querySelector(root.dataset.sizeGroup) : null;
    const colorsGroup = root.dataset.colorsGroup ? pickerScope.querySelector(root.dataset.colorsGroup) : null;
    const syncVariant = root.dataset.syncVariant !== 'false' && !sizeGroup;

    const state = {
      size: sizes[0] ? sizes[0].size : { short: 30, long: 40 },
      orientation: 'portrait',
      colors: colorChoices.length ? (colorChoices.includes(parseInt(root.dataset.defaultColors, 10)) ? parseInt(root.dataset.defaultColors, 10) : colorChoices[0]) : null,
      cropper: null,
      objectUrl: null,
      baseName: 'photo',
      baseRatio: 1,
      exporting: false,
      exportTimer: 0,
      exportToken: 0,
      afterExport: [], // callbacks waiting for the cropped photo, called with true once attached
    };

    root.innerHTML = `
      <div class="dcc__group"${sizeGroup ? ' hidden' : ''}>
        <span class="dcc__label" id="${formId}-dcc-size">${TEXT.size}</span>
        <div class="dcc__options dcc-sizes" role="radiogroup" aria-labelledby="${formId}-dcc-size">
          ${sizes.map((s) => `<button type="button" class="dcc__option" role="radio" data-size="${escapeHtml(s.key)}">${s.size.short} × ${s.size.long} cm</button>`).join('')}
        </div>
      </div>
      <div class="dcc__group dcc-orientation-group">
        <span class="dcc__label" id="${formId}-dcc-orientation">${TEXT.orientation}</span>
        <div class="dcc__options dcc-orientations" role="radiogroup" aria-labelledby="${formId}-dcc-orientation">
          <button type="button" class="dcc__option dcc__option--icon" role="radio" data-orientation="portrait">${ICONS.portrait}<span>${TEXT.portrait}</span></button>
          <button type="button" class="dcc__option dcc__option--icon" role="radio" data-orientation="landscape">${ICONS.landscape}<span>${TEXT.landscape}</span></button>
        </div>
      </div>
      ${colorChoices.length ? `
      <div class="dcc__group">
        <span class="dcc__label" id="${formId}-dcc-colors">${TEXT.colors}</span>
        <div class="dcc__options dcc-colors" role="radiogroup" aria-labelledby="${formId}-dcc-colors">
          ${colorChoices.map((c) => `<button type="button" class="dcc__option" role="radio" data-colors="${c}">${c}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="dcc__upload dcc-upload">
        <button type="button" class="dcc__upload-button dcc-pick">${ICONS.upload}<span>${TEXT.upload}</span></button>
        <span class="dcc__hint">${TEXT.uploadHint}</span>
      </div>
      <div class="dcc__editor dcc-editor" hidden>
        <div class="dcc__editor-head">
          <span class="dcc__label">${TEXT.crop}</span>
          <button type="button" class="dcc__link dcc-change">${TEXT.change}</button>
        </div>
        <p class="dcc__hint">${TEXT.cropHint}</p>
        <div class="dcc__stage"><img class="dcc-image" alt=""></div>
        <label class="dcc__zoom">
          <span>${TEXT.zoom}</span>
          <input type="range" class="dcc-zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1">
        </label>
        <p class="dcc__status dcc-status" aria-live="polite"></p>
      </div>
      <p class="dcc__error dcc-error" role="alert" hidden></p>
      <input type="file" class="dcc-source" accept="image/*" hidden>
    `;

    const $ = (selector) => root.querySelector(selector);
    const ui = {
      sizes: $('.dcc-sizes'),
      orientationGroup: $('.dcc-orientation-group'),
      orientations: $('.dcc-orientations'),
      colors: $('.dcc-colors'),
      upload: $('.dcc-upload'),
      pick: $('.dcc-pick'),
      editor: $('.dcc-editor'),
      change: $('.dcc-change'),
      image: $('.dcc-image'),
      zoom: $('.dcc-zoom'),
      status: $('.dcc-status'),
      error: $('.dcc-error'),
      source: $('.dcc-source'),
    };

    // inputs submitted with the product form (associated with the form even when the widget is rendered outside of it)
    const addInput = (type, property) => {
      const input = document.createElement('input');
      input.type = type;
      input.name = `properties[${property}]`;
      input.hidden = true;
      if (formId) input.setAttribute('form', formId);
      root.appendChild(input);
      return input;
    };
    const inputs = {
      photo: addInput('file', PROPERTIES.photo),
      size: addInput('hidden', PROPERTIES.size),
      orientation: addInput('hidden', PROPERTIES.orientation),
      colors: state.colors || colorsGroup ? addInput('hidden', PROPERTIES.colors) : null,
    };
    inputs.photo.accept = 'image/jpeg';

    const isSquare = () => state.size.short === state.size.long;
    const aspect = () => (isSquare() ? 1 : state.orientation === 'landscape' ? state.size.long / state.size.short : state.size.short / state.size.long);
    const sizeLabel = () => (state.orientation === 'landscape' && !isSquare() ? `${state.size.long}x${state.size.short}` : `${state.size.short}x${state.size.long}`);

    const showError = (message) => {
      ui.error.textContent = message || '';
      ui.error.hidden = !message;
    };
    const setStatus = (message, warning) => {
      ui.status.textContent = message || '';
      ui.status.classList.toggle('dcc__status--warning', !!warning);
    };

    const setPressed = (container, attribute, value) => {
      if (!container) return;
      container.querySelectorAll('button').forEach((button) => {
        const selected = button.getAttribute(attribute) === String(value);
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
    };

    const updateInputs = () => {
      inputs.size.value = `${sizeLabel()} cm`;
      inputs.orientation.value = isSquare() ? TEXT.square : state.orientation === 'landscape' ? TEXT.landscape : TEXT.portrait;
      if (inputs.colors) inputs.colors.value = state.colors ? String(state.colors) : '';
      setPressed(ui.sizes, 'data-size', (sizes.find((s) => s.size.short === state.size.short && s.size.long === state.size.long) || {}).key);
      setPressed(ui.orientations, 'data-orientation', state.orientation);
      setPressed(ui.colors, 'data-colors', state.colors);
      ui.orientationGroup.hidden = isSquare();
    };

    /** Selects the product variant option matching the canvas size, when the product has one (best effort) */
    const syncVariantOption = () => {
      if (!syncVariant) return;
      const scope = root.closest('.shopify-section, product-info, section') || document;
      const matchesSize = (value) => {
        const size = parseSize(value);
        return size && size.short === state.size.short && size.long === state.size.long;
      };
      for (const radio of scope.querySelectorAll('input[type="radio"]')) {
        if (radio.closest('.dcc')) continue;
        if (matchesSize(radio.value)) {
          if (!radio.checked) radio.click();
          return;
        }
      }
      for (const select of scope.querySelectorAll('select')) {
        const option = Array.from(select.options).find((o) => matchesSize(o.value) || matchesSize(o.textContent));
        if (option && !option.selected) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    };

    const clearPhoto = () => {
      state.exportToken++;
      state.exporting = false;
      try {
        inputs.photo.value = '';
      } catch (e) {
        // ignore
      }
    };

    const submitForm = () => {
      if (!form) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    };

    const finishExport = (attached) => {
      const callbacks = state.afterExport;
      state.afterExport = [];
      callbacks.forEach((callback) => callback(attached));
    };

    const exportCrop = () => {
      const cropper = state.cropper;
      if (!cropper) return;
      const token = ++state.exportToken;
      const canvas = cropper.getCroppedCanvas({
        maxWidth: MAX_OUTPUT_SIDE,
        maxHeight: MAX_OUTPUT_SIDE,
        fillColor: '#ffffff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });
      if (!canvas) {
        state.exporting = false;
        showError(TEXT.unreadable);
        finishExport(false);
        return;
      }
      canvas.toBlob((blob) => {
        if (token !== state.exportToken) return; // replaced by a newer crop
        state.exporting = false;
        if (!blob) {
          showError(TEXT.unreadable);
          finishExport(false);
          return;
        }
        const file = new File([blob], `${state.baseName}-${sizeLabel()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        inputs.photo.files = transfer.files;

        const crop = cropper.getData(true); // crop size in pixels of the original photo
        const lowResolution = Math.min(crop.width, crop.height) < MIN_RECOMMENDED_SIDE;
        setStatus(lowResolution ? TEXT.lowResolution : TEXT.ready, lowResolution);
        root.dispatchEvent(new CustomEvent('dcc:photo-ready', { bubbles: true, detail: { file, width: canvas.width, height: canvas.height, size: inputs.size.value, orientation: inputs.orientation.value } }));
        finishExport(true);
      }, 'image/jpeg', JPEG_QUALITY);
    };

    const scheduleExport = () => {
      if (!state.cropper) return;
      state.exporting = true;
      state.exportToken++;
      setStatus(TEXT.preparing);
      clearTimeout(state.exportTimer);
      state.exportTimer = setTimeout(exportCrop, 350);
    };

    /** Largest crop box with the canvas ratio, centered on the image */
    const fitCropBox = () => {
      const cropper = state.cropper;
      if (!cropper) return;
      const canvas = cropper.getCanvasData();
      let width = canvas.width;
      let height = width / aspect();
      if (height > canvas.height) {
        height = canvas.height;
        width = height * aspect();
      }
      cropper.setCropBoxData({
        left: canvas.left + (canvas.width - width) / 2,
        top: canvas.top + (canvas.height - height) / 2,
        width,
        height,
      });
    };

    const applyCanvasShape = () => {
      updateInputs();
      if (state.cropper) {
        state.cropper.setAspectRatio(aspect());
        fitCropBox();
        scheduleExport();
      }
    };

    const destroyCropper = () => {
      if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
      }
      if (state.objectUrl) {
        URL.revokeObjectURL(state.objectUrl);
        state.objectUrl = null;
      }
    };

    const loadPhoto = (file) => {
      showError('');
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        showError(TEXT.notImage);
        return;
      }
      if (file.size > MAX_SOURCE_BYTES) {
        showError(TEXT.tooLarge);
        return;
      }
      if (typeof window.Cropper !== 'function') {
        showError(TEXT.unreadable);
        return;
      }

      clearPhoto();
      destroyCropper();
      state.baseName = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'photo';
      state.objectUrl = URL.createObjectURL(file);

      ui.image.onerror = () => {
        destroyCropper();
        ui.editor.hidden = true;
        ui.upload.hidden = false;
        showError(TEXT.unreadable);
      };
      ui.image.onload = () => {
        // start with the orientation of the photo
        if (!isSquare()) {
          state.orientation = ui.image.naturalWidth > ui.image.naturalHeight ? 'landscape' : 'portrait';
        }
        updateInputs();
        syncVariantOption();
        ui.upload.hidden = true;
        ui.editor.hidden = false;
        ui.zoom.value = '1';

        state.cropper = new window.Cropper(ui.image, {
          viewMode: 1,
          dragMode: 'move',
          aspectRatio: aspect(),
          autoCropArea: 1,
          cropBoxMovable: false,
          cropBoxResizable: false,
          toggleDragModeOnDblclick: false,
          background: false,
          guides: true,
          center: true,
          highlight: false,
          checkOrientation: false,
          responsive: true,
          restore: false,
          ready() {
            fitCropBox();
            state.baseRatio = state.cropper.getCanvasData().width / state.cropper.getImageData().naturalWidth;
            scheduleExport();
          },
          zoom(event) {
            // never zoom out below the starting size, so the photo always fills the frame
            if (event.detail.ratio < state.baseRatio * 0.999) {
              event.preventDefault();
              return;
            }
            ui.zoom.value = String(Math.min(MAX_ZOOM, event.detail.ratio / state.baseRatio));
            scheduleExport();
          },
          cropend() {
            scheduleExport();
          },
        });
      };
      ui.image.src = state.objectUrl;
    };

    // events
    ui.sizes.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-size]');
      if (!button) return;
      const choice = sizes.find((s) => s.key === button.getAttribute('data-size'));
      if (!choice) return;
      state.size = choice.size;
      syncVariantOption();
      applyCanvasShape();
    });
    ui.orientations.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-orientation]');
      if (!button) return;
      state.orientation = button.getAttribute('data-orientation');
      applyCanvasShape();
    });
    if (ui.colors) {
      ui.colors.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-colors]');
        if (!button) return;
        state.colors = parseInt(button.getAttribute('data-colors'), 10);
        updateInputs();
      });
    }
    ui.pick.addEventListener('click', () => ui.source.click());
    ui.change.addEventListener('click', () => ui.source.click());
    ui.source.addEventListener('change', () => {
      loadPhoto(ui.source.files && ui.source.files[0]);
      ui.source.value = '';
    });
    ui.zoom.addEventListener('input', () => {
      if (!state.cropper) return;
      state.cropper.zoomTo(state.baseRatio * parseFloat(ui.zoom.value));
    });

    /** Calls back with true when the cropped photo is attached, right away or once the latest crop is exported */
    const whenPhotoAttached = (callback) => {
      const attached = inputs.photo.files && inputs.photo.files.length > 0;
      if (attached && !state.exporting) {
        callback(true);
        return;
      }
      if (!state.cropper) {
        showError(TEXT.missingPhoto);
        root.scrollIntoView({ behavior: 'smooth', block: 'center' });
        callback(false);
        return;
      }
      state.afterExport.push(callback);
      clearTimeout(state.exportTimer);
      exportCrop();
    };

    // block "add to cart" until the cropped photo is attached (capture phase: runs before the theme's own submit handler)
    if (form) {
      form.addEventListener('submit', (event) => {
        const attached = inputs.photo.files && inputs.photo.files.length > 0;
        if (attached && !state.exporting) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        whenPhotoAttached((ok) => ok && submitForm());
      }, true);
    }

    /**
     * For themes that add to cart with their own Ajax call instead of a form: resolves with the line item properties
     * ({ Photo: File, Taille, Orientation, Couleurs }) to send as multipart form data, or null when there is no photo yet.
     */
    root.dccGetProperties = () => new Promise((resolve) => {
      whenPhotoAttached((ok) => {
        if (!ok) {
          resolve(null);
          return;
        }
        const properties = {};
        Object.keys(inputs).forEach((key) => {
          const input = inputs[key];
          if (!input) return;
          if (input.type === 'file') properties[PROPERTIES[key]] = input.files[0];
          else if (input.value) properties[PROPERTIES[key]] = input.value;
        });
        resolve(properties);
      });
    });

    // follow the theme's size / colors pickers (selection is shown with the is-selected class or a select)
    const pickerValue = (group) => {
      const select = group.querySelector('select');
      if (select) return select.value;
      const selected = group.querySelector('.is-selected[data-option-value], [aria-checked="true"][data-option-value], input:checked');
      return selected ? selected.getAttribute('data-option-value') || selected.value : '';
    };
    const watchPicker = (group, apply) => {
      if (!group) return;
      apply(pickerValue(group));
      const onChange = () => apply(pickerValue(group));
      new MutationObserver(onChange).observe(group, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked', 'aria-pressed'] });
      group.addEventListener('change', onChange);
    };
    watchPicker(sizeGroup, (value) => {
      const size = parseSize(value);
      if (!size || (size.short === state.size.short && size.long === state.size.long)) return;
      state.size = size;
      applyCanvasShape();
    });
    watchPicker(colorsGroup, (value) => {
      const colors = parseInt(value, 10) || null;
      if (colors === state.colors) return;
      state.colors = colors;
      updateInputs();
    });

    if (!canAttachFiles()) {
      ui.pick.disabled = true;
      showError(TEXT.unsupported);
    }
    updateInputs();
  }

  const initAll = (scope) => {
    const roots = (scope || document).querySelectorAll('.dcc');
    if (!roots.length) return;
    // the snippet loads Cropper.js with defer just before this file, wait for it defensively
    let attempts = 0;
    const start = () => {
      if (typeof window.Cropper === 'function' || attempts++ > 100) {
        roots.forEach(init);
      } else {
        setTimeout(start, 50);
      }
    };
    start();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }
  // theme editor: sections are re-rendered without a page load
  document.addEventListener('shopify:section:load', (event) => initAll(event.target));
})();
