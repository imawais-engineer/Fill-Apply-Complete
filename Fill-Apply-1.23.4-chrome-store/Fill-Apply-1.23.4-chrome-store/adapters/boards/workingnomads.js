/**
 * Working Nomads adapter (board) — discovery board; Apply often opens an
 * **external ATS** (commonly Greenhouse: boards.greenhouse.io / job-boards.greenhouse.io).
 *
 * Examples (operator paste):
 *   - GitLab Manager Strategic Finance → classic Greenhouse form
 *   - Figma Strategic Finance → Greenhouse embed (Autofill optional, Submit application)
 *
 * Handoff strategy (content script), same pattern as We Work Remotely:
 * - Click **Apply** / **Apply now** / **Apply for this job** (not unrelated CTAs).
 * - If the Apply link targets a different host, click and return
 *   `{ ok: true, deferToPageAdapter: true, externalApply: true, handedOff: true }`
 *   so the runner waits for navigation and re-injects / re-detects (Greenhouse, …).
 * - If same-tab host already changed, registry.detect + destination adapter.fill(ctx).
 * - If still on workingnomads.com with a real form, fill via fallback.
 *
 * See docs/APPLICATION_GUIDE.md → "Working Nomads → Greenhouse handoff".
 */
(function (global) {
  'use strict';

  var HOSTS = ['workingnomads.com', 'www.workingnomads.com'];
  var HOST_RE = /workingnomads\.com/i;

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

  function isWnHost(hostname) {
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

  function isUnrelatedCta(t) {
    return /sign.?up|log.?in|subscribe|newsletter|share|tweet|facebook|linkedin|save job|bookmark|filter|remote only|post a job|hire|pricing|blog|about us|contact/i.test(
      String(t || '')
    );
  }

  /**
   * Find Apply / Apply now / Apply for this job — skip unrelated board chrome.
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
      if (!t || isUnrelatedCta(t)) continue;
      var score = 0;
      if (/^apply now$/i.test(t)) score = 100;
      else if (/apply for this job/i.test(t)) score = 95;
      else if (/^apply$/i.test(t) && t.length < 12) score = 85;
      else if (/\bapply now\b/i.test(t)) score = 80;
      else if (/\bapply\b/i.test(t) && !/login|sign/i.test(t) && t.length < 40) score = 50;
      // Prefer links that already point off Working Nomads (Greenhouse etc.)
      var href = resolveHref(el);
      if (href) {
        try {
          var hu = new URL(href);
          if (hu.hostname && !isWnHost(hu.hostname)) {
            if (/greenhouse\.io/i.test(hu.hostname)) score += 25;
            else score += 10;
          }
        } catch (_e) {}
      }
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
        adapterId: 'workingnomads',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
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
    if (!next || next.id === 'workingnomads' || next.id === 'fallback') {
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
          fr.fromAdapter = 'workingnomads';
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
    id: 'workingnomads',
    name: 'Working Nomads',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'a[href*="greenhouse"], a.apply, button.apply, button[type="submit"], input[type="submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);

      return Promise.resolve().then(async function () {
        var startHost = currentHostname();
        var applyEl = findApplyControl(doc);
        var applyHref = resolveHref(applyEl);
        var externalTarget = false;
        if (applyHref) {
          try {
            var au = new URL(applyHref);
            if (au.hostname && !isWnHost(au.hostname)) externalTarget = true;
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
                'Opened external apply URL — runner will re-detect destination ATS (e.g. Greenhouse)'
            });
          }

          try {
            applyEl.click();
          } catch (_e5) {}
          await sleep(600 + Math.floor(Math.random() * 400));
        }

        var hostNow = currentHostname();
        if (hostNow && startHost && hostNow !== startHost && !isWnHost(hostNow)) {
          var dest = tryDestinationFill(ctx);
          if (dest && typeof dest.then === 'function') dest = await dest;
          if (dest && typeof dest === 'object') {
            dest.externalApply = true;
            dest.handedOff = true;
            dest.fromAdapter = 'workingnomads';
            if (!dest.message) {
              dest.message =
                'Opened external apply URL — continue with destination ATS adapter';
            }
            return dest;
          }
          return handoffResult({
            message: 'Opened external apply URL — continue with destination ATS adapter'
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
          if (applyEl) {
            return handoffResult({
              message:
                'Apply clicked — if a new tab/host opened (Greenhouse etc.), runner/destination ATS should continue'
            });
          }
          return {
            ok: false,
            adapterId: 'workingnomads',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error:
              'Working Nomads: no Apply control or on-site form found. Paste the job Apply URL (often Greenhouse) into the queue, or open Apply manually then Resume.',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        var fb = global.FillApplyFallbackAdapter;
        if (!fb) {
          return {
            ok: false,
            adapterId: 'workingnomads',
            error: 'Fallback adapter missing',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
        var result = fb.fill(
          Object.assign({}, ctx, {
            adapterId: 'workingnomads',
            submitSelector: adapter.submitSelector,
            fileInputHints: adapter.fileInputHints,
            fieldMaps: adapter.fieldMaps
          })
        );
        if (result && typeof result.then === 'function') result = await result;
        return result;
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_workingnomadsAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
