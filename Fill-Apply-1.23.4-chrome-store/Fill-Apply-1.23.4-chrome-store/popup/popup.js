/**
 * Auto Apply E2E popup — single feature, two actions (Start / Stop).
 *
 * Start  → FILL_APPLY_AUTO_APPLY_START: JobPool → auth → fill → navigate →
 *          submit → back to JobPool with applied | blocked | error.
 * Stop   → FILL_APPLY_STOP (existing runner stop; safe at any time).
 *
 * Standalone script: shares nothing with ui/panel-app.js so the popup can
 * never drift back to the legacy multi-mode behavior.
 */
(function () {
  'use strict';

  const AUTO_APPLY_START = 'FILL_APPLY_AUTO_APPLY_START';
  const STOP = 'FILL_APPLY_STOP';
  const STATUS = 'FILL_APPLY_STATUS';
  const REVIEW_KEY = 'fillApply.autoApplyReview';
  const JOBPOOL_URL = 'https://zahid-jobpool.vercel.app/applications';

  const $ = function (id) {
    return document.getElementById(id);
  };
  const btnStart = $('btnAutoStart');
  const btnStop = $('btnAutoStop');
  const btnJobPool = $('btnJobPool');
  const btnSettings = $('btnSettings');
  const summaryEl = $('summary');
  const statusEl = $('status');
  const runStateEl = $('runState');
  const currentJobEl = $('currentJob');
  const lastErrorEl = $('lastError');
  const countQueuedEl = $('countQueued');
  const countAppliedEl = $('countApplied');
  const countBlockedEl = $('countBlocked');
  const countErrorEl = $('countError');
  const reviewWrapEl = $('reviewWrap');
  const reviewListEl = $('reviewList');

  let pollTimer = null;

  function send(type, extra) {
    const msg = Object.assign({ type: type }, extra || {});
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!res) {
            reject(new Error('No response from background'));
            return;
          }
          if (res.ok === false) {
            reject(new Error(res.error || 'Request failed'));
            return;
          }
          resolve(res.data);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderCounts(counts) {
    const c = counts || {};
    if (countQueuedEl) countQueuedEl.textContent = String(c.queued != null ? c.queued : '—');
    if (countAppliedEl) countAppliedEl.textContent = String(c.applied != null ? c.applied : '—');
    // Blocked + error roll up into the failed bucket on JobPool; show them separately.
    let blocked = c.blocked;
    let err = c.error;
    if (blocked == null && err == null) {
      // Fall back: split failed bucket via session log outcomes when first painted.
      blocked = c.failed != null ? 0 : null;
      err = c.failed != null ? c.failed : null;
    }
    if (countBlockedEl) countBlockedEl.textContent = String(blocked != null ? blocked : '—');
    if (countErrorEl) countErrorEl.textContent = String(err != null ? err : '—');
  }

  function renderStatus(snap) {
    if (!snap) return;
    const running = !!snap.running;
    const paused = !!snap.pausedForHuman;

    if (btnStart) btnStart.disabled = running;
    if (btnStop) btnStop.disabled = !running;

    if (runStateEl) {
      runStateEl.textContent = running ? 'Running — Auto Apply' : paused ? 'Paused' : 'Idle';
      runStateEl.className = 'run-state ' + (running ? 'running' : 'idle');
    }

    const qs = snap.queueStatus || {};
    if (currentJobEl) {
      const title = qs.lastJobTitle;
      if (running && title) {
        currentJobEl.textContent = '▶ ' + title;
        currentJobEl.hidden = false;
      } else {
        currentJobEl.hidden = true;
      }
    }
    renderCounts(snap.counts || (qs && qs.counts));

    if (lastErrorEl) {
      const err = qs.lastError;
      if (err) {
        lastErrorEl.textContent = String(err).slice(0, 220);
        lastErrorEl.hidden = false;
      } else {
        lastErrorEl.hidden = true;
      }
    }
  }

  async function refreshReview() {
    if (!reviewWrapEl || !reviewListEl) return;
    try {
      const res = await new Promise(function (resolve) {
        chrome.storage.local.get([REVIEW_KEY], function (r) {
          resolve((r && r[REVIEW_KEY]) || []);
        });
      });
      const list = Array.isArray(res) ? res.slice(-8).reverse() : [];
      if (!list.length) {
        reviewWrapEl.hidden = true;
        reviewListEl.textContent = '';
        return;
      }
      reviewWrapEl.hidden = false;
      reviewListEl.textContent = '';
      list.forEach(function (item) {
        const li = document.createElement('li');
        const title = document.createElement('span');
        title.className = 'review-item-title';
        title.textContent = (item.title || item.jobId || 'Job').slice(0, 60);
        const reason = document.createElement('span');
        reason.className = 'review-item-reason';
        reason.textContent = String(item.reason || 'blocked').slice(0, 90);
        li.appendChild(title);
        li.appendChild(reason);
        reviewListEl.appendChild(li);
      });
    } catch (_e) {
      reviewWrapEl.hidden = true;
    }
  }

  let reviewTick = 0;

  async function pollOnce() {
    try {
      const snap = await send(STATUS);
      renderStatus(snap);
    } catch (_e) {
      /* transient — background asleep or context reload */
    }
    // Refresh the blocked-for-review list every ~6s while polling.
    reviewTick += 1;
    if (reviewTick % 5 === 0) await refreshReview();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, 1200);
  }

  async function initSummary() {
    if (!summaryEl) return;
    try {
      const profile = await new Promise(function (resolve) {
        chrome.storage.local.get(['fillApply.profile', 'fillApply.profiles'], function (r) {
          resolve(r || {});
        });
      });
      const p = profile['fillApply.profile'] || {};
      const name = p.fullName || p.name || p.email || '';
      summaryEl.textContent = name
        ? 'Profile: ' + String(name).slice(0, 48)
        : 'No profile yet — add one in Settings before starting.';
    } catch (_e) {
      summaryEl.textContent = '';
    }
  }

  if (btnStart) {
    btnStart.addEventListener('click', async function () {
      btnStart.disabled = true;
      setStatus('Starting Auto Apply…');
      try {
        const snap = await send(AUTO_APPLY_START);
        renderStatus(snap);
        setStatus('Auto Apply running — jobs will be marked Applied / Blocked / Error.', 'ok');
      } catch (e) {
        const msg = String(e.message || e);
        if (/SOURCE_PROFILE|source profile|Profile is empty/i.test(msg)) {
          setStatus('Complete your profile in Settings first.', 'err');
          if (btnSettings) btnSettings.focus();
        } else if (/JobPool|queue|Load/i.test(msg)) {
          setStatus(msg.slice(0, 200), 'err');
        } else {
          setStatus('Start failed: ' + msg.slice(0, 180), 'err');
        }
        await pollOnce();
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', async function () {
      btnStop.disabled = true;
      setStatus('Stopping…');
      try {
        const snap = await send(STOP);
        renderStatus(snap);
        setStatus('Stopped — current job cancelled; remaining stay queued.', 'ok');
      } catch (e) {
        setStatus('Stop failed: ' + String(e.message || e).slice(0, 180), 'err');
      }
    });
  }

  if (btnJobPool) {
    btnJobPool.addEventListener('click', function () {
      chrome.tabs.create({ url: JOBPOOL_URL });
    });
  }

  if (btnSettings) {
    btnSettings.addEventListener('click', function () {
      const url = chrome.runtime.getURL('options/options.html');
      chrome.tabs.create({ url: url });
    });
  }

  // Kick off
  initSummary();
  pollOnce();
  refreshReview();
  startPolling();
})();
