/**
 * Stub backend API client for the job queue.
 * Mock mode uses structured buckets in chrome.storage:
 *   queued / applied / failed / cancelled
 * Never seeds chrome-extension:// or about: URLs.
 */
(function (global) {
  'use strict';

  const Storage = function () {
    return global.FillApplyStorage;
  };

  const NO_URLS_ERROR = 'Add job apply URLs in App Settings (Application queue)';

  function isExtensionDemoUrl(url) {
    return /^chrome-extension:\/\//i.test(String(url || ''));
  }

  function isHttpUrl(url) {
    if (Storage() && Storage().isHttpUrl) return Storage().isHttpUrl(url);
    return /^https?:\/\//i.test(String(url || ''));
  }

  function isBlockedUrl(url) {
    if (Storage() && Storage().isBlockedUrl) return Storage().isBlockedUrl(url);
    const u = String(url || '').trim();
    return !u || /^chrome-extension:/i.test(u) || /^about:/i.test(u);
  }

  function now() {
    return Date.now();
  }

  function makeJob(url, i, extra) {
    url = String(url || '').trim();
    if (!isHttpUrl(url) || isBlockedUrl(url) || isExtensionDemoUrl(url)) return null;
    let host = '';
    let pathTail = '';
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./, '');
      const parts = u.pathname.split('/').filter(Boolean);
      pathTail = parts.length ? parts[parts.length - 1] : '';
    } catch (_e) {
      return null;
    }
    const title = pathTail
      ? decodeURIComponent(pathTail).replace(/[-_]+/g, ' ').slice(0, 80)
      : 'Job ' + (i + 1);
    return Object.assign(
      {
        id: 'job-' + now() + '-' + (i + 1),
        title: title || 'Job ' + (i + 1),
        company: host || 'Mock',
        url: url,
        status: 'queued',
        attempts: 0,
        lastError: null,
        result: null,
        updatedAt: now(),
        ats: (function () {
          if (global.FillApplyTypes && global.FillApplyTypes.detectSourceId) {
            const id = global.FillApplyTypes.detectSourceId(url);
            return id === 'default' ? undefined : id;
          }
          if (/greenhouse\.io/i.test(host)) return 'greenhouse';
          if (/ashbyhq\.com/i.test(host)) return 'ashby';
          if (/lever\.co/i.test(host)) return 'lever';
          if (/indeed\.com/i.test(host)) return 'indeed';
          return undefined;
        })(),
        sourceId: (function () {
          if (global.FillApplyTypes && global.FillApplyTypes.detectSourceId) {
            return global.FillApplyTypes.detectSourceId(url);
          }
          if (/ashbyhq\.com/i.test(host)) return 'ashby';
          if (/greenhouse\.io/i.test(host)) return 'greenhouse';
          if (/lever\.co/i.test(host)) return 'lever';
          if (/indeed\.com/i.test(host)) return 'indeed';
          return 'default';
        })(),
        meta: { source: 'mock' }
      },
      extra || {}
    );
  }

  function jobsFromUrls(urls) {
    var jobs = (urls || [])
      .map(function (url, i) {
        return makeJob(url, i);
      })
      .filter(Boolean);
    if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.sortJobsBySource) {
      return global.FillApplySourceProfiles.sortJobsBySource(jobs);
    }
    return jobs;
  }

  async function getConfiguredMockUrls() {
    const S = Storage();
    if (S.getMockQueueUrls) return S.getMockQueueUrls();
    const raw = await S.get([S.KEYS.mockQueueUrls]);
    const stored = raw[S.KEYS.mockQueueUrls];
    if (S.normalizeMockUrls) return S.normalizeMockUrls(stored || []);
    return Array.isArray(stored) ? stored.filter(isHttpUrl) : [];
  }

  function sanitizeJobs(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (j) {
      return j && isHttpUrl(j.url) && !isBlockedUrl(j.url) && !isExtensionDemoUrl(j.url);
    });
  }

  async function getQueued() {
    const S = Storage();
    let queued = sanitizeJobs(await S.getBucket('queued'));

    // Migrate legacy mockQueue → queued once
    if (!queued.length && S.KEYS.mockQueue) {
      const raw = await S.get([S.KEYS.mockQueue]);
      const legacy = sanitizeJobs(raw[S.KEYS.mockQueue]);
      if (legacy.length) {
        queued = legacy.map(function (j, i) {
          return Object.assign(
            {
              status: 'queued',
              attempts: 0,
              lastError: null,
              result: null,
              updatedAt: now()
            },
            j,
            { id: j.id || 'job-migrated-' + (i + 1) }
          );
        });
        await S.setBucket('queued', queued);
        await S.set({ [S.KEYS.mockQueue]: [] });
      }
    }

    // Drop any blocked URLs that snuck in
    const clean = sanitizeJobs(queued);
    if (clean.length !== queued.length) {
      await S.setBucket('queued', clean);
      return clean;
    }
    return queued;
  }

  async function setQueued(list) {
    return Storage().setBucket('queued', sanitizeJobs(list));
  }

  async function getApplied() {
    return sanitizeJobs(await Storage().getBucket('applied'));
  }

  async function getFailed() {
    return sanitizeJobs(await Storage().getBucket('failed'));
  }

  async function getCancelled() {
    return sanitizeJobs(await Storage().getBucket('cancelled'));
  }

  async function refreshCounts() {
    const S = Storage();
    const counts = await S.getQueueCounts();
    await S.setQueueStatus({
      remaining: counts.queued,
      counts: counts
    });
    return counts;
  }

  /**
   * Rebuild queued from saved https URL list.
   * Keeps applied history by default; optionally clear failed/cancelled.
   */
  /**
   * Clear Application queue: empty the URL list + queued jobs.
   * (Previously this rebuilt queued FROM saved URLs — so Reset never cleared the textarea.)
   * Use rebuildQueuedFromUrls / Save & rebuild to reload from pasted URLs.
   */
  async function resetMockQueue(opts) {
    opts = opts || {};
    const S = Storage();
    if (S.saveMockQueueUrls) {
      await S.saveMockQueueUrls([]);
    } else if (S.KEYS && S.KEYS.mockQueueUrls) {
      await S.set({ [S.KEYS.mockQueueUrls]: [] });
    }
    await setQueued([]);
    if (S.KEYS.mockQueue) {
      await S.set({ [S.KEYS.mockQueue]: [] });
    }
    if (opts.clearFailed) await S.setBucket('failed', []);
    if (opts.clearCancelled) await S.setBucket('cancelled', []);
    if (opts.clearApplied) await S.setBucket('applied', []);
    await refreshCounts();
    return [];
  }

  /**
   * Saving URLs rebuilds queued from https/http only.
   */
  async function rebuildQueuedFromUrls(input) {
    const S = Storage();
    const urls = await S.saveMockQueueUrls(input);
    const jobs = jobsFromUrls(urls);
    await setQueued(jobs);
    if (S.KEYS.mockQueue) await S.set({ [S.KEYS.mockQueue]: [] });
    await refreshCounts();
    return { urls: urls, jobs: jobs };
  }

  async function assertMockUrlsConfigured() {
    const urls = await getConfiguredMockUrls();
    const jobs = jobsFromUrls(urls);
    if (!jobs.length) {
      const queued = await getQueued();
      if (!queued.length) throw new Error(NO_URLS_ERROR);
      return queued;
    }
    return jobs;
  }

  function enrichJobPoolPayload(payload) {
    const body = Object.assign({}, payload || {});
    if (global.FillApplyTypes && typeof global.FillApplyTypes.jobPoolOutcome === 'function') {
      body.status = body.status || global.FillApplyTypes.jobPoolOutcome(body);
      body.outcome = body.outcome || body.status;
    }
    return body;
  }

  /**
   * Normalize a live JobPool queue item so url / ats / sourceId survive into the
   * runner. Preserves unknown fields from the backend for forward compatibility.
   */
  function normalizeLiveJob(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const url = String(raw.url || raw.applyUrl || raw.link || raw.href || '').trim();
    if (!isHttpUrl(url) || isBlockedUrl(url) || isExtensionDemoUrl(url)) return null;

    let sourceId =
      raw.sourceId ||
      raw.source_id ||
      raw.source ||
      raw.ats ||
      undefined;
    if (global.FillApplyTypes && typeof global.FillApplyTypes.detectSourceId === 'function') {
      sourceId = global.FillApplyTypes.detectSourceId(url, {
        sourceId: sourceId,
        ats: raw.ats
      });
    }
    const ats =
      raw.ats ||
      (sourceId && String(sourceId).toLowerCase() !== 'default' ? sourceId : undefined);

    const id =
      raw.id != null && String(raw.id).trim()
        ? String(raw.id).trim()
        : 'job-live-' + now() + '-' + ((index != null ? index : 0) + 1);

    return Object.assign({}, raw, {
      id: id,
      title: raw.title || raw.jobTitle || raw.name || 'Job',
      company: raw.company || raw.employer || raw.companyName || '',
      url: url,
      status: raw.status || 'queued',
      attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
      lastError: raw.lastError != null ? raw.lastError : null,
      result: raw.result != null ? raw.result : null,
      updatedAt: raw.updatedAt || now(),
      ats: ats,
      sourceId: sourceId || 'default',
      meta: Object.assign({ source: 'jobpool' }, raw.meta || {})
    });
  }

  function normalizeLiveQueue(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (j, i) {
        return normalizeLiveJob(j, i);
      })
      .filter(Boolean);
  }

  function looksLikeHtmlBody(text) {
    var t = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!t) return false;
    return (
      t.charAt(0) === '<' ||
      /^<!DOCTYPE/i.test(t) ||
      /^<html[\s>]/i.test(t) ||
      /^<head[\s>]/i.test(t) ||
      /^<body[\s>]/i.test(t)
    );
  }

  /**
   * Fetch JSON from JobPool/backend. Never throw raw JSON.parse errors when the
   * server returns an HTML SPA shell (common for /queue without auth).
   */
  async function apiFetch(path, options) {
    const config = await Storage().getRunConfig();
    const base = config.backendBaseUrl;
    if (!base) throw new Error('backendBaseUrl is empty');
    const url = base.replace(/\/$/, '') + path;
    const opts = Object.assign({ method: 'GET' }, options || {});
    opts.headers = Object.assign(
      { Accept: 'application/json', 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    const res = await fetch(url, opts);
    if (res.status === 204) return null;
    const rawText = await res.text().catch(function () {
      return '';
    });
    if (!res.ok) {
      var snippet = looksLikeHtmlBody(rawText) ? '(HTML page)' : String(rawText || '').slice(0, 200);
      throw new Error('HTTP ' + res.status + (snippet ? ': ' + snippet : ''));
    }
    if (!rawText || !String(rawText).trim()) return null;
    if (looksLikeHtmlBody(rawText)) {
      throw new Error(
        'JobPool returned HTML instead of JSON for ' +
          path +
          ' (sign in, or use Applications scrape / Load from JobPool)'
      );
    }
    var ct = '';
    try {
      ct = String(res.headers && res.headers.get && res.headers.get('content-type') || '');
    } catch (_ct) {}
    if (ct && /text\/html/i.test(ct) && !/json/i.test(ct)) {
      throw new Error('JobPool returned HTML content-type for ' + path);
    }
    try {
      return JSON.parse(rawText);
    } catch (e) {
      throw new Error(
        'JobPool JSON parse failed for ' +
          path +
          ': ' +
          (e && e.message ? e.message : e) +
          ' (body starts with ' +
          JSON.stringify(String(rawText).slice(0, 40)) +
          ')'
      );
    }
  }

  async function getQueue() {
    const config = await Storage().getRunConfig();
    if (config.mockMode || !config.backendBaseUrl) {
      return getQueued();
    }
    try {
      const data = await apiFetch('/queue');
      const list = Array.isArray(data) ? data : data && data.jobs ? data.jobs : [];
      return normalizeLiveQueue(list);
    } catch (_eLive) {
      // Live /queue often returns the SPA HTML when unauthenticated — use local bucket.
      return getQueued();
    }
  }

  /**
   * Peek + reserve next job from queued only.
   * Does not remove until markApplied / markFailed / markCancelled.
   * Returns null when empty.
   */
  async function takeLocalQueuedJob() {
    const queued = await getQueued();
    if (!queued.length) return null;
    const job = queued[0];
    if (isBlockedUrl(job.url) || isExtensionDemoUrl(job.url)) {
      await setQueued(queued.slice(1));
      await moveToBucket(
        'failed',
        Object.assign({}, job, {
          status: 'failed',
          lastError: 'Blocked URL (chrome-extension/about not allowed)',
          updatedAt: now()
        })
      );
      return takeLocalQueuedJob();
    }
    return job;
  }

  async function getNextJob() {
    const config = await Storage().getRunConfig();
    if (config.mockMode || !config.backendBaseUrl) {
      const job = await takeLocalQueuedJob();
      if (!job) {
        const urls = await getConfiguredMockUrls();
        if (!jobsFromUrls(urls).length) {
          throw new Error(NO_URLS_ERROR);
        }
        return null;
      }
      return job;
    }
    // Prefer jobs already loaded into the local queue (Load from JobPool / scrape).
    const localFirst = await takeLocalQueuedJob();
    if (localFirst) return localFirst;

    try {
      const data = await apiFetch('/queue/next');
      const raw = data && data.id ? data : data && data.job ? data.job : null;
      return raw ? normalizeLiveJob(raw, 0) : null;
    } catch (e) {
      // /queue/next often 404s HTML on JobPool — use /queue or local bucket, never throw HTML.
      try {
        const queue = await getQueue();
        if (queue && queue[0]) return queue[0];
      } catch (_q) {}
      const again = await takeLocalQueuedJob();
      if (again) return again;
      throw new Error(
        'JobPool queue empty or API unavailable. Open Applications, click Load from JobPool, then Start.'
      );
    }
  }

  async function removeFromQueued(jobId) {
    const queued = await getQueued();
    const next = queued.filter(function (j) {
      return j.id !== jobId;
    });
    await setQueued(next);
    return next;
  }

  async function moveToBucket(bucketName, job) {
    const S = Storage();
    const list = await S.getBucket(bucketName);
    // Dedupe by id
    const filtered = list.filter(function (j) {
      return j.id !== job.id;
    });
    filtered.push(job);
    await S.setBucket(bucketName, filtered);
    return filtered;
  }

  /**
   * Successfully processed per current runMode → applied.
   * Removes from queued so the same URL will not reappear until re-queued.
   */
  async function findInBuckets(jobId) {
    const [queued, applied, failed, cancelled] = await Promise.all([
      getQueued(),
      getApplied(),
      getFailed(),
      getCancelled()
    ]);
    const hit = function (list, name) {
      const j = list.find(function (x) { return x.id === jobId; });
      return j ? { bucket: name, job: j } : null;
    };
    return hit(queued, 'queued') || hit(cancelled, 'cancelled') || hit(applied, 'applied') || hit(failed, 'failed') || null;
  }

  async function markApplied(jobId, payload) {
    payload = enrichJobPoolPayload(payload);
    payload.jobId = payload.jobId || jobId;
    const config = await Storage().getRunConfig();
    if (config.mockMode || !config.backendBaseUrl) {
      const existing = await findInBuckets(jobId);
      // Do not overwrite a Stop-cancelled job
      if (existing && existing.bucket === 'cancelled') {
        const counts = await refreshCounts();
        return { ok: true, mock: true, bucket: 'cancelled', skipped: true, remaining: counts.queued, counts: counts };
      }
      const queued = await getQueued();
      const job = (existing && existing.job) || queued.find(function (j) {
        return j.id === jobId;
      }) || { id: jobId, url: (payload && payload.url) || '' };

      await removeFromQueued(jobId);

      if (payload && payload.failed) {
        const failedJob = Object.assign({}, job, {
          status: 'failed',
          jobPoolStatus: payload.status || 'failed',
          attempts: (job.attempts || 0) + 1,
          lastError: (payload && payload.error) || 'failed',
          result: payload || null,
          updatedAt: now()
        });
        await moveToBucket('failed', failedJob);
        await Storage().appendSessionLog({
          type: 'markFailed',
          jobId: jobId,
          payload: payload || {},
          mock: true
        });
        const counts = await refreshCounts();
        return { ok: true, mock: true, bucket: 'failed', status: payload.status || 'failed', remaining: counts.queued, counts: counts };
      }

      const appliedJob = Object.assign({}, job, {
        status: 'applied',
        jobPoolStatus: payload.status || 'processed',
        attempts: (job.attempts || 0) + 1,
        lastError: null,
        result: payload || null,
        updatedAt: now()
      });
      await moveToBucket('applied', appliedJob);
      await Storage().appendSessionLog({
        type: 'markApplied',
        jobId: jobId,
        payload: payload || {},
        status: payload.status || 'processed',
        mock: true
      });
      const counts = await refreshCounts();
      return { ok: true, mock: true, bucket: 'applied', status: payload.status || 'processed', remaining: counts.queued, counts: counts };
    }
    return apiFetch('/applied/' + encodeURIComponent(jobId), {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  }

  async function markFailed(jobId, error, payload) {
    return markApplied(jobId, Object.assign({}, payload || {}, { failed: true, error: error || 'failed' }));
  }

  /**
   * On Stop: current incomplete job → cancelled; remaining stay queued.
   */
  async function markCancelled(jobId, reason) {
    const config = await Storage().getRunConfig();
    const queued = await getQueued();
    const job = queued.find(function (j) {
      return j.id === jobId;
    });
    const body = {
      job: job || { id: jobId },
      jobId: jobId,
      reason: reason || 'Stopped by user',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled: true,
      ok: false
    };

    if (job) {
      await removeFromQueued(jobId);
      const cancelledJob = Object.assign({}, job, {
        status: 'cancelled',
        jobPoolStatus: 'cancelled',
        lastError: reason || 'Stopped by user',
        result: body,
        updatedAt: now()
      });
      await moveToBucket('cancelled', cancelledJob);
      await Storage().appendSessionLog({
        type: 'markCancelled',
        jobId: jobId,
        reason: reason || 'Stopped by user',
        status: 'cancelled'
      });
    }

    const counts = await refreshCounts();

    if (!config.mockMode && config.backendBaseUrl) {
      try {
        await apiFetch('/cancelled/' + encodeURIComponent(jobId), {
          method: 'POST',
          body: JSON.stringify(body)
        });
      } catch (_err) {
        // Original live contract was POST /applied/:id only. JobPool may not
        // have /cancelled yet — still report cancelled so status is not Applied.
        await apiFetch('/applied/' + encodeURIComponent(jobId), {
          method: 'POST',
          body: JSON.stringify(body)
        });
      }
    }

    if (!job) {
      return { ok: true, remaining: counts.queued, counts: counts, status: 'cancelled' };
    }
    return { ok: true, bucket: 'cancelled', remaining: counts.queued, counts: counts, status: 'cancelled' };
  }

  async function getProfileFromBackend() {
    const config = await Storage().getRunConfig();
    if (config.mockMode || !config.backendBaseUrl) {
      if (global.FillApplyProfile) return global.FillApplyProfile.getProfile();
      return null;
    }
    return apiFetch('/profile');
  }

  async function getDocumentsFromBackend() {
    const config = await Storage().getRunConfig();
    if (config.mockMode || !config.backendBaseUrl) {
      return Storage().getDocuments();
    }
    return apiFetch('/documents');
  }

  async function getBucketsSnapshot() {
    const [queued, applied, failed, cancelled] = await Promise.all([
      getQueued(),
      getApplied(),
      getFailed(),
      getCancelled()
    ]);
    return {
      queued: queued,
      applied: applied,
      failed: failed,
      cancelled: cancelled,
      counts: {
        queued: queued.length,
        applied: applied.length,
        failed: failed.length,
        cancelled: cancelled.length
      }
    };
  }


  /**
   * Point live config at JobPool and pull Ready-to-apply jobs via /queue
   * (or /api/queue). Returns { jobs, source, baseUrl }. Caller may scrape UI if empty.
   */
  async function loadJobsFromJobPool(opts) {
    opts = opts || {};
    const Types = global.FillApplyTypes || {};
    const base = String(
      opts.baseUrl ||
        Types.JOBPOOL_DEFAULT_BASE_URL ||
        'https://zahid-jobpool.vercel.app'
    ).replace(/\/$/, '');
    const S = Storage();
    const prev = await S.getRunConfig();
    await S.saveRunConfig(
      Object.assign({}, prev, {
        backendBaseUrl: base,
        mockMode: false
      })
    );

    const paths = ['/queue', '/api/queue', '/api/applications?status=ready'];
    let lastErr = null;
    for (let i = 0; i < paths.length; i++) {
      try {
        const data = await apiFetch(paths[i]);
        let list = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.jobs)) list = data.jobs;
        else if (data && Array.isArray(data.applications)) list = data.applications;
        else if (data && Array.isArray(data.items)) list = data.items;
        const jobs = normalizeLiveQueue(list);
        if (jobs.length) {
          await setQueued(jobs);
          await refreshCounts();
          return { jobs: jobs, source: 'api:' + paths[i], baseUrl: base };
        }
      } catch (e) {
        lastErr = e;
      }
    }
    return {
      jobs: [],
      source: 'api-empty',
      baseUrl: base,
      error: lastErr ? String(lastErr.message || lastErr) : null
    };
  }

  global.FillApplyBackend = {
    jobsFromUrls,
    loadJobsFromJobPool,
    normalizeLiveJob,
    normalizeLiveQueue,
    NO_URLS_ERROR,
    getQueue,
    getNextJob,
    markApplied,
    markFailed,
    markCancelled,
    resetMockQueue,
    rebuildQueuedFromUrls,
    assertMockUrlsConfigured,
    getConfiguredMockUrls,
    getQueued,
    setQueued,
    getApplied,
    getFailed,
    getCancelled,
    getBucketsSnapshot,
    refreshCounts,
    getProfile: getProfileFromBackend,
    getDocuments: getDocumentsFromBackend
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
