/**
 * eFinancialCareers adapter (board) — account-first + apply modal → employer handoff.
 *
 * Operator paste:
 * 1. Job page on efinancialcareers.com — **Sign in / Register** required (account-first).
 * 2. **Apply now** → popup "Your application": First name*, Last name*,
 *    Upload Resume* (DOC/DOCX/PDF up to 3MB), **Apply**.
 * 3. Clicking Apply shares profile with the company and **redirects to the employer
 *    website** to complete the application.
 * 4. Example destination: AIIB Career Site (aiib.org careers) with another Apply Now —
 *    hand off / re-detect destination adapter or fallback.
 *
 * Modes:
 * - fill: open modal, fill first/last + resume; do **not** click modal Apply
 * - ready / submit: after fill, click modal Apply so runner can reach employer form
 *
 * Never invent credentials. Auth wall → needsHuman pause via FillApplyAuthWalls.
 *
 * See docs/APPLICATION_GUIDE.md → "eFinancialCareers — account-first + employer handoff".
 */
(function (global) {
  'use strict';

  var HOSTS = ['efinancialcareers.com', 'www.efinancialcareers.com'];
  var HOST_RE = /efinancialcareers\.com/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        if (
          u.hostname === HOSTS[i] ||
          u.hostname.endsWith('.' + HOSTS[i].replace(/^www\./, ''))
        ) {
          return true;
        }
      }
    } catch (_e) {
      if (HOST_RE.test(url)) return true;
    }
    return false;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || '').slice(0, 14000) : '';
    } catch (_e) {
      return '';
    }
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

  function isEfcHost(hostname) {
    return HOST_RE.test(String(hostname || ''));
  }

  function resolveHref(el) {
    if (!el) return '';
    try {
      var raw =
        el.href ||
        el.getAttribute('href') ||
        el.getAttribute('data-href') ||
        el.getAttribute('data-url') ||
        el.getAttribute('data-apply-url') ||
        '';
      if (!raw || raw === '#' || /^javascript:/i.test(raw)) return '';
      return new URL(raw, typeof location !== 'undefined' ? location.href : undefined).href;
    } catch (_e) {
      return '';
    }
  }

  function profileVal(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') {
      return String(profile[key]).trim();
    }
    return '';
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var str = String(value == null ? '' : value);
    try {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      if (el.tagName === 'TEXTAREA') {
        proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
      }
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_e2) {}
    return true;
  }

  function labelFor(el, root) {
    root = root || (el && el.ownerDocument) || document;
    if (!el) return '';
    try {
      if (el.id) {
        var esc = el.id;
        try {
          if (typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(el.id);
        } catch (_eEsc) {}
        var lab = root.querySelector('label[for="' + esc + '"]');
        if (lab) return buttonText(lab);
      }
      var p = el.closest(
        'label, .form-group, .field, [class*="field"], [class*="Form"], [class*="modal"]'
      );
      if (p) return buttonText(p).slice(0, 200);
    } catch (_e) {}
    return String(
      el.getAttribute('aria-label') || el.name || el.placeholder || el.id || ''
    );
  }

  /**
   * Account-first: Sign in / Register wall. Never invent credentials.
   */
  function detectSignInRegisterWall(doc) {
    doc = doc || document;
    var href = '';
    try {
      href = String((typeof location !== 'undefined' && location.href) || '');
    } catch (_e) {}

    if (/\/(login|signin|sign-in|register|signup|sign-up|auth)\b/i.test(href)) {
      return {
        challenged: true,
        kind: 'auth_wall',
        detail: 'eFinancialCareers Sign in / Register page — account required',
        markers: ['url auth path']
      };
    }

    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.detectAuthWall) {
      var wall = global.FillApplyAuthWalls.detectAuthWall(doc, {
        requirePasswordField: false,
        extraPhrases: ['sign in / register', 'sign in or register', 'create your account']
      });
      if (wall && wall.ssoConnected) return { challenged: false, kind: null, detail: '', markers: [] };
      if (wall && wall.challenged) {
        return {
          challenged: true,
          kind: 'auth_wall',
          detail: wall.detail || 'Sign in / Register required',
          markers: wall.markers || []
        };
      }
    }

    // Prominent Sign in / Register CTAs without an open apply modal → account gate.
    var text = pageText(doc);
    var hasApplyModal = !!findApplicationModal(doc);
    var signInBtn = null;
    var registerBtn = null;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el).slice(0, 80);
      if (!t) continue;
      if (/^sign\s*in\s*\/\s*register$/i.test(t) || /^sign\s*in\s*or\s*register$/i.test(t)) {
        return {
          challenged: true,
          kind: 'auth_wall',
          detail: 'Sign in / Register required — complete manually, then Resume',
          markers: [t]
        };
      }
      if (/^(sign\s*in|log\s*in|login)$/i.test(t)) signInBtn = el;
      if (/^(register|sign\s*up|create\s*account)$/i.test(t)) registerBtn = el;
    }

    // Job page gated: Sign in + Register visible, no apply modal, apply CTA absent/disabled
    if (!hasApplyModal && signInBtn && registerBtn && /sign\s*in|register|log\s*in/i.test(text)) {
      var applyNow = findJobPageApplyControl(doc);
      if (!applyNow) {
        return {
          challenged: true,
          kind: 'auth_wall',
          detail: 'eFinancialCareers account required (Sign in / Register) — never invent credentials',
          markers: ['Sign in', 'Register']
        };
      }
    }

    // Password create/sign-in fields present
    var pw = doc.querySelectorAll('input[type="password"]');
    for (var p = 0; p < pw.length; p++) {
      if (visible(pw[p]) || pw[p].offsetParent !== null) {
        if (/sign\s*in|log\s*in|register|sign\s*up|create\s*(an\s*)?account/i.test(text)) {
          return {
            challenged: true,
            kind: 'auth_wall',
            detail: 'Sign in / Register required — complete manually, then Resume',
            markers: ['password field']
          };
        }
      }
    }

    return { challenged: false, kind: null, detail: '', markers: [] };
  }

  function authWallPause(wall) {
    return {
      ok: false,
      adapterId: 'efinancialcareers',
      needsHuman: true,
      challenge: wall || { kind: 'auth_wall' },
      pauseReason: 'auth_wall',
      accountRequired: true,
      error:
        'eFinancialCareers account required — Sign in / Register manually (never invent credentials), then Resume',
      filled: 0,
      unmatched: 0,
      total: 0,
      submitted: false,
      message:
        'eFinancialCareers account required — Sign in / Register manually, then Resume'
    };
  }

  function isUnrelatedCta(t) {
    return /sign.?in|log.?in|register|sign.?up|subscribe|newsletter|share|tweet|facebook|linkedin|save job|bookmark|filter|post a job|hire|pricing|blog|about us|contact|cookie|accept all/i.test(
      String(t || '')
    );
  }

  /**
   * Job-page Apply now (not the modal Apply submit).
   */
  function findJobPageApplyControl(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      // Prefer controls outside a modal for the initial Apply now
      if (el.closest('[role="dialog"], .modal, [class*="modal"], [class*="Modal"], [class*="popup"]')) {
        continue;
      }
      var t = buttonText(el);
      if (!t || isUnrelatedCta(t)) continue;
      var score = 0;
      if (/^apply now$/i.test(t)) score = 100;
      else if (/apply for this (job|role)/i.test(t)) score = 95;
      else if (/^apply$/i.test(t) && t.length < 12) score = 70;
      else if (/\bapply now\b/i.test(t)) score = 85;
      else if (/\bapply\b/i.test(t) && t.length < 40) score = 40;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function findApplicationModal(doc) {
    doc = doc || document;
    var candidates = doc.querySelectorAll(
      '[role="dialog"], .modal, [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"], [aria-modal="true"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!visible(el) && el.offsetParent === null) continue;
      var t = String(el.innerText || el.textContent || '').slice(0, 2000);
      var score = 0;
      if (/your application/i.test(t)) score += 50;
      if (/first\s*name/i.test(t)) score += 20;
      if (/last\s*name/i.test(t)) score += 20;
      if (/upload\s*resume|resume|cv/i.test(t)) score += 25;
      if (/\bapply\b/i.test(t)) score += 10;
      if (el.querySelector('input[type="file"]')) score += 15;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    // Fallback: any visible region with first/last + file
    if (!best || bestScore < 40) {
      var forms = doc.querySelectorAll('form, [class*="application"], [class*="Application"]');
      for (var f = 0; f < forms.length; f++) {
        var form = forms[f];
        if (!visible(form) && form.offsetParent === null) continue;
        var ft = String(form.innerText || '').slice(0, 1500);
        if (
          /first\s*name/i.test(ft) &&
          /last\s*name/i.test(ft) &&
          (form.querySelector('input[type="file"]') || /upload\s*resume|resume/i.test(ft))
        ) {
          return form;
        }
      }
    }
    return bestScore >= 40 ? best : best;
  }

  function findModalApplyButton(modal) {
    if (!modal) return null;
    var nodes = modal.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a, [role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || t.length > 40) continue;
      if (/cancel|close|x|back|browse|upload|choose file|select file/i.test(t)) continue;
      var score = 0;
      if (/^apply$/i.test(t)) score = 100;
      else if (/^apply now$/i.test(t)) score = 90;
      else if (/submit/i.test(t) && t.length < 20) score = 70;
      else if (/\bapply\b/i.test(t)) score = 50;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function findNameInput(modal, kind) {
    if (!modal) return null;
    var inputs = modal.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])');
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el) && el.offsetParent === null) continue;
      var lab = (labelFor(el, modal) + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
      var score = 0;
      if (kind === 'first') {
        if (/first\s*name|firstname|given\s*name|fname/i.test(lab)) score = 100;
        else if (/^first$/i.test(String(el.placeholder || '').trim())) score = 80;
      } else if (kind === 'last') {
        if (/last\s*name|lastname|family\s*name|surname|lname/i.test(lab)) score = 100;
        else if (/^last$/i.test(String(el.placeholder || '').trim())) score = 80;
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function attachResumeInModal(modal, documents) {
    var Files = global.FillApplyFiles;
    if (!Files || !modal) {
      return { resumeAttached: false, error: 'FillApplyFiles or modal missing' };
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
        labelFor(input, modal);
      if (/cover/i.test(meta) && !/resume|cv/i.test(meta)) continue;
      var result = Files.assignFilesToInput(input, file);
      if (result && result.ok) {
        return { resumeAttached: true, via: 'input' };
      }
    }

    // Click Upload Resume / Browse to reveal input
    var buttons = modal.querySelectorAll('button, label, [role="button"], a, span');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      var t = buttonText(btn);
      if (!/upload|attach|browse|choose file|select (a )?file|resume|cv/i.test(t)) continue;
      if (/^apply$/i.test(t) || /submit|cancel|close/i.test(t)) continue;
      try {
        btn.click();
      } catch (_e) {}
    }
    inputs = modal.querySelectorAll('input[type="file"]');
    for (var j = 0; j < inputs.length; j++) {
      var result2 = Files.assignFilesToInput(inputs[j], file);
      if (result2 && result2.ok) {
        return { resumeAttached: true, via: 'reveal' };
      }
    }
    return { resumeAttached: false, error: 'No resume file input in Your application modal' };
  }

  function fillApplicationModal(modal, profile, documents) {
    var filled = 0;
    var unmatched = [];
    var answered = [];

    var first = profileVal(profile, 'firstName');
    var last = profileVal(profile, 'lastName');
    if (!first && profileVal(profile, 'fullName')) {
      var parts = String(profile.fullName).trim().split(/\s+/);
      first = parts[0] || '';
      last = last || parts.slice(1).join(' ');
    }

    var firstEl = findNameInput(modal, 'first');
    if (firstEl && first) {
      if (setNativeValue(firstEl, first)) {
        filled++;
        answered.push({ label: 'First name', answer: first, reason: 'firstName' });
        firstEl.setAttribute('data-fill-apply-filled', '1');
      }
    } else if (!first) {
      unmatched.push('First name');
    }

    var lastEl = findNameInput(modal, 'last');
    if (lastEl && last) {
      if (setNativeValue(lastEl, last)) {
        filled++;
        answered.push({ label: 'Last name', answer: last, reason: 'lastName' });
        lastEl.setAttribute('data-fill-apply-filled', '1');
      }
    } else if (!last) {
      unmatched.push('Last name');
    }

    var resumeResult = attachResumeInModal(modal, documents);
    if (resumeResult && resumeResult.resumeAttached) {
      filled++;
      answered.push({ label: 'Upload Resume', answer: 'attached', reason: 'resume' });
    } else {
      unmatched.push('Upload Resume');
    }

    return {
      filled: filled,
      unmatched: unmatched,
      answered: answered,
      resumeAttached: !!(resumeResult && resumeResult.resumeAttached),
      resumeError: resumeResult && resumeResult.error
    };
  }

  function handoffResult(extra) {
    return Object.assign(
      {
        ok: true,
        adapterId: 'efinancialcareers',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        message:
          'Opened employer apply URL — runner will re-detect destination adapter (e.g. AIIB / company careers)'
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
    if (!next || next.id === 'efinancialcareers' || next.id === 'fallback') {
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
          fr.fromAdapter = 'efinancialcareers';
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

  var adapter = {
    id: 'efinancialcareers',
    name: 'eFinancialCareers',
    category: 'board',
    hosts: HOSTS,
    requiresAccount: true,
    accountFirst: true,
    detect: detect,
    fieldMaps: [
      { match: /first\s*name|firstname|given/i, profileKey: 'firstName' },
      { match: /last\s*name|lastname|surname|family/i, profileKey: 'lastName' }
    ],
    submitSelector:
      'button[type="submit"], input[type="submit"], button.apply, a.apply, [data-test*="apply"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|upload' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
      var profile = ctx.profile || {};
      var documents = ctx.documents || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

      var wall = detectSignInRegisterWall(doc);
      if (wall && wall.challenged) {
        return authWallPause(wall);
      }

      return Promise.resolve().then(async function () {
        var startHost = currentHostname();
        var modal = findApplicationModal(doc);

        // Open Apply now if modal not already open
        if (!modal) {
          var applyEl = findJobPageApplyControl(doc);
          var applyHref = resolveHref(applyEl);
          var externalTarget = false;
          if (applyHref) {
            try {
              var au = new URL(applyHref);
              if (au.hostname && !isEfcHost(au.hostname)) externalTarget = true;
            } catch (_e2) {}
          }

          if (applyEl) {
            if (externalTarget) {
              try {
                applyEl.click();
              } catch (_e3) {
                try {
                  if (applyHref) location.href = applyHref;
                } catch (_e4) {}
              }
              return handoffResult({
                externalUrl: applyHref,
                message:
                  'Opened external apply URL — runner will re-detect destination adapter'
              });
            }

            try {
              applyEl.click();
            } catch (_e5) {}
            await sleep(500 + Math.floor(Math.random() * 400));

            // Re-check auth after Apply click (may redirect to Sign in)
            wall = detectSignInRegisterWall(
              typeof document !== 'undefined' ? document : doc
            );
            if (wall && wall.challenged) {
              return authWallPause(wall);
            }

            modal = findApplicationModal(
              typeof document !== 'undefined' ? document : doc
            );
          }
        }

        var hostNow = currentHostname();
        if (hostNow && startHost && hostNow !== startHost && !isEfcHost(hostNow)) {
          var destEarly = tryDestinationFill(ctx);
          if (destEarly && typeof destEarly.then === 'function') destEarly = await destEarly;
          if (destEarly && typeof destEarly === 'object') {
            destEarly.externalApply = true;
            destEarly.handedOff = true;
            destEarly.fromAdapter = 'efinancialcareers';
            if (!destEarly.message) {
              destEarly.message =
                'Opened employer apply URL — continue with destination adapter';
            }
            return destEarly;
          }
          return handoffResult({
            message: 'Opened employer apply URL — continue with destination adapter'
          });
        }

        if (!modal) {
          // Maybe Apply opened a new tab / navigated
          if (findJobPageApplyControl(doc)) {
            return {
              ok: false,
              adapterId: 'efinancialcareers',
              needsHuman: true,
              pauseReason: 'structure_drift',
              error:
                'eFinancialCareers: Apply now clicked but "Your application" modal not found. Sign in if prompted, or open the employer apply URL and Resume.',
              filled: 0,
              unmatched: 0,
              total: 0
            };
          }
          return {
            ok: false,
            adapterId: 'efinancialcareers',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error:
              'eFinancialCareers: no Apply now / application modal found. Ensure you are signed in, then Resume.',
            filled: 0,
            unmatched: 0,
            total: 0,
            accountRequired: true
          };
        }

        var fillResult = fillApplicationModal(modal, profile, documents);
        await sleep(300 + Math.floor(Math.random() * 250));

        // fill mode: do not click modal Apply (avoids redirect / profile share)
        // ready + submit: click Apply to proceed to employer website
        var shouldClickModalApply = runMode === 'ready' || runMode === 'submit';
        var modalApplyClicked = false;
        var submitted = false;

        if (shouldClickModalApply) {
          var modalApply = findModalApplyButton(modal);
          if (modalApply) {
            try {
              modalApply.click();
              modalApplyClicked = true;
            } catch (_e6) {}
            await sleep(700 + Math.floor(Math.random() * 500));

            hostNow = currentHostname();
            if (hostNow && !isEfcHost(hostNow)) {
              var dest = tryDestinationFill(ctx);
              if (dest && typeof dest.then === 'function') dest = await dest;
              if (dest && typeof dest === 'object') {
                dest.externalApply = true;
                dest.handedOff = true;
                dest.fromAdapter = 'efinancialcareers';
                dest.filled = (dest.filled || 0) + (fillResult.filled || 0);
                if (!dest.message) {
                  dest.message =
                    'eFinancialCareers modal Apply → employer site — continue with destination adapter';
                }
                return dest;
              }
              return handoffResult({
                filled: fillResult.filled || 0,
                total: (fillResult.filled || 0) + (fillResult.unmatched || []).length,
                unmatched: (fillResult.unmatched || []).length,
                message:
                  'eFinancialCareers modal Apply redirected to employer — runner will re-detect destination adapter'
              });
            }

            // Still on eFC — navigation may be pending / new tab
            return handoffResult({
              filled: fillResult.filled || 0,
              total: (fillResult.filled || 0) + (fillResult.unmatched || []).length,
              unmatched: (fillResult.unmatched || []).length,
              modalApplyClicked: true,
              message:
                'eFinancialCareers Apply clicked (shares profile) — if employer site opened, runner/destination adapter should continue'
            });
          }
        }

        return {
          ok: true,
          adapterId: 'efinancialcareers',
          filled: fillResult.filled || 0,
          unmatched: (fillResult.unmatched || []).length,
          total: (fillResult.filled || 0) + (fillResult.unmatched || []).length,
          unmatchedFields: fillResult.unmatched || [],
          answered: fillResult.answered || [],
          resumeAttached: !!fillResult.resumeAttached,
          submitted: submitted,
          modalApplyClicked: modalApplyClicked,
          runMode: runMode,
          message:
            runMode === 'fill'
              ? 'Filled eFinancialCareers "Your application" modal (fill mode — Apply not clicked; ready/submit clicks Apply to reach employer)'
              : 'Filled eFinancialCareers application modal'
        };
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_efinancialcareersAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
