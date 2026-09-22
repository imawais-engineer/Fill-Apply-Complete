/**
 * Queue-driven runner (service-worker side).
 * Loop: getNextJob (queued only) → open tab → detect challenge? → fill →
 * (optional) external Apply handoff: re-wait load + re-inject/detect → fill →
 * move to applied/failed OR pause for human → prune old submitted tabs? → delay.
 * Honors STOP and RESUME (after Cloudflare/CAPTCHA / form drift).
 *
 * runMode: register | fill | navigate | ready | submit
 * Auto-close: Submit mode + submitted success only; keeps last N tabs (keepRecentTabs).
 * PDF report: on successful submit when autoPdfReport is ON.
 */
(function (global) {
  'use strict';

  function isContextDeadError(msg) {
    msg = String(msg || '');
    return /Extension context invalidated|Receiving end does not exist|Could not establish connection|message port closed|Frame with ID|No tab with id/i.test(msg);
  }


  const RUN_PHASES = {
    DETECTING: 'DETECTING',
    FILLING: 'FILLING',
    REGISTERING: 'REGISTERING',
    NAVIGATING: 'NAVIGATING',
    WAITING_FOR_DEPENDENT_FIELDS: 'WAITING_FOR_DEPENDENT_FIELDS',
    VALIDATING: 'VALIDATING',
    MISSING_INFORMATION: 'MISSING_INFORMATION',
    BLOCKED: 'BLOCKED',
    READY: 'READY',
    SUBMITTING: 'SUBMITTING',
    COMPLETE: 'COMPLETE',
    WAITING_FOR_USER: 'WAITING_FOR_USER',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AMBIGUOUS: 'AMBIGUOUS',
    TIMEOUT: 'TIMEOUT'
  };

  const PROGRESS_PLATEAU_MS = (global.FillApplyTypes && global.FillApplyTypes.PROGRESS_PLATEAU_MS) || 10000;

  const INJECT_FILES = [
    'lib/dom-deep.js',
    'lib/format.js',
    'lib/synonyms.js',
    'lib/pace.js',
    'lib/field-map.js',
    'lib/control-adapter.js',
    'lib/ats-faq-seed.js',
    'lib/knowledge-policy.js',
    'lib/knowledge-canonical.js',
    'lib/knowledge-store.js',
    'lib/knowledge-resolver.js',
    'lib/knowledge-learn.js',
    'lib/environment-store.js',
    'lib/question-bank-store.js',
    'lib/files.js',
    'lib/auth-walls.js',
    'lib/signup-login.js',
    'lib/ats-auth.js',
    'lib/challenges.js',
    'lib/easy-apply-steps.js',
    'content/focus-hud.js',
    'content/knowledge-observe.js',
    'content/fill.js',
    'adapters/registry.js',
    'adapters/fallback.js',
    'adapters/catalog.js',
    'adapters/ats/greenhouse.js',
    'adapters/ats/lever.js',
    'adapters/ats/ashby.js',
    'adapters/ats/workday.js',
    'adapters/ats/smartrecruiters.js',
    'adapters/ats/workable.js',
    'adapters/ats/icims.js',
    'adapters/ats/cats.js',
    'adapters/ats/recruitee.js',
    'adapters/ats/teamtailor.js',
    'adapters/ats/successfactors.js',
    'adapters/boards/indeed.js',
    'adapters/boards/glassdoor.js',
    'adapters/boards/linkedin.js',
    'adapters/boards/naukrigulf.js',
    'adapters/boards/remoteok.js',
    'adapters/boards/weworkremotely.js',
    'adapters/boards/workingnomads.js',
    'adapters/boards/jooble.js',
    'adapters/boards/swooped.js',
    'adapters/boards/efinancialcareers.js',
    'adapters/boards/jobpool.js'
  ];

  /**
   * Company career sites embed the real ATS form in an iframe (Greenhouse,
   * Lever, Workable, SmartRecruiters, iCIMS, Glassdoor→Indeed). Injecting into
   * the top frame only means the extension never sees those forms, so every
   * injection runs in all frames and the best frame result wins.
   */
  const INJECT_TARGET = { allFrames: true };

  let loopActive = false;
  let autoApplyActive = false;
  let currentTabRunActive = false;
  let delayTimer = null;
  let currentJobId = null;
  let pausedTabId = null;
  let resumeTabId = null;
  /** Oldest-first list of submitted job tabs kept for context: { tabId, jobId, at } */
  let submittedTabs = [];

  /**
   * Rank per-frame fill results and return the frame that actually did the work.
   *
   * Only one frame holds the application form; the rest report that they had
   * nothing to do. Higher score wins, and diagnostics from every frame are
   * attached so a failure shows what each frame saw.
   */
  function pickBestFrameResult(injectionResults) {
    const entries = (injectionResults || [])
      .map(function (entry) {
        return {
          frameId: entry && entry.frameId,
          result: entry && entry.result
        };
      })
      .filter(function (entry) {
        return entry.result;
      });

    if (!entries.length) return null;

    function score(r) {
      if (!r) return -1;
      if (r.frameSkipped) return 0;
      let s = 1;
      if (r.total > 0) s += 5;
      if (r.needsHuman) s += 40;
      if (r.submitted) s += 60;
      if (r.jobpoolMarkedApplied) s += 55;
      if (r.filled > 0) s += 100 + Math.min(r.filled, 50);
      if (r.clickedApplyStart || r.reDetect || r.jobpoolHubApply) s += 20;
      if (r.ok === false && !r.total) s -= 1;
      return s;
    }

    let best = entries[0];
    let bestScore = score(entries[0].result);
    for (let i = 1; i < entries.length; i++) {
      const s = score(entries[i].result);
      if (s > bestScore) {
        bestScore = s;
        best = entries[i];
      }
    }

    const winner = Object.assign({}, best.result, { frameId: best.frameId });
    if (entries.length > 1) {
      winner.frames = entries.map(function (entry) {
        return {
          frameId: entry.frameId,
          filled: entry.result.filled || 0,
          total: entry.result.total || 0,
          skipped: !!entry.result.frameSkipped,
          error: entry.result.error || null
        };
      });
    }
    return winner;
  }

  function withJobPoolStatus(payload) {
    const body = Object.assign({}, payload || {});
    if (global.FillApplyTypes && typeof global.FillApplyTypes.jobPoolOutcome === 'function') {
      body.status = body.status || global.FillApplyTypes.jobPoolOutcome(body);
      body.outcome = body.outcome || body.status;
    }
    return body;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      delayTimer = setTimeout(function () {
        delayTimer = null;
        resolve();
      }, ms);
    });
  }

  function clearDelay() {
    if (delayTimer) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
  }

  /** Frame/tab invalidated after Easy Apply Continue / navigation. */
  function isFrameInvalidError(err) {
    if (global.FillApplyEasyApplySteps && global.FillApplyEasyApplySteps.isFrameInvalidError) {
      return global.FillApplyEasyApplySteps.isFrameInvalidError(err);
    }
    var msg = String((err && err.message) || err || '');
    return (
      /Frame with ID\s+\d+\s+was removed/i.test(msg) ||
      /No tab with id/i.test(msg) ||
      /No frame with id/i.test(msg) ||
      /The tab was closed/i.test(msg) ||
      /Cannot access contents of (the page|url)/i.test(msg) ||
      /Frame does not exist/i.test(msg) ||
      /Extension context invalidated/i.test(msg) ||
      /Receiving end does not exist/i.test(msg) ||
      /Could not establish connection/i.test(msg) ||
      /message port closed/i.test(msg)
    );
  }

  /**
   * After navigation, tab id may still be valid but frame 0 was removed.
   * Prefer existing tabId; else find a tab matching the job URL host.
   */
  async function resolveFreshTabId(job, preferredTabId) {
    if (preferredTabId != null) {
      try {
        const t = await chrome.tabs.get(preferredTabId);
        if (t && t.id != null) return t.id;
      } catch (_e) {
        /* fall through */
      }
    }
    if (!job || !job.url) return preferredTabId;
    let host = '';
    try {
      host = new URL(job.url).hostname;
    } catch (_u) {
      host = '';
    }
    try {
      const tabs = await chrome.tabs.query({});
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        if (!t || t.id == null || !t.url) continue;
        try {
          const th = new URL(t.url).hostname;
          if (
            (host && (th === host || th.endsWith('.' + host.replace(/^www\./, '')))) ||
            /glassdoor\.com|indeed\.com/i.test(th)
          ) {
            if (job.url && (t.url === job.url || t.url.indexOf(host) !== -1)) return t.id;
          }
        } catch (_e2) {
          /* ignore */
        }
      }
      // Second pass: any glassdoor/indeed tab from this session
      for (let j = 0; j < tabs.length; j++) {
        const t2 = tabs[j];
        if (t2 && t2.url && /glassdoor\.com|indeed\.com/i.test(t2.url)) return t2.id;
      }
    } catch (_q) {
      /* ignore */
    }
    return preferredTabId;
  }

  async function waitPageSettle(tabId, settleMin, settleMax) {
    settleMin = settleMin != null ? settleMin : 800;
    settleMax = settleMax != null ? settleMax : 1500;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (minMs, maxMs) {
          return new Promise(function (resolve) {
            var done = false;
            function finish() {
              if (done) return;
              done = true;
              var span = Math.max(0, maxMs - minMs);
              var ms = minMs + Math.floor(Math.random() * (span + 1));
              setTimeout(resolve, ms);
            }
            try {
              if (document.readyState === 'complete') finish();
              else {
                window.addEventListener('load', finish, { once: true });
                document.addEventListener('readystatechange', function onRs() {
                  if (document.readyState === 'complete') {
                    document.removeEventListener('readystatechange', onRs);
                    finish();
                  }
                });
              }
            } catch (_e) {
              finish();
            }
            setTimeout(finish, 12000);
          });
        },
        args: [settleMin, settleMax]
      });
    } catch (_e) {
      await sleep(settleMin + Math.floor(Math.random() * Math.max(0, settleMax - settleMin)));
    }
  }

  async function setMissingFieldsPauseState(payload) {
    const S = global.FillApplyStorage;
    const state = Object.assign(
      {
        jobId: null,
        tabId: null,
        missingProfileFields: [],
        message: '',
        at: Date.now(),
        mode: 'batch'
      },
      payload || {}
    );
    try {
      if (S.setPauseState) await S.setPauseState(state);
      else await chrome.storage.local.set({ 'fillApply.pauseState': state });
    } catch (_e) {}
    try {
      try {
        chrome.runtime.sendMessage({ type: 'FILL_APPLY_MISSING_FIELDS', data: state }, function () {
          void chrome.runtime.lastError;
        });
      } catch (_e) {
        /* Options / panel may not be open — ignore */
      }
    } catch (_e2) {}
    try {
      if (state.tabId != null && chrome.sidePanel && chrome.sidePanel.open) {
        const tab = await chrome.tabs.get(state.tabId);
        if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch (_e3) {}
    return state;
  }

  async function clearMissingFieldsPauseState() {
    const S = global.FillApplyStorage;
    try {
      if (S.clearPauseState) await S.clearPauseState();
      else await chrome.storage.local.set({ 'fillApply.pauseState': null });
    } catch (_e) {}
  }


  function resolveRunMode(config) {
    if (global.FillApplyStorage && global.FillApplyStorage.normalizeRunMode) {
      return global.FillApplyStorage.normalizeRunMode(config);
    }
    if (config && config.runMode) return config.runMode;
    if (config && config.autoSubmit) return 'submit';
    return 'fill';
  }

  /** Human-like delay: base delayMs ± small jitter. */
  function jitteredDelay(delayMs) {
    const base = Math.max(0, Number(delayMs) || 0);
    const jitter = Math.floor(Math.random() * Math.min(900, Math.max(200, base * 0.25 + 150)));
    return base + jitter;
  }

  function waitTabComplete(tabId, timeoutMs) {
    timeoutMs = timeoutMs || 45000;
    return new Promise(function (resolve, reject) {
      let done = false;
      const timer = setTimeout(function () {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('Tab load timeout'));
      }, timeoutMs);

      function finish(tab) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(tab);
      }

      function onUpdated(id, info, tab) {
        if (id !== tabId) return;
        if (info.status === 'complete') finish(tab);
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error(chrome.runtime.lastError.message));
          }
          return;
        }
        if (tab && tab.status === 'complete') finish(tab);
      });
    });
  }

  async function openJobTab(job) {
    if (!job || !job.url) {
      throw new Error('Job is missing a url');
    }
    if (/^chrome-extension:\/\//i.test(job.url) || /^about:/i.test(job.url)) {
      throw new Error(
        'Cannot open chrome-extension:// or about: pages in the runner. Add https job apply URLs in App Settings (Application queue).'
      );
    }
    if (!/^https?:\/\//i.test(job.url)) {
      throw new Error('Job URL must be http(s): ' + String(job.url).slice(0, 80));
    }
    const tab = await chrome.tabs.create({ url: job.url, active: true });
    await waitTabComplete(tab.id);
    await sleep(800 + Math.floor(Math.random() * 400));
    return tab;
  }

  async function focusTab(tabId) {
    if (tabId == null) return;
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (_e) {
      /* ignore */
    }
  }

  function clampKeep(n) {
    if (global.FillApplyStorage && global.FillApplyStorage.clampKeepRecentTabs) {
      return global.FillApplyStorage.clampKeepRecentTabs(n);
    }
    const v = Number(n);
    if (!Number.isFinite(v)) return 5;
    return Math.min(10, Math.max(3, Math.round(v)));
  }

  /**
   * Auto-close ONLY after successful Submit-mode apply.
   * Keeps the newest `keepRecentTabs` submitted tabs open for context;
   * closes oldest submitted tabs beyond that window.
   * Never closes while a tab is the active processing tab (caller only
   * invokes this after processing finishes). Never runs for fill/ready.
   */
  async function trackSubmittedTabAndPrune(tabId, jobId, config, activeTabId) {
    if (!config || !config.autoCloseAppliedTab) return;
    if (tabId == null) return;

    submittedTabs.push({ tabId: tabId, jobId: jobId || null, at: Date.now() });

    // Drop entries for tabs that no longer exist
    const alive = [];
    for (let i = 0; i < submittedTabs.length; i++) {
      const entry = submittedTabs[i];
      try {
        await chrome.tabs.get(entry.tabId);
        alive.push(entry);
      } catch (_e) {
        /* gone */
      }
    }
    submittedTabs = alive;

    const keep = clampKeep(config.keepRecentTabs);
    while (submittedTabs.length > keep) {
      const oldest = submittedTabs.shift();
      if (!oldest || oldest.tabId == null) continue;
      // Never close the tab still being processed / just finished if it is activeTabId
      // and somehow still inside the prune set as the only one — but oldest ≠ newest.
      if (activeTabId != null && oldest.tabId === activeTabId && submittedTabs.length < keep) {
        submittedTabs.unshift(oldest);
        break;
      }
      if (activeTabId != null && oldest.tabId === activeTabId) {
        // Prefer closing a different old tab; re-queue this one at front only if empty prune
        continue;
      }
      try {
        await chrome.tabs.remove(oldest.tabId);
      } catch (_e2) {
        /* tab may already be closed */
      }
    }
  }

  /** @deprecated immediate close — kept as no-op helper name for clarity */
  async function closeAppliedTab(/* tabId, config */) {
    /* replaced by trackSubmittedTabAndPrune — fill/ready/failed never auto-close */
  }

  function jobHost(job) {
    try {
      return job && job.url ? new URL(job.url).host : '';
    } catch (_e) {
      return '';
    }
  }

  function notifyPagePanel(tabId, payload) {
    if (tabId == null) return;
    const body = Object.assign(
      { type: 'FILL_APPLY_PAGE_PANEL_STATUS' },
      payload || {}
    );
    try {
      chrome.tabs.sendMessage(tabId, body, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      /* tab may not have the page panel */
    }
  }

  function notifyActionNeeded(job, detail) {
    if (!chrome.notifications || !chrome.notifications.create) return;
    const host = jobHost(job);
    const title = (job && job.title) || 'Job';
    const message =
      (title.length > 60 ? title.slice(0, 57) + '…' : title) +
      (host ? ' · ' + host : '') +
      (detail ? ' — ' + String(detail).slice(0, 100) : '');
    try {
      chrome.notifications.create('fill-apply-human-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Fill & Apply — action needed',
        message: message,
        priority: 2,
        requireInteraction: true
      });
    } catch (_e2) {
      /* notifications may be unavailable */
    }
  }

  /**
   * High-alert pause when a required profile field is empty / unknown.
   * Never invent — user fills Options or the page, then Resume.
   */
  function notifyMissingProfileField(job, fieldLabels) {
    if (!chrome.notifications || !chrome.notifications.create) return;
    const host = jobHost(job);
    const title = (job && job.title) || 'Job';
    const fields = (Array.isArray(fieldLabels) ? fieldLabels : [fieldLabels])
      .filter(Boolean)
      .map(function (f) {
        return String(f).trim();
      })
      .filter(Boolean);
    const fieldText = fields.length ? fields.join(', ') : 'required field';
    const message =
      (title.length > 40 ? title.slice(0, 37) + '…' : title) +
      (host ? ' · ' + host : '') +
      ' — ' +
      fieldText +
      ' — open Fill & Apply side panel to enter values, then Save & continue';
    try {
      chrome.notifications.create('fill-apply-missing-profile-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Fill & Apply — profile field needed',
        message: message.slice(0, 250),
        priority: 2,
        requireInteraction: true
      });
    } catch (_e2) {
      /* notifications may be unavailable */
    }
  }

  function looksLikeMissingProfile(msg, fields) {
    if (fields && fields.length) return true;
    var s = String(msg || '').toLowerCase();
    if (!s) return false;
    return (
      /missing profile|profile field needed|unanswered required|empty (profile|answer)|blank (profile|field)|unmapped|map it in customanswers|fill in options/.test(
        s
      ) && !/cloudflare|captcha|hcaptcha|challenge|verify you are human/.test(s)
    );
  }


  function notifySourceCap(job, reason) {
    if (!chrome.notifications || !chrome.notifications.create) return;
    let host = '';
    try {
      host = job && job.url ? new URL(job.url).host : '';
    } catch (_e) {
      host = '';
    }
    const title = (job && job.title) || 'Job';
    const message =
      (title.length > 50 ? title.slice(0, 47) + '…' : title) +
      (host ? ' · ' + host : '') +
      ' — ' +
      String(reason || 'Source apply cap reached').slice(0, 100);
    try {
      chrome.notifications.create('fill-apply-cap-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Fill & Apply — source cap',
        message: message,
        priority: 1
      });
    } catch (_e2) {
      /* ignore */
    }
  }

  async function detectChallengeInTab(tabId, opts) {
    opts = opts || {};
    const settleMs = opts.settleMs != null ? opts.settleMs : 10000;
    const skipWait = !!opts.skipWait;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['lib/auth-walls.js', 'lib/signup-login.js', 'lib/ats-auth.js', 'lib/challenges.js']
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (settleMsArg, skipWaitArg) {
          const C = globalThis.FillApplyChallenges;
          if (!C) {
            return Promise.resolve({ challenged: false, kind: null, detail: '', markers: [] });
          }
          if (C.detectChallengeWithSettle) {
            return C.detectChallengeWithSettle(document, {
              settleMs: settleMsArg,
              skipWait: skipWaitArg
            });
          }
          if (!C.detectChallenge) {
            return Promise.resolve({ challenged: false, kind: null, detail: '', markers: [] });
          }
          return Promise.resolve(C.detectChallenge(document));
        },
        args: [settleMs, skipWait]
      });
      return (
        (results && results[0] && results[0].result) || {
          challenged: false,
          kind: null,
          detail: '',
          markers: []
        }
      );
    } catch (_e) {
      return { challenged: false, kind: null, detail: '', markers: [] };
    }
  }

  /** Auth-only inject target — composed separately so INJECT_TARGET stays untouched. */
  const AUTH_INJECT_FILES = ['lib/auth-walls.js', 'lib/signup-login.js', 'lib/ats-auth.js', 'lib/challenges.js'];

  async function injectAtsAuthLibs(tabId, allFrames) {
    const target = allFrames
      ? Object.assign({ tabId: tabId }, { allFrames: true })
      : { tabId: tabId };
    await chrome.scripting.executeScript({
      target: target,
      files: AUTH_INJECT_FILES
    });
  }

  async function inspectAuthInTab(tabId, profile, opts) {
    opts = opts || {};
    try {
      await injectAtsAuthLibs(tabId, !!opts.allFrames);
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (profileArg, forceChooser) {
          const A = globalThis.FillApplyAtsAuth;
          if (!A || !A.inspectAuthPage) {
            return { result: 'AUTH_FAILED', pause: true, detail: 'AtsAuth missing' };
          }
          return A.inspectAuthPage(document, profileArg, {
            forceGoogleChooser: !!forceChooser
          });
        },
        args: [profile || null, !!opts.forceGoogleChooser]
      });
      return (
        (results && results[0] && results[0].result) || {
          result: 'AUTH_FAILED',
          pause: true,
          detail: 'inspectAuthInTab empty'
        }
      );
    } catch (e) {
      return {
        result: 'AUTH_FAILED',
        pause: true,
        detail: String((e && e.message) || e || 'inspect failed')
      };
    }
  }

  async function performAuthActionInTab(tabId, profile) {
    try {
      await injectAtsAuthLibs(tabId, false);
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (profileArg) {
          const A = globalThis.FillApplyAtsAuth;
          if (!A || !A.performAuthAction) return { ok: false, detail: 'AtsAuth missing' };
          const inspection = A.inspectAuthPage(document, profileArg);
          return A.performAuthAction(document, profileArg, inspection);
        },
        args: [profile || null]
      });
      return (results && results[0] && results[0].result) || { ok: false, detail: 'no result' };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  }

  /**
   * Pure helper (testable): choose the best tab opened by Apply / external handoff.
   * Prefers chrome openerTabId match, then newest http(s) tab not in knownIds.
   */
  function pickApplyHandoffTab(tabs, openerTabId, knownIds) {
    knownIds = knownIds || {};
    var list = tabs || [];
    var candidates = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || t.id == null || t.id === openerTabId) continue;
      if (knownIds[t.id]) continue;
      var url = String(t.url || t.pendingUrl || '');
      var openerMatch = t.openerTabId != null && t.openerTabId === openerTabId;
      var blank =
        !url ||
        url === 'about:blank' ||
        /^chrome:\/\//i.test(url) ||
        /^chrome-extension:\/\//i.test(url) ||
        /^edge:\/\//i.test(url);
      if (!openerMatch && blank) continue;
      var score = (openerMatch ? 1000 : 0) + (t.id || 0);
      if (/apply|application|candidate|job|careers|greenhouse|lever|ashby|workday|icims/i.test(url)) {
        score += 80;
      }
      if (/naukrigulf|michaelpage/i.test(url)) score += 40;
      candidates.push({ tab: t, score: score });
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    return candidates.length ? candidates[0].tab : null;
  }

  async function snapshotTabIdSet() {
    try {
      const tabs = await chrome.tabs.query({});
      const map = {};
      (tabs || []).forEach(function (t) {
        if (t && t.id != null) map[t.id] = true;
      });
      return map;
    } catch (_e) {
      return {};
    }
  }

  async function findApplyHandoffTab(openerTabId, knownIds) {
    try {
      const tabs = await chrome.tabs.query({});
      return pickApplyHandoffTab(tabs, openerTabId, knownIds || {});
    } catch (_e) {
      return null;
    }
  }

  /**
   * After Apply may open a new tab (NaukriGulf / Michael Page / boards), wait and adopt it.
   */
  async function waitForApplyHandoffTab(openerTabId, knownIds, timeoutMs) {
    timeoutMs = timeoutMs || 9000;
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      last = await findApplyHandoffTab(openerTabId, knownIds);
      if (last && last.id != null) {
        const url = String(last.url || last.pendingUrl || '');
        const openerMatch = last.openerTabId != null && last.openerTabId === openerTabId;
        const usable =
          openerMatch ||
          (/^https?:\/\//i.test(url) && !/^chrome/i.test(url));
        if (usable) {
          if (last.status === 'loading') {
            try {
              await waitTabComplete(last.id, Math.max(3000, timeoutMs - (Date.now() - start)));
            } catch (_w) {
              /* still adopt */
            }
          }
          return last;
        }
      }
      await sleep(220);
    }
    return last;
  }

  async function adoptTabAsActiveJob(tabId, progressFn) {
    if (tabId == null) return;
    try {
      if (typeof progressFn === 'function') progressFn('running', 'Following Apply to new tab…');
    } catch (_e) {}
    try {
      await focusTab(tabId);
    } catch (_f) {}
    try {
      await waitTabComplete(tabId, 45000);
    } catch (_w) {}
    await sleep(400 + Math.floor(Math.random() * 350));
  }

  async function findGoogleOauthTab(openerTabId) {
    try {
      const tabs = await chrome.tabs.query({
        url: ['https://accounts.google.com/*', 'https://*.google.com/o/oauth2/*']
      });
      if (!tabs || !tabs.length) return null;
      // Prefer most recently accessed / highest id near opener
      tabs.sort(function (a, b) {
        return (b.id || 0) - (a.id || 0);
      });
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i] && tabs[i].id != null && tabs[i].id !== openerTabId) {
          return tabs[i];
        }
      }
      // Same tab navigated to Google
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j] && tabs[j].id === openerTabId) return tabs[j];
      }
      return tabs[0] || null;
    } catch (_e) {
      return null;
    }
  }

  async function persistAtsAuthState(job, profile, authOutcome) {
    const Store = global.FillApplyAtsAuthStore;
    if (!Store || !Store.upsert) return;
    try {
      const code = authOutcome && authOutcome.result;
      await Store.upsert({
        url: (job && job.url) || (authOutcome && authOutcome.href) || '',
        email: (profile && profile.email) || null,
        status: Store.statusFromAuthResult
          ? Store.statusFromAuthResult(code)
          : 'unknown',
        lastResult: code || null,
        lastDetail: (authOutcome && authOutcome.detail) || null,
        googleUsed: !!(authOutcome && authOutcome.googleUsed)
      });
    } catch (_e) {
      /* best-effort */
    }
  }

  /**
   * ATS auth lifecycle: try Google OAuth UI once before fill continues.
   * Existing challenge / human-pause gates remain authoritative when needed.
   *
   * @returns {{ proceed: boolean, paused?: boolean, outcome: object }}
   */
  async function attemptAtsGoogleAuthLifecycle(tabId, profile, job) {
    const A = global.FillApplyAtsAuth;
    const AR = (A && A.AUTH_RESULTS) || {};
    const S = global.FillApplyStorage;

    async function logAuth(message, extra) {
      try {
        await S.appendSessionLog(
          Object.assign(
            {
              type: 'ats_auth',
              jobId: job && job.id,
              message: message
            },
            extra || {}
          )
        );
      } catch (_e) {}
    }

    // Skip if we already know this host is authenticated for this email
    try {
      const Store = global.FillApplyAtsAuthStore;
      if (Store && Store.getForHost && job && job.url) {
        const prior = await Store.getForHost(job.url, profile && profile.email);
        if (prior && prior.status === 'authenticated') {
          const snap = await inspectAuthInTab(tabId, profile);
          if (snap && (snap.result === AR.AUTHENTICATED || snap.result === AR.NOT_REQUIRED)) {
            await logAuth('ATS auth already recorded for host — continuing', {
              result: snap.result
            });
            return { proceed: true, outcome: snap };
          }
        }
      }
    } catch (_prior) {}

    let inspection = await inspectAuthInTab(tabId, profile);
    await logAuth('ATS auth inspect', {
      result: inspection && inspection.result,
      detail: inspection && inspection.detail
    });

    if (!inspection) {
      return {
        proceed: false,
        paused: true,
        outcome: { result: AR.AUTH_FAILED || 'AUTH_FAILED', detail: 'No inspection' }
      };
    }

    // CAPTCHA/Cloudflare can flash briefly on Greenhouse boards — wait + recheck
    // before pausing. If the challenge clears or coexists with a fillable form,
    // continue (do not hard-error / instant pause).
    if (inspection.result === AR.CAPTCHA_REQUIRED) {
      await logAuth('CAPTCHA/Cloudflare detected — waiting ~10s to settle, then re-check', {
        detail: inspection.detail
      });
      const settled = await detectChallengeInTab(tabId, { settleMs: 10000 });
      if (!settled || !settled.challenged) {
        await logAuth('Challenge cleared or non-blocking after settle — continuing', {
          suppressed: !!(settled && settled.suppressed),
          clearedAfterWait: !!(settled && settled.clearedAfterWait),
          formFillable: !!(settled && settled.formFillable)
        });
        inspection = await inspectAuthInTab(tabId, profile);
        if (inspection && inspection.result === AR.CAPTCHA_REQUIRED) {
          // Widget still flagged by sync inspect but settle said non-blocking
          inspection = Object.assign({}, inspection, {
            result: AR.NOT_REQUIRED || 'NOT_REQUIRED',
            pause: false,
            detail: 'CAPTCHA settle: form usable / challenge non-blocking',
            captchaSettled: true
          });
        }
      } else {
        await logAuth('Challenge still blocking after settle — pausing for human', {
          detail: settled.detail,
          kind: settled.kind
        });
        inspection = Object.assign({}, inspection, {
          pause: true,
          detail: settled.detail || inspection.detail,
          challenge: settled
        });
        await persistAtsAuthState(job, profile, inspection);
        return { proceed: false, paused: true, outcome: inspection };
      }
    }

    if (inspection.result === AR.NOT_REQUIRED) {
      return { proceed: true, outcome: inspection };
    }

    if (inspection.result === AR.AUTHENTICATED) {
      await persistAtsAuthState(job, profile, Object.assign({}, inspection, { googleUsed: false }));
      return { proceed: true, outcome: inspection };
    }

    if (inspection.pause && inspection.result !== AR.ACCOUNT_ALREADY_EXISTS) {
      // MFA / unsupported / ambiguous — do not click (CAPTCHA handled above with settle)
      await persistAtsAuthState(job, profile, inspection);
      return { proceed: false, paused: true, outcome: inspection };
    }

    // Google available or existing-account recovery with Google button
    if (
      inspection.action === 'click_google' ||
      inspection.result === 'GOOGLE_AUTH_AVAILABLE' ||
      (inspection.result === AR.ACCOUNT_ALREADY_EXISTS && inspection.action === 'click_google')
    ) {
      const clicked = await performAuthActionInTab(tabId, profile);
      await logAuth('Clicked Google OAuth UI', {
        ok: !!(clicked && clicked.ok),
        detail: clicked && clicked.detail,
        existingAccount: !!inspection.existingAccount
      });
      if (!clicked || !clicked.ok) {
        const fail = {
          result: AR.AUTH_FAILED || 'AUTH_FAILED',
          pause: true,
          detail: (clicked && clicked.detail) || 'Failed to click Google auth',
          googleUsed: true
        };
        await persistAtsAuthState(job, profile, fail);
        return { proceed: false, paused: true, outcome: fail };
      }

      // Wait for Google chooser popup/tab or in-page Continue as …
      let authOutcome = null;
      const deadline = Date.now() + 22000;
      while (Date.now() < deadline) {
        if (!(await S.isRunning())) {
          return {
            proceed: false,
            paused: true,
            outcome: {
              result: AR.USER_ACTION_REQUIRED || 'USER_ACTION_REQUIRED',
              detail: 'Stopped during auth'
            }
          };
        }
        await sleep(900 + Math.floor(Math.random() * 400));

        // In-page progress on ATS tab
        let again = await inspectAuthInTab(tabId, profile);
        if (again && again.result === AR.AUTHENTICATED) {
          authOutcome = Object.assign({}, again, {
            googleUsed: true,
            result:
              inspection.existingAccount || inspection.result === AR.ACCOUNT_ALREADY_EXISTS
                ? AR.AUTHENTICATED
                : again.result
          });
          // First-time create heuristic: wall had create markers and we authenticated via Google
          if (
            !inspection.existingAccount &&
            inspection.wall &&
            inspection.wall.markers &&
            inspection.wall.markers.some(function (m) {
              return /create|sign up|register/i.test(String(m));
            })
          ) {
            authOutcome.result = AR.ACCOUNT_CREATED || 'ACCOUNT_CREATED';
            authOutcome.detail = 'Account created / linked via Google OAuth';
          }
          break;
        }
        if (again && again.pause && again.result !== 'GOOGLE_AUTH_AVAILABLE') {
          authOutcome = Object.assign({}, again, { googleUsed: true });
          break;
        }
        if (again && again.action === 'click_account') {
          const sel = await performAuthActionInTab(tabId, profile);
          await logAuth('Selected Google account on ATS tab', {
            ok: !!(sel && sel.ok),
            detail: sel && sel.detail
          });
          if (!sel || !sel.ok) {
            authOutcome = {
              result: AR.USER_ACTION_REQUIRED || 'USER_ACTION_REQUIRED',
              pause: true,
              detail: (sel && sel.detail) || 'Could not select Google account',
              googleUsed: true
            };
            break;
          }
          continue;
        }

        // Popup / redirect to accounts.google.com
        const gTab = await findGoogleOauthTab(tabId);
        if (gTab && gTab.id != null) {
          try {
            await waitTabComplete(gTab.id, 12000);
          } catch (_w) {}
          await focusTab(gTab.id);
          let gInspect = await inspectAuthInTab(gTab.id, profile, { forceGoogleChooser: true });
          if (gInspect && gInspect.action === 'click_account') {
            const gClick = await performAuthActionInTab(gTab.id, profile);
            await logAuth('Selected Google account on accounts.google.com', {
              ok: !!(gClick && gClick.ok),
              detail: gClick && gClick.detail
            });
            if (!gClick || !gClick.ok) {
              authOutcome = {
                result: AR.USER_ACTION_REQUIRED || 'USER_ACTION_REQUIRED',
                pause: true,
                detail: (gClick && gClick.detail) || 'Select Google account manually',
                googleUsed: true
              };
              break;
            }
            // After account click, Google may show consent / return to ATS
            await sleep(1200);
            continue;
          }
          if (gInspect && gInspect.pause) {
            authOutcome = Object.assign({}, gInspect, { googleUsed: true });
            break;
          }
          // MFA / captcha on Google host
          if (
            gInspect &&
            (gInspect.result === AR.MFA_REQUIRED ||
              gInspect.result === AR.CAPTCHA_REQUIRED ||
              gInspect.result === AR.EMAIL_VERIFICATION_REQUIRED)
          ) {
            authOutcome = Object.assign({}, gInspect, { googleUsed: true });
            break;
          }
        }
      }

      if (!authOutcome) {
        // Final check on ATS tab
        const finalInspect = await inspectAuthInTab(tabId, profile);
        if (finalInspect && finalInspect.result === AR.AUTHENTICATED) {
          authOutcome = Object.assign({}, finalInspect, { googleUsed: true });
        } else if (finalInspect && finalInspect.pause) {
          authOutcome = Object.assign({}, finalInspect, { googleUsed: true });
        } else {
          authOutcome = {
            result: AR.TIMEOUT || 'TIMEOUT',
            pause: true,
            detail: 'Google OAuth timed out — complete sign-in manually, then Resume',
            googleUsed: true
          };
        }
      }

      await persistAtsAuthState(job, profile, authOutcome);
      if (
        authOutcome.result === AR.AUTHENTICATED ||
        authOutcome.result === AR.ACCOUNT_CREATED
      ) {
        await focusTab(tabId);
        await logAuth('ATS Google auth succeeded', { result: authOutcome.result });
        return { proceed: true, outcome: authOutcome };
      }
      return { proceed: false, paused: true, outcome: authOutcome };
    }

    // Auth wall without Google — already handled above; fallback pause
    await persistAtsAuthState(job, profile, inspection);
    return { proceed: false, paused: true, outcome: inspection };
  }


  /**
   * Pause run for human (Cloudflare / CAPTCHA / Indeed structure drift).
   * Keeps job in queued with needsAttention; does not auto-click challenges.
   */
  async function pauseForHuman(job, tabId, reason, extra) {
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    clearDelay();
    await S.setRunning(false);
    loopActive = false;
    pausedTabId = tabId;

    // Keep tab focused for the human
    await focusTab(tabId);

    const pauseInfo = Object.assign(
      {
        paused: true,
        reason: reason || 'challenge',
        message: (extra && extra.message) || reason || 'Paused — verify Cloudflare/CAPTCHA',
        jobId: job && job.id,
        jobTitle: job && job.title,
        jobUrl: job && job.url,
        tabId: tabId,
        at: Date.now()
      },
      extra || {}
    );
    await S.setPausedForHuman(pauseInfo);

    var skipQueue = !!(extra && extra.skipQueue);

    // Flag job in queued bucket; leave it queued for Resume
    if (!skipQueue && job && job.id && B.getQueued && B.setQueued) {
      try {
        const queued = await B.getQueued();
        const next = queued.map(function (j) {
          if (j.id !== job.id) return j;
          return Object.assign({}, j, {
            needsAttention: true,
            status: 'queued',
            lastError: pauseInfo.message,
            meta: Object.assign({}, j.meta || {}, {
              waitingHuman: true,
              pauseReason: pauseInfo.reason
            })
          });
        });
        // If job was already popped from queued, put it back at front
        if (!next.some(function (j) { return j.id === job.id; })) {
          next.unshift(
            Object.assign({}, job, {
              needsAttention: true,
              status: 'queued',
              lastError: pauseInfo.message,
              meta: Object.assign({}, job.meta || {}, {
                waitingHuman: true,
                pauseReason: pauseInfo.reason
              })
            })
          );
        }
        await B.setQueued(next);
      } catch (_e) {
        /* best-effort */
      }
    } else if (!skipQueue && job && job.id && S.getBucket && S.setBucket) {
      try {
        let queued = await S.getBucket('queued');
        if (!queued.some(function (j) { return j.id === job.id; })) {
          queued = [
            Object.assign({}, job, { needsAttention: true, status: 'queued' })
          ].concat(queued);
        } else {
          queued = queued.map(function (j) {
            return j.id === job.id
              ? Object.assign({}, j, { needsAttention: true })
              : j;
          });
        }
        await S.setBucket('queued', queued);
      } catch (_e2) {
        /* ignore */
      }
    }

    await S.setQueueStatus({
      currentJobId: job && job.id,
      lastJobTitle: (job && job.company ? job.company + ' — ' : '') + ((job && job.title) || (job && job.id) || ''),
      lastError: pauseInfo.message,
      pausedForHuman: true
    });

    await S.appendSessionLog({
      type: 'paused_human',
      jobId: job && job.id,
      reason: pauseInfo.reason,
      message: pauseInfo.message
    });

    var missingFields =
      (pauseInfo && pauseInfo.missingProfileFields) ||
      (extra && extra.missingProfileFields) ||
      null;
    var unknownFields =
      (pauseInfo && pauseInfo.unknownFields) ||
      (extra && extra.unknownFields) ||
      null;
    if (looksLikeMissingProfile(pauseInfo.message, missingFields)) {
      notifyMissingProfileField(job, missingFields || [pauseInfo.message]);
      await setMissingFieldsPauseState({
        jobId: job && job.id,
        tabId: tabId,
        missingProfileFields: missingFields || [],
        unknownFields: unknownFields || [],
        message: pauseInfo.message,
        at: Date.now(),
        mode: (extra && extra.mode) || 'batch',
        reason: 'missing_profile_field'
      });
    } else {
      notifyActionNeeded(job, pauseInfo.message);
    }
    notifyPagePanel(tabId, {
      state: 'paused',
      message: pauseInfo.message || 'Paused — action needed'
    });
    currentJobId = null;
    return getStatusSnapshot();
  }

  async function injectAndFillOnce(tabId, profile, documents, runMode, config) {
    await focusTab(tabId);
    await waitPageSettle(tabId, 800, 1500);
    if (config) {
      const amin = config.actionDelayMinMs != null ? config.actionDelayMinMs : 400;
      const amax = config.actionDelayMaxMs != null ? config.actionDelayMaxMs : 900;
      const lo = Math.min(amin, amax);
      const hi = Math.max(amin, amax);
      await sleep(lo + Math.floor(Math.random() * Math.max(0, hi - lo + 1)));
    } else {
      await sleep(150 + Math.floor(Math.random() * 200));
    }

    // Single-tab fill/ready/submit: attempt Google ATS auth before filler inject
    if (!(config && config.skipAtsAuth)) {
      try {
        let onceUrl = null;
        try {
          const tMeta0 = await chrome.tabs.get(tabId);
          onceUrl = (tMeta0 && tMeta0.url) || null;
        } catch (_tu0) {}
        const authOnce = await attemptAtsGoogleAuthLifecycle(tabId, profile, {
          id: (config && config.jobId) || null,
          url: onceUrl,
          title: 'Fill once'
        });
        if (authOnce && authOnce.paused && authOnce.outcome) {
          const Aref2 = global.FillApplyAtsAuth;
          const AR2 = (Aref2 && Aref2.AUTH_RESULTS) || {};
          return {
            ok: false,
            needsHuman: true,
            pauseReason: 'ats_auth',
            authResult: authOnce.outcome.result,
            error:
              (Aref2 && Aref2.pauseMessageForResult
                ? Aref2.pauseMessageForResult(authOnce.outcome.result, authOnce.outcome.detail)
                : authOnce.outcome.detail) || 'Authentication required',
            challenge: authOnce.outcome.challenge || {
              kind: 'ats_auth',
              detail: authOnce.outcome.detail
            },
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
      } catch (_authOnceErr) {
        /* non-fatal — proceed to fill */
      }
    }

    await chrome.scripting.executeScript({
      target: Object.assign({ tabId: tabId }, INJECT_TARGET),
      files: INJECT_FILES
    });

    const preferIndeedApply =
      config && typeof config.preferIndeedApply === 'boolean' ? config.preferIndeedApply : true;
    const focusHud = !(config && config.focusHud === false);
    const paceCfg = {
      actionDelayMinMs: config && config.actionDelayMinMs != null ? config.actionDelayMinMs : 400,
      actionDelayMaxMs: config && config.actionDelayMaxMs != null ? config.actionDelayMaxMs : 900,
      backendBaseUrl: (config && config.backendBaseUrl) || ''
    };

    const results = await chrome.scripting.executeScript({
      target: Object.assign({ tabId: tabId }, INJECT_TARGET),
      func: async function (profileArg, documentsArg, runModeArg, preferIndeedApplyArg, focusHudArg, paceArg) {
        // Let JobPool hub detect() match configured backend host without a hard-coded secret.
        try {
          globalThis.__fillApplyBackendBaseUrl =
            (paceArg && paceArg.backendBaseUrl) || globalThis.__fillApplyBackendBaseUrl || '';
        } catch (_cfgHost) {}
        // Sub-frames are mostly ads, trackers and social widgets. Only engage a
        // sub-frame that actually contains an application form or an Apply CTA.
        const isSubFrame = (function () {
          try {
            return window.top !== window.self;
          } catch (_e) {
            return true;
          }
        })();
        if (isSubFrame) {
          const syn = globalThis.FillApplySynonyms;
          const hasForm = syn && syn.isApplicationFormOpen && syn.isApplicationFormOpen(document);
          const hasCta =
            syn && syn.findApplyStartButtons && syn.findApplyStartButtons(document).length > 0;
          const isHub =
            syn && syn.isJobPoolHubPage && syn.isJobPoolHubPage(document, location.href, {});
          if (!hasForm && !hasCta && !isHub) {
            return { ok: true, frameSkipped: true, filled: 0, unmatched: 0, total: 0 };
          }
        }

        if (globalThis.FillApplyFocusHud && globalThis.FillApplyFocusHud.setEnabled) {
          globalThis.FillApplyFocusHud.setEnabled(focusHudArg !== false);
        }
        const registry = globalThis.FillApplyRegistry;
        if (!registry) {
          return {
            ok: false,
            error: 'Adapter registry missing',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
        const adapter = registry.detect(location.href, document);
        if (!adapter) {
          return {
            ok: false,
            error: 'No adapter matched',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }
        if (typeof adapter.fill === 'function') {
          var out = adapter.fill({
            profile: profileArg,
            documents: documentsArg,
            runMode: runModeArg || 'fill',
            autoSubmit: runModeArg === 'submit',
            preferIndeedApply: preferIndeedApplyArg !== false,
            options: {
              highlightUnmatched: false,
              runMode: runModeArg || 'fill',
              preferIndeedApply: preferIndeedApplyArg !== false,
              pace: paceArg || null
            },
            config: {
              preferIndeedApply: preferIndeedApplyArg !== false,
              focusHud: focusHudArg !== false,
              actionDelayMinMs: paceArg && paceArg.actionDelayMinMs,
              actionDelayMaxMs: paceArg && paceArg.actionDelayMaxMs
            },
            adapterId: adapter.id,
            submitSelector: adapter.submitSelector,
            fileInputHints: adapter.fileInputHints,
            fieldMaps: adapter.fieldMaps
          });
          if (out && typeof out.then === 'function') out = await out;

          // A site-specific adapter that matched nothing has usually drifted
          // from the layout it was written against. The generic engine knows
          // how to read the page as it is now, so let it try before giving up.
          const adapterFoundNothing =
            out &&
            adapter.id !== 'fallback' &&
            !(out.filled > 0) &&
            !out.submitted &&
            !out.needsHuman &&
            !out.clickedApplyStart &&
            !out.reDetect &&
            !out.handedOff &&
            !out.externalApply &&
            !out.navOnly &&
            !out.advanced &&
            !out.jobpoolHubApply &&
            !out.jobpoolMarkedApplied &&
            !out.jobpoolPending;

          if (adapterFoundNothing && globalThis.__fillApply) {
            try {
              const generic = await globalThis.__fillApply.run(profileArg, {
                highlightUnmatched: false,
                runMode: runModeArg || 'fill',
                documents: documentsArg,
                fileInputHints: adapter.fileInputHints
              });
              if (generic && generic.filled > 0) {
                generic.adapterId = adapter.id;
                generic.usedGenericFallback = true;
                generic.adapterMessage = out.error || out.message || null;
                return generic;
              }
            } catch (genericErr) {
              out.genericFallbackError = String(
                (genericErr && genericErr.message) || genericErr
              );
            }
          }

          return out;
        }
        return {
          ok: false,
          adapterId: adapter.id,
          error: 'Adapter has no fill()',
          filled: 0,
          unmatched: 0,
          total: 0
        };
      },
      args: [profile, documents, runMode || 'fill', preferIndeedApply, focusHud, paceCfg]
    });

    return (
      pickBestFrameResult(results) || {
        ok: false,
        error: 'No result from inject',
        filled: 0,
        unmatched: 0,
        total: 0
      }
    );
  }

  /**
   * injectAndFill with frame-churn retries (Easy Apply Continue navigations).
   * Does not mark failed solely for "Frame with ID … removed" / "No tab with id".
   * Returns { result, tabId } when opts.returnTabId; else result (compat).
   */
  async function injectAndFill(tabId, profile, documents, runMode, config, job, opts) {
    opts = opts || {};
    const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 4;
    let currentTabId = tabId;
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await injectAndFillOnce(
          currentTabId,
          profile,
          documents,
          runMode,
          config
        );
        if (opts.returnTabId) return { result: result, tabId: currentTabId };
        return result;
      } catch (e) {
        lastErr = e;
        if (!isFrameInvalidError(e) || attempt >= maxAttempts - 1) {
          throw e;
        }
        await sleep(600 + attempt * 400 + Math.floor(Math.random() * 300));
        const fresh = await resolveFreshTabId(job || null, currentTabId);
        if (fresh != null) currentTabId = fresh;
        try {
          await waitTabComplete(currentTabId, 20000);
        } catch (_w) {
          /* continue retry */
        }
        await sleep(400 + Math.floor(Math.random() * 300));
        try {
          await chrome.scripting.executeScript({
            target: Object.assign({ tabId: currentTabId }, INJECT_TARGET),
            files: INJECT_FILES
          });
        } catch (_reinj) {
          /* next attempt */
        }
      }
    }
    throw lastErr || new Error('injectAndFill failed after frame retries');
  }

  const JOBPOOL_PENDING_KEY = 'fillApply.jobpoolPendingMark';

  async function readJobPoolPendingMark() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const area = chrome.storage.session || chrome.storage.local;
        const result = await new Promise(function (resolve) {
          area.get([JOBPOOL_PENDING_KEY], function (r) {
            resolve(r || {});
          });
        });
        let pending = result[JOBPOOL_PENDING_KEY];
        if (pending) return pending;
        if (chrome.storage.session && area !== chrome.storage.local) {
          const local = await new Promise(function (resolve) {
            chrome.storage.local.get([JOBPOOL_PENDING_KEY], function (r) {
              resolve(r || {});
            });
          });
          return local[JOBPOOL_PENDING_KEY] || null;
        }
      }
    } catch (_e) {}
    return null;
  }

  async function clearJobPoolPendingMark() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const empty = {};
        empty[JOBPOOL_PENDING_KEY] = null;
        if (chrome.storage.session) {
          await new Promise(function (resolve) {
            chrome.storage.session.set(empty, resolve);
          });
        }
        await new Promise(function (resolve) {
          chrome.storage.local.set(empty, resolve);
        });
      }
    } catch (_e) {}
  }

  /**
   * After employer submit (or JobPool return-after-submit), focus the Applications
   * hub and click Mark as applied for the pending card. Also POST markApplied.
   *
   * Policy: Mark only when submitted / return-success — not after fill/ready alone.
   */
  async function maybeCompleteJobPoolHubMark(fromTabId, fillResult, runMode, job) {
    const pending = await readJobPoolPendingMark();
    if (!pending || !pending.jobId) return null;

    const submitted = !!(fillResult && fillResult.submitted);
    const returnOk = !!(fillResult && (fillResult.jobpoolReturnSuccess || fillResult.jobpoolMarkedApplied));
    // Ready/Fill without employer submit: do not Mark (unless return-success signals real submit).
    if (!submitted && !returnOk) return null;

    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;

    if (fillResult && fillResult.jobpoolMarkedApplied) {
      try {
        if (B && B.markApplied) {
          await B.markApplied(
            pending.jobId,
            withJobPoolStatus({
              fillResult: fillResult,
              submitted: true,
              runMode: runMode || 'submit',
              url: (job && job.url) || pending.hubUrl || '',
              source: 'jobpool_hub_mark'
            })
          );
        }
      } catch (_api) {}
      await clearJobPoolPendingMark();
      if (S && S.appendSessionLog) {
        await S.appendSessionLog({
          type: 'jobpool_hub_mark',
          jobId: pending.jobId,
          alreadyMarked: true
        });
      }
      return { ok: true, alreadyMarked: true, jobId: pending.jobId };
    }

    // Find JobPool Applications tab
    let hubTabId = null;
    try {
      const tabs = await chrome.tabs.query({});
      const hubUrl = pending.hubUrl || '';
      let hubHost = '';
      try {
        hubHost = hubUrl ? new URL(hubUrl).hostname : '';
      } catch (_u) {}
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        if (!t || t.id == null || !t.url) continue;
        if (hubUrl && t.url.indexOf(hubUrl.split('?')[0]) === 0) {
          hubTabId = t.id;
          break;
        }
        if (hubHost) {
          try {
            if (new URL(t.url).hostname === hubHost && /application/i.test(t.url)) {
              hubTabId = t.id;
              break;
            }
          } catch (_e2) {}
        }
      }
      // Fallback: scan titles / URLs for Applications hub hints
      if (hubTabId == null) {
        for (let j = 0; j < tabs.length; j++) {
          const t2 = tabs[j];
          if (!t2 || !t2.url) continue;
          const blob = String(t2.title || '') + ' ' + String(t2.url || '');
          if (/Intelligent Opportunity Hub|JobPool/i.test(blob) && /application/i.test(blob)) {
            hubTabId = t2.id;
            break;
          }
        }
      }
    } catch (_tabs) {}

    if (hubTabId == null && fromTabId != null) {
      // Employer may have redirected back into the same tab
      hubTabId = fromTabId;
    }
    if (hubTabId == null) {
      if (S && S.appendSessionLog) {
        await S.appendSessionLog({
          type: 'jobpool_hub_mark_miss',
          jobId: pending.jobId,
          error: 'Hub tab not found'
        });
      }
      return { ok: false, error: 'Hub tab not found', jobId: pending.jobId };
    }

    try {
      await focusTab(hubTabId);
      await waitTabComplete(hubTabId, 20000).catch(function () {});
      await waitPageSettle(hubTabId, 400, 900).catch(function () {});
    } catch (_focus) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId: hubTabId, allFrames: false },
        files: INJECT_FILES
      });
    } catch (_inj) {}

    const markJobId = pending.jobId;
    let markResults;
    try {
      markResults = await chrome.scripting.executeScript({
        target: { tabId: hubTabId, allFrames: false },
        func: async function (jobIdArg) {
          const hub = globalThis.FillApplyJobPoolHub;
          const registry = globalThis.FillApplyRegistry;
          if (hub && typeof hub.fill === 'function') {
            const out = await hub.fill({
              runMode: 'submit',
              forceJobPoolMark: true,
              submitted: true,
              markAfterSubmit: true,
              options: { forceJobPoolMark: true, runMode: 'submit' }
            });
            return out;
          }
          if (registry) {
            const adapter = registry.get && registry.get('jobpool');
            if (adapter && adapter.fill) {
              return await adapter.fill({
                runMode: 'submit',
                forceJobPoolMark: true,
                submitted: true
              });
            }
          }
          // Last resort: click Mark as applied via synonyms
          const Syn = globalThis.FillApplySynonyms;
          if (Syn && Syn.findMarkAppliedButtons) {
            const btns = Syn.findMarkAppliedButtons(document);
            let target = btns[0] || null;
            if (jobIdArg && btns.length) {
              for (let i = 0; i < btns.length; i++) {
                const card = btns[i].closest('[data-job-id], [data-jobpool-job-id], article, li');
                const id =
                  (card &&
                    (card.getAttribute('data-job-id') ||
                      card.getAttribute('data-jobpool-job-id'))) ||
                  '';
                if (String(id) === String(jobIdArg)) {
                  target = btns[i];
                  break;
                }
              }
            }
            if (target) {
              target.click();
              return {
                ok: true,
                jobpoolMarkedApplied: true,
                jobId: jobIdArg,
                submitted: true,
                adapterId: 'jobpool'
              };
            }
          }
          return { ok: false, error: 'JobPool hub mark helpers missing', jobId: jobIdArg };
        },
        args: [markJobId]
      });
    } catch (markErr) {
      if (S && S.appendSessionLog) {
        await S.appendSessionLog({
          type: 'jobpool_hub_mark_error',
          jobId: markJobId,
          error: String((markErr && markErr.message) || markErr)
        });
      }
      return { ok: false, error: String((markErr && markErr.message) || markErr), jobId: markJobId };
    }

    const markOut =
      (markResults && markResults[0] && markResults[0].result) ||
      { ok: false, error: 'No mark result' };

    try {
      if (B && B.markApplied && markJobId) {
        await B.markApplied(
          markJobId,
          withJobPoolStatus({
            fillResult: Object.assign({}, fillResult || {}, markOut || {}),
            submitted: true,
            runMode: runMode || 'submit',
            url: (job && job.url) || pending.hubUrl || '',
            source: 'jobpool_hub_mark',
            jobpoolMarkedApplied: !!(markOut && markOut.jobpoolMarkedApplied)
          })
        );
      }
    } catch (_api2) {}

    await clearJobPoolPendingMark();
    if (S && S.appendSessionLog) {
      await S.appendSessionLog({
        type: 'jobpool_hub_mark',
        jobId: markJobId,
        ok: !!(markOut && markOut.ok),
        jobpoolMarkedApplied: !!(markOut && markOut.jobpoolMarkedApplied)
      });
    }
    return Object.assign({ jobId: markJobId }, markOut || {});
  }

  /**
   * injectAndFill plus Apply-start / external-handoff re-detect retries.
   * Shared by the queue loop and the on-page Auto Fill / Ready / Submit panel.
   */
  async function fillTabWithApplyStart(tabId, profile, documents, runMode, config, job, opts) {
    opts = opts || {};
    let currentTabId = tabId;
    function progress(state, message, phase) {
      const mappedPhase = phase || mapStateToPhase(state, message);
      notifyPagePanel(currentTabId != null ? currentTabId : tabId, {
        state: state || 'running',
        message: message || '',
        phase: mappedPhase
      });
      if (typeof opts.onProgress === 'function') {
        try {
          opts.onProgress(state, message, mappedPhase);
        } catch (_e) {}
      }
    }

    // Wait for load before Apply-start so Single (JobPool link already open) matches Batch.
    if (!opts.skipInitialSettle) {
      try {
        progress('running', 'Waiting for page load…', 'DETECTING');
        await waitTabComplete(currentTabId, 45000);
      } catch (_eWait) {
        /* settle below still helps SPAs */
      }
      try {
        await waitPageSettle(currentTabId, 600, 1200);
      } catch (_eSettle) {}
    }

    function mapStateToPhase(state, message) {
      const s = String(state || '');
      const m = String(message || '');
      if (s === 'done') return RUN_PHASES.COMPLETE;
      if (s === 'timeout' || /plateau|no progress|timed?\s*out/i.test(m)) return RUN_PHASES.TIMEOUT;
      if (s === 'paused' || /missing|blocker|blocked|waiting for user/i.test(m)) {
        if (/captcha|cloudflare|mfa|2fa|otp/i.test(m)) return RUN_PHASES.BLOCKED;
        if (/\bdocument\b|\bfile\b|\bupload\b|\bresume\b|\bcv\b/i.test(m)) return RUN_PHASES.BLOCKED;
        if (/auth|sign in|log in|register|login/i.test(m)) return RUN_PHASES.AUTH_REQUIRED;
        if (/ambiguous/i.test(m)) return RUN_PHASES.AMBIGUOUS;
        if (/waiting for user|action needed|complete manually/i.test(m)) return RUN_PHASES.WAITING_FOR_USER;
        return RUN_PHASES.MISSING_INFORMATION;
      }
      if (s === 'error') return RUN_PHASES.BLOCKED;
      if (/register|sign\s*up/i.test(m)) return RUN_PHASES.REGISTERING;
      if (/navigat|next step|continue/i.test(m) && !/submit/i.test(m)) return RUN_PHASES.NAVIGATING;
      if (/submit/i.test(m)) return RUN_PHASES.SUBMITTING;
      if (/depend/i.test(m)) return RUN_PHASES.WAITING_FOR_DEPENDENT_FIELDS;
      if (/detect|inspect|open/i.test(m)) return RUN_PHASES.DETECTING;
      if (/fill/i.test(m)) return RUN_PHASES.FILLING;
      if (/valid|ready/i.test(m)) return RUN_PHASES.READY;
      return RUN_PHASES.FILLING;
    }

    let preHandoffUrl = '';
    let knownTabIds = {};
    try {
      knownTabIds = await snapshotTabIdSet();
    } catch (_eSnap) {
      knownTabIds = {};
    }
    try {
      const preTab = await chrome.tabs.get(currentTabId);
      preHandoffUrl = (preTab && preTab.url) || '';
    } catch (_ePre) {}

    progress('running', 'Detecting adapter / filling…');
    let packed = await injectAndFill(
      currentTabId,
      profile,
      documents,
      runMode,
      config,
      job,
      { returnTabId: true, maxAttempts: 4 }
    );
    let fillResult = packed.result;
    if (packed.tabId != null) currentTabId = packed.tabId;

    /**
     * Multi-hop: JobPool → board (NaukriGulf) → ATS → application form → …
     * Keep following Apply/external handoffs until filled, submitted, blocked, or hop cap.
     */
    const MAX_HANDOFF_HOPS = 6;
    function needsHandoffHop(r) {
      if (!r || r.ok === false) return false;
      if (r.filled > 0 || r.submitted || r.needsHuman || r.jobpoolMarkedApplied) return false;
      if (r.jobpoolReturnSuccess) return false;
      // Board job detail with Apply handoff flags or unused generic empty fill.
      if (
        r.adapterId &&
        /naukrigulf|michaelpage|bayt|gulftalent/i.test(String(r.adapterId)) &&
        !(r.filled > 0) &&
        !r.submitted &&
        (r.clickedApplyStart ||
          r.handedOff ||
          r.externalApply ||
          r.reDetect ||
          r.usedGenericFallback ||
          r.step === 'standard_apply_handoff' ||
          r.step === 'standard_apply_handoff_retry')
      ) {
        return true;
      }
      return !!(
        r.deferToPageAdapter ||
        r.handedOff ||
        r.externalApply ||
        r.clickedApplyStart ||
        r.reDetect ||
        r.jobpoolHubApply ||
        r.jobpoolPending
      );
    }

    for (let hop = 0; hop < MAX_HANDOFF_HOPS && needsHandoffHop(fillResult); hop++) {
      try {
        progress(
          'running',
          hop === 0
            ? 'Clicked Apply — waiting for form…'
            : 'Following redirect hop ' + (hop + 1) + '/' + MAX_HANDOFF_HOPS + '…'
        );
        await sleep(500 + Math.floor(Math.random() * 400));

        try {
          knownTabIds = Object.assign({}, knownTabIds, await snapshotTabIdSet());
        } catch (_eK) {}

        let handedTab = null;
        try {
          handedTab = await waitForApplyHandoffTab(currentTabId, knownTabIds, 8500);
        } catch (_eHand) {
          handedTab = null;
        }
        if (handedTab && handedTab.id != null && handedTab.id !== currentTabId) {
          await adoptTabAsActiveJob(handedTab.id, progress);
          currentTabId = handedTab.id;
          if (fillResult) {
            fillResult.adoptedNewTab = true;
            fillResult.externalApply = true;
            fillResult.fromTabHandoff = true;
            fillResult.handoffHop = hop + 1;
          }
          try {
            notifyPagePanel(tabId, {
              state: 'running',
              message: 'Apply opened a new tab — continuing there (hop ' + (hop + 1) + ')'
            });
          } catch (_eN) {}
        } else {
          try {
            await waitTabComplete(currentTabId, 45000);
          } catch (_eSame) {}
          await sleep(400 + Math.floor(Math.random() * 350));
        }

        let postUrl = '';
        try {
          const postTab = await chrome.tabs.get(currentTabId);
          postUrl = (postTab && postTab.url) || '';
        } catch (_ePost) {}

        // Employer may have redirected back to JobPool after submit mid-hop
        try {
          const Syn = global.FillApplySynonyms;
          if (
            Syn &&
            typeof Syn.looksLikeJobPoolReturnUrl === 'function' &&
            Syn.looksLikeJobPoolReturnUrl(postUrl)
          ) {
            if (fillResult) {
              fillResult.jobpoolReturnSuccess = true;
              fillResult.handoffHop = hop + 1;
            }
            break;
          }
        } catch (_eRet) {}

        let hostChanged = false;
        try {
          const a = preHandoffUrl ? new URL(preHandoffUrl).hostname : '';
          const b = postUrl ? new URL(postUrl).hostname : '';
          hostChanged = !!(a && b && a !== b);
        } catch (_eHost) {
          hostChanged = !!(preHandoffUrl && postUrl && preHandoffUrl !== postUrl);
        }
        const sameHostOpen = !!(
          (fillResult && fillResult.clickedApplyStart) ||
          (fillResult && fillResult.reDetect) ||
          (fillResult && fillResult.adoptedNewTab) ||
          (fillResult && fillResult.jobpoolHubApply)
        );

        if (!(hostChanged || sameHostOpen || (fillResult && fillResult.adoptedNewTab))) {
          let late = null;
          try {
            late = await findApplyHandoffTab(currentTabId, knownTabIds);
          } catch (_eLate) {}
          if (late && late.id != null && late.id !== currentTabId) {
            await adoptTabAsActiveJob(late.id, progress);
            currentTabId = late.id;
            fillResult.adoptedNewTab = true;
            fillResult.externalApply = true;
            fillResult.fromTabHandoff = true;
          } else if (hop === MAX_HANDOFF_HOPS - 1 && fillResult) {
            fillResult.message =
              (fillResult.message || 'External apply handoff') +
              ' (hop ' +
              (hop + 1) +
              ' — host unchanged; destination may be another tab)';
            break;
          } else if (!fillResult.clickedApplyStart && !fillResult.jobpoolHubApply) {
            break;
          }
        }

        preHandoffUrl = postUrl || preHandoffUrl;
        progress('running', 'Re-detect / fill after hop ' + (hop + 1) + '…');
        const handedPack = await injectAndFill(
          currentTabId,
          profile,
          documents,
          runMode,
          config,
          job,
          { returnTabId: true, maxAttempts: 4 }
        );
        const handed = handedPack && handedPack.result;
        if (handedPack && handedPack.tabId != null) currentTabId = handedPack.tabId;
        if (handed) {
          if (hostChanged) handed.externalApply = true;
          if (fillResult && fillResult.clickedApplyStart) handed.fromApplyStart = true;
          if (fillResult && fillResult.jobpoolHubApply) handed.fromJobPoolHub = true;
          handed.fromBoardHandoff =
            (fillResult && fillResult.adapterId) || (handed && handed.adapterId) || true;
          handed.handoffHop = hop + 1;
          if (!handed.message && fillResult && fillResult.message) {
            handed.message = fillResult.message;
          }
          fillResult = handed;
        } else {
          break;
        }
      } catch (handoffErr) {
        if (fillResult && !fillResult.error) {
          fillResult.handoffWaitError = String(
            (handoffErr && handoffErr.message) || handoffErr || 'handoff wait failed'
          );
        }
        break;
      }
    }

    return { result: fillResult, tabId: currentTabId };
  }

  function isRestrictedTabUrl(url) {
    if (!url) return true;
    if (/^chrome-extension:\/\//i.test(url)) return true;
    return /^(chrome|edge|about|devtools|view-source):/i.test(url);
  }

  /**
   * Single current-tab run for the on-page panel (and FILL_APPLY_FILL_ONCE).
   * Reuses injectAndFill + Apply-start retries. Does not consume the queue
   * or persist the requested runMode onto the saved side-panel config.
   */
  async function runOnceOnTab(tabId, runMode) {
    const S = global.FillApplyStorage;
    const P = global.FillApplyProfile;
    const B = global.FillApplyBackend;

    if (tabId == null) {
      throw new Error('No tab id — open a job application page');
    }
    if (loopActive || (await S.isRunning())) {
      throw new Error('Queue runner is busy. Stop the batch first.');
    }
    if (currentTabRunActive) {
      throw new Error('A current-tab run is already in progress.');
    }

    let mode = runMode;
    if (global.FillApplyTypes && global.FillApplyTypes.RUN_MODES) {
      if (global.FillApplyTypes.RUN_MODES.indexOf(mode) === -1) mode = 'fill';
    } else if (['register', 'fill', 'navigate', 'ready', 'submit'].indexOf(mode) === -1) {
      mode = 'fill';
    }

    const tab = await chrome.tabs.get(tabId);
    if (!tab || isRestrictedTabUrl(tab.url)) {
      throw new Error('Cannot fill this page. Open a real http(s) apply form.');
    }

    const job = {
      title: tab.title || 'Current page',
      url: tab.url
    };

    currentTabRunActive = true;
    notifyPagePanel(tabId, { state: 'running', message: 'Starting ' + mode + '…' });

    try {
      if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.assertSelectedSourceComplete) {
        const gate = await global.FillApplySourceProfiles.assertSelectedSourceComplete();
        if (!gate.ok) {
          const err = new Error(gate.error || 'Complete selected source profile in App Settings');
          err.code = 'SOURCE_PROFILE_INCOMPLETE';
          notifyPagePanel(tabId, { state: 'error', message: err.message });
          throw err;
        }
      }

      let profile = P ? await P.getProfile() : await B.getProfile();
      if (!(profile && (profile.email || profile.fullName || profile.firstName))) {
        const err = new Error('Profile is empty. Open App Settings and fill identity first.');
        notifyPagePanel(tabId, { state: 'error', message: err.message });
        throw err;
      }
      if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.getEffectiveProfile) {
        try {
          profile = await global.FillApplySourceProfiles.getEffectiveProfile(profile);
        } catch (_mergeErr) {}
      }
      // Stamp adaptive KB snapshot for on-page panel / FILL_ONCE path too.
      if (global.FillApplyKnowledgeStore && global.FillApplyKnowledgeStore.attachToProfile) {
        try {
          profile = await global.FillApplyKnowledgeStore.attachToProfile(profile);
        } catch (_kbErr) {
          /* fill without adaptive snapshot */
        }
      }

      const config = await S.getRunConfig();
      let documents = await B.getDocuments();
      try {
        if (global.FillApplyFiles && typeof global.FillApplyFiles.resolveDocumentLinks === 'function') {
          const resolved = await global.FillApplyFiles.resolveDocumentLinks(documents, profile);
          documents = resolved.documents || documents;
          if (resolved.needsManual && resolved.errors && resolved.errors.length) {
            await pauseForHuman(job, tabId, 'documents', {
              message: resolved.errors[0] || 'Open Drive link or upload file manually',
              skipQueue: true,
              mode: 'single'
            });
            return {
              pausedForHuman: true,
              state: 'paused',
              message: resolved.errors[0],
              runMode: mode,
              result: { ok: true, needsHuman: true, pauseReason: 'documents' }
            };
          }
        }
      } catch (_docLinkErr) {}

      await focusTab(tabId);

      const challenge = await detectChallengeInTab(tabId);
      if (challenge && challenge.challenged) {
        const msg =
          challenge.kind === 'cloudflare'
            ? 'Paused — verify Cloudflare/CAPTCHA'
            : 'Paused — verify Cloudflare/CAPTCHA';
        await pauseForHuman(job, tabId, 'challenge', {
          message: msg,
          challenge: challenge,
          skipQueue: true,
          mode: 'single'
        });
        return {
          pausedForHuman: true,
          state: 'paused',
          message: msg,
          runMode: mode,
          result: { ok: true, needsHuman: true, pauseReason: 'challenge', challenge: challenge }
        };
      }

      await S.appendSessionLog({
        type: 'single_start',
        runMode: mode,
        url: tab.url,
        message: 'On-page panel — ' + mode + ' on current tab'
      });

      // JobPool overview links often need Apply-start; wait for load like Batch openJobTab.
      try {
        notifyPagePanel(tabId, { state: 'running', message: 'Waiting for page load…' });
        await waitTabComplete(tabId, 45000);
      } catch (_eLoad) {}
      try {
        await waitPageSettle(tabId, 600, 1200);
      } catch (_eSettleOnce) {}

      const packed = await fillTabWithApplyStart(
        tabId,
        profile,
        documents,
        mode,
        config,
        job,
        { skipInitialSettle: true }
      );
      let fillResult = packed.result;
      const resultTabId = packed.tabId != null ? packed.tabId : tabId;

      if (
        fillResult &&
        !fillResult.needsHuman &&
        fillResult.error &&
        /could not advance step/i.test(String(fillResult.error))
      ) {
        fillResult.needsHuman = true;
        fillResult.pauseReason = fillResult.pauseReason || 'could_not_advance';
      }

      if (fillResult && fillResult.needsHuman) {
        const missingFields = Array.isArray(fillResult.missingProfileFields)
          ? fillResult.missingProfileFields
          : null;
        const isMissingProfile =
          fillResult.pauseReason === 'missing_profile_field' ||
          looksLikeMissingProfile(fillResult.error, missingFields);
        const msg = isMissingProfile
          ? fillResult.error ||
            'Missing profile field — fill in App Settings or on the page, then retry'
          : fillResult.pauseReason === 'structure_drift'
            ? fillResult.error || 'Form changed — review required'
            : fillResult.error || 'Paused — verify Cloudflare/CAPTCHA';
        await pauseForHuman(
          job,
          resultTabId,
          isMissingProfile ? 'missing_profile_field' : fillResult.pauseReason || 'challenge',
          {
            message: msg,
            challenge: fillResult.challenge || null,
            driftLabel: fillResult.driftLabel || null,
            missingProfileFields: missingFields,
            unknownFields: fillResult.unknownFields || null,
            skipQueue: true,
            mode: 'single'
          }
        );
        return {
          pausedForHuman: true,
          state: 'paused',
          message: msg,
          runMode: mode,
          result: fillResult
        };
      }

      const challengeAfter = await detectChallengeInTab(resultTabId);
      if (challengeAfter && challengeAfter.challenged) {
        const msg = 'Paused — verify Cloudflare/CAPTCHA';
        await pauseForHuman(job, resultTabId, 'challenge', {
          message: msg,
          challenge: challengeAfter,
          skipQueue: true,
          mode: 'single'
        });
        return {
          pausedForHuman: true,
          state: 'paused',
          message: msg,
          runMode: mode,
          result: fillResult
        };
      }

      await S.appendSessionLog({
        type: 'fill_once',
        mode: mode,
        runMode: mode,
        filled: fillResult && fillResult.filled,
        adapterId: fillResult && fillResult.adapterId,
        submitted: !!(fillResult && fillResult.submitted),
        advanced: !!(fillResult && fillResult.advanced)
      });

      if (!fillResult || fillResult.ok === false) {
        const err = (fillResult && fillResult.error) || 'Fill failed';
        notifyPagePanel(resultTabId, { state: 'error', message: err, result: fillResult });
        return {
          state: 'error',
          message: err,
          runMode: mode,
          result: fillResult || { ok: false, error: err }
        };
      }

      // JobPool hub: after employer submit / return-success, Mark as applied on hub.
      let hubMark = null;
      try {
        hubMark = await maybeCompleteJobPoolHubMark(resultTabId, fillResult, mode, job);
        if (hubMark && hubMark.jobpoolMarkedApplied) {
          fillResult = Object.assign({}, fillResult, {
            jobpoolMarkedApplied: true,
            jobpoolHubJobId: hubMark.jobId || null
          });
        }
      } catch (_hubErr) {
        hubMark = { ok: false, error: String((_hubErr && _hubErr.message) || _hubErr) };
      }

      const bits = [];
      if (fillResult.filled != null) {
        bits.push('filled ' + fillResult.filled + '/' + (fillResult.total != null ? fillResult.total : '?'));
      }
      if (fillResult.advanced) bits.push('ready');
      if (fillResult.submitted) bits.push('submitted');
      if (fillResult.jobpoolMarkedApplied) bits.push('jobpool-marked');
      if (fillResult.adapterId) bits.push(fillResult.adapterId);
      const doneMsg = bits.length ? bits.join(' · ') : 'Done';
      notifyPagePanel(resultTabId, { state: 'done', message: doneMsg, result: fillResult });
      return {
        state: 'done',
        message: doneMsg,
        runMode: mode,
        result: fillResult,
        jobpoolHubMark: hubMark
      };
    } catch (e) {
      const msg = String((e && e.message) || e);
      notifyPagePanel(tabId, { state: 'error', message: msg });
      await S.appendSessionLog({ type: 'error', error: msg, runMode: mode, source: 'page_panel' });
      throw e;
    } finally {
      currentTabRunActive = false;
    }
  }

  /**
   * Auto Apply E2E (v1.24): one feature, zero human pauses.
   *
   * Loop: JobPool queue → open tab → handle auth walls / registration
   * (signup-login with stored credentials, never inventing passwords) →
   * fill + navigate + submit via fillTabWithApplyStart → mark the job on
   * JobPool with EXACTLY one of: applied | blocked | error → next job.
   *
   * Blockers never pause the batch. A blocked job is terminalized
   * immediately (page auto-loads the next job) and is logged for human
   * review in the session log + panel Blocked list.
   *
   * Anti-infinite-loop guards:
   *  - max 2 attempts per job (attemptsLive counter incremented each try)
   *  - a skipped job is re-queued at the BACK of the queue, never the front
   *  - challenge-at-open no longer returns early; it marks Blocked and moves on
   *  - single flat pass over the queue (no re-adding on pause/resume)
   */
  const AUTO_APPLY_MAX_ATTEMPTS = 2;
  const AUTO_APPLY_REVIEW_KEY = 'fillApply.autoApplyReview';

  function autoApplyOutcomeFor(fillResult, job) {
    const Types = global.FillApplyTypes || {};
    if (Types.autoApplyStatus) {
      return Types.autoApplyStatus(fillResult);
    }
    // Fallback mapping if types.js is an older build.
    if (fillResult && fillResult.submitted) return 'applied';
    return 'error';
  }

  async function recordAutoApplyReview(job, outcome, fillResult) {
    try {
      const cur = await new Promise(function (resolve) {
        chrome.storage.local.get([AUTO_APPLY_REVIEW_KEY], function (r) {
          resolve((r && r[AUTO_APPLY_REVIEW_KEY]) || []);
        });
      });
      const list = Array.isArray(cur) ? cur.slice(-49) : [];
      list.push({
        jobId: job && job.id,
        title: (job && job.title) || '',
        company: (job && job.company) || '',
        url: (job && job.url) || '',
        outcome: outcome,
        reason:
          (fillResult &&
            (fillResult.pauseReason || fillResult.error || fillResult.message)) ||
          '',
        at: Date.now()
      });
      await new Promise(function (resolve) {
        chrome.storage.local.set(
          { [AUTO_APPLY_REVIEW_KEY]: list },
          function () {
            void chrome.runtime.lastError;
            resolve();
          }
        );
      });
    } catch (_e) {
      /* review list is best-effort */
    }
  }

  /**
   * Terminalize one job in the Auto Apply pass.
   * - applied → applied bucket + JobPool 'submitted'
   * - blocked → failed bucket + JobPool 'blocked' + human-review log
   * - error   → failed bucket + JobPool 'error'
   * Always continues to the next job (no pauses).
   */
  async function finalizeAutoApplyJob(job, outcome, fillResult, runMode, config, tabId) {
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;

    const payload = {
      fillResult: fillResult || null,
      submitted: outcome === 'applied',
      blocked: outcome === 'blocked',
      status: outcome,
      outcome: outcome,
      runMode: runMode,
      url: (job && job.url) || '',
      autoApply: true,
      attempts: Math.max((job && job.attemptsLive) || 0, AUTO_APPLY_MAX_ATTEMPTS)
    };
    if (fillResult && fillResult.error) payload.error = fillResult.error;

    try {
      if (outcome === 'applied') {
        await B.markApplied(job.id, withJobPoolStatus(payload));
      } else if (outcome === 'blocked') {
        await B.markApplied(job.id, withJobPoolStatus(Object.assign({}, payload, {
          failed: true,
          error: (fillResult && fillResult.error) || 'Blocked — needs human review'
        })));
        await recordAutoApplyReview(job, 'blocked', fillResult);
      } else {
        await B.markApplied(job.id, withJobPoolStatus(Object.assign({}, payload, {
          failed: true,
          error: (fillResult && fillResult.error) || 'Auto Apply error'
        })));
        if (fillResult && fillResult.pauseReason === 'missing_profile_field') {
          await recordAutoApplyReview(job, 'error', fillResult);
        }
      }
    } catch (markErr) {
      await S.appendSessionLog({
        type: 'error',
        jobId: job.id,
        error: 'Auto Apply mark failed: ' + String((markErr && markErr.message) || markErr)
      });
    }

    await S.appendSessionLog({
      type: 'auto_apply_result',
      jobId: job.id,
      title: job.title || '',
      url: job.url || '',
      status: outcome,
      reason:
        (fillResult && (fillResult.pauseReason || fillResult.error)) ||
        (outcome === 'applied' ? 'submitted' : '')
    });

    // Auto-close: submitted tabs only (same policy as submit mode).
    if (outcome === 'applied' && config && config.autoCloseAppliedTab && tabId != null) {
      try {
        await trackSubmittedTabAndPrune(tabId, job.id, config, tabId);
      } catch (_prune) {
        /* best-effort */
      }
    }

    currentJobId = null;
    const counts = B.refreshCounts ? await B.refreshCounts() : { queued: 0 };
    await S.setQueueStatus({
      remaining: counts.queued,
      currentJobId: null,
      counts: counts,
      lastJobTitle: (job.company ? job.company + ' — ' : '') + (job.title || job.id),
      lastError: outcome === 'error' ? (fillResult && fillResult.error) || 'error' : null
    });
  }

  /**
   * Auto Apply batch loop. Owns chrome.storage 'running' flag while active.
   * Never pauses for humans: every blocker terminalizes the job and the loop
   * immediately opens the next one.
   */
  async function runAutoApplyLoop() {
    if (autoApplyActive) return getStatusSnapshot();
    autoApplyActive = true;
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    const P = global.FillApplyProfile;

    try {
      if (S.clearPausedForHuman) await S.clearPausedForHuman();
      await S.setRunning(true);
      await S.appendSessionLog({ type: 'start', message: 'Auto Apply E2E batch started' });

      while (await S.isRunning()) {
        let config = await S.getRunConfig();
        let job = null;
        try {
          job = await B.getNextJob();
        } catch (e) {
          const em = String((e && e.message) || e);
          await S.appendSessionLog({ type: 'error', error: em });
          await S.setQueueStatus({ lastError: em });
          break;
        }
        if (!job) {
          await S.appendSessionLog({ type: 'queue_empty', message: 'Auto Apply — queue drained' });
          currentJobId = null;
          await S.setQueueStatus({ remaining: 0, currentJobId: null });
          if (B.refreshCounts) await B.refreshCounts();
          break;
        }
        if (!(await S.isRunning())) break;

        currentJobId = job.id;
        await S.setQueueStatus({
          currentJobId: job.id,
          lastJobTitle: (job.company ? job.company + ' — ' : '') + (job.title || job.id),
          lastError: null
        });
        await S.appendSessionLog({
          type: 'job_start',
          jobId: job.id,
          title: job.title,
          url: job.url,
          runMode: 'auto_apply'
        });

        // Attempt cap — anti-infinite-loop guard.
        const attemptsLive = ((job.attemptsLive || 0) + 1) | 0;
        const lastAttempt = attemptsLive >= AUTO_APPLY_MAX_ATTEMPTS;
        job.attemptsLive = attemptsLive;

        let tab = null;
        let fillResult = null;

        try {
          // Resume path: reuse the tab a human left open from review.
          if (resumeTabId != null) {
            try {
              const existing = await chrome.tabs.get(resumeTabId);
              if (existing && existing.id != null) {
                tab = existing;
                await focusTab(tab.id);
                await sleep(400 + Math.floor(Math.random() * 300));
              }
            } catch (_e) {
              tab = null;
            }
            resumeTabId = null;
          }
          if (!tab) {
            tab = await openJobTab(job);
          }
          if (!(await S.isRunning())) break;

          await focusTab(tab.id);

          // Challenge at open: mark Blocked and move on (no return early).
          const challenge = await detectChallengeInTab(tab.id);
          if (challenge && challenge.challenged && lastAttempt) {
            await finalizeAutoApplyJob(job, 'blocked', {
              ok: false,
              pauseReason: 'challenge',
              challenge: challenge,
              error: 'Cloudflare/CAPTCHA — needs human verification'
            }, 'auto_apply', config, tab.id);
            tab = null;
            const d = jitteredDelay(config.delayMs);
            if (d > 0 && (await S.isRunning())) await sleep(d);
            continue;
          }

          const profile = P ? await P.getProfile() : await B.getProfile();
          let effProfile = profile;
          if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.getEffectiveProfile) {
            try {
              effProfile = await global.FillApplySourceProfiles.getEffectiveProfile(profile);
            } catch (_merge) {
              /* keep base */
            }
          }
          if (global.FillApplyKnowledgeStore && global.FillApplyKnowledgeStore.attachToProfile) {
            try {
              effProfile = await global.FillApplyKnowledgeStore.attachToProfile(effProfile);
            } catch (_kb) {
              /* fill without adaptive snapshot */
            }
          }
          let documents = await B.getDocuments();
          try {
            if (
              global.FillApplyFiles &&
              typeof global.FillApplyFiles.resolveDocumentLinks === 'function'
            ) {
              const resolved = await global.FillApplyFiles.resolveDocumentLinks(documents, effProfile);
              documents = resolved.documents || documents;
            }
          } catch (_doc) {
            /* fill with whatever we have */
          }

          // ATS account / Google OAuth lifecycle — one pass, never pauses.
          // Final-attempt auth walls below are terminalized as Blocked.
          try {
            const authAttempt = await attemptAtsGoogleAuthLifecycle(tab.id, effProfile, job);
            const authOut = authAttempt && authAttempt.outcome;
            if (authAttempt && authAttempt.paused && authOut && lastAttempt) {
              await finalizeAutoApplyJob(job, 'blocked', {
                ok: false,
                pauseReason: 'ats_auth',
                error:
                  (global.FillApplyAtsAuth && global.FillApplyAtsAuth.pauseMessageForResult
                    ? global.FillApplyAtsAuth.pauseMessageForResult(authOut.result, authOut.detail)
                    : null) ||
                  authOut.detail ||
                  'Authentication required — needs human sign-in',
                authResult: authOut.result
              }, 'auto_apply', config, tab.id);
              tab = null;
              const dAuth = jitteredDelay(config.delayMs);
              if (dAuth > 0 && (await S.isRunning())) await sleep(dAuth);
              continue;
            }
          } catch (authErr) {
            await S.appendSessionLog({
              type: 'ats_auth',
              jobId: job.id,
              message: 'ATS auth lifecycle error — continuing to fill',
              error: String((authErr && authErr.message) || authErr)
            });
          }
          config = Object.assign({}, config || {}, { skipAtsAuth: true, jobId: job.id });

          // Fill + navigate + submit (multi-hop handoffs inside).
          const packed = await fillTabWithApplyStart(
            tab.id,
            effProfile,
            documents,
            'submit',
            config,
            job,
            {}
          );
          fillResult = packed.result;
          if (packed.tabId != null && tab) tab.id = packed.tabId;

          // Promote silent "could not advance" to a reviewable blocker.
          if (
            fillResult &&
            !fillResult.needsHuman &&
            fillResult.error &&
            /could not advance step/i.test(String(fillResult.error))
          ) {
            fillResult.needsHuman = true;
            fillResult.pauseReason = fillResult.pauseReason || 'could_not_advance';
          }

          // Any needsHuman from adapters → Blocked (or requeue on first attempt).
          if (fillResult && fillResult.needsHuman) {
            if (lastAttempt) {
              await finalizeAutoApplyJob(job, 'blocked', fillResult, 'auto_apply', config, tab.id);
              tab = null;
            } else {
              await requeueAutoApplyJob(job);
              tab = null;
            }
            const dNeed = jitteredDelay(config.delayMs);
            if (dNeed > 0 && (await S.isRunning())) await sleep(dNeed);
            continue;
          }

          await S.appendSessionLog({
            type: 'fill',
            jobId: job.id,
            result: {
              ok: fillResult && fillResult.ok,
              adapterId: fillResult && fillResult.adapterId,
              filled: fillResult && fillResult.filled,
              submitted: !!(fillResult && fillResult.submitted),
              advanced: !!(fillResult && fillResult.advanced)
            }
          });

          // Map to the three statuses and terminalize.
          let outcome = autoApplyOutcomeFor(fillResult, job);
          if (!lastAttempt && outcome !== 'applied') {
            // First try with a non-applied result: give it one more attempt
            // unless the result is a hard human gate (blocked) — blocked is
            // terminal even on attempt 1 because a human must clear it.
            const reason = String((fillResult && fillResult.pauseReason) || '');
            const hardGate =
              outcome === 'blocked' ||
              reason === 'challenge' ||
              reason === 'ats_auth' ||
              reason === 'missing_profile_field';
            if (!hardGate) {
              await requeueAutoApplyJob(job);
              tab = null;
              const dRetry = jitteredDelay(config.delayMs);
              if (dRetry > 0 && (await S.isRunning())) await sleep(dRetry);
              continue;
            }
          }

          await finalizeAutoApplyJob(job, outcome, fillResult, 'auto_apply', config, tab ? tab.id : null);
          tab = null;
        } catch (e) {
          const msg = String((e && e.message) || e);
          if (!(await S.isRunning())) break;
          if (isFrameInvalidError(e) && !lastAttempt) {
            // Frame churn on attempt 1 — retry the same job once.
            await S.appendSessionLog({
              type: 'frame_retry',
              jobId: job.id,
              error: msg,
              note: 'Auto Apply — frame invalidated, retrying once'
            });
            try {
              await requeueAutoApplyJob(job);
            } catch (_rq) {
              await finalizeAutoApplyJob(job, 'error', { ok: false, error: msg }, 'auto_apply', config, null);
            }
          } else {
            await finalizeAutoApplyJob(job, 'error', { ok: false, error: msg }, 'auto_apply', config, null);
            tab = null;
          }
        }

        if (!(await S.isRunning())) break;
        const delay = jitteredDelay(config.delayMs);
        if (delay > 0) {
          await S.appendSessionLog({ type: 'delay', ms: delay });
          await sleep(delay);
        }
      }
    } finally {
      clearDelay();
      autoApplyActive = false;
      const stillRunning = await S.isRunning();
      if (!stillRunning || currentJobId) {
        if (currentJobId && B.markCancelled) {
          try {
            await B.markCancelled(currentJobId, 'Auto Apply stopped');
          } catch (_c) {
            /* ignore */
          }
        }
        await S.setRunning(false);
      }
      currentJobId = null;
      await S.appendSessionLog({ type: 'idle', message: 'Auto Apply batch ended' });
    }

    return getStatusSnapshot();
  }

  /**
   * Requeue a job for its second (final) Auto Apply attempt.
   * Appends to the BACK of the queued list so the loop cannot spin on one job.
   */
  async function requeueAutoApplyJob(job) {
    const B = global.FillApplyBackend;
    const S = global.FillApplyStorage;
    try {
      const queued = await B.getQueued();
      const current = queued.find(function (j) {
        return j.id === job.id;
      });
      const entry = Object.assign({}, current || job, {
        attemptsLive: Math.max((job.attemptsLive || 0), (current && current.attemptsLive) || 0),
        updatedAt: Date.now()
      });
      const rest = queued.filter(function (j) {
        return j.id !== job.id;
      });
      await B.setQueued(rest.concat([entry]));
      currentJobId = null;
      await S.appendSessionLog({
        type: 'auto_apply_retry',
        jobId: job.id,
        attempts: entry.attemptsLive,
        message: 'Auto Apply — requeued for final attempt'
      });
    } catch (rqErr) {
      // Could not requeue — terminalize as error so the job is never lost or looped.
      await finalizeAutoApplyJob(job, 'error', {
        ok: false,
        error: 'Requeue failed: ' + String((rqErr && rqErr.message) || rqErr)
      }, 'auto_apply', null, null);
    }
  }

  /**
   * Pull Ready-to-apply jobs from JobPool into the local queue.
   * 1) JobPool queue API (uses the user's session cookies)
   * 2) Fallback: scrape Apply links from the Applications page
   * Used by startAutoApply when the local queue is empty.
   */
  async function loadJobsFromJobPoolInternal() {
    const Types = global.FillApplyTypes || {};
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    const base = String(Types.JOBPOOL_DEFAULT_BASE_URL || 'https://zahid-jobpool.vercel.app').replace(/\/$/, '');
    const appsUrl = base + '/applications';

    let api = { jobs: [], source: 'none', baseUrl: base };
    if (B && B.loadJobsFromJobPool) {
      try {
        api = await B.loadJobsFromJobPool({ baseUrl: base });
      } catch (_apiErr) {
        api = { jobs: [], source: 'api-error', baseUrl: base };
      }
    }

    let jobs = (api && api.jobs) || [];

    if (!jobs.length) {
      // Scrape Ready-to-apply cards from the Applications page (session cookies).
      let tab = null;
      try {
        const tabs = await chrome.tabs.query({});
        for (let i = 0; i < tabs.length; i++) {
          const u = tabs[i] && tabs[i].url ? String(tabs[i].url) : '';
          if (/zahid-jobpool\.vercel\.app/i.test(u) && /application/i.test(u)) {
            tab = tabs[i];
            break;
          }
        }
        if (!tab) {
          tab = await chrome.tabs.create({ url: appsUrl, active: false });
          await waitTabComplete(tab.id, 20000).catch(function () {});
          await sleep(1800);
        }
        const inj = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function () {
            function abs(href) {
              try {
                return new URL(href, location.href).href;
              } catch (_e) {
                return '';
              }
            }
            function isHttp(u) {
              return /^https?:\/\//i.test(u || '');
            }
            function isJobPool(u) {
              return /zahid-jobpool\.vercel\.app|\/applications/i.test(u || '');
            }
            var out = [];
            var seen = {};
            var nodes = document.querySelectorAll(
              'a[href], button, [role="button"], [data-fill-apply="jobpool-apply"]'
            );
            for (var i = 0; i < nodes.length; i++) {
              var el = nodes[i];
              var label = String(
                el.innerText || el.textContent || el.getAttribute('aria-label') || ''
              )
                .replace(/\s+/g, ' ')
                .trim();
              if (!/^apply$/i.test(label) && el.getAttribute('data-fill-apply') !== 'jobpool-apply') continue;
              if (/mark as applied/i.test(label)) continue;
              var href =
                el.getAttribute('href') ||
                el.getAttribute('data-href') ||
                el.getAttribute('data-url') ||
                el.getAttribute('data-apply-url') ||
                '';
              if (!href && el.closest) {
                var a = el.closest('a[href]');
                if (a) href = a.getAttribute('href') || '';
              }
              href = abs(href);
              if (!isHttp(href) || isJobPool(href)) continue;
              if (seen[href]) continue;
              seen[href] = true;
              var card =
                (el.closest &&
                  el.closest(
                    '[data-job-id], [data-jobpool-job-id], article, li, section, [class*="card"]'
                  )) ||
                el.parentElement;
              var blob = card ? String(card.innerText || '').slice(0, 800) : '';
              var idMatch = blob.match(/Job ID:\s*([^\s·\n]+)/i);
              var id =
                (card &&
                  (card.getAttribute('data-job-id') || card.getAttribute('data-jobpool-job-id'))) ||
                (idMatch && idMatch[1]) ||
                'jobpool-' + (out.length + 1);
              var titleLine =
                blob
                  .split('\n')
                  .map(function (l) {
                    return l.trim();
                  })
                  .filter(Boolean)[0] || 'Job';
              out.push({
                id: String(id),
                title: titleLine.slice(0, 120),
                url: href,
                status: 'queued',
                meta: { source: 'jobpool-scrape' }
              });
            }
            return out;
          }
        });
        const scraped = (inj && inj[0] && inj[0].result) || [];
        jobs = B && B.normalizeLiveQueue ? B.normalizeLiveQueue(scraped) : scraped;
      } catch (_scrapeErr) {
        jobs = [];
      }
    }

    if (jobs.length && B) {
      await B.setQueued(jobs);
      const counts = B.refreshCounts ? await B.refreshCounts() : { queued: jobs.length };
      await S.setQueueStatus({ remaining: jobs.length, counts: counts, lastError: null });
    }
    return { jobs: jobs, source: api.source, applicationsUrl: appsUrl };
  }

  /**
   * Start the Auto Apply E2E batch (popup Start button).
   * Refuses to double-start against the legacy loop; stops legacy loop if active.
   */
  async function startAutoApply() {
    const S = global.FillApplyStorage;
    if (loopActive || autoApplyActive || (await S.isRunning())) {
      // Legacy loop holds the flag — stop it, take over.
      if (loopActive && !autoApplyActive) {
        await stopRunner();
      } else {
        return getStatusSnapshot();
      }
    }
    if (global.FillApplyStorage.clearPausedForHuman) {
      await global.FillApplyStorage.clearPausedForHuman();
    }
    await clearMissingFieldsPauseState();

    // Live queue: pull Ready-to-apply jobs from JobPool if local queue is empty.
    const B = global.FillApplyBackend;
    try {
      const queuedNow = await B.getQueued();
      if (!queuedNow.length) {
        try {
          const loaded = await loadJobsFromJobPoolInternal();
          if (loaded && loaded.jobs && loaded.jobs.length) {
            await S.appendSessionLog({
              type: 'info',
              message: 'Auto Apply — loaded ' + loaded.jobs.length + ' jobs from JobPool'
            });
          }
        } catch (_load) {
          /* queue stays empty → loop logs queue_empty */
        }
      }
    } catch (_q) {
      /* ignore */
    }

    runAutoApplyLoop().catch(async function (e) {
      await S.setRunning(false);
      await S.appendSessionLog({
        type: 'error',
        error: 'Auto Apply: ' + String((e && e.message) || e)
      });
    });
    await sleep(50);
    return getStatusSnapshot();
  }

  async function getStatusSnapshot() {
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    const running = await S.isRunning();
    const config = await S.getRunConfig();
    const queueStatus = await S.getQueueStatus();
    const log = await S.getSessionLog();
    const paused = S.isPausedForHuman ? await S.isPausedForHuman() : null;
    let counts = queueStatus.counts || {
      queued: 0,
      applied: 0,
      failed: 0,
      cancelled: 0
    };
    try {
      if (B.getBucketsSnapshot) {
        const snap = await B.getBucketsSnapshot();
        counts = snap.counts;
        // Auto Apply 3-status view: split the failed bucket into Blocked vs Error
        // using the outcome recorded on each job when it was terminalized.
        let blocked = 0;
        let errored = 0;
        const failedList = Array.isArray(snap.failed) ? snap.failed : [];
        failedList.forEach(function (j) {
          const st =
            (j && (j.jobPoolStatus || (j.result && j.result.status) || (j.result && j.result.outcome))) ||
            '';
          if (st === 'blocked') blocked += 1;
          else errored += 1;
        });
        counts.blocked = blocked;
        counts.error = errored;
      } else if (B.refreshCounts) {
        counts = await B.refreshCounts();
      }
    } catch (_e) {
      /* keep stored */
    }
    return {
      running: running,
      pausedForHuman: !!(paused && paused.paused),
      pauseInfo: paused && paused.paused ? paused : null,
      config: config,
      queueStatus: Object.assign({}, queueStatus, {
        remaining: counts.queued,
        counts: counts,
        currentJobId: currentJobId || queueStatus.currentJobId,
        pausedForHuman: !!(paused && paused.paused)
      }),
      counts: counts,
      lastErrors: log
        .filter(function (e) {
          return e.type === 'error' || e.error;
        })
        .slice(-5)
        .reverse(),
      recentLog: log.slice(-10).reverse()
    };
  }

  async function stopRunner() {
    clearDelay();
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    const jobId = currentJobId;
    await S.setRunning(false);
    if (S.clearPausedForHuman) await S.clearPausedForHuman();
    await clearMissingFieldsPauseState();
    loopActive = false;
    pausedTabId = null;

    if (jobId && B.markCancelled) {
      try {
        await B.markCancelled(jobId, 'Stopped by user');
      } catch (_e) {
        /* ignore */
      }
    }
    currentJobId = null;
    await S.appendSessionLog({
      type: 'stop',
      note: 'Current job cancelled if incomplete; remaining stay queued'
    });
    await S.setQueueStatus({ pausedForHuman: false, lastError: null });
    return getStatusSnapshot();
  }

  function isCriticalFailure(fillResult) {
    if (!fillResult) return true;
    if (fillResult.needsHuman) return false; // handled as pause, not failed
    if (fillResult.ok === false) return true;
    if (fillResult.error) {
      if (/no adapter|registry missing|not loaded|inject/i.test(fillResult.error)) return true;
    }
    return false;
  }

  async function runLoop() {
    if (loopActive) return;
    loopActive = true;
    const S = global.FillApplyStorage;
    const B = global.FillApplyBackend;
    const P = global.FillApplyProfile;

    try {
      if (S.clearPausedForHuman) await S.clearPausedForHuman();
      await S.setRunning(true);
      await S.appendSessionLog({ type: 'start' });

      while (await S.isRunning()) {
        let config = await S.getRunConfig();
        const runMode = resolveRunMode(config);
        let job = null;
        try {
          job = await B.getNextJob();
        } catch (e) {
          var em = String(e && e.message ? e.message : e);
          if (/DOCTYPE|not valid JSON|returned HTML|HTTP 404/i.test(em)) {
            em =
              'JobPool API unavailable (HTML/404). Open Applications, click Load from JobPool, then Start — or run Single on the Applications tab.';
          }
          await S.appendSessionLog({ type: 'error', error: em });
          await S.setQueueStatus({ lastError: em });
          break;
        }

        if (!job) {
          await S.appendSessionLog({ type: 'queue_empty' });
          currentJobId = null;
          await S.setQueueStatus({
            remaining: 0,
            currentJobId: null,
            lastJobTitle: null
          });
          if (B.refreshCounts) await B.refreshCounts();
          break;
        }

        currentJobId = job.id;
        await S.setQueueStatus({
          currentJobId: job.id,
          lastJobTitle: (job.company ? job.company + ' — ' : '') + (job.title || job.id),
          lastError: null,
          pausedForHuman: false
        });
        await S.appendSessionLog({
          type: 'job_start',
          jobId: job.id,
          title: job.title,
          url: job.url,
          runMode: runMode
        });

        if (!(await S.isRunning())) break;

        // Per-source apply cap / Ashby same-role soft block — before open/submit
        if (S.checkSourceApplyCap) {
          try {
            const cap = await S.checkSourceApplyCap(job, config);
            if (cap && cap.ok === false) {
              const reason =
                cap.reason ||
                'Source apply cap reached (' +
                  (cap.count != null ? cap.count : '?') +
                  '/' +
                  (cap.limit != null ? cap.limit : '?') +
                  ' for ' +
                  (cap.sourceId || 'source') +
                  ')';
              await S.appendSessionLog({
                type: 'source_cap',
                jobId: job.id,
                sourceId: cap.sourceId,
                reason: reason,
                kind: cap.kind || 'cap'
              });
              notifySourceCap(job, reason);
              if (B.markCancelled) {
                await B.markCancelled(job.id, reason);
              } else if (B.markFailed) {
                await B.markFailed(job.id, reason, {
                  blocked: true,
                  sourceCap: true,
                  sourceId: cap.sourceId
                });
              } else {
                await B.markApplied(job.id, withJobPoolStatus({
                  failed: true,
                  error: reason,
                  blocked: true,
                  sourceCap: true,
                  url: job.url
                }));
              }
              currentJobId = null;
              const counts = B.refreshCounts ? await B.refreshCounts() : { queued: 0 };
              await S.setQueueStatus({
                remaining: counts.queued,
                currentJobId: null,
                lastError: reason,
                counts: counts
              });
              const delay = jitteredDelay(config.delayMs);
              if (delay > 0 && (await S.isRunning())) {
                await S.appendSessionLog({ type: 'delay', ms: delay });
                await sleep(delay);
              }
              continue;
            }
          } catch (capErr) {
            await S.appendSessionLog({
              type: 'error',
              jobId: job.id,
              error: 'Cap check failed: ' + String(capErr && capErr.message ? capErr.message : capErr)
            });
          }
        }

        let tab = null;
        let fillResult = null;
        let moved = false;
        let profile = null;
        let documents = null;
        try {
          // Reuse tab left open from a human pause when URL still matches
          if (resumeTabId != null) {
            try {
              const existing = await chrome.tabs.get(resumeTabId);
              if (existing && existing.id != null) {
                let same = false;
                try {
                  same =
                    existing.url &&
                    job.url &&
                    (existing.url === job.url ||
                      existing.url.indexOf(new URL(job.url).hostname) !== -1);
                } catch (_u) {
                  same = true; // prefer reuse after challenge pages
                }
                if (same) {
                  tab = existing;
                  await focusTab(tab.id);
                  await sleep(400 + Math.floor(Math.random() * 300));
                }
              }
            } catch (_e) {
              tab = null;
            }
            resumeTabId = null;
          }
          if (!tab) {
            tab = await openJobTab(job);
          }
          if (!(await S.isRunning())) break;

          await focusTab(tab.id);

          // Platform-wide challenge check before fill (do not auto-click)
          const challenge = await detectChallengeInTab(tab.id);
          if (challenge && challenge.challenged) {
            await pauseForHuman(job, tab.id, 'challenge', {
              message:
                challenge.kind === 'cloudflare'
                  ? 'Paused — verify Cloudflare/CAPTCHA'
                  : 'Paused — verify Cloudflare/CAPTCHA',
              challenge: challenge
            });
            return getStatusSnapshot();
          }

          profile = P ? await P.getProfile() : await B.getProfile();
          if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.getEffectiveProfile) {
            try {
              profile = await global.FillApplySourceProfiles.getEffectiveProfile(profile);
            } catch (_mergeErr) {
              /* keep base */
            }
          }
          // Stamp a shallow copy with the adaptive KB snapshot. Do not persist
          // __adaptiveKnowledge back onto the saved profile. Keep this next to
          // getEffectiveProfile so a later merge with the on-page panel PR
          // still hydrates knowledge before injectAndFill.
          if (global.FillApplyKnowledgeStore && global.FillApplyKnowledgeStore.attachToProfile) {
            try {
              profile = await global.FillApplyKnowledgeStore.attachToProfile(profile);
            } catch (_kbErr) {
              /* fill without adaptive snapshot */
            }
          }
          documents = await B.getDocuments();
          // Best-effort Drive/direct URL → blob before attach (CORS may still fail → needsHuman)
          try {
            if (
              global.FillApplyFiles &&
              typeof global.FillApplyFiles.resolveDocumentLinks === 'function'
            ) {
              const resolved = await global.FillApplyFiles.resolveDocumentLinks(documents, profile);
              documents = resolved.documents || documents;
              if (resolved.needsManual && resolved.errors && resolved.errors.length) {
                await pauseForHuman(job, tab.id, 'documents', {
                  message: resolved.errors[0] || 'Open Drive link or upload file manually'
                });
                return getStatusSnapshot();
              }
            }
          } catch (_docLinkErr) { /* continue with whatever blobs we have */ }

          // ATS account / Google OAuth lifecycle (once) before fill continues.
          // fillTabWithApplyStart (panel) owns handoff/preHandoffUrl; skipAtsAuth
          // prevents a second auth pass inside injectAndFillOnce.
          try {
            const authAttempt = await attemptAtsGoogleAuthLifecycle(tab.id, profile, job);
            const authOut = authAttempt && authAttempt.outcome;
            if (authAttempt && authAttempt.paused && authOut) {
              const Aref = global.FillApplyAtsAuth;
              const msg =
                (Aref && Aref.pauseMessageForResult
                  ? Aref.pauseMessageForResult(authOut.result, authOut.detail)
                  : null) ||
                authOut.detail ||
                'Paused — authentication required';
              await pauseForHuman(job, tab.id, 'ats_auth', {
                message: msg,
                authResult: authOut.result,
                challenge: authOut.challenge || { kind: 'ats_auth', detail: authOut.detail },
                pauseReason: 'ats_auth'
              });
              return getStatusSnapshot();
            }
          } catch (authErr) {
            await S.appendSessionLog({
              type: 'ats_auth',
              jobId: job && job.id,
              message: 'ATS auth lifecycle error — continuing to fill',
              error: String((authErr && authErr.message) || authErr)
            });
          }
          // Prevent re-entry inside injectAndFillOnce for this job tick
          config = Object.assign({}, config || {}, { skipAtsAuth: true, jobId: job && job.id });

          {
            const packed = await fillTabWithApplyStart(
              tab.id,
              profile,
              documents,
              runMode,
              config,
              job,
              {}
            );
            fillResult = packed.result;
            if (packed.tabId != null) tab.id = packed.tabId;
          }

          // Indeed "could not advance" without needsHuman — promote to pause
          if (
            fillResult &&
            !fillResult.needsHuman &&
            fillResult.error &&
            /could not advance step/i.test(String(fillResult.error))
          ) {
            fillResult.needsHuman = true;
            fillResult.pauseReason = fillResult.pauseReason || 'could_not_advance';
          }

          // Adapter asked for human (structure drift / challenge mid-flow)
          if (fillResult && fillResult.needsHuman) {
            const missingFields = Array.isArray(fillResult.missingProfileFields)
              ? fillResult.missingProfileFields
              : null;
            const isMissingProfile =
              fillResult.pauseReason === 'missing_profile_field' ||
              looksLikeMissingProfile(fillResult.error, missingFields);
            const msg = isMissingProfile
              ? fillResult.error ||
                'Missing profile field — fill in App Settings or on the page, then Resume'
              : fillResult.pauseReason === 'structure_drift'
                ? fillResult.error || 'Form changed — review required'
                : fillResult.error || 'Paused — verify Cloudflare/CAPTCHA';
            await pauseForHuman(
              job,
              tab.id,
              isMissingProfile
                ? 'missing_profile_field'
                : fillResult.pauseReason || 'challenge',
              {
                message: msg,
                challenge: fillResult.challenge || null,
                driftLabel: fillResult.driftLabel || null,
                missingProfileFields: missingFields,
                unknownFields: fillResult.unknownFields || null
              }
            );
            return getStatusSnapshot();
          }

          // Re-check challenge after fill (interstitial may have appeared)
          const challengeAfter = await detectChallengeInTab(tab.id);
          if (challengeAfter && challengeAfter.challenged) {
            await pauseForHuman(job, tab.id, 'challenge', {
              message: 'Paused — verify Cloudflare/CAPTCHA',
              challenge: challengeAfter
            });
            return getStatusSnapshot();
          }

          await S.appendSessionLog({
            type: 'fill',
            jobId: job.id,
            result: {
              ok: fillResult.ok,
              adapterId: fillResult.adapterId,
              filled: fillResult.filled,
              unmatched: fillResult.unmatched,
              submitted: fillResult.submitted,
              advanced: fillResult.advanced,
              runMode: runMode,
              resumeAttached: fillResult.resumeAttached,
              coverAttached: fillResult.coverAttached,
              inspection: fillResult.inspection,
              filesAttached: fillResult.filesAttached && fillResult.filesAttached.attached
            },
            error: fillResult.error || null
          });

          if (!(await S.isRunning()) || currentJobId !== job.id) {
            moved = true;
            break;
          }

          const failed = isCriticalFailure(fillResult);
          await S.setQueueStatus({
            lastResult: fillResult,
            lastError: failed ? fillResult.error || 'Fill failed' : null
          });

          const wasSubmitted =
            !failed && runMode === 'submit' && !!(fillResult && fillResult.submitted);

          let reportPayload = null;
          let reportPdfBase64 = null;
          if (wasSubmitted && config.autoPdfReport !== false && global.FillApplyReport) {
            try {
              const reportOut = await global.FillApplyReport.generateAndSave(
                job,
                fillResult,
                runMode,
                profile
              );
              reportPayload = reportOut.summary;
              if (reportOut.report && reportOut.report.pdfBase64) {
                reportPdfBase64 = reportOut.report.pdfBase64;
              }
              await S.appendSessionLog({
                type: 'report',
                jobId: job.id,
                reportId: reportPayload && reportPayload.id,
                filename: reportPayload && reportPayload.filename
              });
            } catch (reportErr) {
              await S.appendSessionLog({
                type: 'report_error',
                jobId: job.id,
                error: String(reportErr && reportErr.message ? reportErr.message : reportErr)
              });
            }
          }

          const markPayload = failed
            ? {
                failed: true,
                error: fillResult.error || 'Fill failed',
                fillResult: fillResult,
                runMode: runMode,
                url: job.url
              }
            : {
                fillResult: fillResult,
                submitted: !!fillResult.submitted,
                advanced: !!fillResult.advanced,
                runMode: runMode,
                resumeAttached: !!fillResult.resumeAttached,
                coverAttached: !!fillResult.coverAttached,
                url: job.url,
                applicationReport: reportPayload ||
                  (fillResult && fillResult.applicationReport) ||
                  null,
                reportSummary: reportPayload || null
              };

          if (reportPdfBase64) {
            markPayload.pdfBase64 = reportPdfBase64;
          }

          const reported = withJobPoolStatus(markPayload);
          await B.markApplied(job.id, reported);
          await S.appendSessionLog({
            type: 'jobpool_status',
            jobId: job.id,
            url: job.url,
            status: reported.status,
            runMode: runMode
          });
          moved = true;
          currentJobId = null;

          const counts = B.refreshCounts ? await B.refreshCounts() : { queued: 0 };
          await S.setQueueStatus({
            remaining: counts.queued,
            currentJobId: null,
            counts: counts
          });

          // Track submitted apply for per-source rate limits (once per success)
          if (wasSubmitted && S.recordSubmittedApply) {
            try {
              const sourceId =
                (fillResult && fillResult.adapterId) ||
                (S.detectSourceId && S.detectSourceId(job.url, job)) ||
                'default';
              await S.recordSubmittedApply({
                sourceId: sourceId,
                jobUrl: job.url,
                jobId: job.id,
                submittedAt: Date.now()
              });
            } catch (_recErr) {
              /* best-effort */
            }
          }

          // JobPool Applications hub: Mark as applied after employer submit
          if (wasSubmitted || (fillResult && fillResult.jobpoolReturnSuccess)) {
            try {
              await maybeCompleteJobPoolHubMark(tab && tab.id, fillResult, runMode, job);
            } catch (_hubBatch) {
              /* best-effort — markApplied API already posted above */
            }
          }

          // Auto-close: Submit + submitted success only; keep recent context tabs
          if (wasSubmitted && tab && tab.id != null) {
            await trackSubmittedTabAndPrune(tab.id, job.id, config, tab.id);
          }
          // fill / ready / failed: never auto-close
          tab = null;
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          // Frame churn after Continue (Glassdoor/Indeed Easy Apply) — retry, do not markFailed
          if (isFrameInvalidError(e) && job && !moved) {
            await S.appendSessionLog({
              type: 'frame_retry',
              jobId: job.id,
              error: msg,
              note: 'Frame/tab invalidated after navigation — re-inject and continue'
            });
            await S.setQueueStatus({ lastError: null });
            try {
              await sleep(800 + Math.floor(Math.random() * 500));
              const freshId = await resolveFreshTabId(job, tab && tab.id);
              if (freshId != null) {
                try {
                  tab = await chrome.tabs.get(freshId);
                } catch (_gt) {
                  tab = { id: freshId };
                }
              }
              const packedRetry = await injectAndFill(
                tab && tab.id,
                profile,
                documents,
                runMode,
                config,
                job,
                { returnTabId: true, maxAttempts: 3 }
              );
              fillResult = packedRetry.result;
              if (packedRetry.tabId != null && tab) tab.id = packedRetry.tabId;

              if (fillResult && fillResult.needsHuman) {
                await pauseForHuman(job, tab && tab.id, fillResult.pauseReason || 'challenge', {
                  message: fillResult.error || 'Paused — verify Cloudflare/CAPTCHA',
                  challenge: fillResult.challenge || null,
                  missingProfileFields: fillResult.missingProfileFields || null,
                  unknownFields: fillResult.unknownFields || null
                });
                return getStatusSnapshot();
              }

              const failedRetry = isCriticalFailure(fillResult);
              if (!failedRetry) {
                await B.markApplied(job.id, withJobPoolStatus({
                  fillResult: fillResult,
                  submitted: !!(fillResult && fillResult.submitted),
                  advanced: !!(fillResult && fillResult.advanced),
                  runMode: runMode,
                  resumeAttached: !!(fillResult && fillResult.resumeAttached),
                  url: job.url
                }));
                moved = true;
                currentJobId = null;
                tab = null;
              } else {
                await B.markApplied(job.id, withJobPoolStatus({
                  error: (fillResult && fillResult.error) || msg,
                  failed: true,
                  runMode: runMode,
                  url: job.url
                }));
                moved = true;
                currentJobId = null;
                tab = null;
              }
            } catch (retryErr) {
              const rmsg = String(retryErr && retryErr.message ? retryErr.message : retryErr);
              await S.appendSessionLog({ type: 'error', jobId: job.id, error: rmsg });
              await S.setQueueStatus({ lastError: rmsg });
              if (!moved) {
                try {
                  // Only hard-fail if retry also failed for a non-frame reason
                  if (!isFrameInvalidError(retryErr)) {
                    await B.markApplied(job.id, withJobPoolStatus({
                      error: rmsg,
                      failed: true,
                      runMode: runMode,
                      url: job.url
                    }));
                    moved = true;
                  } else {
                    // Keep queued — pause for human so Ready loop can resume
                    await pauseForHuman(job, tab && tab.id, 'frame_churn', {
                      message:
                        'Paused — page navigated during Easy Apply (frame removed). Confirm the apply form, then Resume.'
                    });
                    return getStatusSnapshot();
                  }
                } catch (_e2) {
                  /* ignore */
                }
              }
              currentJobId = null;
              tab = null;
            }
          } else {
            await S.appendSessionLog({ type: 'error', jobId: job.id, error: msg });
            await S.setQueueStatus({ lastError: msg });

            if (!moved) {
              try {
                await B.markApplied(job.id, withJobPoolStatus({
                  error: msg,
                  failed: true,
                  runMode: runMode,
                  url: job.url
                }));
                moved = true;
              } catch (_e2) {
                /* ignore */
              }
            }
            currentJobId = null;
            // Failed / exception path: never auto-close (keep context for debugging)
            tab = null;
          }
        }

        if (!(await S.isRunning())) break;

        const delay = jitteredDelay(config.delayMs);
        if (delay > 0) {
          await S.appendSessionLog({ type: 'delay', ms: delay });
          await sleep(delay);
        }
      }
    } finally {
      clearDelay();
      loopActive = false;
      if (!(await S.isRunning()) && currentJobId && B.markCancelled) {
        const paused = S.isPausedForHuman ? await S.isPausedForHuman() : null;
        // Do not cancel when paused for human — job stays queued
        if (!(paused && paused.paused)) {
          try {
            await B.markCancelled(currentJobId, 'Stopped by user');
          } catch (_e) {
            /* ignore */
          }
        }
      }
      currentJobId = null;
      const stillPaused = S.isPausedForHuman ? await S.isPausedForHuman() : null;
      if (!(stillPaused && stillPaused.paused)) {
        await S.setRunning(false);
      }
      await S.appendSessionLog({ type: 'idle' });
    }

    return getStatusSnapshot();
  }

  async function startRunner() {
    if (loopActive || (await global.FillApplyStorage.isRunning())) {
      if (!loopActive) await global.FillApplyStorage.setRunning(false);
      else return getStatusSnapshot();
    }

    if (global.FillApplyStorage.clearPausedForHuman) {
      await global.FillApplyStorage.clearPausedForHuman();
    }

    if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.assertSelectedSourceComplete) {
      var gate = await global.FillApplySourceProfiles.assertSelectedSourceComplete();
      if (!gate.ok) {
        await global.FillApplyStorage.appendSessionLog({
          type: 'error',
          error: gate.error,
          code: 'SOURCE_PROFILE_INCOMPLETE',
          sourceId: gate.selectedSourceId
        });
        throw new Error(gate.error || 'Complete selected source profile in App Settings');
      }
    }

    const cfg = await global.FillApplyStorage.getRunConfig();
    if (cfg.mockMode || !cfg.backendBaseUrl) {
      if (global.FillApplyBackend && global.FillApplyBackend.assertMockUrlsConfigured) {
        await global.FillApplyBackend.assertMockUrlsConfigured();
      }
      const B = global.FillApplyBackend;
      if (B.getQueued && B.resetMockQueue) {
        const q = await B.getQueued();
        if (!q.length) {
          await B.resetMockQueue();
        }
      }
    }

    // Batch by source: stable sort queued so same source runs consecutively
    try {
      var Bsort = global.FillApplyBackend;
      var SP = global.FillApplySourceProfiles;
      if (Bsort && Bsort.getQueued && Bsort.setQueued && SP && SP.sortJobsBySource) {
        var queued0 = await Bsort.getQueued();
        var sorted = SP.sortJobsBySource(queued0);
        await Bsort.setQueued(sorted);
        var groups = {};
        sorted.forEach(function (j) {
          var sid = String((j && j.sourceId) || SP.detectSourceIdFromUrl(j && j.url) || 'generic');
          groups[sid] = (groups[sid] || 0) + 1;
        });
        Object.keys(groups).forEach(function (sid) {
          global.FillApplyStorage.appendSessionLog({
            type: 'batch_source',
            message: 'batch_source · ' + sid + ' (' + groups[sid] + ' jobs)',
            sourceId: sid,
            count: groups[sid]
          });
        });
        await global.FillApplyStorage.appendSessionLog({
          type: 'info',
          message: 'Batch order: by source'
        });
      }
    } catch (_sortErr) {
      /* non-fatal */
    }

    runLoop().catch(async function (e) {
      await global.FillApplyStorage.setRunning(false);
      await global.FillApplyStorage.appendSessionLog({
        type: 'error',
        error: String(e && e.message ? e.message : e)
      });
    });
    await sleep(50);
    return getStatusSnapshot();
  }

  /**
   * Resume after human verified Cloudflare/CAPTCHA / reviewed Indeed form.
   * Clears pause flag and continues the queue (job remains queued with needsAttention cleared on next success).
   */
  async function resumeRunner() {
    const S = global.FillApplyStorage;
    const paused = S.isPausedForHuman ? await S.isPausedForHuman() : null;
    if (paused && paused.tabId != null) {
      resumeTabId = paused.tabId;
      await focusTab(paused.tabId);
    } else if (pausedTabId != null) {
      resumeTabId = pausedTabId;
      await focusTab(pausedTabId);
    }
    if (S.clearPausedForHuman) await S.clearPausedForHuman();
    await clearMissingFieldsPauseState();
    await S.setQueueStatus({ pausedForHuman: false, lastError: null });
    await S.appendSessionLog({ type: 'resume_human' });
    pausedTabId = null;

    // Clear needsAttention on queued jobs (best-effort)
    const B = global.FillApplyBackend;
    if (B && B.getQueued && B.setQueued) {
      try {
        const queued = await B.getQueued();
        await B.setQueued(
          queued.map(function (j) {
            if (!j.needsAttention) return j;
            const meta = Object.assign({}, j.meta || {});
            delete meta.waitingHuman;
            delete meta.pauseReason;
            return Object.assign({}, j, {
              needsAttention: false,
              lastError: null,
              meta: meta
            });
          })
        );
      } catch (_e) {
        /* ignore */
      }
    }

    return startRunner();
  }

  global.FillApplyRunner = {
    RUN_PHASES: RUN_PHASES,
    start: startRunner,
    stop: stopRunner,
    resume: resumeRunner,
    startAutoApply: startAutoApply,
    getStatus: getStatusSnapshot,
    injectAndFill: injectAndFill,
    fillTabWithApplyStart: fillTabWithApplyStart,
    runOnceOnTab: runOnceOnTab,
    attemptAtsGoogleAuthLifecycle: attemptAtsGoogleAuthLifecycle,
    pickApplyHandoffTab: pickApplyHandoffTab,
    findApplyHandoffTab: findApplyHandoffTab,
    waitForApplyHandoffTab: waitForApplyHandoffTab,
    maybeCompleteJobPoolHubMark: maybeCompleteJobPoolHubMark,
    readJobPoolPendingMark: readJobPoolPendingMark,
    INJECT_FILES: INJECT_FILES
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
