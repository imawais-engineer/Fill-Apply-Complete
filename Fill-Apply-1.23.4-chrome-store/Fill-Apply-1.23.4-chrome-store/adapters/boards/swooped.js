/**
 * Swooped adapter (board) — **assisted-apply intermediary**, not a primary ATS.
 *
 * Often reached from **Jooble** (and similar aggregators) after Apply. UI chrome
 * includes Find Jobs / Auto Apply / Track Jobs / Resumes / Cover Letters / Upgrade,
 * job filters, company job detail, **Prepare Application**, and **Apply Agent**.
 *
 * Fill & Apply policy:
 * 1. Prefer **Apply manually instead** when present BEFORE entering the Swooped
 *    auto-packet path — then hand off to the employer ATS if the host changes.
 * 2. If already in Prepare Application / Apply Agent workspace:
 *    - Upload stored resume via DataTransfer when a file input is present
 *    - Resume style: prefer **Focused & Impactful** / "Choose focused resume"
 *      unless profile.resumeStyle / customAnswers say comprehensive
 *    - Wait for "Application packet ready"
 *    - Fill **Needs Input** fields from profile + customAnswers; click **Save Answer**
 *    - Skip EEO/diversity (never invent)
 *    - fill/ready: do NOT click Autofill & Submit; submit mode may after requireds
 * 3. Never click Upgrade / paid Auto Apply product features.
 * 4. paidSource: false unless Upgrade/subscription wall blocks → pause (never purchase).
 *
 * See docs/APPLICATION_GUIDE.md → "Jooble → Swooped / external ATS".
 */
(function (global) {
  'use strict';

  var HOSTS = ['swooped.co', 'www.swooped.co', 'app.swooped.co'];
  var HOST_RE = /(^|\.)swooped\.co$/i;

  var CONTENT_MARKERS = [
    /auto\s*apply/i,
    /prepare\s*application/i,
    /apply\s*manually\s*instead/i,
    /we'?ll\s*build\s*your\s*entire\s*application/i,
    /upload\s*your\s*resume/i,
    /application\s*packet\s*ready/i,
    /apply\s*agent/i,
    /needs\s*input/i
  ];

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || '').slice(0, 16000) : '';
    } catch (_e) {
      return '';
    }
  }

  function contentLooksLikeSwooped(doc) {
    var text = pageText(doc);
    if (!text) return false;
    var hits = 0;
    for (var i = 0; i < CONTENT_MARKERS.length; i++) {
      if (CONTENT_MARKERS[i].test(text)) hits++;
    }
    return hits >= 2;
  }

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /swooped\.co/i.test(url)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/swooped\.co/i.test(url)) return true;
    }
    if (doc && contentLooksLikeSwooped(doc)) return true;
    return false;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function humanDelay(base) {
    var b = typeof base === 'number' ? base : 400;
    return b + Math.floor(Math.random() * 350);
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_*-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function visible(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    } catch (_e) {
      return true;
    }
  }

  function buttonText(el) {
    return String(
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function currentHostname() {
    try {
      return String((typeof location !== 'undefined' && location.hostname) || '');
    } catch (_e) {
      return '';
    }
  }

  function isSwoopedHost(hostname) {
    return /swooped\.co/i.test(String(hostname || ''));
  }

  function resolveHref(el) {
    if (!el) return '';
    try {
      var raw =
        el.href ||
        el.getAttribute('href') ||
        el.getAttribute('data-href') ||
        el.getAttribute('data-url') ||
        '';
      if (!raw || raw === '#' || /^javascript:/i.test(raw)) return '';
      return new URL(raw, typeof location !== 'undefined' ? location.href : undefined).href;
    } catch (_e) {
      return '';
    }
  }

  function detectUpgradePaywall(doc, text) {
    text = text || pageText(doc);
    if (
      /upgrade\s*(to|your|plan|now)?/i.test(text) &&
      /subscription|billing|\$\s*\d|per\s*month|premium|pro plan/i.test(text)
    ) {
      return true;
    }
    if (
      /unlock\s*(auto\s*apply|unlimited|premium)/i.test(text) &&
      /\$\s*\d|subscribe|upgrade/i.test(text)
    ) {
      return true;
    }
    return false;
  }

  function isAutoApplyOrUpgradeText(t) {
    return /^(auto\s*apply|upgrade|upgrade\s*now|buy\s*credits|subscribe|get\s*premium|start\s*free\s*trial)$/i.test(
      String(t || '').trim()
    ) || /paid\s*auto\s*apply|unlock\s*auto\s*apply/i.test(String(t || ''));
  }

  function isBuildPacketCta(t) {
    return /build\s*(your\s*)?(entire\s*)?application|we'?ll\s*build|auto[- ]?build|generate\s*(resume|cover|application)/i.test(
      String(t || '')
    );
  }

  function isEeoLabel(lab) {
    return /diversity|eeo|equal opportunity|race|ethnicity|gender|veteran|disability|sexual orientation|lgbt|transgender|hispanic|latino|voluntary self.?identif|decline to (self-)?identify|prefer not to/i.test(
      String(lab || '')
    );
  }

  /**
   * Prefer "Apply manually instead" — never Auto Apply / Upgrade / auto-build.
   */
  function findManualApplyControl(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"], span, div'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || t.length > 80) continue;
      if (isAutoApplyOrUpgradeText(t) || isBuildPacketCta(t)) continue;
      var score = 0;
      if (/apply\s*manually\s*instead/i.test(t)) score = 100;
      else if (/apply\s*manually/i.test(t)) score = 90;
      else if (/manual\s*apply/i.test(t)) score = 85;
      else if (/continue\s*without\s*(swooped|auto)/i.test(t)) score = 80;
      else if (/skip\s*(auto|assisted)/i.test(t)) score = 70;
      if (score > 0 && score < 90) {
        var tag = (el.tagName || '').toLowerCase();
        if (tag !== 'a' && tag !== 'button' && el.getAttribute('role') !== 'button') {
          var parent = el.closest && el.closest('a, button, [role="button"]');
          if (parent && visible(parent)) el = parent;
          else if (tag === 'span' || tag === 'div') {
            if (score < 90) continue;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function findClickableByText(doc, re, opts) {
    opts = opts || {};
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"], label, span, div'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || t.length > 120) continue;
      if (!opts.allowAutoApply && (isAutoApplyOrUpgradeText(t) || /^upgrade/i.test(t))) continue;
      if (!re.test(t)) continue;
      var score = Math.min(100, 40 + (120 - t.length));
      if (opts.exact && re.test(t) && t.length < 40) score += 20;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') score += 15;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function inAgentWorkspace(doc, text) {
    text = text || pageText(doc);
    return (
      /needs\s*input/i.test(text) ||
      /apply\s*agent/i.test(text) ||
      /application\s*packet\s*ready/i.test(text) ||
      (/queue/i.test(text) && /needs\s*input/i.test(text))
    );
  }

  function inPrepareFlow(doc, text) {
    text = text || pageText(doc);
    return (
      /prepare\s*application/i.test(text) ||
      /we'?ll\s*build\s*your\s*entire\s*application/i.test(text) ||
      /upload\s*your\s*resume/i.test(text) ||
      /focused\s*&\s*impactful|choose\s*focused\s*resume|comprehensive/i.test(text)
    );
  }

  function wantsComprehensiveResume(profile) {
    profile = profile || {};
    var style = String(
      profile.resumeStyle ||
        profile.resumeTone ||
        (profile.customAnswers &&
          (profile.customAnswers.resumeStyle ||
            profile.customAnswers['resume style'] ||
            profile.customAnswers['Resume style'])) ||
        ''
    ).toLowerCase();
    return /comprehensive|detailed|full/i.test(style);
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    if (key === 'fullName') {
      return String(
        profile.fullName ||
          [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
          ''
      ).trim();
    }
    if (key === 'location') {
      if (profile.location) return String(profile.location).trim();
      var parts = [profile.city, profile.state, profile.country].filter(Boolean);
      return parts.join(', ');
    }
    if (key === 'phone') {
      var phone = String(profile.phone || '').trim();
      var cc = String(profile.phoneCountry || '').trim();
      if (cc && phone && phone.indexOf('+') !== 0) return (cc + ' ' + phone).trim();
      return phone;
    }
    return profile[key] != null ? String(profile[key]).trim() : '';
  }

  function answerFromCustom(profile, label) {
    var lab = norm(label);
    if (!lab) return null;
    var map = profile && profile.customAnswers;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      var keys = Object.keys(map);
      var best = null;
      var bestScore = 0;
      for (var i = 0; i < keys.length; i++) {
        var k = norm(keys[i]);
        if (!k) continue;
        if (lab.indexOf(k) !== -1 || k.indexOf(lab) !== -1) {
          var score = Math.min(k.length, lab.length);
          if (score > bestScore) {
            bestScore = score;
            best = map[keys[i]];
          }
        }
      }
      if (best != null && String(best).trim() !== '') return String(best).trim();
    }
    if (global.FillApplyFieldMap && global.FillApplyFieldMap.matchCustomQA) {
      var qa = global.FillApplyFieldMap.matchCustomQA(profile && profile.customQA, label, '');
      if (qa) return qa;
    }
    return null;
  }

  function resolveAnswer(profile, label) {
    var lab = norm(label);
    var custom = answerFromCustom(profile, label);
    if (custom != null) return custom;

    if (/first\s*name/.test(lab)) return profileValue(profile, 'firstName');
    if (/last\s*name|surname|family\s*name/.test(lab)) return profileValue(profile, 'lastName');
    if (/^name$|full\s*name|your\s*name/.test(lab) && !/first|last|company|user/.test(lab)) {
      return profileValue(profile, 'fullName');
    }
    if (/e-?mail/.test(lab)) return profileValue(profile, 'email');
    if (/phone|mobile|tel/.test(lab)) return profileValue(profile, 'phone');
    if (/linkedin/.test(lab)) return profileValue(profile, 'linkedin');
    if (
      /location|city|where\s*(are|do)\s*you\s*(live|based)|primary\s*work\s*location|located\s*in/.test(
        lab
      )
    ) {
      return profileValue(profile, 'location') || profileValue(profile, 'city');
    }
    if (/salary|ote|compensation|expected\s*(pay|comp)|first\s*year/.test(lab)) {
      return (
        answerFromCustom(profile, label) ||
        answerFromCustom(profile, 'salary') ||
        answerFromCustom(profile, 'OTE') ||
        answerFromCustom(profile, 'Salary expectation') ||
        ''
      );
    }
    if (/saudi\s*arabia/.test(lab)) {
      var loc = norm(profileValue(profile, 'location') + ' ' + profileValue(profile, 'country'));
      if (/saudi/.test(loc)) return 'Yes';
      var c = answerFromCustom(profile, label);
      if (c != null) return c;
      return loc ? 'No' : '';
    }
    if (/legally\s*authorized|authorized\s*to\s*work|right\s*to\s*work|work\s*authorization/.test(lab)) {
      return profileValue(profile, 'authorizedToWork') || '';
    }
    if (/visa\s*sponsorship|require[s]?\s*sponsorship|need\s*sponsorship/.test(lab)) {
      return profileValue(profile, 'requiresSponsorship') || '';
    }
    if (/work\s*auth(orization)?\s*basis|auth(orization)?\s*expir|visa\s*expir|if\s*yes/.test(lab)) {
      var basis = answerFromCustom(profile, label);
      if (basis != null) return basis;
      var needs = norm(profileValue(profile, 'requiresSponsorship'));
      if (/^(no|n|false|0)$/i.test(needs)) return 'N/A';
      return answerFromCustom(profile, 'work authorization') || '';
    }
    if (/ofac|sanctioned\s*countr|citizen.*sanction|resident.*sanction/.test(lab)) {
      return answerFromCustom(profile, label) || '';
    }
    return '';
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);

    if (type === 'checkbox' || type === 'radio') {
      var want = /^(yes|y|true|1|on)$/i.test(str);
      if (type === 'radio') {
        // handled by option clickers
        return false;
      }
      if (el.checked !== want) {
        el.checked = want;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    if (tag === 'select') {
      var opts = el.options || [];
      var nWant = norm(str);
      var bestIdx = -1;
      for (var i = 0; i < opts.length; i++) {
        var ot = norm(opts[i].text || opts[i].value);
        if (!ot) continue;
        if (ot === nWant || ot.indexOf(nWant) !== -1 || nWant.indexOf(ot) !== -1) {
          bestIdx = i;
          break;
        }
      }
      if (bestIdx >= 0) {
        el.selectedIndex = bestIdx;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    try {
      var proto =
        tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function clickYesNoNear(container, wantYes) {
    var nodes = (container || document).querySelectorAll(
      'button, [role="button"], label, input[type="radio"], span, div'
    );
    var wantRe = wantYes ? /^(yes|y)$/i : /^(no|n)$/i;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (wantRe.test(t) && t.length < 8) {
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    return false;
  }

  function getQuestionLabel(el) {
    if (!el) return '';
    try {
      if (el.id) {
        var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return buttonText(byFor);
      }
    } catch (_e) {}
    var parentLabel = el.closest && el.closest('label');
    if (parentLabel) return buttonText(parentLabel);
    var card =
      el.closest &&
      el.closest(
        '[class*="question"], [class*="field"], [class*="input"], [data-question], section, fieldset, li, article, form, div'
      );
    if (card) {
      var heading = card.querySelector(
        'label, legend, h1, h2, h3, h4, [class*="label"], [class*="title"], p, span'
      );
      if (heading) {
        var ht = buttonText(heading);
        if (ht && ht.length < 200) return ht;
      }
      // First strong text node snippet
      var raw = buttonText(card).split('\n')[0] || buttonText(card);
      if (raw && raw.length < 200) return raw;
    }
    return el.getAttribute('aria-label') || el.placeholder || el.name || '';
  }

  function findSaveAnswerButton(near) {
    var root = near && near.closest ? near.closest('form, section, article, li, div') || document : document;
    var nodes = root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (/^save\s*answer$/i.test(t) || /save\s*answer/i.test(t)) return el;
    }
    // Global fallback
    return findClickableByText(document, /^save\s*answer$/i, { exact: true });
  }

  function makeFile(Files, doc, fallbackName) {
    if (!Files || !doc || !doc.base64) return null;
    return Files.fileFromBase64(doc.base64, doc.name || fallbackName, doc.mime || 'application/pdf');
  }

  function attachStoredResume(documents) {
    var Files = global.FillApplyFiles;
    var resumeFile = makeFile(Files, documents && documents.resume, 'resume.pdf');
    if (!resumeFile || !Files) {
      return { ok: false, resumeAttached: false };
    }
    var inputs = document.querySelectorAll('input[type="file"]');
    var attached = false;
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var hint = (
        (input.name || '') +
        ' ' +
        (input.id || '') +
        ' ' +
        (input.getAttribute('accept') || '') +
        ' ' +
        getQuestionLabel(input)
      ).toLowerCase();
      if (/resume|cv|curriculum|pdf|document|upload/.test(hint) || inputs.length === 1) {
        var r = Files.assignFilesToInput(input, resumeFile);
        if (r && r.ok) attached = true;
      }
    }
    return { ok: attached, resumeAttached: attached };
  }

  function humanPause(error, extra) {
    return Object.assign(
      {
        ok: false,
        adapterId: 'swooped',
        needsHuman: true,
        pauseReason: 'challenge',
        paidSource: false,
        error: error,
        filled: 0,
        unmatched: 0,
        total: 0
      },
      extra || {}
    );
  }

  function handoffResult(extra) {
    return Object.assign(
      {
        ok: true,
        adapterId: 'swooped',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        paidSource: false,
        message: 'Left Swooped via Apply manually instead — continue with destination ATS adapter'
      },
      extra || {}
    );
  }

  function tryDestinationFill(ctx) {
    var registry = global.FillApplyRegistry;
    if (!registry || typeof registry.detect !== 'function') return null;
    var href = '';
    try {
      href = String((typeof location !== 'undefined' && location.href) || '');
    } catch (_e) {}
    var next = registry.detect(href, typeof document !== 'undefined' ? document : null);
    if (!next || next.id === 'swooped' || next.id === 'fallback') {
      var fb = global.FillApplyFallbackAdapter;
      if (fb && typeof fb.fill === 'function') {
        var fr = fb.fill(
          Object.assign({}, ctx, {
            adapterId: 'fallback',
            url: href
          })
        );
        if (fr && typeof fr === 'object') {
          fr.externalApply = true;
          fr.handedOff = true;
          fr.fromAdapter = 'swooped';
        }
        return fr;
      }
      return null;
    }
    if (typeof next.fill !== 'function') return null;
    return next.fill(
      Object.assign({}, ctx, {
        adapterId: next.id,
        submitSelector: next.submitSelector,
        fileInputHints: next.fileInputHints,
        fieldMaps: next.fieldMaps,
        url: href
      })
    );
  }

  async function chooseFocusedResume(doc, profile) {
    var comprehensive = wantsComprehensiveResume(profile);
    var re = comprehensive
      ? /comprehensive|choose\s*comprehensive|detailed\s*resume/i
      : /focused\s*&\s*impactful|choose\s*focused\s*resume|focused\s*resume|impactful/i;
    var el = findClickableByText(doc, re, { exact: false });
    if (el) {
      try {
        el.click();
      } catch (_e) {}
      await sleep(humanDelay(500));
      return true;
    }
    // Default path: also try card titles
    if (!comprehensive) {
      el = findClickableByText(doc, /focused/i, {});
      if (el) {
        try {
          el.click();
        } catch (_e2) {}
        await sleep(humanDelay(500));
        return true;
      }
    }
    return false;
  }

  async function waitForPacketReady(doc, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      var text = pageText(doc);
      if (/application\s*packet\s*ready/i.test(text)) return true;
      if (/needs\s*input/i.test(text) || /apply\s*agent/i.test(text)) return true;
      await sleep(700);
    }
    return /application\s*packet\s*ready|needs\s*input|apply\s*agent/i.test(pageText(doc));
  }

  async function fillNeedsInputFields(ctx) {
    var profile = (ctx && ctx.profile) || {};
    var doc = (ctx && ctx.document) || document;
    var filled = 0;
    var unmatched = 0;
    var total = 0;
    var savedAnswers = 0;
    var missingLabels = [];

    var fields = doc.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!visible(el)) continue;
      var label = getQuestionLabel(el);
      if (!label) continue;
      if (isEeoLabel(label)) continue; // never invent EEO
      total++;
      var answer = resolveAnswer(profile, label);
      if (!answer) {
        unmatched++;
        missingLabels.push(String(label).replace(/\s+/g, ' ').trim().slice(0, 80));
        continue;
      }
      var type = String(el.type || '').toLowerCase();
      if (type === 'radio') {
        var wantYes = /^(yes|y|true|1)$/i.test(answer);
        var wantNo = /^(no|n|false|0|n\/a)$/i.test(answer);
        if (wantYes || wantNo) {
          if (clickYesNoNear(el.closest('fieldset, section, div, li, form') || doc, wantYes)) {
            filled++;
          } else {
            unmatched++;
          }
        } else if (setNativeValue(el, answer)) {
          filled++;
        } else unmatched++;
      } else if (setNativeValue(el, answer)) {
        filled++;
      } else {
        unmatched++;
        continue;
      }

      await sleep(humanDelay(250));
      var saveBtn = findSaveAnswerButton(el);
      if (saveBtn) {
        try {
          saveBtn.click();
          savedAnswers++;
          await sleep(humanDelay(400));
        } catch (_e) {}
      }
    }

    // Also click Yes/No style cards that aren't bound to inputs we saw
    var textBlocks = doc.querySelectorAll('h1, h2, h3, h4, label, p, [class*="question"]');
    for (var j = 0; j < textBlocks.length; j++) {
      var block = textBlocks[j];
      if (!visible(block)) continue;
      var q = buttonText(block);
      if (!q || q.length > 180 || q.length < 8) continue;
      if (isEeoLabel(q)) continue;
      var ans = resolveAnswer(profile, q);
      if (!ans) continue;
      if (/^(yes|no|n\/a)$/i.test(String(ans).trim())) {
        var container = block.closest('section, article, li, div, form') || block.parentElement;
        var yn = /^(yes|y)$/i.test(String(ans).trim());
        if (/^n\/a$/i.test(String(ans).trim())) {
          // try to fill nearby text input with N/A
          var nearInput =
            container &&
            container.querySelector('input:not([type="radio"]):not([type="checkbox"]), textarea');
          if (nearInput && visible(nearInput)) {
            setNativeValue(nearInput, 'N/A');
            filled++;
            total++;
            var sb = findSaveAnswerButton(nearInput);
            if (sb) {
              try {
                sb.click();
                savedAnswers++;
                await sleep(humanDelay(350));
              } catch (_e2) {}
            }
          }
          continue;
        }
        if (clickYesNoNear(container, yn)) {
          filled++;
          total++;
          await sleep(humanDelay(250));
          var sb2 = findSaveAnswerButton(container);
          if (sb2) {
            try {
              sb2.click();
              savedAnswers++;
              await sleep(humanDelay(350));
            } catch (_e3) {}
          }
        }
      }
    }

    return { filled: filled, unmatched: unmatched, total: total, savedAnswers: savedAnswers, missingLabels: missingLabels };
  }

  function skipEeoSections(doc) {
    doc = doc || document;
    var skipped = 0;
    var nodes = doc.querySelectorAll('button, a, [role="button"], label, input[type="radio"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      var ctxLab = '';
      try {
        var wrap = el.closest('section, fieldset, form, div, li');
        if (wrap) ctxLab = buttonText(wrap).slice(0, 240);
      } catch (_e) {}
      if (!isEeoLabel(t) && !isEeoLabel(ctxLab)) continue;
      if (/prefer not|decline|skip|do not wish|choose not|not to (self-)?identify/i.test(t)) {
        try {
          el.click();
          skipped++;
        } catch (_e2) {}
      }
    }
    // Dedicated Skip buttons near EEO
    var skipBtn = findClickableByText(doc, /^skip$/i, { exact: true });
    if (skipBtn) {
      var around = '';
      try {
        around = buttonText(skipBtn.closest('section, div, form') || skipBtn.parentElement || skipBtn);
      } catch (_e3) {}
      if (isEeoLabel(around) || /diversity|eeo|self-?id|voluntary/i.test(around)) {
        try {
          skipBtn.click();
          skipped++;
        } catch (_e4) {}
      }
    }
    return skipped;
  }

  var adapter = {
    id: 'swooped',
    name: 'Swooped',
    category: 'board',
    hosts: HOSTS,
    paidSource: false,
    assistedApplyIntermediary: true,
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button, a, [role="button"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
      var profile = ctx.profile || {};
      var documents = ctx.documents || {};
      var runMode = ctx.runMode || 'fill';
      var text = pageText(doc);

      return Promise.resolve().then(async function () {
        if (detectUpgradePaywall(doc, text)) {
          return humanPause(
            'Swooped Upgrade / subscription wall detected. Fill & Apply will not purchase plans or use paid Auto Apply. Open the employer apply URL directly, use Apply manually instead if available, or Resume after you leave the paywall.',
            { paywall: true, paidSource: true, pauseReason: 'challenge' }
          );
        }

        var startHost = currentHostname();
        var alreadyInAgent = inAgentWorkspace(doc, text);
        var alreadyPreparing = inPrepareFlow(doc, text);

        // Prefer Apply manually instead BEFORE entering auto-packet — escapes to employer ATS.
        if (!alreadyInAgent) {
          var manualEl = findManualApplyControl(doc);
          var manualHref = resolveHref(manualEl);
          var externalTarget = false;
          if (manualHref) {
            try {
              var au = new URL(manualHref);
              if (au.hostname && !isSwoopedHost(au.hostname)) externalTarget = true;
            } catch (_e2) {}
          }

          if (manualEl) {
            if (externalTarget) {
              try {
                manualEl.click();
              } catch (_e3) {
                try {
                  if (manualHref) location.href = manualHref;
                } catch (_e4) {}
              }
              return handoffResult({
                externalUrl: manualHref,
                message: 'Clicked Apply manually instead — runner will re-detect employer ATS'
              });
            }

            try {
              manualEl.click();
            } catch (_e5) {}
            await sleep(humanDelay(700));

            var hostAfterManual = currentHostname();
            if (
              hostAfterManual &&
              startHost &&
              hostAfterManual !== startHost &&
              !isSwoopedHost(hostAfterManual)
            ) {
              var dest = tryDestinationFill(ctx);
              if (dest && typeof dest.then === 'function') dest = await dest;
              if (dest && typeof dest === 'object') {
                dest.externalApply = true;
                dest.handedOff = true;
                dest.fromAdapter = 'swooped';
                dest.paidSource = false;
                return dest;
              }
              return handoffResult({
                message: 'Left Swooped — continue with destination ATS adapter'
              });
            }

            // Still on Swooped after manual click (maybe new tab) — signal handoff
            text = pageText(doc);
            if (!inAgentWorkspace(doc, text) && !inPrepareFlow(doc, text)) {
              return handoffResult({
                message:
                  'Apply manually instead clicked — if a new tab/host opened, runner/destination ATS should continue. Do not use Swooped Auto Apply.'
              });
            }
          }
        }

        // Re-check paywall after interactions
        text = pageText(doc);
        if (detectUpgradePaywall(doc, text)) {
          return humanPause(
            'Swooped Upgrade / subscription wall detected after interaction. Do not purchase via Fill & Apply — paste the employer ATS URL or choose Apply manually instead, then Resume.',
            { paywall: true, paidSource: true }
          );
        }

        alreadyInAgent = inAgentWorkspace(doc, text);
        alreadyPreparing = inPrepareFlow(doc, text);

        // --- Prepare Application / Agent Workspace path ---
        if (alreadyPreparing || alreadyInAgent) {
          var resumeAttach = { resumeAttached: false };
          if (alreadyPreparing || doc.querySelector('input[type="file"]')) {
            resumeAttach = attachStoredResume(documents);
            await sleep(humanDelay(500));
            await chooseFocusedResume(doc, profile);
            // Confirm / continue after style if present (not Upgrade / Auto Apply)
            var continueBtn = findClickableByText(
              doc,
              /^(continue|next|confirm|use\s*this\s*resume|select)$/i,
              { exact: true }
            );
            if (continueBtn) {
              try {
                continueBtn.click();
              } catch (_e6) {}
              await sleep(humanDelay(600));
            }
            await waitForPacketReady(doc, 22000);
          }

          text = pageText(doc);
          alreadyInAgent = inAgentWorkspace(doc, text) || alreadyInAgent;

          if (alreadyInAgent || /needs\s*input/i.test(text)) {
            var fillStats = await fillNeedsInputFields(ctx);
            skipEeoSections(doc);
            await sleep(humanDelay(300));

            if (
              (runMode === 'ready' || runMode === 'submit') &&
              fillStats.missingLabels &&
              fillStats.missingLabels.length
            ) {
              return {
                ok: false,
                adapterId: 'swooped',
                needsHuman: true,
                pauseReason: 'missing_profile_field',
                missingProfileFields: fillStats.missingLabels,
                filled: fillStats.filled,
                unmatched: fillStats.unmatched,
                total: fillStats.total,
                submitted: false,
                swoopedAgentWorkspace: true,
                error:
                  'Swooped: missing profile field(s): ' +
                  fillStats.missingLabels.join(', ') +
                  ' — fill in Options or on the page, then Resume'
              };
            }

            var submitted = false;
            if (runMode === 'submit') {
              // Only Autofill & Submit after requireds filled — never in fill/ready
              var autofillSubmit = findClickableByText(
                doc,
                /autofill\s*&\s*submit|auto\s*fill\s*&\s*submit|submit\s*application/i,
                {}
              );
              if (autofillSubmit && !isAutoApplyOrUpgradeText(buttonText(autofillSubmit))) {
                // Avoid product "Auto Apply" — Autofill & Submit in Agent Workspace is OK in submit mode
                if (!/^auto\s*apply$/i.test(buttonText(autofillSubmit))) {
                  try {
                    autofillSubmit.click();
                    submitted = true;
                    await sleep(humanDelay(800));
                  } catch (_e7) {}
                }
              }
            }

            return {
              ok: true,
              adapterId: 'swooped',
              filled: fillStats.filled,
              unmatched: fillStats.unmatched,
              total: fillStats.total,
              savedAnswers: fillStats.savedAnswers,
              resumeAttached: !!(resumeAttach && resumeAttach.resumeAttached),
              submitted: submitted,
              paidSource: false,
              swoopedAgentWorkspace: true,
              message:
                runMode === 'submit'
                  ? submitted
                    ? 'Swooped Agent Workspace: Needs Input filled + Autofill & Submit clicked'
                    : 'Swooped Agent Workspace: Needs Input filled; Autofill & Submit not found — review before submit'
                  : 'Swooped Agent Workspace: Needs Input filled + Save Answer (fill/ready — did not click Autofill & Submit)'
            };
          }

          // Preparing but packet not ready / no Needs Input yet
          if (alreadyPreparing && !alreadyInAgent) {
            return humanPause(
              'Swooped Prepare Application: resume/style step done or in progress, but "Application packet ready" / Apply Agent Needs Input not reached yet. Wait for the packet or click Apply manually instead to escape to the employer ATS, then Resume.',
              { swoopedIntermediary: true, pauseReason: 'structure_drift' }
            );
          }
        }

        // Stuck on prepare wall with no manual path and no agent workspace
        if (!findManualApplyControl(doc) && inPrepareFlow(doc, text) && !inAgentWorkspace(doc, text)) {
          return humanPause(
            'Swooped assisted-apply intermediary: Prepare Application / resume-upload wall with no "Apply manually instead" path and no Apply Agent workspace yet. Do not use Swooped Auto Apply or Upgrade. Open the employer ATS apply URL directly, then Resume.',
            { swoopedIntermediary: true, pauseReason: 'structure_drift' }
          );
        }

        // Host change safety net
        var hostNow = currentHostname();
        if (hostNow && startHost && hostNow !== startHost && !isSwoopedHost(hostNow)) {
          var dest2 = tryDestinationFill(ctx);
          if (dest2 && typeof dest2.then === 'function') dest2 = await dest2;
          if (dest2 && typeof dest2 === 'object') {
            dest2.externalApply = true;
            dest2.handedOff = true;
            dest2.fromAdapter = 'swooped';
            return dest2;
          }
          return handoffResult({});
        }

        return humanPause(
          'Swooped assisted-apply intermediary detected. Prefer Apply manually instead to reach the employer ATS. If already in Apply Agent (Needs Input), Resume after the workspace loads. Do not use Auto Apply or Upgrade.',
          { swoopedIntermediary: true, pauseReason: 'structure_drift' }
        );
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_swoopedAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
