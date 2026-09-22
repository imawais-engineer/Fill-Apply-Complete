/**
 * Cross-site label / CTA synonyms for adaptive fill.
 * Same candidate profile; boards rename the same actions (Resume≈CV, Apply≈Apply Now).
 * Attaches globalThis.FillApplySynonyms.
 */
(function (global) {
  'use strict';

  /**
   * Broad Apply / Submit Application labels (open OR final submit — same wording on many sites).
   * Easy Apply is LinkedIn-specific: board adapters own it; generic start helpers exclude it.
   */
  var APPLY_CTA =
    /\b(apply\s*now|start\s*apply|start\s*application|apply\s*for\s*this\s*(job|role|position)|apply\s*to\s*this\s*(job|role)|apply\s*here|submit\s*(&|and)\s*apply|submit\s*application|submit\s*your\s*application|send\s*application|complete\s*application|easy\s*apply|apply)\b/i;

  /** Labels that usually open an application from a job overview (not “Submit Application”). */
  var APPLY_START_CTA =
    /\b(apply\s*now|start\s*apply|start\s*application|apply\s*for\s*this\s*(job|role|position)|apply\s*to\s*this\s*(job|role)|apply\s*here|apply)\b/i;

  /** Labels that usually mean final submit on an already-open form. */
  var FINAL_SUBMIT_CTA =
    /\b(submit\s*(&|and)\s*apply|submit\s*application|submit\s*your\s*application|send\s*application|complete\s*application)\b/i;

  var CONTINUE_CTA =
    /\b(next(\s*step)?|continue|save\s*(&|and)\s*continue|save\s*and\s*next|proceed|review\s*and\s*continue)\b/i;

  /** Stable extension hooks JobPool (or any host) can stamp on CTAs. */
  var DATA_FILL_APPLY_ATTR = 'data-fill-apply';
  var DATA_APPLY_START = 'apply-start';
  var DATA_CONTINUE = 'continue';
  var DATA_SUBMIT = 'submit';
  /** JobPool Applications hub stamps (Cursor / JobPool UI). */
  var DATA_JOBPOOL_APPLY = 'jobpool-apply';
  var DATA_JOBPOOL_MARK_APPLIED = 'jobpool-mark-applied';

  /** Hub "Mark as applied" CTA — never treat as Apply-start. */
  var MARK_APPLIED_CTA = /^mark\s*as\s*applied$/i;

  /**
   * Employer thank-you / submit-success copy that often precedes a JobPool return.
   * Case-insensitive; used with JobPool return URL markers before Mark as applied.
   */
  var SUBMIT_SUCCESS_TEXT =
    /application(\s+has\s+been)?\s+submitted|successfully\s+applied|thank\s+you\s+for(\s+your)?\s+application|application\s+received|we\s+have\s+received\s+your\s+application|your\s+application\s+was\s+sent/i;

  var RESUME_FILE =
    /\b(resume|cv|c\.v\.|curriculum\s*vitae|upload\s*resume|upload\s*cv|attach\s*resume|attach\s*cv|upload\s*file|choose\s*file|browse\s*(files?)?|select\s*(a\s*)?(resume|cv|file)|drop\s*(your\s*)?(resume|cv|file)|resume\s*\/?\s*cv)\b|^cv\s*\*?$/i;

  var COVER_FILE =
    /\b(cover\s*letter|covering\s*letter|motivation\s*letter|letter\s*of\s*interest|cover)\b/i;

  var ATTACH_ACTION =
    /\b(attach|upload|browse|drop\s*files|choose\s*file|select\s*file|add\s*file)\b/i;

  /** Paid / upsell / AI auto-apply chrome — never treat as Apply-start. */
  var EXCLUDED_APPLY_CTA =
    /\b(ai\s*auto[- ]?apply|auto[- ]?apply\s*with\s*ai|auto[- ]?apply|upgrade|subscribe|pricing|premium|share(\s*job)?|save\s*job|bookmark|tailor\s*my\s*resume|post\s*a\s*job|hire\s*(talent|now)?|mark\s*as\s*applied)\b/i;

  /** Sources that typically need a logged-in / complete profile before apply works well. */
  var ACCOUNT_PROFILE_FIRST = [
    'naukrigulf',
    'linkedin',
    'indeed',
    'upwork',
    'bayt',
    'gulftalent',
    'glassdoor',
    'wellfound',
    'angellist',
    'weworkremotely',
    'remoteok',
    'flexjobs'
  ];

  var PAID_SOURCES = ['remoteok', 'weworkremotely', 'flexjobs'];

  /** Min visible application-like inputs before we treat the form as open. */
  var MIN_OPEN_FORM_FIELDS = 2;

  function buttonText(el) {
    if (!el) return '';
    // Do NOT append className — Tailwind/shadcn class strings (group/button …)
    // polluted Apply labels and broke /^apply$/ JobPool matching.
    return (
      (el.innerText || el.textContent || '') +
      ' ' +
      (el.value || '') +
      ' ' +
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('title') || '') +
      ' ' +
      (el.id || '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function dom() {
    return global.FillApplyDom || null;
  }

  /** Deep query (shadow roots + same-origin frames) with a flat-DOM fallback. */
  function queryAllDeep(selector, root) {
    var D = dom();
    if (D && D.queryAll) return D.queryAll(selector, root);
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root || !root.querySelectorAll) return [];
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch (_e) {
      return [];
    }
  }

  function isVisible(el) {
    var D = dom();
    if (D && D.isVisible) return D.isVisible(el);
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var st = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(el)
        : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) {
        return false;
      }
      return true;
    } catch (_e) {
      return true;
    }
  }

  function isExcludedApplyCta(text) {
    return EXCLUDED_APPLY_CTA.test(String(text || ''));
  }

  function dataFillApplyRole(el) {
    if (!el || !el.getAttribute) return '';
    try {
      return String(el.getAttribute(DATA_FILL_APPLY_ATTR) || '')
        .trim()
        .toLowerCase();
    } catch (_e) {
      return '';
    }
  }

  function hasDataFillApply(el, role) {
    return dataFillApplyRole(el) === String(role || '').toLowerCase();
  }

  function isApplyCta(text) {
    var t = String(text || '');
    if (!t || isExcludedApplyCta(t)) return false;
    return APPLY_CTA.test(t);
  }

  function isFinalSubmitCta(text) {
    var t = String(text || '');
    if (!t || isExcludedApplyCta(t)) return false;
    return FINAL_SUBMIT_CTA.test(t);
  }

  /**
   * Apply-start CTAs (open form). Excludes Easy Apply (LinkedIn adapter owns it),
   * Auto-Apply / Upgrade / Subscribe / Share / Save job, and pure final-submit labels
   * when they don't also look like start wording.
   */
  function isEasyApplyCta(text) {
    var t = String(text || '');
    if (!t || isExcludedApplyCta(t)) return false;
    return /\beasy\s*apply\b/i.test(t);
  }

  function isApplyStartCta(text) {
    var t = String(text || '');
    if (!t || isExcludedApplyCta(t)) return false;
    // LinkedIn Easy Apply — board adapter owns this path; generic start excludes it
    if (isEasyApplyCta(t)) return false;
    if (APPLY_START_CTA.test(t)) return true;
    // Same label used for open + submit on many sites ("Apply")
    if (APPLY_CTA.test(t) && !isFinalSubmitCta(t)) return true;
    return false;
  }

  /**
   * Host-aware Apply-start: Glassdoor/Indeed treat Easy Apply as a valid start CTA
   * (their board adapters also use findEasyApplyButton). Other hosts keep Easy Apply excluded.
   */
  function isApplyStartCtaForHost(text, host) {
    var h = String(host || '').toLowerCase();
    // Boards that surface Easy Apply as a primary start CTA
    if (/glassdoor\.com|indeed\.com|naukrigulf\.com/.test(h) && isEasyApplyCta(text)) return true;
    return isApplyStartCta(text);
  }

  function isContinueCta(text) {
    var t = String(text || '');
    if (!t || isExcludedApplyCta(t)) return false;
    // Bare Review / Review application advance wizards; final submit stays separate.
    if (/^review(\s+application)?$/i.test(t.replace(/\s+/g, ' ').trim())) return true;
    if (isApplyCta(t) && !CONTINUE_CTA.test(t)) return false;
    return CONTINUE_CTA.test(t);
  }

  function isSubmitDataCta(el) {
    return hasDataFillApply(el, DATA_SUBMIT);
  }

  function isContinueDataCta(el) {
    return hasDataFillApply(el, DATA_CONTINUE);
  }

  function isApplyStartDataCta(el) {
    return hasDataFillApply(el, DATA_APPLY_START);
  }

  function isResumeLabel(text) {
    return RESUME_FILE.test(String(text || ''));
  }

  function isCoverLabel(text) {
    return COVER_FILE.test(String(text || ''));
  }

  function scoreApplyStartText(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (!t || !isApplyStartCta(t)) return 0;
    if (/^apply now$/i.test(t)) return 100;
    if (/^start\s*apply$/i.test(t)) return 98;
    if (/start\s*application/i.test(t)) return 96;
    if (/apply for this job/i.test(t)) return 95;
    if (/apply for this role/i.test(t)) return 94;
    if (/apply for this position/i.test(t)) return 93;
    if (/apply here/i.test(t)) return 90;
    if (/^apply$/i.test(t) && t.length < 12) return 85;
    if (/\bapply now\b/i.test(t)) return 80;
    if (/\bapply\b/i.test(t) && t.length < 48) return 50;
    return 30;
  }

  /**
   * Visible buttons/links matching apply-start CTAs.
   * Excludes paid Auto-Apply / Upgrade / AI Auto-Apply / Subscribe / Easy Apply.
   */
  function findApplyStartButtons(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];
    var nodes = queryAllDeep(
      'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [data-fill-apply="apply-start"], [data-careersite--jobs--form-overlay-target="coverButton"], [data-action*="showFormOverlay"]',
      root
    );
    var out = [];
    var seen = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (seen.indexOf(el) !== -1) continue;
      seen.push(el);
      var markedStart = isApplyStartDataCta(el);
      if (el.disabled && !markedStart && !/floating|coverButton|showFormOverlay/i.test(
        (el.className || '') + ' ' + (el.getAttribute('data-action') || '') + ' ' + (el.getAttribute('data-careersite--jobs--form-overlay-target') || '')
      )) {
        continue;
      }
      var action = el.getAttribute('data-action') || '';
      var overlayTarget = el.getAttribute('data-careersite--jobs--form-overlay-target') || '';
      var highConfidenceOverlay =
        /showFormOverlay/i.test(action) || overlayTarget === 'coverButton';
      // Sticky / floating Teamtailor CTAs may fail a strict visible() check — still include them.
      if (!isVisible(el) && !markedStart && !highConfidenceOverlay && !/floating/i.test(el.className || '')) {
        continue;
      }
      var t = buttonText(el);
      if (isExcludedApplyCta(t)) continue;
      if (highConfidenceOverlay && (!t || !isApplyStartCta(t))) {
        // Treat overlay openers as Apply-start even with sparse text
        if (!t) t = 'Apply for this job';
      }
      // Stable JobPool / host hook wins over ambiguous text; still never paid CTAs.
      if (!markedStart && !isApplyStartCta(t) && !highConfidenceOverlay) continue;
      out.push(el);
    }
    out.sort(function (a, b) {
      var sa = scoreApplyStartText(buttonText(a));
      var sb = scoreApplyStartText(buttonText(b));
      if (isApplyStartDataCta(a)) sa += 200;
      if (isApplyStartDataCta(b)) sb += 200;
      var aa = (a.getAttribute('data-action') || '') + (a.getAttribute('data-careersite--jobs--form-overlay-target') || '');
      var bb = (b.getAttribute('data-action') || '') + (b.getAttribute('data-careersite--jobs--form-overlay-target') || '');
      if (/showFormOverlay|coverButton/i.test(bb)) sb += 20;
      if (/showFormOverlay|coverButton/i.test(aa)) sa += 20;
      return sb - sa;
    });
    return out;
  }

  /**
   * Visible Next / Continue / Review (and data-fill-apply=continue) advance CTAs.
   * Excludes final Submit and paid upsell chrome.
   */
  function findContinueButtons(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];
    var nodes = queryAllDeep(
      'a, button, input[type="button"], input[type="submit"], [role="button"], [data-fill-apply="continue"]',
      root
    );
    var out = [];
    var seen = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (seen.indexOf(el) !== -1) continue;
      seen.push(el);
      if (el.disabled) continue;
      if (!isVisible(el) && !isContinueDataCta(el)) continue;
      var t = buttonText(el);
      if (isExcludedApplyCta(t)) continue;
      if (isFinalSubmitCta(t) && !isContinueDataCta(el)) continue;
      if (isContinueDataCta(el) || isContinueCta(t)) out.push(el);
    }
    out.sort(function (a, b) {
      var sa = isContinueDataCta(a) ? 100 : 0;
      var sb = isContinueDataCta(b) ? 100 : 0;
      var ta = buttonText(a).replace(/\s+/g, ' ').trim();
      var tb = buttonText(b).replace(/\s+/g, ' ').trim();
      if (/^continue$/i.test(ta)) sa += 40;
      if (/^next(\s*step)?$/i.test(ta)) sa += 35;
      if (/^review$/i.test(ta)) sa += 30;
      if (/^continue$/i.test(tb)) sb += 40;
      if (/^next(\s*step)?$/i.test(tb)) sb += 35;
      if (/^review$/i.test(tb)) sb += 30;
      return sb - sa;
    });
    return out;
  }

  /**
   * Visible final Submit CTAs (and data-fill-apply=submit).
   */
  function findSubmitButtons(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];
    var nodes = queryAllDeep(
      'a, button, input[type="button"], input[type="submit"], [role="button"], [data-fill-apply="submit"]',
      root
    );
    var out = [];
    var seen = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (seen.indexOf(el) !== -1) continue;
      seen.push(el);
      if (el.disabled) continue;
      if (!isVisible(el) && !isSubmitDataCta(el)) continue;
      var t = buttonText(el);
      if (isExcludedApplyCta(t)) continue;
      if (isSubmitDataCta(el) || isFinalSubmitCta(t) || (isApplyCta(t) && !isApplyStartCta(t))) {
        out.push(el);
      }
    }
    out.sort(function (a, b) {
      var sa = isSubmitDataCta(a) ? 100 : 0;
      var sb = isSubmitDataCta(b) ? 100 : 0;
      return sb - sa;
    });
    return out;
  }

  var APPLY_CONTAINER_SELECTORS = [
    '#job-application-form',
    'turbo-frame#application_form',
    '#application',
    '#application-form',
    'form#application',
    '#greenhouse-job-application',
    '#main_fields',
    '.application--container',
    '#apply_form',
    'form[action*="apply" i]',
    'form[id*="application" i]',
    'form[class*="application" i]',
    'form[data-controller*="careersite--form"]',
    '[data-careersite--jobs--form-overlay-target="form"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.ReactModal__Content',
    '.modal.show',
    '.modal[open]',
    '[data-test="application-form"]'
  ];

  function findApplyContainers(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];
    var out = [];
    for (var s = 0; s < APPLY_CONTAINER_SELECTORS.length; s++) {
      var nodes = queryAllDeep(APPLY_CONTAINER_SELECTORS[s], root);
      for (var i = 0; i < nodes.length; i++) {
        if (out.indexOf(nodes[i]) === -1) out.push(nodes[i]);
      }
    }
    return out;
  }

  function containerLooksOpen(container) {
    if (!container) return false;
    try {
      if (isVisible(container)) return true;
      // Hidden host with visible descendants (rare) — count visible fillables instead
      return countFillableApplicationInputs(container) > 0;
    } catch (_e) {
      return false;
    }
  }

  /** Page furniture that is never part of an application: search, newsletter, login. */
  var NOISE_FIELD_RE =
    /\b(search|filter|keyword|query|autocomplete-input|location-search|job.?search|newsletter|subscribe|coupon|promo|gdpr|cookie)\b/i;

  /** Employer enquiry / "I am hiring" / contact widgets — not the job application. */
  var ENQUIRY_FORM_RE =
    /\b(i am hiring|i'?m hiring|send an inqui(?:ry|ry)|send inquiry|hire talent|for employers|tell us about the role|employer inquiry|employer enquiry|talent solutions inquiry)\b/i;

  /** Labels/names that only ever appear on a real application form. */
  var APPLICATION_FIELD_RE =
    /\b(first\s*name|last\s*name|given\s*name|family\s*name|full\s*name|surname|e-?mail|phone|mobile|telephone|resume|cv\b|curriculum|cover\s*letter|linkedin|portfolio|github|website|address|city|state|province|country|postal|zip|nationality|citizenship|salary|compensation|expected\s*pay|notice\s*period|availability|start\s*date|years?\s*of\s*experience|work\s*authoriz|sponsor|right\s*to\s*work|visa|why\s*(do\s*you|are\s*you)|tell\s*us|how\s*did\s*you\s*hear|referr?al|pronoun|preferred\s*name)\b/i;

  function fieldBlob(el) {
    if (!el || !el.getAttribute) return '';
    var D = dom();
    var label = D && D.labelFor ? D.labelFor(el) : '';
    return [
      el.getAttribute('name') || '',
      el.id || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('autocomplete') || '',
      typeof el.className === 'string' ? el.className : '',
      label
    ].join(' ');
  }

  function isSearchLikeField(el) {
    if (!el) return false;
    return NOISE_FIELD_RE.test(fieldBlob(el));
  }

  function isInsideEnquiryForm(el) {
    if (!el || !el.closest) return false;
    var form = el.closest('form, [role="form"], section, aside, footer, [class*="enquiry" i], [class*="inquiry" i], [id*="enquiry" i], [id*="inquiry" i]');
    if (!form) return false;
    try {
      var text = (form.innerText || form.textContent || '').slice(0, 1200);
      if (ENQUIRY_FORM_RE.test(text)) return true;
      var blob = fieldBlob(el) + ' ' + (form.id || '') + ' ' + (typeof form.className === 'string' ? form.className : '');
      if (/\b(enquiry|inquiry|hire[-_]?talent|employer[-_]?contact)\b/i.test(blob)) return true;
    } catch (_e) { /* ignore */ }
    return false;
  }

  /**
   * Bare sign-in widgets are not applications. Career registration forms that
   * also collect identity / CV / phone (SuccessFactors, Al-Futtaim, etc.) DO
   * count — password alone no longer excludes the whole form.
   */
  function isRichRegistrationForm(form) {
    if (!form) return false;
    try {
      var blob = '';
      var nodes = form.querySelectorAll('input, select, textarea, label');
      var n = Math.min(nodes.length, 80);
      for (var i = 0; i < n; i++) {
        var el = nodes[i];
        blob +=
          ' ' +
          (el.name || '') +
          ' ' +
          (el.id || '') +
          ' ' +
          (el.getAttribute && el.getAttribute('placeholder') || '') +
          ' ' +
          (el.getAttribute && el.getAttribute('aria-label') || '') +
          ' ' +
          (el.textContent || '').slice(0, 80);
      }
      blob = blob.toLowerCase();
      var identity =
        /first\s*name|last\s*name|given\s*name|family\s*name|surname|nationality|phone|mobile|resume|\bcv\b|curriculum|country\s*of\s*residence|date\s*of\s*birth/.test(
          blob
        );
      var file = !!form.querySelector('input[type="file"]');
      return identity || file;
    } catch (_e) {
      return false;
    }
  }

  /** Sign-in-only forms are noise; rich register/apply forms are fillable. */
  function isInsideLoginForm(el) {
    if (!el || !el.closest) return false;
    var form = el.closest('form, [role="form"], [class*="login" i], [class*="signin" i], [id*="login" i], [id*="signin" i]');
    if (!form) return false;
    if (isRichRegistrationForm(form)) return false;
    try {
      if (form.querySelector('input[type="password"]')) {
        // Password + only email (no identity) → treat as login wall / noise for scoring
        return true;
      }
    } catch (_e) {
      /* ignore */
    }
    var blob = (form.id || '') + ' ' + (typeof form.className === 'string' ? form.className : '');
    return /\b(login|log-in|signin|sign-in)\b/i.test(blob) && !/\b(register|signup|sign-up|apply)\b/i.test(blob);
  }

  function fillableCandidates(root) {
    return queryAllDeep(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input[type="date"], input:not([type]), textarea, select, [contenteditable="true"]',
      root
    );
  }

  /**
   * Count visible text/email/tel/textarea/select fields that look like an application form.
   */
  function countFillableApplicationInputs(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return 0;
    var nodes = fillableCandidates(root);
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'search') continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;
      if (isSearchLikeField(el)) continue;
      if (isInsideLoginForm(el)) continue;
      n += 1;
    }
    return n;
  }

  /**
   * Evidence that an application form is present, independent of markup style.
   *
   * The old container whitelist only recognised a handful of hard-coded ids, so
   * React-rendered forms (Ashby, Lever, Teamtailor, Workday) scored zero and the
   * engine concluded there was nothing to fill. Scoring named fields, file
   * inputs and final-submit CTAs works regardless of how the form is built.
   */
  function scoreApplicationForm(root, minFields) {
    root = root || (typeof document !== 'undefined' ? document : null);
    minFields = minFields == null ? MIN_OPEN_FORM_FIELDS : minFields;
    var result = {
      open: false,
      score: 0,
      namedFields: 0,
      totalFields: 0,
      hasFileInput: false,
      hasFinalSubmit: false,
      containerFields: 0,
      signals: []
    };
    if (!root) return result;

    var nodes = fillableCandidates(root);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'search') continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;
      if (isSearchLikeField(el)) continue;
      if (isInsideLoginForm(el)) continue;
      result.totalFields += 1;
      if (APPLICATION_FIELD_RE.test(fieldBlob(el))) {
        result.namedFields += 1;
      }
    }

    var files = queryAllDeep('input[type="file"]', root);
    for (var f = 0; f < files.length; f++) {
      if (!files[f].disabled) {
        result.hasFileInput = true;
        break;
      }
    }

    var buttons = queryAllDeep('button, input[type="submit"], [role="button"]', root);
    for (var b = 0; b < buttons.length; b++) {
      if (isFinalSubmitCta(buttonText(buttons[b]))) {
        result.hasFinalSubmit = true;
        break;
      }
    }

    var containers = findApplyContainers(root);
    for (var c = 0; c < containers.length; c++) {
      if (!containerLooksOpen(containers[c])) continue;
      result.containerFields = Math.max(
        result.containerFields,
        countFillableApplicationInputs(containers[c])
      );
    }

    if (result.namedFields >= minFields) {
      result.score += 3;
      result.signals.push('named_fields:' + result.namedFields);
    }
    if (result.containerFields >= minFields) {
      result.score += 3;
      result.signals.push('container_fields:' + result.containerFields);
    }
    if (result.hasFileInput && result.namedFields >= 1) {
      result.score += 2;
      result.signals.push('file_input');
    }
    if (result.hasFinalSubmit && result.totalFields >= 1) {
      result.score += 2;
      result.signals.push('final_submit_cta');
    }
    if (result.totalFields >= 4 && result.namedFields >= 1) {
      result.score += 1;
      result.signals.push('field_dense');
    }

    result.open = result.score >= 3;
    return result;
  }

  function looksLikeJobPosting(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return false;
    try {
      if (
        queryAllDeep(
          '.job-description, [class*="job-description"], [data-qa="job-description"], [itemprop="description"], .listing-container, #job-description, .job-details',
          root
        ).length
      ) {
        return true;
      }
      var body = root.body || root;
      var text = String((body && (body.innerText || body.textContent)) || '').slice(0, 6000);
      return /job description|about (the )?role|about (the )?job|responsibilities|requirements|what you.?ll do|position overview|key responsibilities|the role\b/i.test(
        text
      );
    } catch (_e) {
      return false;
    }
  }

  /**
   * True when an application form already looks open (do not click Apply-start / final Submit as open).
   * Uses signal scoring so React-rendered forms count, while newsletter / search
   * / sign-in fields never do.
   */
  /**
   * Best visible apply modal/dialog/drawer root on the page (same-tab popup Apply).
   * Prefers role=dialog / aria-modal / .modal over plain forms.
   */
  function findApplicationModalRoot(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;
    var containers = findApplyContainers(root);
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      if (!containerLooksOpen(c)) continue;
      var score = 10 + countFillableApplicationInputs(c);
      var cls = '';
      var role = '';
      var ariaModal = '';
      try {
        cls = String(c.className || '');
        role = c.getAttribute ? String(c.getAttribute('role') || '') : '';
        ariaModal = c.getAttribute ? String(c.getAttribute('aria-modal') || '') : '';
      } catch (_e) {}
      if (/dialog/i.test(role) || ariaModal === 'true') score += 50;
      if (/modal|drawer|overlay|popup|lightbox|ReactModal/i.test(cls)) score += 35;
      if (/application|apply/i.test(cls + ' ' + (c.id || ''))) score += 15;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function isApplicationFormOpen(root, minFields) {
    return scoreApplicationForm(root, minFields).open;
  }

  /**
   * Whether we should click an Apply-start CTA (form not open yet + CTA present).
   */
  function shouldClickApplyStart(root, minFields) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return false;
    if (isApplicationFormOpen(root, minFields)) return false;
    var btns = findApplyStartButtons(root);
    if (!btns.length) return false;
    // High-confidence Apply-start present and modal/form not visibly open → always click
    for (var bi = 0; bi < btns.length; bi++) {
      var bt = buttonText(btns[bi]);
      var action = btns[bi].getAttribute('data-action') || '';
      var overlayTarget = btns[bi].getAttribute('data-careersite--jobs--form-overlay-target') || '';
      if (
        isApplyStartDataCta(btns[bi]) ||
        scoreApplyStartText(bt) >= 80 ||
        /showFormOverlay/i.test(action) ||
        overlayTarget === 'coverButton' ||
        /apply for this job/i.test(bt)
      ) {
        return true;
      }
    }
    // Prefer when page looks like a posting OR has almost no fillable fields in apply containers
    var containers = findApplyContainers(root);
    var n = 0;
    if (containers.length) {
      for (var ci = 0; ci < containers.length; ci++) {
        n += countFillableApplicationInputs(containers[ci]);
      }
    } else {
      n = countFillableApplicationInputs(root);
    }
    if (n < (minFields == null ? MIN_OPEN_FORM_FIELDS : minFields)) return true;
    if (looksLikeJobPosting(root)) return true;
    try {
      var app = root.querySelector('#application, form#application, #application-form');
      if (app && countFillableApplicationInputs(app) < (minFields || MIN_OPEN_FORM_FIELDS)) {
        return true;
      }
    } catch (_e) {}
    return false;
  }

  /**
   * Click one Apply-start CTA when the form is not open yet.
   * Allowed in fill / ready / submit (opening is not final submit).
   * Returns { clicked, text?, reason, el? }.
   */
  function tryClickApplyStart(root, opts) {
    opts = opts || {};
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return { clicked: false, reason: 'no_root' };
    var minFields = opts.minFields != null ? opts.minFields : MIN_OPEN_FORM_FIELDS;

    if (isApplicationFormOpen(root, minFields)) {
      return { clicked: false, reason: 'form_open' };
    }
    if (!shouldClickApplyStart(root, minFields) && !opts.force) {
      // still allow if CTA exists and few fields
      var n = countFillableApplicationInputs(root);
      var btns0 = findApplyStartButtons(root);
      if (!(btns0.length && n < minFields)) {
        return { clicked: false, reason: 'not_needed' };
      }
    }

    var buttons = findApplyStartButtons(root);
    if (!buttons.length) return { clicked: false, reason: 'no_cta' };

    var best = buttons[0];
    var text = buttonText(best).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) text = 'Apply';
    try {
      best.disabled = false;
    } catch (_eEn) {}
    var D = dom();
    if (D && D.realClick) {
      if (D.realClick(best)) {
        return { clicked: true, text: text, reason: 'clicked', el: best };
      }
    }
    try {
      best.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_eScroll) {}
    try {
      best.click();
      return { clicked: true, text: text, reason: 'clicked', el: best };
    } catch (_eClick) {
      try {
        best.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        );
        return { clicked: true, text: text, reason: 'mouse_event', el: best };
      } catch (_eMouse) {}
      try {
        if (best.href && typeof location !== 'undefined') {
          location.href = best.href;
          return { clicked: true, text: text, reason: 'navigated', el: best };
        }
      } catch (_eNav) {}
      return { clicked: false, reason: 'click_failed', text: text };
    }
  }


  function isMarkAppliedCta(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (MARK_APPLIED_CTA.test(t)) return true;
    return /^mark\s*as\s*applied\b/i.test(t);
  }

  function isJobpoolApplyDataCta(el) {
    return hasDataFillApply(el, DATA_JOBPOOL_APPLY);
  }

  function isJobpoolMarkAppliedDataCta(el) {
    return hasDataFillApply(el, DATA_JOBPOOL_MARK_APPLIED);
  }

  function looksLikeSubmitSuccessText(text) {
    return SUBMIT_SUCCESS_TEXT.test(String(text || ''));
  }

  /**
   * Return / deep-link markers after employer submit (JobPool redirect).
   * No hard-coded production host required.
   */
  function looksLikeJobPoolReturnUrl(url) {
    var u = String(url || '');
    if (!u) return false;
    try {
      var parsed = new URL(u, typeof location !== 'undefined' ? location.href : undefined);
      u = parsed.href;
      var path = String(parsed.pathname || '') + '?' + String(parsed.search || '');
      if (/\/applications\b/i.test(path)) return true;
      if (/[?&#](returnUrl|return_to|from)=[^&]*jobpool/i.test(u)) return true;
      if (/[?&#]from=jobpool\b/i.test(u)) return true;
      if (/jobpool/i.test(parsed.hostname || '')) return true;
    } catch (_e) {
      if (/jobpool|returnUrl|return_to|from=jobpool|\/applications\b/i.test(u)) return true;
    }
    return /[?&#](returnUrl|return_to)=/i.test(u) || /from=jobpool/i.test(u);
  }

  function normalizeHost(hostOrUrl) {
    var s = String(hostOrUrl || '').trim().toLowerCase();
    if (!s) return '';
    try {
      if (/^https?:\/\//i.test(s)) s = new URL(s).hostname;
    } catch (_e) {}
    s = s.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0];
    return s.replace(/^www\./, '');
  }

  /**
   * Detect JobPool Applications hub (Intelligent Opportunity Hub).
   * ANY of: page text markers, data-fill-apply stamps, or hostname matching backendBaseUrl.
   */
  function isJobPoolHubPage(doc, url, opts) {
    opts = opts || {};
    doc = doc || (typeof document !== 'undefined' ? document : null);
    url = String(url || (typeof location !== 'undefined' ? location.href : '') || '');
    // Hostname/path alone — do not wait for SPA body text (panel + adapter boot).
    try {
      var earlyHost = normalizeHost(url);
      if (/zahid-jobpool\.vercel\.app/i.test(earlyHost) || /^jobpool\./i.test(earlyHost)) {
        if (/\/applications?/i.test(url) || /\/applications?/i.test(String((typeof location !== 'undefined' && location.pathname) || ''))) {
          return true;
        }
        return true;
      }
    } catch (_early) {}
    var text = '';
    try {
      text = doc && doc.body ? String(doc.body.innerText || doc.body.textContent || '') : '';
    } catch (_e) {
      text = '';
    }
    text = text.slice(0, 20000);

    if (/Intelligent\s+Opportunity\s+Hub/i.test(text)) return true;
    if (
      /Ready\s+to\s+apply/i.test(text) &&
      /Mark\s+as\s+applied/i.test(text) &&
      /Pipeline\s+overview/i.test(text)
    ) {
      return true;
    }
    if (/Ready-to-apply\s+packages/i.test(text)) return true;

    if (doc && doc.querySelector) {
      try {
        if (
          doc.querySelector(
            '[data-fill-apply="jobpool-apply"], [data-fill-apply="jobpool-mark-applied"], [data-job-id], [data-jobpool-job-id]'
          )
        ) {
          // Prefer stamps only when hub-ish chrome is also present
          if (/Ready\s+to\s+apply|Applications|JobPool|Mark\s+as\s+applied/i.test(text)) {
            return true;
          }
        }
      } catch (_q) {}
    }

    var configured = normalizeHost(
      opts.backendBaseUrl ||
        (typeof global !== 'undefined' && global.__fillApplyBackendBaseUrl) ||
        (typeof globalThis !== 'undefined' && globalThis.__fillApplyBackendBaseUrl) ||
        ''
    );
    if (configured) {
      try {
        var host = normalizeHost(url);
        if (host && (host === configured || host.endsWith('.' + configured))) return true;
      } catch (_h) {}
    }
    return false;
  }

  /**
   * Visible Mark as applied buttons (JobPool hub). Prefers data-fill-apply stamp.
   */
  function findMarkAppliedButtons(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];
    var nodes = queryAllDeep(
      'a, button, input[type="button"], input[type="submit"], [role="button"], [data-fill-apply="jobpool-mark-applied"]',
      root
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isVisible(el)) continue;
      var marked = isJobpoolMarkAppliedDataCta(el);
      var t = buttonText(el).replace(/\s+/g, ' ').trim();
      if (!marked && !isMarkAppliedCta(t)) continue;
      if (isExcludedApplyCta(t) && !marked) continue;
      out.push(el);
    }
    out.sort(function (a, b) {
      var sa = isJobpoolMarkAppliedDataCta(a) ? 100 : 0;
      var sb = isJobpoolMarkAppliedDataCta(b) ? 100 : 0;
      return sb - sa;
    });
    return out;
  }

  global.FillApplySynonyms = {
    APPLY_CTA: APPLY_CTA,
    APPLY_START_CTA: APPLY_START_CTA,
    FINAL_SUBMIT_CTA: FINAL_SUBMIT_CTA,
    CONTINUE_CTA: CONTINUE_CTA,
    DATA_FILL_APPLY_ATTR: DATA_FILL_APPLY_ATTR,
    DATA_APPLY_START: DATA_APPLY_START,
    DATA_CONTINUE: DATA_CONTINUE,
    DATA_SUBMIT: DATA_SUBMIT,
    DATA_JOBPOOL_APPLY: DATA_JOBPOOL_APPLY,
    DATA_JOBPOOL_MARK_APPLIED: DATA_JOBPOOL_MARK_APPLIED,
    MARK_APPLIED_CTA: MARK_APPLIED_CTA,
    SUBMIT_SUCCESS_TEXT: SUBMIT_SUCCESS_TEXT,
    RESUME_FILE: RESUME_FILE,
    COVER_FILE: COVER_FILE,
    ATTACH_ACTION: ATTACH_ACTION,
    EXCLUDED_APPLY_CTA: EXCLUDED_APPLY_CTA,
    ACCOUNT_PROFILE_FIRST: ACCOUNT_PROFILE_FIRST,
    PAID_SOURCES: PAID_SOURCES,
    MIN_OPEN_FORM_FIELDS: MIN_OPEN_FORM_FIELDS,
    buttonText: buttonText,
    isVisible: isVisible,
    isExcludedApplyCta: isExcludedApplyCta,
    dataFillApplyRole: dataFillApplyRole,
    hasDataFillApply: hasDataFillApply,
    isApplyCta: isApplyCta,
    isEasyApplyCta: isEasyApplyCta,
    isApplyStartCta: isApplyStartCta,
    isApplyStartCtaForHost: isApplyStartCtaForHost,
    isFinalSubmitCta: isFinalSubmitCta,
    isContinueCta: isContinueCta,
    isApplyStartDataCta: isApplyStartDataCta,
    isContinueDataCta: isContinueDataCta,
    isSubmitDataCta: isSubmitDataCta,
    isResumeLabel: isResumeLabel,
    isCoverLabel: isCoverLabel,
    scoreApplyStartText: scoreApplyStartText,
    findApplyStartButtons: findApplyStartButtons,
    findContinueButtons: findContinueButtons,
    findSubmitButtons: findSubmitButtons,
    findApplyContainers: findApplyContainers,
    findApplicationModalRoot: findApplicationModalRoot,
    countFillableApplicationInputs: countFillableApplicationInputs,
    scoreApplicationForm: scoreApplicationForm,
    isSearchLikeField: isSearchLikeField,
    isInsideEnquiryForm: isInsideEnquiryForm,
    isInsideLoginForm: isInsideLoginForm,
    isRichRegistrationForm: isRichRegistrationForm,
    looksLikeJobPosting: looksLikeJobPosting,
    isApplicationFormOpen: isApplicationFormOpen,
    shouldClickApplyStart: shouldClickApplyStart,
    tryClickApplyStart: tryClickApplyStart,
    isMarkAppliedCta: isMarkAppliedCta,
    isJobpoolApplyDataCta: isJobpoolApplyDataCta,
    isJobpoolMarkAppliedDataCta: isJobpoolMarkAppliedDataCta,
    looksLikeSubmitSuccessText: looksLikeSubmitSuccessText,
    looksLikeJobPoolReturnUrl: looksLikeJobPoolReturnUrl,
    normalizeHost: normalizeHost,
    isJobPoolHubPage: isJobPoolHubPage,
    findMarkAppliedButtons: findMarkAppliedButtons
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
