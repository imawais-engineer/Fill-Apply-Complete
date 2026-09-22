/**
 * LinkedIn board adapter — Easy Apply multi-page modal + External Apply handoff.
 *
 * PREREQUISITE: User must be logged into LinkedIn. Login / auth wall → needsHuman pause.
 *
 * Two apply paths on the job page:
 *   A) **Easy Apply** — on-LinkedIn multi-page modal (e.g. 1/6 … Review). Never Premium /
 *      Tailor my resume. Modes: fill/ready advance Next/Review but NEVER Submit;
 *      submit clicks Submit application on Review.
 *   B) **External Apply** ("Apply" + "Responses managed off LinkedIn") — click Apply →
 *      optional **Share your profile?** modal (prefer toggle **Off**, then Continue) →
 *      employer careers (e.g. pepsicojobs.com) → ATS (often iCIMS). On host change,
 *      return WWR-style handoff (`externalApply` / `deferToPageAdapter` / `handedOff`)
 *      so the runner re-injects and re-detects.
 *
 * Diversity/EEO: never invent; optional gender only if profile has it; else leave blank.
 * Captcha / structure drift → needsHuman pause.
 */
(function (global) {
  'use strict';

  var HOSTS = ['linkedin.com', 'www.linkedin.com'];
  var HOST_RE = /(^|\.)linkedin\.com$/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /linkedin\.com/i.test(u.hostname) || HOST_RE.test(url)) {
        return true;
      }
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/linkedin\.com/i.test(url)) return true;
    }
    if (doc && findEasyApplyModal(doc)) return true;
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
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('title') || '') +
      ' ' +
      (el.getAttribute('data-control-name') || '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLabelFor(el, root) {
    if (global.__fillApply && global.__fillApply.getLabelText) {
      var t = global.__fillApply.getLabelText(el);
      if (t) return t;
    }
    if (el.id) {
      try {
        var scope = root || document;
        var byFor = scope.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return byFor.textContent.trim();
      } catch (_e) {
        /* ignore */
      }
    }
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\s+/);
      var texts = [];
      for (var i = 0; i < parts.length; i++) {
        var n = document.getElementById(parts[i]);
        if (n) texts.push((n.textContent || '').trim());
      }
      if (texts.length) return texts.join(' ');
    }
    var parent = el.closest('label');
    if (parent) return parent.textContent.trim();
    var formGroup = el.closest(
      '.fb-dash-form-element, .jobs-easy-apply-form-element, [class*="form-element"], fieldset, .form-group'
    );
    if (formGroup) {
      var lab =
        formGroup.querySelector('label, legend, .fb-dash-form-element__label, span[aria-hidden="true"]') ||
        null;
      if (lab) return (lab.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return el.getAttribute('aria-label') || el.placeholder || el.name || '';
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    var v = profile[key];
    if (v == null || String(v).trim() === '') return '';
    return String(v).trim();
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

  function toYesNo(val) {
    if (val == null || String(val).trim() === '') return null;
    var s = String(val).trim();
    if (/^(yes|y|true|1|on)$/i.test(s)) return 'Yes';
    if (/^(no|n|false|0|off)$/i.test(s)) return 'No';
    if (/^yes\b/i.test(s)) return 'Yes';
    if (/^no\b/i.test(s)) return 'No';
    return null;
  }

  function isEeoLabel(label) {
    return /diversity|eeo|equal opportunity|race|ethnicity|veteran|disability|sexual orientation|lgbt|transgender|hispanic|latino|voluntary self.?identif|decline to (self-)?identify|prefer not to|gender identity/i.test(
      norm(label)
    );
  }

  function isGenderOnlyLabel(label) {
    var lab = norm(label);
    return /^gender$|gender\b|sex\b/.test(lab) && !/identity|prefer|orientation/.test(lab);
  }

  /* ---------- Login / challenge ---------- */

  function detectLoginWall(doc, href) {
    href = String(href || '');
    var path = '';
    try {
      path = new URL(href, typeof location !== 'undefined' ? location.href : undefined).pathname || '';
    } catch (_e) {
      path = href;
    }
    if (/\/(login|uas\/login|checkpoint|authwall|signup|join\/login)/i.test(path + ' ' + href)) {
      return true;
    }
    var bodyText = '';
    try {
      bodyText = doc && doc.body ? String(doc.body.innerText || '').slice(0, 6000) : '';
    } catch (_e2) {
      bodyText = '';
    }
    if (
      /sign in to continue|join linkedin|welcome back|session (has )?expired|authwall|please sign in/i.test(
        bodyText
      ) &&
      !findEasyApplyModal(doc)
    ) {
      // Avoid false positive on public job pages that say "Sign in" in chrome
      if (/password|email or phone|forgot password|keep me logged/i.test(bodyText)) return true;
      if (/\/login|authwall/i.test(href)) return true;
    }
    // Dedicated authwall overlay
    if (doc) {
      var wall = doc.querySelector(
        '.authwall, [class*="authwall"], [data-test-id*="authwall"], .join-form, form.login__form'
      );
      if (wall && visible(wall)) return true;
    }
    return false;
  }

  function loginWallResult() {
    return {
      ok: false,
      adapterId: 'linkedin',
      needsHuman: true,
      pauseReason: 'challenge',
      error:
        'LinkedIn login required — sign in to LinkedIn in this browser, then Resume. Easy Apply needs an authenticated session.',
      filled: 0,
      unmatched: 0,
      total: 0
    };
  }

  /* ---------- Easy Apply button / modal ---------- */

  function findEasyApplyButton(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], [role="button"], .jobs-apply-button'
    );
    var candidates = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      var cls = String(el.className || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-control-name') || '');

      // Reject external Apply, Premium, Tailor my resume, Save, Follow
      if (/tailor my resume|premium|unlock|see who|start a free|upgrade/i.test(t)) continue;
      if (/^apply$/i.test(t.trim()) && !/easy/i.test(t) && !/easy/i.test(cls)) {
        // Plain "Apply" often means external ATS — skip unless marked easy-apply
        if (!/easy.?apply|jobs-apply-button--top-card|easyApply/i.test(cls)) continue;
      }
      if (/apply on company|apply externally|company website|offsite/i.test(t)) continue;

      if (/easy\s*apply/i.test(t) || /easy.?apply|easyApply/i.test(cls)) {
        candidates.push({ el: el, score: /easy\s*apply/i.test(t) ? 10 : 5 });
      }
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    if (candidates.length) return candidates[0].el;

    var byAttr = doc.querySelector(
      'button.jobs-apply-button, button[aria-label*="Easy Apply" i], button[data-control-name*="easy_apply" i], .jobs-apply-button--top-card'
    );
    if (byAttr && visible(byAttr)) {
      var bt = buttonText(byAttr);
      if (!/tailor|premium|upgrade/i.test(bt)) return byAttr;
    }
    return null;
  }

  /**
   * External / off-LinkedIn Apply (not Easy Apply, Premium, or Tailor my resume).
   * Job chrome often shows "Apply" + "Responses managed off LinkedIn".
   */
  function findExternalApplyButton(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], [role="button"], .jobs-apply-button'
    );
    var candidates = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      var cls =
        String(el.className || '') +
        ' ' +
        (el.id || '') +
        ' ' +
        (el.getAttribute('data-control-name') || '');

      if (/tailor my resume|premium|unlock|see who|start a free|upgrade|save job|follow|share/i.test(t)) {
        continue;
      }
      if (/easy\s*apply/i.test(t) || /easy.?apply|easyApply/i.test(cls)) continue;

      var score = 0;
      if (/^apply$/i.test(t.trim())) score = 90;
      if (/^apply now$/i.test(t.trim())) score = 85;
      if (/apply on company|apply externally|company website|offsite/i.test(t)) score = 95;
      if (/\bapply\b/i.test(t) && t.length < 40 && !/easy/i.test(t)) score = Math.max(score, 70);
      // jobs-apply-button without easy-apply marker is often external
      if (/jobs-apply-button/i.test(cls) && !/easy/i.test(cls) && !/easy/i.test(t) && /\bapply\b/i.test(t)) {
        score = Math.max(score, 88);
      }
      if (score > 0) candidates.push({ el: el, score: score });
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    return candidates.length ? candidates[0].el : null;
  }

  function findShareProfileModal(doc) {
    doc = doc || document;
    var dialogs = doc.querySelectorAll(
      '[role="dialog"], dialog, .artdeco-modal, .artdeco-modal__content, [class*="share-profile"], [class*="apply-modal"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!visible(d)) continue;
      var txt = (d.textContent || '').replace(/\s+/g, ' ');
      if (/share your profile/i.test(txt) && /continue/i.test(txt)) return d;
      if (/share your profile with the job poster|share your (full )?profile/i.test(txt)) return d;
    }
    // Broader page scan if dialog markup is nested oddly
    var bodyTxt = '';
    try {
      bodyTxt = doc.body ? String(doc.body.innerText || '').slice(0, 4000) : '';
    } catch (_e) {
      bodyTxt = '';
    }
    if (/share your profile/i.test(bodyTxt)) {
      var toggles = doc.querySelectorAll(
        'input[type="checkbox"], [role="switch"], button[role="switch"], .artdeco-toggle, [class*="toggle"]'
      );
      for (var t = 0; t < toggles.length; t++) {
        var root =
          toggles[t].closest('[role="dialog"], dialog, .artdeco-modal') ||
          toggles[t].closest('form, section, div');
        if (root && /share your profile/i.test(root.textContent || '')) return root;
      }
    }
    return null;
  }

  /**
   * Prefer privacy: turn Share your profile Off when a switch is found.
   * Preference: shareProfilePreference = 'off' (documented default).
   */
  function setShareProfileOff(modal) {
    if (!modal) return { toggled: false, preference: 'off' };
    var switches = modal.querySelectorAll(
      '[role="switch"], input[type="checkbox"], button[role="switch"], .artdeco-toggle, [class*="toggle"] input, [class*="toggle"] button'
    );
    for (var i = 0; i < switches.length; i++) {
      var sw = switches[i];
      if (!visible(sw) && sw.offsetParent === null) continue;
      var checked =
        sw.getAttribute('aria-checked') === 'true' ||
        sw.getAttribute('aria-checked') === 'mixed' ||
        !!sw.checked ||
        /is-on|checked|active/i.test(String(sw.className || ''));
      if (checked) {
        try {
          sw.click();
        } catch (_e) {
          try {
            if (typeof sw.checked === 'boolean') {
              sw.checked = false;
              sw.dispatchEvent(new Event('change', { bubbles: true }));
            }
            sw.setAttribute('aria-checked', 'false');
          } catch (_e2) {
            /* ignore */
          }
        }
        return { toggled: true, preference: 'off', wasOn: true };
      }
      // Already off
      if (sw.getAttribute('aria-checked') === 'false' || sw.checked === false) {
        return { toggled: false, preference: 'off', wasOn: false };
      }
    }
    return { toggled: false, preference: 'off', switchNotFound: true };
  }

  function clickShareProfileContinue(modal) {
    var root = modal || document;
    var nodes = root.querySelectorAll('button, [role="button"], a, input[type="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (/^continue$/i.test(t.trim()) || /continue to apply|continue applying/i.test(t)) {
        try {
          el.click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    return false;
  }

  function isLinkedInHost(hostname) {
    return /linkedin\.com$/i.test(String(hostname || '')) || /(^|\.)linkedin\.com$/i.test(String(hostname || ''));
  }

  function currentHostname() {
    try {
      return String((typeof location !== 'undefined' && location.hostname) || '');
    } catch (_e) {
      return '';
    }
  }

  function handoffResult(extra) {
    return Object.assign(
      {
        ok: true,
        adapterId: 'linkedin',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        shareProfilePreference: 'off',
        message:
          'Opened LinkedIn external Apply — runner will re-detect destination careers/ATS (e.g. iCIMS)'
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
    if (!next || next.id === 'linkedin' || next.id === 'fallback') {
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
          fr.fromAdapter = 'linkedin';
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

  function waitForShareOrNav(doc, startHost, timeoutMs) {
    doc = doc || document;
    timeoutMs = timeoutMs || 5000;
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        var host = currentHostname();
        if (host && startHost && host !== startHost && !isLinkedInHost(host)) {
          resolve({ kind: 'nav', host: host });
          return;
        }
        var modal = findShareProfileModal(doc);
        if (modal) {
          resolve({ kind: 'share', modal: modal });
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve({ kind: 'timeout' });
          return;
        }
        setTimeout(tick, 200);
      }
      tick();
    });
  }

    function findEasyApplyModal(doc) {
    doc = doc || document;
    var selectors = [
      '.jobs-easy-apply-modal',
      '[data-test-modal-id="easy-apply-modal"]',
      'div.jobs-easy-apply-content',
      '.artdeco-modal.jobs-easy-apply-modal',
      '[aria-labelledby*="jobs-apply-header"]'
    ];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var el = doc.querySelector(selectors[s]);
        if (el && visible(el)) return el.closest('[role="dialog"], .artdeco-modal, dialog') || el;
      } catch (_e) {
        /* ignore */
      }
    }

    var dialogs = doc.querySelectorAll(
      '[role="dialog"], dialog, .artdeco-modal, [class*="easy-apply"], [class*="EasyApply"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!visible(d)) continue;
      var txt = (d.textContent || '').replace(/\s+/g, ' ');
      if (/submit application|easy apply|continue to next step|review your application/i.test(txt)) {
        return d;
      }
      if (/\b\d+\s*\/\s*\d+\b/.test(txt) && (/next|review|contact info|resume|work experience/i.test(txt))) {
        return d;
      }
    }

    // Fallback: footer with Next / Review / Submit application
    var buttons = doc.querySelectorAll('button, [role="button"]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      if (!visible(btn)) continue;
      var t = buttonText(btn);
      if (/^next$/i.test(t.trim()) || /^review$/i.test(t.trim()) || /submit application/i.test(t)) {
        var root =
          btn.closest(
            '[role="dialog"], dialog, .artdeco-modal, .jobs-easy-apply-modal, [class*="easy-apply"]'
          ) || null;
        if (root && visible(root)) return root;
      }
    }
    return null;
  }

  function waitForModal(doc, timeoutMs) {
    doc = doc || document;
    timeoutMs = timeoutMs || 6000;
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        var modal = findEasyApplyModal(doc);
        if (modal) {
          resolve(modal);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 200);
      }
      tick();
    });
  }

  function detectStep(modal) {
    if (!modal) return { step: 'unknown', progress: null, isReview: false };
    var txt = (modal.textContent || '').replace(/\s+/g, ' ');
    var m = txt.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    var progress = m ? { current: Number(m[1]), total: Number(m[2]) } : null;

    var heading = '';
    var h = modal.querySelector('h2, h3, .t-16, .jobs-easy-apply-form-section__grouping, header');
    if (h) heading = (h.textContent || '').replace(/\s+/g, ' ').trim();

    var blob = norm(heading + ' ' + txt.slice(0, 800));
    var step = 'unknown';
    var isReview = false;

    if (/review your application|review the information|almost done|ready to submit/i.test(blob) ||
        (findSubmitApplication(modal) && !findNextButton(modal))) {
      step = 'review';
      isReview = true;
    } else if (/additional question|voluntary|privacy|consent|criminal|conviction/i.test(blob) &&
               /yes|no/i.test(txt)) {
      step = 'additional';
    } else if (/education|school|degree|university|college/i.test(blob) &&
               !/highest education level/i.test(blob)) {
      // Education cards page (not "Highest Education Level" on contact)
      if (hasPrefillCards(modal, /education|school|degree/i) || /add education/i.test(blob)) {
        step = 'education';
      }
    } else if (/work experience|experience|job title|company name/i.test(blob) &&
               (/add work experience|add experience/i.test(blob) || hasPrefillCards(modal, /experience|title|company/i))) {
      step = 'work';
    } else if (/resume|cv|curriculum|upload (your )?resume|attach resume/i.test(blob) ||
               modal.querySelector('input[type="file"]')) {
      step = 'resume';
    } else if (/contact|phone|email|first name|mobile|nationality|salutation|date of birth|expected salary/i.test(blob)) {
      step = 'contact';
    }

    // Progress-based fallback for Qiddiya-like 6-step
    if (step === 'unknown' && progress) {
      var map = { 1: 'contact', 2: 'resume', 3: 'work', 4: 'education', 5: 'additional', 6: 'review' };
      if (progress.current === progress.total) {
        step = 'review';
        isReview = true;
      } else if (map[progress.current]) {
        step = map[progress.current];
      }
    }

    return { step: step, progress: progress, isReview: isReview, heading: heading };
  }

  function hasPrefillCards(modal, re) {
    if (!modal) return false;
    var cards = modal.querySelectorAll(
      '[class*="entity"], [class*="card"], [class*="experience"], [class*="education"], li, article'
    );
    var count = 0;
    for (var i = 0; i < cards.length; i++) {
      var t = (cards[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 20 && t.length < 600 && re.test(t)) count++;
    }
    return count >= 1;
  }

  /* ---------- DOM fill helpers ---------- */

  function setNativeValue(el, value) {
    if (!el) return false;
    var tag = el.tagName;
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);

    if (type === 'checkbox') {
      var want = /^(yes|y|true|1|on)$/i.test(str);
      if (el.checked !== want) {
        el.click();
        if (el.checked !== want) {
          el.checked = want;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
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
        if (t === wantL || v === wantL || (wantL && t.indexOf(wantL) !== -1)) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    // Don't wipe non-empty fields that already match or look prefilled with similar content
    var existing = String(el.value || '').trim();
    if (existing && existing === str) return true;

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
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function selectRadioInRoot(root, questionRe, yesNo) {
    var wantYes = /^(yes|y|true|1)$/i.test(String(yesNo || 'Yes'));
    var fieldsets = (root || document).querySelectorAll(
      'fieldset, [role="group"], [class*="form-element"], [class*="jobs-easy-apply"], label, div'
    );
    var candidates = [];
    for (var i = 0; i < fieldsets.length; i++) {
      var fs = fieldsets[i];
      if (!visible(fs)) continue;
      var lab = (fs.textContent || '').replace(/\s+/g, ' ').trim();
      if (lab.length > 400) continue;
      if (questionRe.test(lab)) candidates.push(fs);
    }
    for (var c = 0; c < candidates.length; c++) {
      var group = candidates[c];
      var radios = group.querySelectorAll('input[type="radio"]');
      for (var j = 0; j < radios.length; j++) {
        var radio = radios[j];
        var rLab = getLabelFor(radio, root) || radio.value || '';
        var isYes = /^(yes|y|true|1)$/i.test(rLab.trim()) || /^yes$/i.test(String(radio.value || '').trim());
        var isNo = /^(no|n|false|0)$/i.test(rLab.trim()) || /^no$/i.test(String(radio.value || '').trim());
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
      // Button-style Yes/No
      var opts = group.querySelectorAll('button, [role="radio"], [role="button"], label');
      for (var o = 0; o < opts.length; o++) {
        var ot = buttonText(opts[o]).trim();
        if ((wantYes && /^yes$/i.test(ot)) || (!wantYes && /^no$/i.test(ot))) {
          try {
            opts[o].click();
            return true;
          } catch (_e2) {
            /* ignore */
          }
        }
      }
    }
    return false;
  }

  function selectOptionFuzzy(el, value) {
    if (!el || !value) return false;
    return setNativeValue(el, value);
  }

  function resolveFieldValue(profile, label, el) {
    profile = profile || {};
    var lab = norm(label);
    var type = String((el && el.type) || '').toLowerCase();

    // EEO / diversity — never invent (gender handled specially below)
    if (isEeoLabel(label) && !isGenderOnlyLabel(label)) {
      return { value: null, skip: true, reason: 'eeo' };
    }

    // Gender optional — only if profile has it
    if (isGenderOnlyLabel(label)) {
      var g =
        answerFromCustom(profile, 'gender') ||
        profileValue(profile, 'gender') ||
        answerFromCustom(profile, label);
      if (g) return { value: g, reason: 'gender' };
      return { value: null, skip: true, reason: 'gender_unset' };
    }

    var custom = answerFromCustom(profile, label);
    if (custom != null) return { value: custom, reason: 'customAnswers' };

    if (/first name|firstname|given name/.test(lab)) {
      return { value: profileValue(profile, 'firstName'), reason: 'firstName' };
    }
    if (/last name|lastname|surname|family name/.test(lab)) {
      return { value: profileValue(profile, 'lastName'), reason: 'lastName' };
    }
    if (/^full name$|legal name/.test(lab)) {
      return {
        value:
          profileValue(profile, 'fullName') ||
          [profileValue(profile, 'firstName'), profileValue(profile, 'lastName')].filter(Boolean).join(' '),
        reason: 'fullName'
      };
    }
    if (/e-?mail/.test(lab) || type === 'email') {
      return { value: profileValue(profile, 'email'), reason: 'email' };
    }
    if (/country.*(code|call)|phone country|dial code|calling code|phone.*country/.test(lab)) {
      return {
        value: profileValue(profile, 'phoneCountry') || profileValue(profile, 'country'),
        reason: 'phoneCountry'
      };
    }
    if ((/phone|mobile|tel/.test(lab) && !/country|social/.test(lab)) || type === 'tel') {
      return { value: profileValue(profile, 'phone'), reason: 'phone' };
    }
    if (/current location|city.*location|location \(city\)|^location$|where.*based/.test(lab)) {
      return {
        value:
          profileValue(profile, 'location') ||
          [profileValue(profile, 'city'), profileValue(profile, 'country')].filter(Boolean).join(', '),
        reason: 'location'
      };
    }
    if (/\bcity\b/.test(lab) && !/university|school/.test(lab)) {
      return { value: profileValue(profile, 'city') || profileValue(profile, 'location'), reason: 'city' };
    }
    if (/highest education|education level|degree level/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Highest Education Level') ||
          answerFromCustom(profile, 'education level') ||
          profileValue(profile, 'highestEducation') ||
          profileValue(profile, 'education'),
        reason: 'education'
      };
    }
    if (/salutation|title \(mr|mrs|ms|mx\)|^title$/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Salutation') ||
          profileValue(profile, 'salutation') ||
          answerFromCustom(profile, 'title'),
        reason: 'salutation'
      };
    }
    if (/nationality|citizenship|citizen of/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Nationality') ||
          profileValue(profile, 'nationality') ||
          profileValue(profile, 'country'),
        reason: 'nationality'
      };
    }
    if (/date of birth|birth ?date|dob|born on/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Date of Birth') ||
          answerFromCustom(profile, 'DOB') ||
          profileValue(profile, 'dateOfBirth') ||
          profileValue(profile, 'dob'),
        reason: 'dob'
      };
    }
    if (/expected salary|salary expectation|desired salary|compensation expectation/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Expected Salary') ||
          answerFromCustom(profile, 'Salary expectation') ||
          profileValue(profile, 'expectedSalary'),
        reason: 'expectedSalary'
      };
    }
    if (/current (monthly )?salary|current compensation|present salary/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Current monthly salary') ||
          answerFromCustom(profile, 'Current salary') ||
          profileValue(profile, 'currentSalary'),
        reason: 'currentSalary'
      };
    }
    if (/social media|linkedin|portfolio|website|github|personal (site|url)/.test(lab)) {
      if (/linkedin/.test(lab)) return { value: profileValue(profile, 'linkedin'), reason: 'linkedin' };
      if (/github/.test(lab)) return { value: profileValue(profile, 'github'), reason: 'github' };
      if (/portfolio/.test(lab)) {
        return {
          value: profileValue(profile, 'portfolio') || profileValue(profile, 'website'),
          reason: 'portfolio'
        };
      }
      // Generic social links text box — pack links
      var links = [
        profileValue(profile, 'linkedin'),
        profileValue(profile, 'portfolio'),
        profileValue(profile, 'website'),
        profileValue(profile, 'github')
      ]
        .filter(Boolean)
        .join('\n');
      return { value: links || answerFromCustom(profile, 'social media'), reason: 'social' };
    }
    if (/summary|cover letter|about you|additional information/.test(lab)) {
      return {
        value:
          profileValue(profile, 'resumeSummary') ||
          profileValue(profile, 'coverLetter') ||
          answerFromCustom(profile, label),
        reason: 'summary'
      };
    }
    if (/years? of (relevant )?experience|relevant experience|total experience/.test(lab)) {
      return {
        value:
          answerFromCustom(profile, 'Years of relevant experience') ||
          answerFromCustom(profile, 'Years of experience') ||
          profileValue(profile, 'yearsExperience'),
        reason: 'yearsExperience'
      };
    }

    // Yes/No employer-specific
    if (/conflict of interest/.test(lab)) {
      var coi =
        toYesNo(answerFromCustom(profile, 'conflict of interest')) ||
        toYesNo(answerFromCustom(profile, label)) ||
        'No';
      return { value: coi, reason: 'conflict', yesNo: true };
    }
    if (/pif|public investment fund|affiliates/.test(lab)) {
      var pif =
        toYesNo(answerFromCustom(profile, 'PIF')) ||
        toYesNo(answerFromCustom(profile, 'worked for PIF')) ||
        toYesNo(answerFromCustom(profile, label)) ||
        'No';
      return { value: pif, reason: 'pif', yesNo: true };
    }
    if (/currently involved|involved with (the )?company|qiddiya|work(ed|ing)? (for|at|with) (this|the) company/.test(lab)) {
      var inv =
        toYesNo(answerFromCustom(profile, 'currently involved with company')) ||
        toYesNo(answerFromCustom(profile, label)) ||
        'No';
      return { value: inv, reason: 'involvement', yesNo: true };
    }
    if (/privacy|consent|agree.*privacy|personal data|gdpr|terms and conditions|i agree/.test(lab)) {
      var priv =
        toYesNo(answerFromCustom(profile, 'privacy consent')) ||
        toYesNo(answerFromCustom(profile, label)) ||
        'Yes';
      return { value: priv, reason: 'privacy', yesNo: true };
    }
    if (/criminal|conviction|felony|misdemeanor|offence|offense/.test(lab)) {
      var crim =
        toYesNo(answerFromCustom(profile, 'criminal conviction')) ||
        toYesNo(answerFromCustom(profile, label));
      if (crim) return { value: crim, reason: 'criminal', yesNo: true };
      return { value: null, skip: false, reason: 'criminal_unknown', yesNo: true };
    }
    if (/authorized to work|work authorization|visa sponsorship|require.*sponsor/.test(lab)) {
      if (/sponsor/.test(lab)) {
        return {
          value: profileValue(profile, 'requiresSponsorship') || 'No',
          reason: 'sponsorship',
          yesNo: true
        };
      }
      return {
        value: profileValue(profile, 'authorizedToWork') || 'Yes',
        reason: 'workAuth',
        yesNo: true
      };
    }

    return { value: null, reason: 'unmapped' };
  }

  function fillVisibleFields(modal, profile) {
    var filled = 0;
    var unmatched = [];
    var answered = [];
    if (!modal) return { filled: 0, unmatched: unmatched, answered: answered };

    var inputs = modal.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'
    );

    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el) && el.offsetParent === null) continue;
      if (el.disabled || el.readOnly) continue;
      if (el.getAttribute('data-fill-apply-filled')) continue;

      var type = String(el.type || '').toLowerCase();
      if (type === 'radio') continue; // handled via yes/no groups

      var label = getLabelFor(el, modal);
      if (!label || label.length < 2) continue;

      // Skip fields inside prefilled work/education entity cards (display-only)
      if (el.closest('[class*="entity-lockup"], [class*="tvm-parent"], .experience-entity')) {
        continue;
      }

      var resolved = resolveFieldValue(profile, label, el);
      if (resolved.skip) continue;

      if (resolved.yesNo && resolved.value) {
        // Prefer radio group for this label
        var re;
        try {
          re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
        } catch (_re) {
          re = /./;
        }
        if (selectRadioInRoot(modal, re, resolved.value)) {
          filled++;
          answered.push({ label: label, answer: resolved.value, reason: resolved.reason });
          el.setAttribute('data-fill-apply-filled', '1');
          continue;
        }
      }

      if (resolved.value != null && String(resolved.value).trim() !== '') {
        // Don't overwrite strong prefilled values unless empty-ish
        var cur = String(el.value || '').trim();
        if (cur && cur.length > 1 && type !== 'checkbox' && el.tagName !== 'SELECT') {
          // Keep existing if already filled (LinkedIn often prefills contact)
          el.setAttribute('data-fill-apply-filled', '1');
          continue;
        }
        if (setNativeValue(el, resolved.value)) {
          filled++;
          answered.push({ label: label, answer: String(resolved.value).slice(0, 80), reason: resolved.reason });
          el.setAttribute('data-fill-apply-filled', '1');
        }
      } else if (el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(label)) {
        unmatched.push(label);
      }
    }

    // Checkbox / radio groups not tied to a text input (Yes/No questions)
    var ynPatterns = [
      { re: /conflict of interest/i, key: 'conflict of interest', def: 'No' },
      { re: /pif|public investment fund|affiliates/i, key: 'worked for PIF', def: 'No' },
      { re: /currently involved|involved with (the )?company|qiddiya/i, key: 'currently involved with company', def: 'No' },
      { re: /privacy|consent|agree.*privacy|personal data|i agree to/i, key: 'privacy consent', def: 'Yes' },
      { re: /criminal|conviction|felony/i, key: 'criminal conviction', def: null },
      { re: /authorized to work/i, key: 'authorizedToWork', def: profileValue(profile, 'authorizedToWork') || 'Yes' },
      { re: /visa sponsorship|require.*sponsor/i, key: 'requiresSponsorship', def: profileValue(profile, 'requiresSponsorship') || 'No' }
    ];
    for (var y = 0; y < ynPatterns.length; y++) {
      var pat = ynPatterns[y];
      var ans =
        toYesNo(answerFromCustom(profile, pat.key)) ||
        toYesNo(profileValue(profile, pat.key)) ||
        pat.def;
      if (!ans) continue;
      if (selectRadioInRoot(modal, pat.re, ans)) {
        filled++;
        answered.push({ label: pat.key, answer: ans, reason: 'yesNo_pattern' });
      }
    }

    return { filled: filled, unmatched: unmatched, answered: answered };
  }

  /* ---------- Resume upload (modal-scoped DataTransfer) ---------- */

  function resumeAlreadyUploaded(modal) {
    if (!modal) return false;
    var txt = (modal.textContent || '').replace(/\s+/g, ' ');
    if (/uploaded|document already|resume\.pdf|resume\.docx|\.pdf\b.*\d|\.docx\b/i.test(txt) &&
        /resume|cv/i.test(txt)) {
      // Heuristic: filename chip present
      if (modal.querySelector('[class*="file-name"], [class*="document-name"], .jobs-document-upload-redesign-card')) {
        return true;
      }
    }
    var inputs = modal.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].files && inputs[i].files.length > 0) return true;
    }
    return false;
  }

  function attachResumeInModal(modal, documents) {
    var Files = global.FillApplyFiles;
    if (!Files || !modal) {
      return { resumeAttached: false, error: 'FillApplyFiles or modal missing' };
    }
    if (resumeAlreadyUploaded(modal)) {
      return { resumeAttached: true, skipped: true };
    }
    var doc = documents && documents.resume;
    if (!doc || !doc.base64) {
      return { resumeAttached: false, error: 'No resume document in storage' };
    }
    var file = Files.fileFromBase64(
      doc.base64,
      doc.name || 'resume.pdf',
      doc.mime || 'application/pdf'
    );
    if (!file) return { resumeAttached: false, error: 'Could not build resume File' };

    var inputs = modal.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var meta =
        (input.name || '') +
        ' ' +
        (input.id || '') +
        ' ' +
        (input.getAttribute('accept') || '') +
        ' ' +
        getLabelFor(input, modal);
      if (/cover/i.test(meta) && !/resume|cv/i.test(meta)) continue;
      var result = Files.assignFilesToInput(input, file);
      if (result && result.ok) {
        return { resumeAttached: true, skipped: false, via: 'input' };
      }
    }

    // Click Upload / Upload resume to reveal input
    var buttons = modal.querySelectorAll('button, label, [role="button"], a');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      var t = buttonText(btn);
      if (!/upload|attach|choose file|browse|select (a )?resume|resume/i.test(t)) continue;
      if (/submit|next|review|continue/i.test(t) && !/upload|attach|file/i.test(t)) continue;
      try {
        btn.click();
      } catch (_e) {
        /* ignore */
      }
    }
    inputs = modal.querySelectorAll('input[type="file"]');
    for (var j = 0; j < inputs.length; j++) {
      var result2 = Files.assignFilesToInput(inputs[j], file);
      if (result2 && result2.ok) {
        return { resumeAttached: true, skipped: false, via: 'reveal' };
      }
    }
    return { resumeAttached: false, error: 'No file input in Easy Apply modal' };
  }

  /* ---------- Work / Education prefill respect ---------- */

  function shouldAddWorkExperience(modal, profile) {
    if (hasPrefillCards(modal, /experience|title|company|present|current/i)) return false;
    var addBtn = findAddButton(modal, /add (work )?experience|add position/i);
    if (!addBtn) return false;
    var wh = profileValue(profile, 'workHistory');
    return !!wh;
  }

  function shouldAddEducation(modal, profile) {
    if (hasPrefillCards(modal, /school|degree|university|bachelor|master|education/i)) return false;
    var addBtn = findAddButton(modal, /add education|add school/i);
    if (!addBtn) return false;
    return !!profileValue(profile, 'education');
  }

  function findAddButton(modal, re) {
    var nodes = (modal || document).querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      if (re.test(buttonText(el))) return el;
    }
    return null;
  }

  /* ---------- Navigation ---------- */

  function findNextButton(modal) {
    var root = modal || document;
    var nodes = root.querySelectorAll('button, [role="button"]');
    var nextBtn = null;
    var reviewBtn = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      var aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (/submit application/i.test(t) || /submit application/i.test(aria)) continue;
      if (/^back$/i.test(t.trim()) || /go back|dismiss|cancel|discard/i.test(t)) continue;
      if (/^review$/i.test(t.trim()) || /review your application|continue to review/i.test(t) || /review/i.test(aria) && /continue|application/i.test(aria)) {
        reviewBtn = el;
        continue;
      }
      if (
        /^next$/i.test(t.trim()) ||
        /continue to next step|next step/i.test(t) ||
        /continue to next step|next step/i.test(aria) ||
        (el.getAttribute('data-easy-apply-next-button') != null)
      ) {
        nextBtn = el;
      }
    }
    return nextBtn || reviewBtn;
  }

  function findReviewButton(modal) {
    var root = modal || document;
    var nodes = root.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (/^review$/i.test(t.trim()) || /review your application/i.test(t)) return el;
    }
    return null;
  }

  function findSubmitApplication(modal) {
    var root = modal || document;
    var nodes = root.querySelectorAll('button, [role="button"], input[type="submit"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      var aria = el.getAttribute('aria-label') || '';
      if (/submit application/i.test(t) || /submit application/i.test(aria)) return el;
      if (/^submit$/i.test(t.trim()) && /application|easy.?apply/i.test((root.textContent || '').slice(0, 500))) {
        return el;
      }
    }
    return null;
  }

  function clickFollowUpDismiss(modal) {
    // After Next, LinkedIn sometimes shows "Discard" confirmation — avoid accidental discard
    // Prefer Stay / Continue editing if present
    var root = modal || document;
    var nodes = root.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var t = buttonText(nodes[i]);
      if (/continue editing|keep editing|stay/i.test(t)) {
        try {
          nodes[i].click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    return false;
  }

  /* ---------- Main fill ---------- */

  function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var documents = ctx.documents || {};
    var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
    var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
    if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    var href = '';
    try {
      href = String((ctx && ctx.url) || (typeof location !== 'undefined' ? location.href : '') || '');
    } catch (_e) {
      href = '';
    }

    if (!doc) {
      return {
        ok: false,
        adapterId: 'linkedin',
        error: 'No document',
        filled: 0,
        unmatched: 0,
        total: 0
      };
    }

    if (detectLoginWall(doc, href)) {
      return loginWallResult();
    }

    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      var ch = global.FillApplyChallenges.detectChallenge(doc);
      if (ch && ch.challenged) {
        return {
          ok: false,
          adapterId: 'linkedin',
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

    return Promise.resolve().then(async function () {
      var totalFilled = 0;
      var unmatchedAll = [];
      var answeredAll = [];
      var advanced = false;
      var submitted = false;
      var resumeAttached = false;
      var lastStep = 'unknown';
      var maxHops = 12;

      var modal = findEasyApplyModal(doc);

      if (!modal) {
        var applyBtn = findEasyApplyButton(doc);
        if (applyBtn) {
          try {
            applyBtn.click();
            advanced = true;
            await sleep(humanDelay(700));
          } catch (_e2) {
            /* ignore */
          }
          modal = await waitForModal(doc, 6500);
        } else {
          modal = await waitForModal(doc, 1500);
        }
      }

      if (detectLoginWall(doc, typeof location !== 'undefined' ? location.href : href)) {
        return loginWallResult();
      }

      if (!modal) {
        // External Apply path (PepsiCo → careers → iCIMS, etc.)
        var extBtn = findExternalApplyButton(doc);
        if (extBtn) {
          var startHost = currentHostname();
          var shareMeta = { preference: 'off' };
          try {
            extBtn.click();
            advanced = true;
          } catch (_extClick) {
            /* ignore */
          }
          await sleep(humanDelay(600));

          var wait = await waitForShareOrNav(doc, startHost, 5500);
          if (wait.kind === 'share' && wait.modal) {
            shareMeta = setShareProfileOff(wait.modal) || shareMeta;
            shareMeta.preference = 'off';
            await sleep(humanDelay(250));
            clickShareProfileContinue(wait.modal);
            await sleep(humanDelay(700));
            wait = await waitForShareOrNav(doc, startHost, 4500);
          }

          var hostNow = currentHostname();
          if (hostNow && startHost && hostNow !== startHost && !isLinkedInHost(hostNow)) {
            var dest = tryDestinationFill(ctx);
            if (dest && typeof dest.then === 'function') dest = await dest;
            if (dest && typeof dest === 'object') {
              dest.externalApply = true;
              dest.handedOff = true;
              dest.fromAdapter = 'linkedin';
              dest.shareProfilePreference = 'off';
              if (!dest.message) {
                dest.message =
                  'LinkedIn external Apply handed off — continue with destination careers/ATS adapter';
              }
              return dest;
            }
            return handoffResult({
              shareProfilePreference: 'off',
              shareProfile: shareMeta,
              message:
                'Opened LinkedIn external Apply — runner will re-detect destination careers/ATS (e.g. iCIMS)'
            });
          }

          // Still on LinkedIn — navigation may be new-tab or delayed
          return handoffResult({
            advanced: true,
            shareProfilePreference: 'off',
            shareProfile: shareMeta,
            message:
              'LinkedIn external Apply clicked (Share profile Off when available) — if careers/ATS opened in this or another tab, runner will re-detect'
          });
        }

        var pageText = '';
        try {
          pageText = String(doc.body && doc.body.innerText ? doc.body.innerText : '').slice(0, 4000);
        } catch (_e3) {
          pageText = '';
        }
        if (
          (/responses managed off linkedin|apply on company|company website|offsite apply/i.test(pageText) ||
            /\bapply\b/i.test(pageText)) &&
          !/easy\s*apply/i.test(pageText)
        ) {
          return {
            ok: false,
            adapterId: 'linkedin',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error:
              'LinkedIn job appears to use external Apply but the Apply control was not found. Click Apply (not Easy Apply / Premium / Tailor my resume), dismiss Share your profile if shown, then Resume on the careers/ATS page.',
            filled: 0,
            unmatched: 0,
            total: 0,
            advanced: advanced,
            submitted: false,
            runMode: runMode
          };
        }
        return {
          ok: false,
          adapterId: 'linkedin',
          needsHuman: true,
          pauseReason: 'structure_drift',
          error:
            'LinkedIn Easy Apply modal did not appear — click Easy Apply manually (must be logged in), then Resume. For off-LinkedIn Apply jobs, use Apply (not Premium / Tailor my resume).',
          filled: 0,
          unmatched: 0,
          total: 0,
          advanced: advanced,
          submitted: false,
          runMode: runMode
        };
      }

      for (var hop = 0; hop < maxHops; hop++) {
        if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
          var ch2 = global.FillApplyChallenges.detectChallenge(doc);
          if (ch2 && ch2.challenged) {
            return {
              ok: false,
              adapterId: 'linkedin',
              needsHuman: true,
              challenge: ch2,
              filled: totalFilled,
              unmatched: unmatchedAll.length,
              total: totalFilled + unmatchedAll.length,
              advanced: advanced,
              submitted: false,
              error: global.FillApplyChallenges.describeChallenge(ch2),
              pauseReason: 'challenge',
              step: lastStep,
              runMode: runMode
            };
          }
        }

        modal = findEasyApplyModal(doc) || modal;
        var flow = detectStep(modal);
        lastStep = flow.step;

        // Fill visible fields on this page
        var pageFill = fillVisibleFields(modal, profile);
        totalFilled += pageFill.filled || 0;
        if (pageFill.unmatched && pageFill.unmatched.length) {
          unmatchedAll = unmatchedAll.concat(pageFill.unmatched);
        }
        if (pageFill.answered && pageFill.answered.length) {
          answeredAll = answeredAll.concat(pageFill.answered);
        }

        // Resume step — DataTransfer upload scoped to modal
        if (flow.step === 'resume' || modal.querySelector('input[type="file"]')) {
          var up = attachResumeInModal(modal, documents);
          if (up.resumeAttached) {
            resumeAttached = true;
            if (!up.skipped) totalFilled++;
          }
        }

        // Work / education: do not wipe prefilled cards
        if (flow.step === 'work') {
          if (shouldAddWorkExperience(modal, profile)) {
            // Do not invent structured cards automatically beyond leaving text if a free-form box exists
            // (LinkedIn add-flow is complex; pause in submit if empty required)
            var whBox = null;
            var areas = modal.querySelectorAll('textarea, input[type="text"]');
            for (var a = 0; a < areas.length; a++) {
              var al = norm(getLabelFor(areas[a], modal));
              if (/description|summary|title|company/.test(al) && visible(areas[a]) && !areas[a].value) {
                whBox = areas[a];
                break;
              }
            }
            if (whBox && profileValue(profile, 'workHistory')) {
              setNativeValue(whBox, profileValue(profile, 'workHistory').slice(0, 2000));
              totalFilled++;
            }
          }
        }
        if (flow.step === 'education') {
          if (shouldAddEducation(modal, profile)) {
            /* leave structured add to human if LinkedIn requires multi-field card */
          }
        }

        // Review page
        if (flow.isReview || flow.step === 'review' || findSubmitApplication(modal)) {
          lastStep = 'review';
          if (runMode === 'submit') {
            var submitBtn = findSubmitApplication(modal);
            if (submitBtn) {
              try {
                submitBtn.click();
                submitted = true;
                await sleep(humanDelay(500));
              } catch (_e4) {
                return {
                  ok: false,
                  adapterId: 'linkedin',
                  needsHuman: true,
                  pauseReason: 'structure_drift',
                  error: 'LinkedIn Easy Apply: could not click Submit application',
                  filled: totalFilled,
                  unmatched: unmatchedAll.length,
                  total: totalFilled,
                  advanced: advanced,
                  submitted: false,
                  resumeAttached: resumeAttached,
                  step: lastStep,
                  runMode: runMode
                };
              }
            } else {
              return {
                ok: false,
                adapterId: 'linkedin',
                needsHuman: true,
                pauseReason: 'structure_drift',
                error: 'LinkedIn Easy Apply: Submit application button not found on Review',
                filled: totalFilled,
                unmatched: unmatchedAll.length,
                total: totalFilled,
                advanced: advanced,
                submitted: false,
                resumeAttached: resumeAttached,
                step: lastStep,
                runMode: runMode
              };
            }
          }

          // Unknown requireds at end of fill/ready: ok; submit already handled above
          if (runMode === 'submit' && unmatchedAll.length && !submitted) {
            return {
              ok: false,
              adapterId: 'linkedin',
              needsHuman: true,
              pauseReason: 'structure_drift',
              error:
                'LinkedIn Easy Apply: unanswered required field — map customAnswers or answer manually. "' +
                String(unmatchedAll[0]).slice(0, 120) +
                '"',
              filled: totalFilled,
              unmatched: unmatchedAll.length,
              total: totalFilled + unmatchedAll.length,
              unmatchedLabels: unmatchedAll,
              answered: answeredAll,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              driftLabel: unmatchedAll[0]
            };
          }

          return {
            ok: true,
            adapterId: 'linkedin',
            filled: totalFilled,
            unmatched: unmatchedAll.length,
            total: totalFilled + unmatchedAll.length,
            advanced: advanced,
            submitted: submitted,
            resumeAttached: resumeAttached,
            answered: answeredAll,
            unmatchedLabels: unmatchedAll,
            step: submitted ? 'submitted' : 'review',
            steps: ['contact', 'resume', 'work', 'education', 'additional', 'review'],
            runMode: runMode,
            error: null
          };
        }

        // Advance: Next or Review (never Submit here)
        var navBtn = findReviewButton(modal) || findNextButton(modal);
        if (navBtn) {
          try {
            navBtn.click();
            advanced = true;
            await sleep(humanDelay(700));
            clickFollowUpDismiss(findEasyApplyModal(doc) || modal);
            await sleep(humanDelay(200));
          } catch (_e5) {
            return {
              ok: false,
              adapterId: 'linkedin',
              needsHuman: true,
              pauseReason: 'structure_drift',
              error: 'LinkedIn Easy Apply: could not click Next/Review',
              filled: totalFilled,
              unmatched: unmatchedAll.length,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode
            };
          }
        } else {
          // Stuck mid-flow
          if (runMode === 'submit') {
            return {
              ok: false,
              adapterId: 'linkedin',
              needsHuman: true,
              pauseReason: 'structure_drift',
              error:
                'LinkedIn Easy Apply: no Next/Review button — form may have validation errors or structure drift. Fix manually, then Resume.',
              filled: totalFilled,
              unmatched: unmatchedAll.length,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              unmatchedLabels: unmatchedAll
            };
          }
          return {
            ok: true,
            adapterId: 'linkedin',
            filled: totalFilled,
            unmatched: unmatchedAll.length,
            total: totalFilled + unmatchedAll.length,
            advanced: advanced,
            submitted: false,
            resumeAttached: resumeAttached,
            answered: answeredAll,
            unmatchedLabels: unmatchedAll,
            step: lastStep,
            runMode: runMode,
            error: null
          };
        }
      }

      return {
        ok: true,
        adapterId: 'linkedin',
        filled: totalFilled,
        unmatched: unmatchedAll.length,
        total: totalFilled + unmatchedAll.length,
        advanced: advanced,
        submitted: submitted,
        resumeAttached: resumeAttached,
        answered: answeredAll,
        step: lastStep,
        runMode: runMode,
        error: null
      };
    });
  }

  var adapter = {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    detectLoginWall: detectLoginWall,
    findEasyApplyModal: findEasyApplyModal,
    findEasyApplyButton: findEasyApplyButton,
    findExternalApplyButton: findExternalApplyButton,
    findShareProfileModal: findShareProfileModal,
    fieldMaps: [],
    submitSelector:
      'button[aria-label*="Submit application" i], button[aria-label*="Submit" i]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: fill
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_linkedinAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
