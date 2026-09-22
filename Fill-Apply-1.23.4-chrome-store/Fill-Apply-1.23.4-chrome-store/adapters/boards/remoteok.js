/**
 * Remote OK adapter (board) — PAID JOB SOURCE (no free trial).
 *
 * Apply / early access often requires a Remote OK subscription (Single Platform or
 * TopAccess Bundle). Full apply-form automation is deferred until the operator has
 * a paid unlocked account. Until then: detect job page, geolock warnings, and
 * paywall ("You're almost there" / Subscribe) → pause for human; do not fake apply.
 *
 * See docs/APPLICATION_GUIDE.md → "Remote OK — paid source".
 */
(function (global) {
  'use strict';

  var HOSTS = ['remoteok.com', 'www.remoteok.com', 'remoteok.io', 'www.remoteok.io'];
  var HOST_RE = /remoteok\.(com|io)/i;

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
    if (/you'?re almost there/i.test(text) && /subscribe/i.test(text)) return true;
    if (/single platform/i.test(text) && /only remote ok/i.test(text) && /\$\s*14\.95/i.test(text)) return true;
    if (/topaccess bundle/i.test(text) && /\$\s*29\.95/i.test(text)) return true;
    if (/subscribe to remote ok/i.test(text) || /subscribe to topaccess/i.test(text)) return true;
    if (/no free trial/i.test(text) && /remote ok/i.test(text) && /subscribe/i.test(text)) return true;
    return false;
  }

  function detectGeolock(doc, text) {
    text = text || pageText(doc);
    if (/geolocked/i.test(text) && /only accept applicants/i.test(text)) return true;
    if (/poster of this job has geolocked/i.test(text)) return true;
    return false;
  }

  function humanPause(error, extra) {
    return Object.assign(
      {
        ok: false,
        adapterId: 'remoteok',
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

  var adapter = {
    id: 'remoteok',
    name: 'Remote OK',
    category: 'board',
    hosts: HOSTS,
    /** Paid marketplace — subscription required; no free trial. */
    paidSource: true,
    requiresPaidAccount: true,
    noFreeTrial: true,
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[type="submit"], input[type="submit"], a.apply, button.apply',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
      var text = pageText(doc);

      if (detectPaywall(doc, text)) {
        return humanPause(
          'Remote OK paywall detected (paid source, no free trial). Unlock with a paid Remote OK account, then Resume. Full apply automation waits until access is unlocked.',
          { paywall: true }
        );
      }

      if (detectGeolock(doc, text)) {
        return humanPause(
          'Remote OK geolock warning on this job. Confirm eligibility (or dismiss only if you qualify), then Resume. Do not bypass geolocks.',
          { geolock: true }
        );
      }

      // Keyword spam-filter on some posts ("Please mention the word …") — leave for human cover letter
      var keywordHint = text.match(/please mention the word\s+([A-Z0-9_-]+)/i);
      if (keywordHint && ctx && ctx.runMode === 'submit') {
        // Still allow fill of standard fields if a real form exists; flag for report
      }

      var hasRealForm = false;
      try {
        hasRealForm = !!(
          doc &&
          doc.querySelector(
            'form input[type="email"], form input[name*="email" i], form textarea[name*="cover" i], form input[type="file"]'
          )
        );
      } catch (_e2) {}

      if (!hasRealForm) {
        return humanPause(
          'Remote OK: no unlocked application form yet (paid source). After Subscribe / Apply unlocks the real form, re-run or paste again for adapter hardening.',
          { awaitingPaidAccess: true }
        );
      }

      var fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return { ok: false, adapterId: 'remoteok', error: 'Fallback adapter missing', filled: 0, unmatched: 0, total: 0 };
      }
      var result = fb.fill(
        Object.assign({}, ctx, {
          adapterId: 'remoteok',
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: adapter.fieldMaps
        })
      );
      if (result && typeof result === 'object') {
        result.paidSource = true;
        if (keywordHint) result.applyKeywordHint = keywordHint[1];
      }
      return result;
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
})(typeof globalThis !== 'undefined' ? globalThis : self);
