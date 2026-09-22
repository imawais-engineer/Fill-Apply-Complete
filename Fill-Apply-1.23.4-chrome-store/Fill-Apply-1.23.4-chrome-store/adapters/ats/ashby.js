/**
 * Ashby adapter — jobs.ashbyhq.com / ashbyhq.com / *.ashbyhq.com.
 *
 * Employer-published apply limits (Ashby):
 *   - Candidates may not apply more than 3 times in 60 days for any job (across the board).
 *   - Candidates may not re-apply to the same role within 180 days without an offer.
 * Fill & Apply enforces a configurable per-source cap (default 2, hard max 3) and a
 * soft same-URL 180-day re-apply block for Ashby — see docs/APPLICATION_GUIDE.md.
 *
 * Job page: Overview | Application tabs → click Application / Apply for this Job.
 * Form: Name, Email, Resume (DataTransfer), LinkedIn, country/city autocomplete,
 * sponsorship Yes/No, role-specific long text (customAnswers / coverLetter),
 * Diversity Survey skipped by default (do NOT invent demographics).
 * Modes: fill = fields only; ready = fill no submit; submit = Submit Application.
 * Structure drift / Cloudflare → needsHuman via challenges.js.
 */
(function (global) {
  'use strict';

  var HOST_RE = /(^|\.)ashbyhq\.com$/i;
  var HOSTS = ['jobs.ashbyhq.com', 'ashbyhq.com'];

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /ashbyhq\.com/i.test(u.hostname)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/ashbyhq\.com/i.test(url)) return true;
    }
    if (
      doc &&
      doc.querySelector(
        '[data-ashby-root], #ashby_application_form, .ashby-application-form, [class*="ashby"], form[action*="ashby"]'
      )
    ) {
      return true;
    }
    return false;
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

    if (type === 'radio') return false;

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

  function bodyText(doc) {
    doc = doc || document;
    try {
      return ((doc.body && doc.body.innerText) || '').slice(0, 12000);
    } catch (_e) {
      return '';
    }
  }

  /**
   * Detect Overview vs Application view on Ashby job pages.
   */
  function detectAshbyView(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return {
        view: 'unknown',
        hasApplicationTab: false,
        hasApplyButton: false,
        hasForm: false
      };
    }
    var text = bodyText(doc);
    var hasForm = !!(
      doc.querySelector(
        '#ashby_application_form, .ashby-application-form, form[class*="ashby"], [data-ashby-application-form], form'
      ) &&
      (/name|email|resume|linkedin|sponsorship|submit application/i.test(text) ||
        doc.querySelector('input[type="file"], textarea, input[name*="email" i]'))
    );

    var applicationTab = null;
    var overviewTab = null;
    var tabs = doc.querySelectorAll(
      'button, a, [role="tab"], [class*="Tab"], nav a, nav button'
    );
    for (var i = 0; i < tabs.length; i++) {
      var el = tabs[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (/^application$/i.test(t) || /\bapplication\b/i.test(t) && t.length < 24) {
        applicationTab = el;
      }
      if (/^overview$/i.test(t) || /\boverview\b/i.test(t) && t.length < 20) {
        overviewTab = el;
      }
    }

    var applyBtn = null;
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"]'
    );
    for (var j = 0; j < nodes.length; j++) {
      var btn = nodes[j];
      if (!visible(btn)) continue;
      var bt = buttonText(btn);
      if (/apply for this job|apply now|start application/i.test(bt)) {
        applyBtn = btn;
        break;
      }
    }

    var view = 'unknown';
    if (hasForm && /submit application/i.test(text)) view = 'application';
    else if (hasForm) view = 'application';
    else if (overviewTab || /overview/i.test(text)) view = 'overview';
    else if (applicationTab) view = 'overview';

    return {
      view: view,
      hasApplicationTab: !!applicationTab,
      applicationTab: applicationTab,
      overviewTab: overviewTab,
      hasApplyButton: !!applyBtn,
      applyButton: applyBtn,
      hasForm: hasForm
    };
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') {
      return String(profile[key]).trim();
    }
    if (key === 'fullName') {
      return (
        String(profile.fullName || '').trim() ||
        [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
      );
    }
    if (key === 'location' || key === 'workLocation') {
      var parts = [profile.city, profile.country].filter(Boolean);
      if (parts.length) return parts.join(', ');
      return String(profile.location || '').trim();
    }
    return '';
  }

  function answerFromCustom(profile, label) {
    var lab = norm(label);
    if (!lab) return null;
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
    if (global.FillApplyFieldMap && global.FillApplyFieldMap.matchCustomQA) {
      var qa = global.FillApplyFieldMap.matchCustomQA(profile.customQA, label, '');
      if (qa) return qa;
    }
    return null;
  }

  function isDiversityField(labelBlob) {
    return /diversity|eeo|equal opportunity|race|ethnicity|gender|veteran|disability|prefer not to|decline to (self-)?identify|lgbt|sexual orientation|hispanic|latino/i.test(
      labelBlob
    );
  }

  function selectYesNo(questionRe, yesNo) {
    var wantYes = /^(yes|y|true|1)$/i.test(String(yesNo || 'No'));
    var roots = document.querySelectorAll(
      'fieldset, [role="group"], [class*="Question"], [class*="field"], form div, label'
    );
    var candidates = [];
    for (var i = 0; i < roots.length; i++) {
      var lab = (roots[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (questionRe.test(lab) && lab.length < 400) candidates.push(roots[i]);
    }
    for (var c = 0; c < candidates.length; c++) {
      var root = candidates[c];
      var radios = root.querySelectorAll('input[type="radio"], button, [role="radio"]');
      for (var j = 0; j < radios.length; j++) {
        var radio = radios[j];
        var rLab = getLabelFor(radio) || radio.value || buttonText(radio) || '';
        var isYes = /^(yes|y)$/i.test(rLab.trim()) || /\byes\b/i.test(rLab);
        var isNo = /^(no|n)$/i.test(rLab.trim()) || /\bno\b/i.test(rLab);
        if ((wantYes && isYes) || (!wantYes && isNo)) {
          try {
            radio.click();
            if (radio.tagName === 'INPUT') {
              radio.checked = true;
              radio.dispatchEvent(new Event('input', { bubbles: true }));
              radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
          } catch (_e) {
            /* ignore */
          }
        }
      }
      var selects = root.querySelectorAll('select');
      for (var s = 0; s < selects.length; s++) {
        if (setNativeValue(selects[s], wantYes ? 'Yes' : 'No')) return true;
      }
    }
    return false;
  }

  function fillAutocompleteLocation(profile) {
    var loc =
      profileValue(profile, 'workLocation') ||
      profileValue(profile, 'location') ||
      [profileValue(profile, 'city'), profileValue(profile, 'country')].filter(Boolean).join(', ');
    if (!loc) return 0;
    var filled = 0;
    var inputs = document.querySelectorAll('input, textarea');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el)) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'file' || type === 'submit' || type === 'button') continue;
      var blob = norm(
        getLabelFor(el) + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')
      );
      if (
        /country.*intend|intend to work|work from|which country|city and country|location.*work/i.test(
          blob
        ) ||
        (/country|city|location/.test(blob) && /work|intend|from/.test(blob))
      ) {
        if (setNativeValue(el, loc)) {
          filled++;
          // Trigger autocomplete: type slowly then pick first option if present
          try {
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
          } catch (_e) {
            /* ignore */
          }
        }
      }
    }
    return filled;
  }

  function makeFile(Files, doc, fallbackName) {
    if (!Files || !doc || !doc.base64) return null;
    return Files.fileFromBase64(
      doc.base64,
      doc.name || fallbackName,
      doc.mime || 'application/pdf'
    );
  }

  function attachAshbyResume(documents) {
    var Files = global.FillApplyFiles;
    if (!Files) {
      return {
        ok: false,
        attached: [],
        errors: ['FillApplyFiles missing'],
        resumeAttached: false,
        coverAttached: false,
        inputCount: 0
      };
    }
    var hints = [
      {
        kind: 'resume',
        match: 'resume|cv|curriculum',
        selector:
          'input[type=file][name*="resume" i], input[type=file][id*="resume" i], input[type=file][accept*="pdf"]'
      },
      { kind: 'cover', match: 'cover', selector: 'input[type=file][name*="cover" i]' }
    ];
    var resumeFile = makeFile(Files, documents && documents.resume, 'resume.pdf');
    var coverFile = makeFile(Files, documents && documents.cover, 'cover-letter.pdf');
    var directAttached = [];

    function tryDirect(sel, file, kind) {
      if (!file) return null;
      var els = [];
      try {
        els = Array.prototype.slice.call(document.querySelectorAll(sel));
      } catch (_e) {
        return null;
      }
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (String(el.type || '').toLowerCase() !== 'file') continue;
        var r = Files.assignFilesToInput(el, file);
        if (r && r.ok) return { kind: kind, name: file.name };
      }
      return null;
    }

    var resumeDirect =
      tryDirect('input[type=file][name*="resume" i]', resumeFile, 'resume') ||
      tryDirect('input[type=file][id*="resume" i]', resumeFile, 'resume') ||
      tryDirect('input[type=file]', resumeFile, 'resume');
    if (resumeDirect) directAttached.push(resumeDirect);

    var coverDirect =
      tryDirect('input[type=file][name*="cover" i]', coverFile, 'cover') ||
      tryDirect('input[type=file][id*="cover" i]', coverFile, 'cover');
    if (coverDirect) directAttached.push(coverDirect);

    var generic = Files.attachDocuments(documents || {}, hints);
    var resumeAttached = !!resumeDirect || !!(generic && generic.resumeAttached);
    var coverAttached = !!coverDirect || !!(generic && generic.coverAttached);
    var attached = (generic && generic.attached ? generic.attached.slice() : []).slice();
    directAttached.forEach(function (a) {
      if (
        !attached.some(function (x) {
          return x.kind === a.kind;
        })
      ) {
        attached.push(a);
      }
    });
    return {
      ok: (generic && generic.ok !== false) || attached.length > 0,
      attached: attached,
      errors: (generic && generic.errors) || [],
      inputCount: (generic && generic.inputCount) || 0,
      resumeAttached: resumeAttached,
      coverAttached: coverAttached
    };
  }

  function fillMatchingFields(profile, predicates) {
    var filled = 0;
    var inputs = document.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file' || type === 'password') {
        continue;
      }
      if (el.disabled || el.readOnly) continue;
      if (!visible(el) && el.tagName !== 'SELECT') continue;
      var label = getLabelFor(el);
      var blob = norm(label + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''));
      if (isDiversityField(blob)) continue;
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

  function fillBasicInfo(profile) {
    return fillMatchingFields(profile, [
      {
        match: function (b) {
          return (
            (/^(name|full name)$/.test(b) || /\bfull name\b|\byour name\b|\bname\b/.test(b)) &&
            !/first|last|company|file|user/.test(b)
          );
        },
        value: function (p) {
          return profileValue(p, 'fullName');
        }
      },
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
        match: function (b) {
          return /linkedin/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'linkedin');
        }
      },
      {
        match: function (b) {
          return /phone|mobile|tel/.test(b) && !/country/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'phone');
        }
      },
      {
        match: function (b) {
          return /portfolio|website|personal site|github/.test(b);
        },
        value: function (p, el) {
          var blob = norm(getLabelFor(el) + ' ' + (el.name || ''));
          if (/github/.test(blob)) return profileValue(p, 'github');
          return profileValue(p, 'portfolio') || profileValue(p, 'website');
        }
      }
    ]);
  }

  function fillRoleSpecifics(profile, runMode) {
    var filled = 0;
    var emptyRequired = [];
    var textareas = document.querySelectorAll('textarea, input[type="text"]');
    for (var i = 0; i < textareas.length; i++) {
      var el = textareas[i];
      if (!visible(el)) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'file') continue;
      var label = getLabelFor(el);
      var blob = norm(label + ' ' + (el.name || '') + ' ' + (el.id || ''));
      if (isDiversityField(blob)) continue;
      // Skip already-handled basic fields
      if (/^(name|email|linkedin|phone|city|country|location)/.test(blob) && blob.length < 40) {
        continue;
      }
      if (/resume|cv|file/.test(blob) && el.tagName !== 'TEXTAREA') continue;

      var isLong =
        el.tagName === 'TEXTAREA' ||
        /campaign|strategy|reallocat|spend|why|describe|tell us|experience|cover/i.test(label);

      if (!isLong && el.tagName !== 'TEXTAREA') continue;

      var ans = answerFromCustom(profile, label);
      if (!ans && /campaign|strategy|reallocat|spend|cover|why|motivat/i.test(label)) {
        ans = profileValue(profile, 'coverLetter') || profileValue(profile, 'resumeSummary');
      }
      if (ans) {
        if (setNativeValue(el, ans)) filled++;
      } else {
        var required =
          el.required ||
          el.getAttribute('aria-required') === 'true' ||
          /\*/.test(label) ||
          /\(required\)/i.test(label);
        if (required && (!el.value || !String(el.value).trim())) {
          emptyRequired.push(label || blob);
        }
      }
    }
    return { filled: filled, emptyRequired: emptyRequired };
  }

  function skipDiversity() {
    // Prefer "Prefer not to answer" / leave blank — never invent demographics
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var el = selects[i];
      if (!visible(el) && el.offsetParent === null) continue;
      var lab = getLabelFor(el);
      if (!isDiversityField(lab + ' ' + (el.name || ''))) continue;
      for (var o = 0; o < el.options.length; o++) {
        var t = (el.options[o].textContent || '').trim();
        if (/prefer not|decline|do not wish|choose not/i.test(t)) {
          el.selectedIndex = o;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
    // Radio "Prefer not to answer"
    var radios = document.querySelectorAll('input[type="radio"]');
    for (var r = 0; r < radios.length; r++) {
      var radio = radios[r];
      var wrap = radio.closest('fieldset, [role="group"], div') || radio.parentElement;
      var wLab = ((wrap && wrap.textContent) || '') + ' ' + getLabelFor(radio);
      if (!isDiversityField(wLab)) continue;
      var rLab = getLabelFor(radio) || radio.value || '';
      if (/prefer not|decline|do not wish|choose not/i.test(rLab)) {
        try {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_e) {
          /* ignore */
        }
      }
    }
  }

  function clickSubmitApplication() {
    var buttons = document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]'
    );
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (/\bsubmit application\b/i.test(t) || /^submit$/i.test(t)) {
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
        'button[type="submit"], input[type="submit"], button[class*="submit"]'
      );
    }
    return false;
  }

  function collectUnknownRequired() {
    var known = [
      /name/i,
      /e-?mail/i,
      /phone|mobile|tel/i,
      /linkedin/i,
      /resume|cv/i,
      /cover/i,
      /country|city|location|work from|intend/i,
      /sponsorship|visa|authorized/i,
      /portfolio|website|github/i,
      /prefer not|decline|diversity|eeo|race|gender|veteran|disability/i
    ];
    var unknown = [];
    var req = document.querySelectorAll(
      'input[required], select[required], textarea[required], [aria-required="true"]'
    );
    for (var i = 0; i < req.length; i++) {
      var el = req[i];
      if (!visible(el) && String(el.type || '') !== 'file') continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden') continue;
      var lab = getLabelFor(el);
      if (isDiversityField(lab)) continue;
      var matched = false;
      for (var k = 0; k < known.length; k++) {
        if (known[k].test(lab) || known[k].test(el.name || '')) {
          matched = true;
          break;
        }
      }
      // Long text role questions are "known" as optional-fill
      if (/campaign|strategy|reallocat|spend|why |describe|tell us/i.test(lab)) matched = true;
      if (!matched && lab && lab.length > 3) {
        var empty =
          type === 'file'
            ? !(el.files && el.files.length)
            : !String(el.value || '').trim();
        if (empty) unknown.push(lab.replace(/\s+/g, ' ').trim().slice(0, 120));
      }
    }
    return unknown;
  }

  function ensureApplicationView() {
    return Promise.resolve().then(async function () {
      var view = detectAshbyView(document);
      if (view.view === 'application' && view.hasForm) return view;

      if (view.applicationTab) {
        try {
          view.applicationTab.click();
          await sleep(humanDelay(500));
        } catch (_e) {
          /* ignore */
        }
      } else if (view.applyButton) {
        try {
          view.applyButton.click();
          await sleep(humanDelay(600));
        } catch (_e2) {
          /* ignore */
        }
      } else {
        // Text link "Application" / "Apply for this Job"
        var links = document.querySelectorAll('a, button, [role="tab"]');
        for (var i = 0; i < links.length; i++) {
          var el = links[i];
          if (!visible(el)) continue;
          var t = buttonText(el);
          if (/^application$/i.test(t) || /apply for this job/i.test(t)) {
            try {
              el.click();
              await sleep(humanDelay(500));
              break;
            } catch (_e3) {
              /* ignore */
            }
          }
        }
      }
      return detectAshbyView(document);
    });
  }

  function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var documents = ctx.documents || {};
    var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
    if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      var ch = global.FillApplyChallenges.detectChallenge(document);
      if (ch && ch.challenged) {
        return {
          ok: false,
          adapterId: 'ashby',
          needsHuman: true,
          challenge: ch,
          filled: 0,
          unmatched: 0,
          total: 0,
          error:
            (global.FillApplyChallenges.describeChallenge &&
              global.FillApplyChallenges.describeChallenge(ch)) ||
            'Human verification required',
          pauseReason: 'challenge'
        };
      }
    }

    return Promise.resolve().then(async function () {
      var totalFilled = 0;
      var advanced = false;
      var submitted = false;

      var view = await ensureApplicationView();
      if (view.view === 'application' || view.hasForm) advanced = true;

      if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
        var ch2 = global.FillApplyChallenges.detectChallenge(document);
        if (ch2 && ch2.challenged) {
          return {
            ok: false,
            adapterId: 'ashby',
            needsHuman: true,
            challenge: ch2,
            filled: 0,
            unmatched: 0,
            total: 0,
            advanced: advanced,
            error:
              (global.FillApplyChallenges.describeChallenge &&
                global.FillApplyChallenges.describeChallenge(ch2)) ||
              'Human verification required',
            pauseReason: 'challenge'
          };
        }
      }

      // Attach resume via DataTransfer first
      var filesAttached = attachAshbyResume(documents);
      if (filesAttached.resumeAttached) totalFilled++;

      totalFilled += fillBasicInfo(profile);
      totalFilled += fillAutocompleteLocation(profile);

      // Sponsorship Yes/No from profile.requiresSponsorship
      var sponsorship = profileValue(profile, 'requiresSponsorship') || 'No';
      if (
        selectYesNo(
          /sponsorship|visa|require.*(sponsor|visa)|will you now or in the future require/i,
          sponsorship
        )
      ) {
        totalFilled++;
      }

      // Authorized to work if present
      var auth = profileValue(profile, 'authorizedToWork') || 'Yes';
      if (selectYesNo(/authorized to work|legally (authorized|entitled)|work authorization/i, auth)) {
        totalFilled++;
      }

      var role = fillRoleSpecifics(profile, runMode);
      totalFilled += role.filled || 0;

      // Diversity: skip / prefer not to answer — never invent
      skipDiversity();

      // Also run generic fallback field heuristics without re-attaching files
      if (global.FillApplyFallbackAdapter && global.__fillApply) {
        try {
          var fb = global.FillApplyFallbackAdapter.fill(
            Object.assign({}, ctx, {
              adapterId: 'ashby',
              documents: {},
              runMode: 'fill',
              autoSubmit: false,
              submitSelector: adapter.submitSelector,
              fileInputHints: adapter.fileInputHints
            })
          );
          if (fb && fb.filled) totalFilled += fb.filled;
        } catch (_fbErr) {
          /* ignore */
        }
      }

      var unknownReq = collectUnknownRequired();
      if (unknownReq.length && runMode === 'submit') {
        // Required empty role questions with no mapped answer → pause
        if (role.emptyRequired && role.emptyRequired.length) {
          return {
            ok: false,
            adapterId: 'ashby',
            needsHuman: true,
            filled: totalFilled,
            unmatched: role.emptyRequired.length,
            total: totalFilled + role.emptyRequired.length,
            advanced: advanced,
            submitted: false,
            resumeAttached: !!filesAttached.resumeAttached,
            coverAttached: !!filesAttached.coverAttached,
            filesAttached: filesAttached,
            error: 'Ashby form has required empty fields — review required',
            pauseReason: 'structure_drift',
            driftLabel: role.emptyRequired[0],
            runMode: runMode
          };
        }
        if (unknownReq.length) {
          return {
            ok: false,
            adapterId: 'ashby',
            needsHuman: true,
            filled: totalFilled,
            unmatched: unknownReq.length,
            total: totalFilled + unknownReq.length,
            advanced: advanced,
            submitted: false,
            resumeAttached: !!filesAttached.resumeAttached,
            coverAttached: !!filesAttached.coverAttached,
            filesAttached: filesAttached,
            error: 'Ashby form changed — review required',
            pauseReason: 'structure_drift',
            driftLabel: unknownReq[0],
            runMode: runMode
          };
        }
      }

      if (runMode === 'fill') {
        return {
          ok: true,
          adapterId: 'ashby',
          filled: totalFilled,
          unmatched: 0,
          total: totalFilled,
          advanced: advanced,
          submitted: false,
          resumeAttached: !!filesAttached.resumeAttached,
          coverAttached: !!filesAttached.coverAttached,
          filesAttached: filesAttached,
          runMode: runMode,
          view: view.view,
          error: null
        };
      }

      // ready: fill only, no submit (Ashby is typically single-page after Application tab)
      if (runMode === 'ready') {
        return {
          ok: true,
          adapterId: 'ashby',
          filled: totalFilled,
          unmatched: 0,
          total: totalFilled,
          advanced: advanced,
          submitted: false,
          resumeAttached: !!filesAttached.resumeAttached,
          coverAttached: !!filesAttached.coverAttached,
          filesAttached: filesAttached,
          runMode: runMode,
          view: view.view,
          error: null
        };
      }

      // submit
      submitted = clickSubmitApplication();
      await sleep(humanDelay(400));

      return {
        ok: true,
        adapterId: 'ashby',
        filled: totalFilled,
        unmatched: 0,
        total: totalFilled,
        advanced: advanced,
        submitted: submitted,
        resumeAttached: !!filesAttached.resumeAttached,
        coverAttached: !!filesAttached.coverAttached,
        filesAttached: filesAttached,
        runMode: runMode,
        view: view.view,
        error: submitted ? null : 'Ashby: Submit Application button not found'
      };
    });
  }

  var adapter = {
    category: 'ats',
    id: 'ashby',
    name: 'Ashby',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'button[type="submit"], button[class*="submit"], button[class*="Submit"], input[type="submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|curriculum' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: fill,
    detectAshbyView: detectAshbyView
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_ashbyAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
