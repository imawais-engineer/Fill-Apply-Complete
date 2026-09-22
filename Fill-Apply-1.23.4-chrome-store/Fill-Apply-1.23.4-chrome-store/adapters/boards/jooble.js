/**
 * Jooble adapter (board) — discovery aggregator; Apply often leaves jooble.org.
 *
 * Jooble often opens **Swooped** (assisted-apply intermediary) or an employer ATS
 * (Greenhouse, Lever, company careers, …). Prefer clicking **Apply** / synonyms;
 * never follow Swooped Auto Apply / Upgrade from this board step.
 *
 * Handoff strategy (content script), same pattern as We Work Remotely:
 * - Click Apply / Apply now / Apply for this job (not unrelated CTAs).
 * - If Apply targets a different host (or navigation leaves jooble.org), return
 *   `{ ok: true, deferToPageAdapter: true, externalApply: true, handedOff: true }`
 *   so the runner waits for navigation and re-injects / re-detects (Swooped, ATS, …).
 * - If same-tab host already changed, registry.detect + destination adapter.fill(ctx).
 * - If still on jooble.org with a real form, fill via fallback.
 *
 * See docs/APPLICATION_GUIDE.md → "Jooble → Swooped / external ATS".
 */
(function (global) {
  'use strict';

  var HOSTS = ['jooble.org', 'www.jooble.org'];
  var HOST_RE = /jooble\.org/i;

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

  function isJoobleHost(hostname) {
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
    return /sign.?up|log.?in|subscribe|newsletter|share|tweet|facebook|linkedin|save job|bookmark|filter|post a job|hire|pricing|blog|about us|contact|auto[- ]?apply|upgrade/i.test(
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
      else if (/apply for this role/i.test(t)) score = 92;
      else if (/^apply$/i.test(t) && t.length < 12) score = 85;
      else if (/\bapply now\b/i.test(t)) score = 80;
      else if (/\bapply\b/i.test(t) && !/login|sign/i.test(t) && t.length < 40) score = 50;
      var href = resolveHref(el);
      if (href) {
        try {
          var hu = new URL(href);
          if (hu.hostname && !isJoobleHost(hu.hostname)) {
            if (/swooped\.co/i.test(hu.hostname)) score += 20;
            else if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com/i.test(hu.hostname))
              score += 25;
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
        adapterId: 'jooble',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        message:
          'Opened external apply URL — runner will re-detect destination (Swooped or employer ATS)'
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
    if (!next || next.id === 'jooble' || next.id === 'fallback') {
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
          fr.fromAdapter = 'jooble';
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
    id: 'jooble',
    name: 'Jooble',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'a.apply, button.apply, a[href*="apply"], button[type="submit"], input[type="submit"]',
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
            if (au.hostname && !isJoobleHost(au.hostname)) externalTarget = true;
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
            // Cross-host navigation — Jooble often opens Swooped or employer ATS.
            return handoffResult({
              externalUrl: applyHref,
              message:
                'Opened external apply URL — runner will re-detect destination (Swooped or employer ATS)'
            });
          }

          try {
            applyEl.click();
          } catch (_e5) {}
          await sleep(600 + Math.floor(Math.random() * 400));
        }

        var hostNow = currentHostname();
        // Navigation away from jooble.org → hand off like WWR (externalApply / re-detect).
        if (hostNow && startHost && hostNow !== startHost && !isJoobleHost(hostNow)) {
          var dest = tryDestinationFill(ctx);
          if (dest && typeof dest.then === 'function') dest = await dest;
          if (dest && typeof dest === 'object') {
            dest.externalApply = true;
            dest.handedOff = true;
            dest.fromAdapter = 'jooble';
            if (!dest.message) {
              dest.message =
                'Opened external apply URL — continue with destination adapter (Swooped or ATS)';
            }
            return dest;
          }
          return handoffResult({
            message:
              'Opened external apply URL — continue with destination adapter (Swooped or ATS)'
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
                'Apply clicked — if a new tab/host opened (Swooped or employer ATS), runner/destination adapter should continue'
            });
          }
          return {
            ok: false,
            adapterId: 'jooble',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error:
              'Jooble: no Apply control or on-site form found. Paste the destination apply URL (Swooped / employer ATS) into the queue, or open Apply manually then Resume.',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        var fb = global.FillApplyFallbackAdapter;
        if (!fb) {
          return {
            ok: false,
            adapterId: 'jooble',
            error: 'Fallback adapter missing',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
        var result = fb.fill(
          Object.assign({}, ctx, {
            adapterId: 'jooble',
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
  global.FillApply_joobleAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
