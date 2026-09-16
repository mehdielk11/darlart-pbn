/*
 * Darl'Art canvas crop widget (Shopify product page)
 *
 * The customer chooses the print format (A4/A3/A2, or a canvas size in cm), the orientation (and optionally the
 * number of colors), uploads a photo and frames it with drag and zoom. The cropped photo is attached to the product
 * form as a file line item property, so Shopify stores it with the order, next to the format and orientation
 * properties. The n8n workflow reads them and sends the photo straight to the generator (cropMode "center").
 *
 * Requires Cropper.js 1.6 (loaded by the snippet) and a browser that supports DataTransfer file assignment.
 */
(() => {
  'use strict';

  /**
   * One dictionary per published storefront language. The widget picks the one matching the page
   * (data-locale from the snippet, then Shopify.locale, then <html lang>), and falls back to English.
   * A theme can override any string by passing data-texts='{"upload":"…"}' on the widget.
   */
  const TEXTS = {
    en: {
      size: 'Print format',
      orientation: 'Orientation',
      portrait: 'Portrait',
      landscape: 'Landscape',
      square: 'Square',
      colors: 'Number of colors',
      upload: 'Upload my photo',
      uploadHint: 'JPG or PNG — the sharper the photo, the more detailed your template',
      crop: 'Framing',
      cropHint: 'Drag and zoom the photo to choose the part you will paint.',
      change: 'Change photo',
      validate: 'Confirm framing',
      edit: 'Edit framing',
      previewTitle: 'Your template',
      colorsUnit: 'colors',
      previewAlt: 'Preview of your template',
      zoom: 'Zoom',
      preparing: 'Preparing your photo…',
      ready: 'Your framed photo will be used to create your printable files.',
      lowResolution: 'Low resolution photo: your template may lack detail.',
      missingPhoto: 'Upload and frame your photo before adding to cart.',
      notImage: 'That file is not an image. Choose a JPG or PNG photo.',
      tooLarge: 'Photo too large (40 MB maximum).',
      unreadable: 'We could not read this photo. Try a JPG or PNG photo.',
      unsupported: 'Your browser cannot attach the photo. Try another browser.',
    },
    fr: {
      size: "Format d'impression",
      orientation: 'Orientation',
      portrait: 'Portrait',
      landscape: 'Paysage',
      square: 'Carré',
      colors: 'Nombre de couleurs',
      upload: 'Importer ma photo',
      uploadHint: 'JPG ou PNG, la photo la plus nette possible pour un modèle détaillé',
      crop: 'Cadrage',
      cropHint: 'Déplacez et zoomez la photo pour choisir la partie à peindre.',
      change: 'Changer de photo',
      validate: 'Valider le cadrage',
      edit: 'Modifier le cadrage',
      previewTitle: 'Votre modèle',
      colorsUnit: 'couleurs',
      previewAlt: 'Aperçu de votre modèle',
      zoom: 'Zoom',
      preparing: 'Préparation de la photo…',
      ready: 'Votre photo cadrée servira à créer vos fichiers à imprimer.',
      lowResolution: 'Photo de faible résolution : le modèle risque de manquer de détails.',
      missingPhoto: "Importez et cadrez votre photo avant d'ajouter au panier.",
      notImage: "Ce fichier n'est pas une image. Choisissez une photo JPG ou PNG.",
      tooLarge: 'Photo trop volumineuse (40 Mo maximum).',
      unreadable: 'Impossible de lire cette photo. Essayez une photo JPG ou PNG.',
      unsupported: 'Votre navigateur ne permet pas de joindre la photo. Essayez avec un autre navigateur.',
    },
    ar: {
      size: 'مقاس الطباعة',
      orientation: 'الاتجاه',
      portrait: 'عمودي',
      landscape: 'أفقي',
      square: 'مربع',
      colors: 'عدد الألوان',
      upload: 'تحميل صورتي',
      uploadHint: 'JPG أو PNG، كلما كانت الصورة أوضح كان النموذج أدق',
      crop: 'التأطير',
      cropHint: 'حرّك الصورة وقرّبها لاختيار الجزء الذي سترسمه.',
      change: 'تغيير الصورة',
      validate: 'تأكيد التأطير',
      edit: 'تعديل التأطير',
      previewTitle: 'نموذجك',
      colorsUnit: 'لون',
      previewAlt: 'معاينة نموذجك',
      zoom: 'تكبير',
      preparing: 'جارٍ تحضير الصورة…',
      ready: 'ستُستخدم صورتك المؤطّرة لإنشاء ملفاتك القابلة للطباعة.',
      lowResolution: 'دقة الصورة منخفضة: قد يفتقر النموذج إلى التفاصيل.',
      missingPhoto: 'حمّل صورتك وأطّرها قبل الإضافة إلى السلة.',
      notImage: 'هذا الملف ليس صورة. اختر صورة JPG أو PNG.',
      tooLarge: 'الصورة كبيرة جدًا (40 ميغابايت كحد أقصى).',
      unreadable: 'تعذّرت قراءة هذه الصورة. جرّب صورة JPG أو PNG.',
      unsupported: 'متصفحك لا يسمح بإرفاق الصورة. جرّب متصفحًا آخر.',
    },
  };

  const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

  /** The page language, as a bare language code ("fr-CA" → "fr") */
  const resolveLanguage = (root) => {
    const candidates = [
      root.dataset.locale,
      window.Shopify && window.Shopify.locale,
      document.documentElement.lang,
    ];
    for (const candidate of candidates) {
      const language = String(candidate || '').trim().toLowerCase().split(/[-_]/)[0];
      if (language && TEXTS[language]) return language;
    }
    return 'en';
  };

  /** The dictionary for this widget: the page language, plus any per-string override from the theme */
  const resolveTexts = (root, language) => {
    let overrides = {};
    try {
      overrides = root.dataset.texts ? JSON.parse(root.dataset.texts) : {};
    } catch (e) {
      overrides = {};
    }
    return { ...TEXTS.en, ...TEXTS[language], ...overrides };
  };

  // names of the line item properties read by the n8n workflow
  const PROPERTIES = { photo: 'Photo', size: 'Format', orientation: 'Orientation', colors: 'Couleurs' };

  /** Print formats (A series, all 1:√2) in cm: the customer prints the template on that sheet */
  const FORMAT_SIZES = { a4: { short: 21, long: 29.7 }, a3: { short: 29.7, long: 42 }, a2: { short: 42, long: 59.4 } };

  // The template is vector, so the upload doesn't set print sharpness: it sets how much detail the tracer sees.
  const MAX_OUTPUT_SIDE = 3000; // longest side of the cropped photo sent with the order
  const MIN_RECOMMENDED_SIDE = 1400; // shorter crops get a low resolution notice (the generator works at 1024 px)
  const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
  const JPEG_QUALITY = 0.92;
  const MAX_ZOOM = 4;

  const ICONS = {
    portrait: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="3.5" width="11" height="17" rx="1.5"/></svg>',
    landscape: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/></svg>',
    square: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>',
    crop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 2.5v15h15M2.5 6.5h15v15"/></svg>',
  };

  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** "A3" → { short: 29.7, long: 42, format: 'A3' }; "40x50" / "40 x 50 cm" → { short: 40, long: 50 } */
  const parseSize = (text) => {
    const value = String(text || '');
    const named = /\ba\s*([234])\b/i.exec(value);
    if (named && FORMAT_SIZES[`a${named[1]}`]) {
      const format = FORMAT_SIZES[`a${named[1]}`];
      return { short: format.short, long: format.long, format: `A${named[1]}` };
    }
    const match = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i.exec(value);
    if (!match) return null;
    const a = parseFloat(match[1].replace(',', '.'));
    const b = parseFloat(match[2].replace(',', '.'));
    return a > 0 && b > 0 ? { short: Math.min(a, b), long: Math.max(a, b) } : null;
  };

  const frenchNumber = (value) => String(value).replace('.', ',');

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

    const language = resolveLanguage(root);
    const TEXT = resolveTexts(root, language);
    if (RTL_LANGUAGES.includes(language)) {
      root.setAttribute('dir', 'rtl');
    }

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
      previewUrl: null,
      lowResolution: false,
      afterExport: [], // callbacks waiting for the cropped photo, called with true once attached
    };

    root.innerHTML = `
      <div class="dcc__group"${sizeGroup ? ' hidden' : ''}>
        <span class="dcc__label" id="${formId}-dcc-size">${TEXT.size}</span>
        <div class="dcc__options dcc-sizes" role="radiogroup" aria-labelledby="${formId}-dcc-size">
          ${sizes.map((s) => `<button type="button" class="dcc__option" role="radio" data-size="${escapeHtml(s.key)}">${s.size.format || `${s.size.short} × ${s.size.long} cm`}</button>`).join('')}
        </div>
      </div>
      <div class="dcc__group dcc-orientation-group">
        <span class="dcc__label" id="${formId}-dcc-orientation">${TEXT.orientation}</span>
        <div class="dcc__options dcc-orientations" role="radiogroup" aria-labelledby="${formId}-dcc-orientation">
          <button type="button" class="dcc__option dcc__option--icon" role="radio" data-orientation="portrait">${ICONS.portrait}<span>${TEXT.portrait}</span></button>
          <button type="button" class="dcc__option dcc__option--icon" role="radio" data-orientation="landscape">${ICONS.landscape}<span>${TEXT.landscape}</span></button>
          <button type="button" class="dcc__option dcc__option--icon" role="radio" data-orientation="square" hidden>${ICONS.square}<span>${TEXT.square}</span></button>
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
        <button type="button" class="dcc__button dcc-validate">${ICONS.check}<span>${TEXT.validate}</span></button>
      </div>
      <div class="dcc__preview dcc-preview" hidden tabindex="-1" aria-labelledby="${formId}-dcc-preview-title">
        <div class="dcc__preview-head">
          <span class="dcc__label" id="${formId}-dcc-preview-title">${TEXT.previewTitle}</span>
          <button type="button" class="dcc__link dcc-change-2">${TEXT.change}</button>
        </div>
        <figure class="dcc__preview-frame">
          <img class="dcc__preview-image dcc-preview-image" alt="${TEXT.previewAlt}">
        </figure>
        <p class="dcc__preview-meta dcc-preview-meta"></p>
        <p class="dcc__status dcc-preview-status" aria-live="polite"></p>
        <button type="button" class="dcc__button dcc__button--ghost dcc-edit">${ICONS.crop}<span>${TEXT.edit}</span></button>
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
      validate: $('.dcc-validate'),
      preview: $('.dcc-preview'),
      previewImage: $('.dcc-preview-image'),
      previewMeta: $('.dcc-preview-meta'),
      previewStatus: $('.dcc-preview-status'),
      edit: $('.dcc-edit'),
      change2: $('.dcc-change-2'),
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
    const isLandscape = () => state.orientation === 'landscape' && !isSquare();
    /** short name used in file names: "A3", or "50x40" for a canvas in cm */
    const sizeLabel = () => (state.size.format || (isLandscape() ? `${state.size.long}x${state.size.short}` : `${state.size.short}x${state.size.long}`));
    /** what the order shows: "A3 (29,7 × 42 cm)", or "40x50 cm" for a canvas */
    const sizeProperty = () => {
      const width = isLandscape() ? state.size.long : state.size.short;
      const height = isLandscape() ? state.size.short : state.size.long;
      return state.size.format
        ? `${state.size.format} (${frenchNumber(width)} × ${frenchNumber(height)} cm)`
        : `${sizeLabel()} cm`;
    };

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
        if (button.hidden) return;
        const selected = button.getAttribute(attribute) === String(value);
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
    };

    /** The canvas sizes on offer: the theme's own size picker when it drives the widget, our buttons otherwise */
    const sizeOptions = () => {
      if (!sizeGroup) return sizes.map((s) => ({ value: s.key, size: s.size }));
      const select = sizeGroup.querySelector('select');
      if (select) return Array.from(select.options).map((o) => ({ value: o.value, size: parseSize(o.value) || parseSize(o.textContent) }));
      return Array.from(sizeGroup.querySelectorAll('[data-option-value]')).map((el) => ({ value: el.getAttribute('data-option-value'), size: parseSize(el.getAttribute('data-option-value')), el }));
    };
    const squareOption = () => sizeOptions().find((o) => o.size && o.size.short === o.size.long) || null;
    const rectangleOptions = () => sizeOptions().filter((o) => o.size && o.size.short !== o.size.long);
    const lastRectangleOption = () => rectangleOptions().find((o) => o.value === state.lastRectangle) || rectangleOptions()[0] || null;

    /** Switches the canvas to that size, through the theme's picker when there is one */
    const selectSize = (option) => {
      if (!option || !option.size) return;
      if (!sizeGroup) {
        state.size = option.size;
        syncVariantOption();
        applyCanvasShape();
        return;
      }
      const select = sizeGroup.querySelector('select');
      if (select) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (option.el) {
        option.el.click();
      }
    };

    const updateInputs = () => {
      inputs.size.value = sizeProperty();
      // canonical English, so the order and the n8n workflow read the same value whatever the shop language
      inputs.orientation.value = isSquare() ? 'Square' : state.orientation === 'landscape' ? 'Landscape' : 'Portrait';
      if (inputs.colors) inputs.colors.value = state.colors ? String(state.colors) : '';
      setPressed(ui.sizes, 'data-size', (sizes.find((s) => s.size.short === state.size.short && s.size.long === state.size.long) || {}).key);
      // "Carré" is offered whenever the product has a square canvas; choosing it switches the canvas to that size
      const square = isSquare();
      const hasSquare = square || !!squareOption();
      const hasRectangle = !square || !!lastRectangleOption();
      ui.orientations.querySelectorAll('button').forEach((button) => {
        button.hidden = button.getAttribute('data-orientation') === 'square' ? !hasSquare : !hasRectangle;
      });
      setPressed(ui.orientations, 'data-orientation', square ? 'square' : state.orientation);
      setPressed(ui.colors, 'data-colors', state.colors);
      if (!ui.preview.hidden) updatePreviewMeta();
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

    /** The validated result: what the customer framed, shown at the canvas proportions */
    const updatePreviewMeta = () => {
      const parts = [inputs.size.value, inputs.orientation.value];
      if (inputs.colors && inputs.colors.value) parts.push(`${inputs.colors.value} ${TEXT.colorsUnit}`);
      ui.previewMeta.textContent = parts.join(' · ');
      ui.previewStatus.textContent = state.lowResolution ? TEXT.lowResolution : TEXT.ready;
      ui.previewStatus.classList.toggle('dcc__status--warning', state.lowResolution);
    };

    const setPreviewImage = (blob) => {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      ui.previewImage.src = state.previewUrl;
      updatePreviewMeta();
    };

    const showPreview = () => {
      ui.upload.hidden = true;
      ui.editor.hidden = true;
      ui.preview.hidden = false;
      updatePreviewMeta();
      ui.preview.focus({ preventScroll: true });
    };

    const showEditor = () => {
      ui.upload.hidden = true;
      ui.preview.hidden = true;
      ui.editor.hidden = false;
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
        state.lowResolution = lowResolution;
        setStatus(lowResolution ? TEXT.lowResolution : TEXT.ready, lowResolution);
        setPreviewImage(blob);
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
        showEditor();
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
      const choice = button.getAttribute('data-orientation');
      if (choice === 'square') {
        if (!isSquare()) selectSize(squareOption());
        return;
      }
      state.orientation = choice;
      // leaving a square canvas: go back to the last rectangular size
      if (isSquare()) {
        selectSize(lastRectangleOption());
        return;
      }
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
    ui.change2.addEventListener('click', () => ui.source.click());
    // "Valider le cadrage": show the framed result; "Modifier le cadrage": go back to the editor
    ui.validate.addEventListener('click', () => whenPhotoAttached((ok) => ok && showPreview()));
    ui.edit.addEventListener('click', () => {
      showEditor();
      ui.editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
      if (!size) return;
      if (size.short !== size.long) state.lastRectangle = value; // to come back to after a square canvas
      if (size.short === state.size.short && size.long === state.size.long) return;
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
