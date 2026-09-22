/**
 * SmartRecruiters adapter stub — honest detection + known selectors; fill delegates to fallback.
 */
(function (global) {
  'use strict';

  function detect(url, doc) {
    url = String(url || '');
    if (/jobs\.smartrecruiters\.com|smartrecruiters\.com/i.test(url)) return true;
    if (doc && doc.querySelector('.st-job, [data-test="application-form"], .jobad-container')) return true;
    return false;
  }

  const adapter = {
    category: 'ats',
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[type="submit"], button[data-test="submit-application"], .submit-application',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      const fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return {
          ok: false,
          adapterId: 'smartrecruiters',
          error: 'Fallback adapter missing',
          filled: 0,
          unmatched: 0,
          total: 0
        };
      }
      return fb.fill(
        Object.assign({}, ctx, {
          adapterId: 'smartrecruiters',
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: adapter.fieldMaps
        })
      );
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_smartrecruitersAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
