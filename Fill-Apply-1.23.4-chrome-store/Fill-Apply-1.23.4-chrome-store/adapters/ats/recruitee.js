/**
 * Recruitee ATS adapter — company career sites on *.recruitee.com (and branded
 * careers pages powered by Recruitee).
 *
 * User preference (SFORS / Recruitee paste):
 *   - CTAs: **Apply** OR **Apply with Indeed**
 *   - When an Indeed account exists, prefer **Apply with Indeed**
 *     (config / ctx flag `preferIndeedApply`, default **true**)
 *   - Else click **Apply** and fill the native Recruitee form via fallback
 *   - Navigation to indeed.com → handoff / re-detect Indeed adapter
 *   - Cloudflare on Indeed → existing challenges.js pause → Indeed multi-step
 *
 * See docs/APPLICATION_GUIDE.md → "Recruitee → Apply with Indeed".
 */
(function (global) {
  'use strict';

  var HOSTS = ['recruitee.com', 'www.recruitee.com'];
  var HOST_RE = /(^|\.)recruitee\.com$/i;

  /** Default: prefer Apply with Indeed when that CTA is present. */
  var DEFAULT_PREFER_INDEED_APPLY = true;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /recruitee\.com/i.test(u.hostname) || HOST_RE.test(url)) {
        return true;
      }
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/recruitee\.com/i.test(url)) return true;
    }
    if (doc) {
      try {
        var text = ((doc.body && doc.body.innerText) || '').slice(0, 10000);
        var hasIndeedCta = /apply with indeed/i.test(text);
        var hasRecruiteeMarker =
          /powered by\s*recruitee|recruitee/i.test(text) ||
          !!doc.querySelector(
            '[data-recruitee], [class*="recruitee" i], [id*="recruitee" i], a[href*="recruitee.com"], img[alt*="Recruitee" i], footer a[href*="recruitee"]'
          );
        if (hasRecruiteeMarker && (hasIndeedCta || doc.querySelector('form'))) return true;
        if (hasRecruiteeMarker && hasIndeedCta) return true;
      } catch (_e2) {}
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
      (el &&
        (el.innerText ||
          el.textContent ||
          el.value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title'))) ||
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

  function isRecruiteeHost(hostname) {
    return HOST_RE.test(String(hostname || '')) || /recruitee\.com/i.test(String(hostname || ''));
  }

  function isIndeedHost(hostname) {
    return /(^|\.)indeed\.com$/i.test(String(hostname || ''));
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

  function preferIndeedApply(ctx) {
    ctx = ctx || {};
    var opts = ctx.options || {};
    var cfg = ctx.config || {};
    if (typeof ctx.preferIndeedApply === 'boolean') return ctx.preferIndeedApply;
    if (typeof opts.preferIndeedApply === 'boolean') return opts.preferIndeedApply;
    if (typeof cfg.preferIndeedApply === 'boolean') return cfg.preferIndeedApply;
    if (typeof adapter.preferIndeedApply === 'boolean') return adapter.preferIndeedApply;
    return DEFAULT_PREFER_INDEED_APPLY;
  }

  function isUnrelatedCta(t) {
    return /sign.?up|log.?in|subscribe|newsletter|share|tweet|facebook|linkedin|save job|bookmark|filter|post a job|hire|pricing|blog|about us|contact|cookie|privacy/i.test(
      String(t || '')
    );
  }

  /**
   * Find **Apply with Indeed** (Indeed widget / Recruitee CTA).
   */
  function findApplyWithIndeed(doc) {
    doc = doc || document;
    var byAttr = doc.querySelector(
      '[data-indeed-apply-jobid], .indeed-apply-button, #indeed-apply-button, button.ia-IndeedApplyButton, a.indeed-apply-button, [class*="indeed-apply" i], [id*="indeed-apply" i]'
    );
    if (byAttr && visible(byAttr)) return byAttr;

    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || isUnrelatedCta(t)) continue;
      if (/apply with indeed/i.test(t)) return el;
      if (/^apply$/i.test(t) && /indeed/i.test(el.className + ' ' + el.id + ' ' + (el.getAttribute('data-tn-element') || ''))) {
        return el;
      }
      if (/indeed-apply|ia-IndeedApplyButton|indeedApplyButton/i.test(el.className + ' ' + el.id)) {
        return el;
      }
      var href = resolveHref(el);
      if (href && /indeed\.com/i.test(href) && /\bapply\b/i.test(t)) return el;
    }
    return null;
  }

  /**
   * Native Recruitee **Apply** (not Indeed, not unrelated chrome).
   */
  function findNativeApply(doc) {
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
      if (/apply with indeed/i.test(t)) continue;
      if (/indeed-apply|ia-IndeedApplyButton/i.test(el.className + ' ' + el.id)) continue;
      var score = 0;
      if (/^apply now$/i.test(t)) score = 100;
      else if (/apply for this (job|position|role)/i.test(t)) score = 95;
      else if (/^apply$/i.test(t) && t.length < 12) score = 90;
      else if (/\bapply now\b/i.test(t)) score = 80;
      else if (/\bapply\b/i.test(t) && !/login|sign|indeed/i.test(t) && t.length < 40) score = 55;
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
        adapterId: 'recruitee',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        message: 'Opened Apply with Indeed — runner will re-detect Indeed adapter'
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
    if (!next || next.id === 'recruitee' || next.id === 'fallback') {
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

  function hasNativeForm(doc) {
    try {
      return !!(
        doc &&
        doc.querySelector(
          'form input[type="email"], form input[name*="email" i], form textarea, form input[type="file"], form input[name*="first" i], [data-testid*="application" i] input'
        )
      );
    } catch (_e) {
      return false;
    }
  }

  function clickEl(el, hrefFallback) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (_e) {
      try {
        if (hrefFallback) {
          location.href = hrefFallback;
          return true;
        }
      } catch (_e2) {}
    }
    return false;
  }

  var adapter = {
    id: 'recruitee',
    name: 'Recruitee',
    category: 'ats',
    hosts: HOSTS,
    /** Prefer Apply with Indeed when present (user Indeed account). Override via ctx.preferIndeedApply. */
    preferIndeedApply: DEFAULT_PREFER_INDEED_APPLY,
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'button[type="submit"], input[type="submit"], button.apply, a.apply, [data-testid*="submit" i]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv', selector: 'input[type=file]' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);

      return Promise.resolve().then(async function () {
        if (!doc) {
          return {
            ok: false,
            adapterId: 'recruitee',
            error: 'No document',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        var startHost = currentHostname();
        var wantIndeed = preferIndeedApply(ctx);
        var indeedBtn = findApplyWithIndeed(doc);
        var nativeBtn = findNativeApply(doc);

        // Prefer Apply with Indeed → handoff to Indeed adapter (Cloudflare handled by challenges).
        if (wantIndeed && indeedBtn) {
          var indeedHref = resolveHref(indeedBtn);
          clickEl(indeedBtn, indeedHref);
          await sleep(500 + Math.floor(Math.random() * 400));

          var hostAfterIndeed = currentHostname();
          if (isIndeedHost(hostAfterIndeed) || (indeedHref && /indeed\.com/i.test(indeedHref))) {
            if (isIndeedHost(hostAfterIndeed)) {
              var destIndeed = tryDestinationFill(ctx);
              if (destIndeed && typeof destIndeed.then === 'function') destIndeed = await destIndeed;
              if (destIndeed && typeof destIndeed === 'object') {
                destIndeed.externalApply = true;
                destIndeed.handedOff = true;
                destIndeed.fromAdapter = 'recruitee';
                destIndeed.via = 'apply_with_indeed';
                if (!destIndeed.message) {
                  destIndeed.message =
                    'Recruitee → Indeed: continue with Indeed Easy Apply flow';
                }
                return destIndeed;
              }
            }
            return handoffResult({
              externalUrl: indeedHref || '',
              via: 'apply_with_indeed',
              message:
                'Opened Apply with Indeed — runner will re-detect Indeed adapter (Cloudflare pause if shown)'
            });
          }

          // Same-tab may still be Recruitee while Indeed widget opens / redirects
          return handoffResult({
            externalUrl: indeedHref || '',
            via: 'apply_with_indeed',
            message:
              'Clicked Apply with Indeed — awaiting navigation / Indeed flow (re-detect)'
          });
        }

        // Native Recruitee Apply
        if (nativeBtn) {
          var applyHref = resolveHref(nativeBtn);
          var externalTarget = false;
          if (applyHref) {
            try {
              var au = new URL(applyHref);
              if (au.hostname && !isRecruiteeHost(au.hostname)) externalTarget = true;
            } catch (_e3) {}
          }

          if (externalTarget) {
            clickEl(nativeBtn, applyHref);
            if (isIndeedHost((function () {
              try {
                return new URL(applyHref).hostname;
              } catch (_e) {
                return '';
              }
            })())) {
              return handoffResult({
                externalUrl: applyHref,
                via: 'apply_href_indeed',
                message: 'Opened Indeed apply URL from Recruitee — re-detect Indeed adapter'
              });
            }
            return handoffResult({
              externalUrl: applyHref,
              via: 'native_apply_external',
              message: 'Opened external apply URL from Recruitee — runner will re-detect destination'
            });
          }

          clickEl(nativeBtn, applyHref);
          await sleep(500 + Math.floor(Math.random() * 400));
        }

        var hostNow = currentHostname();
        if (hostNow && startHost && hostNow !== startHost) {
          if (isIndeedHost(hostNow)) {
            var dest = tryDestinationFill(ctx);
            if (dest && typeof dest.then === 'function') dest = await dest;
            if (dest && typeof dest === 'object') {
              dest.externalApply = true;
              dest.handedOff = true;
              dest.fromAdapter = 'recruitee';
              return dest;
            }
            return handoffResult({
              message: 'Navigated to Indeed — continue with Indeed adapter'
            });
          }
          if (!isRecruiteeHost(hostNow)) {
            var dest2 = tryDestinationFill(ctx);
            if (dest2 && typeof dest2.then === 'function') dest2 = await dest2;
            if (dest2 && typeof dest2 === 'object') {
              dest2.externalApply = true;
              dest2.handedOff = true;
              dest2.fromAdapter = 'recruitee';
              return dest2;
            }
            return handoffResult({
              message: 'Opened external apply URL — continue with destination adapter'
            });
          }
        }

        if (!hasNativeForm(doc)) {
          if (indeedBtn && !wantIndeed) {
            // preferIndeed off but Indeed present and no form yet — still try native only
          }
          if (nativeBtn || indeedBtn) {
            return {
              ok: true,
              adapterId: 'recruitee',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              message:
                'Recruitee: Apply clicked — waiting for form or Indeed handoff; Resume if needed'
            };
          }
          return {
            ok: false,
            adapterId: 'recruitee',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error:
              'Recruitee: no Apply / Apply with Indeed control or on-site form found. Open Apply manually then Resume.',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        var fb = global.FillApplyFallbackAdapter;
        if (!fb) {
          return {
            ok: false,
            adapterId: 'recruitee',
            error: 'Fallback adapter missing',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
        var result = fb.fill(
          Object.assign({}, ctx, {
            adapterId: 'recruitee',
            submitSelector: adapter.submitSelector,
            fileInputHints: adapter.fileInputHints,
            fieldMaps: adapter.fieldMaps
          })
        );
        if (result && typeof result.then === 'function') result = await result;
        if (result && typeof result === 'object' && !result.message) {
          result.message = 'Recruitee: filled native application form';
        }
        return result;
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_recruiteeAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
