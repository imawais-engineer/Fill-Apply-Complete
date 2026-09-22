/**
 * Focus HUD — outline the control being filled and show green/yellow status.
 * Feature flag: fillApply.config.focusHud / runConfig.focusHud (default true).
 * Attaches globalThis.FillApplyFocusHud.
 */
(function (global) {
  'use strict';

  var ATTR = 'data-fill-apply-focus-hud';
  var STATUS_ATTR = 'data-fill-apply-status';
  var STYLE_ID = 'fill-apply-focus-hud-style';
  var enabled = true;
  var lastEl = null;

  function ensureStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '[' + ATTR + ']{outline:2px solid #22c55e !important;outline-offset:2px !important;' +
        'box-shadow:0 0 0 3px rgba(34,197,94,0.25) !important;' +
        'transition:outline 0.12s ease,box-shadow 0.12s ease;}' +
        '[' + STATUS_ATTR + '="filled"]{outline:2px solid #22c55e !important;outline-offset:2px !important;' +
        'box-shadow:0 0 0 3px rgba(34,197,94,0.25) !important;}' +
        '[' + STATUS_ATTR + '="unfilled"]{outline:2px solid #f59e0b !important;outline-offset:2px !important;' +
        'box-shadow:0 0 0 3px rgba(245,158,11,0.25) !important;}' +
        '[' + STATUS_ATTR + '="filled"]::after,[' + STATUS_ATTR + '="unfilled"]::after{' +
        'content:attr(data-fill-apply-badge);position:absolute;z-index:2147483646;' +
        'font:600 10px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:4px;' +
        'transform:translateY(-110%);pointer-events:none;}' +
        '[' + STATUS_ATTR + '="filled"]::after{background:#22c55e;color:#fff;}' +
        '[' + STATUS_ATTR + '="unfilled"]::after{background:#f59e0b;color:#111;}';
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) {}
  }

  function setEnabled(on) {
    enabled = on !== false;
    if (!enabled) clear();
  }

  function isEnabled() {
    return enabled !== false;
  }

  function clear() {
    if (typeof document === 'undefined') return;
    try {
      document.querySelectorAll('[' + ATTR + ']').forEach(function (el) {
        el.removeAttribute(ATTR);
      });
    } catch (_e) {}
    lastEl = null;
  }

  function clearStatus(root) {
    if (typeof document === 'undefined') return;
    try {
      var scope = root || document;
      scope.querySelectorAll('[' + STATUS_ATTR + ']').forEach(function (el) {
        el.removeAttribute(STATUS_ATTR);
        el.removeAttribute('data-fill-apply-badge');
      });
    } catch (_e) {}
  }

  /**
   * Mark an element as the active focus target (green pulse + scroll).
   * opts.status: 'filled' | 'unfilled' — persistent green/yellow outline + badge.
   */
  function mark(el, opts) {
    if (!enabled || !el) return;
    opts = opts || {};
    ensureStyle();
    try {
      if (lastEl && lastEl !== el) {
        try {
          lastEl.removeAttribute(ATTR);
        } catch (_e0) {}
      }
      el.setAttribute(ATTR, '1');
      lastEl = el;

      if (opts.status === 'filled' || opts.status === 'unfilled') {
        markStatus(el, opts.status, opts.badge);
      }

      if (opts.scroll !== false && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: opts.behavior || 'smooth' });
      }
      if (opts.focus && typeof el.focus === 'function') {
        try {
          el.focus({ preventScroll: true });
        } catch (_e1) {
          try {
            el.focus();
          } catch (_e2) {}
        }
      }
    } catch (_e) {}
  }

  function markStatus(el, status, badge) {
    if (!el || !el.setAttribute) return;
    ensureStyle();
    try {
      var prev = el.style && el.style.position;
      if (prev === '' || prev === 'static') {
        try {
          el.style.position = 'relative';
        } catch (_ePos) {}
      }
      el.setAttribute(STATUS_ATTR, status === 'filled' ? 'filled' : 'unfilled');
      el.setAttribute(
        'data-fill-apply-badge',
        badge || (status === 'filled' ? 'Filled' : 'Needs info')
      );
    } catch (_e) {}
  }

  function syncFromStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['fillApply.config', 'fillApply.runConfig'], function (res) {
        var cfg = (res && res['fillApply.config']) || {};
        var run = (res && res['fillApply.runConfig']) || {};
        var flag = cfg.focusHud;
        if (flag == null) flag = run.focusHud;
        setEnabled(flag !== false);
      });
    } catch (_e) {}
  }

  syncFromStorage();

  global.FillApplyFocusHud = {
    ATTR: ATTR,
    STATUS_ATTR: STATUS_ATTR,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    clear: clear,
    clearStatus: clearStatus,
    mark: mark,
    markStatus: markStatus,
    syncFromStorage: syncFromStorage
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
