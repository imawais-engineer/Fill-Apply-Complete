/**
 * Shared shape documentation + constants for Fill & Apply.
 * Vanilla JS — types are JSDoc / runtime constants only (no TypeScript).
 *
 * Job:        { id, title, company, url, status, attempts, lastError?, result?,
 *               updatedAt, ats?, sourceId?, meta?, needsAttention? }
 * Profile:    multi-profile via fillApply.profiles + fillApply.activeProfileId;
 *             see FillApplyProfile.DEFAULT_PROFILE (phoneCountry, postcode, street, customAnswers)
 * Adapter:    { id, name, detect(url, document), fieldMaps?, submitSelector?,
 *               fileInputHints?, fill?(ctx) }
 * FillResult: { ok, adapterId, filled, unmatched, total, filesAttached?,
 *               resumeAttached?, coverAttached?, submitted?, advanced?,
 *               needsHuman?, challenge?, pauseReason?, inspection?, details?, error? }
 * RunConfig:  { delayMs, runMode, mockMode, backendBaseUrl, autoCloseAppliedTab,
 *               keepRecentTabs, autoPdfReport, sourceApplyLimits, preferIndeedApply,
 *               actionDelayMinMs, actionDelayMaxMs, focusHud }
 *   runMode:  'register' | 'fill' | 'navigate' | 'ready' | 'submit' | 'auto_apply'
 *   auto_apply: Auto Apply E2E — JobPool → auth → fill → navigate → submit →
 *               back to JobPool with exactly one of: applied | blocked | error.
 *               No human pauses; blockers mark Blocked + continue next job.
 *   sourceApplyLimits: { ashby, indeed, greenhouse, lever, default } — each 1–3 (hard max 3)
 *   actionDelayMinMs/MaxMs: anti-flag pacing between actions (default 400–900)
 *   focusHud: outline+scroll current field (also fillApply.config.focusHud, default true)
 * DocumentBlob: { name, mime, base64 }
 * Queues:     queued | applied | failed | cancelled
 * JobPool:    GET /queue + /queue/next; POST /applied/:id { status }; POST /cancelled/:id
 *             status: failed | cancelled | submitted | ready | filled | processed
 *             Only `submitted` means the employer received the application
 * Reports:    fillApply.reports — audit trail for submitted applications
 * ApplyHist:  fillApply.applyHistory — { sourceId, jobUrl, jobId, submittedAt }[]
 * SourceProf: fillApply.sourceProfiles + fillApply.selectedSourceId — per-ATS compulsory answers + Start gate
 * AtsAuth:    fillApply.atsAccounts — per-host ATS auth state (no passwords/tokens)
 * JobPoolHub: fillApply.jobpoolPendingMark — { jobId, title?, clickedAt, hubUrl? } after hub Apply
 * Pause:      pausedForHuman — Cloudflare/CAPTCHA / auth-wall / form structure drift
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    profile: 'fillApply.profile',
    profiles: 'fillApply.profiles',
    activeProfileId: 'fillApply.activeProfileId',
    runConfig: 'fillApply.runConfig',
    running: 'fillApply.running',
    pausedForHuman: 'fillApply.pausedForHuman',
    sessionLog: 'fillApply.sessionLog',
    documents: 'fillApply.documents',
    queueStatus: 'fillApply.queueStatus',
    mockQueue: 'fillApply.mockQueue',
    mockQueueUrls: 'fillApply.mockQueueUrls',
    queued: 'fillApply.queued',
    applied: 'fillApply.applied',
    failed: 'fillApply.failed',
    cancelled: 'fillApply.cancelled',
    reports: 'fillApply.reports',
    applyHistory: 'fillApply.applyHistory',
    pauseState: 'fillApply.pauseState',
    uiConfig: 'fillApply.config',
    sourceProfiles: 'fillApply.sourceProfiles',
    selectedSourceId: 'fillApply.selectedSourceId',
    atsAccounts: 'fillApply.atsAccounts',
    jobpoolPendingMark: 'fillApply.jobpoolPendingMark'
  };

  const RUN_MODES = ['register', 'fill', 'navigate', 'ready', 'submit', 'auto_apply'];

  /** Auto Apply E2E — exactly three terminal statuses posted to JobPool. */
  const AUTO_APPLY_STATUSES = ['applied', 'blocked', 'error'];

  /**
   * Map a fill result / mark payload to one of the three Auto Apply statuses.
   *  - applied: employer application was actually submitted
   *  - blocked: page-level gate a human must clear (CAPTCHA, auth wall,
   *    missing profile field, documents) — job is logged for human review
   *  - error:   our automation failed (form drift, no adapter, exceptions)
   * Anything unknown fails safe to 'error' (never silently 'applied').
   */
  function autoApplyStatus(result) {
    if (!result) return 'error';
    var inner = result.fillResult && typeof result.fillResult === 'object' ? result.fillResult : null;
    if (result.submitted || (inner && inner.submitted)) return 'applied';
    if (result.cancelled || result.status === 'cancelled') return 'blocked';

    var reason = String(
      (result && result.pauseReason) ||
        (inner && inner.pauseReason) ||
        ''
    );
    var challenge = result.challenge || (inner && inner.challenge) || null;
    var errText = String(
      (result && result.error) ||
        (inner && inner.error) ||
        ''
    );

    // Human-gate conditions → Blocked (logged for review, batch continues)
    if (reason === 'challenge' || reason === 'ats_auth' || reason === 'documents') return 'blocked';
    if (reason === 'missing_profile_field') return 'blocked';
    if (challenge && challenge.challenged) return 'blocked';
    if (
      /cloudflare|captcha|verify you are human|sign in|log in|login|register|create a login|authentication required/i.test(
        errText
      )
    ) {
      return 'blocked';
    }

    // Cancelled-by-user while auto apply owns the loop → Blocked, not Error
    if (result.failed === true && result.cancelledByUser) return 'blocked';

    return 'error';
  }

  /** Explicit terminal outcomes — no infinite RUNNING. */
  const RUN_TERMINALS = [
    'COMPLETE',
    'READY',
    'WAITING_FOR_USER',
    'MISSING_INFORMATION',
    'BLOCKED',
    'AUTH_REQUIRED',
    'AMBIGUOUS',
    'TIMEOUT'
  ];

  /** ~10s no-progress plateau (not absolute lifetime). */
  const PROGRESS_PLATEAU_MS = 10000;

  /** Hard ceiling for any per-source apply cap (Ashby publishes 3/60 days). */
  const SOURCE_APPLY_HARD_CAP = 3;

  /** Default rolling window (ms) for counting submitted applies per source. */
  const SOURCE_APPLY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

  /** Ashby same-role re-apply soft block window. */
  const ASHBY_SAME_ROLE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

  /** Default JobPool hub (Intelligent Opportunity Hub). */
  var JOBPOOL_DEFAULT_BASE_URL = 'https://zahid-jobpool.vercel.app';
  var JOBPOOL_APPLICATIONS_URL = JOBPOOL_DEFAULT_BASE_URL + '/applications';

  const DEFAULT_SOURCE_APPLY_LIMITS = {
    ashby: 2,
    indeed: 2,
    greenhouse: 2,
    lever: 2,
    default: 2
  };

  const DEFAULT_RUN_CONFIG = {
    delayMs: 3000,
    runMode: 'fill',
    autoSubmit: false,
    mockMode: true,
    backendBaseUrl: 'https://zahid-jobpool.vercel.app',
    autoCloseAppliedTab: true,
    keepRecentTabs: 5,
    autoPdfReport: true,
    sourceApplyLimits: Object.assign({}, DEFAULT_SOURCE_APPLY_LIMITS),
    /** Recruitee (and similar): prefer Apply with Indeed when CTA present. */
    preferIndeedApply: true,
    /** Random delay between in-page actions (ms). */
    actionDelayMinMs: 400,
    actionDelayMaxMs: 900,
    /** Outline + scroll current field/CTA (content/focus-hud.js). */
    focusHud: true
  };

  const MSG = {
    PING: 'FILL_APPLY_PING',
    START: 'FILL_APPLY_START',
    STOP: 'FILL_APPLY_STOP',
    RESUME: 'FILL_APPLY_RESUME',
    STATUS: 'FILL_APPLY_STATUS',
    FILL_ONCE: 'FILL_APPLY_FILL_ONCE',
    AUTO_APPLY_START: 'FILL_APPLY_AUTO_APPLY_START',
    PAGE_PANEL_STATUS: 'FILL_APPLY_PAGE_PANEL_STATUS',
    LOG_UPDATED: 'FILL_APPLY_LOG_UPDATED',
    GET_REPORTS: 'FILL_APPLY_GET_REPORTS',
    GET_LAST_REPORT: 'FILL_APPLY_GET_LAST_REPORT',
    MISSING_FIELDS: 'FILL_APPLY_MISSING_FIELDS',
    KNOWLEDGE_LEARN: 'FILL_APPLY_KNOWLEDGE_LEARN',
    KNOWLEDGE_SNAPSHOT: 'FILL_APPLY_KNOWLEDGE_SNAPSHOT',
    KNOWLEDGE_LIST: 'FILL_APPLY_KNOWLEDGE_LIST',
    KNOWLEDGE_UPSERT: 'FILL_APPLY_KNOWLEDGE_UPSERT',
    KNOWLEDGE_DELETE: 'FILL_APPLY_KNOWLEDGE_DELETE',
    KNOWLEDGE_EVENTS: 'FILL_APPLY_KNOWLEDGE_EVENTS',
    KNOWLEDGE_SETTINGS: 'FILL_APPLY_KNOWLEDGE_SETTINGS',
    KNOWLEDGE_CONFLICTS: 'FILL_APPLY_KNOWLEDGE_CONFLICTS',
    KNOWLEDGE_RESOLVE_CONFLICT: 'FILL_APPLY_KNOWLEDGE_RESOLVE_CONFLICT'
  };

  const JOB_STATUS = {
    queued: 'queued',
    applied: 'applied',
    failed: 'failed',
    cancelled: 'cancelled',
    waiting_human: 'waiting_human'
  };

  /** Status values posted to JobPool. Only `submitted` is an employer apply. */
  const JOB_POOL_OUTCOMES = ['failed', 'cancelled', 'submitted', 'ready', 'filled', 'processed'];

  function normalizeRunMode(cfg) {
    cfg = cfg || {};
    if (cfg.runMode && RUN_MODES.indexOf(cfg.runMode) !== -1) return cfg.runMode;
    if (cfg.autoSubmit === true) return 'submit';
    return 'fill';
  }

  function clampSourceLimit(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 2;
    return Math.min(SOURCE_APPLY_HARD_CAP, Math.max(1, Math.round(v)));
  }

  function normalizeSourceApplyLimits(raw) {
    const base = Object.assign({}, DEFAULT_SOURCE_APPLY_LIMITS);
    if (!raw || typeof raw !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (raw[k] != null) base[k] = clampSourceLimit(raw[k]);
    });
    // Allow extra source keys the user may add, still clamped
    Object.keys(raw).forEach(function (k) {
      if (base[k] == null) base[k] = clampSourceLimit(raw[k]);
    });
    return base;
  }

  /**
   * Detect ATS/board source id from a job URL (and optional job.ats / job.sourceId).
   */
  function detectSourceId(url, job) {
    if (job && job.sourceId) return String(job.sourceId).toLowerCase();
    if (job && job.ats) return String(job.ats).toLowerCase();
    var host = '';
    try {
      host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_e) {
      host = String(url || '').toLowerCase();
    }
    if (/ashbyhq\.com/.test(host)) return 'ashby';
    if (/greenhouse\.io/.test(host)) return 'greenhouse';
    if (/lever\.co/.test(host)) return 'lever';
    if (/(^|\.)indeed\.com$/.test(host) || /indeed\.com/.test(host)) return 'indeed';
    if (/workable\.com/.test(host)) return 'workable';
    if (/myworkdayjobs\.com|workdayjobs\.com|workday\.com/.test(host)) return 'workday';
    if (/smartrecruiters\.com/.test(host)) return 'smartrecruiters';
    if (/icims\.com/.test(host)) return 'icims';
    if (/linkedin\.com/.test(host)) return 'linkedin';
    if (/(^|\.)teamtailor\.com$/.test(host) || /teamtailor\.com/.test(host)) return 'teamtailor';
    if (/naukrigulf\.com/.test(host)) return 'naukrigulf';
    if (/swooped\.co/.test(host)) return 'swooped';
    if (/jooble\.org/.test(host)) return 'jooble';
    if (/catsone\.com/.test(host)) return 'cats';
    if (/(^|\.)recruitee\.com$/.test(host) || /recruitee\.com/.test(host)) return 'recruitee';
    if (/efinancialcareers\.com/.test(host)) return 'efinancialcareers';
    return 'default';
  }

  /**
   * Status the JobPool website should persist after a run.
   * Accepts a FillResult or a runner markApplied payload (`fillResult` nested).
   * Only `submitted` means the employer application was sent.
   * fill / ready successes are still successful runs, but they must not
   * flip JobPool to Applied.
   *
   * @param {object} result
   * @returns {'failed'|'cancelled'|'submitted'|'ready'|'filled'|'processed'}
   */
  function jobPoolOutcome(result) {
    if (!result) return 'failed';
    if (result.cancelled || result.status === 'cancelled') return 'cancelled';
    if (result.failed === true) return 'failed';
    var inner = result.fillResult && typeof result.fillResult === 'object' ? result.fillResult : null;
    if (inner && (inner.cancelled || inner.status === 'cancelled')) return 'cancelled';
    if (result.ok === false) return 'failed';
    if (inner && inner.ok === false) return 'failed';
    if (result.submitted || (inner && inner.submitted)) return 'submitted';
    if (
      result.continued ||
      result.advanced ||
      (inner && (inner.continued || inner.advanced))
    ) {
      return 'ready';
    }
    var filled = result.filled;
    if (filled == null && inner) filled = inner.filled;
    if (Number(filled) > 0) return 'filled';
    if (result.ok === true || (inner && inner.ok === true)) return 'processed';
    return 'failed';
  }

  function normalizeJobUrl(url) {
    try {
      var u = new URL(String(url || ''));
      u.hash = '';
      // Drop common tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gh_src'].forEach(
        function (p) {
          u.searchParams.delete(p);
        }
      );
      return u.origin + u.pathname.replace(/\/$/, '') + (u.search || '');
    } catch (_e) {
      return String(url || '').trim().replace(/\/$/, '');
    }
  }

  global.FillApplyTypes = {
    STORAGE_KEYS,
    JOBPOOL_DEFAULT_BASE_URL,
    JOBPOOL_APPLICATIONS_URL,
    DEFAULT_RUN_CONFIG,
    DEFAULT_SOURCE_APPLY_LIMITS,
    SOURCE_APPLY_HARD_CAP,
    SOURCE_APPLY_WINDOW_MS,
    ASHBY_SAME_ROLE_WINDOW_MS,
    RUN_MODES,
    RUN_TERMINALS,
    AUTO_APPLY_STATUSES,
    autoApplyStatus,
    PROGRESS_PLATEAU_MS,
    MSG,
    JOB_STATUS,
    JOB_POOL_OUTCOMES,
    jobPoolOutcome,
    normalizeRunMode,
    clampSourceLimit,
    normalizeSourceApplyLimits,
    detectSourceId,
    normalizeJobUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
