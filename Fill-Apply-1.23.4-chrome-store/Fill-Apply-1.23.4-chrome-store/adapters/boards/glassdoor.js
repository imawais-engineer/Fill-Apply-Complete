/**
 * Glassdoor adapter (board) — Indeed-backed Easy Apply multi-step flow.
 *
 * Paste-derived steps (progress %):
 *   ~11% Add your contact information → Continue
 *   ~33% Add your location → Continue
 *   ~44% Add a resume (Upload) → Continue
 *   Review (+ optional supporting docs) + reCAPTCHA → needsHuman; Submit only in submit mode
 *
 * Apply chrome may stay on glassdoor.com or shift to indeed.com — on host change
 * return handoff so the runner re-injects the Indeed adapter.
 *
 * Never click “Is my resume a good match?” / AI Upload widgets as Apply.
 * Never solve reCAPTCHA.
 */
(function (global) {
  'use strict';

  var HOSTS = ['glassdoor.com', 'www.glassdoor.com'];
  var HOST_RE = /glassdoor\.com/i;
  var INDEED_HOST_RE = /(^|\.)indeed\.com$/i;

  function EA() {
    return global.FillApplyEasyApplySteps || null;
  }

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (HOST_RE.test(url)) return true;
    }
    return false;
  }

  function isIndeedHost(url) {
    url = String(url || (typeof location !== 'undefined' ? location.href : ''));
    try {
      return INDEED_HOST_RE.test(new URL(url).hostname);
    } catch (_e) {
      return /indeed\.com/i.test(url);
    }
  }

  function sleep(ms) {
    var ea = EA();
    if (ea && ea.sleep) return ea.sleep(ms);
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function humanDelay(base) {
    var ea = EA();
    if (ea && ea.humanDelay) return ea.humanDelay(base);
    return (typeof base === 'number' ? base : 450) + Math.floor(Math.random() * 350);
  }

  function visible(el) {
    var ea = EA();
    if (ea && ea.visible) return ea.visible(el);
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    } catch (_e) {
      return !!el;
    }
  }

  function buttonText(el) {
    var ea = EA();
    if (ea && ea.buttonText) return ea.buttonText(el);
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function getLabelFor(el) {
    var ea = EA();
    if (ea && ea.getLabelFor) return ea.getLabelFor(el);
    return (el && (el.getAttribute('aria-label') || el.placeholder || el.name)) || '';
  }

  function setNativeValue(el, value) {
    var ea = EA();
    if (ea && ea.setNativeValue) return ea.setNativeValue(el, value);
    if (!el) return false;
    el.value = value == null ? '' : String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function norm(s) {
    var ea = EA();
    if (ea && ea.norm) return ea.norm(s);
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function readProgressPercent(doc) {
    var ea = EA();
    if (ea && ea.readProgressPercent) return ea.readProgressPercent(doc);
    return null;
  }

  function bodyText(doc) {
    var ea = EA();
    if (ea && ea.bodyText) return ea.bodyText(doc);
    try {
      return (((doc || document).body && (doc || document).body.innerText) || '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (_e) {
      return '';
    }
  }

  function profileValue(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') return String(profile[key]).trim();
    if (profile.customAnswers && profile.customAnswers[key] != null) {
      return String(profile.customAnswers[key]).trim();
    }
    if (key === 'firstName' && profile.fullName) {
      return String(profile.fullName).trim().split(/\s+/)[0] || '';
    }
    if (key === 'lastName' && profile.fullName) {
      var parts = String(profile.fullName).trim().split(/\s+/);
      return parts.length > 1 ? parts.slice(1).join(' ') : '';
    }
    return '';
  }

  function findEasyApplyButton(doc) {
    var ea = EA();
    if (ea && ea.findEasyApplyButton) {
      return ea.findEasyApplyButton(doc, { preferIndeed: false });
    }
    doc = doc || document;
    var nodes = doc.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
      var dataBlob =
        ((el.getAttribute && el.getAttribute('data-test')) || '') +
        ' ' +
        ((el.getAttribute && el.getAttribute('data-gd')) || '');
      if (
        /is my resume a good match|resume.?match|upload resume to see|good match\?/i.test(t) ||
        (/^upload resume$/i.test(t.trim()) && !/easy apply/i.test(t + ' ' + aria))
      ) {
        continue;
      }
      if (
        /easy apply/i.test(t) ||
        /easy\s*apply/i.test(aria) ||
        /easyApply|easy-apply|easy_apply/i.test(dataBlob)
      ) {
        return el;
      }
    }
    return null;
  }

  /** Prefer scroll + click + MouseEvent (Teamtailor-style) so overlay handlers fire. */
  function clickApplyEl(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_eScroll) {}
    try {
      el.disabled = false;
    } catch (_eEn) {}
    try {
      el.click();
      return true;
    } catch (_eClick) {}
    try {
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      );
      return true;
    } catch (_eMouse) {}
    return false;
  }

  function hasIndeedApplyChrome(doc) {
    doc = doc || document;
    try {
      return !!(
        doc.querySelector(
          'iframe[src*="indeed.com"], iframe[src*="apply.indeed"], .ia-BasePage, .ia-ApplyForm, [class*="ia-Apply"], #ia-container, [data-testid*="indeed-apply"], [role="dialog"] .ia-BasePage'
        )
      );
    } catch (_e) {
      return false;
    }
  }

  function clickContinue() {
    var ea = EA();
    if (ea && ea.clickContinue) return ea.clickContinue(document);
    return false;
  }

  function clickSubmit() {
    var ea = EA();
    if (ea && ea.clickSubmit) return ea.clickSubmit(document);
    return false;
  }

  function detectCaptcha(doc) {
    var ea = EA();
    if (ea && ea.detectCaptcha) return ea.detectCaptcha(doc);
    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      return global.FillApplyChallenges.detectChallenge(doc || document);
    }
    return { challenged: false };
  }

  function waitForStepChange(prevProgress, prevUrl, timeoutMs) {
    var ea = EA();
    if (ea && ea.waitForStepChange) return ea.waitForStepChange(prevProgress, prevUrl, timeoutMs);
    return sleep(humanDelay(650)).then(function () {
      return { progress: readProgressPercent(document), url: location.href, changed: true };
    });
  }

  /**
   * Detect Glassdoor / Indeed-backed Easy Apply wizard step from paste labels + %.
   */
  function detectGlassdoorApplyFlow(doc) {
    doc = doc || document;
    var text = bodyText(doc);
    var progress = readProgressPercent(doc);
    var applyBtn = findEasyApplyButton(doc);

    // Tighten: bare "contact information" / footer "Indeed, Inc." are NOT wizard markers.
    var isContact =
      /add your contact information/i.test(text) ||
      (progress != null && progress <= 20 && progress >= 1);
    var isLocation =
      /add your location|street address.*(not shown|employers)/i.test(text) ||
      (progress != null && progress > 20 && progress <= 40);
    var isResume =
      /add a resume|upload a resume|build an indeed resume/i.test(text) ||
      (progress != null && progress > 40 && progress <= 55);
    var isReview =
      /\breview\b/i.test(text) &&
      (/submit application|supporting documents|looks good|i am not a robot|i'm not a robot/i.test(
        text
      ) ||
        progress === 100 ||
        (progress != null && progress >= 85));

    var wizardMarkerText =
      /add your contact information|add your location|add a resume|build an indeed resume/i.test(
        text
      ) || isReview;

    var step = 'unknown';
    if (isReview) step = 'review';
    else if (isResume && !isContact) step = 'resume';
    else if (isLocation && !isContact) step = 'location';
    else if (isContact) step = 'contact';
    else if (progress != null && progress > 0) {
      if (progress <= 20) step = 'contact';
      else if (progress <= 40) step = 'location';
      else if (progress <= 60) step = 'resume';
      else if (progress < 100) step = 'questions';
      else step = 'review';
    }

    // Real wizard only — never treat Glassdoor footer "Indeed, Inc." as inFlow.
    var inFlow =
      wizardMarkerText ||
      (progress != null && progress > 0) ||
      hasIndeedApplyChrome(doc) ||
      (step !== 'unknown' && (wizardMarkerText || (progress != null && progress > 0)));

    return {
      step: step,
      progress: progress,
      isReview: isReview || step === 'review',
      isJobPage: !!applyBtn && !inFlow,
      hasApplyButton: !!applyBtn,
      applyButton: applyBtn,
      inFlow: inFlow
    };
  }

  function fillMatchingFields(profile, predicates) {
    var filled = 0;
    var missing = [];
    var inputs = document.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el)) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file' || type === 'password') {
        continue;
      }
      var lab = norm(getLabelFor(el) + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''));
      for (var p = 0; p < predicates.length; p++) {
        var pred = predicates[p];
        if (!pred.match(lab, el)) continue;
        var val = pred.value(profile);
        if (!val) {
          if (pred.required !== false) missing.push(pred.label || lab.slice(0, 40));
          break;
        }
        if (el.value && String(el.value).trim() === String(val).trim()) {
          filled++;
          break;
        }
        if (setNativeValue(el, val)) filled++;
        break;
      }
    }
    return { filled: filled, missing: missing };
  }

  function fillContactStep(profile) {
    return fillMatchingFields(profile, [
      {
        label: 'First name',
        match: function (b) {
          return /first name|firstname|given name/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'firstName');
        }
      },
      {
        label: 'Last name',
        match: function (b) {
          return /last name|lastname|surname|family name/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'lastName');
        }
      },
      {
        label: 'Email',
        match: function (b) {
          return /e-?mail/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'email');
        }
      },
      {
        label: 'Phone',
        match: function (b, el) {
          return (
            (/phone|mobile|tel/.test(b) && !/country/.test(b)) ||
            String(el.type || '').toLowerCase() === 'tel'
          );
        },
        value: function (p) {
          return profileValue(p, 'phone');
        }
      },
      {
        label: 'Phone country',
        match: function (b) {
          return /country.*(code|call)|phone country|dial code|calling code|country\/region/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'phoneCountry') || profileValue(p, 'country');
        },
        required: false
      }
    ]);
  }

  function fillLocationStep(profile) {
    return fillMatchingFields(profile, [
      {
        label: 'Country',
        match: function (b) {
          return (/^country$|country\b|country\/region/.test(b) && !/authoriz|phone|code|call/.test(b));
        },
        value: function (p) {
          return profileValue(p, 'country');
        }
      },
      {
        label: 'Postal code',
        match: function (b) {
          return /postcode|postal|zip/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'postcode') || profileValue(p, 'zip');
        }
      },
      {
        label: 'City',
        match: function (b) {
          return /\bcity\b/.test(b) && !/province|territory|state/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'city');
        }
      },
      {
        label: 'Street address',
        match: function (b) {
          return /street|address line|address\b/.test(b) && !/email|email address/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'street') || profileValue(p, 'address');
        },
        required: false
      }
    ]);
  }

  function resumeAlreadyUploaded() {
    var text = bodyText(document);
    if (/\.(pdf|docx?|rtf|txt)\b/i.test(text) && /resume|cv|uploaded|attached|selected/i.test(text)) {
      return true;
    }
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var j = 0; j < inputs.length; j++) {
      if (inputs[j].files && inputs[j].files.length > 0) return true;
    }
    return false;
  }

  function fillResumeStep(profile, documents) {
    var filled = 0;
    var resumeAttached = false;
    var skipped = false;

    if (resumeAlreadyUploaded()) {
      skipped = true;
      return { filled: 0, skipped: true, resumeAttached: true };
    }

    // Prefer Upload a resume over Build an Indeed Resume
    var uploadCta = null;
    var nodes = document.querySelectorAll('button, a, [role="button"], label');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (/is my resume a good match|good match\?/i.test(t)) continue;
      if (/upload a resume|upload resume|upload cv/i.test(t)) {
        uploadCta = el;
        break;
      }
    }
    if (uploadCta) {
      try {
        uploadCta.click();
      } catch (_e) {
        /* ignore */
      }
    }

    var fileInput =
      document.querySelector('input[type="file"][accept*="pdf"], input[type="file"][accept*=".doc"], input[type="file"]') ||
      null;
    if (fileInput && global.FillApplyFiles && typeof global.FillApplyFiles.attachDocument === 'function') {
      try {
        var att = global.FillApplyFiles.attachDocument(fileInput, documents, 'resume', profile);
        if (att && (att.ok || att.attached)) {
          filled++;
          resumeAttached = true;
        }
      } catch (_e2) {
        /* ignore */
      }
    } else if (
      fileInput &&
      global.__fillApply &&
      typeof global.__fillApply.attachFileInput === 'function'
    ) {
      try {
        var ok = global.__fillApply.attachFileInput(fileInput, documents, 'resume');
        if (ok) {
          filled++;
          resumeAttached = true;
        }
      } catch (_e3) {
        /* ignore */
      }
    }

    return { filled: filled, skipped: skipped, resumeAttached: resumeAttached };
  }

  function fillCurrentStep(profile, documents, flow) {
    var step = flow.step;
    var filled = 0;
    var missing = [];
    var meta = { step: step, resumeAttached: false };

    function take(r) {
      if (r && typeof r === 'object' && 'filled' in r) {
        filled += r.filled || 0;
        if (r.missing && r.missing.length) missing = missing.concat(r.missing);
        if (r.resumeAttached) meta.resumeAttached = true;
      } else {
        filled += r || 0;
      }
    }

    if (step === 'contact' || (flow.progress != null && flow.progress <= 20)) {
      take(fillContactStep(profile));
      meta.step = 'contact';
    } else if (step === 'location' || (flow.progress != null && flow.progress > 20 && flow.progress <= 40)) {
      take(fillLocationStep(profile));
      meta.step = 'location';
    } else if (step === 'resume' || (flow.progress != null && flow.progress > 40 && flow.progress <= 60)) {
      var rr = fillResumeStep(profile, documents);
      filled += rr.filled || 0;
      meta.resumeAttached = !!rr.resumeAttached || !!rr.skipped;
      meta.step = 'resume';
    } else if (step === 'review') {
      meta.step = 'review';
    } else {
      take(fillContactStep(profile));
      take(fillLocationStep(profile));
      var rr2 = fillResumeStep(profile, documents);
      filled += rr2.filled || 0;
      meta.resumeAttached = !!rr2.resumeAttached;
    }

    meta.missingProfileFields = missing;
    return { filled: filled, meta: meta, missing: missing };
  }

  function challengeResult(ch, totalFilled, advanced) {
    return {
      ok: false,
      adapterId: 'glassdoor',
      needsHuman: true,
      challenge: ch,
      filled: totalFilled || 0,
      unmatched: 0,
      total: totalFilled || 0,
      advanced: !!advanced,
      submitted: false,
      error:
        (global.FillApplyChallenges &&
          global.FillApplyChallenges.describeChallenge &&
          global.FillApplyChallenges.describeChallenge(ch)) ||
        'Paused — complete reCAPTCHA / I am not a robot, then Resume',
      pauseReason: 'challenge'
    };
  }

  function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var documents = ctx.documents || {};
    var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
    if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    // Already on Indeed host inside a Glassdoor session → hand off
    if (isIndeedHost(typeof location !== 'undefined' ? location.href : '')) {
      return {
        ok: true,
        adapterId: 'glassdoor',
        filled: 0,
        unmatched: 0,
        total: 0,
        handedOff: true,
        externalApply: true,
        reDetect: true,
        deferToPageAdapter: true,
        message: 'Glassdoor apply shifted to Indeed — handing off',
        runMode: runMode
      };
    }

    var ch0 = detectCaptcha(document);
    if (ch0 && ch0.challenged) return challengeResult(ch0, 0, false);

    function runSteps() {
      return Promise.resolve().then(async function () {
        var totalFilled = 0;
        var advanced = false;
        var submitted = false;
        var lastStep = 'unknown';
        var resumeAttached = false;
        var maxHops = runMode === 'fill' ? 2 : 12;
        var startHost = '';
        try {
          startHost = location.hostname;
        } catch (_h) {
          startHost = '';
        }

        for (var hop = 0; hop < maxHops; hop++) {
          // Host change mid-loop → Indeed handoff
          try {
            if (startHost && location.hostname && location.hostname !== startHost) {
              if (isIndeedHost(location.href) || /indeed\.com/i.test(location.hostname)) {
                return {
                  ok: true,
                  adapterId: 'glassdoor',
                  filled: totalFilled,
                  unmatched: 0,
                  total: totalFilled,
                  advanced: advanced,
                  handedOff: true,
                  externalApply: true,
                  reDetect: true,
                  deferToPageAdapter: true,
                  resumeAttached: resumeAttached,
                  step: lastStep,
                  message: 'Glassdoor → Indeed host change — re-detect',
                  runMode: runMode
                };
              }
            }
          } catch (_hostErr) {
            /* frame may be dying — let runner retry */
          }

          var ch = detectCaptcha(document);
          if (ch && ch.challenged) return challengeResult(ch, totalFilled, advanced);

          var flow = detectGlassdoorApplyFlow(document);

          // Job listing → always click Easy Apply when button found and wizard not open
          // (even if weak heuristics were confused previously).
          if (flow.applyButton && !flow.inFlow) {
            try {
              clickApplyEl(flow.applyButton);
              advanced = true;
              await sleep(humanDelay(700));
              var flowAfterClick = detectGlassdoorApplyFlow(document);
              if (!flowAfterClick.inFlow) {
                // Wizard not painted yet — same as Teamtailor: ask runner to re-inject
                return {
                  ok: true,
                  adapterId: 'glassdoor',
                  clickedApplyStart: true,
                  reDetect: true,
                  handedOff: true,
                  deferToPageAdapter: true,
                  filled: totalFilled,
                  unmatched: 0,
                  total: totalFilled,
                  advanced: true,
                  submitted: false,
                  resumeAttached: resumeAttached,
                  step: flowAfterClick.step || 'unknown',
                  runMode: runMode,
                  message:
                    'Clicked Easy Apply — waiting for wizard, then re-detect',
                  error: null
                };
              }
              flow = flowAfterClick;
              if (runMode !== 'fill') {
                continue;
              }
            } catch (_eClick) {
              /* ignore */
            }
          }

          flow = detectGlassdoorApplyFlow(document);
          lastStep = flow.step;

          var stepResult = fillCurrentStep(profile, documents, flow);
          totalFilled += stepResult.filled || 0;
          if (stepResult.meta) {
            lastStep = stepResult.meta.step || lastStep;
            if (stepResult.meta.resumeAttached) resumeAttached = true;
          }
          var miss =
            (stepResult.missing && stepResult.missing.length && stepResult.missing) ||
            (stepResult.meta &&
              stepResult.meta.missingProfileFields &&
              stepResult.meta.missingProfileFields.length &&
              stepResult.meta.missingProfileFields) ||
            null;
          if (miss) {
            return {
              ok: false,
              adapterId: 'glassdoor',
              needsHuman: true,
              pauseReason: 'missing_profile_field',
              missingProfileFields: miss,
              filled: totalFilled,
              unmatched: miss.length,
              total: totalFilled + miss.length,
              advanced: advanced,
              submitted: false,
              error:
                'Glassdoor: missing profile field(s): ' +
                miss.join(', ') +
                ' — fill in Options or on the page, then Resume',
              step: lastStep
            };
          }

          // Review: captcha often appears here — pause before submit
          if (flow.isReview || flow.step === 'review') {
            var chReview = detectCaptcha(document);
            if (chReview && chReview.challenged) {
              return challengeResult(chReview, totalFilled, advanced);
            }
            if (runMode === 'submit') {
              submitted = clickSubmit();
              await sleep(humanDelay(400));
              var chAfter = detectCaptcha(document);
              if (chAfter && chAfter.challenged) {
                var cr = challengeResult(chAfter, totalFilled, advanced);
                cr.submitted = false;
                return cr;
              }
            }
            return {
              ok: true,
              adapterId: 'glassdoor',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: submitted,
              resumeAttached: resumeAttached,
              step: 'review',
              steps: ['contact', 'location', 'resume', 'review'],
              runMode: runMode,
              error: null
            };
          }

          if (runMode === 'fill') {
            var dbgFill = '';
            if (!advanced && totalFilled === 0 && !flow.inFlow) {
              dbgFill =
                'No Easy Apply clicked — inFlow=' +
                !!flow.inFlow +
                ' hasBtn=' +
                !!flow.hasApplyButton;
              try {
                console.log('[FillApply glassdoor]', dbgFill);
              } catch (_log) {}
            }
            return {
              ok: true,
              adapterId: 'glassdoor',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              message: dbgFill || null,
              error: null
            };
          }

          // ready | submit — fill then Continue, wait for progress/DOM change, rescan
          var prevProgress = flow.progress;
          var prevUrl = '';
          try {
            prevUrl = location.href;
          } catch (_u) {
            prevUrl = '';
          }
          var went = clickContinue();
          if (went) {
            advanced = true;
            await waitForStepChange(prevProgress, prevUrl, 9000);
            await sleep(humanDelay(350));
          } else {
            return {
              ok: false,
              adapterId: 'glassdoor',
              needsHuman: true,
              pauseReason: 'could_not_advance',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              resumeAttached: resumeAttached,
              step: lastStep,
              runMode: runMode,
              error:
                'Glassdoor: could not advance step — review the page (Continue / captcha), then Resume'
            };
          }
        }

        var dbgEnd = '';
        if (!advanced && totalFilled === 0) {
          var flowEnd = detectGlassdoorApplyFlow(document);
          dbgEnd =
            'No Easy Apply clicked — inFlow=' +
            !!flowEnd.inFlow +
            ' hasBtn=' +
            !!flowEnd.hasApplyButton;
          try {
            console.log('[FillApply glassdoor]', dbgEnd);
          } catch (_log2) {}
        }
        return {
          ok: true,
          adapterId: 'glassdoor',
          filled: totalFilled,
          unmatched: 0,
          total: totalFilled,
          advanced: advanced,
          submitted: submitted,
          resumeAttached: resumeAttached,
          step: lastStep,
          runMode: runMode,
          message: dbgEnd || null,
          error: null
        };
      });
    }

    return runSteps();
  }

  var adapter = {
    id: 'glassdoor',
    name: 'Glassdoor',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    detectGlassdoorApplyFlow: detectGlassdoorApplyFlow,
    fieldMaps: [],
    submitSelector:
      'button[type="submit"], input[type="submit"], button.ia-SubmitButton, [data-testid="submit-application"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover|supporting' }
    ],
    fill: fill
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_glassdoorAdapter = adapter;
  global.detectGlassdoorApplyFlow = detectGlassdoorApplyFlow;
})(typeof globalThis !== 'undefined' ? globalThis : self);
