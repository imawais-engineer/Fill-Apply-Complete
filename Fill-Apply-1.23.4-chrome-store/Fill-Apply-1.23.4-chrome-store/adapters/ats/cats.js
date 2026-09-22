/**
 * CATS (catsone.com) ATS adapter — often reached via We Work Remotely (and other
 * boards) when "Apply now" opens an external company careers page "Powered by CATS".
 *
 * Real apply form fields (operator paste):
 *   Upload Resume * (file / drop / paste / browse) → DataTransfer resume
 *   First Name *, Last Name *, Email *, City *, Country *, Phone *
 *   LinkedIn Profile *, Portfolio (optional), Expected Pay Rate (optional)
 *   Are you willing and available to work within the EST timezone? * Yes/No
 *   Submit Application
 *   Footer: Powered by CATS
 *
 * Modes: fill / ready = fields only (no Submit); submit clicks Submit Application.
 * Paste additional CATS DOM selectors later for further hardening.
 */
(function (global) {
  'use strict';

  var HOSTS = ['catsone.com', 'www.catsone.com'];
  var HOST_RE = /(^|\.)catsone\.com$/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /catsone\.com/i.test(u.hostname)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/catsone\.com/i.test(url)) return true;
    }
    if (doc) {
      try {
        var text = ((doc.body && doc.body.innerText) || '').slice(0, 8000);
        if (/powered by\s*cats/i.test(text)) return true;
        if (
          doc.querySelector(
            '[class*="cats"], [id*="cats"], a[href*="catsone.com"], img[alt*="CATS" i], footer a[href*="catsone"]'
          )
        ) {
          return true;
        }
      } catch (_e2) {}
    }
    return false;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
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
    return (
      String((el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) || '')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || '').slice(0, 12000) : '';
    } catch (_e) {
      return '';
    }
  }

  function isAiAutoApply(t) {
    return /ai\s*auto[- ]?apply|auto[- ]?apply\s*with\s*ai|auto[- ]?apply\s*ai/i.test(String(t || ''));
  }

  /**
   * Open Application tab / Apply Now on company CATS career pages (not WWR AI Auto-Apply).
   */
  function ensureApplicationView(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"], [role="tab"]'
    );
    var applyBtn = null;
    var appTab = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || isAiAutoApply(t)) continue;
      if (/^application$/i.test(t) || (/\bapplication\b/i.test(t) && t.length < 28)) {
        appTab = el;
      }
      if (/^apply now$/i.test(t) || /apply for this (job|position)/i.test(t) || /^apply$/i.test(t)) {
        applyBtn = el;
        break;
      }
    }
    if (applyBtn) {
      try {
        applyBtn.click();
      } catch (_e) {}
      return { clicked: true, kind: 'apply' };
    }
    if (appTab) {
      try {
        appTab.click();
      } catch (_e2) {}
      return { clicked: true, kind: 'tab' };
    }
    return { clicked: false };
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var str = String(value == null ? '' : value);
    try {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      if (el.tagName === 'TEXTAREA') proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function labelFor(el, doc) {
    doc = doc || document;
    if (!el) return '';
    try {
      if (el.id) {
        var esc = el.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        try {
          if (typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(el.id);
        } catch (_eEsc) {}
        var lab = doc.querySelector('label[for="' + esc + '"]');
        if (lab) return buttonText(lab);
      }
      var p = el.closest('label, .form-group, .field, [class*="field"], [class*="Form"]');
      if (p) return buttonText(p).slice(0, 200);
    } catch (_e) {}
    return String(el.getAttribute('aria-label') || el.name || el.placeholder || '');
  }

  function profileVal(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') return String(profile[key]).trim();
    if (key === 'portfolio') {
      return String(profile.portfolio || profile.website || '').trim();
    }
    if (key === 'phone') {
      var cc = String(profile.phoneCountry || '').trim();
      var ph = String(profile.phone || '').trim();
      if (cc && ph && ph.indexOf('+') !== 0) return (cc + ' ' + ph).trim();
      return ph;
    }
    return '';
  }

  function customAnswer(profile, patterns) {
    var map = (profile && profile.customAnswers) || {};
    var keys = Object.keys(map);
    var qa = Array.isArray(profile && profile.customQA) ? profile.customQA : [];
    var i;
    for (i = 0; i < patterns.length; i++) {
      var re = patterns[i];
      for (var k = 0; k < keys.length; k++) {
        if (re.test(keys[k]) && map[keys[k]] != null && String(map[keys[k]]).trim() !== '') {
          return String(map[keys[k]]).trim();
        }
      }
      for (var q = 0; q < qa.length; q++) {
        var row = qa[q];
        if (row && re.test(String(row.question || '')) && row.answer != null && String(row.answer).trim() !== '') {
          return String(row.answer).trim();
        }
      }
    }
    return '';
  }

  function matchField(el, doc) {
    var blob = norm(
      [labelFor(el, doc), el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ')
    );
    if (/resume|cv|curriculum|upload.*file|attach.*file/.test(blob) && (el.type === 'file' || /file/.test(blob))) {
      return 'resume';
    }
    if (/first\s*name|given\s*name|fname/.test(blob)) return 'firstName';
    if (/last\s*name|family\s*name|surname|lname/.test(blob)) return 'lastName';
    if (/e-?mail/.test(blob)) return 'email';
    if (/^city$|\bcity\b/.test(blob) && !/timezone|country/.test(blob)) return 'city';
    if (/\bcountry\b/.test(blob)) return 'country';
    if (/\bphone\b|\bmobile\b|\btel\b/.test(blob)) return 'phone';
    if (/linkedin/.test(blob)) return 'linkedin';
    if (/portfolio|personal\s*site|website|github/.test(blob) && !/linkedin/.test(blob)) return 'portfolio';
    if (/expected\s*pay|pay\s*rate|salary|compensation|rate\s*of\s*pay/.test(blob)) return 'payRate';
    if (/est\s*timezone|eastern|willing.*available.*work.*timezone|timezone/.test(blob)) return 'estTimezone';
    return null;
  }

  function fillYesNo(doc, wantYes) {
    var text = pageText(doc);
    if (!/est|eastern|timezone|willing and available/i.test(text)) return false;
    var groups = doc.querySelectorAll('fieldset, [role="radiogroup"], [role="group"], .form-group, label, div');
    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      var gt = buttonText(g).slice(0, 240);
      if (!/est|eastern|timezone|willing and available/i.test(gt)) continue;
      var inputs = g.querySelectorAll('input[type="radio"], input[type="checkbox"], button, [role="radio"]');
      var j;
      for (j = 0; j < inputs.length; j++) {
        var inp = inputs[j];
        var it = norm(buttonText(inp) || inp.value || labelFor(inp, doc));
        var isYes = /^(yes|y|true|1)$/i.test(it) || /\byes\b/.test(it);
        var isNo = /^(no|n|false|0)$/i.test(it) || /\bno\b/.test(it);
        if ((wantYes && isYes) || (!wantYes && isNo)) {
          try {
            inp.click();
          } catch (_e) {}
          if (inp.checked === false && inp.type === 'radio') {
            try {
              inp.checked = true;
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_e2) {}
          }
          return true;
        }
      }
      // Select fallback
      var sel = g.querySelector('select');
      if (sel) {
        var opts = sel.options;
        for (var o = 0; o < opts.length; o++) {
          var ot = norm(opts[o].text || opts[o].value);
          if ((wantYes && /\byes\b/.test(ot)) || (!wantYes && /\bno\b/.test(ot))) {
            sel.selectedIndex = o;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  }

  function attachResume(documents) {
    var Files = global.FillApplyFiles;
    if (!Files || !documents || !documents.resume) {
      return { ok: false, resumeAttached: false, attached: [], errors: ['No resume document'] };
    }
    var hints = [
      {
        kind: 'resume',
        match: 'resume|cv|curriculum|upload',
        selector: 'input[type=file]'
      }
    ];
    if (typeof Files.attachDocuments === 'function') {
      var r = Files.attachDocuments(documents, hints);
      return r || { ok: false, resumeAttached: false, attached: [], errors: [] };
    }
    return { ok: false, resumeAttached: false, attached: [], errors: ['FillApplyFiles.attachDocuments missing'] };
  }

  function clickSubmit(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (isAiAutoApply(t)) continue;
      if (/submit\s*application/i.test(t) || /^submit$/i.test(t) || /^apply$/i.test(t)) {
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    var fb = doc.querySelector(
      'button[type="submit"], input[type="submit"], .submit-application, #submit_application'
    );
    if (fb && visible(fb)) {
      try {
        fb.click();
        return true;
      } catch (_e2) {}
    }
    return false;
  }

  var FIELD_MAPS = [
    { key: 'firstName', labels: ['first name'], names: ['firstname', 'first_name', 'fname'] },
    { key: 'lastName', labels: ['last name'], names: ['lastname', 'last_name', 'lname'] },
    { key: 'email', labels: ['email'], names: ['email'] },
    { key: 'city', labels: ['city'], names: ['city'] },
    { key: 'country', labels: ['country'], names: ['country'] },
    { key: 'phone', labels: ['phone'], names: ['phone', 'telephone', 'mobile'] },
    { key: 'linkedin', labels: ['linkedin profile', 'linkedin'], names: ['linkedin'] },
    { key: 'portfolio', labels: ['portfolio'], names: ['portfolio', 'website'] }
  ];

  var adapter = {
    id: 'cats',
    name: 'CATS',
    category: 'ats',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: FIELD_MAPS,
    submitSelector:
      'button[type="submit"], input[type="submit"], button.submit, .submit-application, #submit_application',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|upload', selector: 'input[type=file]' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = ctx.document || (typeof document !== 'undefined' ? document : null);
      var profile = ctx.profile || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

      return Promise.resolve().then(async function () {
        if (!doc) {
          return {
            ok: false,
            adapterId: 'cats',
            error: 'No document',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        ensureApplicationView(doc);
        await sleep(400 + Math.floor(Math.random() * 300));

        var filesAttached = attachResume(ctx.documents || {});
        var filled = 0;
        var unmatched = 0;
        var total = 0;

        var inputs = doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
        var i;
        for (i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          if (!visible(el)) continue;
          if (String(el.type || '').toLowerCase() === 'file') continue;
          var key = matchField(el, doc);
          if (!key) continue;
          total++;
          var value = '';
          if (key === 'payRate') {
            value = customAnswer(profile, [
              /expected\s*pay/i,
              /pay\s*rate/i,
              /salary/i,
              /compensation/i
            ]);
          } else if (key === 'estTimezone') {
            continue; // handled via Yes/No below
          } else {
            value = profileVal(profile, key);
          }
          if (!value) {
            unmatched++;
            continue;
          }
          if (el.tagName === 'SELECT') {
            var opts = el.options;
            var matched = false;
            var o;
            for (o = 0; o < opts.length; o++) {
              if (norm(opts[o].text).indexOf(norm(value)) !== -1 || norm(opts[o].value) === norm(value)) {
                el.selectedIndex = o;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                matched = true;
                break;
              }
            }
            if (matched) filled++;
            else unmatched++;
          } else {
            if (setNativeValue(el, value)) filled++;
            else unmatched++;
          }
        }

        var estAnswer =
          customAnswer(profile, [
            /est\s*timezone/i,
            /eastern/i,
            /willing.*available.*timezone/i,
            /timezone/i
          ]) || 'Yes';
        var wantYes = /^(yes|y|true|1)$/i.test(estAnswer);
        if (fillYesNo(doc, wantYes)) filled++;

        // Heuristic fallback for anything still empty
        var fb = global.FillApplyFallbackAdapter;
        var fbResult = null;
        if (fb && typeof fb.fill === 'function') {
          fbResult = fb.fill(
            Object.assign({}, ctx, {
              adapterId: 'cats',
              submitSelector: adapter.submitSelector,
              fileInputHints: adapter.fileInputHints,
              fieldMaps: adapter.fieldMaps.concat(FIELD_MAPS),
              documents: {}, // already attached resume
              runMode: 'fill', // never let fallback submit; we own Submit Application
              autoSubmit: false
            })
          );
          if (fbResult && typeof fbResult.then === 'function') fbResult = await fbResult;
          if (fbResult) {
            filled += Number(fbResult.filled) || 0;
            unmatched += Number(fbResult.unmatched) || 0;
            total += Number(fbResult.total) || 0;
          }
        }

        var submitted = false;
        if (runMode === 'submit') {
          submitted = clickSubmit(doc);
          await sleep(300);
        }

        return {
          ok: true,
          adapterId: 'cats',
          filled: filled,
          unmatched: unmatched,
          total: total || filled + unmatched,
          submitted: submitted,
          runMode: runMode,
          resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
          coverAttached: !!(filesAttached && filesAttached.coverAttached),
          filesAttached: filesAttached,
          message: submitted
            ? 'CATS: submitted application'
            : 'CATS: filled application fields (Powered by CATS)'
        };
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_catsAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
