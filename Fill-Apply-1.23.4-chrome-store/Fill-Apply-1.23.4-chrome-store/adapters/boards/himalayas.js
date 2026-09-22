/**
 * Himalayas adapter (board) — Thin detect stub — fill delegates to fallback heuristics. Boards often redirect into an ATS adapter at apply time.
 */
(function (global) {
  'use strict';

  var HOSTS = ['himalayas.app', 'www.himalayas.app'];
  var HOST_RE = /himalayas\.app/i;

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

  var adapter = {
    id: 'himalayas',
    name: 'Himalayas',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[type="submit"], input[type="submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      var fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return { ok: false, adapterId: 'himalayas', error: 'Fallback adapter missing', filled: 0, unmatched: 0, total: 0 };
      }
      return fb.fill(Object.assign({}, ctx, {
        adapterId: 'himalayas',
        submitSelector: adapter.submitSelector,
        fileInputHints: adapter.fileInputHints,
        fieldMaps: adapter.fieldMaps
      }));
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
})(typeof globalThis !== 'undefined' ? globalThis : self);
