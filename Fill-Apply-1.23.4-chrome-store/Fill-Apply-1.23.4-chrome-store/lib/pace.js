/**
 * Anti-flag pacing helpers — random action delays + wait-for-load.
 * Attaches globalThis.FillApplyPace.
 */
(function (global) {
  'use strict';

  var DEFAULT_MIN = 400;
  var DEFAULT_MAX = 900;

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function resolveRange(config) {
    var min = DEFAULT_MIN;
    var max = DEFAULT_MAX;
    if (config && typeof config === 'object') {
      if (config.actionDelayMinMs != null) min = Number(config.actionDelayMinMs);
      if (config.actionDelayMaxMs != null) max = Number(config.actionDelayMaxMs);
      if (config.pace && typeof config.pace === 'object') {
        if (config.pace.minMs != null) min = Number(config.pace.minMs);
        if (config.pace.maxMs != null) max = Number(config.pace.maxMs);
      }
    }
    min = clamp(min, 0, 30000);
    max = clamp(max, 0, 60000);
    if (max < min) {
      var t = min;
      min = max;
      max = t;
    }
    return { min: min, max: max };
  }

  function randomBetween(min, max) {
    min = Number(min);
    max = Number(max);
    if (!Number.isFinite(min)) min = DEFAULT_MIN;
    if (!Number.isFinite(max)) max = DEFAULT_MAX;
    if (max < min) {
      var t = min;
      min = max;
      max = t;
    }
    if (max === min) return Math.round(min);
    return Math.round(min + Math.random() * (max - min));
  }

  function actionDelayMs(config) {
    var r = resolveRange(config);
    return randomBetween(r.min, r.max);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function pace(config) {
    return sleep(actionDelayMs(config));
  }

  /**
   * Wait for document.readyState complete, then optional settle (default 800–1500ms).
   */
  function waitForDocumentReady(opts) {
    opts = opts || {};
    var settleMin = opts.settleMin != null ? opts.settleMin : 800;
    var settleMax = opts.settleMax != null ? opts.settleMax : 1500;
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 12000;
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        var ms = randomBetween(settleMin, settleMax);
        setTimeout(resolve, ms);
      }
      try {
        if (typeof document !== 'undefined' && document.readyState === 'complete') {
          finish();
          return;
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('load', finish, { once: true });
        }
        if (typeof document !== 'undefined') {
          document.addEventListener('readystatechange', function onRs() {
            if (document.readyState === 'complete') {
              document.removeEventListener('readystatechange', onRs);
              finish();
            }
          });
        }
      } catch (_e) {
        finish();
        return;
      }
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * After a click/navigation: MutationObserver or load + timeout.
   */
  function waitForLoad(opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000;
    var quietMs = opts.quietMs != null ? opts.quietMs : 450;
    return new Promise(function (resolve) {
      var done = false;
      var quietTimer = null;
      function finish() {
        if (done) return;
        done = true;
        try {
          if (observer) observer.disconnect();
        } catch (_e) {}
        if (quietTimer) clearTimeout(quietTimer);
        resolve();
      }
      function bump() {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      }
      var observer = null;
      try {
        if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
          observer = new MutationObserver(bump);
          observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true
          });
        }
      } catch (_e2) {}
      try {
        if (typeof window !== 'undefined') {
          window.addEventListener('load', bump, { once: true });
        }
      } catch (_e3) {}
      bump();
      setTimeout(finish, timeoutMs);
    });
  }

  global.FillApplyPace = {
    DEFAULT_MIN: DEFAULT_MIN,
    DEFAULT_MAX: DEFAULT_MAX,
    resolveRange: resolveRange,
    randomBetween: randomBetween,
    actionDelayMs: actionDelayMs,
    sleep: sleep,
    pace: pace,
    waitForDocumentReady: waitForDocumentReady,
    waitForLoad: waitForLoad
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
