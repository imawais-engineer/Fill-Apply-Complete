/**
 * Form field detection + fill engine.
 *
 * Built on FillApplyDom, so every lookup pierces open shadow roots and
 * same-origin iframes, and every interaction emits the events frameworks
 * listen for.
 *
 * `run()` is async on purpose: application forms render their controls, their
 * listbox options and their conditional follow-up questions on later ticks, so
 * a single synchronous pass sees only part of the form (and never sees a
 * portalled dropdown option at all).
 *
 * Exposes globalThis.__fillApply.
 */
(function (global) {
  'use strict';

  const HIGHLIGHT_ATTR = 'data-fill-apply-unmatched';
  const FILLED_ATTR = 'data-fill-apply-filled';
  const FILLED_VALUE_ATTR = 'data-fill-apply-value';

  /** Voluntary self-identification — reported, never answered. */
  const DIVERSITY_RE =
    /diversity|equal opportunity|\beeo\b|race|ethnicity|gender identity|\bveteran\b|disability|sexual orientation|hispanic|latino|\blgbt|decline to (self-)?identify|voluntary self.?identif|self.?identification/i;

  /**
   * Proceed/consent checkboxes required to continue (Hilton-style and global).
   * Matched by label keywords — ticked during Auto Fill / Ready / Submit.
   */
  const CONSENT_RE =
    /\b(i understand and agree|i agree|i accept|i consent|i acknowledge|i certify|i confirm|agree|consent|privacy notice|applicant privacy|privacy policy|electronic signature|e-?sign|terms(?:\s+and\s+conditions)?|terms\s+of\s+use|data\s+privacy|acknowledge|data protection|gdpr|declaration)\b/i;

  /** CV / Resume import CTAs — prefer these before normal field fill. */
  const CV_IMPORT_RE =
    /\b((auto\s*)?fill\s*(with|from)\s*(cv|resume|curriculum)|import\s*(from\s*)?(cv|resume)|autofill\s*(from\s*)?(cv|resume|my\s*resume)|use\s*(my\s*)?(cv|resume)|parse\s*(cv|resume)|upload\s*(and\s*)?(auto\s*)?fill(\s*(from|with))?\s*(cv|resume)?|fill\s*from\s*(cv|resume))\b/i;

  /** Gender / sex questions (including voluntary "Gender Identity"). */
  const GENDER_FIELD_RE = /\b(gender(\s*identity)?|sex)\b/i;
  const SEXUAL_ORIENTATION_RE = /sexual\s*orientation/i;

  function isGenderField(label) {
    const t = String(label || '');
    if (!GENDER_FIELD_RE.test(t)) return false;
    if (SEXUAL_ORIENTATION_RE.test(t)) return false;
    return true;
  }

  function profileHasGender(profile) {
    const g = profile && profile.gender;
    return !!(g != null && String(g).trim());
  }

  /**
   * EEO / diversity controls are skipped — except gender/sex when the profile
   * already has a gender value the applicant chose to share.
   */
  function shouldSkipDiversity(el, label, profile) {
    if (!isDiversityControl(el, label)) return false;
    if (isGenderField(label) && profileHasGender(profile)) return false;
    return true;
  }

  /** Gender must be select/radio/combobox — never typed into a free-text box. */
  function isGenderChoiceControl(el, descriptor) {
    if (!el) return false;
    const ct = controlTypeOf(el, descriptor || {});
    if (ct === 'select' || ct === 'multiselect' || ct === 'radio' || ct === 'combobox') return true;
    const type = String((descriptor && descriptor.type) || el.type || '').toLowerCase();
    if (type === 'radio') return true;
    if (el.tagName === 'SELECT') return true;
    if (isComboboxInput(el)) return true;
    return false;
  }

  function isConsentCheckbox(el, label) {
    const type = String((el && el.type) || '').toLowerCase();
    if (type !== 'checkbox') return false;
    return CONSENT_RE.test(String(label || ''));
  }

  /**
   * Prefer site "Fill with CV / Import from Resume" before normal autofill.
   * Waits briefly so imported values can settle, then the field loop fills gaps.
   */
  async function tryClickCvImport(options) {
    options = options || {};
    const syn = global.FillApplySynonyms;
    const nodes = queryAll(
      'button, a[role="button"], [role="button"], a.button, input[type="button"], input[type="submit"], label'
    );
    let best = null;
    let bestText = '';
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.disabled) continue;
      if (!isVisible(el)) continue;
      const text = (
        (syn && syn.buttonText ? syn.buttonText(el) : textOf(el)) +
        ' ' +
        (el.getAttribute('aria-label') || '') +
        ' ' +
        (el.value || '')
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || text.length > 120) continue;
      if (/\b(submit application|apply now)\b/i.test(text) && !CV_IMPORT_RE.test(text)) continue;
      if (CV_IMPORT_RE.test(text)) {
        best = el;
        bestText = text.slice(0, 80);
        break;
      }
    }
    if (!best) return { clicked: false, text: '' };
    if (global.FillApplyFocusHud && global.FillApplyFocusHud.mark) {
      global.FillApplyFocusHud.mark(best, { scroll: true });
    }
    realClick(best);
    const waitMs = options.cvImportWaitMs != null ? options.cvImportWaitMs : 1800;
    const D = dom();
    if (D && D.waitForQuiet) {
      await D.waitForQuiet({ timeoutMs: waitMs, quietMs: 400 });
    } else {
      await sleep(waitMs);
    }
    return { clicked: true, text: bestText };
  }


  /** Options that look like phone dial codes: "+966", "+966 Saudi Arabia". */
  function optionsLookLikeDialCodes(options) {
    if (!options || !options.length) return false;
    let dialish = 0;
    const n = Math.min(options.length, 40);
    for (let i = 0; i < n; i++) {
      const o = options[i];
      const t = String((o && (o.text || o.label || o.value)) || '');
      if (/\+\d{1,4}\b/.test(t) || /^\s*\d{1,4}\s*[-–/]/.test(t)) dialish += 1;
    }
    return dialish >= 3 || (dialish >= 1 && dialish / n >= 0.25);
  }

  function descriptorLooksLikePhoneCountry(descriptor, el) {
    if (!descriptor) return false;
    const blob = String(
      (descriptor.label || '') +
        ' ' +
        (descriptor.name || '') +
        ' ' +
        (descriptor.id || '') +
        ' ' +
        (descriptor.autocomplete || '') +
        ' ' +
        (descriptor.placeholder || '')
    ).toLowerCase();
    if (/country code|dial code|calling code|phone country|tel-country|phone.?country/.test(blob)) {
      return true;
    }
    const opts = descriptor.options || (el && el.options ? null : null);
    let optionList = descriptor.options;
    if ((!optionList || !optionList.length) && el && el.tagName === 'SELECT' && el.options) {
      optionList = [];
      for (let i = 0; i < el.options.length; i++) {
        optionList.push({ text: el.options[i].textContent, value: el.options[i].value });
      }
    }
    if (optionsLookLikeDialCodes(optionList)) {
      // Bare "Country*" next to a phone field, or any dial-code select.
      if (/^\s*country\b/.test(blob) || /\bcountry\b/.test(blob)) return true;
      return true;
    }
    return false;
  }


  function dom() {
    return global.FillApplyDom || null;
  }

  function sleep(ms) {
    const D = dom();
    if (D && D.sleep) return D.sleep(ms);
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function queryAll(selector, root) {
    const D = dom();
    if (D && D.queryAll) return D.queryAll(selector, root);
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    } catch (_e) {
      return [];
    }
  }

  function isVisible(el) {
    const D = dom();
    return D && D.isVisible ? D.isVisible(el) : !!el;
  }

  function textOf(el) {
    const D = dom();
    if (D && D.textOf) return D.textOf(el);
    return String((el && (el.innerText || el.textContent)) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function realClick(el) {
    const D = dom();
    if (D && D.realClick) return D.realClick(el);
    try {
      el.click();
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Label text for a control. Kept on the public API because every adapter
   * delegates to it.
   */
  function getLabelText(el) {
    const D = dom();
    if (D && D.labelFor) return D.labelFor(el);
    if (!el) return '';
    const aria = el.getAttribute && el.getAttribute('aria-label');
    return aria ? aria.trim() : '';
  }

  function isRequiredField(el, label) {
    const D = dom();
    if (D && D.isRequired) return D.isRequired(el, label);
    return !!(el && el.required);
  }

  /** Set during run() when profile supplies password for career signup/login. */
  let allowPasswordFill = false;
  let allowLoginFormFill = false;

  function isFillable(el) {
    if (!el || el.disabled) return false;
    const type = String(el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') return false;
    if (type === 'file') return false;
    if (type === 'password' && !allowPasswordFill) return false;
    if (el.readOnly && !isComboboxInput(el)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!(el.getAttribute && el.getAttribute('contenteditable') === 'true');
  }

  /**
   * A text input that drives a listbox rather than accepting free text
   * (Greenhouse location, Workday country, react-select).
   */
  function isComboboxInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const role = el.getAttribute('role') || '';
    if (role === 'combobox') return true;
    if (el.getAttribute('aria-autocomplete')) return true;
    if (el.getAttribute('aria-haspopup') === 'listbox') return true;
    if (el.getAttribute('aria-controls') && el.readOnly) return true;
    return false;
  }

  function normalizeText(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Match a select option by exact, case-insensitive, or includes.
   */
  function matchSelectOption(selectEl, value) {
    if (!selectEl || !selectEl.options) return false;
    const want = String(value).trim();
    const wantLower = want.toLowerCase();
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      const t = (opt.textContent || '').trim();
      const v = String(opt.value || '').trim();
      const tLower = t.toLowerCase();
      const vLower = v.toLowerCase();
      // Skip placeholder options
      if (!v && /^(select|choose|please select|--|–)/i.test(t)) continue;
      if (tLower === 'select...' || tLower === 'select …') continue;

      let score = 0;
      if (t === want || v === want) score = 100;
      else if (tLower === wantLower || vLower === wantLower) score = 90;
      else if (tLower.indexOf(wantLower) !== -1 || wantLower.indexOf(tLower) !== -1) score = 70;
      else if (vLower.indexOf(wantLower) !== -1) score = 60;
      else if (/^(yes|y)$/i.test(want) && /^(yes|y|true|1)$/i.test(t + v)) score = 85;
      else if (/^(no|n)$/i.test(want) && /^(no|n|false|0)$/i.test(t + v) && !/not sure|unknown/i.test(t)) {
        score = 85;
      } else {
        // Dial-code options: "+966" must match "+966 Saudi Arabia" / "Saudi Arabia (+966)".
        const wantDial = (want.match(/\+?\d{1,4}/) || [''])[0].replace(/^\+/, '');
        const tDial = (t.match(/\+?\d{1,4}/) || [''])[0].replace(/^\+/, '');
        const vDial = (v.match(/\+?\d{1,4}/) || [''])[0].replace(/^\+/, '');
        if (wantDial && (wantDial === tDial || wantDial === vDial)) score = 88;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= 60) {
      selectEl.selectedIndex = bestIdx;
      const D = dom();
      if (D && D.setValue) {
        // Fire the same event pair a user selection produces.
        try {
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Shape a profile value for the control it is about to be written into.
   *
   * Knowing which field we found is not enough: a phone number that a single
   * Greenhouse field accepts as +971501234567 has to arrive as 501234567 when
   * the form renders its own country-code selector, and as 5551234567 when the
   * control declares pattern="\d{10}". FillApplyFormat reads those constraints
   * off the control; this stays as the local fallback for the numeric and date
   * cases when it is not loaded.
   */
  function sanitizeForInput(el, value, context) {
    if (value == null) return { value: '', skip: true };
    var str = String(value);
    if (!el) return { value: str, skip: false };

    var fmt = global.FillApplyFormat;
    if (fmt && typeof fmt.formatForField === 'function') {
      var shaped = fmt.formatForField(el, str, context || {});
      if (shaped) return { value: shaped.value, skip: !!shaped.skip, format: shaped.format, kind: shaped.kind };
    }

    var type = String(el.type || '').toLowerCase();
    var inputMode = (el.getAttribute && (el.getAttribute('inputmode') || '')).toLowerCase();
    var pattern = (el.getAttribute && el.getAttribute('pattern')) || '';

    if (type === 'date') {
      var iso = toIsoDate(str);
      return iso ? { value: iso, skip: false } : { value: '', skip: true };
    }

    var wantsNumber =
      type === 'number' ||
      type === 'range' ||
      (type === 'tel' && (/[0-9]/.test(pattern) || inputMode === 'numeric' || inputMode === 'decimal')) ||
      inputMode === 'numeric' ||
      inputMode === 'decimal';
    if (!wantsNumber) {
      var maxLength = Number(el.maxLength);
      if (Number.isFinite(maxLength) && maxLength > 0 && str.length > maxLength) {
        str = str.slice(0, maxLength);
      }
      return { value: str, skip: false };
    }
    var num = '';
    if (global.FillApplyProfile && typeof global.FillApplyProfile.numericAmount === 'function') {
      num = global.FillApplyProfile.numericAmount(str);
    } else {
      num = str
        .replace(/(AED|SAR|USD|EUR|GBP|PKR|INR|CAD|AUD|CHF|JPY|CNY|QAR|KWD|BHD|OMR|EGP)\b/gi, '')
        .replace(/[£$€¥₹]/g, '')
        .replace(/,/g, '')
        .replace(/\s+/g, '');
      var m = num.match(/-?\d+(?:\.\d+)?/);
      num = m ? m[0] : '';
    }
    if (!num) return { value: '', skip: true };
    return { value: num, skip: false };
  }

  function toIsoDate(str) {
    var s = String(str || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return '';
    var d = new Date(parsed);
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /**
   * Write a value into any control type. Prefer FillApplyControlAdapter
   * (adapt → fill → verify). Checkboxes/radios use real clicks; selects never
   * free-text; type=date never gets a human-readable date.
   */

  /** Never write the wrong shape into typed controls (Email←salary, Title←first name, etc.). */
  function valueCompatibleWithControl(el, key, value, descriptor) {
    var type = String((el && el.type) || '').toLowerCase();
    var lab = String((descriptor && descriptor.label) || '').toLowerCase();
    var raw = value == null ? '' : String(value).trim();
    if (!raw) return false;

    var salaryKeys = {
      salaryText: 1,
      currentSalary: 1,
      expectedSalary: 1,
      salaryCurrency: 1
    };
    var nameKeys = {
      firstName: 1,
      lastName: 1,
      middleName: 1,
      fullName: 1,
      preferredName: 1
    };
    var honorificKeys = { salutation: 1, title: 1 };

    if (type === 'email' || /\be-?mail\b/.test(lab)) {
      if (!/@/.test(raw)) return false;
      if (salaryKeys[key] || nameKeys[key] || honorificKeys[key]) return false;
      if (key && key !== 'email' && key !== 'emailConfirm' && key !== 'customQA' && key !== 'customAnswers') {
        // Allow adaptive knowledge only when value still looks like email
        if (!/@/.test(raw)) return false;
      }
      if (/\b(sar|aed|usd|gbp)\b/i.test(raw) && raw.indexOf('@') === -1) return false;
    }
    if (type === 'tel' || type === 'phone') {
      if (salaryKeys[key]) return false;
      if (key === 'email' || key === 'emailConfirm') return false;
      if (!/[0-9]/.test(raw)) return false;
    }
    if (lab === 'title' || lab === 'title *' || (descriptor && String(descriptor.name || '').toLowerCase() === 'title')) {
      if (nameKeys[key] || key === 'currentTitle' || key === 'salaryText') return false;
      if (raw.length > 24) return false;
      if (/financial|planning|manager|analyst|engineer|director/i.test(raw)) return false;
    }
    if (salaryKeys[key] && (type === 'email' || type === 'tel' || type === 'url')) return false;
    return true;
  }

  function setNativeValue(el, value, context) {
    context = context || {};
    if (!valueCompatibleWithControl(el, context.key, value, context.descriptor || {})) {
      return false;
    }
    const A = global.FillApplyControlAdapter;
    if (A && typeof A.applyToControl === 'function') {
      const ct = controlTypeOf(el, context.descriptor || {});
      const typeAttr = String((el && el.type) || '').toLowerCase();
      // Adapter owns closed/choice/numeric/file controls. Plain text/email/tel/url
      // stay on format.js sanitizeForInput (DOB placeholders, phone shaping, etc.).
      // Combobox/autocomplete/custom-select need async pickFromDropdown.
      const adapterOwned =
        ct === 'checkbox' ||
        ct === 'checkbox-group' ||
        ct === 'radio' ||
        ct === 'button-group' ||
        ct === 'select' ||
        ct === 'multiselect' ||
        ct === 'number' ||
        ct === 'file' ||
        ((ct === 'date' || ct === 'datetime') &&
          (typeAttr === 'date' || typeAttr === 'datetime-local' || typeAttr === 'month' || typeAttr === 'week'));
      if (adapterOwned) {
        const result = A.applyToControl(el, value, {
          descriptor: context.descriptor || {},
          label: context.label || '',
          hasPhoneCountryField: !!context.hasPhoneCountryField,
          consent: context.key === 'consent',
          documents: context.documents || (context.profile && context.profile.documents) || null,
          el: el
        });
        if (result.blocker) return false;
        if (result.deferAsync) {
          /* fall through for text-like typing only */
        } else if (result.ok) {
          return true;
        } else if (result.reason === 'file_not_configured') {
          return false;
        }
        // no_matching_option: fall through so select/radio bucket + variant matching can run
        // If adapter could not verify, still try legacy below.
      }
    }

    const D = dom();
    const tag = el.tagName;
    const type = String(el.type || '').toLowerCase();

    if (type === 'checkbox') {
      const want = /^(yes|true|1|on|y|checked)$/i.test(String(value));
      if (el.checked !== want) realClick(el);
      if (el.checked !== want) {
        el.checked = want;
        fireChange(el);
      }
      return el.checked === want;
    }

    if (type === 'radio') {
      const ok = selectRadioInGroup(el, value, kindOf(el, context));
      return !!ok;
    }

    var sanitized = sanitizeForInput(el, value, context);
    if (sanitized.skip) return false;
    const finalValue = sanitized.value;

    if (tag === 'SELECT') {
      if (matchSelectOption(el, finalValue)) return true;
      const variants = selectVariants(finalValue, sanitized.kind);
      for (let v = 0; v < variants.length; v++) {
        if (matchSelectOption(el, variants[v])) return true;
      }
      if (selectByOptionMatch(el, finalValue, sanitized.kind)) return true;
      return false;
    }

    // Never assign .value on checkbox/radio/file (adapter / branches above handle them)
    if (type === 'file') return false;

    if (D && D.setValue) {
      D.setValue(el, finalValue);
    } else {
      el.value = finalValue;
      fireChange(el);
    }
    return true;
  }

  /** Alternate spellings of a value that a select might use as its option text. */
  function selectVariants(value, kind) {
    const fmt = global.FillApplyFormat;
    if (!fmt || typeof fmt.valueVariants !== 'function') return [];
    return fmt.valueVariants(value, kind).filter(function (v) {
      return v && v !== value;
    });
  }

  /** What shape of answer a control wants, for option matching. */
  function kindOf(el, context) {
    const fmt = global.FillApplyFormat;
    if (!fmt || typeof fmt.fieldKind !== 'function') return null;
    const D = dom();
    const descriptor = D && D.describeField ? D.describeField(el) : el;
    return fmt.fieldKind(descriptor, context && context.key);
  }

  /** Real options of a select, placeholders dropped, with their indexes kept. */
  function realOptions(selectEl) {
    const out = [];
    if (!selectEl || !selectEl.options) return out;
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      const text = (opt.textContent || '').trim();
      const value = String(opt.value || '').trim();
      if (!value && /^(select|choose|please select|--|–|—)/i.test(text)) continue;
      if (/^select\s*[….]{0,3}$/i.test(text)) continue;
      out.push({ index: i, label: text || value });
    }
    return out;
  }

  /**
   * Choose a select option by bucket or level rather than by text similarity.
   */
  function selectByOptionMatch(selectEl, value, kind) {
    const fmt = global.FillApplyFormat;
    if (!fmt || typeof fmt.matchOptionIndex !== 'function') return false;
    const options = realOptions(selectEl);
    if (!options.length) return false;
    const hit = fmt.matchOptionIndex(
      options.map(function (o) {
        return o.label;
      }),
      value,
      kind
    );
    if (!hit) return false;
    selectEl.selectedIndex = options[hit.index].index;
    fireChange(selectEl);
    return true;
  }

  function fireChange(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_e) {
      /* ignore */
    }
  }

  /** Pick the radio in `el`'s group whose label or value matches `value`. */
  function selectRadioInGroup(el, value, kind) {
    const A = global.FillApplyControlAdapter;
    if (A && typeof A.fill === 'function' && typeof A.adaptAnswer === 'function') {
      const adapted = A.adaptAnswer('radio', value, {});
      if (adapted.ok) {
        const filled = A.fill(el, adapted, {});
        if (filled && filled.ok && filled.verified !== false) return true;
        if (filled && filled.ok) return !!filled.verified;
      }
    }
    const want = String(value).toLowerCase().trim();
    const group = radioGroupFor(el);
    if (!group.length) return false;

    let best = null;
    let bestScore = 0;
    group.forEach(function (radio) {
      // Prefer per-option label (fixes shared fieldset legend Yes/No bugs)
      let label = '';
      if (A && typeof A.ownRadioLabel === 'function') {
        label = String(A.ownRadioLabel(radio) || '').toLowerCase().trim();
      }
      if (!label) label = getLabelText(radio).toLowerCase().trim();
      const raw = String(radio.value || '').toLowerCase().trim();
      let score = 0;
      if (raw === want || label === want) score = 100;
      else if (label.indexOf(want) !== -1 || (want.indexOf(label) !== -1 && label.length > 1)) score = 70;
      else if (raw.indexOf(want) !== -1) score = 60;
      else if (/^(yes|y)$/i.test(want) && /^(yes|y|true)$/i.test(raw || label)) score = 85;
      else if (/^(no|n)$/i.test(want) && /^(no|n|false)$/i.test(raw || label) && !/not/i.test(label)) {
        score = 85;
      }
      if (score > bestScore) {
        bestScore = score;
        best = radio;
      }
    });

    if (!best || bestScore < 60) {
      best = radioByOptionMatch(group, value, kind);
      if (!best) return false;
    }
    realClick(best);
    if (!best.checked) {
      best.checked = true;
      fireChange(best);
    }
    // Verify checked===true (shared-label bugs often leave the wrong control unchecked)
    return best.checked === true;
  }

  function radioByOptionMatch(group, value, kind) {
    const fmt = global.FillApplyFormat;
    if (!fmt || typeof fmt.matchOptionIndex !== 'function') return null;
    const labels = group.map(function (radio) {
      return getLabelText(radio) || String(radio.value || '');
    });
    const hit = fmt.matchOptionIndex(labels, value, kind);
    return hit ? group[hit.index] : null;
  }

  function radioGroupFor(el) {
    if (!el) return [];
    const D = dom();
    const name = el.getAttribute && el.getAttribute('name');
    if (name) {
      const escaped = D && D.cssEscape ? D.cssEscape(name) : name;
      const found = queryAll('input[type="radio"][name="' + escaped + '"]');
      if (found.length) return found;
    }
    const container = el.closest ? el.closest('fieldset, [role="radiogroup"], .field, [class*="field"]') : null;
    if (container) {
      try {
        return Array.prototype.slice.call(container.querySelectorAll('input[type="radio"]'));
      } catch (_e) {
        /* ignore */
      }
    }
    return [el];
  }

  function clearHighlights() {
    if (global.FillApplyFocusHud && global.FillApplyFocusHud.clearStatus) {
      global.FillApplyFocusHud.clearStatus();
    }
    queryAll('[' + HIGHLIGHT_ATTR + ']').forEach(function (el) {
      el.removeAttribute(HIGHLIGHT_ATTR);
      el.style.outline = '';
    });
    queryAll('[' + FILLED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(FILLED_ATTR);
      el.style.outline = '';
    });
  }

    function highlight(el, kind) {
    if (kind === 'unmatched') {
      el.setAttribute(HIGHLIGHT_ATTR, '1');
      el.style.outline = '2px solid #f59e0b';
      if (global.FillApplyFocusHud && global.FillApplyFocusHud.markStatus) {
        global.FillApplyFocusHud.markStatus(el, 'unfilled', 'Needs info');
      }
    } else {
      el.setAttribute(FILLED_ATTR, '1');
      el.style.outline = '2px solid #22c55e';
      if (global.FillApplyFocusHud && global.FillApplyFocusHud.markStatus) {
        global.FillApplyFocusHud.markStatus(el, 'filled', 'Filled');
      }
    }
  }

  /**
   * Every fillable control on the page, deduplicated by radio group and with
   * page furniture (search, newsletter, sign-in) filtered out.
   */
  function collectFields(root) {
    const syn = global.FillApplySynonyms;
    const nodes = queryAll('input, textarea, select, [contenteditable="true"]', root);
    const list = [];
    const seenRadioGroups = {};

    nodes.forEach(function (el) {
      if (!isFillable(el)) return;
      if (!isVisible(el)) return;
      if (syn && syn.isSearchLikeField && syn.isSearchLikeField(el)) return;
      if (syn && syn.isInsideEnquiryForm && syn.isInsideEnquiryForm(el)) return;
      if (
        !allowLoginFormFill &&
        syn &&
        syn.isInsideLoginForm &&
        syn.isInsideLoginForm(el)
      ) {
        return;
      }

      if (String(el.type || '').toLowerCase() === 'radio') {
        const name = el.getAttribute('name') || '';
        const groupKey = name || 'radio:' + list.length;
        if (seenRadioGroups[groupKey]) return;
        seenRadioGroups[groupKey] = true;
      }
      list.push(el);
    });
    return list;
  }

  /**
   * Catalog every control on the page — the diagnostic view of what the engine
   * can actually see, surfaced in the run report.
   */
  function inspectForm(root) {
    const D = dom();
    const summary = {
      inputs: [],
      textareas: [],
      selects: [],
      contenteditables: [],
      fileInputs: [],
      attachButtons: [],
      customDropdowns: [],
      buttons: [],
      counts: {
        input: 0,
        textarea: 0,
        select: 0,
        contenteditable: 0,
        file: 0,
        attachButton: 0,
        customDropdown: 0,
        button: 0,
        required: 0
      }
    };

    queryAll('input', root).forEach(function (el) {
      const type = String(el.type || 'text').toLowerCase();
      if (type === 'file') {
        summary.fileInputs.push({
          type: type,
          name: el.name || '',
          id: el.id || '',
          accept: el.getAttribute('accept') || '',
          required: isRequiredField(el),
          label: getLabelText(el),
          hidden: !isVisible(el)
        });
        summary.counts.file += 1;
        return;
      }
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') return;
      const described = D && D.describeField ? D.describeField(el) : { type: type, label: getLabelText(el) };
      summary.inputs.push(described);
      summary.counts.input += 1;
      if (described.required) summary.counts.required += 1;
    });

    queryAll('textarea', root).forEach(function (el) {
      const described = D && D.describeField ? D.describeField(el) : { type: 'textarea', label: getLabelText(el) };
      summary.textareas.push(described);
      summary.counts.textarea += 1;
      if (described.required) summary.counts.required += 1;
    });

    queryAll('select', root).forEach(function (el) {
      const described = D && D.describeField ? D.describeField(el) : { type: 'select', label: getLabelText(el) };
      summary.selects.push(described);
      summary.counts.select += 1;
      if (described.required) summary.counts.required += 1;
    });

    queryAll('[contenteditable="true"], [contenteditable=""]', root).forEach(function (el) {
      summary.contenteditables.push({
        type: 'contenteditable',
        id: el.id || '',
        label: getLabelText(el),
        text: textOf(el).slice(0, 80)
      });
      summary.counts.contenteditable += 1;
    });

    const attachRe = /\b(attach|upload|choose file|browse|select file)\b/i;
    queryAll('button, a, [role="button"], label', root).forEach(function (el) {
      const text = (textOf(el) + ' ' + (el.getAttribute('aria-label') || '')).trim();
      if (!text) return;
      if (attachRe.test(text)) {
        summary.attachButtons.push({ text: text.slice(0, 80), tag: el.tagName });
        summary.counts.attachButton += 1;
      }
      if (summary.buttons.length < 40 && isVisible(el)) {
        summary.buttons.push({ tag: el.tagName, text: text.slice(0, 60), disabled: !!el.disabled });
        summary.counts.button += 1;
      }
    });

    findCustomDropdownTriggers(root).forEach(function (el) {
      summary.customDropdowns.push({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        label: getLabelText(el) || (el.getAttribute('aria-label') || '').slice(0, 80),
        text: textOf(el).slice(0, 60)
      });
      summary.counts.customDropdown += 1;
    });

    return summary;
  }

  function controlTypeOf(el, descriptor) {
    const A = global.FillApplyControlAdapter;
    if (A && typeof A.detectControl === 'function') {
      try {
        return A.detectControl(el, descriptor || {});
      } catch (_e) {
        /* fall through */
      }
    }
    const C = global.FillApplyKnowledgeCanonical;
    if (C && typeof C.detectControlType === 'function') {
      return C.detectControlType(el, descriptor || {});
    }
    const type = String((descriptor && descriptor.type) || (el && el.type) || '').toLowerCase();
    if (el && el.tagName === 'SELECT') return el.multiple ? 'multiselect' : 'select';
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'file') return 'file';
    if (isComboboxInput(el)) return 'combobox';
    return type || 'text';
  }

  function optionsForControl(el, descriptor) {
    if (descriptor && Array.isArray(descriptor.options) && descriptor.options.length) {
      return descriptor.options;
    }
    if (el && el.tagName === 'SELECT' && el.options) {
      const out = [];
      for (let i = 0; i < el.options.length; i++) {
        out.push({
          value: el.options[i].value,
          text: (el.options[i].textContent || '').replace(/\s+/g, ' ').trim()
        });
      }
      return out;
    }
    // Radio groups: collect sibling option labels/values so Yes/No + Mr./Mrs. gate correctly
    const type = String((el && el.type) || (descriptor && descriptor.type) || '').toLowerCase();
    if (type === 'radio' || (el && String(el.type || '').toLowerCase() === 'radio')) {
      const group = radioGroupFor(el);
      return group.map(function (radio) {
        const text = (getLabelText(radio) || String(radio.value || '')).replace(/\s+/g, ' ').trim();
        return { value: radio.value, text: text };
      });
    }
    return [];
  }

  /**
   * Gate: knowledge value+type must be compatible with DOM control+options.
   * Knowledge Type never overrides DOM. Incompatible → do not fill.
   */
  function gateFill(el, descriptor, answer) {
    const C = global.FillApplyKnowledgeCanonical;
    if (!answer || answer.value == null || String(answer.value).trim() === '') {
      return { ok: false, action: 'DO_NOT_FILL', reason: 'empty' };
    }
    if (answer.action === 'DO_NOT_FILL') {
      return { ok: false, action: 'DO_NOT_FILL', reason: answer.reason || 'blocked' };
    }
    const controlType = controlTypeOf(el, descriptor);
    const options = optionsForControl(el, descriptor);
    const knowledgeType = (answer && answer.fieldType) || (C && C.inferFieldType ? C.inferFieldType(el, descriptor) : 'string');
    if (C && typeof C.prepareFillValue === 'function') {
      const prepared = C.prepareFillValue(answer.value, knowledgeType, controlType, options);
      if (!prepared.ok) {
        return {
          ok: false,
          action: 'DO_NOT_FILL',
          reason: prepared.reason,
          controlType: controlType,
          knowledgeType: knowledgeType
        };
      }
      return {
        ok: true,
        action: 'FILL',
        value: prepared.value,
        reason: prepared.reason,
        controlType: controlType,
        knowledgeType: knowledgeType
      };
    }
    // Fallback without canonical helpers.
    // Closed Yes/No: require a boolean-like value. Other selects defer to
    // setNativeValue (variants / ISO codes / buckets) — which still never
    // free-texts when nothing matches.
    if ((controlType === 'select' || controlType === 'multiselect' || controlType === 'radio') && options.length) {
      var labels = options.map(function (o) {
        return String((o && (o.text || o.label || o.value)) || '').trim();
      }).filter(Boolean);
      var real = labels.filter(function (t) {
        return !/^(select|choose|please|--|–|—)/i.test(t);
      });
      var hasYes = real.some(function (t) { return /^(yes|y|true|1)$/i.test(t); });
      var hasNo = real.some(function (t) { return /^(no|n|false|0)$/i.test(t) && !/not sure|unknown/i.test(t); });
      if (hasYes && hasNo && real.length <= 4) {
        if (!/^(yes|no|true|false|y|n|1|0)$/i.test(String(answer.value).trim())) {
          return {
            ok: false,
            action: 'DO_NOT_FILL',
            reason: 'no_matching_option',
            controlType: controlType,
            knowledgeType: knowledgeType
          };
        }
      }
    }
    return { ok: true, action: 'FILL', value: answer.value, controlType: controlType, knowledgeType: knowledgeType };
  }

  function serializeProfileValue(value) {
    var F = global.FillApplyFormat;
    if (F && typeof F.serializeAnswer === 'function') return F.serializeAnswer(value);
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value) || typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_e) { return ''; }
    }
    return String(value);
  }

  function resolveValue(profile, key) {
    if (!key) return '';
    // Name fields: prefer explicit first/last. When only fullName is set,
    // First = first token, Last = remainder (never last token alone).
    if (key === 'salutation' || key === 'title') {
      return (
        profile.salutation ||
        profile.title ||
        (profile.customAnswers && (profile.customAnswers.salutation || profile.customAnswers.title)) ||
        ''
      );
    }
    if (
      key === 'fullName' ||
      key === 'firstName' ||
      key === 'lastName' ||
      key === 'middleName' ||
      key === 'preferredName'
    ) {
      var fmtNames = global.FillApplyFormat;
      var parts =
        fmtNames && typeof fmtNames.nameParts === 'function'
          ? fmtNames.nameParts(profile)
          : {
              first: profile.firstName || '',
              middle: profile.middleName || '',
              last: profile.lastName || '',
              full:
                profile.fullName ||
                [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
                ''
            };
      if (key === 'fullName' || key === 'preferredName') {
        return parts.full || profile.preferredName || '';
      }
      if (key === 'firstName') return parts.first || '';
      if (key === 'lastName') return parts.last || '';
      if (key === 'middleName') return parts.middle || profile.middleName || '';
    }
    if (key === 'street' || key === 'addressLine1' || key === 'addressLine2' || key === 'address' || key === 'addressFull') {
      var fmtAddr = global.FillApplyFormat;
      if (key === 'address' || key === 'addressFull') {
        if (fmtAddr && typeof fmtAddr.composeAddress === 'function') {
          return fmtAddr.composeAddress(profile, key === 'addressFull' ? 'multiline' : 'single');
        }
      }
      if (key === 'addressLine1' || key === 'street') {
        return profile.addressLine1 || profile.street || (fmtAddr && fmtAddr.composeAddress ? fmtAddr.composeAddress(profile, 'parts').line1 : '') || '';
      }
      if (key === 'addressLine2') return profile.addressLine2 || '';
    }
    if (key === 'countryOfResidence' || key === 'residenceCountry') {
      return profile.countryOfResidence || profile.residenceCountry || profile.addressCountry || profile.country || '';
    }
    if (key === 'dateOfBirth' || key === 'birthYear' || key === 'birthMonth' || key === 'birthDay') {
      // Always return canonical ISO; formatDate extracts year/month/day from the control.
      var dob =
        profile.dateOfBirth ||
        (profile.customAnswers &&
          (profile.customAnswers.date_of_birth ||
            profile.customAnswers.dob ||
            profile.customAnswers.dob_iso)) ||
        '';
      return dob ? String(dob) : '';
    }
    if (key === 'phone') {
      const ca = profile.customAnswers || {};
      // Prefer full E.164 when stored; formatPhone still strips to national
      // when the form has a sibling country-code control.
      const full =
        profile.phoneFull ||
        profile.phoneE164 ||
        ca.phone_full ||
        ca.phoneFull ||
        ca.phone_complete ||
        ca.phone_with_country ||
        ca.Phone ||
        '';
      const national = profile.phone || ca.phone || ca.phone_number || '';
      const country =
        profile.phoneCountry ||
        profile.phoneCountryCode ||
        ca.phone_country ||
        ca.phoneCountry ||
        '';
      if (full) return String(full);
      if (national && country) {
        const dial = String(country).replace(/\D/g, '');
        const nat = String(national).replace(/\D/g, '');
        if (dial && nat) return '+' + dial + nat;
      }
      return national ? String(national) : '';
    }
    if (key === 'phoneCountry') {
      const ca = profile.customAnswers || {};
      return (
        profile.phoneCountry ||
        profile.phoneCountryCode ||
        ca.phone_country ||
        ca.phoneCountry ||
        ''
      );
    }
    if (key === 'salaryText' || key === 'expectedSalary' || key === 'currentSalary') {
      const ca = profile.customAnswers || {};
      if (key === 'salaryText') {
        return (
          profile.salaryText ||
          ca.salary_text ||
          ca.salary_display ||
          ca.ignite_salary ||
          ca.current_salary_text ||
          ca.current_remuneration ||
          ca['What is your current Remuneration?'] ||
          profile.currentSalary ||
          profile.expectedSalary ||
          ca.current_salary ||
          ''
        );
      }
      // Prefer dedicated salary_text for bare salary boxes when the typed field is empty.
      const direct = profile[key];
      if (direct != null && String(direct).trim() !== '') return String(direct);
      return (
        profile.salaryText ||
        ca.salary_text ||
        ca.salary_display ||
        ca.ignite_salary ||
        ''
      );
    }
    if (key === 'noticePeriod') {
      const ca = profile.customAnswers || {};
      return (
        profile.noticePeriod ||
        ca.availability ||
        ca.available_immediately ||
        ca.available_to_start ||
        ca.notice_period ||
        profile.availableFrom ||
        ''
      );
    }
    if (key === 'emailConfirm' || key === 'confirm_email' || key === 'retype_email') {
      const ca = profile.customAnswers || {};
      return (
        profile.emailConfirm ||
        profile.confirm_email ||
        profile.retype_email ||
        ca.confirm_email ||
        ca.retype_email ||
        ca.emailConfirm ||
        profile.email ||
        ca.email ||
        ''
      );
    }
    if (key === 'password' || key === 'passwordConfirm' || key === 'confirm_password' || key === 'retype_password') {
      const ca = profile.customAnswers || {};
      const pw =
        profile.password ||
        ca.password ||
        ca.choose_password ||
        ca.account_password ||
        '';
      if (key === 'password') return pw == null ? '' : String(pw);
      return (
        profile.passwordConfirm ||
        profile.confirm_password ||
        profile.retype_password ||
        ca.confirm_password ||
        ca.retype_password ||
        ca.passwordConfirm ||
        pw ||
        ''
      );
    }
    const v = profile[key];
    return v == null ? '' : serializeProfileValue(v);
  }

  /**
   * Find the answer for a control.
   *
   * When the adaptive resolver is loaded it owns precedence (session →
   * confirmed user knowledge → profile → built-in). Otherwise the original
   * field-map / customAnswers / customQA lookup runs unchanged.
   */
  function answerLooksLikeEmail(v) {
    return /@/.test(String(v || '')) && !/\b(sar|aed|usd|gbp)\b/i.test(String(v || ''));
  }

  function answerLooksLikePhone(v) {
    return /[0-9]{6,}/.test(String(v || '').replace(/\D/g, ''));
  }

  function answerFor(profile, descriptor, map) {
    const label = descriptor.label || '';
    const labLower = label.toLowerCase();
    var inputType = String(descriptor.type || '').toLowerCase();

    function mapFallback() {
      let key = map.bestKeyForField(descriptor);
      // Typed controls win over fuzzy label matches (stops salary→email, name→title).
      if (inputType === 'email') key = 'email';
      else if (inputType === 'tel' || inputType === 'phone') {
        if (key !== 'phoneCountry') key = 'phone';
      }
      if (descriptorLooksLikePhoneCountry(descriptor, null) && resolveValue(profile, 'phoneCountry')) {
        key = 'phoneCountry';
      }
      var labExact = String(descriptor.label || '').trim().toLowerCase();
      if (labExact === 'title' || labExact === 'title *') {
        if (key === 'firstName' || key === 'fullName' || key === 'currentTitle' || key === 'salaryText') {
          key = resolveValue(profile, 'salutation') ? 'salutation' : 'title';
        }
      }
      let value = resolveValue(profile, key);
      if (key === 'title' && !value) value = resolveValue(profile, 'salutation');
      if (key === 'salutation' && !value) value = resolveValue(profile, 'title');
      if (key === 'phone' && !value) {
        value =
          resolveValue(profile, 'phoneFull') ||
          resolveValue(profile, 'phoneE164') ||
          '';
      }
      if (value) return { key: key, value: value, source: 'fieldMap' };
      return null;
    }

    const K = global.FillApplyKnowledge;
    if (K && typeof K.resolve === 'function') {
      var resolved = K.resolve(profile, descriptor, map);
      var rv = resolved && resolved.value != null ? String(resolved.value).trim() : '';
      var blocked = resolved && (resolved.action === 'DO_NOT_FILL' || resolved.ambiguous);
      var badTyped =
        (inputType === 'email' && rv && !answerLooksLikeEmail(rv)) ||
        ((inputType === 'tel' || inputType === 'phone') && rv && !answerLooksLikePhone(rv)) ||
        ((inputType === 'tel' || inputType === 'phone' || inputType === 'email') && (blocked || !rv));
      // Typed identity controls (email/tel): empty/blocked/ambiguous still fall back to profile.
      // Other ambiguous fields stay blank. Empty DO_NOT_FILL must not block address/DOB parts.
      if (resolved && resolved.ambiguous && inputType !== 'email' && inputType !== 'tel' && inputType !== 'phone') {
        return resolved;
      }
      if (!badTyped && resolved && rv) return resolved;
      var fb = mapFallback();
      if (fb) return fb;
      if (resolved) return resolved;
    }

    var mapped = mapFallback();
    if (mapped) return mapped;
    let key = map.bestKeyForField(descriptor);
    let value = resolveValue(profile, key);
    if (value) return { key: key, value: value, source: 'fieldMap' };

    if (/authoriz|eligible.*work|legally.*work|work.*auth|right to work|permitted to work/.test(labLower)) {
      value = resolveValue(profile, 'authorizedToWork');
      if (value) return { key: 'authorizedToWork', value: value, source: 'workAuth' };
    }
    if (/sponsor|visa|require.*sponsor|need.*sponsor/.test(labLower)) {
      value = resolveValue(profile, 'requiresSponsorship');
      if (value) return { key: 'requiresSponsorship', value: value, source: 'sponsorship' };
    }

    if (label && typeof map.answerForLabel === 'function') {
      const looked = map.answerForLabel(profile, label);
      if (looked && !looked.missing && looked.value) {
        return { key: looked.key || 'customAnswers', value: looked.value, source: looked.source || 'answerForLabel' };
      }
    }

    const qa = map.matchCustomQA(profile.customQA, label, descriptor.placeholder);
    if (qa) return { key: 'customQA', value: qa, source: 'customQA' };

    return { key: key || null, value: '', source: null };
  }

  function markAutofilled(el, value) {
    if (!el || !el.setAttribute) return;
    try {
      el.setAttribute(FILLED_ATTR, '1');
      el.setAttribute(FILLED_VALUE_ATTR, String(value == null ? '' : value).slice(0, 500));
    } catch (_e) { /* ignore */ }
  }

  function isDiversityControl(el, label) {
    if (DIVERSITY_RE.test(String(label || ''))) return true;
    if (!el || !el.closest) return false;
    try {
      const section = el.closest(
        'section, fieldset, [class*="eeo" i], [id*="eeo" i], [class*="demographic" i], [id*="demographic" i], [class*="diversity" i], [class*="self-identif" i]'
      );
      if (!section) return false;
      const heading = section.querySelector('h1, h2, h3, h4, legend, .section-header');
      return DIVERSITY_RE.test(textOf(heading || section).slice(0, 400));
    } catch (_e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Custom dropdowns and comboboxes
   * ------------------------------------------------------------------ */

  const DROPDOWN_TRIGGER_SELECTOR = [
    'button[aria-haspopup="listbox"]',
    '[aria-haspopup="listbox"]',
    '[role="combobox"]',
    'button.select__button',
    '.select-style',
    '[class*="select__control"]',
    '[class*="Select__control"]',
    '[data-testid*="select" i]'
  ].join(', ');

  const OPTION_SELECTOR = [
    '[role="option"]',
    '[role="listbox"] li',
    'ul[role="listbox"] li',
    '.select__option',
    '[class*="select__option"]',
    '[class*="Select__option"]',
    'li[data-value]',
    'div[data-value]',
    '[class*="dropdown"] li',
    '[class*="menu"] [role="menuitem"]'
  ].join(', ');

  function findCustomDropdownTriggers(root) {
    return queryAll(DROPDOWN_TRIGGER_SELECTOR, root).filter(function (el) {
      if (el.tagName === 'SELECT') return false;
      return isVisible(el);
    });
  }

  /** Options currently rendered anywhere on the page, including portals. */
  function visibleOptions() {
    return queryAll(OPTION_SELECTOR).filter(isVisible);
  }

  function scoreOption(optionEl, want) {
    const text = normalizeText(textOf(optionEl));
    const dataValue = normalizeText(optionEl.getAttribute && optionEl.getAttribute('data-value'));
    const target = normalizeText(want);
    if (!target) return 0;
    if (text === target || dataValue === target) return 100;
    if (text.indexOf(target) !== -1) return 80;
    if (target.indexOf(text) !== -1 && text.length > 2) return 70;
    if (dataValue && dataValue.indexOf(target) !== -1) return 60;
    if (/^(yes|y)$/.test(target) && /^(yes|y)$/.test(text)) return 90;
    if (/^(no|n)$/.test(target) && /^(no|n)$/.test(text) && !/not sure/.test(text)) return 90;
    return 0;
  }

  /**
   * Open a custom dropdown and pick the matching option.
   *
   * The wait after opening is the whole point: React renders listbox options on
   * a later tick and usually into a portal at <body>, so querying them in the
   * same tick as the click can never find them.
   */
  async function pickFromDropdown(trigger, value, opts) {
    opts = opts || {};
    const D = dom();
    const want = String(value);
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 2500;

    // Country and state listboxes label their options either way round, so an
    // "AE" option still has to be reachable from "United Arab Emirates".
    const wants = [want].concat(selectVariants(want, opts.kind));

    const before = visibleOptions().length;
    realClick(trigger);

    let options = [];
    if (D && D.waitFor) {
      options =
        (await D.waitFor(
          function () {
            const current = visibleOptions();
            return current.length && current.length !== before ? current : null;
          },
          { timeoutMs: timeoutMs, pollMs: 80 }
        )) || [];
    }
    if (!options.length) {
      await sleep(300);
      options = visibleOptions();
    }

    let picked = pickBestOptionAny(options, wants);
    if (!picked) picked = pickByOptionMatch(options, want, opts.kind);

    // Typeahead comboboxes only render matching options once text is entered.
    if (!picked) {
      const input = comboboxInputFor(trigger);
      if (input && D && D.typeInto) {
        await D.typeInto(input, want, { perCharMs: 20 });
        const filtered =
          (await D.waitFor(
            function () {
              const current = visibleOptions();
              return current.length ? current : null;
            },
            { timeoutMs: 2000, pollMs: 80 }
          )) || visibleOptions();
        picked = pickBestOptionAny(filtered, wants);
        if (!picked) picked = pickByOptionMatch(filtered, want, opts.kind);
        if (!picked && filtered.length === 1) picked = filtered[0];
      }
    }

    if (!picked) {
      if (D && D.pressKey) D.pressKey(trigger, 'Escape');
      return { ok: false, reason: 'no_matching_option' };
    }

    realClick(picked);
    await sleep(120);
    return { ok: true, text: textOf(picked).slice(0, 80) };
  }

  function pickBestOption(options, want) {
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < options.length; i++) {
      const score = scoreOption(options[i], want);
      if (score > bestScore) {
        bestScore = score;
        best = options[i];
      }
    }
    return bestScore >= 60 ? best : null;
  }

  function pickBestOptionAny(options, wants) {
    for (let i = 0; i < wants.length; i++) {
      const picked = pickBestOption(options, wants[i]);
      if (picked) return picked;
    }
    return null;
  }

  /** Bucket / level matching over rendered listbox options. */
  function pickByOptionMatch(options, want, kind) {
    const fmt = global.FillApplyFormat;
    if (!fmt || typeof fmt.matchOptionIndex !== 'function' || !options.length) return null;
    const hit = fmt.matchOptionIndex(
      options.map(function (el) {
        return textOf(el);
      }),
      want,
      kind
    );
    return hit ? options[hit.index] : null;
  }

  /** The text input a combobox trigger types into, if it has one. */
  function comboboxInputFor(trigger) {
    if (!trigger) return null;
    if (trigger.tagName === 'INPUT') return trigger;
    let input = null;
    try {
      input = trigger.querySelector('input:not([type="hidden"])');
    } catch (_e) {
      input = null;
    }
    if (input) return input;
    const owns = trigger.getAttribute && (trigger.getAttribute('aria-owns') || trigger.getAttribute('aria-controls'));
    if (owns) {
      const D = dom();
      const escaped = D && D.cssEscape ? D.cssEscape(owns) : owns;
      const panel = queryAll('#' + escaped)[0];
      if (panel) {
        try {
          return panel.querySelector('input:not([type="hidden"])');
        } catch (_e2) {
          return null;
        }
      }
    }
    const container = trigger.closest ? trigger.closest('.field, [class*="field"], [class*="select"]') : null;
    if (container) {
      try {
        return container.querySelector('input:not([type="hidden"])');
      } catch (_e3) {
        return null;
      }
    }
    return null;
  }

  /**
   * Fill custom listbox / combobox widgets (Greenhouse, Ashby, Workday, Lever).
   */
  async function fillCustomDropdowns(profile, map, options) {
    options = options || {};
    const filled = [];
    const triggers = findCustomDropdownTriggers();

    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      const label = (getLabelText(trigger) || trigger.getAttribute('aria-label') || textOf(trigger))
        .replace(/\s+/g, ' ')
        .trim();
      if (!label) continue;
      if (isDiversityControl(trigger, label)) continue;

      const descriptor = {
        label: label,
        name: trigger.getAttribute('name') || '',
        id: trigger.id || '',
        autocomplete: '',
        placeholder: '',
        type: 'select'
      };
      const answer = answerFor(profile, descriptor, map);
      const gate = gateFill(trigger, descriptor, answer);
      if (!answer.value || !gate.ok) continue;

      const fillValue = gate.value != null ? gate.value : answer.value;

      // Already showing the answer — leave it alone.
      const current = normalizeText(textOf(trigger));
      const want = normalizeText(fillValue);
      const isPlaceholder = /select|choose|—|--|please/.test(current);
      if (current === want || (!isPlaceholder && current && current.indexOf(want) !== -1)) {
        filled.push({ label: label, key: answer.key, value: fillValue, already: true });
        continue;
      }

      if (global.FillApplyFocusHud && global.FillApplyFocusHud.mark) {
        global.FillApplyFocusHud.mark(trigger, { scroll: true });
      }

      const fmt = global.FillApplyFormat;
      const result = await pickFromDropdown(
        trigger,
        fillValue,
        Object.assign({}, options, {
          kind: fmt ? fmt.fieldKind(descriptor, answer.key) : null
        })
      );
      if (result.ok) {
        markAutofilled(trigger, fillValue);
        filled.push({ label: label, key: answer.key, value: fillValue, action: 'FILLED' });
      }
    }

    return filled;
  }

  /* ------------------------------------------------------------------ *
   * Documents
   * ------------------------------------------------------------------ */

  /**
   * Put the documents already loaded in the extension onto this page's upload
   * controls. Returns null when the caller supplied none, so a report can tell
   * "nothing to attach" apart from "could not attach".
   */
  async function loadDocumentsFromExtensionStorage() {
    return new Promise(function (resolve) {
      try {
        if (!global.chrome || !chrome.storage || !chrome.storage.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get(['fillApply.documents'], function (bag) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve((bag && bag['fillApply.documents']) || null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  async function ensureRunDocuments(options) {
    options = options || {};
    var docs = options.documents || null;
    if (docs && (docs.resume || docs.cover)) return docs;
    var stored = await loadDocumentsFromExtensionStorage();
    if (stored && (stored.resume || stored.cover)) {
      options.documents = stored;
      return stored;
    }
    return docs;
  }

  async function attachStoredDocuments(options) {
    options = options || {};
    const documents = (await ensureRunDocuments(options)) || options.documents;
    const files = global.FillApplyFiles;
    if (!documents || !files) return null;
    if (!documents.resume && !documents.cover) return null;

    const hints = options.fileInputHints || [];
    try {
      if (typeof files.attachDocumentsAsync === 'function') {
        return await files.attachDocumentsAsync(documents, hints, {
          timeoutMs: options.documentWaitMs
        });
      }
      return files.attachDocuments(documents, hints);
    } catch (e) {
      return {
        ok: false,
        attached: [],
        alreadyAttached: [],
        rejected: [],
        errors: [String((e && e.message) || e)],
        pending: ['resume', 'cover'],
        needsManual: true,
        resumeAttached: false,
        coverAttached: false
      };
    }
  }

  /* ------------------------------------------------------------------ *
   * Apply-start
   * ------------------------------------------------------------------ */

  /**
   * Open-application step: on a job overview, click Apply-start once.
   * Allowed in fill, ready, AND submit (opening is not final submit).
   */
  function tryOpenApplication(options) {
    options = options || {};
    if (options.skipApplyStart) return null;
    const syn = global.FillApplySynonyms;
    if (!syn || typeof syn.tryClickApplyStart !== 'function') return null;

    const open = syn.tryClickApplyStart(document, {
      minFields: options.minOpenFormFields
    });
    if (!open || !open.clicked) return null;
    if (open.el && global.FillApplyFocusHud && global.FillApplyFocusHud.mark) {
      global.FillApplyFocusHud.mark(open.el, { scroll: true });
    }

    return {
      ok: true,
      clickedApplyStart: true,
      reDetect: true,
      handedOff: true,
      deferToPageAdapter: true,
      externalApply: false,
      filled: 0,
      unmatched: 0,
      total: 0,
      submitted: false,
      message:
        'Clicked "' +
        (open.text || 'Apply') +
        '" to open the application — waiting to re-detect / fill',
      applyStartText: open.text || '',
      applyStartReason: open.reason || 'clicked'
    };
  }

  /**
   * Click Apply and wait for the form to appear in this same page.
   *
   * Most Apply buttons open a modal or expand a section rather than navigating.
   * Waiting here means one pass fills the form instead of handing back to the
   * runner for a full re-injection round trip.
   */
  async function openApplicationAndWait(options) {
    options = options || {};
    const syn = global.FillApplySynonyms;
    const D = dom();
    const opened = tryOpenApplication(options);
    if (!opened) return { clicked: false, formOpen: false };

    if (!syn || !D || !D.waitFor) return { clicked: true, formOpen: false, opened: opened };

    const appeared = await D.waitFor(
      function () {
        if (syn.isApplicationFormOpen(document, options.minOpenFormFields)) return true;
        if (syn.findApplicationModalRoot && syn.findApplicationModalRoot(document)) return true;
        return null;
      },
      { timeoutMs: options.applyOpenTimeoutMs != null ? options.applyOpenTimeoutMs : 4000, pollMs: 150 }
    );

    return { clicked: true, formOpen: !!appeared, opened: opened };
  }

  /* ------------------------------------------------------------------ *
   * Main entry point
   * ------------------------------------------------------------------ */


  /** ~10s no-progress plateau (not absolute lifetime). Progress = fill/select/dependent/nav/upload/new control. */
  function createProgressTracker(limitMs) {
    var limit = limitMs != null ? limitMs : 10000;
    var last = Date.now();
    return {
      touch: function () {
        last = Date.now();
      },
      timedOut: function () {
        return Date.now() - last >= limit;
      },
      idleMs: function () {
        return Date.now() - last;
      }
    };
  }

  async function run(profile, options) {
    options = options || {};
    profile = profile || {};
    var progress = createProgressTracker(
      options.progressPlateauMs != null
        ? options.progressPlateauMs
        : (global.FillApplyTypes && global.FillApplyTypes.PROGRESS_PLATEAU_MS) || 10000
    );
    progress.touch();
    if (global.FillApplyKnowledge && profile.__adaptiveKnowledge) {
      global.FillApplyKnowledge.hydrate(profile.__adaptiveKnowledge);
    }
    const highlightUnmatched = !!options.highlightUnmatched;
    const map = global.FillApplyFieldMap;
    const syn = global.FillApplySynonyms;
    const D = dom();
    if (!map) {
      return { ok: false, error: 'FillApplyFieldMap not loaded', filled: 0, unmatched: 0 };
    }

    const Signup = global.FillApplySignupLogin;
    const hasCreds =
      (Signup && Signup.profileHasCredentials && Signup.profileHasCredentials(profile)) ||
      !!(
        profile.password ||
        (profile.customAnswers && profile.customAnswers.password)
      );
    allowPasswordFill = !!hasCreds;
    allowLoginFormFill = !!hasCreds;

    let signupPrep = null;
    if (Signup && typeof Signup.prepareSignupOrLogin === 'function') {
      try {
        signupPrep = await Signup.prepareSignupOrLogin(document, profile, {
          setValue: function (el, v, ctx) {
            return setNativeValue(el, v, ctx || { profile: profile });
          },
          waitMs: 400
        });
      } catch (_signupErr) {
        signupPrep = { ok: false, error: String(_signupErr && _signupErr.message) };
      }
      if (signupPrep && signupPrep.pause) {
        allowPasswordFill = false;
        allowLoginFormFill = false;
        return {
          ok: false,
          needsHuman: true,
          pauseReason: signupPrep.pauseReason || 'auth_wall',
          error: signupPrep.detail || 'Sign in / register required — complete manually (no profile password)',
          filled: 0,
          unmatched: 0,
          total: 0,
          submitted: false,
          signupLogin: signupPrep
        };
      }
    }

    // Give a slow SPA a moment to render its form before deciding anything.
    if (D && D.waitFor && syn) {
      await D.waitFor(
        function () {
          if (syn.isApplicationFormOpen(document, options.minOpenFormFields)) return true;
          if (syn.findApplyStartButtons(document).length) return true;
          return null;
        },
        { timeoutMs: options.formWaitMs != null ? options.formWaitMs : 3000, pollMs: 150 }
      );
    }

    let formSignals = syn && syn.scoreApplicationForm ? syn.scoreApplicationForm(document) : null;
    let applyStart = null;

    if (!(formSignals && formSignals.open)) {
      const openResult = await openApplicationAndWait(options);
      if (openResult.clicked) {
        applyStart = openResult.opened;
        if (!openResult.formOpen) {
          // Form did not appear here — the page is probably navigating or
          // handing off. Let the runner re-detect on the destination.
          return applyStart;
        }
        formSignals = syn && syn.scoreApplicationForm ? syn.scoreApplicationForm(document) : formSignals;
      }
    }

    let fields = collectFields();

    if (!fields.length) {
      // A step whose only control is the resume upload is still work we can do.
      const uploadOnly = await attachStoredDocuments(options);
      if (uploadOnly && (uploadOnly.attached.length || uploadOnly.alreadyAttached.length)) {
        return {
          ok: true,
          filled: 0,
          unmatched: 0,
          total: 0,
          submitted: false,
          filesAttached: uploadOnly,
          documentStep: true,
          formSignals: formSignals,
          inspection: summarizeInspection(inspectForm())
        };
      }

      const startButtons = syn && syn.findApplyStartButtons ? syn.findApplyStartButtons(document) : [];
      return {
        ok: false,
        error: startButtons.length
          ? 'Apply button found but the application form did not open'
          : 'No application form fields found on this page',
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        filesAttached: uploadOnly,
        formSignals: formSignals,
        inspection: summarizeInspection(inspectForm())
      };
    }

    const inspection = inspectForm();
    clearHighlights();

    // A form with its own country-code control needs the national number in the
    // phone box; one without it needs the full international number.
    function pageHasIntlTelCountryWidget(root) {
      try {
        var scope = root || document;
        if (scope.querySelector && scope.querySelector('.iti, .iti__flag-container, [class*="iti__"]')) {
          return true;
        }
        var buttons = scope.querySelectorAll
          ? scope.querySelectorAll('button[aria-label*="country" i], button[aria-label*="Selected country" i]')
          : [];
        for (var bi = 0; bi < buttons.length; bi++) {
          var btn = buttons[bi];
          var wrap = btn.closest ? btn.closest('div, form, label, span') : null;
          if (wrap && wrap.querySelector && wrap.querySelector('input[type="tel"], input[type="phone"]')) {
            return true;
          }
        }
      } catch (_e) {}
      return false;
    }

    const hasPhoneCountryField =
      pageHasIntlTelCountryWidget(document) ||
      fields.some(function (el) {
        const fmt = global.FillApplyFormat;
        const descriptor = D && D.describeField ? D.describeField(el) : legacyDescriptor(el);
        if (descriptorLooksLikePhoneCountry(descriptor, el)) return true;
        return !!fmt && fmt.fieldKind(descriptor, null) === 'phoneCountry';
      });

    let filled = 0;
    let unmatched = 0;
    const details = [];
    const skipped = [];
    const missingRequired = [];
    const unknownFields = [];
    const C = global.FillApplyKnowledgeCanonical;

    function pushUnknown(descriptor, el, reason) {
      const label = descriptor.label || descriptor.question || descriptor.ariaLabel || descriptor.name || descriptor.id || '';
      if (!label) return;
      const controlType = controlTypeOf(el, descriptor);
      const opts = optionsForControl(el, descriptor);
      const identified =
        C && C.resolveFromEvidence && C.buildEvidence
          ? C.resolveFromEvidence(
              C.buildEvidence(
                Object.assign({}, descriptor, { controlType: controlType, options: opts }),
                el
              ),
              { fieldType: controlType }
            )
          : C && C.matchCanonical
            ? C.matchCanonical(descriptor.question || descriptor.label || '', { fieldType: controlType })
            : null;
      const knowledgeType =
        (identified && identified.fieldType) ||
        (C && C.inferFieldType ? C.inferFieldType(el, descriptor) : 'string');
      const row = {
        label: label,
        name: descriptor.name || '',
        id: descriptor.id || '',
        required: !!descriptor.required,
        controlType: controlType,
        knowledgeType: knowledgeType,
        options: opts,
        canonicalKey: (identified && identified.key) || null,
        semanticKey: (identified && (identified.semanticKey || identified.key)) || null,
        matchedEvidence: identified && identified.matchedEvidence,
        candidateKeys: (identified && identified.candidateKeys) || [],
        reason: (identified && identified.ambiguous ? identified.reason : null) || reason || 'unknown'
      };
      unknownFields.push(row);
      if (descriptor.required) {
        missingRequired.push(label);
      }
    }

    // Prefer CV/Resume import CTAs before filling remaining gaps.
    let cvImport = { clicked: false, text: '' };
    if (!options.skipCvImport) {
      cvImport = await tryClickCvImport(options);
      if (cvImport.clicked) {
        fields = collectFields();
      }
    }

    for (let i = 0; i < fields.length; i++) {
      const el = fields[i];
      const descriptor = D && D.describeField ? D.describeField(el) : legacyDescriptor(el);
      const label = descriptor.label || '';

      if (shouldSkipDiversity(el, label, profile)) {
        skipped.push({ label: label, reason: 'voluntary_self_identification' });
        continue;
      }

      const type = String(descriptor.type || '').toLowerCase();

      // Gender is select/radio/combobox only — never free-text.
      if (isGenderField(label) && !isGenderChoiceControl(el, descriptor)) {
        skipped.push({ label: label, reason: 'gender_requires_select', required: descriptor.required });
        unmatched += 1;
        pushUnknown(descriptor, el, 'gender_requires_select');
        highlight(el, 'unmatched');
        details.push(
          Object.assign(unmatchedDetail(descriptor, 'gender_requires_select'), {
            controlType: controlTypeOf(el, descriptor),
            action: 'DO_NOT_FILL',
            canonicalKey: 'gender'
          })
        );
        continue;
      }

      if (type === 'checkbox' && isConsentCheckbox(el, label)) {
        // Hilton-style and global: tick consent so Ready/Submit can press Next.
        if (!el.checked) {
          const ok = setNativeValue(el, 'Yes', { key: 'consent', profile: profile });
          if (ok !== false && el.checked) {
            filled += 1;
            markAutofilled(el, 'Yes');
            highlight(el, 'filled');
            details.push(
              Object.assign(filledDetail(descriptor, { key: 'consent', value: 'Yes', source: 'consentPolicy' }), {
                controlType: 'checkbox',
                knowledgeType: 'boolean',
                action: 'FILLED',
                canonicalKey: 'consent'
              })
            );
          } else {
            skipped.push({ label: label, reason: 'consent_checkbox_failed', required: descriptor.required });
            if (descriptor.required) missingRequired.push(label || 'consent checkbox');
          }
        } else {
          markAutofilled(el, 'Yes');
          details.push(
            Object.assign(filledDetail(descriptor, { key: 'consent', value: 'Yes', source: 'consentPolicy' }), {
              controlType: 'checkbox',
              knowledgeType: 'boolean',
              action: 'FILLED',
              canonicalKey: 'consent',
              already: true
            })
          );
        }
        continue;
      }

      if (isComboboxInput(el)) {
        const answer = answerFor(profile, descriptor, map);
        const gate = gateFill(el, Object.assign({}, descriptor, { type: 'combobox', combobox: true }), answer);
        if (!answer.value || !gate.ok) {
          unmatched += 1;
          pushUnknown(descriptor, el, gate.reason || 'unknown');
          details.push(
            Object.assign(unmatchedDetail(descriptor, gate.reason || 'no_profile_value'), {
              controlType: gate.controlType || 'combobox',
              action: 'DO_NOT_FILL',
              canonicalKey: answer.canonicalKey || null
            })
          );
          highlight(el, 'unmatched');
          continue;
        }
        const fillValue = gate.value != null ? gate.value : answer.value;
        const picked = await pickFromDropdown(el, fillValue, options);
        if (picked.ok) {
          filled += 1;
          markAutofilled(el, fillValue);
          highlight(el, 'filled');
          details.push(
            Object.assign(filledDetail(descriptor, Object.assign({}, answer, { value: fillValue })), {
              controlType: 'combobox',
              action: 'FILLED',
              canonicalKey: answer.canonicalKey || answer.key
            })
          );
        } else {
          // Combobox with no matching option — do NOT free-text force
          unmatched += 1;
          pushUnknown(descriptor, el, 'combobox_no_option');
          details.push(
            Object.assign(unmatchedDetail(descriptor, 'combobox_no_option'), {
              controlType: 'combobox',
              action: 'DO_NOT_FILL',
              canonicalKey: answer.canonicalKey || null
            })
          );
        }
        continue;
      }

      const answer = answerFor(profile, descriptor, map);
      const gate = gateFill(el, descriptor, answer);

      if (!answer.value || !gate.ok) {
        unmatched += 1;
        pushUnknown(descriptor, el, gate.reason || 'unknown');
        highlight(el, 'unmatched');
        details.push(
          Object.assign(unmatchedDetail(descriptor, gate.reason || answer.reason || 'no_profile_value'), {
            controlType: gate.controlType || controlTypeOf(el, descriptor),
            knowledgeType: gate.knowledgeType || answer.fieldType || null,
            action: 'DO_NOT_FILL',
            canonicalKey: answer.canonicalKey || answer.semanticKey || answer.key || null,
            semanticKey: answer.semanticKey || answer.canonicalKey || null,
            selectedKey: answer.semanticKey || answer.canonicalKey || answer.key || null,
            matchedEvidence: answer.matchedEvidence || null,
            candidateKeys: answer.candidateKeys || [],
            source: answer.source || null,
            confidence: answer.confidence != null ? answer.confidence : null,
            reason: gate.reason || answer.reason || 'no_profile_value'
          })
        );
        continue;
      }

      if (global.FillApplyFocusHud && global.FillApplyFocusHud.mark) {
        global.FillApplyFocusHud.mark(el, { scroll: true });
      }

      const fillValue = gate.value != null ? gate.value : answer.value;
      const setOk = setNativeValue(el, fillValue, {
        key: answer.key,
        profile: profile,
        hasPhoneCountryField: hasPhoneCountryField,
        label: descriptor.label || label || '',
        descriptor: descriptor,
        formats:
          (answer.record && answer.record.formats) ||
          (answer.formats) ||
          null
      });
      if (setOk === false) {
        unmatched += 1;
        pushUnknown(descriptor, el, 'value_rejected');
        details.push(
          Object.assign(unmatchedDetail(descriptor, 'value_rejected'), {
            controlType: gate.controlType,
            action: 'DO_NOT_FILL',
            canonicalKey: answer.canonicalKey || answer.key || null
          })
        );
        highlight(el, 'unmatched');
        continue;
      }

      filled += 1;
      progress.touch();
      markAutofilled(el, fillValue);
      highlight(el, 'filled');
      details.push(
        Object.assign(filledDetail(descriptor, Object.assign({}, answer, { value: fillValue })), {
          controlType: gate.controlType,
          knowledgeType: gate.knowledgeType || answer.fieldType || null,
          action: 'FILLED',
          canonicalKey: answer.canonicalKey || answer.semanticKey || answer.key || null,
          semanticKey: answer.semanticKey || answer.canonicalKey || null,
          selectedKey: answer.semanticKey || answer.canonicalKey || answer.key || null,
          matchedEvidence: answer.matchedEvidence || null,
          candidateKeys: answer.candidateKeys || [],
          source: answer.source || null,
          confidence: answer.confidence != null ? answer.confidence : null,
          resolution: answer.source || null,
          reason: answer.reason || gate.reason || null
        })
      );

      if (options.pauseBetweenFieldsMs) await sleep(options.pauseBetweenFieldsMs);
    }

    // Dependent fields: after fills that reveal follow-ups, wait + re-scan once.
    let phase = 'VALIDATING';
    let dependentPasses = 0;
    const maxDependentPasses = options.maxDependentPasses != null ? options.maxDependentPasses : 2;
    while (dependentPasses < maxDependentPasses) {
      if (progress.timedOut()) {
        phase = 'TIMEOUT';
        break;
      }
      phase = 'WAITING_FOR_DEPENDENT_FIELDS';
      if (options.onPhase) {
        try {
          options.onPhase(phase, { pass: dependentPasses + 1 });
        } catch (_p) {
          /* ignore */
        }
      }
      await sleep(options.dependentWaitMs != null ? options.dependentWaitMs : 350);
      const nextFields = collectFields();
      const prevIds = {};
      fields.forEach(function (f, idx) {
        prevIds[f.id || f.name || 'i' + idx] = true;
      });
      const newcomers = nextFields.filter(function (f, idx) {
        const id = f.id || f.name || 'i' + idx;
        return !prevIds[id] && !f.getAttribute(FILLED_ATTR);
      });
      if (!newcomers.length) break;
      progress.touch();
      dependentPasses += 1;
      phase = 'FILLING';
      fields = nextFields;
      for (let di = 0; di < newcomers.length; di++) {
        const el = newcomers[di];
        const descriptor = D && D.describeField ? D.describeField(el) : legacyDescriptor(el);
        if (shouldSkipDiversity(el, descriptor.label || '', profile)) continue;
        const answer = answerFor(profile, descriptor, map);
        const gate = gateFill(el, descriptor, answer);
        if (!answer.value || !gate.ok) {
          unmatched += 1;
          pushUnknown(descriptor, el, gate.reason || 'unknown');
          continue;
        }
        const fillValue = gate.value != null ? gate.value : answer.value;
        const setOk = setNativeValue(el, fillValue, {
          key: answer.key,
          profile: profile,
          hasPhoneCountryField: hasPhoneCountryField,
          label: descriptor.label || '',
          descriptor: descriptor
        });
        if (setOk === false) {
          unmatched += 1;
          pushUnknown(descriptor, el, 'value_rejected');
          continue;
        }
        filled += 1;
        progress.touch();
        markAutofilled(el, fillValue);
        highlight(el, 'filled');
        details.push(
          Object.assign(filledDetail(descriptor, Object.assign({}, answer, { value: fillValue })), {
            controlType: gate.controlType,
            action: 'FILLED',
            dependentPass: dependentPasses
          })
        );
      }
    }
    phase = missingRequired.length ? 'MISSING_INFORMATION' : 'VALIDATING';

    const customFilled = await fillCustomDropdowns(profile, map, options);
    filled += customFilled.filter(function (c) {
      return !c.already;
    }).length;

    // Documents the applicant loaded into the extension go on now, so the
    // upload step never asks them to find the file again.
    const filesAttached = await attachStoredDocuments(options);
    if (filesAttached && filesAttached.needsManual) {
      filesAttached.errors.forEach(function (message) {
        skipped.push({ label: 'document upload', reason: 'document_type_rejected', detail: message });
      });
    }

    const applicationFields = [];
    details.forEach(function (d) {
      if (d && d.ok && (d.label || d.key)) {
        applicationFields.push({ label: d.label || d.key, key: d.key, value: d.value });
      }
    });
    customFilled.forEach(function (c) {
      if (!c) return;
      applicationFields.push({ label: c.label || c.key || 'dropdown', key: c.key || null, value: c.value });
    });

    // Labels for Missing Info UI: ALL unknowns (required + optional), not required-only
    const unknownLabels = [];
    const seenU = {};
    unknownFields.forEach(function (u) {
      const lab = u && u.label;
      if (!lab || seenU[lab]) return;
      seenU[lab] = true;
      unknownLabels.push(lab);
    });

    const blockers = [];
    if (filesAttached && filesAttached.needsManual) {
      blockers.push({
        type: 'file',
        message: (filesAttached.errors && filesAttached.errors[0]) || 'Document upload needs manual action'
      });
    }
    unknownFields.forEach(function (u) {
      if (u && u.required && u.reason === 'file_not_configured') {
        blockers.push({ type: 'file', message: u.label || 'Required file', reason: u.reason });
      }
    });
    const runPhase =
      phase === 'TIMEOUT' || progress.timedOut()
        ? 'TIMEOUT'
        : blockers.length
          ? 'BLOCKED'
          : missingRequired.length
            ? 'MISSING_INFORMATION'
            : 'READY';

    return {
      ok: true,
      filled: filled,
      unmatched: unmatched,
      total: fields.length,
      phase: runPhase,
      dependentPasses: dependentPasses,
      blockers: blockers,
      cvImportClicked: !!(cvImport && cvImport.clicked),
      cvImportText: (cvImport && cvImport.text) || '',
      details: details,
      skipped: skipped,
      signupLogin: signupPrep,
      missingRequired: dedupe(missingRequired),
      unknownFields: unknownFields,
      // Prefer rich unknown discovery for Complete Missing Information
      missingProfileFields: unknownLabels.length ? unknownLabels : undefined,
      customDropdownsFilled: customFilled,
      applicationFields: applicationFields,
      applicationReport: { fields: applicationFields, steps: [] },
      filesAttached: filesAttached,
      resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
      coverAttached: !!(filesAttached && filesAttached.coverAttached),
      formSignals: formSignals,
      clickedApplyStart: !!applyStart,
      inspection: summarizeInspection(inspection),
      debugResolutions: details.map(function (d) {
        return C && C.inspectResolution
          ? C.inspectResolution({
              question: d.label || d.question,
              semanticKey: d.semanticKey || d.canonicalKey || d.key,
              canonicalKey: d.canonicalKey || d.semanticKey || d.key,
              knowledgeType: d.knowledgeType || d.fieldType,
              domControlType: d.controlType || d.type,
              controlType: d.controlType || d.type,
              candidateKeys: d.candidateKeys || [],
              selectedKey: d.selectedKey || d.semanticKey || d.canonicalKey || d.key,
              matchedEvidence: d.matchedEvidence || null,
              source: d.source || d.resolution,
              value: d.value,
              resolution: d.resolution || d.source,
              confidence: d.confidence,
              action: d.action || (d.ok ? 'FILLED' : 'DO_NOT_FILL'),
              reason: d.reason
            })
          : d;
      })
    };
  }

  function legacyDescriptor(el) {
    return {
      autocomplete: el.getAttribute('autocomplete') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: getLabelText(el),
      question: getLabelText(el),
      ariaLabel: (el.getAttribute('aria-label') || '').trim(),
      groupContext: '',
      placeholder: el.getAttribute('placeholder') || '',
      type: String(el.type || el.tagName || '').toLowerCase(),
      required: isRequiredField(el)
    };
  }

  function filledDetail(descriptor, answer) {
    return {
      ok: true,
      key: answer.key,
      name: descriptor.name || descriptor.id,
      label: descriptor.label || answer.key || descriptor.name || descriptor.id,
      type: descriptor.type,
      required: !!descriptor.required,
      source: answer.source,
      value: String(answer.value).slice(0, 500),
      canonicalKey: answer.canonicalKey || answer.semanticKey || null,
      semanticKey: answer.semanticKey || answer.canonicalKey || null,
      knowledgeType: answer.fieldType || null,
      matchedEvidence: answer.matchedEvidence || null,
      candidateKeys: answer.candidateKeys || [],
      selectedKey: answer.semanticKey || answer.canonicalKey || answer.key || null,
      confidence: answer.confidence,
      action: answer.action || 'FILLED',
      reason: answer.reason || null
    };
  }

  function unmatchedDetail(descriptor, reason) {
    return {
      ok: false,
      key: null,
      name: descriptor.name || descriptor.id || String(descriptor.label || '').slice(0, 40),
      label: descriptor.label || descriptor.name || descriptor.id || '',
      type: descriptor.type,
      required: !!descriptor.required,
      reason: reason || 'no_profile_value',
      action: 'DO_NOT_FILL'
    };
  }

  function dedupe(list) {
    const seen = {};
    return (list || []).filter(function (item) {
      const key = String(item);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function summarizeInspection(inspection) {
    if (!inspection) return null;
    return {
      counts: inspection.counts,
      selectCount: inspection.counts.select,
      fileCount: inspection.counts.file,
      attachButtonCount: inspection.counts.attachButton,
      customDropdownCount: inspection.counts.customDropdown,
      requiredCount: inspection.counts.required,
      buttons: inspection.buttons.slice(0, 12)
    };
  }

  /* ------------------------------------------------------------------ *
   * Navigation
   * ------------------------------------------------------------------ */

  /**
   * Click Next/Continue/Review but never final Submit/Apply (for runMode=ready).
   * Prefers [data-fill-apply="continue"] when JobPool/host stamped it.
   */
  function clickContinueButtons() {
    const clicked = [];
    const syn = global.FillApplySynonyms;

    if (syn && typeof syn.findContinueButtons === 'function') {
      const ranked = syn.findContinueButtons(document) || [];
      for (let r = 0; r < ranked.length; r++) {
        const btn = ranked[r];
        if (!btn || btn.disabled) continue;
        const text = syn.buttonText ? syn.buttonText(btn) : textOf(btn);
        if (syn.isExcludedApplyCta && syn.isExcludedApplyCta(text)) continue;
        if (syn.isFinalSubmitCta && syn.isFinalSubmitCta(text) && !(syn.isContinueDataCta && syn.isContinueDataCta(btn))) {
          continue;
        }
        if (realClick(btn)) {
          clicked.push((text || 'Continue').slice(0, 40));
          break;
        }
      }
      if (clicked.length) return clicked;
    }

    const buttons = queryAll(
      'button, input[type="button"], input[type="submit"], a[role="button"], a.button, [role="button"], [data-fill-apply="continue"]'
    );
    const continueRe =
      (syn && syn.CONTINUE_CTA) ||
      /\b(next|continue|save and continue|save & continue|review)\b/i;
    const isApply = syn && syn.isApplyCta
      ? syn.isApplyCta
      : function (t) {
          return /\b(submit application|apply now|apply for this|submit & apply|apply)\b/i.test(t);
        };
    const isCont =
      syn && syn.isContinueCta
        ? syn.isContinueCta
        : function (t) {
            return continueRe.test(t);
          };

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (btn.disabled) continue;
      const marked = syn && syn.isContinueDataCta && syn.isContinueDataCta(btn);
      if (!marked && !isVisible(btn)) continue;
      const text = syn && syn.buttonText ? syn.buttonText(btn) : textOf(btn);
      if (!text && !marked) continue;
      if (syn && syn.isExcludedApplyCta && syn.isExcludedApplyCta(text)) continue;
      if (!marked && isApply(text) && !continueRe.test(text)) continue;
      if (marked || isCont(text) || continueRe.test(text)) {
        if (realClick(btn)) {
          clicked.push((text || 'Continue').slice(0, 40));
          break; // one step at a time
        }
      }
    }
    return clicked;
  }

  /**
   * Click final Submit/Apply when confidently found (runMode=submit).
   * Prefers [data-fill-apply="submit"] when stamped.
   */
  function clickSubmitButtons(submitSelector) {
    const syn = global.FillApplySynonyms;

    if (submitSelector) {
      const nodes = queryAll(submitSelector);
      for (let s = 0; s < nodes.length; s++) {
        const btn = nodes[s];
        if (btn && !btn.disabled && isVisible(btn)) {
          if (realClick(btn)) return true;
        }
      }
    }

    if (syn && typeof syn.findSubmitButtons === 'function') {
      const ranked = syn.findSubmitButtons(document) || [];
      const formOpenEarly =
        syn && typeof syn.isApplicationFormOpen === 'function'
          ? syn.isApplicationFormOpen(document)
          : true;
      for (let r = 0; r < ranked.length; r++) {
        const btn = ranked[r];
        if (!btn || btn.disabled) continue;
        const text = syn.buttonText ? syn.buttonText(btn) : textOf(btn);
        if (syn.isExcludedApplyCta && syn.isExcludedApplyCta(text)) continue;
        if (
          !formOpenEarly &&
          syn.isApplyStartCta &&
          syn.isApplyStartCta(text) &&
          !(syn.isFinalSubmitCta && syn.isFinalSubmitCta(text)) &&
          !(syn.isSubmitDataCta && syn.isSubmitDataCta(btn))
        ) {
          continue;
        }
        if (realClick(btn)) return true;
      }
    }

    const isApply = syn && syn.isApplyCta ? syn.isApplyCta : function (t) {
      return /\b(submit application|submit & apply|apply now|apply for this|send application|apply)\b/i.test(t);
    };
    const buttons = queryAll(
      'button[type="submit"], input[type="submit"], button, input[type="button"], a[role="button"], [role="button"], [data-fill-apply="submit"]'
    );
    const formOpen =
      syn && typeof syn.isApplicationFormOpen === 'function' ? syn.isApplicationFormOpen(document) : true;
    const isExcluded =
      syn && syn.isExcludedApplyCta
        ? syn.isExcludedApplyCta
        : function (t) {
            return /\b(auto[- ]?apply|upgrade|subscribe)\b/i.test(t);
          };

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (btn.disabled) continue;
      const markedSubmit = syn && syn.isSubmitDataCta && syn.isSubmitDataCta(btn);
      if (!markedSubmit && !isVisible(btn)) continue;
      const text = syn && syn.buttonText ? syn.buttonText(btn) : textOf(btn);
      if (isExcluded(text)) continue;
      // If form not open yet, leave Apply-start to tryOpenApplication — do not "submit" overview CTAs
      if (
        !formOpen &&
        !markedSubmit &&
        syn &&
        syn.isApplyStartCta &&
        syn.isApplyStartCta(text) &&
        !(syn.isFinalSubmitCta && syn.isFinalSubmitCta(text))
      ) {
        continue;
      }
      if (
        markedSubmit ||
        isApply(text) ||
        /submit_app|submit-app|btn-submit|btn-apply/i.test(btn.id + ' ' + btn.className)
      ) {
        if (/\bnext\b|\bcontinue\b|\breview\b/i.test(text) && !/\bsubmit\b|\bapply\b/i.test(text) && !markedSubmit) {
          continue;
        }
        if (realClick(btn)) return true;
      }
    }
    return false;
  }

  /**
   * Attach one stored document to a specific file input. Adapters that locate
   * their own resume input (Glassdoor, Indeed) call this directly.
   */
  function attachFileInput(input, documents, kind) {
    if (!input || !documents) return false;
    const F = global.FillApplyFiles;
    if (!F || !F.assignFilesToInput || !F.fileFromBase64) return false;
    const doc = documents[kind] || (kind === 'resume' ? documents.resume : documents.cover);
    if (!doc || !doc.base64) return false;
    const file = F.fileFromBase64(
      doc.base64,
      doc.name || (kind === 'cover' ? 'cover-letter.pdf' : 'resume.pdf'),
      doc.mime || 'application/pdf'
    );
    const result = F.assignFilesToInput(input, file);
    return !!(result && result.ok);
  }

  global.__fillApply = {
    isGenderField: isGenderField,
    allowPasswordFill: function () { return allowPasswordFill; },
    isGenderChoiceControl: isGenderChoiceControl,
    isConsentCheckbox: isConsentCheckbox,
    tryClickCvImport: tryClickCvImport,
    CONSENT_RE: CONSENT_RE,
    CV_IMPORT_RE: CV_IMPORT_RE,
    shouldSkipDiversity: shouldSkipDiversity,
    optionsLookLikeDialCodes: optionsLookLikeDialCodes,
    descriptorLooksLikePhoneCountry: descriptorLooksLikePhoneCountry,
    run: run,
    inspectForm: inspectForm,
    collectFields: collectFields,
    clearHighlights: clearHighlights,
    matchSelectOption: matchSelectOption,
    fillCustomDropdowns: fillCustomDropdowns,
    pickFromDropdown: pickFromDropdown,
    clickContinueButtons: clickContinueButtons,
    clickSubmitButtons: clickSubmitButtons,
    createProgressTracker: createProgressTracker,
    tryOpenApplication: tryOpenApplication,
    openApplicationAndWait: openApplicationAndWait,
    attachFileInput: attachFileInput,
    getLabelText: getLabelText,
    isRequiredField: isRequiredField,
    isComboboxInput: isComboboxInput,
    sanitizeForInput: sanitizeForInput,
    setNativeValue: setNativeValue,
    controlTypeOf: controlTypeOf,
    gateFill: gateFill,
    numericAmount: function (s) {
      if (global.FillApplyProfile && global.FillApplyProfile.numericAmount) {
        return global.FillApplyProfile.numericAmount(s);
      }
      return sanitizeForInput({ type: 'number' }, s).value;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
