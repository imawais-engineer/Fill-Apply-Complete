/**
 * Platform-wide human challenge detection (Cloudflare Turnstile / interstitials,
 * interactable reCAPTCHA / hCaptcha). Injectable into job tabs.
 * Optional auth-wall bridge via FillApplyAuthWalls (lib/auth-walls.js).
 *
 * Does NOT auto-click challenges. Footer-only "protected by reCAPTCHA" text is
 * ignored — pause only when a visible/interactable challenge is present.
 *
 * Settle gate: detectChallengeWithSettle waits ~10s and re-checks before pausing.
 * If the challenge clears, or a CAPTCHA widget coexists with a fillable application
 * form (common on Greenhouse boards), fill continues instead of an instant pause.
 *
 * Attaches FillApplyChallenges to globalThis.
 */
(function (global) {
  'use strict';

  var CLOUDFLARE_MARKERS = [
    'additional verification required',
    'verify you are human',
    'just a moment',
    'checking your browser',
    'attention required',
    'enable javascript and cookies',
    'cf-turnstile',
    'challenge-platform',
    'ray id'
  ];

  function pageText(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return '';
    var title = '';
    try {
      title = (doc.title || '') + ' ';
    } catch (_e) {
      /* ignore */
    }
    var body = '';
    try {
      body = (doc.body && (doc.body.innerText || doc.body.textContent)) || '';
    } catch (_e2) {
      body = '';
    }
    // Cap scan size for hot paths
    return (title + body).slice(0, 12000).toLowerCase();
  }

  function hasSelector(doc, sel) {
    try {
      return !!(doc && doc.querySelector(sel));
    } catch (_e) {
      return false;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      var style = el.ownerDocument && el.ownerDocument.defaultView
        ? el.ownerDocument.defaultView.getComputedStyle(el)
        : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return false;
      }
      var r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch (_e) {
      return true;
    }
  }

  /**
   * Cloudflare interstitial / Turnstile (not a privacy footer).
   */
  function detectCloudflare(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    var title = '';
    try {
      title = String(doc.title || '');
    } catch (_e) {
      title = '';
    }
    if (/just a moment/i.test(title)) {
      return {
        kind: 'cloudflare',
        detail: 'Tab title: Just a moment…',
        markers: ['Just a moment']
      };
    }

    var markers = [];
    if (hasSelector(doc, '#challenge-form, #challenge-stage, .cf-turnstile, [data-sitekey].cf-turnstile')) {
      markers.push('cf-turnstile/challenge-form');
    }
    if (hasSelector(doc, 'iframe[src*="challenges.cloudflare.com"], iframe[src*="challenge-platform"]')) {
      markers.push('challenge-platform iframe');
    }
    if (hasSelector(doc, 'script[src*="challenge-platform"], script[src*="turnstile"]')) {
      markers.push('challenge-platform script');
    }

    var text = pageText(doc);
    CLOUDFLARE_MARKERS.forEach(function (m) {
      if (text.indexOf(m) !== -1) markers.push(m);
    });

    // Require a strong interstitial signal (not alone "ray id" buried in footer of normal pages)
    var strong =
      /just a moment|additional verification required|verify you are human|checking your browser|attention required/i.test(
        title + ' ' + text.slice(0, 2000)
      ) ||
      hasSelector(doc, '#challenge-form, #challenge-stage, .cf-turnstile') ||
      hasSelector(doc, 'iframe[src*="challenges.cloudflare.com"], iframe[src*="challenge-platform"]');

    if (!strong) return null;

    // Deduplicate markers
    var seen = {};
    var uniq = [];
    markers.forEach(function (m) {
      if (!seen[m]) {
        seen[m] = true;
        uniq.push(m);
      }
    });

    return {
      kind: 'cloudflare',
      detail: 'Cloudflare verification required',
      markers: uniq
    };
  }

  /**
   * Interactable CAPTCHA checkbox / challenge iframe (not footer "protected by reCAPTCHA" alone).
   * Explicitly detects hCaptcha (`.h-captcha`, hcaptcha.com iframes, "Protected by hCaptcha"
   * when paired with a visible widget — iCIMS / PepsiCo welcome often shows this).
   */
  function detectCaptchaChallenge(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    var iframes = doc.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="reCAPTCHA"], iframe[title*="hCaptcha"], iframe[src*="captcha"], iframe[src*="newassets.hcaptcha.com"]'
    );
    var interactable = [];
    var hcaptchaFrame = false;
    for (var i = 0; i < iframes.length; i++) {
      var frame = iframes[i];
      var src = (frame.getAttribute('src') || '').toLowerCase();
      var title = (frame.getAttribute('title') || '').toLowerCase();
      // Privacy/badge footers are tiny; challenge widgets are larger
      if (!isVisible(frame)) continue;
      var r = frame.getBoundingClientRect();
      if (/hcaptcha|h-captcha/i.test(src + ' ' + title)) hcaptchaFrame = true;
      var isBadge = r.height < 80 && r.width < 320 && /badge|bframe/i.test(src) === false;
      // Explicit challenge frames
      if (/anchor|bframe|checkbox|challenge|hcaptcha\.com\/captcha|newassets\.hcaptcha/i.test(src) || r.height >= 60) {
        if (r.height >= 40 || /anchor|bframe|hcaptcha/i.test(src + ' ' + title)) {
          interactable.push({
            src: src.slice(0, 120),
            w: Math.round(r.width),
            h: Math.round(r.height),
            vendor: /hcaptcha/i.test(src + ' ' + title) ? 'hcaptcha' : 'captcha'
          });
        }
      } else if (!isBadge && r.height >= 60) {
        interactable.push({
          src: src.slice(0, 120),
          w: Math.round(r.width),
          h: Math.round(r.height)
        });
      }
    }

    // Visible checkbox widgets (reCAPTCHA + hCaptcha containers)
    var widgets = doc.querySelectorAll(
      '.g-recaptcha:not([data-size="invisible"]), .h-captcha, [class*="h-captcha"], [data-hcaptcha-widget-id], [data-callback][data-sitekey], #rc-anchor-container, .rc-anchor, iframe[data-hcaptcha-widget-id]'
    );
    var visibleWidget = false;
    var hcaptchaWidget = false;
    for (var j = 0; j < widgets.length; j++) {
      if (isVisible(widgets[j])) {
        visibleWidget = true;
        var cls = String(widgets[j].className || '') + ' ' + (widgets[j].id || '');
        if (/h-?captcha/i.test(cls) || widgets[j].getAttribute('data-hcaptcha-widget-id') != null) {
          hcaptchaWidget = true;
        }
        break;
      }
    }
    // Re-scan for hCaptcha class even if first visible widget was reCAPTCHA
    if (!hcaptchaWidget) {
      for (var k = 0; k < widgets.length; k++) {
        if (!isVisible(widgets[k])) continue;
        var cls2 = String(widgets[k].className || '');
        if (/h-?captcha/i.test(cls2) || widgets[k].getAttribute('data-hcaptcha-widget-id') != null) {
          hcaptchaWidget = true;
          visibleWidget = true;
          break;
        }
      }
    }

    var text = pageText(doc);
    var protectedHcaptcha = /protected by hcaptcha|protected by h-captcha/i.test(text);
    // "Protected by hCaptcha" alone (footer badge) does NOT pause — need widget/iframe
    if (protectedHcaptcha && (visibleWidget || interactable.length || hcaptchaFrame || hcaptchaWidget)) {
      hcaptchaWidget = true;
      visibleWidget = true;
    }

    // Invisible reCAPTCHA (data-size=invisible) alone does NOT pause
    if (!interactable.length && !visibleWidget) return null;

    var markers = interactable.length
      ? interactable.map(function (x) {
          return (x.vendor === 'hcaptcha' ? 'hcaptcha iframe ' : 'iframe ') + x.w + 'x' + x.h;
        })
      : [];
    if (hcaptchaWidget || hcaptchaFrame || protectedHcaptcha) {
      markers.push(protectedHcaptcha ? 'Protected by hCaptcha' : 'h-captcha widget');
    }
    if (!markers.length) markers.push('visible captcha widget');

    return {
      kind: 'captcha',
      detail:
        hcaptchaWidget || hcaptchaFrame || protectedHcaptcha
          ? 'hCaptcha challenge is interactable — complete it manually'
          : 'CAPTCHA challenge is interactable — complete it manually',
      markers: markers,
      vendor: hcaptchaWidget || hcaptchaFrame || protectedHcaptcha ? 'hcaptcha' : undefined
    };
  }

  /**
   * @returns {{ challenged: boolean, kind: string|null, detail: string, markers: string[] }}
   */
  function detectChallenge(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    var cf = detectCloudflare(doc);
    if (cf) {
      return {
        challenged: true,
        kind: cf.kind,
        detail: cf.detail,
        markers: cf.markers || []
      };
    }
    var cap = detectCaptchaChallenge(doc);
    if (cap) {
      return {
        challenged: true,
        kind: cap.kind,
        detail: cap.detail,
        markers: cap.markers || [],
        vendor: cap.vendor
      };
    }
    return { challenged: false, kind: null, detail: '', markers: [] };
  }

  function describeChallenge(result) {
    if (!result || !result.challenged) return '';
    var kind =
      result.kind === 'cloudflare'
        ? 'Cloudflare'
        : result.kind === 'captcha'
          ? result.vendor === 'hcaptcha' || /hcaptcha/i.test(String(result.detail || ''))
            ? 'hCaptcha'
            : 'CAPTCHA'
          : 'Challenge';
    return kind + ': ' + (result.detail || 'action needed');
  }

  /**
   * Optional bridge to FillApplyAuthWalls (lib/auth-walls.js) when injected.
   * Sign in / Register / Create a login / Password Re-enter → human gate.
   */
  function detectAuthWall(doc, opts) {
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.detectAuthWall) {
      return global.FillApplyAuthWalls.detectAuthWall(doc, opts);
    }
    return { challenged: false, kind: null, detail: '', markers: [], passwordFields: 0 };
  }

  /** Default settle window before treating a challenge as blocking. */
  var CHALLENGE_SETTLE_MS = 10000;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * True when the page already exposes a usable application form (name/email/phone/
   * resume/etc.). Used to distinguish a footer/widget CAPTCHA coexisting with a
   * fillable Greenhouse-style form from a real blocking challenge.
   */
  function applicationFormLooksFillable(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return false;

    var title = '';
    try {
      title = String(doc.title || '');
    } catch (_e) {
      title = '';
    }
    // Full-page Cloudflare interstitial is never "fillable"
    if (/just a moment/i.test(title)) return false;
    if (
      hasSelector(doc, '#challenge-form, #challenge-stage') &&
      /just a moment|checking your browser|attention required|additional verification required/i.test(
        title + ' ' + pageText(doc).slice(0, 800)
      )
    ) {
      return false;
    }

    var inputs = doc.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"],' +
        'input:not([type]), textarea, select, input[type="file"]'
    );
    var count = 0;
    for (var i = 0; i < inputs.length && count < 3; i++) {
      var el = inputs[i];
      if (!el || el.disabled || el.readOnly) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'password' || type === 'hidden') continue;
      if (!isVisible(el) && el.offsetParent === null) continue;
      count++;
    }
    return count >= 2;
  }

  /**
   * After settle: should we still pause the run?
   * - No challenge → do not pause
   * - Cloudflare interstitial → pause
   * - CAPTCHA widget with a fillable application form → do not pause (fill continues;
   *   real submit-time CAPTCHAs are handled later / by human on Resume)
   * - CAPTCHA with no usable form → pause
   */
  function shouldPauseForChallenge(result, doc) {
    if (!result || !result.challenged) return false;
    if (result.kind === 'cloudflare') return true;
    if (result.kind === 'captcha' && applicationFormLooksFillable(doc)) return false;
    return true;
  }

  /**
   * Detect → wait ~settleMs → re-detect. Only treat as blocking if still present
   * and not a false-positive widget on a fillable form.
   *
   * @param {Document} [doc]
   * @param {{ settleMs?: number, skipWait?: boolean }} [opts]
   * @returns {Promise<object>}
   */
  function detectChallengeWithSettle(doc, opts) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    opts = opts || {};
    var settleMs =
      opts.settleMs != null ? Number(opts.settleMs) : CHALLENGE_SETTLE_MS;
    if (!(settleMs >= 0)) settleMs = CHALLENGE_SETTLE_MS;

    var first = detectChallenge(doc);
    if (!first || !first.challenged || opts.skipWait) {
      var immediate = Object.assign({}, first || { challenged: false, kind: null, detail: '', markers: [] });
      immediate.settled = true;
      immediate.waited = false;
      if (immediate.challenged && !shouldPauseForChallenge(immediate, doc)) {
        return Promise.resolve({
          challenged: false,
          kind: null,
          detail: '',
          markers: [],
          settled: true,
          waited: false,
          suppressed: true,
          priorChallenge: immediate,
          formFillable: true
        });
      }
      return Promise.resolve(immediate);
    }

    return sleep(settleMs).then(function () {
      var second = detectChallenge(doc);
      if (!second || !second.challenged) {
        return {
          challenged: false,
          kind: null,
          detail: '',
          markers: [],
          settled: true,
          waited: true,
          clearedAfterWait: true,
          priorChallenge: first
        };
      }
      if (!shouldPauseForChallenge(second, doc)) {
        return {
          challenged: false,
          kind: null,
          detail: '',
          markers: [],
          settled: true,
          waited: true,
          suppressed: true,
          priorChallenge: second,
          formFillable: true
        };
      }
      var out = Object.assign({}, second);
      out.settled = true;
      out.waited = true;
      out.priorChallenge = first;
      return out;
    });
  }

  global.FillApplyChallenges = {
    detectChallenge: detectChallenge,
    detectCloudflare: detectCloudflare,
    detectCaptchaChallenge: detectCaptchaChallenge,
    describeChallenge: describeChallenge,
    detectAuthWall: detectAuthWall,
    applicationFormLooksFillable: applicationFormLooksFillable,
    shouldPauseForChallenge: shouldPauseForChallenge,
    detectChallengeWithSettle: detectChallengeWithSettle,
    CHALLENGE_SETTLE_MS: CHALLENGE_SETTLE_MS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
