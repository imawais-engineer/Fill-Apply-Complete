/**
 * Shared panel UI logic for sidepanel/ (and popup/ markup).
 * v1.14.1 — Glassdoor Easy Apply click fix (Indeed, Inc. inFlow false-positive), frame-churn retry.
 */
(function () {
  'use strict';

  const summaryEl = document.getElementById('summary');
  const statusEl = document.getElementById('status');
  const btnFill = document.getElementById('btnFill');
  const btnOptions = document.getElementById('btnOptions');
  const btnSeed = document.getElementById('btnSeed');
  const btnLoadJobPool = document.getElementById('btnLoadJobPool');
  const btnOpenJobPool = document.getElementById('btnOpenJobPool');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnResetMock = document.getElementById('btnResetMock');
  const highlightEl = document.getElementById('highlightUnmatched');
  const delaySecEl = document.getElementById('delaySec');
  const autoCloseEl = document.getElementById('autoCloseAppliedTab');
  const keepRecentTabsEl = document.getElementById('keepRecentTabs');
  const autoPdfReportEl = document.getElementById('autoPdfReport');
  const capAshbyEl = document.getElementById('capAshby');
  const capIndeedEl = document.getElementById('capIndeed');
  const capGreenhouseEl = document.getElementById('capGreenhouse');
  const capLeverEl = document.getElementById('capLever');
  const capDefaultEl = document.getElementById('capDefault');
  const btnLastReport = document.getElementById('btnLastReport');
  const recentReportsEl = document.getElementById('recentReports');
  const runStateEl = document.getElementById('runState');
  const queueStatusEl = document.getElementById('queueStatus');
  const countQueuedEl = document.getElementById('countQueued');
  const countAppliedEl = document.getElementById('countApplied');
  const countFailedEl = document.getElementById('countFailed');
  const countCancelledEl = document.getElementById('countCancelled');
  const lastJobTitleEl = document.getElementById('lastJobTitle');
  const lastErrorEl = document.getElementById('lastError');
  const pauseBannerEl = document.getElementById('pauseBanner');
  const pauseMessageEl = document.getElementById('pauseMessage');
  const btnResume = document.getElementById('btnResume');
  const profileSelectEl = document.getElementById('profileSelect');
  const emptyQueuePromptEl = document.getElementById('emptyQueuePrompt');
  const btnEmptyYes = document.getElementById('btnEmptyYes');
  const btnEmptyNo = document.getElementById('btnEmptyNo');
  const liveLogEl = document.getElementById('liveLog');
  const sourceGateBannerEl = document.getElementById('sourceGateBanner');
  const sourceGateMessageEl = document.getElementById('sourceGateMessage');
  const btnOpenSourceSettings = document.getElementById('btnOpenSourceSettings');
  const batchOrderChipEl = document.getElementById('batchOrderChip');

  const RUNNER_MODE_KEY = 'fillApply.ui.runnerMode';
  let sourceGateIncomplete = false;
  let sourceGateLabel = '';


  const MSG = (globalThis.FillApplyTypes && globalThis.FillApplyTypes.MSG) || {
    START: 'FILL_APPLY_START',
    STOP: 'FILL_APPLY_STOP',
    RESUME: 'FILL_APPLY_RESUME',
    STATUS: 'FILL_APPLY_STATUS'
  };

  const INJECT_FILES = [
    'lib/dom-deep.js',
    'lib/format.js',
    'lib/synonyms.js',
    'lib/pace.js',
    'lib/field-map.js',
    'lib/knowledge-canonical.js',
    'lib/knowledge-store.js',
    'lib/knowledge-resolver.js',
    'lib/knowledge-learn.js',
    'lib/files.js',
    'lib/auth-walls.js',
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
    'adapters/boards/indeed.js',
    'adapters/boards/glassdoor.js',
    'adapters/boards/linkedin.js',
    'adapters/boards/naukrigulf.js',
    'adapters/boards/remoteok.js',
    'adapters/boards/weworkremotely.js',
    'adapters/boards/workingnomads.js',
    'adapters/boards/jooble.js',
    'adapters/boards/swooped.js',
    'adapters/boards/efinancialcareers.js'
  ];

  /** ATS forms are usually iframed into the career site — inject everywhere. */
  const INJECT_TARGET = { allFrames: true };

  /**
   * Only one frame holds the application form; pick the one that did the work.
   */
  function pickBestFrameResult(injectionResults) {
    const entries = (injectionResults || []).filter(function (entry) {
      return entry && entry.result;
    });
    if (!entries.length) return null;

    function score(r) {
      if (!r) return -1;
      if (r.frameSkipped) return 0;
      let s = 1;
      if (r.total > 0) s += 5;
      if (r.needsHuman) s += 40;
      if (r.submitted) s += 60;
      if (r.filled > 0) s += 100 + Math.min(r.filled, 50);
      if (r.clickedApplyStart || r.reDetect) s += 20;
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
    return Object.assign({}, best.result, { frameId: best.frameId });
  }

  let lastCounts = { queued: 0, applied: 0, failed: 0, cancelled: 0 };

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

  async function refreshTabRef(tab) {
    if (!tab || tab.id == null) return tab;
    try {
      return await chrome.tabs.get(tab.id);
    } catch (_e) {
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs && tabs[0] ? tabs[0] : tab;
      } catch (_e2) {
        return tab;
      }
    }
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function liveLog(type, message, extra) {
    var entry = Object.assign({ type: type || 'info', message: message || '' }, extra || {});
    if (FillApplyStorage && FillApplyStorage.appendSessionLog) {
      return FillApplyStorage.appendSessionLog(entry).then(function () {
        return refreshLiveLog();
      }).catch(function () {});
    }
    return Promise.resolve();
  }

  function send(type, extra) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (res) {
        if (chrome.runtime.lastError) {
          var _m = chrome.runtime.lastError.message || '';
          if (/Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(_m)) {
            reject(new Error('Extension was reloaded — refresh this tab (or reopen the side panel), then try again.'));
            return;
          }
          reject(new Error(_m));
          return;
        }
        if (!res || res.ok === false) {
          reject(new Error((res && res.error) || 'Request failed'));
          return;
        }
        resolve(res.data !== undefined ? res.data : res);
      });
    });
  }

  function getSelectedRunMode() {
    const el = document.querySelector('input[name="runMode"]:checked');
    return el && el.value ? el.value : 'fill';
  }

  function setSelectedRunMode(mode) {
    const m = mode === 'ready' || mode === 'submit' ? mode : 'fill';
    const el = document.querySelector('input[name="runMode"][value="' + m + '"]');
    if (el) el.checked = true;
  }

  function getRunnerMode() {
    const el = document.querySelector('input[name="runnerMode"]:checked');
    return el && el.value === 'batch' ? 'batch' : 'single';
  }

  function setRunnerMode(mode) {
    const m = mode === 'batch' ? 'batch' : 'single';
    const el = document.querySelector('input[name="runnerMode"][value="' + m + '"]');
    if (el) el.checked = true;
  }

  function persistRunnerMode() {
    const payload = {};
    payload[RUNNER_MODE_KEY] = getRunnerMode();
    chrome.storage.local.set(payload);
  }

  function loadRunnerMode() {
    chrome.storage.local.get([RUNNER_MODE_KEY], function (result) {
      if (result && result[RUNNER_MODE_KEY]) setRunnerMode(result[RUNNER_MODE_KEY]);
    });
  }

  async function refreshProfileSelect() {
    if (!profileSelectEl || !FillApplyProfile.listProfiles) return;
    try {
      const list = await FillApplyProfile.listProfiles();
      const activeId = await FillApplyProfile.getActiveProfileId();
      const keep = profileSelectEl.value;
      profileSelectEl.innerHTML = '';
      list.forEach(function (p) {
        const opt = document.createElement('option');
        opt.value = p.id;
        var lock = p.locked || p.systemProfile || String(p.name || '').toLowerCase() === 'mock';
        opt.textContent =
          (lock ? '🔒 ' : '') + p.name + (p.id === activeId ? ' ★' : '');
        profileSelectEl.appendChild(opt);
      });
      if (keep && list.some(function (p) { return p.id === keep; })) {
        profileSelectEl.value = keep;
      } else if (activeId) {
        profileSelectEl.value = activeId;
      }
    } catch (_e) { /* ignore */ }
  }

  async function refreshSummary() {
    const profile = await FillApplyProfile.getProfile();
    // Active profile person only — never prepend chip name (fixes Zahid · Alex · alex bug)
    summaryEl.textContent = FillApplyProfile.profileSummary(profile);
  }

  function hideEmptyPrompt() {
    if (emptyQueuePromptEl) emptyQueuePromptEl.hidden = true;
  }

  function showEmptyPrompt() {
    if (emptyQueuePromptEl) emptyQueuePromptEl.hidden = false;
  }

  function applyStatus(data) {
    if (!data) return;
    const running = !!data.running;
    const paused = !!(data.pausedForHuman || (data.pauseInfo && data.pauseInfo.paused));
    if (runStateEl) {
      if (paused) {
        runStateEl.textContent = 'Paused — verify Cloudflare/CAPTCHA';
        runStateEl.className = 'run-state paused';
      } else {
        runStateEl.textContent = running ? 'Running…' : 'Idle';
        runStateEl.className = 'run-state ' + (running ? 'running' : 'idle');
      }
    }
    if (btnStart) btnStart.disabled = running || paused || sourceGateIncomplete;
    if (batchOrderChipEl) {
      var rm = getRunnerMode();
      batchOrderChipEl.hidden = rm !== 'batch';
    }
    if (btnStop) btnStop.disabled = !running && !paused;
    if (pauseBannerEl) {
      if (paused) {
        pauseBannerEl.hidden = false;
        if (pauseMessageEl) {
          const info = data.pauseInfo || {};
          pauseMessageEl.textContent =
            info.message ||
            (data.queueStatus && data.queueStatus.lastError) ||
            'Paused — verify Cloudflare/CAPTCHA';
        }
      } else {
        pauseBannerEl.hidden = true;
      }
    }
    if (btnResume) btnResume.disabled = !paused;

    const counts =
      data.counts ||
      (data.queueStatus && data.queueStatus.counts) || {
        queued: data.queueStatus && typeof data.queueStatus.remaining === 'number'
          ? data.queueStatus.remaining
          : 0,
        applied: 0,
        failed: 0,
        cancelled: 0
      };
    lastCounts = counts;
    if (countQueuedEl) countQueuedEl.textContent = String(counts.queued || 0);
    if (countAppliedEl) countAppliedEl.textContent = String(counts.applied || 0);
    if (countFailedEl) countFailedEl.textContent = String(counts.failed || 0);
    if (countCancelledEl) countCancelledEl.textContent = String(counts.cancelled || 0);
    if (lastJobTitleEl) {
      const title =
        data.queueStatus && data.queueStatus.lastJobTitle
          ? data.queueStatus.lastJobTitle
          : '';
      if (title) {
        lastJobTitleEl.hidden = false;
        lastJobTitleEl.textContent = 'Last: ' + title;
      } else {
        lastJobTitleEl.hidden = true;
        lastJobTitleEl.textContent = '';
      }
    }

    if (lastErrorEl) {
      if (data.queueStatus && data.queueStatus.lastError) {
        lastErrorEl.hidden = false;
        lastErrorEl.textContent = 'Last error: ' + data.queueStatus.lastError;
      } else {
        lastErrorEl.hidden = true;
        lastErrorEl.textContent = '';
      }
    }

    if (data.config) {
      if (delaySecEl) delaySecEl.value = String(Math.round((data.config.delayMs || 0) / 1000));
      const mode =
        data.config.runMode ||
        (data.config.autoSubmit ? 'submit' : 'fill');
      setSelectedRunMode(mode);
      if (autoCloseEl) autoCloseEl.checked = data.config.autoCloseAppliedTab !== false;
      if (keepRecentTabsEl) {
        keepRecentTabsEl.value = String(
          data.config.keepRecentTabs != null ? data.config.keepRecentTabs : 5
        );
      }
      if (autoPdfReportEl) {
        autoPdfReportEl.checked = data.config.autoPdfReport !== false;
      }
      const lim = data.config.sourceApplyLimits || {};
      function setCapEl(el, key) {
        if (!el) return;
        const v = lim[key] != null ? lim[key] : 2;
        el.value = String(Math.min(3, Math.max(1, Number(v) || 2)));
      }
      setCapEl(capAshbyEl, 'ashby');
      setCapEl(capIndeedEl, 'indeed');
      setCapEl(capGreenhouseEl, 'greenhouse');
      setCapEl(capLeverEl, 'lever');
      setCapEl(capDefaultEl, 'default');
    }
  }

  async function refreshStatus() {
    try {
      const data = await send(MSG.STATUS);
      applyStatus(data);
    } catch (e) {
      setStatus('Status: ' + e.message, 'err');
    }
  }

  function formatLogEntry(entry) {
    if (!entry) return { ts: '', text: '' };
    var ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
    var parts = [];
    if (entry.type) parts.push(entry.type);
    if (entry.error) parts.push(entry.error);
    if (entry.message) parts.push(entry.message);
    if (entry.title) parts.push(entry.title);
    if (entry.jobId) parts.push(entry.jobId);
    if (!parts.length) {
      try { parts.push(JSON.stringify(entry)); } catch (_e) { parts.push(String(entry)); }
    }
    return { ts: ts, text: parts.join(' · ') };
  }

  async function refreshLiveLog() {
    if (!liveLogEl || !FillApplyStorage.getSessionLog) return;
    try {
      var log = await FillApplyStorage.getSessionLog();
      var slice = (log || []).slice(-8);
      if (!slice.length) {
        liveLogEl.innerHTML = '<p class="empty">No events yet</p>';
        return;
      }
      liveLogEl.innerHTML = slice
        .map(function (e) {
          var f = formatLogEntry(e);
          return (
            '<p class="log-line"><span class="log-ts">' +
            f.ts +
            '</span>' +
            String(f.text).replace(/</g, '&lt;') +
            '</p>'
          );
        })
        .join('');
      liveLogEl.scrollTop = liveLogEl.scrollHeight;
    } catch (_e) { /* ignore */ }
  }

  function readConfigPartial() {
    const sec = delaySecEl ? Number(delaySecEl.value) : 3;
    const runMode = getSelectedRunMode();
    let keep = keepRecentTabsEl ? Number(keepRecentTabsEl.value) : 5;
    if (!Number.isFinite(keep)) keep = 5;
    keep = Math.min(10, Math.max(3, Math.round(keep)));
    function readCap(el) {
      if (!el) return 2;
      const raw = Number(el.value);
      if (!Number.isFinite(raw)) return 2;
      return Math.min(3, Math.max(1, Math.round(raw)));
    }
    return {
      delayMs: (Number.isFinite(sec) && sec >= 0 ? sec : 3) * 1000,
      runMode: runMode,
      autoSubmit: runMode === 'submit',
      autoCloseAppliedTab: autoCloseEl ? !!autoCloseEl.checked : true,
      keepRecentTabs: keep,
      autoPdfReport: autoPdfReportEl ? !!autoPdfReportEl.checked : true,
      sourceApplyLimits: {
        ashby: readCap(capAshbyEl),
        indeed: readCap(capIndeedEl),
        greenhouse: readCap(capGreenhouseEl),
        lever: readCap(capLeverEl),
        default: readCap(capDefaultEl)
      }
    };
  }

  async function getActiveTab() {
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || !tabs.length) {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    return tabs && tabs[0] ? tabs[0] : null;
  }

  function isRestrictedUrl(url) {
    if (!url) return true;
    if (/^chrome-extension:\/\//i.test(url)) return true;
    return /^(chrome|edge|about|devtools|view-source):/i.test(url);
  }

  async function resolveDocsForFill(profile) {
    var documents = await FillApplyStorage.getDocuments();
    if (
      globalThis.FillApplyFiles &&
      typeof globalThis.FillApplyFiles.resolveDocumentLinks === 'function'
    ) {
      var resolved = await globalThis.FillApplyFiles.resolveDocumentLinks(documents, profile);
      if (resolved.needsManual && resolved.errors && resolved.errors.length) {
        setStatus(resolved.errors[0] || 'Open Drive link or upload file manually', 'warn');
      }
      return resolved.documents || documents;
    }
    return documents;
  }


  const PAUSE_STATE_KEY = 'fillApply.pauseState';
  let missingFieldsContext = null; // { mode, tabId, jobId, fields, fieldMeta }

  function getMissingModalEls() {
    return {
      modal: document.getElementById('missingFieldsModal'),
      list: document.getElementById('missingFieldsList'),
      msg: document.getElementById('missingFieldsMessage'),
      save: document.getElementById('btnSaveContinue'),
      cancel: document.getElementById('btnMissingCancel')
    };
  }

  function hideMissingFieldsModal() {
    var els = getMissingModalEls();
    if (els.modal) els.modal.hidden = true;
  }

  function mfControls(list) {
    return list.querySelectorAll('input[data-field], textarea[data-field], select[data-field]');
  }

  function updateMissingProgress() {
    var els = getMissingModalEls();
    var progressEl = document.getElementById('missingFieldsProgress');
    if (!els.list || !progressEl) return;
    var inputs = mfControls(els.list);
    var total = inputs.length;
    var done = 0;
    inputs.forEach(function (inp) {
      var wrap = inp.closest('.mf-field');
      var filled = !!(inp.value || '').trim();
      if (filled) done += 1;
      if (wrap) {
        wrap.classList.toggle('mf-done', filled);
        var mark = wrap.querySelector('.mf-check');
        if (mark) mark.hidden = !filled;
      }
    });
    progressEl.textContent = done + ' of ' + total + ' answered';
  }

  function describeMissingField(label, metaFromDom) {
    var C = globalThis.FillApplyKnowledgeCanonical;
    var info = {
      label: String(label || ''),
      key: '',
      type: 'string',
      controlType: 'text',
      options: [],
      required: false
    };
    if (metaFromDom && typeof metaFromDom === 'object') {
      if (metaFromDom.canonicalKey) info.key = metaFromDom.canonicalKey;
      if (metaFromDom.knowledgeType) info.type = metaFromDom.knowledgeType;
      if (metaFromDom.controlType) info.controlType = metaFromDom.controlType;
      if (Array.isArray(metaFromDom.options)) info.options = metaFromDom.options;
      if (metaFromDom.required != null) info.required = !!metaFromDom.required;
    }
    if (C && C.resolveFromEvidence && C.buildEvidence) {
      var hit = C.resolveFromEvidence(
        C.buildEvidence({
          label: info.label,
          question: (metaFromDom && metaFromDom.question) || info.label,
          placeholder: (metaFromDom && metaFromDom.placeholder) || '',
          name: (metaFromDom && metaFromDom.name) || '',
          id: (metaFromDom && metaFromDom.id) || '',
          ariaLabel: (metaFromDom && metaFromDom.ariaLabel) || '',
          groupContext: (metaFromDom && metaFromDom.groupContext) || '',
          autocomplete: (metaFromDom && metaFromDom.autocomplete) || '',
          controlType: info.controlType,
          options: info.options
        }),
        { fieldType: info.controlType }
      );
      if (hit && hit.ambiguous) {
        info.ambiguous = true;
        info.candidateKeys = hit.candidateKeys || [];
        // Do not invent a key for ambiguous bare labels — Missing Info still collects
        // under a derived key only when the applicant explicitly answers.
      } else if (hit && hit.key && !info.key) {
        info.key = hit.key;
      }
      if (hit && hit.fieldType && info.type === 'string') {
        info.type = C.toUserFieldType ? C.toUserFieldType(hit.fieldType) : hit.fieldType;
      }
      info.matchedEvidence = hit && hit.matchedEvidence;
    } else if (C && C.matchCanonical) {
      var hit2 = C.matchCanonical(info.label, { fieldType: info.controlType });
      if (hit2 && hit2.key && !info.key) info.key = hit2.key;
      if (hit2 && hit2.fieldType && info.type === 'string') {
        info.type = C.toUserFieldType ? C.toUserFieldType(hit2.fieldType) : hit2.fieldType;
      }
    }
    if (!info.key && !info.ambiguous && C && C.deriveCanonicalKey) {
      info.key = C.deriveCanonicalKey(info.label);
    }
    // Prefer DOM control semantics for the input widget
    var ct = String(info.controlType || '').toLowerCase();
    if (ct === 'checkbox' || ct === 'radio' || (C && C.isYesNoOptions && C.isYesNoOptions(info.options))) {
      info.type = 'boolean';
    } else if (ct === 'number') info.type = 'number';
    else if (ct === 'date') info.type = 'date';
    else if (ct === 'select' || ct === 'combobox' || ct === 'custom') {
      info.type = info.options && info.options.length ? 'select' : info.type;
    } else if (ct === 'multiselect') info.type = 'multiselect';
    if (C && C.toUserFieldType) info.type = C.toUserFieldType(info.type);
    return info;
  }

  function optionText(o) {
    if (o == null) return '';
    if (typeof o === 'string') return o;
    return String(o.text != null ? o.text : o.label != null ? o.label : o.value != null ? o.value : '').trim();
  }

  function buildMissingControl(meta, id) {
    var type = String(meta.type || 'string');
    var ct = String(meta.controlType || '').toLowerCase();
    var options = meta.options || [];
    var input;

    if (type === 'boolean' || ct === 'checkbox') {
      input = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Select…';
      input.appendChild(blank);
      ['Yes', 'No'].forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        input.appendChild(opt);
      });
    } else if ((type === 'select' || type === 'multiselect' || ct === 'select' || ct === 'combobox' || ct === 'radio') && options.length) {
      input = document.createElement('select');
      if (type === 'multiselect' || ct === 'multiselect') input.multiple = true;
      var blank2 = document.createElement('option');
      blank2.value = '';
      blank2.textContent = 'Select…';
      input.appendChild(blank2);
      options.forEach(function (o) {
        var t = optionText(o);
        if (!t || /^(select|choose|please|--)/i.test(t)) return;
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        input.appendChild(opt);
      });
    } else if (type === 'boolean') {
      input = document.createElement('select');
      var b0 = document.createElement('option');
      b0.value = '';
      b0.textContent = 'Select…';
      input.appendChild(b0);
      ['Yes', 'No'].forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        input.appendChild(opt);
      });
    } else {
      var long = /cover|summary|history|essay|why|describe|letter/i.test(String(meta.label || ''));
      input = document.createElement(long ? 'textarea' : 'input');
      if (!long) {
        if (type === 'number' || ct === 'number') input.type = 'number';
        else if (type === 'date' || ct === 'date') input.type = 'date';
        else if (ct === 'email') input.type = 'email';
        else if (ct === 'tel') input.type = 'tel';
        else if (ct === 'url') input.type = 'url';
        else input.type = 'text';
      }
      input.placeholder = 'Type value…';
    }
    input.id = id;
    input.dataset.field = String(meta.label || '');
    if (meta.key) input.dataset.canonicalKey = meta.key;
    input.dataset.controlType = ct || '';
    input.autocomplete = 'off';
    input.addEventListener('input', updateMissingProgress);
    input.addEventListener('change', updateMissingProgress);
    return input;
  }

  function showMissingFieldsModal(payload) {
    payload = payload || {};
    var fieldMetaList = Array.isArray(payload.unknownFields) ? payload.unknownFields : [];
    var fields = Array.isArray(payload.missingProfileFields)
      ? payload.missingProfileFields.filter(Boolean)
      : [];
    if (!fields.length && fieldMetaList.length) {
      fields = fieldMetaList.map(function (u) { return u.label; }).filter(Boolean);
    }
    if (!fields.length && payload.message) fields = [payload.message];
    if (!fields.length) fields = ['(required field)'];

    var metaByLabel = {};
    fieldMetaList.forEach(function (u) {
      if (u && u.label) metaByLabel[u.label] = u;
    });

    missingFieldsContext = {
      mode: payload.mode || (getRunnerMode() === 'batch' ? 'batch' : 'single'),
      tabId: payload.tabId != null ? payload.tabId : null,
      jobId: payload.jobId || null,
      fields: fields,
      fieldMeta: metaByLabel,
      message: payload.message || ''
    };
    var els = getMissingModalEls();
    if (!els.modal || !els.list) {
      setStatus(
        'Missing information: ' + fields.join(', ') + ' — open App Settings or reload panel.',
        'warn'
      );
      return;
    }
    if (els.msg) {
      els.msg.textContent =
        payload.message ||
        'Complete each item below (required and optional unknowns). Controls match the application field. Answers normalize to Key / Aliases / Type / Value, save to adaptive knowledge, apply to this application, then fill continues.';
    }
    els.list.innerHTML = '';
    var types = (globalThis.FillApplyKnowledgeCanonical &&
      globalThis.FillApplyKnowledgeCanonical.USER_FIELD_TYPES) || [
      'boolean',
      'string',
      'number',
      'date',
      'select',
      'multiselect'
    ];
    fields.forEach(function (field, idx) {
      var meta = describeMissingField(field, metaByLabel[field]);
      var wrap = document.createElement('div');
      wrap.className = 'mf-field' + (meta.required ? ' mf-required' : ' mf-optional');
      var id = 'mfInput' + idx;
      var check = document.createElement('span');
      check.className = 'mf-check';
      check.textContent = '✓';
      check.hidden = true;
      wrap.appendChild(check);
      var label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = String(field);
      wrap.appendChild(label);
      var badge = document.createElement('span');
      badge.className = 'mf-reqbadge';
      badge.textContent = meta.required ? 'Required' : 'Optional';
      wrap.appendChild(badge);
      if (meta.key) {
        var hint = document.createElement('span');
        hint.className = 'mf-keyhint';
        hint.textContent = 'Key: ' + meta.key + (meta.controlType ? ' · ' + meta.controlType : '');
        wrap.appendChild(hint);
      }
      var typeWrap = document.createElement('label');
      typeWrap.className = 'mf-type';
      typeWrap.textContent = 'Type ';
      var typeSel = document.createElement('select');
      typeSel.dataset.fieldTypeFor = String(field);
      types.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === meta.type) opt.selected = true;
        typeSel.appendChild(opt);
      });
      typeWrap.appendChild(typeSel);
      wrap.appendChild(typeWrap);
      wrap.appendChild(buildMissingControl(meta, id));
      els.list.appendChild(wrap);
    });
    els.modal.hidden = false;
    updateMissingProgress();
    var first = els.list.querySelector('input, textarea, select[data-field]');
    if (first) {
      try { first.focus(); } catch (_e) {}
    }
    if (pauseBannerEl) {
      pauseBannerEl.hidden = false;
      if (pauseMessageEl) {
        pauseMessageEl.textContent =
          payload.message ||
          ('Paused — Complete Missing Information (' + fields.length + ')');
      }
    }
    setStatus('Paused — Complete Missing Information, then Save & continue fill.', 'warn');
  }

  async function clearPauseStateStorage() {
    try {
      if (FillApplyStorage && FillApplyStorage.clearPauseState) {
        await FillApplyStorage.clearPauseState();
      } else {
        var o = {};
        o[PAUSE_STATE_KEY] = null;
        await chrome.storage.local.set(o);
      }
    } catch (_e) {}
  }

  async function readPauseStateStorage() {
    try {
      if (FillApplyStorage && FillApplyStorage.getPauseState) {
        return await FillApplyStorage.getPauseState();
      }
      var res = await chrome.storage.local.get([PAUSE_STATE_KEY]);
      return res && res[PAUSE_STATE_KEY] ? res[PAUSE_STATE_KEY] : null;
    } catch (_e) {
      return null;
    }
  }

  async function onSaveMissingContinue() {
    var els = getMissingModalEls();
    if (!els.list || !missingFieldsContext) return;
    var values = {};
    var typed = [];
    mfControls(els.list).forEach(function (inp) {
      var field = inp.dataset.field || '';
      var val = (inp.value || '').trim();
      if (!field || !val) return;
      values[field] = val;
      var typeSel = els.list.querySelector('select[data-field-type-for="' + CSS.escape(field) + '"]');
      // CSS.escape may be missing in older environments
      if (!typeSel) {
        els.list.querySelectorAll('select[data-field-type-for]').forEach(function (s) {
          if (s.getAttribute('data-field-type-for') === field) typeSel = s;
        });
      }
      typed.push({
        label: field,
        value: val,
        fieldType: typeSel ? typeSel.value : 'string',
        canonicalKey: inp.dataset.canonicalKey || '',
        kind: 'confirm'
      });
    });
    var metaMap = (missingFieldsContext && missingFieldsContext.fieldMeta) || {};
    var missing = (missingFieldsContext.fields || []).filter(function (f) {
      var meta = metaMap[f];
      var must = !meta || meta.required !== false;
      // If we have explicit required flag, only require those; otherwise require all (legacy)
      if (meta && Object.prototype.hasOwnProperty.call(meta, 'required')) {
        must = !!meta.required;
      }
      if (!must) return false;
      return !values[f] || !String(values[f]).trim();
    });
    if (missing.length) {
      setStatus('Please fill required: ' + missing.join(', '), 'err');
      updateMissingProgress();
      return;
    }
    if (!Object.keys(values).length) {
      setStatus('Enter at least one answer to continue.', 'err');
      return;
    }
    if (els.save) els.save.disabled = true;
    try {
      var profileId = null;
      try {
        if (FillApplyProfile && FillApplyProfile.getActiveProfileId) {
          profileId = await FillApplyProfile.getActiveProfileId();
        }
      } catch (_pid) {}

      // (a) Immediately normalize + persist adaptive KB (Key / Aliases / Type / Value)
      if (globalThis.FillApplyKnowledgeLearn && FillApplyKnowledgeLearn.learn) {
        for (var i = 0; i < typed.length; i++) {
          try {
            await FillApplyKnowledgeLearn.learn({
              label: typed[i].label,
              value: typed[i].value,
              fieldType: typed[i].fieldType,
              canonicalKey: typed[i].canonicalKey || undefined,
              kind: 'confirm',
              profileId: profileId
            });
          } catch (_learnOne) { /* continue remaining */ }
        }
      } else if (globalThis.FillApplyKnowledgeLearn && FillApplyKnowledgeLearn.learnMany) {
        try {
          await FillApplyKnowledgeLearn.learnMany(values, { kind: 'confirm', profileId: profileId });
        } catch (_learnErr) { /* profile write still attempted */ }
      }

      // Also write known identity / customAnswers on the active profile
      if (!FillApplyProfile || !FillApplyProfile.applyMissingFieldAnswers) {
        var profile = await FillApplyProfile.getProfile();
        Object.keys(values).forEach(function (k) {
          profile.customAnswers = profile.customAnswers || {};
          profile.customAnswers[k] = values[k];
          var qa = Array.isArray(profile.customQA) ? profile.customQA.slice() : [];
          qa.push({ question: k, answer: values[k] });
          profile.customQA = qa;
          if (/nationality/i.test(k)) profile.nationality = values[k];
          if (/notice/i.test(k)) profile.noticePeriod = values[k];
        });
        await FillApplyProfile.saveProfile(profile);
      } else {
        await FillApplyProfile.applyMissingFieldAnswers(values);
      }

      await liveLog(
        'missing_fields_saved',
        'Complete Missing Information: saved ' + Object.keys(values).length + ' answer(s) to adaptive KB + profile'
      );
      await clearPauseStateStorage();
      hideMissingFieldsModal();
      setStatus('Saved — applying to current form and continuing…', 'ok');
      var mode = missingFieldsContext.mode;
      missingFieldsContext = null;
      // (b)+(c) apply to current application fields and continue remaining fill same session
      if (mode === 'batch') {
        try {
          const data = await send(MSG.RESUME || 'FILL_APPLY_RESUME');
          applyStatus(data);
          setStatus('Resumed batch after Complete Missing Information.', 'ok');
        } catch (e) {
          setStatus('Saved, but Resume failed: ' + e.message, 'err');
        }
      } else {
        await fillCurrentPage();
      }
      await refreshSummary();
    } catch (e) {
      setStatus('Save failed: ' + (e && e.message ? e.message : e), 'err');
    } finally {
      if (els.save) els.save.disabled = false;
    }
  }

  function wireMissingFieldsModal() {
    var els = getMissingModalEls();
    if (els.save) els.save.addEventListener('click', function () { onSaveMissingContinue(); });
    if (els.cancel) {
      els.cancel.addEventListener('click', function () {
        hideMissingFieldsModal();
        setStatus('Cancelled — fill fields in App Settings when ready, then Resume / Single again.', 'warn');
      });
    }
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message) return;
      if (message.type === 'FILL_APPLY_MISSING_FIELDS' || message.type === (MSG && MSG.MISSING_FIELDS)) {
        var data = message.data || message.payload || message;
        showMissingFieldsModal(data);
      }
    });
    // Open automatically if pauseState already set
    readPauseStateStorage().then(function (st) {
      if (st && st.missingProfileFields && st.missingProfileFields.length) {
        showMissingFieldsModal(st);
      }
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      var ch = changes[PAUSE_STATE_KEY];
      if (!ch || !ch.newValue) return;
      var st = ch.newValue;
      if (st && st.missingProfileFields && st.missingProfileFields.length) {
        showMissingFieldsModal(st);
      }
    });
  }

  function openAppSettings(hash) {
    try {
      if (hash) {
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') + (hash || '') });
      } else {
        chrome.runtime.openOptionsPage();
      }
    } catch (_e) {
      chrome.runtime.openOptionsPage();
    }
  }

  async function refreshSourceGate() {
    sourceGateIncomplete = false;
    sourceGateLabel = '';
    if (!globalThis.FillApplySourceProfiles) {
      if (sourceGateBannerEl) sourceGateBannerEl.hidden = true;
      return;
    }
    try {
      var selected = await FillApplySourceProfiles.getSelectedSourceId();
      if (!selected) {
        if (sourceGateBannerEl) sourceGateBannerEl.hidden = true;
        if (btnStart && runStateEl) {
          var running = /Running/i.test(runStateEl.textContent || '');
          var paused = /Paused/i.test(runStateEl.textContent || '');
          btnStart.disabled = running || paused;
        }
        return;
      }
      var c = await FillApplySourceProfiles.getCompleteness(selected);
      sourceGateLabel = c.label || selected;
      if (!c.complete) {
        sourceGateIncomplete = true;
        if (sourceGateBannerEl) {
          sourceGateBannerEl.hidden = false;
          if (sourceGateMessageEl) {
            sourceGateMessageEl.textContent =
              'Complete [' + sourceGateLabel + '] source profile (' + c.filled + '/' + c.total + ')';
          }
        }
        if (btnStart) btnStart.disabled = true;
      } else {
        if (sourceGateBannerEl) sourceGateBannerEl.hidden = true;
      }
    } catch (_e) {
      if (sourceGateBannerEl) sourceGateBannerEl.hidden = true;
    }
  }

  async function assertSourceGateOrThrow() {
    if (!globalThis.FillApplySourceProfiles) return null;
    var gate = await FillApplySourceProfiles.assertSelectedSourceComplete();
    if (!gate.ok) {
      await refreshSourceGate();
      openAppSettings('#sec-source-profiles');
      throw new Error(gate.error || 'Complete selected source profile in App Settings');
    }
    return gate;
  }

  async function fillCurrentPage() {
    setStatus('Filling…');
    await liveLog('single_start', 'Single — detecting adapter / waiting for page');
    if (btnFill) btnFill.disabled = true;
    if (btnStart) btnStart.disabled = true;
    try {
      const tab = await getActiveTab();
      if (!tab || tab.id == null) {
        setStatus('No active tab.', 'err');
        return;
      }
      if (isRestrictedUrl(tab.url)) {
        setStatus(
          'Cannot fill this page. Open a real https apply form.',
          'warn'
        );
        return;
      }

      await assertSourceGateOrThrow();

      var profile = await FillApplyProfile.getProfile();
      if (!(profile.email || profile.fullName || profile.firstName)) {
        setStatus('Profile is empty. Open App Settings and fill identity first.', 'warn');
        return;
      }
      if (globalThis.FillApplySourceProfiles && FillApplySourceProfiles.getEffectiveProfile) {
        profile = await FillApplySourceProfiles.getEffectiveProfile(profile);
      }
      if (globalThis.FillApplyKnowledgeStore && FillApplyKnowledgeStore.attachToProfile) {
        try {
          profile = await FillApplyKnowledgeStore.attachToProfile(profile);
        } catch (_kbErr) {
          /* fill without adaptive snapshot */
        }
      }
      // Warn if selected source ≠ page host (still allow)
      try {
        var sel = await FillApplySourceProfiles.getSelectedSourceId();
        if (sel && tab.url) {
          var pageSrc = FillApplySourceProfiles.detectSourceIdFromUrl(tab.url);
          if (pageSrc && pageSrc !== 'generic' && pageSrc !== sel) {
            setStatus(
              'Selected source is ' + sel + ' but page looks like ' + pageSrc + ' — continuing.',
              'warn'
            );
            await liveLog('source_mismatch', 'Selected ' + sel + ' vs page ' + pageSrc);
          }
        }
      } catch (_wm) { /* ignore */ }

      const documents = await resolveDocsForFill(profile);
      const highlightUnmatched = highlightEl ? highlightEl.checked : false;
      const runMode = getSelectedRunMode();

      // Wait for document.readyState complete + settle before first click
      setStatus('Waiting for page to settle…');
      await liveLog('waiting_load', 'Waiting document.readyState complete + settle');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function () {
            return new Promise(function (resolve) {
              var done = false;
              function finish() {
                if (done) return;
                done = true;
                var ms = 800 + Math.floor(Math.random() * 700);
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
          }
        });
      } catch (_settleErr) {
        await new Promise(function (r) { setTimeout(r, 1000); });
      }

      // Action delay (pace)
      var paceMin = 400;
      var paceMax = 900;
      var focusHud = true;
      try {
        var cfg = await FillApplyStorage.getRunConfig();
        if (cfg) {
          if (cfg.actionDelayMinMs != null) paceMin = cfg.actionDelayMinMs;
          if (cfg.actionDelayMaxMs != null) paceMax = cfg.actionDelayMaxMs;
          focusHud = cfg.focusHud !== false;
        }
      } catch (_cfgErr) {}
      var lo = Math.min(paceMin, paceMax);
      var hi = Math.max(paceMin, paceMax);
      await new Promise(function (r) {
        setTimeout(r, lo + Math.floor(Math.random() * Math.max(0, hi - lo + 1)));
      });

      await chrome.scripting.executeScript({
        target: Object.assign({ tabId: tab.id }, INJECT_TARGET),
        files: INJECT_FILES
      });

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async function (docsArg, profileArg) {
          if (
            globalThis.FillApplyFiles &&
            typeof globalThis.FillApplyFiles.resolveDocumentLinks === 'function'
          ) {
            return globalThis.FillApplyFiles.resolveDocumentLinks(docsArg, profileArg);
          }
          return { documents: docsArg, needsManual: false, errors: [] };
        },
        args: [documents, profile]
      }).then(async function (results) {
        var r = results && results[0] && results[0].result;
        if (r && r.documents) {
          Object.assign(documents, r.documents);
          if (r.needsManual && r.errors && r.errors.length) {
            setStatus(r.errors[0], 'warn');
          }
        }
      }).catch(function () { /* ignore */ });

      async function injectFillOnce() {
        const results = await chrome.scripting.executeScript({
          target: Object.assign({ tabId: tab.id }, INJECT_TARGET),
          func: async function (profileArg, documentsArg, opts) {
            // Skip sub-frames that hold no application form and no Apply CTA.
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
              if (!hasForm && !hasCta) {
                return { ok: true, frameSkipped: true, filled: 0, unmatched: 0, total: 0 };
              }
            }

            if (globalThis.FillApplyFocusHud && globalThis.FillApplyFocusHud.setEnabled) {
              globalThis.FillApplyFocusHud.setEnabled(opts.focusHud !== false);
            }
            const registry = globalThis.FillApplyRegistry;
            const adapter = registry ? registry.detect(location.href, document) : null;
            var adapterId = adapter && adapter.id ? adapter.id : 'fallback';
            // Host-preferring detect; never force Indeed on unknown hosts (registry already host-first)
            if (!adapter || typeof adapter.fill !== 'function') {
              if (!globalThis.__fillApply) return { ok: false, error: 'Fill helper missing' };
              return globalThis.__fillApply.run(
                profileArg,
                Object.assign({}, opts, { documents: documentsArg })
              );
            }
            var out = adapter.fill({
              profile: profileArg,
              documents: documentsArg,
              runMode: opts.runMode || 'fill',
              autoSubmit: opts.runMode === 'submit',
              options: opts,
              adapterId: adapter.id,
              submitSelector: adapter.submitSelector,
              fileInputHints: adapter.fileInputHints,
              fieldMaps: adapter.fieldMaps
            });
            if (out && typeof out.then === 'function') out = await out;
            if (out && !out.adapterId) out.adapterId = adapterId;

            // Adapter matched nothing — the page has probably drifted from the
            // layout it targets. Let the generic engine read the page as it is.
            const adapterFoundNothing =
              out &&
              adapterId !== 'fallback' &&
              !(out.filled > 0) &&
              !out.submitted &&
              !out.needsHuman &&
              !out.clickedApplyStart &&
              !out.reDetect &&
              !out.handedOff &&
              !out.externalApply;

            if (adapterFoundNothing && globalThis.__fillApply) {
              try {
                const generic = await globalThis.__fillApply.run(
                  profileArg,
                  Object.assign({}, opts, {
                    documents: documentsArg,
                    fileInputHints: adapter.fileInputHints
                  })
                );
                if (generic && generic.filled > 0) {
                  generic.adapterId = adapterId;
                  generic.usedGenericFallback = true;
                  return generic;
                }
              } catch (_genericErr) {
                /* keep the adapter result */
              }
            }

            return out;
          },
          args: [
            profile,
            documents,
            {
              highlightUnmatched: highlightUnmatched,
              runMode: runMode,
              focusHud: focusHud,
              pace: { actionDelayMinMs: paceMin, actionDelayMaxMs: paceMax }
            }
          ]
        });
        let result = pickBestFrameResult(results);
        if (result && typeof result.then === 'function') result = await result;
        return result;
      }

      async function injectFillWithFrameRetry(label) {
        var maxAttempts = 4;
        var lastErr = null;
        for (var attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            return await injectFillOnce();
          } catch (e) {
            lastErr = e;
            if (!isFrameInvalidError(e) || attempt >= maxAttempts - 1) throw e;
            await liveLog(
              'frame_retry',
              (label || 'fill') +
                ': frame/tab invalidated — wait, re-inject, retry (' +
                (attempt + 1) +
                '/' +
                maxAttempts +
                ')'
            );
            await new Promise(function (r) {
              setTimeout(r, 700 + attempt * 400 + Math.floor(Math.random() * 300));
            });
            tab = await refreshTabRef(tab);
            try {
              await chrome.scripting.executeScript({
                target: Object.assign({ tabId: tab.id }, INJECT_TARGET),
                files: INJECT_FILES
              });
            } catch (_re) {
              /* next attempt */
            }
          }
        }
        throw lastErr || new Error('injectFillWithFrameRetry failed');
      }

      await liveLog('detecting', 'Detecting adapter on ' + String(tab.url || '').slice(0, 80));
      let result = await injectFillWithFrameRetry('detect');
      if (result && result.adapterId) {
        await liveLog('adapter', 'Using adapter: ' + result.adapterId);
      }

      // Apply-start + 2–3 reDetect retries
      for (let attempt = 0; attempt < 3; attempt++) {
        if (
          !(
            result &&
            result.ok !== false &&
            (result.clickedApplyStart ||
              result.reDetect ||
              result.handedOff ||
              result.deferToPageAdapter ||
              result.externalApply) &&
            !(result.filled > 0) &&
            !result.submitted &&
            !result.needsHuman
          )
        ) {
          break;
        }
        var cta = result.applyStartText || result.message || 'Apply';
        setStatus('Clicked Apply — waiting for form… (' + (attempt + 1) + '/3)');
        await liveLog(
          'clicked_apply',
          'Clicked Apply ("' + String(cta).slice(0, 60) + '"); waiting load (' + (attempt + 1) + '/3)'
        );
        await new Promise(function (r) {
          setTimeout(r, 1000 + attempt * 400 + Math.floor(Math.random() * 400));
        });
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function () {
              return new Promise(function (resolve) {
                var ms = 400 + Math.floor(Math.random() * 500);
                if (document.readyState === 'complete') setTimeout(resolve, ms);
                else {
                  window.addEventListener('load', function () { setTimeout(resolve, ms); }, { once: true });
                  setTimeout(resolve, 5000);
                }
              });
            }
          });
        } catch (_w) {}
        await chrome.scripting.executeScript({
          target: Object.assign({ tabId: tab.id }, INJECT_TARGET),
          files: INJECT_FILES
        });
        await liveLog('filling', 'Re-detect / fill attempt ' + (attempt + 2));
        const next = await injectFillWithFrameRetry('redetect-' + (attempt + 2));
        if (next) result = next;
      }

      if (!result || result.ok === false) {
        setStatus((result && result.error) || 'Fill failed.', 'err');
        await liveLog('error', (result && result.error) || 'Fill failed');
        return;
      }
      if (result.needsHuman) {
        var missing = Array.isArray(result.missingProfileFields)
          ? result.missingProfileFields
          : [];
        var unknownMeta = Array.isArray(result.unknownFields) ? result.unknownFields : [];
        var msg =
          result.error ||
          'Paused — missing profile field(s): ' +
            (missing.join(', ') || 'see App Settings');
        await liveLog('missing_fields', msg, {
          missingProfileFields: missing,
          unknownFields: unknownMeta
        });
        var pausePayload = {
          jobId: null,
          tabId: tab.id,
          missingProfileFields: missing,
          unknownFields: unknownMeta,
          message: msg,
          at: Date.now(),
          mode: 'single',
          reason: result.pauseReason || 'missing_profile_field'
        };
        try {
          var o = {};
          o[PAUSE_STATE_KEY] = pausePayload;
          await chrome.storage.local.set(o);
        } catch (_ps) {}
        showMissingFieldsModal(pausePayload);
        return;
      }
      if (result.clickedApplyStart && !(result.filled > 0)) {
        setStatus(
          result.message ||
            'Clicked Apply to open the form — run again if fields are not filled yet.',
          'warn'
        );
        await liveLog('apply_open', result.message || 'Apply clicked; form not filled yet');
        return;
      }
      const filesN =
        result.filesAttached && result.filesAttached.attached
          ? result.filesAttached.attached.length
          : 0;
      const attachBits = [];
      if (result.resumeAttached) attachBits.push('resume');
      if (result.coverAttached) attachBits.push('cover');
      setStatus(
        'Filled ' +
          result.filled +
          ' / ' +
          result.total +
          ' via ' +
          (result.adapterId || 'unknown') +
          (filesN ? '; files: ' + filesN : '') +
          (attachBits.length ? ' (' + attachBits.join('+') + ')' : '') +
          (result.unmatched ? ' (' + result.unmatched + ' unmatched)' : '') +
          '.',
        result.filled || filesN ? 'ok' : 'warn'
      );
      await liveLog('filling', 'Filled ' + result.filled + '/' + result.total + ' via ' + (result.adapterId || '?'));
      try {
        await FillApplyStorage.appendSessionLog({
          type: 'fill_once',
          mode: runMode,
          filled: result.filled,
          adapterId: result.adapterId
        });
        await refreshLiveLog();
      } catch (_e) { /* ignore */ }
    } catch (e) {
      var emsg = e && e.message ? e.message : String(e);
      if (isFrameInvalidError(e)) {
        setStatus(
          'Page navigated during Easy Apply (frame removed). Wait for the form, then click Fill again / Resume.',
          'warn'
        );
        await liveLog('frame_retry', emsg);
      } else {
        setStatus('Error: ' + emsg, 'err');
        await liveLog('error', emsg);
      }
    } finally {
      if (btnFill) btnFill.disabled = false;
      await refreshStatus();
    }
  }



  function jobPoolApplicationsUrl() {
    var T = globalThis.FillApplyTypes || {};
    return (
      T.JOBPOOL_APPLICATIONS_URL ||
      (T.JOBPOOL_DEFAULT_BASE_URL || 'https://zahid-jobpool.vercel.app') + '/applications'
    );
  }

  if (btnOpenJobPool) {
    btnOpenJobPool.addEventListener('click', function () {
      var url = jobPoolApplicationsUrl();
      try {
        chrome.tabs.create({ url: url });
      } catch (_e) {
        window.open(url, '_blank');
      }
    });
  }

  if (btnLoadJobPool) {
    btnLoadJobPool.addEventListener('click', async function () {
      setStatus('Loading jobs from JobPool…', 'ok');
      try {
        const data = await send('FILL_APPLY_LOAD_JOBPOOL', {});
        if (!data || data.ok === false) {
          setStatus(
            (data && data.hint) ||
              (data && data.error) ||
              'Could not load JobPool jobs. Open Applications while signed in, then retry.',
            'err'
          );
          if (data && data.applicationsUrl) {
            try {
              chrome.tabs.create({ url: data.applicationsUrl });
            } catch (_e2) {}
          }
          return;
        }
        await refreshSummary();
        setStatus(
          'Loaded ' +
            (data.loaded || 0) +
            ' JobPool job(s) via ' +
            (data.source || 'jobpool') +
            '. Start runner when ready.',
          'ok'
        );
      } catch (e) {
        var em = String((e && e.message) || e || '');
        if (/DOCTYPE|not valid JSON|returned HTML|JSON parse failed/i.test(em)) {
          setStatus(
            'JobPool API returned a web page instead of jobs. Open Applications while signed in, then Load from JobPool again (scrape fallback).',
            'err'
          );
        } else {
          setStatus('JobPool load failed: ' + em, 'err');
        }
      }
    });
  }

  if (btnOptions) {
    btnOptions.addEventListener('click', function () {
      openAppSettings();
    });
  }
  if (btnOpenSourceSettings) {
    btnOpenSourceSettings.addEventListener('click', function () {
      openAppSettings('#sec-source-profiles');
    });
  }

  if (btnSeed) {
    btnSeed.addEventListener('click', async function () {
      try {
        await FillApplyProfile.seedSampleProfile();
        await refreshSummary();
        setStatus('Sample saved into active profile.', 'ok');
      } catch (e) {
        setStatus('Failed to seed profile: ' + e.message, 'err');
      }
    });
  }

  if (profileSelectEl) {
    profileSelectEl.addEventListener('change', async function () {
      var id = profileSelectEl.value;
      if (!id) return;
      try {
        await FillApplyProfile.setActiveProfile(id);
        await refreshSummary();
        await refreshProfileSelect();
        setStatus('Active profile updated.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    });
  }

  document.querySelectorAll('input[name="runnerMode"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      persistRunnerMode();
      hideEmptyPrompt();
    });
  });

  if (btnStart) {
    btnStart.addEventListener('click', async function () {
      hideEmptyPrompt();
      try {
        await assertSourceGateOrThrow();
      } catch (ge) {
        setStatus(String(ge.message || ge), 'err');
        return;
      }
      const runnerMode = getRunnerMode();
      if (runnerMode === 'single') {
        setStatus('Single — filling current page…');
        await fillCurrentPage();
        return;
      }
      // Batch
      const queued = lastCounts.queued || 0;
      let urlsCount = 0;
      try {
        const urls = await FillApplyStorage.getMockQueueUrls();
        urlsCount = (urls || []).length;
      } catch (_e) { /* ignore */ }

      if (!queued && !urlsCount) {
        showEmptyPrompt();
        setStatus('Queue empty.', 'warn');
        return;
      }

      setStatus('Starting batch…');
      try {
        const data = await send(MSG.START, { config: readConfigPartial(), resetMock: false });
        applyStatus(data);
        const mode = getSelectedRunMode();
        setStatus('Batch runner started (' + mode + ') — order by source.', 'ok');
        await refreshLiveLog();
      } catch (e) {
        if (/SOURCE_PROFILE|source profile|App Settings/i.test(String(e.message || ''))) {
          await refreshSourceGate();
          openAppSettings('#sec-source-profiles');
        }
        if (/Application queue|Mock queue|no url|empty/i.test(String(e.message || ''))) {
          showEmptyPrompt();
        }
        setStatus('Start failed: ' + e.message, 'err');
      }
    });
  }

  if (btnEmptyYes) {
    btnEmptyYes.addEventListener('click', async function () {
      hideEmptyPrompt();
      await fillCurrentPage();
    });
  }

  if (btnEmptyNo) {
    btnEmptyNo.addEventListener('click', function () {
      hideEmptyPrompt();
      openAppSettings('#sec-queue');
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', async function () {
      setStatus('Stopping…');
      try {
        const data = await send(MSG.STOP);
        applyStatus(data);
        setStatus('Stopped — current job cancelled if incomplete; remaining stay queued.', 'ok');
        await refreshLiveLog();
      } catch (e) {
        setStatus('Stop failed: ' + e.message, 'err');
      }
    });
  }

  if (btnResume) {
    btnResume.addEventListener('click', async function () {
      setStatus('Resuming…');
      try {
        const data = await send(MSG.RESUME || 'FILL_APPLY_RESUME');
        applyStatus(data);
        setStatus('Resumed — continuing after human verification.', 'ok');
      } catch (e) {
        setStatus('Resume failed: ' + e.message, 'err');
      }
    });
  }

  if (btnResetMock) {
    btnResetMock.addEventListener('click', async function () {
      try {
        const data = await send('FILL_APPLY_RESET_MOCK');
        setStatus(
          data.remaining
            ? 'Queued rebuilt (' + data.remaining + ' jobs).'
            : 'Queue and URLs cleared — paste URLs in App Settings → Application queue if needed.',
          data.remaining ? 'ok' : 'warn'
        );
        await refreshStatus();
      } catch (e) {
        setStatus('Reset failed: ' + e.message, 'err');
      }
    });
  }

  if (btnFill) {
    btnFill.addEventListener('click', function () {
      fillCurrentPage();
    });
  }

  document.querySelectorAll('input[name="runMode"]').forEach(function (radio) {
    radio.addEventListener('change', async function () {
      try {
        const cfg = readConfigPartial();
        await send('FILL_APPLY_SAVE_CONFIG', { config: cfg });
        setStatus('Application mode: ' + cfg.runMode, 'ok');
      } catch (_e) {}
    });
  });

  async function refreshReports() {
    if (!recentReportsEl && !btnLastReport) return;
    try {
      const data = await send('FILL_APPLY_GET_REPORTS');
      const reports = (data && data.reports) || [];
      if (recentReportsEl) {
        if (!reports.length) {
          recentReportsEl.hidden = true;
          recentReportsEl.innerHTML = '';
        } else {
          recentReportsEl.hidden = false;
          const slice = reports.slice(-5).reverse();
          recentReportsEl.innerHTML = slice
            .map(function (r) {
              const when = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
              const title = (r.company || r.title || r.jobId || 'Report').slice(0, 42);
              const file = r.filename ? ' · ' + r.filename : '';
              return (
                '<li><strong>' +
                title +
                '</strong><span class="sub"> ' +
                when +
                file +
                '</span></li>'
              );
            })
            .join('');
        }
      }
    } catch (_e) { /* ignore */ }
  }

  if (btnLastReport) {
    btnLastReport.addEventListener('click', async function () {
      try {
        const data = await send('FILL_APPLY_GET_LAST_REPORT');
        const r = data && data.report;
        if (!r) {
          setStatus('No submitted reports yet.', 'warn');
          return;
        }
        await refreshReports();
        setStatus(
          'Last report: ' +
            (r.company || r.title || r.jobId || r.id) +
            (r.filename ? ' → ' + r.filename : ''),
          'ok'
        );
      } catch (e) {
        setStatus('Reports: ' + e.message, 'err');
      }
    });
  }

  loadRunnerMode();
  refreshProfileSelect().catch(function () {});
  refreshSummary().catch(function (e) {
    if (summaryEl) summaryEl.textContent = 'Could not load profile';
    setStatus(String(e.message || e), 'err');
  });
  refreshSourceGate().catch(function () {});
  refreshStatus();
  refreshReports();
  refreshLiveLog();
  setInterval(refreshStatus, 1500);
  setInterval(refreshLiveLog, 2000);
  setInterval(function () {
    refreshProfileSelect().catch(function () {});
    refreshSummary().catch(function () {});
    refreshSourceGate().catch(function () {});
  }, 5000);
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes['fillApply.selectedSourceId'] || changes['fillApply.sourceProfiles'] || changes['fillApply.profiles']) {
        refreshSourceGate().catch(function () {});
      }
    });
  }

  try {
    var man = chrome.runtime.getManifest && chrome.runtime.getManifest();
    if (man && man.version) {
      var tag = document.getElementById('extVersionTag');
      if (tag) tag.textContent = 'v' + man.version;
    }
  } catch (_e) { /* ignore */ }
})();
