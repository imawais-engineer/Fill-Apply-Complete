/**
 * Indeed adapter (board) — multi-step "Apply with Indeed" flow for
 * indeed.com / pk.indeed.com / ae.indeed.com / *.indeed.com.
 *
 * Steps (approx progress %): Contact → Location → Work auth → Resume →
 * Employer questions → Review/Submit.
 *
 * Does NOT auto-click Cloudflare / CAPTCHA. Structure drift (unknown required
 * questions) returns needsHuman so the runner pauses for review.
 *
 * Work auth: prefer Yes when profile.authorizedToWork is Yes-like, or default
 * Yes when applying (user pre-screened / queued the job).
 */
(function (global) {
  'use strict';

  var HOSTS = [
    'indeed.com',
    'www.indeed.com',
    'pk.indeed.com',
    'ae.indeed.com'
  ];
  var HOST_RE = /(^|\.)indeed\.com$/i;

  function detect(url, doc) {
    // Host-only: never claim Indeed on unknown hosts via DOM heuristics
    // (that forced Indeed errors on Parsons/Workday/etc.).
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /indeed\.com/i.test(u.hostname)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/indeed\.com/i.test(url)) return true;
    }
    return false;
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function humanDelay(base) {
    var b = typeof base === 'number' ? base : 450;
    return b + Math.floor(Math.random() * 350);
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
      (el.textContent || '') +
      ' ' +
      (el.value || '') +
      ' ' +
      (el.getAttribute('aria-label') || '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLabelFor(el) {
    if (global.__fillApply && global.__fillApply.getLabelText) {
      return global.__fillApply.getLabelText(el) || '';
    }
    if (el.id) {
      try {
        var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return byFor.textContent.trim();
      } catch (_e) {
        /* ignore */
      }
    }
    var parent = el.closest('label');
    if (parent) return parent.textContent.trim();
    return el.getAttribute('aria-label') || el.placeholder || el.name || '';
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var tag = el.tagName;
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);

    if (type === 'checkbox') {
      var want = /^(yes|y|true|1|on)$/i.test(str);
      if (el.checked !== want) {
        el.checked = want;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    if (type === 'radio') {
      return false; // handled via selectRadio
    }

    if (tag === 'SELECT') {
      if (global.__fillApply && global.__fillApply.matchSelectOption) {
        return !!global.__fillApply.matchSelectOption(el, str);
      }
      var wantL = str.toLowerCase();
      for (var i = 0; i < el.options.length; i++) {
        var opt = el.options[i];
        var t = (opt.textContent || '').trim().toLowerCase();
        var v = String(opt.value || '').toLowerCase();
        if (t === wantL || v === wantL || t.indexOf(wantL) !== -1) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    try {
      var proto =
        tag === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e2) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function selectRadioByLabel(questionRe, yesNo) {
    var wantYes = /^(yes|y|true|1)$/i.test(String(yesNo || 'Yes'));
    var fieldsets = document.querySelectorAll('fieldset, [role="group"], .ia-Questions-item, .question, form div');
    var candidates = [];
    for (var i = 0; i < fieldsets.length; i++) {
      var fs = fieldsets[i];
      var lab = (fs.textContent || '').replace(/\s+/g, ' ').trim();
      if (questionRe.test(lab)) candidates.push(fs);
    }
    if (!candidates.length) {
      // Fall back: any radio whose nearby label matches
      var radios = document.querySelectorAll('input[type="radio"]');
      for (var r = 0; r < radios.length; r++) {
        var wrap = radios[r].closest('fieldset, label, div') || radios[r].parentElement;
        var t = ((wrap && wrap.textContent) || getLabelFor(radios[r]) || '').replace(/\s+/g, ' ');
        if (questionRe.test(t)) candidates.push(wrap);
      }
    }
    for (var c = 0; c < candidates.length; c++) {
      var root = candidates[c];
      var radios2 = root.querySelectorAll('input[type="radio"]');
      for (var j = 0; j < radios2.length; j++) {
        var radio = radios2[j];
        if (!visible(radio) && radio.offsetParent === null) continue;
        var rLab = getLabelFor(radio) || radio.value || '';
        var isYes = /^(yes|y|true|1)$/i.test(rLab.trim()) || /\byes\b/i.test(rLab);
        var isNo = /^(no|n|false|0)$/i.test(rLab.trim()) || /\bno\b/i.test(rLab);
        if ((wantYes && isYes) || (!wantYes && isNo)) {
          try {
            radio.click();
            radio.checked = true;
            radio.dispatchEvent(new Event('input', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } catch (_e) {
            /* ignore */
          }
        }
      }
    }
    return false;
  }

  function findApplyWithIndeedButton(doc) {
    doc = doc || document;
    if (global.FillApplyEasyApplySteps && global.FillApplyEasyApplySteps.findEasyApplyButton) {
      var eaBtn = global.FillApplyEasyApplySteps.findEasyApplyButton(doc, { preferIndeed: true });
      if (eaBtn) return eaBtn;
    }
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (/apply with indeed/i.test(t)) return el;
      if (/^apply$/i.test(t) && /indeed/i.test(el.className + el.id + (el.getAttribute('data-tn-element') || ''))) {
        return el;
      }
      if (/indeed-apply|ia-IndeedApplyButton|indeedApplyButton/i.test(el.className + ' ' + el.id)) {
        return el;
      }
    }
    // data attributes
    var byAttr = doc.querySelector(
      '[data-indeed-apply-jobid], .indeed-apply-button, #indeed-apply-button, button.ia-IndeedApplyButton'
    );
    if (byAttr && visible(byAttr)) return byAttr;
    return null;
  }

  function readProgressPercent(doc) {
    doc = doc || document;
    var text = '';
    try {
      text = (doc.body && doc.body.innerText) || '';
    } catch (_e) {
      text = '';
    }
    var m = text.match(/(\d+)\s*%/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
    var prog = doc.querySelector('[role="progressbar"], .ia-ProgressBar, [aria-valuenow]');
    if (prog) {
      var v = prog.getAttribute('aria-valuenow') || prog.getAttribute('value');
      if (v != null && v !== '') {
        var p = parseInt(v, 10);
        if (!isNaN(p)) return p;
      }
    }
    return null;
  }

  /**
   * Detect Indeed apply flow state on the current document.
   */
  function detectIndeedApplyFlow(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return {
        inFlow: false,
        hasApplyButton: false,
        step: 'unknown',
        progress: null,
        isReview: false,
        isJobPage: false
      };
    }

    var applyBtn = findApplyWithIndeedButton(doc);
    var progress = readProgressPercent(doc);
    var bodyText = '';
    try {
      bodyText = ((doc.body && doc.body.innerText) || '').slice(0, 8000);
    } catch (_e) {
      bodyText = '';
    }
    var low = bodyText.toLowerCase();

    var isContact =
      /first name/i.test(bodyText) && /last name/i.test(bodyText) && (/email/i.test(bodyText) || /phone/i.test(bodyText));
    var isLocation =
      (/postcode|postal|zip/i.test(bodyText) && /city/i.test(bodyText)) ||
      (/street address/i.test(bodyText) && /country/i.test(bodyText));
    var isWorkAuth = /authorized to work/i.test(bodyText) && /visa sponsorship/i.test(bodyText);
    var isResume =
      (/upload (your )?resume|add resume|resume\.pdf|\.pdf\b/i.test(bodyText) &&
        /resume|cv/i.test(bodyText)) ||
      !!doc.querySelector('input[type="file"][accept*="pdf"], input[type="file"][name*="resume"]');
    var isEmployerQs =
      /driving licence|driving license|own car|years? .*(experience|contracting)/i.test(bodyText);
    var isReview =
      /review your application|submit application|looks good|submit your application/i.test(bodyText) ||
      progress === 100;

    var step = 'unknown';
    if (isReview) step = 'review';
    else if (isEmployerQs) step = 'employer_questions';
    else if (isResume && !isContact) step = 'resume';
    else if (isWorkAuth) step = 'work_auth';
    else if (isLocation && !isContact) step = 'location';
    else if (isContact) step = 'contact';
    else if (progress != null) {
      if (progress <= 15) step = 'contact';
      else if (progress <= 35) step = 'location';
      else if (progress <= 45) step = 'work_auth';
      else if (progress <= 55) step = 'resume';
      else if (progress < 100) step = 'employer_questions';
      else step = 'review';
    }

    var inFlow =
      !!applyBtn ||
      step !== 'unknown' ||
      !!doc.querySelector('.ia-BasePage, .ia-ApplyForm, [class*="ia-"], #ia-container') ||
      /apply\.indeed|indeed\.com\/.*apply/i.test(typeof location !== 'undefined' ? location.href : '');

    return {
      inFlow: inFlow,
      hasApplyButton: !!applyBtn,
      applyButton: applyBtn,
      step: step,
      progress: progress,
      isReview: isReview || step === 'review',
      isJobPage: !!applyBtn && step === 'unknown',
      bodySnippet: low.slice(0, 200)
    };
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') return String(profile[key]).trim();
    // Aliases
    if (key === 'postcode' || key === 'zip') {
      return String(profile.postcode || profile.zip || '').trim();
    }
    if (key === 'street' || key === 'streetAddress') {
      return String(profile.street || profile.streetAddress || profile.location || '').trim();
    }
    if (key === 'phoneCountry') {
      return String(profile.phoneCountry || '').trim();
    }
    if (key === 'state') {
      return String(profile.state || profile.province || profile.territory || '').trim();
    }
    return '';
  }

  function answerFromCustom(profile, label) {
    var lab = norm(label);
    if (!lab) return null;

    // customAnswers map (object)
    var map = profile.customAnswers;
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

    // customQA array
    if (global.FillApplyFieldMap && global.FillApplyFieldMap.matchCustomQA) {
      var qa = global.FillApplyFieldMap.matchCustomQA(profile.customQA, label, '');
      if (qa) return qa;
    }
    return null;
  }

  function fillMatchingFields(profile, predicates) {
    var filled = 0;
    var inputs = document.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el) && el.type !== 'hidden') {
        // still try selects that might be opacity-styled
        if (el.tagName !== 'SELECT' && String(el.type).toLowerCase() !== 'checkbox') continue;
      }
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file' || type === 'password') {
        continue;
      }
      if (el.disabled || el.readOnly) continue;
      var label = getLabelFor(el);
      var blob = norm(label + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''));
      for (var p = 0; p < predicates.length; p++) {
        var pred = predicates[p];
        if (pred.match(blob, el)) {
          var val = typeof pred.value === 'function' ? pred.value(profile, el) : pred.value;
          if (val == null || String(val).trim() === '') break;
          if (type === 'radio') break;
          if (setNativeValue(el, val)) filled++;
          break;
        }
      }
    }
    return filled;
  }

  function expectedRequiredForStep(step) {
    switch (step) {
      case 'contact':
        return ['first name', 'last name'];
      case 'location':
        return ['country'];
      case 'work_auth':
        return ['authorized'];
      case 'employer_questions':
        return [];
      default:
        return [];
    }
  }

  function collectRequiredLabels() {
    var labels = [];
    var req = document.querySelectorAll(
      'input[required], select[required], textarea[required], [aria-required="true"]'
    );
    for (var i = 0; i < req.length; i++) {
      var lab = getLabelFor(req[i]);
      if (lab) labels.push(lab.replace(/\s+/g, ' ').trim());
    }
    // Asterisk markers in question text
    var stars = document.querySelectorAll('label, legend, .ia-Questions-item, [class*="Question"]');
    for (var j = 0; j < stars.length; j++) {
      var t = (stars[j].textContent || '').replace(/\s+/g, ' ').trim();
      if (/\*\s*$|\(required\)|\brequired\b/i.test(t) && t.length < 180) {
        labels.push(t);
      }
    }
    return labels;
  }

  function hasStructureDrift(step) {
    var expected = expectedRequiredForStep(step);
    if (!expected.length) return false;
    var required = collectRequiredLabels();
    // Unknown required: required label matches nothing we know how to fill
    var known = [
      /first name/i,
      /last name/i,
      /email/i,
      /phone|mobile|tel/i,
      /country/i,
      /postcode|postal|zip/i,
      /city/i,
      /province|territory|state/i,
      /street|address/i,
      /authorized to work|visa sponsorship/i,
      /driving licen/i,
      /own car|vehicle/i,
      /years?.*(experience|contracting)/i,
      /resume|cv/i,
      /cover/i
    ];
    for (var i = 0; i < required.length; i++) {
      var lab = required[i];
      var matched = false;
      for (var k = 0; k < known.length; k++) {
        if (known[k].test(lab)) {
          matched = true;
          break;
        }
      }
      // Skip if it's a progress/chrome label
      if (/continue|submit|apply|progress/i.test(lab) && lab.length < 40) continue;
      if (!matched && lab.length > 8) {
        return { drifted: true, label: lab };
      }
    }
    return { drifted: false };
  }

  function resumeAlreadyUploaded() {
    var text = '';
    try {
      text = (document.body && document.body.innerText) || '';
    } catch (_e) {
      text = '';
    }
    if (/\.(pdf|docx?|rtf)\b/i.test(text) && /resume|cv/i.test(text)) {
      // Filename shown near resume section
      if (/uploaded|attached|selected|your resume/i.test(text)) return true;
      var fileHints = document.querySelectorAll(
        '[class*="Resume"], [data-testid*="resume"], .ia-ResumeModule, .resume-filename, [class*="filename"]'
      );
      for (var i = 0; i < fileHints.length; i++) {
        if (/\.(pdf|docx?)\b/i.test(fileHints[i].textContent || '')) return true;
      }
    }
    // File input already has files
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var j = 0; j < inputs.length; j++) {
      if (inputs[j].files && inputs[j].files.length > 0) return true;
    }
    return false;
  }

  function clickContinue() {
    if (global.FillApplyEasyApplySteps && global.FillApplyEasyApplySteps.clickContinue) {
      return global.FillApplyEasyApplySteps.clickContinue(document);
    }
    if (global.__fillApply && global.__fillApply.clickContinueButtons) {
      var clicked = global.__fillApply.clickContinueButtons();
      if (clicked && clicked.length) return true;
    }
    var buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (/\b(continue|next|save and continue)\b/i.test(t) && !/\bsubmit application\b/i.test(t)) {
        try {
          btn.click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    return false;
  }

  function clickSubmit() {
    var buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (/\b(submit application|submit your application)\b/i.test(t)) {
        try {
          btn.click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    if (global.__fillApply && global.__fillApply.clickSubmitButtons) {
      return !!global.__fillApply.clickSubmitButtons(
        'button[type="submit"], input[type="submit"]'
      );
    }
    return false;
  }

  function fillContactStep(profile) {
    return fillMatchingFields(profile, [
      {
        match: function (b) {
          return /first name|firstname|given name/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'firstName');
        }
      },
      {
        match: function (b) {
          return /last name|lastname|surname|family name/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'lastName');
        }
      },
      {
        match: function (b) {
          return /e-?mail/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'email');
        }
      },
      {
        match: function (b, el) {
          return (
            (/phone|mobile|tel/.test(b) && !/country/.test(b)) ||
            String(el.type || '').toLowerCase() === 'tel'
          );
        },
        value: function (p) {
          return profileValue(p, 'phone');
        }
      },
      {
        match: function (b) {
          return /country.*(code|call)|phone country|dial code|calling code/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'phoneCountry') || profileValue(p, 'country');
        }
      }
    ]);
  }

  function fillLocationStep(profile) {
    return fillMatchingFields(profile, [
      {
        match: function (b) {
          return /^country$|country\b/.test(b) && !/authoriz|phone|code/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'country');
        }
      },
      {
        match: function (b) {
          return /postcode|postal|zip/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'postcode') || profileValue(p, 'zip');
        }
      },
      {
        match: function (b) {
          return /\bcity\b/.test(b) && !/province|territory|state/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'city');
        }
      },
      {
        match: function (b) {
          return /province|territory|\bstate\b/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'state');
        }
      },
      {
        match: function (b) {
          return /street|address line/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'street');
        }
      }
    ]);
  }

  function fillWorkAuthStep(profile) {
    // Never invent Yes/No — blank authorizedToWork / sponsorship → missing
    var missing = [];
    var authRaw = profileValue(profile, 'authorizedToWork');
    var sponsorRaw = profileValue(profile, 'requiresSponsorship');
    var filled = 0;

    if (!authRaw) {
      missing.push('Authorized to work');
    } else {
      var auth = /^(no|n|false|0)$/i.test(authRaw) ? 'No' : /^(yes|y|true|1)$/i.test(authRaw) ? 'Yes' : authRaw;
      if (selectRadioByLabel(/authorized to work|legally authorized|right to work/i, auth)) filled++;
    }

    // Sponsorship question if present on same step
    var body = '';
    try {
      body = ((document.body && document.body.innerText) || '').toLowerCase();
    } catch (_e) {
      body = '';
    }
    if (/sponsor|visa sponsorship|require.*sponsorship/.test(body)) {
      if (!sponsorRaw) {
        missing.push('Requires sponsorship');
      } else {
        var sp = /^(yes|y|true|1)$/i.test(sponsorRaw)
          ? 'Yes'
          : /^(no|n|false|0)$/i.test(sponsorRaw)
            ? 'No'
            : sponsorRaw;
        if (selectRadioByLabel(/sponsor|visa sponsorship/i, sp)) filled++;
      }
    }

    return { filled: filled, missing: missing };
  }

  function fillEmployerQuestions(profile) {
    var filled = 0;
    var missing = [];

    function pageHas(re) {
      try {
        return re.test((document.body && document.body.innerText) || '');
      } catch (_e) {
        return false;
      }
    }

    // Driving license — never invent
    if (pageHas(/driving licen/i)) {
      var lic =
        answerFromCustom(profile, 'Driving License') ||
        answerFromCustom(profile, 'driving licence') ||
        answerFromCustom(profile, 'Do you have a driving license');
      if (!lic) missing.push('Driving License');
      else if (selectRadioByLabel(/driving licen/i, lic)) filled++;
    }

    // Own car — never invent
    if (pageHas(/own car|have a car|vehicle/i)) {
      var car =
        answerFromCustom(profile, 'Do you ahve your own car') ||
        answerFromCustom(profile, 'own car') ||
        answerFromCustom(profile, 'Do you have your own car');
      if (!car) {
        missing.push('Own car');
      } else {
        filled += fillMatchingFields(profile, [
          {
            match: function (b) {
              return /own car|vehicle|have a car/.test(b);
            },
            value: function () {
              return car;
            }
          }
        ]);
      }
    }

    // Years UAE Contracting experience
    var years =
      answerFromCustom(profile, 'years UAE Contracting') ||
      answerFromCustom(profile, 'UAE Contracting experience') ||
      answerFromCustom(profile, 'Years of experience') ||
      answerFromCustom(profile, 'contracting experience');
    if (!years && profile.customAnswers && profile.customAnswers.uaeContractingYears) {
      years = String(profile.customAnswers.uaeContractingYears);
    }
    if (pageHas(/years?.*(uae|contracting)|contracting experience/i)) {
      if (!years) missing.push('Years of experience');
      else {
        filled += fillMatchingFields(profile, [
          {
            match: function (b) {
              return /years?.*(uae|contracting|experience)|contracting experience/.test(b);
            },
            value: function () {
              return years;
            }
          }
        ]);
      }
    }

    // Generic: mapped customAnswers only — blank match on required-looking label → missing
    var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el) || el.disabled) continue;
      if (el.getAttribute('data-fill-apply-filled')) continue;
      var label = getLabelFor(el);
      if (!label) continue;
      var ans = null;
      var P = global.FillApplyFieldMap || global.FillApplyProfile;
      if (P && typeof P.answerForLabel === 'function') {
        var looked = P.answerForLabel(profile, label);
        if (looked && !looked.missing && looked.value) ans = looked.value;
        else if (looked && looked.missing && (el.required || el.getAttribute('aria-required') === 'true')) {
          missing.push(label.replace(/\s+/g, ' ').trim().slice(0, 80));
          continue;
        }
      }
      if (ans == null) ans = answerFromCustom(profile, label);
      if (ans != null) {
        if (String(el.type).toLowerCase() === 'radio') continue;
        if (setNativeValue(el, ans)) {
          filled++;
          el.setAttribute('data-fill-apply-filled', '1');
        }
      }
    }

    return { filled: filled, missing: missing };
  }

  function fillResumeStep(profile, documents) {
    if (resumeAlreadyUploaded()) {
      return { filled: 0, skipped: true, resumeAttached: true };
    }
    var attached = false;
    if (global.FillApplyFiles && documents && documents.resume) {
      var hints = [
        {
          kind: 'resume',
          match: 'resume|cv',
          selector: 'input[type=file]'
        }
      ];
      var result = global.FillApplyFiles.attachDocuments(documents, hints);
      attached = !!(result && result.resumeAttached);
      return {
        filled: attached ? 1 : 0,
        skipped: false,
        resumeAttached: attached,
        filesAttached: result
      };
    }
    return { filled: 0, skipped: false, resumeAttached: false };
  }


  function buildIndeedApplicationFields(profile) {
    profile = profile || {};
    var fields = [];
    function add(label, value) {
      if (value == null || value === '') return;
      fields.push({ label: label, value: String(value).slice(0, 500) });
    }
    add('First name', profile.firstName);
    add('Last name', profile.lastName);
    add('Full name', profile.fullName);
    add('Email', profile.email);
    add('Phone', profile.phone);
    add('Phone country', profile.phoneCountry);
    add('Street', profile.street);
    add('City', profile.city);
    add('State / province', profile.state);
    add('Country', profile.country);
    add('Postcode', profile.postcode || profile.zip);
    add('Authorized to work', profile.authorizedToWork);
    add('Requires sponsorship', profile.requiresSponsorship);
    if (profile.customAnswers && typeof profile.customAnswers === 'object') {
      Object.keys(profile.customAnswers).forEach(function (k) {
        add(k, profile.customAnswers[k]);
      });
    } else if (Array.isArray(profile.customQA)) {
      profile.customQA.forEach(function (qa) {
        if (qa && qa.question) add(qa.question, qa.answer);
      });
    }
    return fields;
  }

  function fillCurrentStep(profile, documents, flow) {
    var step = flow.step;
    var filled = 0;
    var missing = [];
    var meta = { step: step, resumeSkipped: false };

    function takeStepResult(r) {
      if (r && typeof r === 'object' && !Array.isArray(r) && 'filled' in r) {
        filled += r.filled || 0;
        if (r.missing && r.missing.length) missing = missing.concat(r.missing);
      } else {
        filled += r || 0;
      }
    }

    if (step === 'contact' || (flow.progress != null && flow.progress <= 15)) {
      takeStepResult(fillContactStep(profile));
      meta.step = 'contact';
    } else if (step === 'location' || (flow.progress != null && flow.progress <= 35 && flow.progress > 15)) {
      takeStepResult(fillLocationStep(profile));
      meta.step = 'location';
    } else if (step === 'work_auth') {
      takeStepResult(fillWorkAuthStep(profile));
      meta.step = 'work_auth';
    } else if (step === 'resume') {
      var r = fillResumeStep(profile, documents);
      filled += r.filled;
      meta.resumeSkipped = !!r.skipped;
      meta.resumeAttached = !!r.resumeAttached;
      meta.step = 'resume';
    } else if (step === 'employer_questions') {
      takeStepResult(fillEmployerQuestions(profile));
      meta.step = 'employer_questions';
    } else if (step === 'review') {
      meta.step = 'review';
    } else {
      takeStepResult(fillContactStep(profile));
      takeStepResult(fillLocationStep(profile));
      takeStepResult(fillWorkAuthStep(profile));
      takeStepResult(fillEmployerQuestions(profile));
    }

    meta.missingProfileFields = missing;
    return { filled: filled, meta: meta, missing: missing };
  }

  /**
   * Main fill entry — may return a Promise for multi-step ready/submit.
   */
  function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var documents = ctx.documents || {};
    var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
    if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    // Challenge gate (also checked by runner)
    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      var ch = global.FillApplyChallenges.detectChallenge(document);
      if (ch && ch.challenged) {
        return {
          ok: false,
          adapterId: 'indeed',
          needsHuman: true,
          challenge: ch,
          filled: 0,
          unmatched: 0,
          total: 0,
          error: global.FillApplyChallenges.describeChallenge(ch) || 'Human verification required',
          pauseReason: 'challenge'
        };
      }
    }

    function runSteps() {
      return Promise.resolve().then(async function () {
        var totalFilled = 0;
        var advanced = false;
        var submitted = false;
        var lastStep = 'unknown';
        var resumeAttached = false;
        var maxHops = runMode === 'fill' ? 2 : 12;

        for (var hop = 0; hop < maxHops; hop++) {
          if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
            var ch2 = global.FillApplyChallenges.detectChallenge(document);
            if (ch2 && ch2.challenged) {
              return {
                ok: false,
                adapterId: 'indeed',
                needsHuman: true,
                challenge: ch2,
                filled: totalFilled,
                unmatched: 0,
                total: totalFilled,
                advanced: advanced,
                submitted: submitted,
                error: global.FillApplyChallenges.describeChallenge(ch2),
                pauseReason: 'challenge'
              };
            }
          }

          var flow = detectIndeedApplyFlow(document);

          // Job page → click Apply with Indeed (ready/submit; fill may also enter form)
          if (flow.hasApplyButton && flow.applyButton) {
            try {
              flow.applyButton.click();
              advanced = true;
              await sleep(humanDelay(700));
              if (runMode === 'fill') {
                // After entering, fill current step only
                flow = detectIndeedApplyFlow(document);
              } else {
                continue;
              }
            } catch (_e) {
              /* ignore */
            }
          }

          flow = detectIndeedApplyFlow(document);
          lastStep = flow.step;

          var drift = hasStructureDrift(flow.step);
          if (drift && drift.drifted) {
            var driftMissing = [];
            var P = global.FillApplyFieldMap || global.FillApplyProfile;
            if (P && typeof P.answerForLabel === 'function' && drift.label) {
              var looked = P.answerForLabel(profile, drift.label);
              if (looked && looked.missing) driftMissing.push(String(drift.label).slice(0, 80));
            }
            if (driftMissing.length) {
              return {
                ok: false,
                adapterId: 'indeed',
                needsHuman: true,
                filled: totalFilled,
                unmatched: 1,
                total: totalFilled + 1,
                advanced: advanced,
                submitted: false,
                error:
                  'Indeed: missing profile field: ' +
                  driftMissing[0] +
                  ' — fill in Options or on the page, then Resume',
                pauseReason: 'missing_profile_field',
                missingProfileFields: driftMissing,
                driftLabel: drift.label,
                step: flow.step
              };
            }
            return {
              ok: false,
              adapterId: 'indeed',
              needsHuman: true,
              filled: totalFilled,
              unmatched: 1,
              total: totalFilled + 1,
              advanced: advanced,
              submitted: false,
              error: 'Indeed form changed — review required',
              pauseReason: 'structure_drift',
              driftLabel: drift.label,
              step: flow.step
            };
          }

          var stepResult = fillCurrentStep(profile, documents, flow);
          totalFilled += stepResult.filled || 0;
          if (stepResult.meta) {
            lastStep = stepResult.meta.step || lastStep;
            if (stepResult.meta.resumeAttached) resumeAttached = true;
          }
          var miss =
            (stepResult.missing && stepResult.missing.length && stepResult.missing) ||
            (stepResult.meta &&
              stepResult.meta.missingProfileFields &&
              stepResult.meta.missingProfileFields.length &&
              stepResult.meta.missingProfileFields) ||
            null;
          if (miss) {
            return {
              ok: false,
              adapterId: 'indeed',
              needsHuman: true,
              pauseReason: 'missing_profile_field',
              missingProfileFields: miss,
              filled: totalFilled,
              unmatched: miss.length,
              total: totalFilled + miss.length,
              advanced: advanced,
              submitted: false,
              error:
                'Indeed: missing profile field(s): ' +
                miss.join(', ') +
                ' — fill in Options or on the page, then Resume',
              step: lastStep
            };
          }

          if (flow.isReview || flow.step === 'review') {
            if (runMode === 'submit') {
              submitted = clickSubmit();
              await sleep(humanDelay(400));
            }
            var appFields = buildIndeedApplicationFields(profile);
            return {
              ok: true,
              adapterId: 'indeed',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: submitted,
              resumeAttached: resumeAttached,
              step: 'review',
              steps: ['contact', 'location', 'work_auth', 'resume', 'employer_questions', 'review'],
              applicationFields: appFields,
              applicationReport: {
                fields: appFields,
                steps: ['contact', 'location', 'work_auth', 'resume', 'employer_questions', 'review']
              },
              runMode: runMode,
              error: null
            };
          }

          if (runMode === 'fill') {
            return {
              ok: true,
              adapterId: 'indeed',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              error: null
            };
          }

          // ready | submit — fill then Continue, wait for progress/DOM change, rescan
          var prevProgress = flow.progress;
          var prevUrl = '';
          try {
            prevUrl = location.href;
          } catch (_u) {
            prevUrl = '';
          }
          var went = clickContinue();
          if (went) {
            advanced = true;
            if (global.FillApplyEasyApplySteps && global.FillApplyEasyApplySteps.waitForStepChange) {
              await global.FillApplyEasyApplySteps.waitForStepChange(prevProgress, prevUrl, 9000);
              await sleep(humanDelay(300));
            } else {
              await sleep(humanDelay(650));
            }
          } else {
            // Stuck — pause for human (needsHuman) instead of hard-fail when possible
            return {
              ok: false,
              adapterId: 'indeed',
              needsHuman: true,
              pauseReason: 'could_not_advance',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              error:
                'Indeed: could not advance step — review the page, then Resume (or retry after wait)'
            };
          }
        }

        return {
          ok: true,
          adapterId: 'indeed',
          filled: totalFilled,
          unmatched: 0,
          total: totalFilled,
          advanced: advanced,
          submitted: submitted,
          resumeAttached: resumeAttached,
          step: lastStep,
          runMode: runMode,
          error: null
        };
      });
    }

    return runSteps();
  }

  var adapter = {
    id: 'indeed',
    name: 'Indeed',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    detectIndeedApplyFlow: detectIndeedApplyFlow,
    fieldMaps: [],
    submitSelector:
      'button[type="submit"], input[type="submit"], button.ia-SubmitButton, [data-testid="submit-application"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: fill
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_indeedAdapter = adapter;
  global.detectIndeedApplyFlow = detectIndeedApplyFlow;
})(typeof globalThis !== 'undefined' ? globalThis : self);
