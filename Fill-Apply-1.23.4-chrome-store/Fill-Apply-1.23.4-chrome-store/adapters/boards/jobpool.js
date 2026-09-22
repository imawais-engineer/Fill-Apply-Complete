/**
 * JobPool Applications hub adapter — Intelligent Opportunity Hub.
 *
 * Detects the Applications / Ready-to-apply page by page text, data-fill-apply
 * stamps, or hostname matching configured backendBaseUrl (no hard-coded host).
 *
 * Policy (user-confirmed):
 * - **Submit mode:** Apply hub → employer fill+submit → Mark as applied
 * - **Ready/Fill:** Apply hub → fill employer form → do NOT Mark as applied
 *   unless a real submit success / JobPool return-after-submit is detected
 *   (thank-you copy or return URL markers). Mark only then.
 *
 * Flow:
 * 1. Click **Apply** on the top / first Ready-to-apply card (never Mark as applied,
 *    Upgrade, or AI Auto-Apply).
 * 2. Persist `fillApply.jobpoolPendingMark` { jobId, title?, clickedAt, hubUrl? }.
 * 3. Handoff to employer board/ATS (externalApply / re-detect).
 * 4. After employer `submitted: true` OR success text + JobPool return: click
 *    **Mark as applied** for that card and clear pending; runner also POSTs
 *    existing markApplied / POST /applied/:id so UI + API stay in sync.
 */
(function (global) {
  'use strict';

  var PENDING_KEY = 'fillApply.jobpoolPendingMark';
  var memoryPending = null;

  function syn() {
    return global.FillApplySynonyms || null;
  }

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || doc.body.textContent || '').slice(0, 20000) : '';
    } catch (_e) {
      return '';
    }
  }

  function visible(el) {
    var S = syn();
    if (S && S.isVisible) return S.isVisible(el);
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
    var S = syn();
    if (S && S.buttonText) return S.buttonText(el);
    return String(
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeHost(hostOrUrl) {
    var S = syn();
    if (S && S.normalizeHost) return S.normalizeHost(hostOrUrl);
    var s = String(hostOrUrl || '')
      .trim()
      .toLowerCase();
    if (!s) return '';
    try {
      if (/^https?:\/\//i.test(s)) s = new URL(s).hostname;
    } catch (_e) {}
    return s.replace(/^www\./, '').split('/')[0];
  }

  function detect(url, doc) {
    var S = syn();
    if (S && S.isJobPoolHubPage) {
      return S.isJobPoolHubPage(doc, url, {
        backendBaseUrl:
          (typeof global !== 'undefined' && global.__fillApplyBackendBaseUrl) ||
          (typeof globalThis !== 'undefined' && globalThis.__fillApplyBackendBaseUrl) ||
          ''
      });
    }
    // Fallback if synonyms not loaded yet
    var text = pageText(doc);
    if (/Intelligent\s+Opportunity\s+Hub/i.test(text)) return true;
    if (
      /Ready\s+to\s+apply/i.test(text) &&
      /Mark\s+as\s+applied/i.test(text) &&
      /Pipeline\s+overview/i.test(text)
    ) {
      return true;
    }
    if (/Ready-to-apply\s+packages/i.test(text)) return true;
    return false;
  }

  function storageGet(key) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          var area = chrome.storage.session || chrome.storage.local;
          area.get([key], function (result) {
            if (chrome.runtime && chrome.runtime.lastError) {
              resolve(memoryPending);
              return;
            }
            var v = result && result[key];
            resolve(v != null ? v : memoryPending);
          });
          return;
        }
      } catch (_e) {}
      resolve(memoryPending);
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve) {
      try {
        if (obj && Object.prototype.hasOwnProperty.call(obj, PENDING_KEY)) {
          memoryPending = obj[PENDING_KEY];
        }
        if (typeof chrome !== 'undefined' && chrome.storage) {
          var writes = [];
          if (chrome.storage.session) {
            writes.push(
              new Promise(function (res) {
                try {
                  chrome.storage.session.set(obj, function () {
                    res();
                  });
                } catch (_e) {
                  res();
                }
              })
            );
          }
          writes.push(
            new Promise(function (res) {
              try {
                chrome.storage.local.set(obj, function () {
                  res();
                });
              } catch (_e2) {
                res();
              }
            })
          );
          Promise.all(writes).then(function () {
            resolve(true);
          });
          return;
        }
      } catch (_e3) {}
      resolve(true);
    });
  }

  function getPendingMark() {
    return storageGet(PENDING_KEY);
  }

  function setPendingMark(payload) {
    var next = payload
      ? {
          jobId: payload.jobId != null ? String(payload.jobId) : null,
          title: payload.title || null,
          clickedAt: payload.clickedAt || Date.now(),
          hubUrl: payload.hubUrl || null
        }
      : null;
    return storageSet({ [PENDING_KEY]: next }).then(function () {
      return next;
    });
  }

  function clearPendingMark() {
    memoryPending = null;
    return storageSet({ [PENDING_KEY]: null });
  }

  function extractJobIdNear(el, root) {
    if (!el) return null;
    var card =
      el.closest &&
      (el.closest(
        '[data-job-id], [data-jobpool-job-id], [data-fill-apply-card], [data-slot="card"], article, li, section, .card, [class*="card"], [class*="pkg"]'
      ) ||
        el.closest('[class*="ready"], [class*="package"], [class*="opportunity"]'));
    var scope = card || el.parentElement || root || document;
    try {
      if (el.getAttribute) {
        var d0 = el.getAttribute('data-job-id') || el.getAttribute('data-jobpool-job-id');
        if (d0) return String(d0).trim();
      }
      // Live JobPool Apply links often encode ids in the employer URL (jid- / job id).
      try {
        var href = String(el.href || el.getAttribute('href') || '');
        var jm = href.match(/[?&#/\-]jid[-_=]?([A-Za-z0-9]+)/i) || href.match(/\bjid-([0-9]+)/i);
        if (jm && jm[1]) return 'jid-' + String(jm[1]).trim();
        var lid = href.match(/linkedin\.com\/jobs\/view\/[^/]*?(\d{6,})/i);
        if (lid && lid[1]) return 'li-' + lid[1];
        var wk = href.match(/workable\.com\/j\/([A-Za-z0-9]+)/i);
        if (wk && wk[1]) return 'wk-' + wk[1];
      } catch (_hrefId) {}
      if (scope && scope.getAttribute) {
        var d1 = scope.getAttribute('data-job-id') || scope.getAttribute('data-jobpool-job-id');
        if (d1) return String(d1).trim();
      }
      if (scope && scope.querySelector) {
        var stamped = scope.querySelector('[data-job-id], [data-jobpool-job-id]');
        if (stamped) {
          var d2 =
            stamped.getAttribute('data-job-id') || stamped.getAttribute('data-jobpool-job-id');
          if (d2) return String(d2).trim();
        }
      }
      var text = String((scope && (scope.innerText || scope.textContent)) || '');
      var m = text.match(/Job\s*ID\s*[:#]?\s*([A-Za-z0-9_.-]+)/i);
      if (m && m[1]) return String(m[1]).trim();
    } catch (_e) {}
    return null;
  }

  function extractTitleNear(el) {
    if (!el) return null;
    try {
      var card =
        el.closest &&
        el.closest('article, li, section, [data-job-id], [data-jobpool-job-id], [class*="card"]');
      if (!card) return null;
      var h = card.querySelector('h1, h2, h3, h4, [class*="title"], [data-job-title]');
      if (h) return String(h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch (_e) {}
    return null;
  }

  /**
   * Prefer Ready-to-apply section; first DOM-order Apply (not Mark as applied).
   */
  function findReadySection(doc) {
    doc = doc || document;
    var candidates = [];
    try {
      var all = doc.querySelectorAll('section, article, div, main, [role="region"], [class*="ready"]');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var t = String(el.innerText || '').slice(0, 4000);
        if (/Ready\s+to\s+apply|Ready-to-apply/i.test(t) && /Apply/i.test(t)) {
          candidates.push(el);
        }
      }
    } catch (_e) {}
    if (!candidates.length) return doc;
    // Smallest section that still looks like the list wins (avoid whole page)
    candidates.sort(function (a, b) {
      return String(a.innerText || '').length - String(b.innerText || '').length;
    });
    return candidates[0] || doc;
  }

  function findFirstReadyApply(doc) {
    doc = doc || document;
    var S = syn();
    var root = findReadySection(doc);

    // Stable stamps first, DOM order
    try {
      var stamped = root.querySelectorAll
        ? root.querySelectorAll('[data-fill-apply="jobpool-apply"], [data-fill-apply="apply-start"]')
        : [];
      for (var si = 0; si < stamped.length; si++) {
        var se = stamped[si];
        if (!visible(se)) continue;
        var st = buttonText(se);
        if (S && S.isMarkAppliedCta && S.isMarkAppliedCta(st)) continue;
        if (S && S.isExcludedApplyCta && S.isExcludedApplyCta(st)) continue;
        return se;
      }
    } catch (_e0) {}

    // Live JobPool UI (2026): Apply is <a target="_blank" href="employer…">Apply</a>
    // Prefer first external Apply anchor in Ready section / document order.
    try {
      var anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
      for (var ai = 0; ai < anchors.length; ai++) {
        var ael = anchors[ai];
        if (!visible(ael) && ai > 0) {
          // Still allow first few off-screen Ready cards — JobPool list is long
          var r0 = null;
          try {
            r0 = ael.getBoundingClientRect();
          } catch (_r) {}
          if (!r0 || (r0.width < 2 && r0.height < 2)) continue;
        }
        if (!isExternalApplyAnchor(ael)) continue;
        try {
          ael.setAttribute('data-fill-apply', 'jobpool-apply');
        } catch (_st) {}
        return ael;
      }
    } catch (_ea) {}

    var nodes = root.querySelectorAll
      ? root.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]')
      : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el).replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (S && S.isMarkAppliedCta && S.isMarkAppliedCta(t)) continue;
      if (S && S.isExcludedApplyCta && S.isExcludedApplyCta(t)) continue;
      // Exact / near "Apply" — not "Mark as applied", not long sentences
      if (/^apply(\s*now)?$/i.test(t)) return el;
      if (S && S.isJobpoolApplyDataCta && S.isJobpoolApplyDataCta(el)) return el;
    }
    // Softer: short Apply CTAs in ready section
    for (var j = 0; j < nodes.length; j++) {
      var el2 = nodes[j];
      if (!visible(el2)) continue;
      var t2 = buttonText(el2).replace(/\s+/g, ' ').trim();
      if (!t2 || t2.length > 24) continue;
      if (S && S.isMarkAppliedCta && S.isMarkAppliedCta(t2)) continue;
      if (S && S.isExcludedApplyCta && S.isExcludedApplyCta(t2)) continue;
      if (/\bapply\b/i.test(t2) && !/mark/i.test(t2)) return el2;
    }
    return null;
  }

  function findMarkForJob(doc, jobId) {
    doc = doc || document;
    var S = syn();
    var marks = S && S.findMarkAppliedButtons ? S.findMarkAppliedButtons(doc) : [];
    if (!marks.length) {
      // Manual scan fallback
      var nodes = doc.querySelectorAll
        ? doc.querySelectorAll(
            'a, button, input[type="button"], [role="button"], [data-fill-apply="jobpool-mark-applied"]'
          )
        : [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!visible(el)) continue;
        var t = buttonText(el);
        if (S && S.isJobpoolMarkAppliedDataCta && S.isJobpoolMarkAppliedDataCta(el)) {
          marks.push(el);
          continue;
        }
        if (S && S.isMarkAppliedCta && S.isMarkAppliedCta(t)) marks.push(el);
      }
    }
    if (!marks.length) return null;
    if (!jobId) return marks[0];
    var want = String(jobId);
    for (var m = 0; m < marks.length; m++) {
      var id = extractJobIdNear(marks[m], doc);
      if (id && String(id) === want) return marks[m];
    }
    // Single pending / single mark → use first
    if (marks.length === 1) return marks[0];
    return marks[0];
  }

  function clickEl(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_e) {}
    try {
      el.focus();
    } catch (_e2) {}
    try {
      if (global.FillApplyDom && typeof global.FillApplyDom.realClick === 'function') {
        if (global.FillApplyDom.realClick(el)) return true;
      }
    } catch (_rc) {}
    try {
      el.click();
      return true;
    } catch (_e3) {}
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (_e4) {
      return false;
    }
  }

  function isExternalApplyAnchor(el) {
    if (!el || !el.tagName || String(el.tagName).toUpperCase() !== 'A') return false;
    var href = '';
    try {
      href = String(el.href || el.getAttribute('href') || '');
    } catch (_h) {
      href = '';
    }
    if (!/^https?:\/\//i.test(href)) return false;
    if (/zahid-jobpool\.vercel\.app|\/applications/i.test(href)) return false;
    var t = buttonText(el).replace(/\s+/g, ' ').trim();
    if (!/^apply(\s*now)?$/i.test(t) && !/\bapply\b/i.test(t)) return false;
    if (/mark\s+as\s+applied|upgrade|auto-?apply/i.test(t)) return false;
    return true;
  }

  function looksLikeSuccessOnPage(doc, url) {
    var S = syn();
    var text = pageText(doc);
    var success = S && S.looksLikeSubmitSuccessText ? S.looksLikeSubmitSuccessText(text) : false;
    var ret =
      S && S.looksLikeJobPoolReturnUrl ? S.looksLikeJobPoolReturnUrl(url || '') : false;
    // Success copy alone on hub, or return URL with success / pending return
    if (success && (ret || detect(url, doc))) return true;
    if (success && /jobpool|applications/i.test(String(url || '') + text.slice(0, 500))) return true;
    return false;
  }

  function handoffResult(extra) {
    return Object.assign(
      {
        ok: true,
        adapterId: 'jobpool',
        externalApply: true,
        handedOff: true,
        deferToPageAdapter: true,
        clickedApplyStart: true,
        jobpoolHubApply: true,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        message: 'JobPool hub Apply clicked — continue on employer apply URL'
      },
      extra || {}
    );
  }

  var adapter = {
    id: 'jobpool',
    name: 'JobPool Applications Hub',
    category: 'board',
    hosts: [],
    detect: detect,
    fieldMaps: [],
    submitSelector: 'button[type="submit"], input[type="submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    PENDING_KEY: PENDING_KEY,
    getPendingMark: getPendingMark,
    setPendingMark: setPendingMark,
    clearPendingMark: clearPendingMark,
    findFirstReadyApply: findFirstReadyApply,
    findMarkForJob: findMarkForJob,
    extractJobIdNear: extractJobIdNear,
    looksLikeSuccessOnPage: looksLikeSuccessOnPage,
    fill: function (ctx) {
      ctx = ctx || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      var doc = typeof document !== 'undefined' ? document : null;
      var href = '';
      try {
        href = String((typeof location !== 'undefined' && location.href) || '');
      } catch (_e) {}

      var forceMark = !!(ctx.forceJobPoolMark || (ctx.options && ctx.options.forceJobPoolMark));

      return Promise.resolve()
        .then(function () {
          return getPendingMark();
        })
        .then(function (pending) {
          var successReturn = looksLikeSuccessOnPage(doc, href);
          /**
           * Mark as applied ONLY after submission success / JobPool return after submit.
           * Ready/Fill without employer submit must not auto-Mark.
           */
          var shouldMark =
            forceMark ||
            successReturn ||
            (pending && ctx.submitted === true) ||
            (pending && runMode === 'submit' && ctx.markAfterSubmit === true);

          if (pending && shouldMark) {
            var markBtn = findMarkForJob(doc, pending.jobId);
            if (!markBtn) {
              return {
                ok: false,
                adapterId: 'jobpool',
                error: 'Pending JobPool mark but Mark as applied not found',
                jobId: pending.jobId,
                pendingMark: pending,
                filled: 0,
                unmatched: 0,
                total: 0,
                needsHuman: true,
                pauseReason: 'jobpool_mark_missing'
              };
            }
            var clicked = clickEl(markBtn);
            return clearPendingMark().then(function () {
              return {
                ok: !!clicked,
                adapterId: 'jobpool',
                jobpoolMarkedApplied: !!clicked,
                jobpoolReturnSuccess: !!successReturn,
                jobId: pending.jobId,
                submitted: true,
                filled: 0,
                unmatched: 0,
                total: 0,
                message: clicked
                  ? 'Marked as applied on JobPool hub'
                  : 'Failed to click Mark as applied'
              };
            });
          }

          // Pending but fill/ready without success — do not re-Apply or Mark
          if (pending && !shouldMark && !forceMark) {
            return {
              ok: true,
              adapterId: 'jobpool',
              jobpoolPending: true,
              jobId: pending.jobId,
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              message:
                'JobPool pending mark kept — waiting for employer submit success before Mark as applied'
            };
          }

          var applyBtn = findFirstReadyApply(doc);
          if (!applyBtn) {
            return {
              ok: false,
              adapterId: 'jobpool',
              error: 'No Ready-to-apply Apply button on JobPool hub',
              filled: 0,
              unmatched: 0,
              total: 0
            };
          }

          var jobId = extractJobIdNear(applyBtn, doc);
          var title = extractTitleNear(applyBtn);
          return setPendingMark({
            jobId: jobId,
            title: title,
            clickedAt: Date.now(),
            hubUrl: href
          }).then(function (saved) {
            var employerUrl = '';
            try {
              employerUrl = String(
                applyBtn.href || applyBtn.getAttribute('href') || ''
              ).trim();
            } catch (_hu) {
              employerUrl = '';
            }
            var opened = false;
            // Prefer extension tab open so Applications hub is NOT navigated away
            // (programmatic <a target=_blank>.click() often replaces the hub tab).
            if (/^https?:\/\//i.test(employerUrl)) {
              try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                  chrome.runtime.sendMessage({
                    type: 'FILL_APPLY_OPEN_TAB',
                    url: employerUrl,
                    active: true
                  });
                  opened = true;
                }
              } catch (_msg) {
                opened = false;
              }
            }
            if (!opened) {
              opened = clickEl(applyBtn);
            }
            return handoffResult({
              ok: opened,
              jobId: saved && saved.jobId,
              title: title,
              pendingMark: saved,
              openUrl: /^https?:\/\//i.test(employerUrl) ? employerUrl : null,
              externalApply: true,
              message: opened
                ? 'Opened employer Apply URL in a new tab — Applications hub kept'
                : 'Failed to open JobPool Apply URL'
            });
          });
        });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApplyJobPoolHub = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
