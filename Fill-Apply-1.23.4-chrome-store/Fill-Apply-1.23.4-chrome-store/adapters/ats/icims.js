/**
 * iCIMS adapter — careers / apply flows often reached via LinkedIn External Apply
 * (examples: PepsiCo → globalcareers-pepsico.icims.com; Riyadh Air careers → iCIMS —
 * richer Candidate Profile than PepsiCo).
 *
 * Detection: icims.com hosts, "Powered by iCIMS", "Software Powered by ICIMS",
 * classic iCIMS job form chrome.
 *
 * Multi-step (operator paste — Riyadh Air richer profile):
 *   Welcome: Email + privacy I accept + Next (hCaptcha may appear)
 *   Candidate Profile (logged in / SSO Connected): CV/Resume upload*, passport names*,
 *     nationality*, gender*, email*, mobile country+number*, residential city/country*,
 *     notice period*, employment + education blocks, prior employer / relative No defaults,
 *     marketing consent prefer No, Create login → auth pause UNLESS SSO Connected/Disconnect,
 *     Submit Profile (submit mode only)
 *   Candidate Questions (e.g. over 18*) → Yes; Finish Later vs Submit (submit clicks Submit)
 *   Job Specific Questions → customAnswers / pause unknown required in submit
 *
 * Auth rule: Sign Up / Sign In / Register / Login / Create a login / Returning Candidate
 * "Log back in" → needsHuman pause when profile has no password.
 * v1.18.7: when profile.password is set, FillApplySignupLogin may fill
 * Email/Password (+ retype). NEVER invent passwords.
 * Exception: Connected / Disconnect (social SSO) without Password Re-enter → authenticated.
 *
 * Modes:
 *   fill / ready — fill fields + Next/Continue; NEVER Submit Profile / final submit
 *   submit — fill then Submit Profile / submit when complete (only after auth gate cleared)
 *
 * EEO / diversity: Skip/decline if available — never invent.
 * Captcha → needsHuman via challenges.js.
 */
(function (global) {
  'use strict';

  var HOSTS = ['icims.com', 'www.icims.com'];
  var HOST_RE = /(^|\.)icims\.com$/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || /icims\.com/i.test(u.hostname)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        var h = HOSTS[i].replace(/^www\./, '');
        if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) {
          return true;
        }
      }
    } catch (_e) {
      if (/icims\.com/i.test(url)) return true;
    }
    if (doc) {
      try {
        var text = ((doc.body && doc.body.innerText) || '').slice(0, 10000);
        if (/software\s+powered\s+by\s+icims/i.test(text)) return true;
        if (/powered\s+by\s+icims/i.test(text)) return true;
        if (
          doc.querySelector(
            '.iCIMS_JobForm, #icims_content_iframe, [class*="iCIMS"], [id*="icims"], a[href*="icims.com"], img[alt*="iCIMS" i]'
          )
        ) {
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

  function humanDelay(base) {
    var b = typeof base === 'number' ? base : 400;
    return b + Math.floor(Math.random() * 300);
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
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title'))) ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pageText(doc) {
    try {
      return doc && doc.body ? String(doc.body.innerText || '').slice(0, 14000) : '';
    } catch (_e) {
      return '';
    }
  }

  function challengePause(doc, filled) {
    if (!(global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge)) return null;
    var ch = global.FillApplyChallenges.detectChallenge(doc);
    if (!ch || !ch.challenged) return null;
    return {
      ok: false,
      adapterId: 'icims',
      needsHuman: true,
      challenge: ch,
      pauseReason: 'challenge',
      error:
        (global.FillApplyChallenges.describeChallenge && global.FillApplyChallenges.describeChallenge(ch)) ||
        'iCIMS: human verification / hCaptcha required — complete it, then Resume.',
      filled: filled || 0,
      unmatched: 0,
      total: filled || 0,
      submitted: false
    };
  }

  /**
   * Social SSO Connected / Disconnect without Password Re-enter create-login
   * → treat as authenticated (skip auth pause).
   */
  function isSsoConnected(doc) {
    doc = doc || document;
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.isSsoConnected) {
      return !!global.FillApplyAuthWalls.isSsoConnected(doc);
    }
    // Inline password visibility check (avoid depending on later helper order)
    var pwEarly = doc.querySelectorAll('input[type="password"]');
    for (var pwi = 0; pwi < pwEarly.length; pwi++) {
      if (visible(pwEarly[pwi])) return false;
    }
    var text = pageText(doc);
    if (/password\s*re-?enter/i.test(text) && /create a login/i.test(text)) return false;
    var sawConnected = false;
    var sawDisconnect = false;
    var nodes = doc.querySelectorAll('a, button, [role="button"], span, div, label, p, li');
    for (var i = 0; i < nodes.length && i < 500; i++) {
      var el = nodes[i];
      if (!visible(el) && el.offsetParent === null) continue;
      var t = buttonText(el).slice(0, 80);
      if (!t || t.length > 48) continue;
      var trim = t.trim();
      if (/^connected$/i.test(trim)) sawConnected = true;
      if (/^disconnect$/i.test(trim)) sawDisconnect = true;
    }
    if (sawConnected && sawDisconnect) return true;
    if (
      (sawConnected || sawDisconnect) &&
      /\b(linkedin|google|microsoft|facebook|apple|sso|social)\b/i.test(text) &&
      !/password\s*re-?enter/i.test(text)
    ) {
      return true;
    }
    return /\bsso\s*connected\b|\bconnected\s+to\s+(linkedin|google|microsoft)/i.test(text);
  }

  /**
   * Create a login / Password Re-enter / Returning Candidate / Sign in / Register
   * → human gate. Never invent credentials.
   * Skip when SSO Connected / Disconnect is shown (no password create fields).
   */
  function detectAuthWall(doc) {
    doc = doc || document;
    if (isSsoConnected(doc)) {
      return {
        challenged: false,
        kind: null,
        detail: 'SSO connected',
        markers: ['sso_connected'],
        passwordFields: 0,
        ssoConnected: true
      };
    }
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.detectAuthWall) {
      return global.FillApplyAuthWalls.detectAuthWall(doc, {
        extraPhrases: ['create a login', 'returning candidate', 'log back in', 'password re-enter']
      });
    }
    if (global.FillApplyChallenges && global.FillApplyChallenges.detectAuthWall) {
      return global.FillApplyChallenges.detectAuthWall(doc);
    }
    // Local fallback
    var text = pageText(doc);
    var pw = doc.querySelectorAll('input[type="password"]');
    var visiblePw = 0;
    for (var i = 0; i < pw.length; i++) {
      if (visible(pw[i]) || pw[i].offsetParent !== null) visiblePw++;
    }
    var strong =
      /create a login|returning candidate|log back in|password\s*re-?enter|create (an )?account/i.test(text) ||
      (visiblePw >= 1 && /\bsign\s*in\b|\blog\s*in\b|\bregister\b|\bsign\s*up\b/i.test(text));
    if (!strong) return { challenged: false, kind: null, detail: '', markers: [], passwordFields: visiblePw };
    return {
      challenged: true,
      kind: 'auth_wall',
      detail: 'iCIMS account required — sign in/register manually, then Resume',
      markers: ['local fallback'],
      passwordFields: visiblePw
    };
  }

  function authWallPause(doc, filled, profile) {
    if (isSsoConnected(doc)) return null;
    var wall = detectAuthWall(doc);
    if (!wall || !wall.challenged) return null;
    // Profile password present → do not pause; signup-login / fill will use it.
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.canAutoFillCredentials) {
      if (global.FillApplyAuthWalls.canAutoFillCredentials(profile || {})) return null;
    } else if (global.FillApplySignupLogin && global.FillApplySignupLogin.profileHasCredentials) {
      if (global.FillApplySignupLogin.profileHasCredentials(profile || {})) return null;
    }
    return {
      ok: false,
      adapterId: 'icims',
      needsHuman: true,
      challenge: wall,
      pauseReason: 'auth_wall',
      error: 'iCIMS account required — sign in/register manually, then Resume (no profile password)',
      filled: filled || 0,
      unmatched: 0,
      total: filled || 0,
      submitted: false,
      message: 'iCIMS account required — sign in/register manually, then Resume (no profile password)'
    };
  }

  function hasPasswordCreateFields(doc) {
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.hasPasswordCreateFields) {
      return global.FillApplyAuthWalls.hasPasswordCreateFields(doc);
    }
    var pw = doc.querySelectorAll('input[type="password"]');
    for (var i = 0; i < pw.length; i++) {
      if (visible(pw[i])) return true;
    }
    return false;
  }

  /** True when we should pause for account create / sign-in (not when SSO connected or profile password set). */
  function needsAuthPause(doc, profile) {
    if (isSsoConnected(doc)) return false;
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.canAutoFillCredentials) {
      if (global.FillApplyAuthWalls.canAutoFillCredentials(profile || {})) return false;
    } else if (global.FillApplySignupLogin && global.FillApplySignupLogin.profileHasCredentials) {
      if (global.FillApplySignupLogin.profileHasCredentials(profile || {})) return false;
    }
    if (hasPasswordCreateFields(doc)) return true;
    var wall = detectAuthWall(doc);
    return !!(wall && wall.challenged);
  }

  function isEeoLabel(label) {
    return /diversity|eeo|equal opportunity|race|ethnicity|veteran|disability|sexual orientation|lgbt|transgender|hispanic|latino|voluntary self.?identif|decline to (self-)?identify|prefer not to|gender identity|gender\b|protected veteran|disability status/i.test(
      norm(label)
    );
  }

  function isEeoStep(doc) {
    var text = pageText(doc);
    return /eeo|equal employment|voluntary self.?identif|diversity|race\/ethnicity|protected veteran/i.test(text) &&
      !/create a login/i.test(text);
  }

  function isCandidateProfileStep(doc) {
    var text = pageText(doc);
    return (
      /candidate profile|step\s*1\s*\/\s*5|create a login|resume upload|cv upload|submit profile/i.test(
        text
      ) ||
      (/notice\s*period|nationality|employment details|qualification type/i.test(text) &&
        /first name|last name/i.test(text)) ||
      (!!doc.querySelector('input[type="file"]') &&
        /first name|last name/i.test(text) &&
        /phone|address|cv|resume/i.test(text))
    );
  }

  function isQuestionsStep(doc) {
    var text = pageText(doc);
    return /candidate questions|job specific questions|questionnaire|portal specific forms|screening question/i.test(
      text
    );
  }

  function profileVal(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') return String(profile[key]).trim();
    return '';
  }

  function labelFor(el, doc) {
    doc = doc || document;
    if (!el) return '';
    if (global.__fillApply && global.__fillApply.getLabelText) {
      var t = global.__fillApply.getLabelText(el);
      if (t) return t;
    }
    try {
      if (el.id) {
        var esc = el.id;
        try {
          if (typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(el.id);
        } catch (_eEsc) {}
        var lab = doc.querySelector('label[for="' + esc + '"]');
        if (lab) return buttonText(lab);
      }
      var parent = el.closest(
        'label, .form-group, .field, [class*="field"], [class*="Form"], .iCIMS_JobFormField, .iCIMS_FormField'
      );
      if (parent) return buttonText(parent).slice(0, 220);
    } catch (_e) {}
    return String(el.getAttribute('aria-label') || el.name || el.placeholder || '');
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);
    // Password: never invent — only write a non-empty caller-supplied value
    // (FillApplySignupLogin / profile password). Empty → skip.
    if (type === 'password' && !String(str).trim()) return false;

    if (type === 'checkbox') {
      var want = /^(yes|y|true|1|on|accept|i accept|agree)$/i.test(str) || str === true;
      if (el.checked !== want) {
        try {
          el.click();
        } catch (_e) {}
        if (el.checked !== want) {
          el.checked = want;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    }

    if (el.tagName === 'SELECT') {
      if (global.__fillApply && global.__fillApply.matchSelectOption) {
        return !!global.__fillApply.matchSelectOption(el, str);
      }
      var wantL = str.toLowerCase();
      for (var i = 0; i < el.options.length; i++) {
        var opt = el.options[i];
        var ot = (opt.textContent || '').trim().toLowerCase();
        var ov = String(opt.value || '').toLowerCase();
        if (ot === wantL || ov === wantL || (wantL && ot.indexOf(wantL) !== -1)) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    try {
      var proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_e2) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function answerFromCustom(profile, label) {
    var lab = norm(label);
    if (!lab) return null;
    var map = profile && profile.customAnswers;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      var keys = Object.keys(map);
      var best = null;
      var bestScore = 0;
      for (var i = 0; i < keys.length; i++) {
        var k = norm(keys[i]);
        if (!k) continue;
        if (lab.indexOf(k) !== -1 || k.indexOf(lab) !== -1) {
          var score = Math.min(k.length, lab.length);
          if (score > bestScore) {
            bestScore = score;
            best = map[keys[i]];
          }
        }
      }
      if (best != null && String(best).trim() !== '') return String(best).trim();
    }
    if (global.FillApplyFieldMap && global.FillApplyFieldMap.matchCustomQA) {
      var qa = global.FillApplyFieldMap.matchCustomQA(profile.customQA, label, '');
      if (qa) return qa;
    }
    return null;
  }

  function yesNoHeuristic(profile, label) {
    var custom = answerFromCustom(profile, label);
    if (custom != null) return custom;
    var lab = norm(label);
    if (/sponsor|visa/.test(lab)) return profileVal(profile, 'requiresSponsorship') || 'No';
    if (/authorized|legally|work authorization|eligible to work|right to work/.test(lab)) {
      return profileVal(profile, 'authorizedToWork') || 'Yes';
    }
    // Previously employed by this company / Riyadh Air — default No
    if (
      /previously (been )?employed|previously worked|worked (at|for|with)|prior (employment|employee)|former employee|employed by .{0,40}(riyadh|company|organisation|organization|employer)/.test(
        lab
      )
    ) {
      return answerFromCustom(profile, label) || 'No';
    }
    // Relative employed at company — default No
    if (/relative.{0,60}employ|family member.{0,60}employ|know anyone.{0,40}(employ|work)|employed at .{0,40}relative/.test(lab)) {
      return answerFromCustom(profile, label) || 'No';
    }
    // Marketing / promotional consent — prefer No (privacy) unless customAnswers Yes
    if (/marketing|promotional|newsletter|receive .{0,20}(email|sms|communication|update)|opt.?in|stay informed|contact me about/.test(lab)) {
      return answerFromCustom(profile, label) || 'No';
    }
    if (/willing to relocate|able to relocate|travel/.test(lab)) {
      return answerFromCustom(profile, label) || 'Yes';
    }
    if (/18 years|over 18|over the age of 18|at least 18|age of 18/.test(lab)) {
      return answerFromCustom(profile, label) || 'Yes';
    }
    // Currently employed / current employer Yes/No — leave to employment filler / custom
    if (/currently employ|current employer|are you (currently )?employed/.test(lab)) {
      return answerFromCustom(profile, label) || '';
    }
    return answerFromCustom(profile, label) || '';
  }

  /**
   * Careers job detail (e.g. pepsicojobs.com) → Apply Now before iCIMS welcome.
   */
  function ensureApplyView(doc) {
    doc = doc || document;
    var text = pageText(doc);
    if (/i accept/i.test(text) && /e-?mail/i.test(text) && /next/i.test(text)) {
      return { clicked: false, kind: 'welcome' };
    }
    if (doc.querySelector('.iCIMS_JobForm, form[action*="icims" i], input[type="email"]')) {
      return { clicked: false, kind: 'form' };
    }

    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (!t || /premium|tailor|login|sign in|share|save/i.test(t)) continue;
      var score = 0;
      if (/^apply now$/i.test(t)) score = 100;
      else if (/^apply$/i.test(t) && t.length < 12) score = 80;
      else if (/apply for this (job|position|role)/i.test(t)) score = 90;
      else if (/\bapply now\b/i.test(t)) score = 85;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      try {
        best.click();
      } catch (_e) {}
      return { clicked: true, kind: 'apply' };
    }
    return { clicked: false };
  }

  function isWelcomeStep(doc) {
    var text = pageText(doc);
    var hasEmail = !!doc.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
    var hasAccept = /i accept/i.test(text) || !!doc.querySelector('input[type="checkbox"]');
    var hasNext = false;
    var nodes = doc.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      if (/^next$/i.test(buttonText(nodes[i]).trim())) {
        hasNext = true;
        break;
      }
    }
    var powered = /powered by\s*icims|software powered by icims/i.test(text);
    var welcomeCopy = /welcome|start your application|begin application|i accept/i.test(text);
    // Welcome is Email + I accept + Next — NOT the Candidate Profile create-login step
    if (/create a login|candidate profile|submit profile/i.test(text)) return false;
    return hasEmail && hasAccept && hasNext && (powered || welcomeCopy);
  }

  function fillWelcomeStep(doc, profile) {
    var filled = 0;
    var email = profileVal(profile, 'email');
    var emailInputs = doc.querySelectorAll(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]'
    );
    for (var i = 0; i < emailInputs.length; i++) {
      var el = emailInputs[i];
      if (!visible(el) || el.disabled) continue;
      if (String(el.type || '').toLowerCase() === 'password') continue;
      if (email && setNativeValue(el, email)) filled++;
    }

    var checks = doc.querySelectorAll('input[type="checkbox"]');
    for (var c = 0; c < checks.length; c++) {
      var cb = checks[c];
      if (!visible(cb) && cb.offsetParent === null) continue;
      var lab = labelFor(cb, doc) + ' ' + buttonText(cb.closest('label') || cb);
      if (/i accept|privacy|terms|consent|agree|policy/i.test(lab) || /i accept/i.test(pageText(doc))) {
        if (!cb.checked) {
          if (setNativeValue(cb, 'Yes')) filled++;
        } else {
          filled++;
        }
      }
    }
    var labels = doc.querySelectorAll('label, span, div');
    for (var l = 0; l < labels.length; l++) {
      var node = labels[l];
      var nt = buttonText(node).slice(0, 160);
      if (/^i accept/i.test(nt) || /i accept.*privacy|i accept.*terms/i.test(nt)) {
        var inp = node.querySelector('input[type="checkbox"]') || (node.htmlFor && doc.getElementById(node.htmlFor));
        if (inp && !inp.checked) {
          try {
            node.click();
            filled++;
          } catch (_e) {
            try {
              inp.click();
              filled++;
            } catch (_e2) {}
          }
          break;
        }
      }
    }

    return filled;
  }

  function makeFile(Files, docBlob, fallbackName) {
    if (!Files || !docBlob || !docBlob.base64) return null;
    return Files.fileFromBase64(docBlob.base64, docBlob.name || fallbackName, docBlob.mime || 'application/pdf');
  }

  function attachResume(doc, documents) {
    var Files = global.FillApplyFiles;
    if (!Files) return { resumeAttached: false, error: 'FillApplyFiles missing' };
    var resumeFile = makeFile(Files, documents && documents.resume, 'resume.pdf');
    if (!resumeFile) return { resumeAttached: false, error: 'No resume document' };

    var Syn = global.FillApplySynonyms;
    var inputs = doc.querySelectorAll('input[type="file"]');
    var attached = false;
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var lab = labelFor(inp, doc);
      var near =
        lab + ' ' + (inp.name || '') + ' ' + (inp.id || '') + ' ' + (inp.accept || '') + ' ' + (inp.getAttribute('aria-label') || '');
      var nearL = near.toLowerCase();
      // Cover-only inputs — skip
      if (/cover/i.test(nearL) && !/resume|\bcv\b|c\.v\.|curriculum/i.test(nearL)) continue;
      // Match Resume ≈ CV (Riyadh Air labels **CV**; PepsiCo often Resume)
      var isResume =
        /\b(resume|cv|c\.v\.|curriculum\s*vitae)\b/i.test(near) ||
        (Syn && Syn.isResumeLabel && Syn.isResumeLabel(near)) ||
        /^cv\s*\*?$/i.test(String(lab || '').trim()) ||
        /upload.*(resume|cv)|attach.*(resume|cv)|(resume|cv).*upload/i.test(near);
      if (!isResume && !/upload|file|attach|document/i.test(nearL) && inputs.length > 1) continue;
      if (!isResume && inputs.length > 1 && !/upload|attach/i.test(nearL)) continue;
      var r = Files.assignFilesToInput(inp, [resumeFile]);
      if (r && r.ok) {
        attached = true;
        break;
      }
    }
    if (!attached && inputs.length === 1) {
      var only = inputs[0];
      var onlyNear = (labelFor(only, doc) + ' ' + (only.name || '')).toLowerCase();
      if (!/cover/i.test(onlyNear) || /resume|cv/i.test(onlyNear)) {
        var r1 = Files.assignFilesToInput(only, [resumeFile]);
        if (r1 && r1.ok) attached = true;
      }
    }
    if (!attached && Files.attachDocuments) {
      var generic = Files.attachDocuments(documents || {}, [
        { kind: 'resume', match: 'resume|cv|c\\.v\\.|curriculum|upload' },
        { kind: 'cover', match: 'cover' }
      ]);
      attached = !!(generic && generic.resumeAttached);
    }
    return { resumeAttached: attached };
  }

  /**
   * Strip required markers / asterisks for field matching.
   */
  function cleanFieldLabel(lab) {
    return norm(lab)
      .replace(/\*/g, ' ')
      .replace(/\(required\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fieldAlreadyFilled(el) {
    if (!el) return false;
    var type = String(el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return !!el.checked;
    if (el.tagName === 'SELECT') {
      var idx = el.selectedIndex;
      if (idx < 0) return false;
      var opt = el.options[idx];
      var v = String((opt && (opt.value || opt.textContent)) || '').trim();
      if (!v || /^(select|choose|--|please select)/i.test(v)) return false;
      return true;
    }
    return !!(el.value && String(el.value).trim());
  }

  /**
   * Parse free-text workHistory into structured rows.
   * Supports lines like:
   *   "Senior Software Engineer @ Acme Corp (2021–present): …"
   *   "Software Engineer @ StartupXYZ (2018–2021): …"
   */
  function parseWorkHistory(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];
    var lines = raw.split(/\n+/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var title = '';
      var employer = '';
      var start = '';
      var end = '';
      var current = false;
      var city = '';
      var country = '';
      var m =
        line.match(
          /^(.+?)\s+@\s+(.+?)\s*\((\d{4}|\w+\s+\d{4})\s*[–—\-]+\s*(present|current|\d{4}|\w+\s+\d{4})\)/i
        ) ||
        line.match(
          /^(.+?)\s+at\s+(.+?)\s*\((\d{4}|\w+\s+\d{4})\s*[–—\-]+\s*(present|current|\d{4}|\w+\s+\d{4})\)/i
        ) ||
        line.match(/^(.+?),\s*(.+?)\s*\((\d{4})\s*[–—\-]+\s*(present|current|\d{4})\)/i);
      if (m) {
        title = m[1].trim();
        employer = m[2].trim();
        start = m[3].trim();
        end = m[4].trim();
        current = /present|current/i.test(end);
      } else {
        // Fallback: first clause before colon
        var head = line.split(':')[0].trim();
        title = head;
      }
      // Optional "City, Country" after employer
      var locM = employer.match(/^(.+?),\s*([^,]+),\s*([^,]+)$/);
      if (locM) {
        employer = locM[1].trim();
        city = locM[2].trim();
        country = locM[3].trim();
      }
      out.push({
        title: title,
        employer: employer,
        city: city,
        country: country,
        start: start,
        end: current ? '' : end,
        current: current || i === 0
      });
    }
    return out;
  }

  /**
   * Parse free-text education.
   * e.g. "B.S. Computer Science, State University (2018)"
   */
  function parseEducation(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];
    var lines = raw.split(/\n+/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var qualificationType = '';
      var title = '';
      var institution = '';
      var start = '';
      var end = '';
      var city = '';
      var country = '';
      var m = line.match(
        /^(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|M\.?B\.?A\.?|Ph\.?D\.?|Bachelor(?:'s)?|Master(?:'s)?|Doctorate|Diploma|Certificate|High School)(?:\s+(?:of|in)\s+|\s+)(.+?),\s*(.+?)(?:\s*\((\d{4})(?:\s*[–—\-]+\s*(\d{4}|present))?\))?$/i
      );
      if (m) {
        qualificationType = m[1].trim();
        title = m[2].trim();
        institution = m[3].trim();
        end = (m[4] || '').trim();
        if (m[5]) start = m[4];
        if (m[5]) end = m[5];
      } else {
        var m2 = line.match(/^(.+?),\s*(.+?)(?:\s*\((\d{4})\))?$/);
        if (m2) {
          title = m2[1].trim();
          institution = m2[2].trim();
          end = (m2[3] || '').trim();
        } else {
          title = line;
        }
      }
      out.push({
        qualificationType: qualificationType || title,
        title: title,
        institution: institution,
        start: start,
        end: end,
        city: city,
        country: country,
        fullTime: 'Full-time'
      });
    }
    return out;
  }

  function fillBlockFields(root, doc, pairs, filledRef) {
    if (!root) return;
    var inputs = root.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'password' || type === 'file') {
        continue;
      }
      if (!visible(el) && type !== 'radio' && type !== 'checkbox') continue;
      if (fieldAlreadyFilled(el) && type !== 'checkbox' && type !== 'radio') continue;
      var lab = cleanFieldLabel(labelFor(el, doc));
      var blob = lab + ' ' + norm((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''));
      for (var p = 0; p < pairs.length; p++) {
        if (pairs[p].re.test(lab) || pairs[p].re.test(blob)) {
          var val = pairs[p].val;
          if (val == null || String(val).trim() === '') break;
          if (type === 'radio' || type === 'checkbox') {
            if (/^(yes|y|true|1|no|n|false|0)$/i.test(String(val))) {
              var wantYes = /^(yes|y|true|1)$/i.test(String(val));
              if (type === 'checkbox') {
                if (setNativeValue(el, wantYes ? 'Yes' : 'No')) filledRef.n++;
              } else {
                var wrap = el.closest('fieldset, [role="group"], div, .iCIMS_JobFormField') || root;
                if (fillYesNoGroup(wrap, wantYes)) filledRef.n++;
              }
            }
          } else if (setNativeValue(el, val)) {
            filledRef.n++;
          }
          break;
        }
      }
    }
  }

  function findSectionRoots(doc, headingRe) {
    var roots = [];
    var heads = doc.querySelectorAll('h1, h2, h3, h4, legend, .iCIMS_InfoMsg, [class*="section"], [class*="Section"], fieldset, label, strong, b');
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var t = buttonText(h).slice(0, 120);
      if (!headingRe.test(t)) continue;
      var root =
        h.closest('fieldset, section, .iCIMS_JobFormField, [class*="section"], [class*="Section"], form, div') ||
        h.parentElement;
      if (root && roots.indexOf(root) === -1) roots.push(root);
    }
    // Fallback: whole document once if heading found in page text
    if (!roots.length && headingRe.test(pageText(doc))) {
      roots.push(doc.body || doc);
    }
    return roots;
  }

  function fillEmploymentBlocks(doc, profile) {
    var filledRef = { n: 0 };
    var jobs = parseWorkHistory(profileVal(profile, 'workHistory'));
    var roots = findSectionRoots(doc, /employment details|work (history|experience)|current employer|employment/i);
    if (!roots.length && !jobs.length) return 0;

    // Current employer Yes/No from first job / customAnswers
    var currently =
      answerFromCustom(profile, 'currently employed') ||
      answerFromCustom(profile, 'current employer') ||
      (jobs.length && jobs[0].current ? 'Yes' : jobs.length ? 'Yes' : '');
    var job = jobs[0] || {
      title: '',
      employer: '',
      city: profileVal(profile, 'city'),
      country: profileVal(profile, 'country'),
      start: '',
      end: '',
      current: currently === 'Yes'
    };

    var pairs = [
      { re: /currently employ|current employer|are you (currently )?employed|do you (currently )?have (a |an )?employer/i, val: currently || (job.current ? 'Yes' : 'No') },
      { re: /job\s*title|position\s*title|title\s*of\s*(your )?role|position$/i, val: job.title },
      { re: /employer|company\s*name|^company$|organisation|organization/i, val: job.employer },
      { re: /^city$|employer city|work city|employment city/i, val: job.city || profileVal(profile, 'city') },
      { re: /^country$|country\/?region|employer country|work country/i, val: job.country || profileVal(profile, 'country') },
      { re: /start\s*date|from\s*date|date\s*from|employment start/i, val: job.start },
      { re: /end\s*date|to\s*date|date\s*to|employment end|finish date/i, val: job.end }
    ];

    var targets = roots.length ? roots : [doc];
    for (var r = 0; r < targets.length; r++) {
      fillBlockFields(targets[r], doc, pairs, filledRef);
    }
    return filledRef.n;
  }

  function fillEducationBlocks(doc, profile) {
    var filledRef = { n: 0 };
    var edus = parseEducation(profileVal(profile, 'education'));
    if (!edus.length) return 0;
    var edu = edus[0];
    var roots = findSectionRoots(doc, /education|qualification|academic/i);
    var pairs = [
      { re: /qualification\s*type|degree\s*type|level of (study|education)|education level/i, val: edu.qualificationType },
      { re: /qualification\s*title|degree\s*title|field of study|major|course\s*title|^title$/i, val: edu.title },
      { re: /institution|university|college|school\s*name|^school$/i, val: edu.institution },
      { re: /start\s*date|from\s*date|date\s*from|attendance start/i, val: edu.start },
      { re: /end\s*date|to\s*date|date\s*to|graduation|year (of )?(grad|complet)/i, val: edu.end },
      { re: /^city$|institution city|school city/i, val: edu.city || profileVal(profile, 'city') },
      { re: /^country$|country\/?region|institution country|school country/i, val: edu.country || profileVal(profile, 'country') },
      { re: /full.?time|study\s*mode|mode of study|attendance/i, val: edu.fullTime || 'Full-time' }
    ];
    var targets = roots.length ? roots : [doc];
    for (var r = 0; r < targets.length; r++) {
      fillBlockFields(targets[r], doc, pairs, filledRef);
    }
    return filledRef.n;
  }

  /**
   * Map Candidate Profile fields from active profile. Never touches password / login fields.
   * Riyadh Air-richer: CV label, passport names, nationality, gender, notice period,
   * employment/education blocks, marketing consent prefer No.
   */
  function fillCandidateProfile(doc, profile, documents) {
    var filled = 0;
    var resumeInfo = attachResume(doc, documents || {});
    if (resumeInfo.resumeAttached) filled++;

    var mappings = [
      {
        key: 'firstName',
        re: /first\s*name|given\s*name|^fname$|passport.*first|first.*passport|as in (your )?passport.*first/i
      },
      {
        key: 'lastName',
        re: /last\s*name|surname|family\s*name|^lname$|passport.*last|last.*passport|as in (your )?passport.*last/i
      },
      { key: 'email', re: /^e-?mail$|email\s*address|e-?mail/i },
      {
        key: 'phone',
        re: /^(phone|mobile|telephone|number)$|phone\s*number|mobile\s*(phone|number)|mobile phone number/i
      },
      {
        key: 'phoneCountry',
        re: /phone\s*country|mobile\s*phone\s*country|country\s*code|dial\s*code|country calling/i
      },
      { key: 'street', re: /^(address|street|address\s*line)|residential address/i },
      { key: 'city', re: /^city$|residential.*city|city\s*\/\s*town/i },
      { key: 'zip', re: /zip|postal|post\s*code|postal\s*code/i },
      { key: 'country', re: /^country$|country\s*\/?\s*region|country or region|residential.*country/i },
      { key: 'state', re: /^state$|province|region/i },
      { key: 'nationality', re: /^nationality$|citizenship|citizen of|nationality\s*\*/i },
      { key: 'gender', re: /^gender$|^sex$|gender\s*\*/i },
      {
        key: 'noticePeriod',
        re: /notice\s*period|when can you (start|join)|earliest (start|availability)|availability to start|i can start/i
      }
    ];

    var inputs = doc.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el) && String(el.type || '') !== 'file') continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'password' || type === 'file') {
        continue;
      }
      // Never touch login/password-adjacent name attributes
      var nameId = String(el.name || '') + ' ' + String(el.id || '');
      if (/password|passwd|pwd|loginid|username.*login|create.?login/i.test(nameId)) continue;

      var rawLab = labelFor(el, doc);
      var lab = cleanFieldLabel(rawLab);
      var blob = lab + ' ' + norm(nameId + ' ' + (el.placeholder || ''));
      if (/password|re-?enter|create a login|login\*|username/i.test(blob) && /password|login|username/i.test(blob)) {
        continue;
      }

      // Skip employment/education block fields here — handled by block fillers (don't wipe)
      if (
        /job\s*title|employer|qualification|institution|full.?time|currently employ|current employer/i.test(lab) &&
        /employment|education|qualification|employer/i.test(pageText(doc))
      ) {
        // Still allow if clearly top-level profile (no section) — block filler also skips filled
      }

      if (type === 'checkbox' || type === 'radio') {
        // Marketing consent — prefer No unless customAnswers says Yes
        if (/marketing|promotional|newsletter|receive .{0,20}(email|sms|communication|update)|opt.?in|stay informed/i.test(lab + ' ' + blob)) {
          var mAns = answerFromCustom(profile, rawLab) || 'No';
          if (type === 'radio') {
            var wrapM = el.closest('fieldset, [role="group"], div, .iCIMS_JobFormField') || el.parentElement;
            if (fillYesNoGroup(wrapM, /^(yes|y|true|1)$/i.test(mAns))) filled++;
          } else if (setNativeValue(el, mAns)) {
            filled++;
          }
          continue;
        }
        // Previously employed / relative employed — No default
        if (
          /previously (been )?employed|relative.{0,40}employ|family member.{0,40}employ/i.test(lab + ' ' + blob)
        ) {
          var pAns = yesNoHeuristic(profile, rawLab) || 'No';
          if (type === 'radio') {
            var wrapP = el.closest('fieldset, [role="group"], div, .iCIMS_JobFormField') || el.parentElement;
            if (fillYesNoGroup(wrapP, /^(yes|y|true|1)$/i.test(pAns))) filled++;
          } else if (setNativeValue(el, pAns)) {
            filled++;
          }
          continue;
        }
        // Required privacy / I accept / terms — Yes
        if (/privacy|i accept|agree to (the )?terms|terms and conditions|data protection/i.test(lab + ' ' + blob)) {
          if (type === 'radio') {
            var wrapA = el.closest('fieldset, [role="group"], div') || el.parentElement;
            if (fillYesNoGroup(wrapA, true)) filled++;
          } else if (setNativeValue(el, 'Yes')) {
            filled++;
          }
          continue;
        }
        continue;
      }

      // Don't wipe populated profile fields
      if (fieldAlreadyFilled(el)) continue;

      var matched = false;
      for (var m = 0; m < mappings.length; m++) {
        if (mappings[m].re.test(lab) || mappings[m].re.test(blob) || mappings[m].re.test(rawLab)) {
          var val = profileVal(profile, mappings[m].key);
          if (mappings[m].key === 'zip' && !val) val = profileVal(profile, 'postcode');
          if (mappings[m].key === 'street' && !val) val = profileVal(profile, 'location');
          if (mappings[m].key === 'phoneCountry' && !val) {
            val = profileVal(profile, 'phoneCountry') || '';
          }
          if (mappings[m].key === 'nationality' && !val) {
            val = answerFromCustom(profile, 'nationality') || profileVal(profile, 'country') || '';
          }
          if (mappings[m].key === 'gender' && !val) {
            val = answerFromCustom(profile, 'gender') || '';
          }
          if (mappings[m].key === 'noticePeriod' && !val) {
            val =
              answerFromCustom(profile, 'notice period') ||
              answerFromCustom(profile, rawLab) ||
              'I can start immediately';
          }
          // Passport name labels still map to first/last
          if ((mappings[m].key === 'firstName' || mappings[m].key === 'lastName') && !val) {
            val = profileVal(profile, mappings[m].key);
          }
          if (val && setNativeValue(el, val)) {
            filled++;
            matched = true;
          }
          break;
        }
      }
      if (matched) continue;

      // Preferred Language — English default if select offers it
      if (/preferred\s*language|^language$/i.test(lab) && el.tagName === 'SELECT') {
        var lang = answerFromCustom(profile, lab) || 'English';
        if (setNativeValue(el, lang)) filled++;
        continue;
      }

      // Phone Type — Mobile / Cell preferred
      if (/phone\s*type/i.test(lab) && el.tagName === 'SELECT') {
        var ptype = answerFromCustom(profile, lab) || 'Mobile';
        if (!setNativeValue(el, ptype)) setNativeValue(el, 'Cell');
        filled++;
        continue;
      }

      // Address Type — Home preferred
      if (/address\s*type/i.test(lab) && el.tagName === 'SELECT') {
        var atype = answerFromCustom(profile, lab) || 'Home';
        if (setNativeValue(el, atype)) filled++;
        continue;
      }

      // Notice period select fallback when label fuzzy
      if (/notice|start immediately|when can you start/i.test(lab) && el.tagName === 'SELECT') {
        var np =
          profileVal(profile, 'noticePeriod') ||
          answerFromCustom(profile, rawLab) ||
          'I can start immediately';
        if (setNativeValue(el, np)) filled++;
        continue;
      }
    }

    // Employment / education blocks — fill only empty fields
    filled += fillEmploymentBlocks(doc, profile) || 0;
    filled += fillEducationBlocks(doc, profile) || 0;

    // Company-specific Yes/No on profile (previously employed / relative / marketing)
    var qNodes = doc.querySelectorAll('fieldset, .iCIMS_JobFormField, .iCIMS_FormField, [class*="question"]');
    for (var q = 0; q < qNodes.length; q++) {
      var node = qNodes[q];
      var qText = buttonText(node).slice(0, 220);
      if (!qText) continue;
      if (
        /previously (been )?employed|relative.{0,40}employ|marketing|promotional|newsletter/i.test(qText)
      ) {
        var ans = yesNoHeuristic(profile, qText);
        if (ans && fillYesNoGroup(node, /^(yes|y|true|1)$/i.test(ans))) filled++;
      }
    }

    return { filled: filled, resumeAttached: !!resumeInfo.resumeAttached };
  }


  function skipEeoStep(doc) {
    var skipped = 0;
    // Prefer decline / prefer not / skip buttons
    var nodes = doc.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (/^skip$/i.test(t.trim()) || /skip\s*(this|step|eeo|survey)?/i.test(t) || /decline|prefer not/i.test(t)) {
        // Avoid skipping the whole application
        if (/skip\s*application|skip\s*job/i.test(t)) continue;
        try {
          el.click();
          skipped++;
          return skipped;
        } catch (_e) {}
      }
    }

    // Prefer-not options on selects/radios
    var selects = doc.querySelectorAll('select');
    for (var s = 0; s < selects.length; s++) {
      var sel = selects[s];
      if (!visible(sel)) continue;
      var lab = labelFor(sel, doc);
      if (!isEeoLabel(lab) && !isEeoStep(doc)) continue;
      for (var o = 0; o < sel.options.length; o++) {
        var ot = (sel.options[o].textContent || '').trim();
        if (/prefer not|decline|do not wish|choose not|not to (self-)?identify|don'?t wish/i.test(ot)) {
          sel.selectedIndex = o;
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          skipped++;
          break;
        }
      }
    }
    var radios = doc.querySelectorAll('input[type="radio"]');
    for (var r = 0; r < radios.length; r++) {
      var radio = radios[r];
      if (!visible(radio)) continue;
      var wrap = radio.closest('fieldset, [role="group"], div, .iCIMS_JobFormField') || radio.parentElement;
      var wLab = ((wrap && wrap.textContent) || '').slice(0, 300) + ' ' + labelFor(radio, doc);
      if (!isEeoLabel(wLab) && !isEeoStep(doc)) continue;
      var rLab = labelFor(radio, doc) || radio.value || '';
      if (/prefer not|decline|do not wish|choose not|not to (self-)?identify/i.test(rLab)) {
        try {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          skipped++;
        } catch (_e2) {}
      }
    }
    return skipped;
  }

  function fillYesNoGroup(root, wantYes) {
    var radios = root.querySelectorAll('input[type="radio"], button, [role="radio"]');
    for (var j = 0; j < radios.length; j++) {
      var radio = radios[j];
      var rLab = labelFor(radio, document) || radio.value || buttonText(radio) || '';
      var isYes = /^(yes|y)$/i.test(rLab.trim()) || /^yes\b/i.test(rLab.trim());
      var isNo = /^(no|n)$/i.test(rLab.trim()) || /^no\b/i.test(rLab.trim());
      if ((wantYes && isYes) || (!wantYes && isNo)) {
        try {
          radio.click();
          if (radio.tagName === 'INPUT') {
            radio.checked = true;
            radio.dispatchEvent(new Event('input', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        } catch (_e) {}
      }
    }
    var selects = root.querySelectorAll('select');
    for (var s = 0; s < selects.length; s++) {
      if (setNativeValue(selects[s], wantYes ? 'Yes' : 'No')) return true;
    }
    return false;
  }

  /**
   * Candidate Questions / Questionnaire — customAnswers + Yes/No heuristics.
   * Returns { filled, unknownRequired[] }
   */
  function fillQuestions(doc, profile) {
    var filled = 0;
    var unknownRequired = [];
    var fields = doc.querySelectorAll('input, select, textarea');
    var seenRadioGroups = {};

    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'password' || type === 'file') {
        continue;
      }
      if (!visible(el) && type !== 'radio' && type !== 'checkbox') continue;

      var lab = labelFor(el, doc);
      var blob = lab + ' ' + (el.name || '') + ' ' + (el.id || '');
      if (isEeoLabel(blob)) continue;
      if (/password|create a login|login\*/i.test(blob)) continue;

      var required =
        el.required ||
        el.getAttribute('aria-required') === 'true' ||
        /\*/.test(lab) ||
        /\(required\)/i.test(lab);

      if (type === 'radio') {
        var gname = el.name || lab;
        if (seenRadioGroups[gname]) continue;
        seenRadioGroups[gname] = true;
        var wrap = el.closest('fieldset, [role="group"], .iCIMS_JobFormField, .iCIMS_FormField, div') || el.parentElement;
        var qLab = labelFor(el, doc);
        if (wrap) {
          var legend = wrap.querySelector('legend, label, .question, [class*="question"]');
          if (legend) qLab = buttonText(legend).slice(0, 220) || qLab;
          else qLab = buttonText(wrap).slice(0, 220) || qLab;
        }
        if (isEeoLabel(qLab)) continue;
        var ans = yesNoHeuristic(profile, qLab);
        if (ans && /^(yes|y|true|1|no|n|false|0)$/i.test(String(ans).trim())) {
          var wantYes = /^(yes|y|true|1)$/i.test(String(ans).trim());
          if (fillYesNoGroup(wrap || el.parentElement, wantYes)) {
            filled++;
            continue;
          }
        }
        var custom = answerFromCustom(profile, qLab);
        if (custom) {
          // Try matching radio option text to custom answer
          var radios = (wrap || doc).querySelectorAll('input[type="radio"]');
          var hit = false;
          for (var r = 0; r < radios.length; r++) {
            var rl = labelFor(radios[r], doc) || radios[r].value || '';
            if (norm(rl).indexOf(norm(custom)) !== -1 || norm(custom).indexOf(norm(rl)) !== -1) {
              try {
                radios[r].click();
                radios[r].checked = true;
                radios[r].dispatchEvent(new Event('change', { bubbles: true }));
                filled++;
                hit = true;
                break;
              } catch (_e) {}
            }
          }
          if (hit) continue;
        }
        // Check if already answered
        var groupRadios = doc.querySelectorAll('input[type="radio"][name="' + (el.name || '').replace(/"/g, '') + '"]');
        var anyChecked = false;
        for (var g = 0; g < groupRadios.length; g++) {
          if (groupRadios[g].checked) anyChecked = true;
        }
        if (!anyChecked && required) unknownRequired.push(qLab || blob);
        continue;
      }

      if (type === 'checkbox') {
        if (/privacy|agree|consent|i accept|terms/i.test(lab)) {
          if (setNativeValue(el, 'Yes')) filled++;
        }
        continue;
      }

      // Already has value
      if (el.value && String(el.value).trim()) continue;

      var answer = answerFromCustom(profile, lab);
      if (!answer && el.tagName === 'SELECT') {
        var yn = yesNoHeuristic(profile, lab);
        if (yn) answer = yn;
      }
      if (!answer) {
        // Profile field heuristics for leftover profile-like questions
        if (/first\s*name/i.test(lab)) answer = profileVal(profile, 'firstName');
        else if (/last\s*name/i.test(lab)) answer = profileVal(profile, 'lastName');
        else if (/e-?mail/i.test(lab)) answer = profileVal(profile, 'email');
        else if (/phone|mobile/i.test(lab)) answer = profileVal(profile, 'phone');
        else if (/city/i.test(lab)) answer = profileVal(profile, 'city');
        else if (/country/i.test(lab)) answer = profileVal(profile, 'country');
        else if (/linkedin/i.test(lab)) answer = profileVal(profile, 'linkedin');
      }

      if (answer && setNativeValue(el, answer)) {
        filled++;
      } else if (required) {
        unknownRequired.push(lab || blob);
      }
    }

    return { filled: filled, unknownRequired: unknownRequired };
  }

  function clickNext(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (/^next$/i.test(t.trim()) || /^continue$/i.test(t.trim()) || /save and continue/i.test(t)) {
        // Do not treat Submit Profile as Next
        if (/submit/i.test(t)) continue;
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    return false;
  }

  function isSubmitProfileCta(t) {
    return /submit\s*profile/i.test(String(t || ''));
  }

  function isFinalSubmitCta(t) {
    t = String(t || '');
    if (isSubmitProfileCta(t)) return true;
    // Finish Later is NOT submit — fill/ready must not treat it as progress submit either
    if (/finish\s*later|save\s*for\s*later|save\s*and\s*exit/i.test(t)) return false;
    if (/^next$/i.test(t.trim()) || /^continue$/i.test(t.trim()) || /save and continue/i.test(t)) {
      return false;
    }
    if (global.FillApplySynonyms && global.FillApplySynonyms.isApplyCta) {
      return !!global.FillApplySynonyms.isApplyCta(t);
    }
    return /submit\s*application|submit\s*(&|and)\s*apply|^submit$/i.test(t) || /^apply now$/i.test(t);
  }

  function isFinishLaterCta(t) {
    return /finish\s*later|save\s*for\s*later|save\s*and\s*exit/i.test(String(t || ''));
  }

  function clickSubmitProfile(doc) {
    doc = doc || document;
    // Never click Submit Profile while Create login / password fields are visible
    // (SSO Connected/Disconnect without passwords is OK — needsAuthPause is false)
    if (needsAuthPause(doc, profile)) return false;

    var nodes = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (isSubmitProfileCta(t)) {
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    return false;
  }

  function clickSubmit(doc) {
    doc = doc || document;
    if (needsAuthPause(doc, profile)) return false;
    var nodes = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (isFinishLaterCta(t)) continue;
      if (isFinalSubmitCta(t)) {
        try {
          el.click();
          return true;
        } catch (_e) {}
      }
    }
    var fb = doc.querySelector(
      'input[type="submit"], button[type="submit"], .iCIMS_SubmitButton, button.iCIMS_PrimaryButton'
    );
    if (fb && visible(fb)) {
      var ft = buttonText(fb);
      if (!/^next$/i.test(ft.trim()) && !/^continue$/i.test(ft.trim()) && !hasPasswordCreateFields(doc)) {
        try {
          fb.click();
          return true;
        } catch (_e2) {}
      }
    }
    return false;
  }

  function formLooksComplete(doc) {
    var nodes = doc.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      if (visible(nodes[i]) && isFinalSubmitCta(buttonText(nodes[i]))) return true;
    }
    return !!doc.querySelector('.iCIMS_SubmitButton, [class*="Submit"]');
  }

  var FIELD_MAPS = [
    { key: 'email', labels: ['email', 'e-mail'], names: ['email'] },
    {
      key: 'firstName',
      labels: ['first name', 'first name as in passport', 'given name', 'passport first'],
      names: ['firstname', 'first_name', 'fname']
    },
    {
      key: 'lastName',
      labels: ['last name', 'last name as in passport', 'surname', 'family name', 'passport last'],
      names: ['lastname', 'last_name', 'lname']
    },
    { key: 'phone', labels: ['phone', 'mobile', 'mobile phone', 'number'], names: ['phone', 'mobile', 'telephone'] },
    {
      key: 'phoneCountry',
      labels: ['phone country', 'mobile phone country code', 'country code', 'dial code'],
      names: ['phonecountry', 'countrycode']
    },
    { key: 'street', labels: ['address', 'street', 'residential address'], names: ['address', 'street'] },
    { key: 'city', labels: ['city'], names: ['city'] },
    { key: 'state', labels: ['state', 'province', 'region'], names: ['state', 'province'] },
    { key: 'zip', labels: ['zip', 'postal', 'postal code'], names: ['zip', 'postal', 'postcode'] },
    {
      key: 'country',
      labels: ['country', 'country/region', 'country or region'],
      names: ['country', 'countryregion']
    },
    { key: 'nationality', labels: ['nationality', 'citizenship'], names: ['nationality', 'citizenship'] },
    { key: 'gender', labels: ['gender', 'sex'], names: ['gender', 'sex'] },
    {
      key: 'noticePeriod',
      labels: ['notice period', 'when can you start', 'availability', 'i can start immediately'],
      names: ['noticeperiod', 'notice_period', 'availability']
    },
    { key: 'linkedin', labels: ['linkedin'], names: ['linkedin'] }
  ];

  var adapter = {
    id: 'icims',
    name: 'iCIMS',
    category: 'ats',
    hosts: HOSTS,
    detect: detect,
    fieldMaps: FIELD_MAPS,
    submitSelector:
      'input[type="submit"], button[type="submit"], .iCIMS_SubmitButton, button.iCIMS_PrimaryButton',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|c\\.v\\.|curriculum|upload' },
      { kind: 'cover', match: 'cover' }
    ],
    detectAuthWall: detectAuthWall,
    isSsoConnected: isSsoConnected,
    needsAuthPause: needsAuthPause,
    fill: function (ctx) {
      ctx = ctx || {};
      var doc = ctx.document || (typeof document !== 'undefined' ? document : null);
      var profile = ctx.profile || {};
      var documents = ctx.documents || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

      return Promise.resolve().then(async function () {
        if (!doc) {
          return {
            ok: false,
            adapterId: 'icims',
            error: 'No document',
            filled: 0,
            unmatched: 0,
            total: 0
          };
        }

        var pause0 = challengePause(doc, 0);
        if (pause0) return pause0;

        ensureApplyView(doc);
        await sleep(humanDelay(500));

        var pause1 = challengePause(doc, 0);
        if (pause1) return pause1;

        var totalFilled = 0;
        var advanced = false;
        var resumeAttached = false;
        var submitted = false;

        // Welcome: Email + I accept + Next
        if (isWelcomeStep(doc) || (doc.querySelector('input[type="email"]') && /i accept/i.test(pageText(doc)))) {
          if (!/create a login|submit profile/i.test(pageText(doc))) {
            totalFilled += fillWelcomeStep(doc, profile);
            var pauseWelcome = challengePause(doc, totalFilled);
            if (pauseWelcome) {
              pauseWelcome.message =
                'iCIMS welcome: complete hCaptcha / captcha if shown, then Resume (Email + I accept filled when possible).';
              return pauseWelcome;
            }
            if (clickNext(doc)) {
              advanced = true;
              await sleep(humanDelay(700));
            }
          }
        }

        var pause2 = challengePause(doc, totalFilled);
        if (pause2) return pause2;

        // Candidate Profile: fill non-password fields + resume even if Create-login
        // is visible — but NEVER invent passwords / NEVER Submit Profile while
        // Create-login fields are present → pause for human auth first.
        if (isCandidateProfileStep(doc) || doc.querySelector('input[type="file"]')) {
          var profileFill = fillCandidateProfile(doc, profile, documents);
          totalFilled += profileFill.filled || 0;
          if (profileFill.resumeAttached) resumeAttached = true;

          var pauseProf = challengePause(doc, totalFilled);
          if (pauseProf) return pauseProf;

          // Create-login → auth pause; SSO Connected/Disconnect → skip pause
          if (needsAuthPause(doc, profile)) {
            var authPause = authWallPause(doc, totalFilled, profile);
            if (authPause) {
              authPause.filled = totalFilled;
              authPause.resumeAttached = resumeAttached;
              authPause.message =
                'iCIMS account required — sign in/register manually, then Resume (profile fields/resume filled when possible; passwords never auto-filled). If SSO shows Connected/Disconnect, Resume to continue.';
              return authPause;
            }
            return {
              ok: false,
              adapterId: 'icims',
              needsHuman: true,
              pauseReason: 'auth_wall',
              error: 'iCIMS account required — sign in/register manually, then Resume',
              filled: totalFilled,
              unmatched: 0,
              total: totalFilled,
              submitted: false,
              resumeAttached: resumeAttached
            };
          }

          // Auth cleared — Submit Profile only in submit mode
          if (runMode === 'submit') {
            if (clickSubmitProfile(doc)) {
              submitted = true;
              advanced = true;
              await sleep(humanDelay(700));
            }
          }
          // fill/ready: fields filled but do NOT Submit Profile
        } else {
          // Non-profile pages: still honor auth wall (e.g. dedicated sign-in)
          var authEarly = authWallPause(doc, totalFilled, profile);
          if (authEarly) return authEarly;
        }

        var pause3 = challengePause(doc, totalFilled);
        if (pause3) return pause3;
        var auth3 = authWallPause(doc, totalFilled, profile);
        if (auth3) return auth3;

        // EEO — skip / decline, never invent
        if (isEeoStep(doc)) {
          skipEeoStep(doc);
          if (runMode === 'submit' || runMode === 'ready' || runMode === 'fill') {
            if (clickNext(doc)) {
              advanced = true;
              await sleep(humanDelay(500));
            }
          }
        }

        // Candidate Questions / Questionnaire
        if (isQuestionsStep(doc) || doc.querySelector('input[type="radio"], textarea, select')) {
          var qResult = fillQuestions(doc, profile);
          totalFilled += qResult.filled || 0;
          if (runMode === 'submit' && qResult.unknownRequired && qResult.unknownRequired.length) {
            var label = qResult.unknownRequired[0] || 'unknown question';
            return {
              ok: false,
              adapterId: 'icims',
              needsHuman: true,
              pauseReason: 'missing_profile_field',
              missingProfileFields: (qResult.unknownRequired || []).map(function (x) {
                return String(x).replace(/\s+/g, ' ').trim().slice(0, 80);
              }),
              driftLabel: label,
              error:
                'iCIMS required question unmapped — fill in Options or on the page, then Resume: "' +
                String(label).slice(0, 120) +
                '"',
              filled: totalFilled,
              unmatched: qResult.unknownRequired.length,
              total: totalFilled + qResult.unknownRequired.length,
              submitted: false
            };
          }
        }

        // Fallback fill for leftover fields (never invent EEO; never final-submit via fallback)
        var fb = global.FillApplyFallbackAdapter;
        var fbResult = null;
        if (fb && typeof fb.fill === 'function') {
          fbResult = fb.fill(
            Object.assign({}, ctx, {
              adapterId: 'icims',
              submitSelector: adapter.submitSelector,
              fileInputHints: adapter.fileInputHints,
              fieldMaps: adapter.fieldMaps.concat(FIELD_MAPS),
              runMode: 'fill',
              autoSubmit: false
            })
          );
          if (fbResult && typeof fbResult.then === 'function') fbResult = await fbResult;
          if (fbResult) {
            totalFilled += Number(fbResult.filled) || 0;
            if (fbResult.resumeAttached) resumeAttached = true;
          }
        }

        var pause4 = challengePause(doc, totalFilled);
        if (pause4) return pause4;
        var auth4 = authWallPause(doc, totalFilled, profile);
        if (auth4) return auth4;

        if (runMode === 'submit') {
          for (var hop = 0; hop < 8; hop++) {
            var pauseHop = challengePause(doc, totalFilled);
            if (pauseHop) return pauseHop;
            var authHop = authWallPause(doc, totalFilled, profile);
            if (authHop) return authHop;

            if (isEeoStep(doc)) {
              skipEeoStep(doc);
            }

            // Unknown required on questions mid-hop
            if (isQuestionsStep(doc)) {
              var q2 = fillQuestions(doc, profile);
              totalFilled += q2.filled || 0;
              if (q2.unknownRequired && q2.unknownRequired.length) {
                var lab2 = q2.unknownRequired[0] || 'unknown question';
                return {
                  ok: false,
                  adapterId: 'icims',
                  needsHuman: true,
                  pauseReason: 'missing_profile_field',
                  missingProfileFields: (q2.unknownRequired || []).map(function (x) {
                    return String(x).replace(/\s+/g, ' ').trim().slice(0, 80);
                  }),
                  driftLabel: lab2,
                  error:
                    'iCIMS required question unmapped — fill in Options or on the page, then Resume: "' +
                    String(lab2).slice(0, 120) +
                    '"',
                  filled: totalFilled,
                  unmatched: q2.unknownRequired.length,
                  total: totalFilled + q2.unknownRequired.length,
                  submitted: false
                };
              }
            }

            if (needsAuthPause(doc, profile)) {
              return (
                authWallPause(doc, totalFilled, profile) || {
                  ok: false,
                  adapterId: 'icims',
                  needsHuman: true,
                  pauseReason: 'auth_wall',
                  error: 'iCIMS account required — sign in/register manually, then Resume',
                  filled: totalFilled,
                  unmatched: 0,
                  total: totalFilled,
                  submitted: false
                }
              );
            }

            if (clickSubmitProfile(doc)) {
              submitted = true;
              advanced = true;
              await sleep(humanDelay(600));
              continue;
            }
            if (formLooksComplete(doc) && clickSubmit(doc)) {
              submitted = true;
              await sleep(humanDelay(400));
              break;
            }
            if (clickNext(doc)) {
              advanced = true;
              await sleep(humanDelay(600));
              continue;
            }
            if (clickSubmit(doc)) {
              submitted = true;
              await sleep(humanDelay(400));
              break;
            }
            break;
          }
        }

        return {
          ok: true,
          adapterId: 'icims',
          filled: totalFilled,
          unmatched: (fbResult && fbResult.unmatched) || 0,
          total: totalFilled + ((fbResult && fbResult.unmatched) || 0),
          submitted: submitted,
          advanced: advanced,
          runMode: runMode,
          resumeAttached: resumeAttached || !!(fbResult && fbResult.resumeAttached),
          message: submitted
            ? 'iCIMS: submitted application / profile'
            : 'iCIMS: filled multi-step fields (welcome / Candidate Profile CV+demographics+employment/education / questions); SSO Connected skips auth pause; account signup is human gate; fill/ready never Submit Profile / Finish Later'
        };
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_icimsAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
