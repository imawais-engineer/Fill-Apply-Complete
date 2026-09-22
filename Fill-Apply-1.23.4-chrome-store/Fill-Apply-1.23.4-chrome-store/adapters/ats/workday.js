/**
 * Workday adapter stub — honest detection + known selectors; fill delegates to fallback.
 */
(function (global) {
  'use strict';

  function detect(url, doc) {
    url = String(url || '');
    if (/myworkdayjobs\.com|workdayjobs\.com|workday\.com/i.test(url)) return true;
    if (
      doc &&
      doc.querySelector(
        '[data-automation-id="jobPostingDescription"], [data-automation-id="applyButton"], [data-automation-id="submit"]'
      )
    ) {
      return true;
    }
    return false;
  }

  const adapter = {
    category: 'ats',
    id: 'workday',
    name: 'Workday',
    detect: detect,
    fieldMaps: [],
    submitSelector:
      '[data-automation-id="submit"], button[data-automation-id="bottom-submit"], button[type="submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv', selector: 'input[type=file]' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      const fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return {
          ok: false,
          adapterId: 'workday',
          error: 'Fallback adapter missing',
          filled: 0,
          unmatched: 0,
          total: 0
        };
      }
      return fb.fill(
        Object.assign({}, ctx, {
          adapterId: 'workday',
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: adapter.fieldMaps
        })
      );
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_workdayAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
