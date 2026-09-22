/**
 * MV3 service worker — owns the runner state machine and message API.
 * Also configures chrome.sidePanel so the toolbar action opens the right sidebar.
 */
/* global importScripts, FillApplyTypes, FillApplyStorage, FillApplyProfile, FillApplyBackend, FillApplyReport, FillApplyRunner, FillApplyKnowledgeStore, FillApplyKnowledgeLearn */

importScripts(
  '../lib/types.js',
  '../lib/storage.js',
  '../lib/profile.js',
  '../lib/profile-io.js',
  '../lib/knowledge-policy.js',
  '../lib/knowledge-canonical.js',
  '../lib/knowledge-store.js',
  '../lib/knowledge-learn.js',
  '../lib/environment-store.js',
  '../lib/question-bank-store.js',
  '../lib/source-profiles.js',
  '../lib/backend.js',
  '../lib/report.js',
  '../lib/ats-auth.js',
  '../lib/ats-auth-store.js',
  '../runner/runner.js'
);

var SIDE_PANEL_PATH = 'sidepanel/sidepanel.html';

function configureSidePanel() {
  if (!chrome.sidePanel) return;
  try {
    chrome.sidePanel.setOptions({ enabled: false, path: SIDE_PANEL_PATH });
  } catch (e) {
    console.warn('[Fill & Apply] sidePanel.setOptions failed:', e);
  }
  try {
    // Toolbar click opens the popup (Auto Apply Start / Stop).
    if (chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(function () {});
    }
  } catch (e) {
    console.warn('[Fill & Apply] sidePanel.setPanelBehavior failed:', e);
  }
}

var POPUP_PATH = 'popup/popup.html';
var SIDE_PANEL_PATH = 'sidepanel/sidepanel.html';

function configureActionPopup() {
  try {
    if (chrome.action && chrome.action.setPopup) {
      chrome.action.setPopup({ popup: POPUP_PATH });
    }
  } catch (e) {
    console.warn('[Fill & Apply] action.setPopup failed:', e);
  }
}

configureActionPopup();
configureSidePanel();

chrome.runtime.onInstalled.addListener(function (details) {
  configureActionPopup();
  configureSidePanel();
  if (details.reason === 'install') {
    console.log(
      '[Fill & Apply] Installed. Click the toolbar icon to open the side panel. Add https job apply URLs in App Settings (Application queue), then Start.'
    );
  }
  if (typeof FillApplySourceProfiles !== 'undefined' && FillApplySourceProfiles.ensureSourceProfileShells) {
    FillApplySourceProfiles.ensureSourceProfileShells().catch(function () {});
  }
  if (typeof FillApplyKnowledgeStore !== 'undefined' && FillApplyKnowledgeStore.migrateAndSanitizeKnowledge) {
    FillApplyKnowledgeStore.migrateAndSanitizeKnowledge().catch(function () {});
  }
  if (typeof FillApplyEnvironment !== 'undefined' && FillApplyEnvironment.load) {
    FillApplyEnvironment.load().catch(function () {});
  }
  if (typeof FillApplyQuestionBank !== 'undefined' && FillApplyQuestionBank.load) {
    FillApplyQuestionBank.load().catch(function () {});
  }

  FillApplyStorage.getRunConfig().then(function (cfg) {
    // Migrate autoSubmit → runMode; ensure defaults
    const patch = {};
    if (typeof cfg.autoCloseAppliedTab === 'undefined') {
      patch.autoCloseAppliedTab = true;
    }
    if (typeof cfg.keepRecentTabs === 'undefined') {
      patch.keepRecentTabs = 5;
    }
    if (typeof cfg.autoPdfReport === 'undefined') {
      patch.autoPdfReport = true;
    }
    if (!cfg.runMode || ['register', 'fill', 'navigate', 'ready', 'submit'].indexOf(cfg.runMode) === -1) {
      patch.runMode = cfg.autoSubmit ? 'submit' : 'fill';
    }
    if (Object.keys(patch).length) {
      return FillApplyStorage.saveRunConfig(Object.assign({}, cfg, patch));
    }
    return cfg;
  });

  // Scrub any chrome-extension URLs from legacy mock queue on upgrade
  if (FillApplyBackend && FillApplyBackend.getQueued) {
    FillApplyBackend.getQueued().catch(function () {});
  }
});

chrome.runtime.onStartup.addListener(function () {
  configureActionPopup();
  configureSidePanel();
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return false;

  const MSG = FillApplyTypes.MSG;

  function reply(promise) {
    promise
      .then(function (data) {
        sendResponse({ ok: true, data: data });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      });
    return true;
  }

  if (message.type === MSG.PING || message.type === 'FILL_APPLY_PING') {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version
    });
    return true;
  }

  if (message.type === MSG.START) {
    return reply(
      (async function () {
        if (message.config) {
          await FillApplyStorage.saveRunConfig(message.config);
        }
        if (typeof FillApplySourceProfiles !== 'undefined' && FillApplySourceProfiles.assertSelectedSourceComplete) {
          var gate = await FillApplySourceProfiles.assertSelectedSourceComplete();
          if (!gate.ok) {
            var err = new Error(gate.error || 'Complete selected source profile in App Settings');
            err.code = 'SOURCE_PROFILE_INCOMPLETE';
            err.sourceId = gate.selectedSourceId;
            throw err;
          }
        }
        if (message.resetMock) {
          await FillApplyBackend.resetMockQueue();
        }
        return FillApplyRunner.start();
      })()
    );
  }

  if (message.type === MSG.AUTO_APPLY_START || message.type === 'FILL_APPLY_AUTO_APPLY_START') {
    return reply(FillApplyRunner.startAutoApply());
  }

  if (message.type === MSG.STOP) {
    return reply(FillApplyRunner.stop());
  }

  if (message.type === MSG.RESUME || message.type === 'FILL_APPLY_RESUME') {
    return reply(FillApplyRunner.resume());
  }

  if (message.type === MSG.STATUS) {
    return reply(FillApplyRunner.getStatus());
  }

  if (message.type === MSG.FILL_ONCE || message.type === 'FILL_APPLY_FILL_ONCE') {
    return reply(
      (async function () {
        var tabId = message.tabId;
        if (tabId == null && sender && sender.tab && sender.tab.id != null) {
          tabId = sender.tab.id;
        }
        if (tabId == null) {
          try {
            var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs[0] && tabs[0].id != null) tabId = tabs[0].id;
          } catch (_q) {}
        }
        var mode = message.runMode || (message.config && message.config.runMode) || 'fill';
        if (['register', 'fill', 'navigate', 'ready', 'submit'].indexOf(mode) === -1) mode = 'fill';
        return FillApplyRunner.runOnceOnTab(tabId, mode);
      })()
    );
  }


  if (message.type === 'FILL_APPLY_LOAD_JOBPOOL') {
    return reply(
      (async function () {
        const Types = globalThis.FillApplyTypes || {};
        const base = String(
          (message && message.baseUrl) ||
            Types.JOBPOOL_DEFAULT_BASE_URL ||
            'https://zahid-jobpool.vercel.app'
        ).replace(/\/$/, '');
        const appsUrl = base + '/applications';

        let api = { jobs: [], source: 'none', baseUrl: base };
        if (FillApplyBackend && FillApplyBackend.loadJobsFromJobPool) {
          api = await FillApplyBackend.loadJobsFromJobPool({ baseUrl: base });
        } else {
          const prev = await FillApplyStorage.getRunConfig();
          await FillApplyStorage.saveRunConfig(
            Object.assign({}, prev, { backendBaseUrl: base, mockMode: false })
          );
        }

        if (api.jobs && api.jobs.length) {
          const counts = await FillApplyBackend.refreshCounts();
          await FillApplyStorage.setQueueStatus({
            remaining: api.jobs.length,
            counts: counts,
            lastError: null
          });
          return {
            ok: true,
            loaded: api.jobs.length,
            source: api.source,
            jobs: api.jobs,
            counts: counts,
            applicationsUrl: appsUrl
          };
        }

        // Scrape Ready-to-apply cards from the Applications page (user session cookies).
        let tab = null;
        const tabs = await chrome.tabs.query({});
        for (let i = 0; i < tabs.length; i++) {
          const u = tabs[i] && tabs[i].url ? String(tabs[i].url) : '';
          if (/zahid-jobpool\.vercel\.app/i.test(u) && /application/i.test(u)) {
            tab = tabs[i];
            break;
          }
        }
        if (!tab) {
          tab = await chrome.tabs.create({ url: appsUrl, active: true });
          await new Promise(function (r) {
            setTimeout(r, 2500);
          });
        } else {
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise(function (r) {
            setTimeout(r, 800);
          });
        }

        let scraped = [];
        try {
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
                var label = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '')
                  .replace(/\s+/g, ' ')
                  .trim();
                if (!/^apply$/i.test(label) && el.getAttribute('data-fill-apply') !== 'jobpool-apply') {
                  continue;
                }
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
                    (card.getAttribute('data-job-id') ||
                      card.getAttribute('data-jobpool-job-id'))) ||
                  (idMatch && idMatch[1]) ||
                  'jobpool-' + (out.length + 1);
                var titleLine = blob.split('\n').map(function (l) {
                  return l.trim();
                }).filter(Boolean)[0] || 'Job';
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
          scraped = (inj && inj[0] && inj[0].result) || [];
        } catch (scrapeErr) {
          return {
            ok: false,
            loaded: 0,
            error: String((scrapeErr && scrapeErr.message) || scrapeErr),
            applicationsUrl: appsUrl,
            hint: 'Sign in to JobPool in Chrome, open Applications, then Load again.'
          };
        }

        if (!scraped.length) {
          return {
            ok: false,
            loaded: 0,
            source: 'scrape-empty',
            applicationsUrl: appsUrl,
            apiError: api.error || null,
            hint: 'Open ' + appsUrl + ' while signed in, then click Load from JobPool again.'
          };
        }

        const jobs = FillApplyBackend.normalizeLiveQueue
          ? FillApplyBackend.normalizeLiveQueue(scraped)
          : scraped;
        await FillApplyBackend.setQueued(jobs);
        const counts = await FillApplyBackend.refreshCounts();
        const urls = jobs.map(function (j) {
          return j.url;
        });
        try {
          await FillApplyStorage.saveMockQueueUrls(urls);
        } catch (_e) {}
        await FillApplyStorage.setQueueStatus({
          remaining: jobs.length,
          counts: counts,
          lastError: null
        });
        return {
          ok: true,
          loaded: jobs.length,
          source: 'scrape',
          jobs: jobs,
          counts: counts,
          applicationsUrl: appsUrl
        };
      })()
    );
  }

  if (message.type === 'FILL_APPLY_OPEN_TAB') {
    return reply(
      (async function () {
        var url = String((message && message.url) || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          return { ok: false, error: 'Invalid URL' };
        }
        var tab = await chrome.tabs.create({
          url: url,
          active: message.active !== false
        });
        return { ok: true, tabId: tab && tab.id, url: url };
      })()
    );
  }

  if (message.type === 'FILL_APPLY_RESET_MOCK') {
    return reply(
      FillApplyBackend.resetMockQueue({ clearFailed: false, clearCancelled: false }).then(
        async function (jobs) {
          const counts = await FillApplyBackend.refreshCounts();
          await FillApplyStorage.setQueueStatus({
            remaining: jobs.length,
            counts: counts,
            lastError: jobs.length
              ? null
              : FillApplyBackend.NO_URLS_ERROR ||
                'Add job apply URLs in App Settings (Application queue)'
          });
          return { remaining: jobs.length, jobs: jobs, counts: counts };
        }
      )
    );
  }

  if (message.type === 'FILL_APPLY_CLEAR_HISTORY') {
    return reply(
      (async function () {
        await FillApplyStorage.clearHistory();
        const counts = await FillApplyBackend.refreshCounts();
        return { counts: counts };
      })()
    );
  }

  if (message.type === 'FILL_APPLY_SAVE_CONFIG') {
    return reply(FillApplyStorage.saveRunConfig(message.config || {}));
  }

  if (message.type === 'FILL_APPLY_SAVE_MOCK_URLS') {
    return reply(
      (async function () {
        const result = await FillApplyBackend.rebuildQueuedFromUrls(
          message.urlsText != null ? message.urlsText : message.urls || []
        );
        const counts = await FillApplyBackend.refreshCounts();
        await FillApplyStorage.setQueueStatus({
          remaining: result.jobs.length,
          counts: counts,
          lastError: result.jobs.length ? null : FillApplyBackend.NO_URLS_ERROR
        });
        return {
          urls: result.urls,
          remaining: result.jobs.length,
          jobs: result.jobs,
          counts: counts
        };
      })()
    );
  }

  if (message.type === 'FILL_APPLY_GET_MOCK_URLS') {
    return reply(
      FillApplyStorage.getMockQueueUrls().then(function (urls) {
        return { urls: urls, text: urls.join('\n') };
      })
    );
  }

  if (message.type === 'FILL_APPLY_GET_BUCKETS') {
    return reply(FillApplyBackend.getBucketsSnapshot());
  }


  if (message.type === 'FILL_APPLY_GET_REPORTS' || message.type === MSG.GET_REPORTS) {
    return reply(
      (async function () {
        const reports = FillApplyReport ? await FillApplyReport.getReports() : [];
        return { reports: reports };
      })()
    );
  }

  if (message.type === 'FILL_APPLY_GET_LAST_REPORT' || message.type === MSG.GET_LAST_REPORT) {
    return reply(
      (async function () {
        const last = FillApplyReport ? await FillApplyReport.getLastReport() : null;
        return { report: last };
      })()
    );
  }

  if (
    message.type === 'FILL_APPLY_KNOWLEDGE_LEARN' ||
    message.type === MSG.KNOWLEDGE_LEARN
  ) {
    return reply(
      (async function () {
        if (!FillApplyKnowledgeStore) return { skipped: true };
        if (message.record) {
          await FillApplyKnowledgeStore.putKnowledge(message.record);
          return { stored: true, id: message.record.id };
        }
        if (message.input && FillApplyKnowledgeLearn) {
          return FillApplyKnowledgeLearn.learn(message.input);
        }
        return { skipped: true };
      })()
    );
  }

  if (
    message.type === 'FILL_APPLY_KNOWLEDGE_SNAPSHOT' ||
    message.type === MSG.KNOWLEDGE_SNAPSHOT
  ) {
    return reply(
      FillApplyKnowledgeStore
        ? FillApplyKnowledgeStore.exportSnapshot(message.profileId)
        : { records: [] }
    );
  }

  if (message.type === 'FILL_APPLY_KNOWLEDGE_LIST' || message.type === MSG.KNOWLEDGE_LIST) {
    return reply(
      FillApplyKnowledgeStore
        ? FillApplyKnowledgeStore.listKnowledge(message.profileId).then(function (records) {
            return { records: records };
          })
        : { records: [] }
    );
  }

  if (message.type === 'FILL_APPLY_KNOWLEDGE_UPSERT' || message.type === MSG.KNOWLEDGE_UPSERT) {
    return reply(
      FillApplyKnowledgeStore
        ? FillApplyKnowledgeStore.putKnowledge(message.record || {}).then(function (record) {
            return { record: record };
          })
        : { record: null }
    );
  }

  if (message.type === 'FILL_APPLY_KNOWLEDGE_DELETE' || message.type === MSG.KNOWLEDGE_DELETE) {
    return reply(
      FillApplyKnowledgeStore
        ? FillApplyKnowledgeStore.deleteKnowledge(message.id).then(function () {
            return { deleted: message.id };
          })
        : { deleted: null }
    );
  }

  if (message.type === 'FILL_APPLY_KNOWLEDGE_EVENTS' || message.type === MSG.KNOWLEDGE_EVENTS) {
    return reply(
      FillApplyKnowledgeStore
        ? FillApplyKnowledgeStore.listEvents(message.limit).then(function (events) {
            return { events: events };
          })
        : { events: [] }
    );
  }

  if (
    message.type === 'FILL_APPLY_KNOWLEDGE_SETTINGS' ||
    message.type === MSG.KNOWLEDGE_SETTINGS
  ) {
    return reply(
      (async function () {
        if (!FillApplyKnowledgeStore) return { learningEnabled: true };
        if (message.settings) return FillApplyKnowledgeStore.saveSettings(message.settings);
        return FillApplyKnowledgeStore.getSettings();
      })()
    );
  }

  if (
    message.type === 'FILL_APPLY_KNOWLEDGE_CONFLICTS' ||
    message.type === MSG.KNOWLEDGE_CONFLICTS
  ) {
    return reply(
      FillApplyKnowledgeStore && FillApplyKnowledgeStore.listConflicts
        ? FillApplyKnowledgeStore.listConflicts(message).then(function (conflicts) {
            return { conflicts: conflicts };
          })
        : { conflicts: [] }
    );
  }

  if (
    message.type === 'FILL_APPLY_KNOWLEDGE_RESOLVE_CONFLICT' ||
    message.type === MSG.KNOWLEDGE_RESOLVE_CONFLICT
  ) {
    return reply(
      FillApplyKnowledgeStore && FillApplyKnowledgeStore.resolveConflict
        ? FillApplyKnowledgeStore.resolveConflict(
            message.id,
            message.action,
            message.extra || {}
          )
        : { ok: false, reason: 'unavailable' }
    );
  }

  return false;
});
