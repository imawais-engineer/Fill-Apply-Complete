/**
 * We Work Remotely (WWR) adapter — PAID JOB SOURCE + full profile prerequisite.
 *
 * 1) Complete your WWR profile first (incomplete / onboarding redirects away from jobs).
 * 2) Full job access requires a paid plan (e.g. ~$2.95 first month then $14.95/mo,
 *    12-month commitment — still paid access, not a free apply unlock).
 *
 * Apply flow: many WWR job pages show **Apply now** / **Apply for this job** that
 * navigates to an **external ATS** (example: company careers "Powered by CATS" on
 * catsone.com). Never click **AI Auto-Apply** / **Auto-Apply with AI**.
 *
 * Handoff strategy (content script):
 * - Prefer clicking Apply now (not AI Auto-Apply).
 * - If the Apply link/button targets a different host, click and return
 *   `{ ok: true, deferToPageAdapter: true, externalApply: true, handedOff: true }`
 *   so the runner waits for navigation and re-injects / re-detects (CATS, Greenhouse, …).
 * - If still on weworkremotely.com with a real form, fill via fallback.
 * - If same-tab host already changed inside this fill (rare SPA), registry.detect
 *   + destination adapter.fill(ctx) when possible.
 *
 * Until paid access unlocks browse/apply: detect paywall / checkout → pause for human.
 * See docs/APPLICATION_GUIDE.md → "We Work Remotely — paid source".
 */
(function (global) {
  'use strict';

  var HOSTS = ['weworkremotely.com', 'www.weworkremotely.com'];
  var HOST_RE = /weworkremotely\.com/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        if (u.hostname === HOSTS[i] || u.hostname.endsWith('.' + HOSTS[i].replace(/^www\./, ''))) return true;
      }
    } catch (_e) {
      if (HOST_RE.test(url)) return true;
    }
    return false;
  }

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || '').slice(0, 12000) : '';
    } catch (_e) {
      return '';
    }
  }

  function detectPaywall(doc, text) {
    text = text || pageText(doc);
    if (/get full access to all we work remotely jobs/i.test(text)) return true;
    if (/accelerate your remote job search/i.test(text) && /\$\s*14\.95/i.test(text)) return true;
    if (/step\s*3\s*of\s*3/i.test(text) && (/payment method/i.test(text) || /billed now/i.test(text))) return true;
    if (/12-month commitment/i.test(text) && /\$\s*2\.95/i.test(text)) return true;
    if (/payment method/i.test(text) && /apple pay|google pay/i.test(text) && /\$\s*14\.95/i.test(text)) return true;
    return false;
  }

  function detectProfileIncomplete(doc, text, href) {
    text = text || pageText(doc);
    href = String(href || '');
    if (/\/profile|onboarding|complete.?profile|account\/setup/i.test(href)) return true;
    if (/complete your profile|finish your profile|profile is incomplete|set up your profile/i.test(text)) return true;
    return false;
  }

  function humanPause(error, extra) {
    return Object.assign(
      {
        ok: false,
        adapterId: 'weworkremotely',
        needsHuman: true,
        pauseReason: 'challenge',
        paidSource: true,
        error: error,
        filled: 0,
        unmatched: 0,
        total: 0
      },
      extra || {}
    );
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
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
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isAiAutoApplyText(t) {
    return /ai\s*auto[- ]?apply|auto[- ]?apply\s*with\s*ai|wwr\s*ai|auto apply with ai/i.test(
      String(t || '')
    );
  }

  function currentHostname() {
    try {
      return String((typeof location !== 'undefined' && location.hostname) || '');
    } catch (_e) {
      return '';
    }
  }

  function isWwrHost(hostname) {
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
        '';
      if (!raw || raw === '#' || /^javascript:/i.test(raw)) return '';
      return new URL(raw, typeof location !== 'undefined' ? location.href : undefined).href;
    } catch (_e) {
      return '';
    }
  }

  /**
   * Find Apply now / Apply for this job — never AI Auto-Apply.
   */
  function findApplyControl(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || isAiAutoApplyText(t)) continue;
      var score = 0;
      if (/^apply now$/i.test(t)) score = 100;
      else if (/apply for this job/i.test(t)) score = 95;
      else if (/^apply$/i.test(t) && t.length < 12) score = 70;
      else if (/\bapply now\b/i.test(t) && !/ai|auto/i.test(t)) score = 85;
      else if (/\bapply\b/i.test(t) && !/ai|auto|login|sign/i.test(t) && t.length < 40) score = 40;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function handoffResult(extra) {
    return Object.assign(
      {
        ok: true,
        adapterId: 'weworkremotely',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        paidSource: true,
        message: 'Opened external apply URL — continue with destination ATS adapter'
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
    if (!next || next.id === 'weworkremotely' || next.id === 'fallback') {
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
          fr.fromAdapter = 'weworkremotely';
        }
        return fr;
      }
      return null;
    }
    if (typeof next.fill !== 'function') return null;
    var result = next.fill(
      Object.assign({}, ctx, {
        adapterId: next.id,
        submitSelector: next.submitSelector,
        fileInputHints: next.fileInputHints,
        fieldMaps: next.fieldMaps,
        url: href
      })
    );
    return result;
  }

  var adapter = {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    category: 'board',
    hosts: HOSTS,
    paidSource: true,
    requiresPaidAccount: true,
    requiresCompleteProfile: true,
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[type="submit"], input[type="submit"], a.apply, button.apply',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
      var href = '';
      try {
        href = String((ctx && ctx.url) || (typeof location !== 'undefined' ? location.href : '') || '');
      } catch (_e) {}
      var text = pageText(doc);

      if (detectProfileIncomplete(doc, text, href)) {
        return humanPause(
          'We Work Remotely: complete your full profile on the platform first, then Resume. Incomplete profiles block job access.',
          { profileIncomplete: true }
        );
      }

      if (detectPaywall(doc, text)) {
        return humanPause(
          'We Work Remotely paywall / checkout detected (paid plan). Complete payment only if you intend to subscribe, then Resume. Fill & Apply will not purchase plans or fake applies.',
          { paywall: true }
        );
      }

      return Promise.resolve().then(async function () {
        var startHost = currentHostname();
        var applyEl = findApplyControl(doc);
        var applyHref = resolveHref(applyEl);
        var externalTarget = false;
        if (applyHref) {
          try {
            var au = new URL(applyHref);
            if (au.hostname && !isWwrHost(au.hostname)) externalTarget = true;
          } catch (_e2) {}
        }

        // Prefer Apply now / Apply for this job; never AI Auto-Apply.
        if (applyEl) {
          if (externalTarget) {
            try {
              applyEl.click();
            } catch (_e3) {
              try {
                if (applyHref) location.href = applyHref;
              } catch (_e4) {}
            }
            // Cross-host navigation kills this document — ask runner to re-inject.
            return handoffResult({
              externalUrl: applyHref,
              message:
                'Opened external apply URL — runner will re-detect destination ATS (e.g. CATS)'
            });
          }

          try {
            applyEl.click();
          } catch (_e5) {}
          await sleep(600 + Math.floor(Math.random() * 400));
        }

        var hostNow = currentHostname();
        // Same-tab host change (or SPA) — hand off inside content script when possible.
        if (hostNow && startHost && hostNow !== startHost && !isWwrHost(hostNow)) {
          var dest = tryDestinationFill(ctx);
          if (dest && typeof dest.then === 'function') dest = await dest;
          if (dest && typeof dest === 'object') {
            dest.externalApply = true;
            dest.handedOff = true;
            dest.fromAdapter = 'weworkremotely';
            if (!dest.message) {
              dest.message =
                'Opened external apply URL — continue with destination ATS adapter';
            }
            return dest;
          }
          return handoffResult({
            message:
              'Opened external apply URL — continue with destination ATS adapter'
          });
        }

        var hasRealForm = false;
        try {
          hasRealForm = !!(
            doc &&
            doc.querySelector(
              'form input[type="email"], form input[name*="email" i], form textarea, form input[type="file"]'
            )
          );
        } catch (_e6) {}

        if (!hasRealForm) {
          // Apply may have opened a new tab; signal handoff without failing the job hard.
          if (applyEl) {
            return handoffResult({
              message:
                'Apply now clicked — if a new tab/host opened, runner/destination ATS should continue; do not use WWR AI Auto-Apply'
            });
          }
          return humanPause(
            'We Work Remotely: no unlocked application form yet. Need full profile + paid access, then paste the real apply UI for hardening.',
            { awaitingPaidAccess: true }
          );
        }

        var fb = global.FillApplyFallbackAdapter;
        if (!fb) {
          return {
            ok: false,
            adapterId: 'weworkremotely',
            error: 'Fallback adapter missing',
            filled: 0,
            unmatched: 0,
            total: 0,
            paidSource: true
          };
        }
        var result = fb.fill(
          Object.assign({}, ctx, {
            adapterId: 'weworkremotely',
            submitSelector: adapter.submitSelector,
            fileInputHints: adapter.fileInputHints,
            fieldMaps: adapter.fieldMaps
          })
        );
        if (result && typeof result.then === 'function') result = await result;
        if (result && typeof result === 'object') result.paidSource = true;
        return result;
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
})(typeof globalThis !== 'undefined' ? globalThis : self);
