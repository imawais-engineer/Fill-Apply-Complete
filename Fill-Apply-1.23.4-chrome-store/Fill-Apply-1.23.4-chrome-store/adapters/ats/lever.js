/**
 * Lever adapter stub — honest detection + known selectors; fill delegates to fallback.
 */
(function (global) {
  'use strict';

  function detect(url, doc) {
    url = String(url || '');
    if (/jobs\.lever\.co|lever\.co/i.test(url)) return true;
    if (doc && doc.querySelector('.application-form, .lever-job, [data-qa="btn-submit"]')) return true;
    return false;
  }

  const adapter = {
    category: 'ats',
    id: 'lever',
    name: 'Lever',
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[data-qa="btn-submit"], button[type="submit"], .template-btn-submit',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      const fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return {
          ok: false,
          adapterId: 'lever',
          error: 'Fallback adapter missing',
          filled: 0,
          unmatched: 0,
          total: 0
        };
      }
      return fb.fill(
        Object.assign({}, ctx, {
          adapterId: 'lever',
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: adapter.fieldMaps
        })
      );
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_leverAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
