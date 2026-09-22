/**
 * Adapter registry — register(adapter), detect(url, document) → adapter | null.
 * Adapters are classic scripts that call FillApplyRegistry.register(...).
 */
(function (global) {
  'use strict';

  const adapters = [];

  function register(adapter) {
    if (!adapter || !adapter.id || typeof adapter.detect !== 'function') {
      throw new Error('Adapter must have id and detect()');
    }
    const idx = adapters.findIndex(function (a) {
      return a.id === adapter.id;
    });
    if (idx >= 0) adapters[idx] = adapter;
    else adapters.push(adapter);
    return adapter;
  }

  function list() {
    return adapters.slice();
  }

  function get(id) {
    return adapters.find(function (a) {
      return a.id === id;
    }) || null;
  }

  /**
   * Return the first matching adapter (non-fallback preferred), else fallback, else null.
   */
  function detect(url, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    url = url || (typeof location !== 'undefined' ? location.href : '');
    let fallback = null;
    const matches = [];
    for (let i = 0; i < adapters.length; i++) {
      const a = adapters[i];
      try {
        if (a.id === 'fallback') {
          fallback = a;
          continue;
        }
        if (a.detect(url, doc)) matches.push(a);
      } catch (_e) {
        /* ignore broken detect */
      }
    }
    if (matches.length) {
      // Prefer ATS apply engines over board/agency stubs when both match.
      const rank = { ats: 0, agency: 1, board: 2 };
      matches.sort(function (x, y) {
        const rx = rank[x.category] != null ? rank[x.category] : 9;
        const ry = rank[y.category] != null ? rank[y.category] : 9;
        return rx - ry;
      });
      return matches[0];
    }
    if (fallback && fallback.detect(url, doc)) return fallback;
    return fallback;
  }

  global.FillApplyRegistry = {
    register,
    list,
    get,
    detect,
    _adapters: adapters
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
