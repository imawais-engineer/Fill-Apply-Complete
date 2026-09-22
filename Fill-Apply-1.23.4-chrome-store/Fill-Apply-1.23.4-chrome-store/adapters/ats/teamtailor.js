/**
 * Teamtailor ATS adapter — *.teamtailor.com and career sites powered by Teamtailor
 * (footer "Applicant tracking system by Teamtailor", careersite Stimulus controllers,
 * turbo-frame #application_form, form #job-application-form).
 *
 * Live paste: https://careers.learnatnoon.com/jobs/8342660-mentorship-manager
 * Flow: job page → click **Apply for this job** → modal/overlay form → fill →
 * **Submit application** only in submit mode.
 *
 * No invented answers: blank required mapped fields → needsHuman + missingProfileFields.
 */
(function (global) {
  'use strict';

  var HOSTS = ['teamtailor.com', 'www.teamtailor.com', 'app.teamtailor.com'];
  var HOST_RE = /(^|\.)teamtailor\.com$/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /teamtailor\.com/i.test(u.hostname)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/teamtailor\.com/i.test(url)) return true;
    }
    if (doc) {
      try {
        if (
          doc.querySelector(
            '#job-application-form, turbo-frame#application_form, [data-controller*="careersite--jobs--form-overlay"], [data-controller*="careersite--form"], [aria-label*="Teamtailor" i], a[href*="teamtailor.com"]'
          )
        ) {
          return true;
        }
        var text = ((doc.body && doc.body.innerText) || '').slice(0, 12000);
        if (/applicant tracking system by\s*teamtailor/i.test(text)) return true;
        if (/teamtailor-cdn\.com|assets-aws\.teamtailor/i.test((doc.documentElement && doc.documentElement.innerHTML) || '')) {
          return true;
        }
      } catch (_e2) {}
    }
    return false;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    return String(
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isBlank(v) {
    if (global.FillApplyProfile && typeof global.FillApplyProfile.isBlank === 'function') {
      return global.FillApplyProfile.isBlank(v);
    }
    return v == null || String(v).trim() === '';
  }

  function answerForLabel(profile, label) {
    if (global.FillApplyProfile && typeof global.FillApplyProfile.answerForLabel === 'function') {
      return global.FillApplyProfile.answerForLabel(profile, label);
    }
    var cmap = (profile && profile.customAnswers) || {};
    var want = norm(label);
    var best = null;
    Object.keys(cmap).forEach(function (k) {
      if (norm(k).indexOf(want) !== -1 || want.indexOf(norm(k)) !== -1) {
        if (!isBlank(cmap[k])) best = cmap[k];
      }
    });
    if (best != null) return { value: String(best).trim(), missing: false };
    return { value: null, missing: true, key: label };
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    // Prefer shared sanitizer (number inputs reject "25000 AED")
    if (global.__fillApply && typeof global.__fillApply.sanitizeForInput === 'function') {
      var san = global.__fillApply.sanitizeForInput(el, value);
      if (san.skip) return false;
      value = san.value;
    } else {
      var type0 = String(el.type || '').toLowerCase();
      var im0 = (el.getAttribute && el.getAttribute('inputmode')) || '';
      if (type0 === 'number' || type0 === 'range' || im0 === 'numeric' || im0 === 'decimal') {
        var num0 = '';
        if (global.FillApplyProfile && global.FillApplyProfile.numericAmount) {
          num0 = global.FillApplyProfile.numericAmount(value);
        } else {
          num0 = String(value == null ? '' : value)
            .replace(/(AED|SAR|USD|EUR|GBP|PKR|INR)\b/gi, '')
            .replace(/[£$€¥₹,\s]/g, '');
          var mm = num0.match(/-?\d+(?:\.\d+)?/);
          num0 = mm ? mm[0] : '';
        }
        if (!num0) return false;
        value = num0;
      }
    }
    var str = value == null ? '' : String(value);
    var tag = el.tagName;
    var type = String(el.type || '').toLowerCase();
    if (global.FillApplyFocusHud && global.FillApplyFocusHud.mark) {
      global.FillApplyFocusHud.mark(el, { scroll: true });
    }
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
        var ot = String(el.options[i].text || el.options[i].value || '').toLowerCase();
        if (ot === wantL || ot.indexOf(wantL) !== -1 || wantL.indexOf(ot) !== -1) {
          el.selectedIndex = i;
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
    } catch (_e) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findApplyStart(doc) {
    doc = doc || document;
    var syn = global.FillApplySynonyms;
    // Prefer Teamtailor overlay openers even when sticky/floating fails visible()
    var overlayNodes = doc.querySelectorAll(
      '[data-action*="showFormOverlay"], [data-careersite--jobs--form-overlay-target="coverButton"]'
    );
    var best = null;
    var bestScore = 0;
    for (var o = 0; o < overlayNodes.length; o++) {
      var oel = overlayNodes[o];
      var ot = buttonText(oel);
      if (/share|save|cookie|login|subscribe|upgrade|auto[- ]?apply/i.test(ot)) continue;
      var oScore = 90;
      if (syn && syn.isApplyStartCta && ot && syn.isApplyStartCta(ot)) {
        oScore = Math.max(oScore, (syn.scoreApplyStartText && syn.scoreApplyStartText(ot)) || 95);
      }
      if (/apply for this job/i.test(ot)) oScore = 100;
      if (oScore > bestScore) {
        bestScore = oScore;
        best = oel;
      }
    }
    if (best) return best;

    var nodes = doc.querySelectorAll(
      'button, a, [role="button"], [data-careersite--jobs--form-overlay-target="coverButton"], [data-action*="showFormOverlay"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var action = el.getAttribute('data-action') || '';
      var overlayTarget = el.getAttribute('data-careersite--jobs--form-overlay-target') || '';
      var high =
        /showFormOverlay/i.test(action) ||
        overlayTarget === 'coverButton' ||
        /floating/i.test(el.className || '');
      if (el.disabled && !high) continue;
      if (!visible(el) && !high) continue;
      var t = buttonText(el);
      if (/share|save|cookie|login|subscribe|upgrade|auto[- ]?apply/i.test(t)) continue;
      var score = 0;
      if (syn && syn.isApplyStartCta && t && syn.isApplyStartCta(t)) {
        score = (syn.scoreApplyStartText && syn.scoreApplyStartText(t)) || 80;
      }
      if (/^apply for this job$/i.test(t)) score = 100;
      if (/apply for this (job|role|position)/i.test(t)) score = Math.max(score, 95);
      if (/^apply now$/i.test(t)) score = Math.max(score, 90);
      if (/^apply$/i.test(t) && t.length < 12) score = Math.max(score, 70);
      if (/showFormOverlay/i.test(action) || overlayTarget === 'coverButton') {
        score = Math.max(score, 85);
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

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

  function formRoot(doc) {
    doc = doc || document;
    return (
      doc.querySelector('#job-application-form') ||
      doc.querySelector('turbo-frame#application_form form') ||
      doc.querySelector('turbo-frame#application_form') ||
      doc.querySelector('[data-careersite--jobs--form-overlay-target="form"] form') ||
      doc.querySelector('form[data-controller*="careersite--form"]') ||
      null
    );
  }

  function isFormOpen(doc) {
    var form = formRoot(doc);
    if (!form) return false;
    try {
      // Form may exist hidden in DOM until overlay opens — require visible fields / overlay
      var host =
        form.closest(
          '[role="dialog"], [aria-modal="true"], [data-careersite--jobs--form-overlay-target], turbo-frame#application_form, .modal'
        ) || form;
      var hostVisible = visible(host) || visible(form);
      var inputs = form.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], textarea, select, input[type="radio"]'
      );
      var n = 0;
      var anyVisibleField = false;
      for (var i = 0; i < inputs.length; i++) {
        if (visible(inputs[i])) {
          anyVisibleField = true;
          n++;
        } else if (inputs[i].type === 'radio' && hostVisible) {
          n++;
        }
      }
      if (!hostVisible && !anyVisibleField) return false;
      return n >= 2 || (anyVisibleField && !!form.querySelector('input[name="candidate[first_name]"]'));
    } catch (_e) {
      return false;
    }
  }

  function missingPause(fields, extra) {
    fields = (fields || []).filter(Boolean);
    var seen = {};
    fields = fields.filter(function (f) {
      var k = String(f);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    return Object.assign(
      {
        ok: false,
        adapterId: 'teamtailor',
        needsHuman: true,
        pauseReason: 'missing_profile_field',
        missingProfileFields: fields,
        filled: 0,
        unmatched: fields.length,
        total: fields.length,
        submitted: false,
        error:
          'Missing profile field(s): ' +
          fields.join(', ') +
          ' — fill in Options or on the page, then Resume'
      },
      extra || {}
    );
  }

  function extractYears(profile) {
    var raw =
      profile.yearsExperience ||
      profile.yearsOfExperience ||
      profile.totalYearsExperience ||
      '';
    if (isBlank(raw)) {
      var looked = answerForLabel(profile, 'years of experience');
      if (!looked.missing && !isBlank(looked.value)) raw = looked.value;
    }
    if (isBlank(raw)) {
      var blob = String(profile.workHistory || '') + ' ' + String(profile.resumeSummary || '');
      var m = blob.match(/(\d+)\s*\+?\s*years?/i);
      if (m) raw = m[1];
    }
    if (isBlank(raw)) return null;
    var n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
    if (isNaN(n)) {
      if (/10\+|15\+|20\+/i.test(String(raw))) return 15;
      return null;
    }
    return n;
  }

  function yearsBucket(n) {
    if (n == null || isNaN(n)) return null;
    if (n >= 10) return '10+';
    if (n >= 6) return '6-9';
    if (n >= 3) return '3-5';
    return '0-2';
  }

  function mapNotice(profile) {
    var v = profile.noticePeriod;
    if (isBlank(v)) {
      var looked = answerForLabel(profile, 'notice period');
      if (!looked.missing) v = looked.value;
    }
    if (isBlank(v)) return null;
    var s = String(v).toLowerCase();
    if (/on\s*spot|immediate|immediately|asap|available now|can start/i.test(s)) return 'Onspot';
    if (/\b15\b/.test(s)) return '15 days';
    if (/\b30\b|one month|1 month/i.test(s)) return '30 days';
    if (/\b60\b|two months|2 months/i.test(s)) return '60 days';
    return String(v).trim();
  }

  function salaryValue(profile, forNumberInput) {
    var keys = [
      'currentSalary',
      'salary',
      'Current monthly salary',
      'Current Salary',
      'current salary',
      'Expected Salary / salary expectation'
    ];
    var raw = null;
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(profile, keys[i]) && !isBlank(profile[keys[i]])) {
        raw = String(profile[keys[i]]).trim();
        break;
      }
      var looked = answerForLabel(profile, keys[i]);
      if (!looked.missing && !isBlank(looked.value)) {
        raw = String(looked.value).trim();
        break;
      }
    }
    if (raw == null) return null;
    if (forNumberInput) {
      var n = '';
      if (global.FillApplyProfile && global.FillApplyProfile.numericAmount) {
        n = global.FillApplyProfile.numericAmount(raw);
      } else if (global.__fillApply && global.__fillApply.numericAmount) {
        n = global.__fillApply.numericAmount(raw);
      } else {
        n = String(raw)
          .replace(/(AED|SAR|USD|EUR|GBP|PKR|INR)\b/gi, '')
          .replace(/[£$€¥₹,\s]/g, '');
        var m2 = n.match(/-?\d+(?:\.\d+)?/);
        n = m2 ? m2[0] : '';
      }
      return n || null;
    }
    return raw;
  }

  function clickChoiceByLabel(root, questionRe, optionReOrText) {
    root = root || document;
    var fieldsets = root.querySelectorAll('fieldset, [role="group"], .group, div');
    for (var i = 0; i < fieldsets.length; i++) {
      var fs = fieldsets[i];
      var head =
        (fs.querySelector('legend, label.font-medium, .font-medium') || fs).textContent || '';
      if (!questionRe.test(head.slice(0, 240))) continue;
      var radios = fs.querySelectorAll('input[type="radio"], [role="radio"]');
      for (var j = 0; j < radios.length; j++) {
        var r = radios[j];
        var lab = '';
        if (r.id) {
          var byFor = root.querySelector('label[for="' + r.id + '"]');
          if (byFor) lab = buttonText(byFor);
        }
        if (!lab) lab = buttonText(r) || r.value || '';
        var ok =
          typeof optionReOrText === 'string'
            ? norm(lab) === norm(optionReOrText) ||
              norm(lab).indexOf(norm(optionReOrText)) === 0 ||
              new RegExp('^' + optionReOrText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(
                lab
              )
            : optionReOrText.test(lab);
        if (ok) {
          try {
            r.click();
          } catch (_e) {}
          try {
            r.checked = true;
            r.dispatchEvent(new Event('change', { bubbles: true }));
            r.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_e2) {}
          return true;
        }
      }
      // boolean yes/no
      var boolYes = fs.querySelector('[data-forms--inputs--boolean-target="yes"], input[type="radio"][value="true"]');
      var boolNo = fs.querySelector('input[type="radio"][value="false"]');
      if (boolYes || boolNo) {
        var wantYes =
          typeof optionReOrText === 'string'
            ? /^yes$/i.test(optionReOrText)
            : optionReOrText.test('yes');
        var target = wantYes ? boolYes : boolNo;
        if (target) {
          try {
            target.click();
          } catch (_e3) {}
          return true;
        }
      }
    }
    return false;
  }

  function fillTextByQuestion(root, questionRe, value) {
    if (isBlank(value)) return false;
    root = root || document;
    var labels = root.querySelectorAll('label, legend');
    for (var i = 0; i < labels.length; i++) {
      var lab = buttonText(labels[i]);
      if (!questionRe.test(lab)) continue;
      var el = null;
      if (labels[i].htmlFor) {
        el = root.getElementById
          ? root.getElementById(labels[i].htmlFor)
          : document.getElementById(labels[i].htmlFor);
      }
      if (!el) {
        var wrap = labels[i].closest('fieldset, .group, div') || labels[i].parentElement;
        if (wrap) el = wrap.querySelector('input[type="text"], input[type="number"], input:not([type]), textarea');
      }
      if (el) return setNativeValue(el, value);
    }
    return false;
  }

  function fillPersonal(root, profile) {
    var filled = 0;
    var map = [
      { sel: 'input[name="candidate[first_name]"]', key: 'firstName' },
      { sel: 'input[name="candidate[last_name]"]', key: 'lastName' },
      { sel: 'input[name="candidate[email]"]', key: 'email' },
      { sel: 'input[name="candidate[phone]"], input[type="tel"]', key: 'phone' }
    ];
    for (var i = 0; i < map.length; i++) {
      var el = root.querySelector(map[i].sel);
      var val = profile[map[i].key];
      if (map[i].key === 'firstName' && isBlank(val) && profile.fullName) {
        val = String(profile.fullName).trim().split(/\s+/)[0];
      }
      if (map[i].key === 'lastName' && isBlank(val) && profile.fullName) {
        var parts = String(profile.fullName).trim().split(/\s+/);
        if (parts.length > 1) val = parts.slice(1).join(' ');
      }
      if (el && !isBlank(val)) {
        if (setNativeValue(el, val)) filled++;
      }
    }
    return filled;
  }

  function attachFiles(documents) {
    var Files = global.FillApplyFiles;
    if (!Files || typeof Files.attachDocuments !== 'function') {
      return { ok: false, resumeAttached: false, coverAttached: false, attached: [] };
    }
    return (
      Files.attachDocuments(documents || {}, [
        { kind: 'resume', match: 'resume|cv|curriculum|upload', selector: 'input[type=file]' },
        { kind: 'cover', match: 'cover', selector: 'input[type=file]' }
      ]) || { ok: false, resumeAttached: false, coverAttached: false, attached: [] }
    );
  }

  function clickSubmit(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'input[type="submit"], button[type="submit"], button, [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.disabled) continue;
      var t = buttonText(el) || el.value || '';
      if (/^submit application$/i.test(t) || /submit application/i.test(t)) {
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    return false;
  }

  function ensureConsent(root) {
    var cb =
      root.querySelector('input[name="candidate[consent_given]"]') ||
      root.querySelector('input[type="checkbox"][id*="consent" i]');
    if (cb && !cb.checked) {
      try {
        cb.click();
      } catch (_e) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  var adapter = {
    id: 'teamtailor',
    name: 'Teamtailor',
    category: 'ats',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'input[type="submit"][value*="Submit" i], button[type="submit"], input[name="commit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|curriculum|upload' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var profile = ctx.profile || {};
      var documents = ctx.documents || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';
      var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);

      if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
        var ch = global.FillApplyChallenges.detectChallenge(doc);
        if (ch && ch.challenged) {
          return {
            ok: false,
            adapterId: 'teamtailor',
            needsHuman: true,
            challenge: ch,
            filled: 0,
            unmatched: 0,
            total: 0,
            error:
              (global.FillApplyChallenges.describeChallenge &&
                global.FillApplyChallenges.describeChallenge(ch)) ||
              'Human verification required',
            pauseReason: 'challenge'
          };
        }
      }

      return Promise.resolve().then(async function () {
        // 1) Open apply modal if still on job overview
        if (!isFormOpen(doc)) {
          var applyBtn = findApplyStart(doc);
          if (applyBtn) {
            clickApplyEl(applyBtn);
            await sleep(700 + Math.floor(Math.random() * 400));
            // turbo-frame may still be loading
            for (var w = 0; w < 10 && !isFormOpen(doc); w++) {
              await sleep(350);
            }
            if (!isFormOpen(doc)) {
              // Same-page modal may need runner re-inject after overlay paints
              return {
                ok: true,
                adapterId: 'teamtailor',
                clickedApplyStart: true,
                reDetect: true,
                handedOff: true,
                deferToPageAdapter: true,
                filled: 0,
                unmatched: 0,
                total: 0,
                submitted: false,
                message:
                  'Clicked Apply for this job (Teamtailor) — waiting for apply modal, then re-detect'
              };
            }
          } else {
            // Universal open helper as fallback
            if (global.__fillApply && global.__fillApply.tryOpenApplication) {
              var opened = global.__fillApply.tryOpenApplication({});
              if (opened && opened.clickedApplyStart) {
                opened.adapterId = 'teamtailor';
                return opened;
              }
            }
            return {
              ok: false,
              adapterId: 'teamtailor',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              error: 'No Apply button found on this page'
            };
          }
        }

        var root = formRoot(doc) || doc;
        var missing = [];
        var filled = 0;

        // Years of experience
        var years = extractYears(profile);
        var bucket = yearsBucket(years);
        if (!bucket) {
          missing.push('yearsExperience');
        } else if (
          clickChoiceByLabel(
            root,
            /total years of working experience|years of (working )?experience/i,
            bucket
          )
        ) {
          filled++;
        } else {
          missing.push('yearsExperience');
        }

        // Current salary (required)
        var sal = salaryValue(profile);
        if (isBlank(sal)) {
          missing.push('currentSalary');
        } else if (
          fillTextByQuestion(root, /current salary|share your current salary/i, sal) ||
          (function () {
            var el = root.querySelector(
              'input[name*="answers_attributes"][type="number"], input[pattern*="0-9"]'
            );
            // Prefer the salary-labeled input
            var labels = root.querySelectorAll('label');
            for (var li = 0; li < labels.length; li++) {
              if (/current salary/i.test(buttonText(labels[li]))) {
                var id = labels[li].htmlFor;
                var inp = id ? document.getElementById(id) : null;
                if (inp) {
                  var salForInp =
                    String(inp.type || '').toLowerCase() === 'number'
                      ? salaryValue(profile, true) || sal
                      : sal;
                  return setNativeValue(inp, salForInp);
                }
              }
            }
            return false;
          })()
        ) {
          filled++;
        } else {
          missing.push('currentSalary');
        }

        // Notice period
        var notice = mapNotice(profile);
        if (!notice) {
          missing.push('noticePeriod');
        } else {
          var noticeOpt = notice;
          if (/onspot/i.test(notice)) noticeOpt = 'Onspot';
          else if (/15/.test(notice)) noticeOpt = /15 days/i.test(notice) ? '15 days' : notice;
          else if (/30/.test(notice)) noticeOpt = /30 days/i.test(notice) ? '30 days' : notice;
          else if (/60/.test(notice)) noticeOpt = /60 days/i.test(notice) ? '60 days' : notice;
          if (clickChoiceByLabel(root, /notice period/i, noticeOpt)) filled++;
          else missing.push('noticePeriod');
        }

        // Citizenship
        var citizen = profile.nationality;
        if (isBlank(citizen)) {
          var cLook = answerForLabel(profile, 'citizenship');
          if (!cLook.missing) citizen = cLook.value;
        }
        if (isBlank(citizen)) {
          missing.push('nationality');
        } else if (fillTextByQuestion(root, /citizenship/i, citizen)) {
          filled++;
        } else {
          missing.push('nationality');
        }

        // Based in Riyadh? — Yes only if location contains Riyadh; else use customAnswers / No
        var loc = String(
          profile.location ||
            profile.city ||
            (profile.customAnswers && profile.customAnswers['Primary work location']) ||
            ''
        );
        var riyadhLook = answerForLabel(profile, 'based in riyadh');
        if (riyadhLook.missing) riyadhLook = answerForLabel(profile, 'Currently based in Riyadh');
        if (/riyadh/i.test(loc)) {
          if (clickChoiceByLabel(root, /based in riyadh/i, /^yes$/i)) filled++;
          else missing.push('location(Riyadh)');
        } else if (!riyadhLook.missing && !isBlank(riyadhLook.value)) {
          var wantYes = /^yes$/i.test(String(riyadhLook.value).trim());
          if (clickChoiceByLabel(root, /based in riyadh/i, wantYes ? /^yes$/i : /^no$/i)) filled++;
          else missing.push('basedInRiyadh');
        } else if (String(loc).trim()) {
          // Location set and not Riyadh → answer No (not inventing Yes)
          if (clickChoiceByLabel(root, /based in riyadh/i, /^no$/i)) filled++;
          else missing.push('basedInRiyadh');
        } else {
          missing.push('basedInRiyadh (set location or customAnswers)');
        }

        // Largest team size — customAnswers only
        var teamLook = answerForLabel(profile, 'largest team size');
        if (teamLook.missing || isBlank(teamLook.value)) {
          missing.push('customAnswers.largestTeamSize');
        } else {
          var tv = String(teamLook.value).trim();
          var teamRe = null;
          if (/1\s*[-–]\s*5|^1-5$|^\s*1\s*to\s*5/i.test(tv) || /^[1-5]$/.test(tv)) teamRe = /1-5/;
          else if (/11|12|13|14|15|16|17|18|19|20|11\s*-\s*20/i.test(tv)) teamRe = /11\s*-\s*20/;
          else if (/50|100|50-100/i.test(tv)) teamRe = /50-100/;
          else if (/200|more than/i.test(tv)) teamRe = /more than 200/;
          else teamRe = new RegExp(tv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          if (clickChoiceByLabel(root, /largest team size/i, teamRe)) filled++;
          else missing.push('customAnswers.largestTeamSize');
        }

        // شهادة تربوية
        var certLook = answerForLabel(profile, 'شهادة تربوية');
        if (certLook.missing) certLook = answerForLabel(profile, 'educational certificate');
        if (certLook.missing || isBlank(certLook.value)) {
          missing.push('customAnswers.شهادة تربوية');
        } else {
          var cv = String(certLook.value).trim();
          var cRe = /yes/i.test(cv)
            ? /^yes$/i
            : /progress/i.test(cv)
              ? /currently in progress/i
              : /^no$/i;
          if (clickChoiceByLabel(root, /شهادة تربوية|educational/i, cRe)) filled++;
          else missing.push('customAnswers.شهادة تربوية');
        }

        // Previously recruited/hired
        var hireLook = answerForLabel(profile, 'recruited');
        if (hireLook.missing) hireLook = answerForLabel(profile, 'previously recruited');
        if (hireLook.missing) hireLook = answerForLabel(profile, 'hired members');
        if (hireLook.missing || isBlank(hireLook.value)) {
          missing.push('customAnswers.previouslyRecruited');
        } else {
          var hv = String(hireLook.value).trim();
          var hRe = new RegExp(hv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40), 'i');
          if (clickChoiceByLabel(root, /previously recruited|hired members/i, hRe)) filled++;
          else missing.push('customAnswers.previouslyRecruited');
        }

        // Computer tools / operational data rating
        var toolsLook = answerForLabel(profile, 'computer tools');
        if (toolsLook.missing) toolsLook = answerForLabel(profile, 'operational data');
        if (toolsLook.missing) toolsLook = answerForLabel(profile, 'rate your ability');
        if (toolsLook.missing || isBlank(toolsLook.value)) {
          missing.push('customAnswers.computerToolsRating');
        } else {
          var tval = String(toolsLook.value).trim();
          var tRe = new RegExp(tval.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 48), 'i');
          if (clickChoiceByLabel(root, /computer tools|operational data/i, tRe)) filled++;
          else missing.push('customAnswers.computerToolsRating');
        }

        // Why hire / first 6 months / metrics — coverLetter / resumeSummary / customAnswers (never invent)
        var why =
          (function () {
            var w = answerForLabel(profile, 'why should we hire');
            if (!w.missing && !isBlank(w.value)) return w.value;
            w = answerForLabel(profile, 'first 6 months');
            if (!w.missing && !isBlank(w.value)) return w.value;
            if (!isBlank(profile.coverLetter) && !/^I am excited to apply for this role\. My experience filling/i.test(profile.coverLetter)) {
              return profile.coverLetter;
            }
            if (!isBlank(profile.resumeSummary) && !/Full-stack engineer with 6\+/i.test(profile.resumeSummary)) {
              return profile.resumeSummary;
            }
            // Reject Alex sample cover letter / summary
            if (!isBlank(profile.coverLetter) && !/alex\.rivera@example\.com|Alex Rivera/i.test(JSON.stringify(profile))) {
              return profile.coverLetter;
            }
            return null;
          })();
        // Stricter: never use obvious sample Alex boilerplate
        if (
          why &&
          (/I am excited to apply for this role\. My experience filling and shipping/i.test(why) ||
            /Full-stack engineer with 6\+ years building web products/i.test(why))
        ) {
          why = null;
        }
        if (isBlank(why)) {
          missing.push('coverLetter/whyHire (customAnswers)');
        } else if (
          fillTextByQuestion(
            root,
            /why should we hire|first 6 months|which metrics/i,
            why
          )
        ) {
          filled++;
        } else {
          missing.push('coverLetter/whyHire (customAnswers)');
        }

        // Personal info
        filled += fillPersonal(root, profile);

        // Cover letter field (separate from why-hire essay)
        if (!isBlank(profile.coverLetter) && !/I am excited to apply for this role\. My experience filling and shipping/i.test(profile.coverLetter)) {
          var coverEl = root.querySelector(
            'textarea[name*="cover_letter"], textarea[id*="cover_letter"]'
          );
          if (coverEl && setNativeValue(coverEl, profile.coverLetter)) filled++;
        }

        // Files
        var filesAttached = attachFiles(documents);
        if (filesAttached && filesAttached.resumeAttached) filled++;
        if (filesAttached && filesAttached.coverAttached) filled++;

        // Privacy consent — check when present (not inventing data)
        ensureConsent(root);

        if (missing.length && (runMode === 'ready' || runMode === 'submit')) {
          var pause = missingPause(missing, {
            filled: filled,
            resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
            coverAttached: !!(filesAttached && filesAttached.coverAttached),
            filesAttached: filesAttached,
            runMode: runMode
          });
          return pause;
        }
        // In fill mode still report missing but allow partial fill without hard pause
        // (high-alert pause is for ready/submit). User asked empty → needsHuman — apply for required when submit/ready.
        // Also pause in fill if critical blanks to avoid silent false success:
        if (missing.length && runMode === 'fill' && filled === 0) {
          return missingPause(missing, {
            filled: filled,
            filesAttached: filesAttached,
            runMode: runMode
          });
        }
        if (missing.length && runMode === 'fill') {
          // Soft: continue but include missingProfileFields for UI
        }

        var submitted = false;
        if (runMode === 'submit') {
          if (missing.length) {
            return missingPause(missing, {
              filled: filled,
              resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
              coverAttached: !!(filesAttached && filesAttached.coverAttached),
              filesAttached: filesAttached,
              runMode: runMode
            });
          }
          submitted = clickSubmit(doc);
          if (submitted) await sleep(400);
        }

        return {
          ok: true,
          adapterId: 'teamtailor',
          filled: filled,
          unmatched: missing.length,
          total: filled + missing.length,
          submitted: !!submitted,
          resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
          coverAttached: !!(filesAttached && filesAttached.coverAttached),
          filesAttached: filesAttached,
          runMode: runMode,
          missingProfileFields: missing.length ? missing : undefined,
          message: missing.length
            ? 'Teamtailor partially filled; missing: ' + missing.join(', ')
            : undefined
        };
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApplyTeamtailorAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
