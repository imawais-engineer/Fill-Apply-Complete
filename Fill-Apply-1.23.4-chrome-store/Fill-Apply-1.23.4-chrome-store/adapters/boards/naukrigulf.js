/**
 * NaukriGulf / Naukrigulf board adapter — Easy Apply on-page modal flow.
 *
 * PREREQUISITE: User must have a 100% complete NaukriGulf profile on the platform.
 * Incomplete profiles redirect to profile completion instead of the job/apply page.
 * See docs/APPLICATION_GUIDE.md → "NaukriGulf — profile completeness" and
 * "NaukriGulf Easy Apply".
 *
 * Flow:
 * 1. Prefer Easy Apply when present → click → answer modal questions
 * 2. If Easy Apply modal never appears → fall back to regular Apply / Apply Now /
 *    company-site apply (never hard-stop requiring Easy Apply only)
 * 3. On-page popup/modal with screening Yes/No questions (Easy Apply path)
 * 4. Answer from profile.customAnswers / heuristics (UAE location, employed, industry)
 * 5. fill/ready: leave modal open (do NOT click Submit & Apply)
 * 6. submit: click Submit & Apply
 *
 * Diversity surveys are N/A on this board. Structure drift (unknown required
 * Yes/No with no mapping) pauses in submit mode only.
 */
(function (global) {
  'use strict';

  var HOSTS = ['naukrigulf.com', 'www.naukrigulf.com'];
  var HOST_RE = /naukrigulf\.com/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
      for (var i = 0; i < HOSTS.length; i++) {
        if (u.hostname === HOSTS[i] || u.hostname.endsWith('.' + HOSTS[i].replace(/^www\./, ''))) {
          return true;
        }
      }
    } catch (_e) {
      if (HOST_RE.test(url)) return true;
    }
    return false;
  }

  function stripOptionNoise(label) {
    var s = String(label || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/[\s:?\-–—]*\bYes\s*\/?\s*No\b\s*$/i, '');
    s = s.replace(/[\s:?\-–—]*\bY\s*\/?\s*N\b\s*$/i, '');
    s = s.replace(/YesNo\s*$/i, '');
    s = s.replace(/\?Yes\s*$/i, '?');
    s = s.replace(/\?No\s*$/i, '?');
    return s.replace(/\s+/g, ' ').trim();
  }

  function cleanLabel(s) {
    return stripOptionNoise(String(s || '').replace(/\s+/g, ' ').trim());
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  function clickApplyControl(el) {
    if (!el) return false;
    try {
      if (global.FillApplyDom && typeof global.FillApplyDom.realClick === 'function') {
        if (global.FillApplyDom.realClick(el)) return true;
      }
    } catch (_rc) {}
    try {
      el.click();
      return true;
    } catch (_c) {
      return false;
    }
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
    return (
      (el.textContent || '') +
      ' ' +
      (el.value || '') +
      ' ' +
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('title') || '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLabelFor(el, root) {
    if (global.__fillApply && global.__fillApply.getLabelText) {
      var t = global.__fillApply.getLabelText(el);
      if (t) return t;
    }
    if (el.id) {
      try {
        var scope = root || document;
        var byFor = scope.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return byFor.textContent.trim();
      } catch (_e) {
        /* ignore */
      }
    }
    var parent = el.closest('label');
    if (parent) return parent.textContent.trim();
    return el.getAttribute('aria-label') || el.placeholder || el.name || '';
  }

  function realClick(el) {
    if (!el) return false;
    try {
      if (global.FillApplyDom && typeof global.FillApplyDom.realClick === 'function') {
        if (global.FillApplyDom.realClick(el)) return true;
      }
    } catch (_eDom) {
      /* fall through */
    }
    try {
      if (el.focus) el.focus({ preventScroll: true });
    } catch (_eF) {
      /* ignore */
    }
    try {
      var view = el.ownerDocument && el.ownerDocument.defaultView;
      var opts = { bubbles: true, cancelable: true, composed: true, view: view || window };
      var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
      for (var i = 0; i < seq.length; i++) {
        try {
          var name = seq[i];
          var Ctor = /^pointer/.test(name) && view && view.PointerEvent ? view.PointerEvent : view && view.MouseEvent;
          if (Ctor) el.dispatchEvent(new Ctor(name, opts));
        } catch (_eSeq) {
          /* optional */
        }
      }
      el.click();
      return true;
    } catch (_eClick) {
      try {
        el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        return true;
      } catch (_e2) {
        return false;
      }
    }
  }

  function fireInputChange(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (_e) {
      /* ignore */
    }
  }

  /**
   * Option text for ONE radio/control — never the wrapping question that contains
   * both "Yes" and "No" (that bug made every radio look like Yes).
   */
  function optionTextForRadio(radio, root) {
    if (!radio) return '';
    var val = String(radio.value || '').trim();
    if (/^(yes|y|no|n|true|false|1|0)$/i.test(val)) {
      // Prefer dedicated short label when present; value is still a strong signal.
    }
    if (radio.id) {
      try {
        var scope = root || document;
        var byFor = scope.querySelector('label[for="' + CSS.escape(radio.id) + '"]');
        if (byFor) {
          var forText = String(byFor.textContent || '').replace(/\s+/g, ' ').trim();
          if (forText && forText.length < 80) return forText;
        }
      } catch (_e) {
        /* ignore */
      }
    }
    var parentLabel = radio.closest && radio.closest('label');
    if (parentLabel) {
      var radiosInLabel = parentLabel.querySelectorAll('input[type="radio"]');
      if (radiosInLabel.length <= 1) {
        var only = String(parentLabel.textContent || '').replace(/\s+/g, ' ').trim();
        if (only) return only;
      } else {
        // Shared parent label wrapping multiple radios — take adjacent text only.
        var adj = adjacentOptionText(radio);
        if (adj) return adj;
      }
    }
    var near = adjacentOptionText(radio);
    if (near) return near;
    var aria = radio.getAttribute && radio.getAttribute('aria-label');
    if (aria) return String(aria).trim();
    return val;
  }

  function adjacentOptionText(el) {
    var parts = [];
    var next = el.nextSibling;
    while (next) {
      if (next.nodeType === 1) {
        if (/^INPUT$/i.test(next.tagName)) break;
        if (next.querySelector && next.querySelector('input[type="radio"], input[type="checkbox"]')) break;
        if (/^(LABEL|SPAN|DIV|P|STRONG|EM|I|B)$/i.test(next.tagName)) {
          parts.push(next.textContent || '');
          break;
        }
        break;
      }
      if (next.nodeType === 3) {
        var chunk = String(next.textContent || '');
        if (chunk.replace(/\s+/g, '')) parts.push(chunk);
      }
      next = next.nextSibling;
    }
    var t = parts.join('').replace(/\s+/g, ' ').trim();
    if (t) return t;
    // Sometimes the clickable text is a sibling label after a wrapper
    var sib = el.nextElementSibling;
    if (sib && !sib.querySelector('input') && /^(LABEL|SPAN|DIV)$/i.test(sib.tagName)) {
      return String(sib.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  /**
   * Classify a radio/control as Yes / No / null.
   * Strict: exact short labels and clear values win. Never treat a long string
   * that contains BOTH yes and no as Yes.
   */
  function classifyYesNoOption(text, value) {
    var v = String(value == null ? '' : value).trim();
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (/^(yes|y|true|1)$/i.test(v)) return 'Yes';
    if (/^(no|n|false|0)$/i.test(v)) return 'No';
    if (/^(yes|y)$/i.test(t)) return 'Yes';
    if (/^(no|n)$/i.test(t)) return 'No';
    if (t.length <= 16) {
      var hasYes = /\byes\b/i.test(t);
      var hasNo = /\bno\b/i.test(t);
      if (hasYes && !hasNo) return 'Yes';
      if (hasNo && !hasYes) return 'No';
    }
    return null;
  }

  function findLabelForInput(el, root) {
    if (!el) return null;
    if (el.id) {
      try {
        var scope = root || (el.ownerDocument || document);
        var byFor = scope.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (byFor) return byFor;
      } catch (_e) {
        /* ignore */
      }
    }
    return el.closest ? el.closest('label') : null;
  }

  function isCaOrAccaQuestion(lab) {
    var s = String(lab || '');
    return /ca\s*or\s*acca|acca\s*or\s*ca|qualified\s*ca\s*or\s*acca|ca\s*\/\s*acca|acca\s*\/\s*ca/i.test(s);
  }

  function isCaOnlyQuestion(lab) {
    var s = String(lab || '');
    if (isCaOrAccaQuestion(s)) return false;
    if (/\bacca\b/i.test(s) && !/chartered accountant|\(\s*ca\s*\)/i.test(s)) return false;
    // Strict ICAI-style CA (no ACCA in the question)
    return (
      /qualified\s+chartered\s+accountant/i.test(s) ||
      /are you a qualified\s+chartered\s+accountant\s*\(\s*ca\s*\)/i.test(s) ||
      /are you a qualified\s*\(\s*ca\s*\)/i.test(s) ||
      (/are you a qualified/i.test(s) && /\(\s*ca\s*\)/i.test(s) && !/\bacca\b/i.test(s)) ||
      (/qualified\s+ca\b/i.test(s) && !/\bacca\b/i.test(s) && !/\bor\b/i.test(s))
    );
  }

  function isBcomQuestion(lab) {
    return /b\.?\s*com|m\.?\s*com|bachelor.*commerce|commerce.*bachelor/i.test(String(lab || ''));
  }

  function isErpQuestion(lab) {
    return /\berp\b|accounting software|oracle|sap|sage/i.test(String(lab || '')) &&
      /experience|practical|working with|familiar|used/i.test(String(lab || ''));
  }

  function isOacpaOrLettersQuestion(lab) {
    return /oacpa|oman association|attested|experience letters|certificates supporting/i.test(
      String(lab || '')
    );
  }

  function isPostQualYearsQuestion(lab) {
    return /post[-\s]?qualification|years of relevant.*experience.*finance|how many years of relevant post/i.test(
      String(lab || '')
    );
  }

  function detectProfileRedirect(doc, href) {
    href = String(href || '');
    var bodyText = '';
    try {
      bodyText = doc && doc.body ? String(doc.body.innerText || '').slice(0, 8000) : '';
    } catch (_e) {
      bodyText = '';
    }
    return (
      /\/profile|completeness|complete-your-profile|updateprofile|myprofile/i.test(href) ||
      /complete your profile|profile completeness|complete profile|profile is incomplete|make your profile/i.test(
        bodyText
      )
    );
  }

  function profileRedirectResult() {
    return {
      ok: false,
      adapterId: 'naukrigulf',
      needsHuman: true,
      pauseReason: 'challenge',
      error:
        'NaukriGulf redirected to profile completion — finish profile to 100% on the platform, then Resume. See APPLICATION_GUIDE.',
      filled: 0,
      unmatched: 0,
      total: 0
    };
  }

  function findEasyApplyButton(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"], span[onclick], div[role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = buttonText(el);
      if (/easy\s*apply/i.test(t)) return el;
      if (
        /easyapply|easy-apply|ng-easy-apply/i.test(
          el.className + ' ' + el.id + ' ' + (el.getAttribute('data-ga-label') || '')
        )
      ) {
        return el;
      }
    }
    var byAttr = doc.querySelector(
      '[data-ga-label*="Easy Apply" i], [aria-label*="Easy Apply" i], a[href*="easyapply" i], button[class*="easyApply" i], .easyApply, #easyApply'
    );
    if (byAttr && visible(byAttr)) return byAttr;
    return null;
  }

  /**
   * Regular Apply / Apply Now / Apply for this job — used when Easy Apply modal
   * never appears (external ATS / company-site apply).
   */
  function findStandardApplyButton(doc) {
    doc = doc || document;
    var Syn = global.FillApplySynonyms;
    if (Syn && typeof Syn.findApplyStartButtons === 'function') {
      var list = Syn.findApplyStartButtons(doc) || [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el || !visible(el)) continue;
        var t = buttonText(el);
        if (Syn.isEasyApplyCta && Syn.isEasyApplyCta(t)) continue;
        if (Syn.isApplyStartCta && Syn.isApplyStartCta(t)) return el;
      }
    }
    var nodes = doc.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"], span[onclick], div[role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (!visible(node)) continue;
      var txt = buttonText(node);
      if (/easy\s*apply/i.test(txt)) continue;
      if (/auto-?apply|upgrade|subscribe|share|save\s*job/i.test(txt)) continue;
      var score = 0;
      if (/^apply now$/i.test(txt)) score = 100;
      else if (/^apply$/i.test(txt.trim()) && txt.trim().length < 12) score = 90;
      else if (/apply for this (job|role|position)/i.test(txt)) score = 85;
      else if (/\bapply now\b/i.test(txt)) score = 80;
      else if (/\bapply\b/i.test(txt) && txt.length < 48) score = 50;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best;
  }

  /**
   * Locate the Easy Apply modal/dialog root.
   */
  function findEasyApplyModal(doc) {
    doc = doc || document;

    var dialogs = doc.querySelectorAll(
      '[role="dialog"], dialog, .modal, .Modal, [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!visible(d)) continue;
      var txt = (d.textContent || '').replace(/\s+/g, ' ');
      if (/submit\s*&\s*apply|submit and apply/i.test(txt)) return d;
      if (/are you currently|would require below details|confidential company/i.test(txt)) return d;
      if (/\byes\b/i.test(txt) && /\bno\b/i.test(txt) && /currently|located|experience|industry/i.test(txt)) {
        return d;
      }
    }

    // Fallback: element that contains Submit & Apply button
    var buttons = doc.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      if (!visible(btn)) continue;
      if (/submit\s*&\s*apply|submit and apply/i.test(buttonText(btn))) {
        var root =
          btn.closest('[role="dialog"], dialog, .modal, .Modal, [class*="modal"], [class*="popup"], form') ||
          btn.parentElement;
        if (root && visible(root)) return root;
      }
    }

    return null;
  }

  function waitForModal(doc, timeoutMs) {
    doc = doc || document;
    timeoutMs = timeoutMs || 5000;
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        var modal = findEasyApplyModal(doc);
        if (modal) {
          resolve(modal);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 200);
      }
      tick();
    });
  }

  function answerFromCustom(profile, label) {
    var lab = norm(cleanLabel(label));
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
      var qa = global.FillApplyFieldMap.matchCustomQA(profile && profile.customQA, label, '');
      if (qa) return qa;
    }
    return null;
  }

  function profileSuggestsUae(profile) {
    var blob = norm(
      [
        profile && profile.country,
        profile && profile.location,
        profile && profile.city,
        profile && profile.state
      ].join(' ')
    );
    return /uae|u\.a\.e|united arab emirates|\bdubai\b|\babudhabi\b|abu dhabi|\bsharjah\b|\bajman\b/.test(
      blob
    );
  }

  function toYesNo(val) {
    if (val == null || String(val).trim() === '') return null;
    var s = String(val).trim();
    if (/^(yes|y|true|1|on)$/i.test(s)) return 'Yes';
    if (/^(no|n|false|0|off)$/i.test(s)) return 'No';
    // Free text that clearly affirms/negates
    if (/^yes\b/i.test(s)) return 'Yes';
    if (/^no\b/i.test(s)) return 'No';
    return null;
  }

  /**
   * Resolve Yes/No for a screening question label.
   * Returns { answer: 'Yes'|'No'|null, known: boolean, reason: string }
   */
  function resolveYesNoAnswer(profile, questionLabel) {
    profile = profile || {};
    var cleaned = cleanLabel(questionLabel);
    var lab = norm(cleaned);

    var custom =
      answerFromCustom(profile, cleaned) ||
      answerFromCustom(profile, questionLabel);
    var yn = toYesNo(custom);
    if (yn) return { answer: yn, known: true, reason: 'customAnswers' };

    // OACPA attested / experience letters — leave empty (do not invent)
    if (isOacpaOrLettersQuestion(lab)) {
      return { answer: null, known: false, reason: 'leave_empty_shell' };
    }

    // Strict CA-only BEFORE CA-or-ACCA (portfolio is ACCA+CMA, not ICAI CA)
    if (isCaOnlyQuestion(lab)) {
      yn =
        toYesNo(answerFromCustom(profile, 'Are you a qualified Chartered Accountant (CA)?')) ||
        toYesNo(answerFromCustom(profile, 'qualified_ca')) ||
        toYesNo(answerFromCustom(profile, 'ca_icai'));
      if (yn) return { answer: yn, known: true, reason: 'qualified_ca' };
      return { answer: 'No', known: true, reason: 'qualified_ca_default_no' };
    }

    // Qualified CA or ACCA / ACCA
    if (isCaOrAccaQuestion(lab) || (/are you a qualified/i.test(lab) && /\bacca\b/i.test(lab))) {
      yn =
        toYesNo(answerFromCustom(profile, 'Are you a qualified CA or ACCA?')) ||
        toYesNo(answerFromCustom(profile, 'qualified_ca_or_acca')) ||
        toYesNo(answerFromCustom(profile, 'acca_qualified')) ||
        toYesNo(answerFromCustom(profile, 'Are you ACCA qualified?')) ||
        toYesNo(answerFromCustom(profile, 'ACCA'));
      if (!yn) {
        var blob = [
          profile.certifications,
          profile.qualifications,
          profile.headline,
          profile.summary,
          (profile.customAnswers && profile.customAnswers.acca) || '',
          (profile.customAnswers && profile.customAnswers.acca_qualified) || ''
        ]
          .join(' ')
          .toLowerCase();
        if (/\bacca\b|cma\b|cpa\b/.test(blob)) yn = 'Yes';
      }
      if (yn) return { answer: yn, known: true, reason: 'ca_acca' };
      return { answer: null, known: false, reason: 'ca_acca_unknown' };
    }

    // B.Com / M.Com
    if (isBcomQuestion(lab)) {
      yn =
        toYesNo(answerFromCustom(profile, 'Do you hold a Bachelor’s Degree in Commerce (B.Com) or M.Com qualification?')) ||
        toYesNo(answerFromCustom(profile, "Do you hold a Bachelor's Degree in Commerce (B.Com) or M.Com qualification?")) ||
        toYesNo(answerFromCustom(profile, 'bcom_or_mcom'));
      if (yn) return { answer: yn, known: true, reason: 'bcom_or_mcom' };
      return { answer: null, known: false, reason: 'bcom_unknown' };
    }

    // ERP / accounting software
    if (isErpQuestion(lab)) {
      yn =
        toYesNo(answerFromCustom(profile, 'Do you have practical experience working with ERP/accounting software?')) ||
        toYesNo(answerFromCustom(profile, 'erp_experience'));
      if (yn) return { answer: yn, known: true, reason: 'erp_experience' };
      var erpBlob = [profile.skills, profile.summary, profile.certifications]
        .join(' ')
        .toLowerCase();
      if (/\berp\b|\boracle\b|\bsap\b|\bsage\b/.test(erpBlob)) {
        return { answer: 'Yes', known: true, reason: 'erp_from_skills' };
      }
      return { answer: null, known: false, reason: 'erp_unknown' };
    }

    // Currently employed
    if (/currently employed|are you employed|presently employed|currently working/i.test(lab)) {
      yn =
        toYesNo(answerFromCustom(profile, 'currently employed')) ||
        toYesNo(answerFromCustom(profile, 'Are you currently employed?')) ||
        toYesNo(profile.currentlyEmployed) ||
        toYesNo(profile.employed);
      if (yn) return { answer: yn, known: true, reason: 'employed' };
      return { answer: null, known: false, reason: 'employed_unknown' };
    }

    // Located in UAE / country
    if (
      /located in uae|currently located in uae|in the uae|united arab emirates|located in.*uae|based in uae/i.test(
        lab
      ) ||
      (/located in|currently located|based in/i.test(lab) && /uae|emirates|dubai/i.test(lab))
    ) {
      if (profileSuggestsUae(profile)) {
        return { answer: 'Yes', known: true, reason: 'uae_location' };
      }
      yn =
        toYesNo(answerFromCustom(profile, 'located in UAE')) ||
        toYesNo(answerFromCustom(profile, 'Are you currently located in UAE?'));
      if (yn) return { answer: yn, known: true, reason: 'uae_custom' };
      return { answer: 'No', known: true, reason: 'uae_not_in_profile' };
    }

    // Work experience in … industry
    if (/work experience in|experience in .+ industry|manufacturing industry|industry\??\s*$/i.test(lab)) {
      yn =
        toYesNo(custom) ||
        toYesNo(answerFromCustom(profile, questionLabel)) ||
        toYesNo(answerFromCustom(profile, 'manufacturing industry')) ||
        toYesNo(answerFromCustom(profile, 'work experience in manufacturing'));
      if (yn) return { answer: yn, known: true, reason: 'industry_custom' };
      return { answer: null, known: false, reason: 'industry_unknown' };
    }

    if (custom != null) {
      yn = toYesNo(custom);
      if (yn) return { answer: yn, known: true, reason: 'customAnswers' };
    }

    return { answer: null, known: false, reason: 'unmapped' };
  }

  /**
   * Collect Yes/No question blocks inside the modal.
   * Each item: { label, root, yesRadio/noRadio, kind:'yesno' }
   */
  function collectYesNoQuestions(modal) {
    var questions = [];
    if (!modal) return questions;

    var seen = [];

    function alreadyHave(label) {
      var n = norm(cleanLabel(label));
      for (var i = 0; i < seen.length; i++) {
        if (seen[i] === n) return true;
      }
      return false;
    }

    var groups = modal.querySelectorAll(
      'fieldset, [role="group"], [class*="question"], [class*="Question"], [class*="screening"], li, .form-group, .row, div'
    );
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (!visible(group)) continue;
      var radios = group.querySelectorAll('input[type="radio"]');
      if (radios.length < 2) continue;

      // Prefer deepest group: skip if a child group already owns these radios
      var nestedWithRadios = false;
      for (var c = 0; c < group.children.length; c++) {
        var child = group.children[c];
        if (child.querySelectorAll && child.querySelectorAll('input[type="radio"]').length >= 2) {
          // child is a tighter question container — skip this outer wrapper when it has many radios
          if (radios.length > child.querySelectorAll('input[type="radio"]').length) {
            nestedWithRadios = true;
            break;
          }
        }
      }
      // Still process; label extraction below handles noise

      var labelEl =
        group.querySelector('legend, .question-text, [class*="question-text"], [class*="label"], label:not([for])') ||
        null;
      var labelText = '';
      if (labelEl) {
        labelText = cleanLabel(labelEl.textContent || '');
      }
      if (!labelText || /^yes$|^no$/i.test(labelText) || labelText.length < 8) {
        labelText = cleanLabel(
          String(group.textContent || '')
            .replace(/\s+/g, ' ')
            .replace(/\bYes\b/gi, ' ')
            .replace(/\bNo\b/gi, ' ')
        );
      }
      labelText = cleanLabel(labelText);
      if (!labelText || labelText.length < 8 || labelText.length > 220) continue;
      if (
        !/\?|employed|located|experience|industry|are you|do you|have you|qualified|acca|\bca\b|b\.?\s*com|erp|software/i.test(
          labelText
        )
      ) {
        if (!/currently|uae|manufacturing|work|notice|remuner|salary|contract|degree|bachelor/i.test(labelText)) {
          continue;
        }
      }
      if (alreadyHave(labelText)) continue;

      var yesRadio = null;
      var noRadio = null;
      var optionCount = 0;
      for (var r = 0; r < radios.length; r++) {
        var radio = radios[r];
        var rLab = optionTextForRadio(radio, modal);
        var cls = classifyYesNoOption(rLab, radio.value);
        if (cls === 'Yes') {
          yesRadio = radio;
          optionCount++;
        } else if (cls === 'No') {
          noRadio = radio;
          optionCount++;
        }
      }
      // Pure Yes/No pair
      if (yesRadio && noRadio && radios.length <= 4) {
        seen.push(norm(cleanLabel(labelText)));
        questions.push({
          label: labelText,
          root: group,
          yesRadio: yesRadio,
          noRadio: noRadio,
          kind: 'yesno'
        });
        continue;
      }
      // Not yes/no — leave for multi-option collector
    }

    // Clickable Yes/No without radios (buttons / spans / role=radio)
    if (!questions.length) {
      var textBlocks = modal.querySelectorAll('p, label, div, li, span, h3, h4');
      for (var t = 0; t < textBlocks.length; t++) {
        var block = textBlocks[t];
        if (!visible(block)) continue;
        var bt = cleanLabel(block.textContent || '');
        if (bt.length < 12 || bt.length > 180) continue;
        if (!/\?$|are you|do you|have you|currently|experience in|qualified|b\.?\s*com|erp/i.test(bt)) continue;
        if (alreadyHave(bt)) continue;
        var container = block.closest('div, li, fieldset, section') || block.parentElement;
        if (!container) continue;
        var yesEl = null;
        var noEl = null;
        var opts = container.querySelectorAll(
          'button, label, span, a, [role="radio"], [role="button"], input[type="radio"]'
        );
        for (var o = 0; o < opts.length; o++) {
          var ot =
            opts[o].tagName === 'INPUT'
              ? optionTextForRadio(opts[o], modal)
              : buttonText(opts[o]);
          var c2 = classifyYesNoOption(ot, opts[o].value);
          if (c2 === 'Yes') yesEl = opts[o];
          if (c2 === 'No') noEl = opts[o];
        }
        if (yesEl || noEl) {
          seen.push(norm(cleanLabel(bt)));
          questions.push({
            label: bt,
            root: container,
            yesRadio: yesEl,
            noRadio: noEl,
            kind: 'yesno'
          });
        }
      }
    }

    return questions;
  }

  /**
   * Multi-option screening (e.g. "More than 10 years") — radios or clickable chips.
   */
  function collectMultiOptionQuestions(modal) {
    var out = [];
    if (!modal) return out;
    var seen = {};

    var groups = modal.querySelectorAll(
      'fieldset, [role="group"], [role="radiogroup"], [class*="question"], [class*="Question"], li, .form-group, div'
    );
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (!visible(group)) continue;
      var radios = Array.prototype.slice.call(group.querySelectorAll('input[type="radio"]'));
      var clickables = [];
      if (radios.length >= 2) {
        clickables = radios;
      } else {
        var chips = group.querySelectorAll(
          '[role="radio"], button, label[class*="option"], [class*="chip"], [class*="Option"]'
        );
        for (var i = 0; i < chips.length; i++) {
          var ch = chips[i];
          var ct = buttonText(ch);
          if (ct && ct.length > 0 && ct.length < 80 && !/^submit/i.test(ct)) clickables.push(ch);
        }
        if (clickables.length < 2) continue;
      }

      var yesNoPair = 0;
      var options = [];
      for (var r = 0; r < clickables.length; r++) {
        var el = clickables[r];
        var lab =
          el.tagName === 'INPUT' ? optionTextForRadio(el, modal) : buttonText(el);
        var cls = classifyYesNoOption(lab, el.value);
        if (cls) yesNoPair++;
        options.push({ el: el, label: lab || String(el.value || '') });
      }
      // Skip pure Yes/No — handled elsewhere
      if (yesNoPair >= 2 && options.length <= 3) continue;
      if (options.length < 2) continue;

      var labelEl =
        group.querySelector('legend, .question-text, [class*="question-text"], [class*="label"]') || null;
      var labelText = labelEl ? cleanLabel(labelEl.textContent || '') : '';
      if (!labelText || labelText.length < 8) {
        labelText = cleanLabel(
          String(group.textContent || '')
            .replace(/\s+/g, ' ')
            .slice(0, 300)
        );
        // Strip option texts from label
        for (var o = 0; o < options.length; o++) {
          if (options[o].label) {
            labelText = labelText.replace(options[o].label, ' ');
          }
        }
        labelText = cleanLabel(labelText);
      }
      if (!labelText || labelText.length < 8 || labelText.length > 220) continue;
      var key = norm(labelText);
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ label: labelText, root: group, options: options, kind: 'multi' });
    }
    return out;
  }

  function resolveMultiOptionAnswer(profile, questionLabel, options) {
    profile = profile || {};
    var cleaned = cleanLabel(questionLabel);
    var lab = norm(cleaned);
    var want =
      answerFromCustom(profile, cleaned) ||
      answerFromCustom(profile, questionLabel) ||
      '';

    if (isPostQualYearsQuestion(lab) || /how many years|years of relevant/i.test(lab)) {
      want =
        want ||
        answerFromCustom(
          profile,
          'How many years of relevant post-qualification experience do you have in Finance & Accounts?'
        ) ||
        answerFromCustom(profile, 'post_qualification_experience_band') ||
        'More than 10 years';
    }

    // OACPA / letters: never invent
    if (isOacpaOrLettersQuestion(lab)) {
      want =
        answerFromCustom(profile, cleaned) ||
        answerFromCustom(profile, 'oacpa_attested') ||
        answerFromCustom(profile, 'experience_letters_available') ||
        '';
      if (!String(want).trim()) return { answer: null, known: false, reason: 'leave_empty_shell' };
    }

    if (!String(want).trim()) return { answer: null, known: false, reason: 'unmapped' };

    var wantN = norm(want);
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < (options || []).length; i++) {
      var opt = options[i];
      var on = norm(opt.label || opt.el && opt.el.value);
      if (!on) continue;
      var score = 0;
      if (on === wantN) score = 100;
      else if (on.indexOf(wantN) !== -1 || wantN.indexOf(on) !== -1) score = 80;
      else if (/more than 10|10\+|over 10|11\+/i.test(want) && /more than 10|10\+|over 10|11\+/i.test(on)) {
        score = 90;
      }
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    if (best && bestScore >= 70) {
      return { answer: best.label || want, known: true, reason: 'multi_option', el: best.el };
    }
    return { answer: null, known: false, reason: 'option_mismatch', want: want };
  }

  function clickControl(target, root) {
    if (!target) return false;
    try {
      var label = findLabelForInput(target, root);
      // Prefer clicking the visible label (NaukriGulf often listens on label)
      if (label && label !== target) {
        realClick(label);
      }
      realClick(target);
      if (target.tagName === 'INPUT') {
        var type = String(target.type || '').toLowerCase();
        if (type === 'radio' || type === 'checkbox') {
          try {
            target.checked = true;
          } catch (_eChk) {
            /* ignore */
          }
          fireInputChange(target);
          // If still not checked, click again via label
          if (!target.checked && label) {
            realClick(label);
            try {
              target.checked = true;
            } catch (_e2) {
              /* ignore */
            }
            fireInputChange(target);
          }
        }
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  function clickYesNo(question, wantYes) {
    var target = wantYes ? question.yesRadio : question.noRadio;
    if (!target) return false;
    return clickControl(target, question.root);
  }

  function clickMultiOption(resolved) {
    if (!resolved || !resolved.el) return false;
    return clickControl(resolved.el, null);
  }

  function findSubmitAndApply(modal) {
    var root = modal || document;
    var nodes = root.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      var t = buttonText(el);
      if (/submit\s*&\s*apply|submit and apply/i.test(t)) return el;
    }
    return null;
  }


  /**
   * Fill text / textarea / select fields inside the Easy Apply modal
   * (Notice Period, Remuneration, contracting experience, location, salary).
   */
  function fillModalFields(modal, profile) {
    profile = profile || {};
    var ca = profile.customAnswers || {};
    var filled = 0;
    var details = [];
    if (!modal) return { filled: filled, details: details };

    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    }

    var notice = pick(
      ca['What is your notice Period?'],
      ca['Notice period'],
      ca.notice_period,
      ca.noticePeriod,
      ca.available_immediately,
      profile.noticePeriod,
      'Immediately available'
    );
    var remuner = pick(
      ca['What is your current Remuneration?'],
      ca.current_remuneration,
      ca.current_salary_text,
      ca.salary_text,
      ca.salary_display,
      ca.ignite_salary,
      profile.salaryText,
      profile.currentSalary,
      '0 AED / SAR (Currently available for immediate joining)'
    );
    var contracting = pick(
      ca.contracting_finance_experience,
      ca[
        'How many years of relevant experience do you have in finance/accounting within the contracting industry?'
      ],
      ca['contracting industry']
    );
    var location = pick(
      ca.location,
      ca['Primary work location'],
      ca.preferred_locations,
      profile.city,
      profile.location,
      'Riyadh'
    );
    var phone = pick(profile.phoneFull, profile.phoneE164, ca.phone_full, ca.Phone);

    var controls = modal.querySelectorAll('input, textarea, select');
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      if (!visible(el) || el.disabled) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'radio' || type === 'checkbox' || type === 'file') {
        continue;
      }
      var lab = cleanLabel(getLabelFor(el, modal) || el.name || el.placeholder || '');
      var nlab = norm(lab);
      if (!nlab) continue;

      var value = '';
      if (/notice\s*period|when can you (join|start)|availability|available|immediate/i.test(nlab)) {
        value = notice;
      } else if (/remuneration|current\s*(salary|ctc|pay)|salary|compensation|monthly\s*salary/i.test(nlab)) {
        value = remuner;
      } else if (/contracting|construction|years of relevant|finance\/accounting within/i.test(nlab)) {
        value = contracting;
      } else if (/location|city|based in|work location|where are you/i.test(nlab)) {
        value = location;
      } else if (/phone|mobile|telephone|contact number/i.test(nlab)) {
        value = phone;
      } else {
        // generic customAnswers / knowledge lookup
        value = answerFromCustom(profile, lab) || '';
      }
      if (!value) continue;
      if (el.value && String(el.value).trim() !== '') continue;

      try {
        if (el.tagName === 'SELECT') {
          // try match option
          var opts = el.options || [];
          var matched = false;
          for (var o = 0; o < opts.length; o++) {
            var ot = String(opts[o].text || opts[o].value || '');
            if (norm(ot) === norm(value) || (norm(ot) && norm(value).indexOf(norm(ot)) !== -1) || (norm(ot) && norm(ot).indexOf(norm(value)) !== -1)) {
              el.selectedIndex = o;
              matched = true;
              break;
            }
          }
          // Notice period selects often have "Immediate" / "Currently serving"
          if (!matched && /notice|available/i.test(nlab)) {
            for (var o2 = 0; o2 < opts.length; o2++) {
              var ot2 = String(opts[o2].text || '');
              if (/immediate|serving notice|0\s*day|available/i.test(ot2)) {
                el.selectedIndex = o2;
                matched = true;
                break;
              }
            }
          }
          if (!matched) continue;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        filled++;
        details.push({ label: lab, value: value.slice(0, 80) });
      } catch (_e) {
        /* ignore */
      }
    }
    return { filled: filled, details: details };
  }

  function answerModalQuestions(modal, profile, runMode) {
    var textFill = fillModalFields(modal, profile);
    var questions = collectYesNoQuestions(modal);
    var multi = collectMultiOptionQuestions(modal);
    var filled = textFill.filled || 0;
    var unmatched = [];
    var answered = (textFill.details || []).map(function (d) {
      return { label: d.label, answer: d.value, reason: 'modal_text' };
    });

    var answeredLabels = {};

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var resolved = resolveYesNoAnswer(profile, q.label);
      if (resolved.answer) {
        var wantYes = resolved.answer === 'Yes';
        if (clickYesNo(q, wantYes)) {
          filled++;
          answered.push({ label: q.label, answer: resolved.answer, reason: resolved.reason });
          answeredLabels[norm(cleanLabel(q.label))] = true;
        } else {
          unmatched.push(q.label);
        }
      } else if (resolved.reason === 'leave_empty_shell') {
        // Intentionally skip — do not invent OACPA / letters answers
        answeredLabels[norm(cleanLabel(q.label))] = true;
      } else {
        unmatched.push(q.label);
      }
    }

    for (var m = 0; m < multi.length; m++) {
      var mq = multi[m];
      var mk = norm(cleanLabel(mq.label));
      if (answeredLabels[mk]) continue;
      // Skip if this looks like a yes/no we already handled
      var ynOpts = 0;
      for (var oi = 0; oi < (mq.options || []).length; oi++) {
        if (classifyYesNoOption(mq.options[oi].label, mq.options[oi].el && mq.options[oi].el.value)) {
          ynOpts++;
        }
      }
      if (ynOpts >= 2 && (mq.options || []).length <= 3) continue;

      var mResolved = resolveMultiOptionAnswer(profile, mq.label, mq.options);
      if (mResolved.answer && mResolved.el) {
        if (clickMultiOption(mResolved)) {
          filled++;
          answered.push({ label: mq.label, answer: mResolved.answer, reason: mResolved.reason });
          answeredLabels[mk] = true;
        } else {
          unmatched.push(mq.label);
        }
      } else if (mResolved.reason === 'leave_empty_shell') {
        answeredLabels[mk] = true;
      } else if (isPostQualYearsQuestion(mq.label) || /how many years/i.test(mq.label)) {
        unmatched.push(mq.label);
      }
      // Other multi-option unknowns: do not flood unmatched unless required-looking
    }

    return {
      filled: filled,
      unmatchedLabels: unmatched,
      answered: answered,
      questionCount: questions.length + multi.length
    };
  }

  function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var doc = (ctx && ctx.document) || (typeof document !== 'undefined' ? document : null);
    var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
    if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    var href = '';
    try {
      href = String((ctx && ctx.url) || (typeof location !== 'undefined' ? location.href : '') || '');
    } catch (_e) {
      href = '';
    }

    if (!doc) {
      return {
        ok: false,
        adapterId: 'naukrigulf',
        error: 'No document',
        filled: 0,
        unmatched: 0,
        total: 0
      };
    }

    if (detectProfileRedirect(doc, href)) {
      return profileRedirectResult();
    }

    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      var ch = global.FillApplyChallenges.detectChallenge(doc);
      if (ch && ch.challenged) {
        return {
          ok: false,
          adapterId: 'naukrigulf',
          needsHuman: true,
          challenge: ch,
          filled: 0,
          unmatched: 0,
          total: 0,
          error: global.FillApplyChallenges.describeChallenge(ch) || 'Human verification required',
          pauseReason: 'challenge'
        };
      }
    }

    return Promise.resolve().then(async function () {
      var totalFilled = 0;
      var submitted = false;
      var advanced = false;
      var modal = findEasyApplyModal(doc);

      // Open Easy Apply if modal not already present
      if (!modal) {
        var applyBtn = findEasyApplyButton(doc);
        if (applyBtn) {
          try {
            if (clickApplyControl(applyBtn)) advanced = true;
            await sleep(humanDelay(700));
          } catch (_e2) {
            /* ignore */
          }
          modal = await waitForModal(doc, 8000);
        } else {
          // Maybe modal already open after navigation
          modal = await waitForModal(doc, 1500);
        }
      }

      if (detectProfileRedirect(doc, typeof location !== 'undefined' ? location.href : href)) {
        return profileRedirectResult();
      }

      if (!modal) {
        // Prefer Easy Apply when it opens; otherwise start ANY apply path.
        var standardBtn = findStandardApplyButton(doc);
        if (standardBtn) {
          try {
            if (clickApplyControl(standardBtn)) advanced = true;
            await sleep(humanDelay(700));
          } catch (_stdClick) {
            /* ignore */
          }
          // Re-check: some Apply CTAs still open the Easy Apply modal
          modal = await waitForModal(doc, 4500);
          if (!modal) {
            return {
              ok: true,
              adapterId: 'naukrigulf',
              clickedApplyStart: true,
              reDetect: true,
              handedOff: true,
              deferToPageAdapter: true,
              externalApply: true,
              filled: 0,
              unmatched: 0,
              total: 0,
              advanced: true,
              submitted: false,
              step: 'standard_apply_handoff',
              message:
                'Clicked Apply (Easy Apply modal not present) — waiting for apply form or company site',
              runMode: runMode,
              error: null
            };
          }
        } else {
          // SPA hydrate retry — JobPool→NG often paints Apply after first paint
          await sleep(humanDelay(900));
          var retryEasy = findEasyApplyButton(doc);
          if (retryEasy) {
            if (clickApplyControl(retryEasy)) advanced = true;
            await sleep(humanDelay(700));
            modal = await waitForModal(doc, 8000);
          }
          if (!modal) {
            var retryStd = findStandardApplyButton(doc);
            if (retryStd) {
              if (clickApplyControl(retryStd)) advanced = true;
              await sleep(humanDelay(700));
              modal = await waitForModal(doc, 4500);
              if (!modal) {
                return {
                  ok: true,
                  adapterId: 'naukrigulf',
                  clickedApplyStart: true,
                  reDetect: true,
                  handedOff: true,
                  deferToPageAdapter: true,
                  externalApply: true,
                  filled: 0,
                  unmatched: 0,
                  total: 0,
                  advanced: true,
                  submitted: false,
                  step: 'standard_apply_handoff_retry',
                  message:
                    'Clicked Apply after SPA wait — waiting for apply form or company site',
                  runMode: runMode,
                  error: null
                };
              }
            }
          }
        }
        if (!modal && global.__fillApply && typeof global.__fillApply.run === 'function') {
          // Form may already be on the page (or generic Apply-start can open it)
          try {
            var generic = await global.__fillApply.run(profile, {
              highlightUnmatched: false,
              runMode: runMode,
              documents: (ctx && ctx.documents) || {},
              fileInputHints: (ctx && ctx.fileInputHints) || [
                { kind: 'resume', match: 'resume|cv' },
                { kind: 'cover', match: 'cover' }
              ]
            });
            // Do NOT treat empty ok:true generic fills as success — that aborted
            // JobPool→NG Apply handoff when the posting had Apply but no form yet.
            if (
              generic &&
              (generic.filled > 0 ||
                generic.clickedApplyStart ||
                generic.submitted ||
                generic.handedOff ||
                generic.externalApply)
            ) {
              generic.adapterId = 'naukrigulf';
              generic.usedGenericFallback = true;
              generic.advanced = advanced || !!generic.clickedApplyStart;
              return generic;
            }
          } catch (_genErr) {
            /* fall through to soft pause */
          }
        }
        return {
          ok: false,
          adapterId: 'naukrigulf',
          needsHuman: true,
          pauseReason: 'structure_drift',
          error:
            'NaukriGulf: no Easy Apply modal and no Apply button found — open Apply (or Easy Apply) manually, then Resume.',
          filled: 0,
          unmatched: 0,
          total: 0,
          advanced: advanced,
          submitted: false,
          runMode: runMode
        };
      }

      var result = answerModalQuestions(modal, profile, runMode);
      totalFilled += result.filled || 0;

      // Unknown required questions
      if (result.unmatchedLabels && result.unmatchedLabels.length) {
        if (runMode === 'submit') {
          var ngMissing = (result.unmatchedLabels || []).map(function (l) {
            return String(l).replace(/\s+/g, ' ').trim().slice(0, 80);
          });
          return {
            ok: false,
            adapterId: 'naukrigulf',
            needsHuman: true,
            pauseReason: 'missing_profile_field',
            missingProfileFields: ngMissing,
            error:
              'NaukriGulf Easy Apply: unanswered required screening question — fill in Options or on the page, then Resume. "' +
              String(result.unmatchedLabels[0]).slice(0, 120) +
              '"',
            filled: totalFilled,
            unmatched: result.unmatchedLabels.length,
            total: totalFilled + result.unmatchedLabels.length,
            unmatchedLabels: result.unmatchedLabels,
            answered: result.answered,
            advanced: advanced,
            submitted: false,
            runMode: runMode,
            driftLabel: result.unmatchedLabels[0]
          };
        }
        // fill / ready: leave unanswered, form still "ready" in modal
      }

      if (runMode === 'submit') {
        var submitBtn = findSubmitAndApply(modal);
        if (submitBtn) {
          try {
            submitBtn.click();
            submitted = true;
            await sleep(humanDelay(400));
          } catch (_e3) {
            return {
              ok: false,
              adapterId: 'naukrigulf',
              needsHuman: true,
              pauseReason: 'structure_drift',
              error: 'NaukriGulf Easy Apply: could not click Submit & Apply',
              filled: totalFilled,
              unmatched: result.unmatchedLabels.length,
              total: totalFilled,
              advanced: advanced,
              submitted: false,
              runMode: runMode
            };
          }
        } else {
          return {
            ok: false,
            adapterId: 'naukrigulf',
            needsHuman: true,
            pauseReason: 'structure_drift',
            error: 'NaukriGulf Easy Apply: Submit & Apply button not found in modal',
            filled: totalFilled,
            unmatched: result.unmatchedLabels.length,
            total: totalFilled,
            advanced: advanced,
            submitted: false,
            runMode: runMode
          };
        }
      }

      return {
        ok: true,
        adapterId: 'naukrigulf',
        filled: totalFilled,
        unmatched: (result.unmatchedLabels && result.unmatchedLabels.length) || 0,
        total: totalFilled + ((result.unmatchedLabels && result.unmatchedLabels.length) || 0),
        advanced: advanced,
        submitted: submitted,
        answered: result.answered,
        unmatchedLabels: result.unmatchedLabels,
        questionCount: result.questionCount,
        step: submitted ? 'submitted' : 'easy_apply_modal',
        runMode: runMode,
        error: null
      };
    });
  }

  var adapter = {
    id: 'naukrigulf',
    name: 'NaukriGulf',
    category: 'board',
    hosts: HOSTS,
    detect: detect,
    detectProfileRedirect: detectProfileRedirect,
    findEasyApplyModal: findEasyApplyModal,
    findEasyApplyButton: findEasyApplyButton,
    findStandardApplyButton: findStandardApplyButton,
    fieldMaps: [],
    submitSelector:
      'button[type="submit"], input[type="submit"], button[aria-label*="Submit" i]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv' },
      { kind: 'cover', match: 'cover' }
    ],
    fill: fill
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  adapter._test = {
    cleanLabel: cleanLabel,
    stripOptionNoise: stripOptionNoise,
    resolveYesNoAnswer: resolveYesNoAnswer,
    resolveMultiOptionAnswer: resolveMultiOptionAnswer,
    collectYesNoQuestions: collectYesNoQuestions,
    collectMultiOptionQuestions: collectMultiOptionQuestions,
    optionTextForRadio: optionTextForRadio,
    classifyYesNoOption: classifyYesNoOption,
    clickYesNo: clickYesNo,
    clickControl: clickControl,
    isCaOnlyQuestion: isCaOnlyQuestion,
    isCaOrAccaQuestion: isCaOrAccaQuestion,
    fillModalFields: fillModalFields,
    answerModalQuestions: answerModalQuestions
  };
  global.FillApply_naukrigulfAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
