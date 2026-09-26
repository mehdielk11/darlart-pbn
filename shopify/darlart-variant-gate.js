/*
 * Darl'Art product page: a choice with no variant for sale (a price of 0 in the prices sheet, so the n8n Uploader and
 * Price Sync never create that variant) is greyed out, labelled "Not available" and cannot be clicked.
 *
 * Choices are made top to bottom as the page shows them (canvas, then size, then colors): a choice is offered when a
 * variant for sale matches it and the choices above it. After a click, the choices below move to the closest variant
 * for sale, so the shopper never lands on an impossible combination.
 *
 * Both canvas types always show: a canvas type with no variant at all (every price 0) is not in the product's options
 * (Shopify leaves out option values without variants), so its card is added back here, greyed out, with its usual
 * name and icon.
 *
 * Works on the product customizer section (sections/2.liquid) without changing it: it reads the variants the section
 * embeds (script[data-product-variants]) and drives its own option cards. Loaded on product pages by
 * snippets/global-script-2.liquid.
 */
(function () {
  var LABELS = { en: 'Not available', fr: 'Non disponible', ar: 'غير متوفر' };
  var CLASS = 'dl-na';
  // the canvas types every kit shows, in order, with their names in each language and their icon file
  var CANVAS = [
    { value: 'Rolled Canvas', stretch: false, icon: 'rolled.png', names: { en: 'Rolled Canvas', fr: 'Toile roulée', ar: 'قماش ملفوف' } },
    { value: 'Stretched Canvas', stretch: true, icon: 'stretched.png', names: { en: 'Stretched Canvas', fr: 'Toile tendue', ar: 'قماش مشدود' } }
  ];

  function lang() { return (document.documentElement.lang || 'en').slice(0, 2).toLowerCase(); }
  function label() { return LABELS[lang()] || LABELS.en; }

  // a canvas type missing from the product gets a copy of the existing card, renamed, with its own icon
  function addMissingCanvas(section) {
    var group = section.querySelector('.pcp-canvas-group[data-option-group]');
    if (!group) return;
    var cards = Array.prototype.slice.call(group.querySelectorAll('[data-canvas-card][data-option-value]'));
    if (!cards.length) return;
    // the page shows the values in its language (e.g. "Toile tendue" on /fr): a canvas type is known by any of its names
    var namesOf = function (canvas) { return Object.keys(canvas.names).map(function (l) { return canvas.names[l]; }); };
    var kindOf = function (value) { return CANVAS.filter(function (c) { return namesOf(c).indexOf(value) >= 0; })[0] || null; };
    var values = cards.map(function (c) { return c.getAttribute('data-option-value'); });
    if (values.some(function (v) { return !kindOf(v); })) return; // another naming: left as it is
    var present = values.map(kindOf);
    CANVAS.forEach(function (canvas, i) {
      if (present.indexOf(canvas) >= 0) return;
      var name = canvas.names[lang()] || canvas.names.en;
      var card = cards[0].cloneNode(true);
      card.setAttribute('data-option-value', name);
      card.setAttribute('data-dl-added', '1');
      card.removeAttribute('data-default-option');
      card.classList.remove('is-selected');
      card.classList.toggle('pcp-canvas-card--stretch', canvas.stretch);
      card.setAttribute('aria-pressed', 'false');
      var img = card.querySelector('img');
      if (img) {
        img.src = img.getAttribute('src').replace(/[^\/?]+\.(png|jpe?g|webp)(\?.*)?$/i, canvas.icon + '?width=140');
        img.alt = name;
      }
      var title = card.querySelector('.pcp-option-title-row');
      if (title) title.textContent = name;
      Array.prototype.forEach.call(card.querySelectorAll('.pcp-badge-new, .pcp-chevron, [data-expand-toggle]'), function (el) { el.remove(); });
      // rolled first, then stretched, like the other kits
      var next = null;
      for (var j = i + 1; j < CANVAS.length && !next; j++) {
        next = cards[present.indexOf(CANVAS[j])] || null;
      }
      group.insertBefore(card, next);
    });
  }

  function injectStyle() {
    if (document.getElementById('dl-variant-gate-style')) return;
    var style = document.createElement('style');
    style.id = 'dl-variant-gate-style';
    style.textContent = '.' + CLASS + '{opacity:.45!important;filter:grayscale(1);cursor:not-allowed!important;pointer-events:none!important}';
    document.head.appendChild(style);
  }

  function setup(section) {
    var variantsEl = section.querySelector('script[data-product-variants]');
    var optionsEl = section.querySelector('script[data-product-options]');
    if (!variantsEl || !optionsEl) return;
    var variants, options;
    try {
      variants = JSON.parse(variantsEl.textContent || '[]');
      options = JSON.parse(optionsEl.textContent || '[]');
    } catch (e) { return; }
    if (!variants.length || !options.length) return;
    addMissingCanvas(section);

    var indexByName = {};
    options.forEach(function (opt, i) { indexByName[opt.name] = i + 1; });
    // the option groups made of cards, in page order: that is the order the choices are made in
    var groups = Array.prototype.slice.call(section.querySelectorAll('[data-option-group][data-option-name]')).filter(function (g) {
      return indexByName[g.getAttribute('data-option-name')] && g.querySelector('[data-option][data-option-value]');
    });
    if (!groups.length) return;
    var names = groups.map(function (g) { return g.getAttribute('data-option-name'); });

    function value(v, name) { return v['option' + indexByName[name]]; }
    function cards(group) { return Array.prototype.slice.call(group.querySelectorAll('[data-option][data-option-value]')); }
    function selected() {
      var out = {};
      groups.forEach(function (g, i) {
        var card = g.querySelector('.is-selected[data-option]');
        if (card) out[names[i]] = card.getAttribute('data-option-value');
      });
      return out;
    }
    function matches(v, sel, upTo) {
      for (var i = 0; i < upTo; i++) {
        if (sel[names[i]] !== undefined && value(v, names[i]) !== sel[names[i]]) return false;
      }
      return true;
    }
    function reachable(level, val, sel) {
      return variants.some(function (v) { return v.available && value(v, names[level]) === val && matches(v, sel, level); });
    }
    function exact(sel) {
      return variants.filter(function (v) { return matches(v, sel, names.length); })[0] || null;
    }

    // greys out (and disables) every choice no variant for sale can reach from the choices above it
    var busy = false;
    function apply() {
      busy = true;
      var sel = selected();
      groups.forEach(function (g, level) {
        cards(g).forEach(function (card) {
          var val = card.getAttribute('data-option-value');
          var ok = reachable(level, val, sel);
          var priceEl = card.querySelector('[data-palette-price], [data-option-price]');
          if (!ok) {
            if (!card.classList.contains(CLASS)) card.classList.add(CLASS);
            card.classList.add('is-unavailable');
            card.disabled = true;
            card.setAttribute('aria-disabled', 'true');
            if (priceEl && priceEl.textContent !== label()) { priceEl.textContent = label(); priceEl.hidden = false; }
            if (priceEl) priceEl.setAttribute('data-dl-label', '1');
            return;
          }
          if (card.classList.contains(CLASS)) card.classList.remove(CLASS);
          card.disabled = false;
          card.setAttribute('aria-disabled', 'false');
          // reachable: this choice leads to a variant for sale (the choices below move if needed)
          var probe = {};
          Object.keys(sel).forEach(function (k) { probe[k] = sel[k]; });
          probe[names[level]] = val;
          var v = exact(probe);
          if (!v || !v.available) {
            card.classList.remove('is-unavailable');
            if (priceEl) { priceEl.textContent = ''; priceEl.hidden = true; priceEl.removeAttribute('data-dl-label'); }
          } else if (priceEl && priceEl.getAttribute('data-dl-label')) {
            priceEl.textContent = '';
            priceEl.hidden = true;
            priceEl.removeAttribute('data-dl-label');
          }
        });
      });
      busy = false;
    }

    // the selection is a variant for sale; otherwise the choices below `level` move to the closest one
    function settle(level) {
      var sel = selected();
      var current = exact(sel);
      if (current && current.available) return;
      var best = null;
      var bestScore = -1;
      variants.forEach(function (v) {
        if (!v.available || !matches(v, sel, level + 1)) return;
        var score = 0;
        names.forEach(function (name, i) { if (value(v, name) === sel[name]) score += Math.pow(2, names.length - i); });
        if (score > bestScore) { best = v; bestScore = score; }
      });
      if (!best) return;
      for (var i = level + 1; i < names.length; i++) {
        var want = value(best, names[i]);
        if (selected()[names[i]] === want) continue;
        var target = cards(groups[i]).filter(function (c) { return c.getAttribute('data-option-value') === want; })[0];
        if (target) {
          target.classList.remove(CLASS);
          target.disabled = false;
          target.click(); // the section's own handler selects it and updates price, cart button and images
        }
      }
    }

    // a click on a card: the section selects it, then the choices below settle and the greyed-out ones are updated
    section.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('[data-option][data-option-value]');
      if (!card) return;
      var level = groups.indexOf(card.closest('[data-option-group]'));
      if (level < 0) return;
      if (card.classList.contains(CLASS)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      setTimeout(function () { settle(level); apply(); }, 0);
    }, true);

    // the section re-marks its cards on other changes (add-on, frame...): keep the greyed-out state on top
    var pending = false;
    var observer = new MutationObserver(function () {
      if (busy || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; apply(); });
    });
    groups.forEach(function (g) { observer.observe(g, { attributes: true, subtree: true, attributeFilter: ['class'] }); });

    settle(0);
    apply();
  }

  function init() {
    injectStyle();
    var seen = [];
    document.querySelectorAll('script[data-product-variants]').forEach(function (s) {
      var section = s.closest('.shopify-section') || s.parentElement;
      if (section && seen.indexOf(section) < 0) { seen.push(section); setup(section); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
