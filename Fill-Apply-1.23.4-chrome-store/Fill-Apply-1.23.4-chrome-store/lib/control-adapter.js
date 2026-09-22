/**
 * Control adapter — DOM control type → adapt → fill → verify.
 *
 * Layering (mandatory):
 *   QUESTION MEANING → CANONICAL KEY → KNOWN ANSWER →
 *   DOM CONTROL TYPE → CONTROL-SPECIFIC FILL → VERIFY
 *
 * This module owns CONTROL TYPE → FILL → VERIFY. Detection may also live in
 * FillApplyKnowledgeCanonical.detectControlType; prefer this module when loaded.
 *
 * Attaches globalThis.FillApplyControlAdapter.
 */
(function (global) {
  'use strict';

  var CONTROL_TYPES = [
    'text',
    'textarea',
    'email',
    'tel',
    'number',
    'date',
    'datetime',
    'radio',
    'checkbox',
    'checkbox-group',
    'select',
    'multiselect',
    'combobox',
    'autocomplete',
    'custom-select',
    'file',
    'button-group',
    'url'
  ];

  function dom() {
    return global.FillApplyDom || null;
  }

  function canonical() {
    return global.FillApplyKnowledgeCanonical || null;
  }

  function attr(el, name) {
    try {
      return (el && el.getAttribute && el.getAttribute(name)) || '';
    } catch (_e) {
      return '';
    }
  }

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^\w\s+/.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fireInputChange(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_e) {
      /* ignore */
    }
  }

  function setFrameworkValue(el, value) {
    var D = dom();
    if (D && typeof D.setValue === 'function') {
      D.setValue(el, value);
      return;
    }
    // React/Vue-compatible native setter when available
    try {
      var proto = el.tagName === 'TEXTAREA' ? global.HTMLTextAreaElement.prototype : global.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch (_e2) {
      el.value = value;
    }
    fireInputChange(el);
  }

  function realClick(el) {
    var D = dom();
    if (D && typeof D.realClick === 'function') return D.realClick(el);
    try {
      el.click();
      return true;
    } catch (_e) {
      return false;
    }
  }

  function labelText(el) {
    var D = dom();
    if (D && typeof D.labelFor === 'function') {
      try {
        return D.labelFor(el) || '';
      } catch (_e) {
        /* fall through */
      }
    }
    if (!el) return '';
    var aria = attr(el, 'aria-label');
    if (aria) return aria;
    try {
      if (el.labels && el.labels[0]) return (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim();
    } catch (_e2) {
      /* ignore */
    }
    return '';
  }

  /**
   * detectControl(el [, descriptor]) → control type string
   */
  function detectControl(el, descriptor) {
    descriptor = descriptor || {};
    var type = String(descriptor.type || (el && el.type) || '').toLowerCase();
    var tag = String((el && el.tagName) || descriptor.tag || '').toUpperCase();
    var role = normalize(attr(el, 'role') || descriptor.role || '');
    var cls = String((el && el.className) || descriptor.className || '').toLowerCase();
    var ariaAuto = normalize(attr(el, 'aria-autocomplete') || '');
    var hasPopup = normalize(attr(el, 'aria-haspopup') || '');

    if (type === 'file') return 'file';
    if (type === 'checkbox' || role === 'checkbox') {
      // checkbox-group: multiple checkboxes sharing a name / fieldset question
      if (el && isCheckboxGroupMember(el)) return 'checkbox-group';
      return 'checkbox';
    }
    if (type === 'radio' || role === 'radio') {
      if (looksLikeButtonGroup(el, descriptor)) return 'button-group';
      return 'radio';
    }
    if (type === 'email') return 'email';
    if (type === 'tel') return 'tel';
    if (type === 'url') return 'url';
    if (type === 'number' || type === 'range') return 'number';
    if (type === 'datetime-local' || type === 'datetime') return 'datetime';
    if (type === 'date' || type === 'month' || type === 'week') return 'date';
    if (tag === 'TEXTAREA' || type === 'textarea') return 'textarea';
    if (tag === 'SELECT' || type === 'select' || type === 'select-one') {
      if ((el && el.multiple) || type === 'select-multiple') return 'multiselect';
      return 'select';
    }

    // Custom / framework selects
    if (
      /select2|react-select|mui.*select|ant-select|el-select|ng-select/i.test(cls) ||
      (descriptor && descriptor.customSelect)
    ) {
      return 'custom-select';
    }

    if (role === 'combobox' || hasPopup === 'listbox' || descriptor.combobox) {
      if (ariaAuto === 'list' || ariaAuto === 'both' || /autocomplete|typeahead|autosuggest/i.test(cls)) {
        return 'autocomplete';
      }
      return 'combobox';
    }
    if (role === 'listbox' && descriptor && (descriptor.options || []).length) return 'combobox';
    if (ariaAuto === 'list' || ariaAuto === 'both') return 'autocomplete';

    // Button groups (segmented Yes/No rendered as buttons)
    if (role === 'button' && descriptor && (descriptor.options || []).length) return 'button-group';
    if (type === 'button' && descriptor && descriptor.buttonGroup) return 'button-group';

    if (type === 'text' || type === 'search' || type === 'password' || !type) return 'text';
    return type || 'text';
  }

  function isCheckboxGroupMember(el) {
    if (!el) return false;
    var name = attr(el, 'name');
    if (!name) return false;
    try {
      var root = (el.ownerDocument || document);
      var peers = root.querySelectorAll('input[type="checkbox"][name="' + cssEscape(name) + '"]');
      return peers && peers.length > 1;
    } catch (_e) {
      return false;
    }
  }

  function looksLikeButtonGroup(el, descriptor) {
    if (descriptor && descriptor.buttonGroup) return true;
    var role = normalize(attr(el, 'role'));
    if (role === 'radio' && el && el.tagName === 'BUTTON') return true;
    return false;
  }

  function cssEscape(s) {
    var D = dom();
    if (D && D.cssEscape) return D.cssEscape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  /* ------------------------------------------------------------------ *
   * adaptAnswer — shape known answer for the control
   * ------------------------------------------------------------------ */

  function adaptAnswer(controlType, value, context) {
    context = context || {};
    var ct = String(controlType || 'text').toLowerCase();
    var F = global.FillApplyFormat;
    var raw;
    if (value == null) raw = '';
    else if (typeof value === 'object') {
      raw = F && typeof F.serializeAnswer === 'function' ? F.serializeAnswer(value) : '';
      if (!raw) { try { raw = JSON.stringify(value); } catch (_e) { raw = ''; } }
    } else raw = String(value);
    if (raw.indexOf('[object Object]') !== -1) {
      return { ok: false, reason: 'unserializable_object', action: 'DO_NOT_FILL' };
    }
    if (!raw.trim() && ct !== 'checkbox' && ct !== 'file') {
      return { ok: false, reason: 'empty', action: 'DO_NOT_FILL' };
    }

    if (ct === 'number') {
      var num = normalizeNumber(raw, context);
      if (num === '') return { ok: false, reason: 'not_numeric', action: 'DO_NOT_FILL' };
      return { ok: true, value: num, action: 'FILL', controlType: ct };
    }

    if (ct === 'date' || ct === 'datetime') {
      var iso = toIsoDate(raw);
      if (!iso) return { ok: false, reason: 'not_date', action: 'DO_NOT_FILL' };
      var formatted = formatDateForControl(iso, context.el || null, ct);
      return { ok: true, value: formatted, iso: iso, action: 'FILL', controlType: ct };
    }

    if (ct === 'email') {
      if (!/@/.test(raw)) return { ok: false, reason: 'not_email', action: 'DO_NOT_FILL' };
      return { ok: true, value: raw.trim(), action: 'FILL', controlType: ct };
    }

    if (ct === 'tel') {
      return { ok: true, value: adaptPhone(raw, context), action: 'FILL', controlType: ct };
    }

    if (ct === 'checkbox') {
      var want = coerceBoolean(raw, context);
      if (want == null && context.consent) want = true;
      if (want == null) return { ok: false, reason: 'checkbox_needs_boolean', action: 'DO_NOT_FILL' };
      return { ok: true, value: want, action: 'FILL', controlType: ct };
    }

    if (ct === 'radio' || ct === 'button-group' || ct === 'select' || ct === 'combobox' || ct === 'custom-select' || ct === 'autocomplete') {
      return { ok: true, value: raw.trim(), action: 'FILL', controlType: ct };
    }

    if (ct === 'multiselect' || ct === 'checkbox-group') {
      var parts = splitMulti(raw);
      if (!parts.length) return { ok: false, reason: 'empty_multiselect', action: 'DO_NOT_FILL' };
      return { ok: true, value: parts, action: 'FILL', controlType: ct };
    }

    if (ct === 'file') {
      return adaptFile(raw, context);
    }

    // text / textarea / url
    return { ok: true, value: raw, action: 'FILL', controlType: ct || 'text' };
  }

  function normalizeNumber(raw, context) {
    var C = canonical();
    if (C && typeof C.coerceNumber === 'function') {
      var c = C.coerceNumber(raw);
      if (c !== '') return c;
    }
    var s = String(raw).trim();
    // "15 years", "15+", "10+ years", "15 yrs"
    var m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?|months?|days?|weeks?|%|percent)?$/i);
    if (m) return m[1];
    m = s.match(/(-?\d+(?:\.\d+)?)\s*\+/);
    if (m && /year|experience|count|how many/i.test(String((context && context.label) || '') + ' ' + s)) {
      return m[1];
    }
    m = s.match(/-?\d+(?:\.\d+)?/);
    if (m && /year|experience|count|how many|age|team|direct report/i.test(String((context && context.label) || '') + ' ' + s)) {
      return m[0];
    }
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return s;
    return '';
  }

  function toIsoDate(str) {
    var C = canonical();
    if (C && typeof C.coerceDate === 'function') {
      var iso = C.coerceDate(str);
      if (iso) return iso;
    }
    var s = String(str || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return '';
    var d = new Date(parsed);
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /**
   * Detect date format from type=date / placeholder / pattern.
   * Never type a human-readable date into type=date (always ISO yyyy-mm-dd).
   */
  function formatDateForControl(iso, el, controlType) {
    if (!el) return iso;
    var type = String(el.type || '').toLowerCase();
    if (type === 'date' || type === 'month' || type === 'week') return iso.slice(0, 10);
    if (type === 'datetime-local' || controlType === 'datetime') {
      return iso.slice(0, 10) + 'T00:00';
    }
    var placeholder = attr(el, 'placeholder') || '';
    var pattern = attr(el, 'pattern') || '';
    var hint = (placeholder + ' ' + pattern).toLowerCase();
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    var y = parts[0];
    var m = parts[1];
    var d = parts[2];
    if (/dd\s*[\/.\-]\s*mm\s*[\/.\-]\s*yyyy|dd\/mm\/yyyy/.test(hint)) return d + '/' + m + '/' + y;
    if (/mm\s*[\/.\-]\s*dd\s*[\/.\-]\s*yyyy|mm\/dd\/yyyy/.test(hint)) return m + '/' + d + '/' + y;
    if (/yyyy\s*[\/.\-]\s*mm\s*[\/.\-]\s*dd/.test(hint)) return y + '/' + m + '/' + d;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(placeholder.trim())) {
      // Ambiguous — prefer locale from pattern; default ISO for safety
      return iso;
    }
    return iso;
  }

  function adaptPhone(raw, context) {
    var s = String(raw).trim();
    if (context && context.hasPhoneCountryField) {
      // Strip leading +country when a separate country control exists
      var stripped = s.replace(/^\+\d{1,3}\s*/, '').replace(/^00\d{1,3}\s*/, '');
      // Avoid duplicating +966 when country is Saudi
      stripped = stripped.replace(/^966/, '');
      return stripped.replace(/\D/g, '') ? stripped.replace(/[^\d]/g, '') : s;
    }
    return s;
  }

  function coerceBoolean(raw, context) {
    var n = normalize(raw);
    if (/^(yes|true|1|on|y|checked|agree|accept|i agree)$/.test(n)) return true;
    if (/^(no|false|0|off|n|unchecked|disagree)$/.test(n)) return false;
    if (context && context.consent && /^(yes|true|1)?$/.test(n)) return true;
    return null;
  }

  function splitMulti(raw) {
    if (Array.isArray(raw)) {
      return raw.map(function (x) {
        return String(x).trim();
      }).filter(Boolean);
    }
    return String(raw)
      .split(/\s*[,;|]\s*/)
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }

  function adaptFile(raw, context) {
    var kind = detectFileKind(context.label || context.question || raw || '');
    var docs = (context && context.documents) || {};
    var doc = null;
    if (kind === 'cover') doc = docs.cover || docs.coverLetter || null;
    else if (kind === 'resume') doc = docs.resume || docs.cv || null;
    else doc = docs.resume || docs.cv || docs.cover || null;

    if (!doc || !(doc.base64 || doc.dataUrl || doc.blob || doc.file)) {
      return {
        ok: false,
        reason: 'file_not_configured',
        action: 'BLOCKER',
        blocker: true,
        message:
          kind === 'cover'
            ? 'Cover letter required but no local document is configured in the extension.'
            : 'Resume/CV required but no local document is configured in the extension.',
        fileKind: kind,
        controlType: 'file'
      };
    }
    return { ok: true, value: doc, fileKind: kind, action: 'FILL', controlType: 'file' };
  }

  function detectFileKind(label) {
    var t = normalize(label);
    if (/cover\s*letter|covering\s*letter|motivation\s*letter/.test(t)) return 'cover';
    if (/resume|curriculum|cv\b|curriculum vitae/.test(t)) return 'resume';
    return 'resume';
  }

  /* ------------------------------------------------------------------ *
   * fill — control-specific write
   * ------------------------------------------------------------------ */

  function fill(el, adapted, context) {
    context = context || {};
    if (!el) return { ok: false, reason: 'no_element' };
    if (!adapted || !adapted.ok) {
      return { ok: false, reason: (adapted && adapted.reason) || 'not_adapted', blocker: !!(adapted && adapted.blocker), message: adapted && adapted.message };
    }
    var ct = adapted.controlType || detectControl(el, context.descriptor);
    var handlers = {
      text: fillTextish,
      textarea: fillTextish,
      email: fillTextish,
      tel: fillTextish,
      url: fillTextish,
      number: fillTextish,
      date: fillDate,
      datetime: fillDate,
      checkbox: fillCheckbox,
      'checkbox-group': fillCheckboxGroup,
      radio: fillRadio,
      'button-group': fillRadio,
      select: fillSelect,
      multiselect: fillMultiselect,
      combobox: fillComboboxSync,
      autocomplete: fillComboboxSync,
      'custom-select': fillComboboxSync,
      file: fillFile
    };
    var fn = handlers[ct] || fillTextish;
    return fn(el, adapted, context);
  }

  function fillTextish(el, adapted) {
    setFrameworkValue(el, adapted.value);
    return { ok: true, value: adapted.value };
  }

  function fillDate(el, adapted) {
    // Never put human-readable dates into type=date
    var type = String(el.type || '').toLowerCase();
    var v = adapted.value;
    if (type === 'date' || type === 'month' || type === 'week' || type === 'datetime-local') {
      v = adapted.iso || toIsoDate(adapted.value) || adapted.value;
      if (type === 'datetime-local' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = v + 'T00:00';
    }
    setFrameworkValue(el, v);
    var cal = fillCustomCalendar(el, adapted.iso || toIsoDate(v) || v);
    if (cal && cal.ok) return cal;
    return { ok: true, value: v };
  }

  function fillCustomCalendar(el, iso) {
    if (!el || !iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso).slice(0, 10))) return null;
    var ymd = String(iso).slice(0, 10).split('-');
    var year = ymd[0], month = ymd[1], day = String(Number(ymd[2]));
    var doc = el.ownerDocument || document;
    try { el.focus && el.focus(); el.click && el.click(); } catch (_e) {}
    var dialog = (el.closest && el.closest('.field, div')) ? el.closest('.field, div').querySelector('[role="dialog"], .datepicker, [class*="datepicker" i]') : null;
    dialog = dialog || doc.querySelector('.datepicker, [role="dialog"]');
    if (!dialog) return null;
    var yearEl = dialog.querySelector('select[aria-label*="year" i], select.cal-year, .react-datepicker__year-select');
    if (yearEl && yearEl.tagName === 'SELECT') {
      for (var i = 0; i < yearEl.options.length; i++) {
        if (String(yearEl.options[i].value) === year) { yearEl.selectedIndex = i; try { yearEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_e2) {} break; }
      }
    }
    var monthEl = dialog.querySelector('select[aria-label*="month" i], select.cal-month, .react-datepicker__month-select');
    if (monthEl && monthEl.tagName === 'SELECT') {
      var want = String(Number(month));
      for (var j = 0; j < monthEl.options.length; j++) {
        if (String(monthEl.options[j].value) === want || String(monthEl.options[j].value) === month) {
          monthEl.selectedIndex = j; try { monthEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_e3) {} break;
        }
      }
    }
    var clicked = false;
    var cells = dialog.querySelectorAll('[role="gridcell"], [data-day], button[data-day]');
    for (var k = 0; k < cells.length; k++) {
      var label = String(cells[k].getAttribute('data-day') || cells[k].textContent || '').trim();
      if (String(Number(label)) === day || label === day) { try { cells[k].click(); clicked = true; break; } catch (_e4) {} }
    }
    return { ok: clicked || !!el.value, value: el.value || iso, controlType: 'custom-calendar', clicked: clicked };
  }


  function fillCheckbox(el, adapted) {
    var want = adapted.value === true || adapted.value === 'true' || adapted.value === 1;
    // Never type "Yes" into a checkbox
    if (el.checked !== want) realClick(el);
    if (el.checked !== want) {
      el.checked = want;
      fireInputChange(el);
    }
    return { ok: el.checked === want, value: want, verified: el.checked === want };
  }

  function fillCheckboxGroup(el, adapted, context) {
    var wants = Array.isArray(adapted.value) ? adapted.value.map(normalize) : [normalize(adapted.value)];
    var name = attr(el, 'name');
    var root = el.ownerDocument || document;
    var boxes = [];
    try {
      if (name) boxes = Array.prototype.slice.call(root.querySelectorAll('input[type="checkbox"][name="' + cssEscape(name) + '"]'));
      else boxes = [el];
    } catch (_e) {
      boxes = [el];
    }
    var matched = 0;
    boxes.forEach(function (box) {
      var lab = normalize(labelText(box) || box.value || '');
      var should = wants.some(function (w) {
        return w && (lab === w || lab.indexOf(w) !== -1 || w.indexOf(lab) !== -1);
      });
      if (should && !box.checked) {
        realClick(box);
        if (!box.checked) {
          box.checked = true;
          fireInputChange(box);
        }
      }
      if (should && box.checked) matched += 1;
    });
    return { ok: matched > 0, matched: matched, value: adapted.value };
  }

  function radioGroupFor(el) {
    if (!el) return [];
    var name = attr(el, 'name');
    var root = el.ownerDocument || document;
    if (name) {
      try {
        var found = root.querySelectorAll('input[type="radio"][name="' + cssEscape(name) + '"]');
        if (found && found.length) return Array.prototype.slice.call(found);
      } catch (_e) {
        /* ignore */
      }
    }
    var container = el.closest ? el.closest('fieldset, [role="radiogroup"], .field, [class*="field"]') : null;
    if (container) {
      try {
        return Array.prototype.slice.call(container.querySelectorAll('input[type="radio"]'));
      } catch (_e2) {
        /* ignore */
      }
    }
    return [el];
  }

  /**
   * Radio: identify group; click the real option; verify checked===true.
   * Fixes shared-label Yes/No bugs by scoring per-option labels/values, not the group legend alone.
   */
  function fillRadio(el, adapted) {
    var want = normalize(adapted.value);
    var group = radioGroupFor(el);
    if (!group.length) return { ok: false, reason: 'no_radio_group' };

    var best = null;
    var bestScore = 0;
    group.forEach(function (radio) {
      // Prefer the option's own label — not a shared fieldset legend.
      var ownLabel = ownRadioLabel(radio);
      var raw = normalize(radio.value || '');
      var lab = normalize(ownLabel);
      var score = 0;
      if (raw === want || lab === want) score = 100;
      else if (lab && (lab.indexOf(want) !== -1 || want.indexOf(lab) !== -1) && lab.length > 1) score = 70;
      else if (raw && raw.indexOf(want) !== -1) score = 60;
      else if (/^(yes|y)$/.test(want) && /^(yes|y|true|1)$/.test(raw || lab)) score = 95;
      else if (/^(no|n)$/.test(want) && /^(no|n|false|0)$/.test(raw || lab) && !/not sure|unknown/.test(lab)) score = 95;
      if (score > bestScore) {
        bestScore = score;
        best = radio;
      }
    });

    if (!best || bestScore < 60) {
      return { ok: false, reason: 'no_matching_option', action: 'DO_NOT_FILL' };
    }

    realClick(best);
    if (!best.checked) {
      best.checked = true;
      fireInputChange(best);
    }
    return { ok: best.checked === true, value: adapted.value, verified: best.checked === true, el: best };
  }

  /** Label belonging to this radio only (not shared fieldset legend). */
  function ownRadioLabel(radio) {
    if (!radio) return '';
    try {
      if (radio.labels && radio.labels.length) {
        // Prefer <label for=id> that wraps only this control's text
        for (var i = 0; i < radio.labels.length; i++) {
          var lab = radio.labels[i];
          var t = (lab.textContent || '').replace(/\s+/g, ' ').trim();
          // Skip if label also contains other radios (shared)
          var radiosInLabel = lab.querySelectorAll ? lab.querySelectorAll('input[type="radio"]') : [];
          if (radiosInLabel.length > 1) continue;
          if (t) return t;
        }
      }
    } catch (_e) {
      /* ignore */
    }
    // Sibling text / next label
    var next = radio.nextElementSibling;
    if (next && next.tagName === 'LABEL') return (next.textContent || '').replace(/\s+/g, ' ').trim();
    if (next && next.tagName !== 'INPUT') {
      var nt = (next.textContent || '').replace(/\s+/g, ' ').trim();
      if (nt && nt.length < 40) return nt;
    }
    var prev = radio.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') return (prev.textContent || '').replace(/\s+/g, ' ').trim();
    // Parent label wrapping single radio
    var parent = radio.parentElement;
    if (parent && parent.tagName === 'LABEL') {
      var clone = parent.cloneNode(true);
      try {
        var inputs = clone.querySelectorAll('input');
        for (var j = 0; j < inputs.length; j++) inputs[j].remove();
      } catch (_e2) {
        /* ignore */
      }
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return String(radio.value || '');
  }

  function fillSelect(el, adapted) {
    var want = String(adapted.value);
    if (matchSelectOption(el, want)) return { ok: true, value: want };
    // Try canonical findOptionMatch if available
    var C = canonical();
    if (C && typeof C.findOptionMatch === 'function' && el.options) {
      var labels = [];
      for (var i = 0; i < el.options.length; i++) {
        labels.push((el.options[i].textContent || el.options[i].value || '').trim());
      }
      var hit = C.findOptionMatch(labels, want);
      if (hit && matchSelectOption(el, hit)) return { ok: true, value: hit };
    }
    return { ok: false, reason: 'no_matching_option', action: 'DO_NOT_FILL' };
  }

  function matchSelectOption(selectEl, want) {
    if (!selectEl || !selectEl.options) return false;
    var target = normalize(want);
    var bestIdx = -1;
    var bestScore = 0;
    for (var i = 0; i < selectEl.options.length; i++) {
      var opt = selectEl.options[i];
      var text = normalize(opt.textContent || '');
      var val = normalize(opt.value || '');
      if (!val && /^(select|choose|please|--)/.test(text)) continue;
      var score = 0;
      if (text === target || val === target) score = 100;
      else if (text.indexOf(target) !== -1 || target.indexOf(text) !== -1) score = 70;
      else if (val.indexOf(target) !== -1) score = 60;
      else if (/^(yes|y)$/.test(target) && /^(yes|y|true|1)$/.test(text || val)) score = 90;
      else if (/^(no|n)$/.test(target) && /^(no|n|false|0)$/.test(text || val) && !/not/.test(text)) score = 90;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 60) {
      selectEl.selectedIndex = bestIdx;
      fireInputChange(selectEl);
      return true;
    }
    return false;
  }

  function fillMultiselect(el, adapted) {
    var wants = Array.isArray(adapted.value) ? adapted.value : splitMulti(adapted.value);
    if (!el || !el.options) return { ok: false, reason: 'not_select' };
    var matched = 0;
    for (var i = 0; i < el.options.length; i++) {
      var opt = el.options[i];
      var text = normalize(opt.textContent || '');
      var val = normalize(opt.value || '');
      var hit = wants.some(function (w) {
        var n = normalize(w);
        return n && (text === n || val === n || text.indexOf(n) !== -1 || n.indexOf(text) !== -1);
      });
      opt.selected = !!hit;
      if (hit) matched += 1;
    }
    fireInputChange(el);
    return { ok: matched > 0, matched: matched, value: wants };
  }

  /**
   * Sync path for combobox/autocomplete/custom-select when async pick is not available.
   * Does NOT blind-press Enter. If options cannot be inspected, returns unresolved.
   */
  function fillComboboxSync(el, adapted, context) {
    // If caller provided an async picker, prefer that (fill.js pickFromDropdown)
    if (context && typeof context.pickFromDropdown === 'function') {
      return { ok: false, reason: 'needs_async_pick', deferAsync: true, value: adapted.value };
    }
    // Try typing into the input without submitting
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      setFrameworkValue(el, adapted.value);
      // Do not press Enter — leave unresolved until options inspected
      return { ok: false, reason: 'combobox_needs_option_inspect', deferAsync: true, value: adapted.value, typed: true };
    }
    return { ok: false, reason: 'combobox_unresolved', action: 'DO_NOT_FILL' };
  }

  function fillFile(el, adapted, context) {
    if (!adapted.ok) {
      return {
        ok: false,
        blocker: true,
        reason: adapted.reason || 'file_not_configured',
        message: adapted.message || 'Document required but not configured'
      };
    }
    var F = global.FillApplyFiles;
    var doc = adapted.value;
    if (F && typeof F.assignFilesToInput === 'function' && typeof F.fileFromBase64 === 'function' && doc.base64) {
      var file = F.fileFromBase64(doc.base64, doc.name || 'document.pdf', doc.mime || 'application/pdf');
      var result = F.assignFilesToInput(el, file);
      return { ok: !!(result && result.ok), value: doc.name || adapted.fileKind, fileKind: adapted.fileKind };
    }
    if (context && typeof context.attachFileInput === 'function') {
      var ok = context.attachFileInput(el, context.documents, adapted.fileKind);
      return { ok: !!ok, fileKind: adapted.fileKind };
    }
    return {
      ok: false,
      blocker: true,
      reason: 'file_attach_unavailable',
      message: 'File input detected but document attach helper is unavailable.'
    };
  }

  /* ------------------------------------------------------------------ *
   * verify — post-fill check
   * ------------------------------------------------------------------ */

  function verify(el, controlType, expected) {
    if (!el) return { ok: false, reason: 'no_element' };
    var ct = String(controlType || detectControl(el) || 'text').toLowerCase();
    var exp = expected;

    if (ct === 'checkbox') {
      var want = exp === true || /^(yes|true|1|on)$/i.test(String(exp));
      return { ok: el.checked === want, actual: el.checked, expected: want };
    }
    if (ct === 'radio' || ct === 'button-group') {
      var group = radioGroupFor(el);
      var checked = group.filter(function (r) {
        return r.checked;
      });
      if (!checked.length) return { ok: false, reason: 'none_checked' };
      var own = normalize(ownRadioLabel(checked[0]) || checked[0].value || '');
      var wantN = normalize(exp);
      var ok =
        checked[0].checked === true &&
        (own === wantN ||
          own.indexOf(wantN) !== -1 ||
          wantN.indexOf(own) !== -1 ||
          (/^(yes|y)$/.test(wantN) && /^(yes|y|true|1)$/.test(own)) ||
          (/^(no|n)$/.test(wantN) && /^(no|n|false|0)$/.test(own)));
      return { ok: ok, actual: own, expected: wantN, checked: true };
    }
    if (ct === 'select') {
      var sel = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (!sel) return { ok: false, reason: 'nothing_selected' };
      var st = normalize(sel.textContent || sel.value || '');
      var wantS = normalize(exp);
      return { ok: st === wantS || st.indexOf(wantS) !== -1 || wantS.indexOf(st) !== -1 || normalize(el.value) === wantS, actual: st, expected: wantS, selectedIndex: el.selectedIndex, value: el.value };
    }
    if (ct === 'multiselect') {
      var wants = Array.isArray(exp) ? exp.map(normalize) : splitMulti(exp).map(normalize);
      var selected = [];
      if (el.options) {
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].selected) selected.push(normalize(el.options[i].textContent || el.options[i].value || ''));
        }
      }
      var all = wants.every(function (w) {
        return selected.some(function (s) {
          return s === w || s.indexOf(w) !== -1 || w.indexOf(s) !== -1;
        });
      });
      return { ok: all && wants.length > 0, actual: selected, expected: wants };
    }
    if (ct === 'number') {
      var nExp = normalizeNumber(String(exp), {});
      var nAct = String(el.value || '').trim();
      return { ok: nAct === String(nExp) || Number(nAct) === Number(nExp), actual: nAct, expected: nExp };
    }
    if (ct === 'date' || ct === 'datetime') {
      var iso = toIsoDate(exp);
      var act = String(el.value || '');
      return { ok: act.indexOf(iso.slice(0, 10)) === 0 || act === iso || toIsoDate(act) === iso, actual: act, expected: iso };
    }
    if (ct === 'file') {
      var files = el.files;
      return { ok: !!(files && files.length), actual: files && files.length, expected: 'file_present' };
    }
    // textish
    return { ok: String(el.value || '') === String(exp) || String(el.value || '').indexOf(String(exp)) !== -1, actual: el.value, expected: exp };
  }

  /**
   * High-level: detect → adapt → fill → verify for one element.
   */
  function applyToControl(el, value, context) {
    context = context || {};
    var ct = detectControl(el, context.descriptor);
    var adapted = adaptAnswer(ct, value, Object.assign({}, context, { el: el }));
    if (!adapted.ok) {
      return {
        ok: false,
        controlType: ct,
        reason: adapted.reason,
        action: adapted.action || 'DO_NOT_FILL',
        blocker: !!adapted.blocker,
        message: adapted.message || null
      };
    }
    var filled = fill(el, adapted, context);
    if (filled.deferAsync) {
      return {
        ok: false,
        controlType: ct,
        reason: filled.reason,
        deferAsync: true,
        value: adapted.value,
        action: 'NEEDS_ASYNC'
      };
    }
    if (!filled.ok) {
      return {
        ok: false,
        controlType: ct,
        reason: filled.reason || 'fill_failed',
        action: filled.action || 'DO_NOT_FILL',
        blocker: !!filled.blocker,
        message: filled.message || null
      };
    }
    var verified = verify(el, ct, adapted.value);
    return {
      ok: !!verified.ok,
      controlType: ct,
      value: adapted.value,
      verified: verified,
      action: verified.ok ? 'FILLED' : 'VERIFY_FAILED',
      reason: verified.ok ? null : verified.reason || 'verify_failed'
    };
  }

  /**
   * Country vs nationality: never confuse.
   * Residence/country of residence ≠ nationality/citizenship.
   */
  function disambiguateGeoKey(labelOrKey) {
    var t = normalize(labelOrKey);
    if (/nationalit|citizenship|citizen of|passport country/.test(t)) return 'nationality';
    if (/country of residence|residence country|residing|current country|work location country|located in/.test(t)) {
      return 'country';
    }
    if (/^country$|country\b/.test(t) && !/code|phone|dial|calling/.test(t)) return 'country';
    return null;
  }

  global.FillApplyControlAdapter = {
    CONTROL_TYPES: CONTROL_TYPES,
    detectControl: detectControl,
    adaptAnswer: adaptAnswer,
    fill: fill,
    verify: verify,
    applyToControl: applyToControl,
    fillCustomCalendar: fillCustomCalendar,
    normalizeNumber: normalizeNumber,
    toIsoDate: toIsoDate,
    formatDateForControl: formatDateForControl,
    adaptPhone: adaptPhone,
    detectFileKind: detectFileKind,
    disambiguateGeoKey: disambiguateGeoKey,
    ownRadioLabel: ownRadioLabel,
    radioGroupFor: radioGroupFor,
    matchSelectOption: matchSelectOption,
    splitMulti: splitMulti
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
