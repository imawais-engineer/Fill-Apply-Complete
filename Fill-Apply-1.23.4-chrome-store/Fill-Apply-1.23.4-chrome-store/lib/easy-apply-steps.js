/**
 * Shared helpers for Indeed-backed Easy Apply multi-step flows
 * (Indeed, Glassdoor Easy Apply, Recruitee → Indeed, etc.).
 *
 * Fill → Continue → wait for progress/DOM change → rescan.
 * Never bypass reCAPTCHA / "I am not a robot".
 */
(function (global) {
  'use strict';

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function humanDelay(base) {
    var b = typeof base === 'number' ? base : 450;
    return b + Math.floor(Math.random() * 350);
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
    return (
      (el.textContent || '') +
      ' ' +
      (el.value || '') +
      ' ' +
      (el.getAttribute('aria-label') || '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLabelFor(el) {
    if (global.__fillApply && global.__fillApply.getLabelText) {
      return global.__fillApply.getLabelText(el) || '';
    }
    if (el && el.id) {
      try {
        var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return byFor.textContent.trim();
      } catch (_e) {
        /* ignore */
      }
    }
    var parent = el && el.closest && el.closest('label');
    if (parent) return parent.textContent.trim();
    return (el && (el.getAttribute('aria-label') || el.placeholder || el.name)) || '';
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var tag = el.tagName;
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);

    if (type === 'checkbox') {
      var want = /^(yes|y|true|1|on)$/i.test(str);
      if (el.checked !== want) {
        el.checked = want;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    if (type === 'radio') return false;

    if (tag === 'SELECT') {
      if (global.__fillApply && global.__fillApply.matchSelectOption) {
        return !!global.__fillApply.matchSelectOption(el, str);
      }
      var wantL = str.toLowerCase();
      for (var i = 0; i < el.options.length; i++) {
        var opt = el.options[i];
        var t = (opt.textContent || '').trim().toLowerCase();
        var v = String(opt.value || '').toLowerCase();
        if (t === wantL || v === wantL || t.indexOf(wantL) !== -1) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    try {
      var proto =
        tag === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e2) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function readProgressPercent(doc) {
    doc = doc || document;
    var text = '';
    try {
      text = (doc.body && doc.body.innerText) || '';
    } catch (_e) {
      text = '';
    }
    var m = text.match(/(\d+)\s*%/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
    var headings = doc.querySelectorAll('h1, h2, h3, [role="heading"], .ia-JobApplication-header, [class*="Progress"]');
    for (var h = 0; h < headings.length; h++) {
      var hm = ((headings[h].textContent || '')).match(/(\d+)\s*%/);
      if (hm) {
        var hn = parseInt(hm[1], 10);
        if (hn >= 0 && hn <= 100) return hn;
      }
    }
    var prog = doc.querySelector('[role="progressbar"], .ia-ProgressBar, [aria-valuenow]');
    if (prog) {
      var v = prog.getAttribute('aria-valuenow') || prog.getAttribute('value');
      if (v != null && v !== '') {
        var p = parseInt(v, 10);
        if (!isNaN(p)) return p;
      }
    }
    return null;
  }

  function bodyText(doc) {
    doc = doc || document;
    try {
      return ((doc.body && doc.body.innerText) || '').replace(/\s+/g, ' ').trim();
    } catch (_e) {
      return '';
    }
  }

  /** Continue / Next — never Submit / Apply final. */
  function clickContinue(doc) {
    doc = doc || document;
    if (global.__fillApply && global.__fillApply.clickContinueButtons) {
      var clicked = global.__fillApply.clickContinueButtons();
      if (clicked && clicked.length) return true;
    }
    var buttons = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'
    );
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (
        /\b(continue|next|save and continue|review)\b/i.test(t) &&
        !/\b(submit application|submit your application|apply now)\b/i.test(t)
      ) {
        // "Review" advances to review step — ok in ready; still not final submit
        try {
          btn.click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    return false;
  }

  function clickSubmit(doc) {
    doc = doc || document;
    var buttons = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]'
    );
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (
        /\b(submit application|submit your application|submit)\b/i.test(t) ||
        (/^apply$/i.test(t.trim()) && /submit|ia-Submit/i.test(btn.className + ' ' + (btn.id || '')))
      ) {
        // Prefer explicit submit phrasing; avoid bare "Apply" on job listing
        if (/^apply$/i.test(t.trim()) && !/submit/i.test(t) && !/ia-Submit|SubmitButton/i.test(btn.className)) {
          continue;
        }
        try {
          btn.click();
          return true;
        } catch (_e) {
          /* ignore */
        }
      }
    }
    if (global.__fillApply && global.__fillApply.clickSubmitButtons) {
      return !!global.__fillApply.clickSubmitButtons(
        'button[type="submit"], input[type="submit"], button.ia-SubmitButton, [data-testid="submit-application"]'
      );
    }
    return false;
  }

  /**
   * Easy Apply / Apply start on job listing — not AI resume-match widgets.
   */
  function findEasyApplyButton(doc, opts) {
    doc = doc || document;
    opts = opts || {};
    var preferIndeed = opts.preferIndeed !== false;
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"]'
    );
    var easy = null;
    var applyIndeed = null;
    var plainApply = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
      var dataTest = (el.getAttribute && el.getAttribute('data-test')) || '';
      var dataGd = (el.getAttribute && el.getAttribute('data-gd')) || '';
      var blob = (
        t +
        ' ' +
        aria +
        ' ' +
        dataTest +
        ' ' +
        dataGd +
        ' ' +
        (el.className || '') +
        ' ' +
        (el.id || '')
      ).toLowerCase();
      // Anti-patterns: AI match / sticky Upload resume opportunity banners — NOT Easy Apply
      if (
        /is my resume a good match|resume.?match|ai.?match|upload resume to see|good match\?/i.test(
          t + ' ' + aria
        )
      ) {
        continue;
      }
      if (
        /^upload resume$/i.test(String(t).trim()) ||
        (/upload resume/i.test(t) && !/easy apply/i.test(t + ' ' + aria))
      ) {
        // Sticky opportunity / match banners
        var near =
          (el.closest &&
            (el.closest('[class*="sticky"], [class*="banner"], [class*="opportunity"], [data-test*="banner"]') ||
              null)) ||
          null;
        if (near || !/easy apply/i.test(t + ' ' + aria)) continue;
      }
      if (
        /easy apply/i.test(t) ||
        /easy\s*apply/i.test(aria) ||
        /easyapply|easy-apply|easy_apply/i.test(dataTest + ' ' + dataGd)
      ) {
        easy = el;
        break;
      }
      if (/apply with indeed/i.test(t)) {
        applyIndeed = el;
        continue;
      }
      if (
        /^apply$/i.test(t.trim()) ||
        /^apply now$/i.test(t.trim()) ||
        /indeed-apply|ia-IndeedApplyButton|indeedApplyButton|easyApply/i.test(blob)
      ) {
        if (!plainApply) plainApply = el;
      }
    }
    if (easy) return easy;
    if (preferIndeed && applyIndeed) return applyIndeed;
    var byAttr = doc.querySelector(
      '[data-indeed-apply-jobid], .indeed-apply-button, #indeed-apply-button, button.ia-IndeedApplyButton, [data-test="easyApply"], [data-test="easy-apply"], [data-test="apply-button"], [data-gd*="easyApply"], [data-gd*="easy-apply"]'
    );
    if (byAttr && visible(byAttr)) {
      var bt = buttonText(byAttr);
      if (!/is my resume a good match|good match\?|^upload resume$/i.test(bt)) return byAttr;
    }
    // aria-label Easy Apply (attribute selector case-fold not reliable everywhere)
    var ariaNodes = doc.querySelectorAll('[aria-label]');
    for (var a = 0; a < ariaNodes.length; a++) {
      var ae = ariaNodes[a];
      if (!visible(ae)) continue;
      var al = ae.getAttribute('aria-label') || '';
      if (/easy\s*apply/i.test(al) && !/good match|upload resume to see/i.test(al)) {
        return ae;
      }
    }
    if (applyIndeed) return applyIndeed;
    return plainApply;
  }

  function detectCaptcha(doc) {
    doc = doc || document;
    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      var ch = global.FillApplyChallenges.detectChallenge(doc);
      if (ch && ch.challenged) return ch;
    }
    var text = bodyText(doc);
    if (
      /i am not a robot|i'm not a robot|recaptcha|verify you are human/i.test(text) ||
      doc.querySelector('.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="challenges.cloudflare"]')
    ) {
      return {
        challenged: true,
        kind: 'captcha',
        detail: 'reCAPTCHA / I am not a robot',
        markers: ['recaptcha']
      };
    }
    return { challenged: false };
  }

  /**
   * Wait until progress % changes, URL changes, or timeout (post-Continue).
   */
  function waitForStepChange(prevProgress, prevUrl, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        var nowP = readProgressPercent(document);
        var nowUrl = '';
        try {
          nowUrl = location.href;
        } catch (_e) {
          nowUrl = '';
        }
        var changed =
          (prevProgress != null && nowP != null && nowP !== prevProgress) ||
          (prevUrl && nowUrl && nowUrl !== prevUrl) ||
          (prevProgress == null && nowP != null);
        if (changed || Date.now() - start >= timeoutMs) {
          resolve({ progress: nowP, url: nowUrl, changed: !!changed });
          return;
        }
        setTimeout(tick, 200 + Math.floor(Math.random() * 150));
      }
      setTimeout(tick, humanDelay(400));
    });
  }

  /** Runner/panel: detect chrome.scripting frame/tab invalidation errors. */
  function isFrameInvalidError(err) {
    var msg = String((err && err.message) || err || '');
    return (
      /Frame with ID\s+\d+\s+was removed/i.test(msg) ||
      /No tab with id/i.test(msg) ||
      /No frame with id/i.test(msg) ||
      /The tab was closed/i.test(msg) ||
      /Cannot access contents of (the page|url)/i.test(msg) ||
      /Frame does not exist/i.test(msg)
    );
  }

  var api = {
    norm: norm,
    sleep: sleep,
    humanDelay: humanDelay,
    visible: visible,
    buttonText: buttonText,
    getLabelFor: getLabelFor,
    setNativeValue: setNativeValue,
    readProgressPercent: readProgressPercent,
    bodyText: bodyText,
    clickContinue: clickContinue,
    clickSubmit: clickSubmit,
    findEasyApplyButton: findEasyApplyButton,
    detectCaptcha: detectCaptcha,
    waitForStepChange: waitForStepChange,
    isFrameInvalidError: isFrameInvalidError
  };

  global.FillApplyEasyApplySteps = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
