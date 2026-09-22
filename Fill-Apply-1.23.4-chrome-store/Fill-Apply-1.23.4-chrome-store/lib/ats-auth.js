/**
 * ATS account auth lifecycle + safe Google OAuth UI automation.
 *
 * Extends existing auth-wall / challenge gates: may attempt one Google OAuth
 * UI path (Continue/Sign in with Google + high-confidence account chooser).
 * Never invents passwords, never bypasses CAPTCHA/MFA/email verification,
 * never scrapes cookies/tokens. Ambiguous accounts → pause.
 *
 * Attaches FillApplyAtsAuth to globalThis (page + service-worker injectable).
 */
(function (global) {
  'use strict';

  /** Deterministic result codes for the auth lifecycle. */
  var AUTH_RESULTS = {
    AUTHENTICATED: 'AUTHENTICATED',
    ACCOUNT_CREATED: 'ACCOUNT_CREATED',
    ACCOUNT_ALREADY_EXISTS: 'ACCOUNT_ALREADY_EXISTS',
    USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED',
    CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
    MFA_REQUIRED: 'MFA_REQUIRED',
    EMAIL_VERIFICATION_REQUIRED: 'EMAIL_VERIFICATION_REQUIRED',
    UNSUPPORTED_AUTH_FLOW: 'UNSUPPORTED_AUTH_FLOW',
    AUTH_FAILED: 'AUTH_FAILED',
    TIMEOUT: 'TIMEOUT',
    /** No auth wall — fill may continue. */
    NOT_REQUIRED: 'NOT_REQUIRED'
  };

  /**
   * No real applicant PII is hardcoded. Name matching uses the active profile
   * (see preferredNamesFromProfile). Spelling aliases (chaudhary/chaudary/chaudhry)
   * are generated dynamically from the profile name.
   */
  var APPLICANT_NAME_PREFERRED = '';
  var APPLICANT_NAME_VARIANTS = [];
  var APPLICANT_NAME_PARTS = [];

  var GOOGLE_AUTH_ACTION_RE =
    /^(continue|sign\s*in|sign\s*up|log\s*in|login|register|create\s*(an\s*)?account)?\s*(with\s+)?google(\s+account)?$/i;
  var GOOGLE_AUTH_LOOSE_RE =
    /\b(continue|sign\s*in|sign\s*up|log\s*in|login)\s+with\s+google\b|\bgoogle\s+(sign\s*in|sign\s*up|login)\b/i;
  var CONTINUE_AS_RE = /^continue\s+as\b/i;
  var CONTINUE_APPLYING_RE = /continue\s+applying(\s+to)?/i;
  var FACEBOOK_AUTH_RE =
    /\b(continue|sign\s*in|sign\s*up|log\s*in|login)?\s*(with\s+)?(facebook|fb)\b|^facebook$|^fb$/i;
  var SOCIAL_PRIVACY_RE = /activity\s+will\s+remain\s+private/i;

  var EXISTING_ACCOUNT_RE =
    /already\s+have\s+an\s+account|account\s+already\s+exists|email\s+(is\s+)?already\s+(registered|in\s+use|taken)|user\s+already\s+exists|already\s+registered|an\s+account\s+with\s+(this|that)\s+email|email\s+address\s+is\s+already|looks\s+like\s+you\s+already\s+have/i;

  var MFA_RE =
    /\b(2-?step|two[-\s]?factor|two[-\s]?step|authenticator|verification\s+code|enter\s+(the\s+)?code|security\s+key|confirm\s+it.?s\s+you|verify\s+it.?s\s+you)\b/i;
  var EMAIL_VERIFY_RE =
    /verify\s+(your\s+)?email|confirm\s+(your\s+)?email|check\s+your\s+(email|inbox)|we\s+(have\s+)?sent\s+(you\s+)?(a\s+)?(verification|confirm)/i;

  function pageText(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return '';
    try {
      var title = '';
      try {
        title = String(doc.title || '') + ' ';
      } catch (_t) {}
      var body = '';
      if (doc.body) {
        body = doc.body.innerText || doc.body.textContent || '';
      }
      return (title + String(body || '')).slice(0, 16000);
    } catch (_e) {
      return '';
    }
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var st =
        el.ownerDocument && el.ownerDocument.defaultView
          ? el.ownerDocument.defaultView.getComputedStyle(el)
          : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) {
        return false;
      }
      if (st && st.opacity !== '' && st.opacity != null && Number(st.opacity) === 0) {
        return false;
      }
      return true;
    } catch (_e) {
      return true;
    }
  }

  function controlText(el) {
    if (!el) return '';
    var raw =
      el.getAttribute('aria-label') ||
      el.getAttribute('data-provider') ||
      el.getAttribute('title') ||
      '';
    if (!raw) {
      // jsdom often has no innerText; prefer textContent over empty value
      raw = el.innerText || el.textContent || el.value || '';
    }
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize person / account display names for conservative matching.
   * Maps Chaudary / Chaudhary → chaudhry so preferred + variant equate.
   */
  function normalizePersonName(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\bchaudhary\b/g, 'chaudhry')
      .replace(/\bchaudary\b/g, 'chaudhry')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesEquivalent(a, b) {
    var na = normalizePersonName(a);
    var nb = normalizePersonName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // Token-set equality (order-insensitive) for reordered given/family names.
    var ta = na.split(' ').filter(Boolean).sort().join(' ');
    var tb = nb.split(' ').filter(Boolean).sort().join(' ');
    return ta === tb && ta.length > 0;
  }

  function spellingVariants(name) {
    var base = String(name || '').trim();
    if (!base) return [];
    var out = [base];
    // Common transliterations — applied to whatever the profile provides
    var swaps = [
      [/\bChaudhary\b/gi, 'Chaudhry'],
      [/\bChaudary\b/gi, 'Chaudhry'],
      [/\bChaudhry\b/gi, 'Chaudhary'],
      [/\bChaudhry\b/gi, 'Chaudary']
    ];
    swaps.forEach(function (pair) {
      var next = base.replace(pair[0], pair[1]);
      if (next && next !== base) out.push(next);
    });
    return out;
  }

  function preferredNamesFromProfile(profile) {
    var out = APPLICANT_NAME_VARIANTS.slice();
    if (profile) {
      var full =
        profile.fullName ||
        [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
        '';
      if (full) {
        spellingVariants(full).forEach(function (n) {
          out.push(n);
        });
      }
      if (profile.firstName && profile.lastName) {
        spellingVariants(String(profile.firstName) + ' ' + String(profile.lastName)).forEach(function (n) {
          out.push(n);
        });
      }
      if (profile.preferredName) out.push(String(profile.preferredName));
    }
    var seen = {};
    var uniq = [];
    out.forEach(function (n) {
      var k = normalizePersonName(n);
      if (k && !seen[k]) {
        seen[k] = true;
        uniq.push(n);
      }
    });
    return uniq;
  }

  function profileEmail(profile) {
    return String((profile && profile.email) || '')
      .trim()
      .toLowerCase();
  }

  function detectAuthWall(doc, opts) {
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.detectAuthWall) {
      return global.FillApplyAuthWalls.detectAuthWall(doc, opts);
    }
    return { challenged: false, kind: null, detail: '', markers: [], passwordFields: 0 };
  }

  function detectHumanChallenge(doc) {
    if (global.FillApplyChallenges && global.FillApplyChallenges.detectChallenge) {
      return global.FillApplyChallenges.detectChallenge(doc);
    }
    return { challenged: false, kind: null, detail: '', markers: [] };
  }

  function isFacebookAuthControl(el) {
    if (!el) return false;
    var t = controlText(el).slice(0, 120);
    var aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    var data = String(
      el.getAttribute('data-provider') ||
        el.getAttribute('data-auth') ||
        el.getAttribute('data-action') ||
        el.getAttribute('data-testid') ||
        ''
    ).toLowerCase();
    var cls = (String(el.className || '') + ' ' + String(el.id || '')).toLowerCase();
    if (data === 'facebook' || data === 'fb') return true;
    if (/\bfacebook\b|\bfb[_-]?login\b|\bfb[_-]?auth\b/.test(cls) && !/\bgoogle\b/.test(cls)) {
      return true;
    }
    return FACEBOOK_AUTH_RE.test(t) || FACEBOOK_AUTH_RE.test(aria);
  }

  function hasVisibleFacebookSocial(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return false;
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"], div[role="link"], span[role="button"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (!isVisible(nodes[i])) continue;
      if (isFacebookAuthControl(nodes[i])) return true;
    }
    return false;
  }

  function isContinueApplyingContext(doc) {
    if (global.FillApplyAuthWalls && global.FillApplyAuthWalls.isContinueApplyingSocialWall) {
      var w = global.FillApplyAuthWalls.isContinueApplyingSocialWall(doc);
      if (w && w.found) return true;
    }
    var text = pageText(doc);
    return CONTINUE_APPLYING_RE.test(text) || SOCIAL_PRIVACY_RE.test(text);
  }

  /**
   * Bare "google" / icon social buttons are valid only in a social-login context
   * (Continue applying overlay, Facebook sibling, data-provider, etc.).
   */
  function bareGoogleAllowed(el, t, aria, dataProvider, doc) {
    if (!/^google$/i.test(String(t || '').trim())) return false;
    if (/google/i.test(aria) || dataProvider === 'google') return true;
    var cls = (String(el.className || '') + ' ' + String(el.id || '')).toLowerCase();
    if (/\bgoogle\b/.test(cls)) return true;
    try {
      var img = el.querySelector && el.querySelector('img, svg');
      if (img) {
        var ib =
          String(img.getAttribute('alt') || '') +
          ' ' +
          String(img.getAttribute('src') || '') +
          ' ' +
          String(img.className || '');
        if (/google/i.test(ib)) return true;
      }
    } catch (_i) {}
    if (hasVisibleFacebookSocial(doc)) return true;
    if (isContinueApplyingContext(doc)) return true;
    return false;
  }

  /**
   * Find visible Continue / Sign in with Google actions (not arbitrary "Google" text).
   * Never returns Facebook controls.
   */
  function findGoogleAuthActions(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    var nodes = doc.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"], [role="button"], div[role="link"], span[role="button"]'
    );
    var found = [];
    var socialCtx = isContinueApplyingContext(doc) || hasVisibleFacebookSocial(doc);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isVisible(el)) continue;
      // Hard rule: never treat Facebook as Google
      if (isFacebookAuthControl(el)) continue;
      var t = controlText(el).slice(0, 120);
      var aria = String(el.getAttribute('aria-label') || '');
      var dataProvider = String(
        el.getAttribute('data-provider') ||
          el.getAttribute('data-auth') ||
          el.getAttribute('data-action') ||
          el.getAttribute('data-testid') ||
          ''
      ).toLowerCase();
      // Icon / bare provider buttons may have empty textContent
      if ((!t || !String(t).trim()) && dataProvider !== 'google' && !/google/i.test(aria)) {
        var clsEmpty = (String(el.className || '') + ' ' + String(el.id || '')).toLowerCase();
        if (!/\bgoogle\b/.test(clsEmpty)) continue;
        t = 'google';
      }
      if (!t || t.length > 80) continue;
      var href = '';
      try {
        href = String(el.href || el.getAttribute('href') || '').toLowerCase();
      } catch (_h) {}
      var looksGoogle =
        GOOGLE_AUTH_ACTION_RE.test(t) ||
        GOOGLE_AUTH_LOOSE_RE.test(t) ||
        GOOGLE_AUTH_LOOSE_RE.test(aria) ||
        dataProvider === 'google' ||
        (dataProvider.indexOf('google') !== -1 &&
          /\b(sign|log|continue|auth|oauth|sso|google)\b/i.test(t + ' ' + aria + ' ' + dataProvider)) ||
        (/accounts\.google\.com|google\.com\/o\/oauth|googleapis\.com\/auth/i.test(href) &&
          /\b(sign|log|continue|google)\b/i.test(t + ' ' + aria));
      // Bare "google" label: only in social / Continue-applying context
      if (!looksGoogle && bareGoogleAllowed(el, t, aria, dataProvider, doc)) {
        looksGoogle = true;
      }
      if (!looksGoogle) continue;
      if (/^google$/i.test(t.trim()) && !bareGoogleAllowed(el, t, aria, dataProvider, doc) && !socialCtx) {
        continue;
      }
      if (/\b(maps|drive|docs|analytics|cloud|play|chrome|search)\b/i.test(t) && !GOOGLE_AUTH_LOOSE_RE.test(t)) {
        continue;
      }
      found.push({ el: el, text: t || 'google', href: href });
    }
    return found;
  }

  function findContinueAsButtons(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    var nodes = doc.querySelectorAll('a, button, div[role="link"], div[role="button"], [role="button"], li');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isVisible(el)) continue;
      var t = controlText(el).slice(0, 160);
      if (!t) continue;
      if (CONTINUE_AS_RE.test(t) || /@/.test(t) && /google/i.test(pageText(doc).slice(0, 500))) {
        // Prefer explicit Continue as …
        if (CONTINUE_AS_RE.test(t) || el.getAttribute('data-identifier') || el.getAttribute('data-email')) {
          out.push({ el: el, text: t });
        }
      }
    }
    return out;
  }

  /**
   * Parse Google account chooser cards (accounts.google.com style).
   * Returns { name, email, el, text }[] — never guesses when ambiguous.
   */
  function listGoogleAccountOptions(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    var options = [];
    var seen = {};

    function pushOpt(el, name, email, text) {
      var key = (normalizePersonName(name) || '') + '|' + String(email || '').toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      options.push({
        el: el,
        name: String(name || '').trim(),
        email: String(email || '')
          .trim()
          .toLowerCase(),
        text: String(text || '').slice(0, 200)
      });
    }

    // data-identifier / data-email on list items
    var idNodes = doc.querySelectorAll(
      '[data-identifier], [data-email], [data-account], li[data-identifier], div[data-identifier]'
    );
    for (var i = 0; i < idNodes.length; i++) {
      var el = idNodes[i];
      if (!isVisible(el) && el.offsetParent === null) continue;
      var email =
        el.getAttribute('data-identifier') ||
        el.getAttribute('data-email') ||
        el.getAttribute('data-account') ||
        '';
      var text = controlText(el);
      var name = '';
      var nameEl = el.querySelector('.account-name, .yAlK0e, [data-name], .name');
      if (nameEl) name = controlText(nameEl);
      if (!name) {
        var lines = text.split(/\n|\s{2,}/).map(function (s) {
          return s.trim();
        }).filter(Boolean);
        for (var L = 0; L < lines.length; L++) {
          if (/@/.test(lines[L])) {
            if (!email) email = lines[L];
          } else if (!name && lines[L].length > 1 && !CONTINUE_AS_RE.test(lines[L])) {
            name = lines[L];
          }
        }
      }
      if (!email && /@/.test(text)) {
        var m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (m) email = m[0];
      }
      if (email || name) pushOpt(el, name, email, text);
    }

    // "Continue as Name" buttons
    var cont = findContinueAsButtons(doc);
    for (var c = 0; c < cont.length; c++) {
      var ct = cont[c].text;
      var asName = '';
      var asMatch = ct.match(/continue\s+as\s+(.+)/i);
      if (asMatch) asName = asMatch[1].replace(/\s+/g, ' ').trim();
      var em = '';
      var emMatch = ct.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (emMatch) em = emMatch[0];
      pushOpt(cont[c].el, asName, em, ct);
    }

    // Generic account chooser rows with email in text
    if (!options.length) {
      var rows = doc.querySelectorAll('[role="link"], [role="button"], li, div[jsname]');
      for (var r = 0; r < rows.length && options.length < 12; r++) {
        var row = rows[r];
        if (!isVisible(row)) continue;
        var rt = controlText(row).slice(0, 200);
        if (!rt || rt.length > 180) continue;
        if (!/@/.test(rt) && !CONTINUE_AS_RE.test(rt)) continue;
        var rem = rt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        var rname = rt
          .replace(CONTINUE_AS_RE, '')
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (rem || rname) pushOpt(row, rname, rem ? rem[0] : '', rt);
      }
    }

    return options;
  }

  /**
   * Conservative account match. Returns:
   *  { status: 'match'|'ambiguous'|'none', option?, candidates[] }
   * Never guesses when two accounts could match.
   */
  function matchApplicantAccount(options, profile) {
    options = options || [];
    var emailsWanted = [];
    var pe = profileEmail(profile);
    if (pe) emailsWanted.push(pe);
    var names = preferredNamesFromProfile(profile);

    var emailHits = [];
    var nameHits = [];

    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      if (opt.email && emailsWanted.indexOf(opt.email.toLowerCase()) !== -1) {
        emailHits.push(opt);
      }
      for (var n = 0; n < names.length; n++) {
        if (opt.name && namesEquivalent(opt.name, names[n])) {
          nameHits.push(opt);
          break;
        }
      }
    }

    // Deduplicate hits by email+name
    function uniqOpts(list) {
      var s = {};
      var u = [];
      list.forEach(function (o) {
        var k = (o.email || '') + '|' + normalizePersonName(o.name);
        if (!s[k]) {
          s[k] = true;
          u.push(o);
        }
      });
      return u;
    }
    emailHits = uniqOpts(emailHits);
    nameHits = uniqOpts(nameHits);

    // High confidence: single email match
    if (emailHits.length === 1) {
      return { status: 'match', option: emailHits[0], confidence: 'email', candidates: options };
    }
    if (emailHits.length > 1) {
      return { status: 'ambiguous', option: null, confidence: null, candidates: emailHits };
    }

    // Name-only: only if exactly one option matches and there aren't multiple accounts
    if (nameHits.length === 1 && options.length === 1) {
      return { status: 'match', option: nameHits[0], confidence: 'name_sole', candidates: options };
    }
    if (nameHits.length === 1 && options.length > 1) {
      // Name unique among listed accounts → still high confidence if email absent on others
      var only = nameHits[0];
      if (only.email && pe && only.email === pe) {
        return { status: 'match', option: only, confidence: 'name+email', candidates: options };
      }
      // Unique visible name match with no conflicting email on that card
      if (!only.email || !pe) {
        // Without email confirmation on a multi-account chooser → pause
        return { status: 'ambiguous', option: null, confidence: null, candidates: nameHits };
      }
    }
    if (nameHits.length > 1) {
      return { status: 'ambiguous', option: null, confidence: null, candidates: nameHits };
    }

    if (!options.length) {
      return { status: 'none', option: null, confidence: null, candidates: [] };
    }
    return { status: 'none', option: null, confidence: null, candidates: options };
  }

  function detectExistingAccountMessage(doc) {
    var text = pageText(doc);
    if (!text) return null;
    if (EXISTING_ACCOUNT_RE.test(text)) {
      var m = text.match(EXISTING_ACCOUNT_RE);
      return {
        found: true,
        detail: (m && m[0]) || 'account already exists',
        markers: ['existing_account']
      };
    }
    return null;
  }

  function detectMfaOrEmailVerification(doc) {
    var text = pageText(doc);
    if (!text) return null;
    if (EMAIL_VERIFY_RE.test(text) && !/continue with google/i.test(text.slice(0, 400))) {
      return { code: AUTH_RESULTS.EMAIL_VERIFICATION_REQUIRED, detail: 'Email verification required' };
    }
    if (MFA_RE.test(text)) {
      // Avoid false positive on marketing copy alone — require input or strong prompt
      var hasCodeInput = false;
      try {
        var inputs = doc.querySelectorAll('input[type="tel"], input[type="text"], input[type="number"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
          if (!isVisible(inputs[i])) continue;
          var lab = controlText(inputs[i]) + ' ' + (inputs[i].name || '') + ' ' + (inputs[i].placeholder || '');
          if (/code|otp|token|pin|verify/i.test(lab) || inputs[i].autocomplete === 'one-time-code') {
            hasCodeInput = true;
            break;
          }
        }
      } catch (_e) {}
      if (hasCodeInput || /enter\s+(the\s+)?(code|pin)|2-?step|authenticator/i.test(text.slice(0, 3000))) {
        return { code: AUTH_RESULTS.MFA_REQUIRED, detail: 'MFA / 2-step verification required' };
      }
    }
    return null;
  }

  function isGoogleAccountsHost(href) {
    try {
      var u = new URL(String(href || (typeof location !== 'undefined' ? location.href : '') || ''));
      return /(^|\.)accounts\.google\.com$/i.test(u.hostname) || /(^|\.)account\.google\.com$/i.test(u.hostname);
    } catch (_e) {
      return /accounts\.google\.com/i.test(String(href || ''));
    }
  }

  /**
   * Multi-signal auth success check (DOM only — no cookie/token scraping).
   */
  function detectAuthSuccess(doc, opts) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    opts = opts || {};
    if (!doc) {
      return { success: false, signals: [] };
    }
    var signals = [];
    var wall = detectAuthWall(doc, { requirePasswordField: true });
    if (wall && wall.ssoConnected) signals.push('sso_connected');
    if (wall && !wall.challenged) signals.push('no_auth_wall');

    var text = pageText(doc);
    if (/\b(sign\s*out|log\s*out|logout)\b/i.test(text) && !wall.challenged) {
      signals.push('sign_out_present');
    }
    if (/\b(welcome\s+back|you(?:'| a)?re\s+signed\s+in|signed\s+in\s+as)\b/i.test(text)) {
      signals.push('signed_in_copy');
    }

    var href = '';
    try {
      href = String((typeof location !== 'undefined' && location.href) || opts.href || '');
    } catch (_e) {}
    if (href && !/\/(login|signin|sign-in|register|signup|sign-up|auth|oauth)\b/i.test(href)) {
      signals.push('left_auth_path');
    }

    if (global.FillApplySynonyms && global.FillApplySynonyms.isApplicationFormOpen) {
      try {
        if (global.FillApplySynonyms.isApplicationFormOpen(doc)) signals.push('application_form_open');
      } catch (_f) {}
    }

    // Still on Google accounts host → not yet back on ATS
    if (isGoogleAccountsHost(href)) {
      return { success: false, signals: signals, onGoogleHost: true };
    }

    var strong =
      signals.indexOf('sso_connected') !== -1 ||
      (signals.indexOf('no_auth_wall') !== -1 &&
        (signals.indexOf('sign_out_present') !== -1 ||
          signals.indexOf('signed_in_copy') !== -1 ||
          signals.indexOf('application_form_open') !== -1)) ||
      (signals.indexOf('application_form_open') !== -1 && signals.indexOf('no_auth_wall') !== -1);

    return { success: !!strong, signals: signals, onGoogleHost: false };
  }

  function clickElement(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_s) {}
    try {
      el.click();
      return true;
    } catch (_e) {
      try {
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView });
        el.dispatchEvent(evt);
        return true;
      } catch (_e2) {
        return false;
      }
    }
  }

  /**
   * Page-side snapshot used by the runner to decide the next auth action.
   */
  function inspectAuthPage(doc, profile, opts) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    opts = opts || {};
    profile = profile || null;
    var href = '';
    try {
      href = String((typeof location !== 'undefined' && location.href) || opts.href || '');
    } catch (_e) {
      href = opts.href || '';
    }

    var challenge = detectHumanChallenge(doc);
    if (challenge && challenge.challenged) {
      // Widget CAPTCHA on an already-fillable application form is not an auth wall.
      // Full Cloudflare interstitials and CAPTCHA-only pages still pause.
      var C = global.FillApplyChallenges;
      if (
        C &&
        typeof C.shouldPauseForChallenge === 'function' &&
        !C.shouldPauseForChallenge(challenge, doc)
      ) {
        challenge = {
          challenged: false,
          kind: null,
          detail: 'CAPTCHA present but application form is fillable',
          markers: (challenge.markers || []).concat(['suppressed_form_fillable']),
          suppressed: true,
          priorChallenge: challenge
        };
      }
    }
    if (challenge && challenge.challenged) {
      var code =
        challenge.kind === 'captcha' || challenge.kind === 'cloudflare'
          ? AUTH_RESULTS.CAPTCHA_REQUIRED
          : AUTH_RESULTS.USER_ACTION_REQUIRED;
      return {
        result: code,
        pause: true,
        detail: challenge.detail || 'Human challenge required',
        challenge: challenge,
        href: href
      };
    }

    var mfa = detectMfaOrEmailVerification(doc);
    if (mfa) {
      return { result: mfa.code, pause: true, detail: mfa.detail, href: href };
    }

    var success = detectAuthSuccess(doc, { href: href });
    if (success.success) {
      return {
        result: AUTH_RESULTS.AUTHENTICATED,
        pause: false,
        detail: 'Authenticated (' + success.signals.join(', ') + ')',
        signals: success.signals,
        href: href
      };
    }

    if (isGoogleAccountsHost(href) || opts.forceGoogleChooser) {
      var accounts = listGoogleAccountOptions(doc);
      var match = matchApplicantAccount(accounts, profile);
      if (match.status === 'match' && match.option) {
        return {
          result: 'GOOGLE_ACCOUNT_MATCH',
          pause: false,
          detail: 'High-confidence Google account: ' + (match.option.email || match.option.name),
          account: {
            name: match.option.name,
            email: match.option.email,
            confidence: match.confidence
          },
          action: 'click_account',
          href: href,
          optionsCount: accounts.length
        };
      }
      if (match.status === 'ambiguous') {
        return {
          result: AUTH_RESULTS.USER_ACTION_REQUIRED,
          pause: true,
          detail: 'Ambiguous Google account chooser — select the applicant account manually',
          href: href,
          optionsCount: accounts.length,
          candidates: (match.candidates || []).map(function (c) {
            return { name: c.name, email: c.email };
          })
        };
      }
      // Chooser with no confident match, or Use another account only
      if (accounts.length === 0) {
        var textG = pageText(doc);
        if (/use\s+another\s+account|add\s+account|choose\s+an\s+account/i.test(textG)) {
          return {
            result: AUTH_RESULTS.USER_ACTION_REQUIRED,
            pause: true,
            detail: 'Google account chooser needs manual selection',
            href: href
          };
        }
      }
      return {
        result: AUTH_RESULTS.USER_ACTION_REQUIRED,
        pause: true,
        detail: 'No high-confidence Google account match for applicant',
        href: href,
        optionsCount: accounts.length
      };
    }

    var existing = detectExistingAccountMessage(doc);
    var googleActions = findGoogleAuthActions(doc);
    var wall = detectAuthWall(doc, opts.authWallOpts || {});

    if (existing && existing.found) {
      // Prefer Google sign-in recovery over create-account
      var signInGoogle = googleActions.filter(function (g) {
        return /sign\s*in|log\s*in|continue/i.test(g.text) && !/sign\s*up|register|create/i.test(g.text);
      });
      var pick = signInGoogle[0] || googleActions[0] || null;
      if (pick) {
        return {
          result: AUTH_RESULTS.ACCOUNT_ALREADY_EXISTS,
          pause: false,
          detail: 'Existing account message — attempting Google login recovery',
          action: 'click_google',
          googleText: pick.text,
          existingAccount: true,
          href: href
        };
      }
      return {
        result: AUTH_RESULTS.ACCOUNT_ALREADY_EXISTS,
        pause: true,
        detail: 'Account already exists — Google sign-in not found; complete login manually',
        existingAccount: true,
        href: href
      };
    }

    if (wall && wall.ssoConnected) {
      return {
        result: AUTH_RESULTS.AUTHENTICATED,
        pause: false,
        detail: 'SSO connected',
        signals: ['sso_connected'],
        href: href
      };
    }

    if (wall && wall.challenged) {
      var isContinueApplying =
        !!wall.continueApplying || wall.kind === 'continue_applying_social';
      if (googleActions.length) {
        return {
          result: 'GOOGLE_AUTH_AVAILABLE',
          pause: false,
          detail: wall.detail || 'Auth wall with Google OAuth available',
          action: 'click_google',
          googleText: googleActions[0].text,
          continueApplying: isContinueApplying,
          wall: {
            markers: wall.markers,
            passwordFields: wall.passwordFields,
            kind: wall.kind || null
          },
          href: href
        };
      }
      return {
        result: AUTH_RESULTS.UNSUPPORTED_AUTH_FLOW,
        pause: true,
        detail: isContinueApplying
          ? 'Continue applying wall without Google — never use Facebook; complete manually'
          : wall.detail || 'Auth wall without Google OAuth — complete manually',
        continueApplying: isContinueApplying,
        wall: {
          markers: wall.markers,
          passwordFields: wall.passwordFields,
          kind: wall.kind || null
        },
        href: href
      };
    }

    // Continue applying / email+Google/Facebook social overlay
    var continueCtx = isContinueApplyingContext(doc);
    if (continueCtx && googleActions.length) {
      return {
        result: 'GOOGLE_AUTH_AVAILABLE',
        pause: false,
        detail: 'Continue applying — Google social login available',
        action: 'click_google',
        googleText: googleActions[0].text,
        continueApplying: true,
        href: href
      };
    }
    if (continueCtx && !googleActions.length) {
      return {
        result: AUTH_RESULTS.UNSUPPORTED_AUTH_FLOW,
        pause: true,
        detail: 'Continue applying wall without Google — never use Facebook; complete manually',
        continueApplying: true,
        href: href
      };
    }

    // Google button present without strong wall (soft gate / modal)
    if (
      googleActions.length &&
      /sign\s*in|log\s*in|register|create\s*(an\s*)?account|continue\s+applying/i.test(pageText(doc))
    ) {
      return {
        result: 'GOOGLE_AUTH_AVAILABLE',
        pause: false,
        detail: 'Google auth action present',
        action: 'click_google',
        googleText: googleActions[0].text,
        href: href
      };
    }

    return {
      result: AUTH_RESULTS.NOT_REQUIRED,
      pause: false,
      detail: 'No ATS auth wall detected',
      href: href
    };
  }

  /**
   * Perform the page-side action implied by inspectAuthPage (click Google / account).
   * Does not wait — runner polls afterward.
   */
  function performAuthAction(doc, profile, inspection) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    inspection = inspection || inspectAuthPage(doc, profile);
    if (!inspection || !inspection.action) {
      return { ok: false, detail: 'No auth action' };
    }
    if (inspection.action === 'click_google') {
      var actions = findGoogleAuthActions(doc).filter(function (g) {
        return g && g.el && !isFacebookAuthControl(g.el);
      });
      if (!actions.length) return { ok: false, detail: 'Google auth button gone' };
      var preferred = actions.filter(function (g) {
        if (inspection.existingAccount) {
          return /sign\s*in|log\s*in|continue/i.test(g.text);
        }
        return true;
      });
      preferred.sort(function (a, b) {
        function score(x) {
          var tx = String(x.text || '');
          if (/continue\s+with\s+google/i.test(tx)) return 0;
          if (/sign\s*in\s+with\s+google/i.test(tx)) return 1;
          if (/^google$/i.test(tx.trim())) return 2;
          if (/google/i.test(tx)) return 3;
          return 4;
        }
        return score(a) - score(b);
      });
      var target = preferred[0] || actions[0];
      if (isFacebookAuthControl(target.el)) {
        return { ok: false, detail: 'Refused Facebook auth control' };
      }
      var clicked = clickElement(target.el);
      return { ok: clicked, detail: clicked ? 'Clicked: ' + target.text : 'Click failed', text: target.text };
    }
    if (inspection.action === 'click_account') {
      var opts = listGoogleAccountOptions(doc);
      var match = matchApplicantAccount(opts, profile);
      if (match.status !== 'match' || !match.option) {
        return { ok: false, detail: 'Account match lost before click' };
      }
      var clickedAcc = clickElement(match.option.el);
      return {
        ok: clickedAcc,
        detail: clickedAcc
          ? 'Selected Google account: ' + (match.option.email || match.option.name)
          : 'Account click failed',
        account: { name: match.option.name, email: match.option.email }
      };
    }
    return { ok: false, detail: 'Unknown action' };
  }

  function hostKeyFromUrl(url) {
    try {
      return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_e) {
      return String(url || '')
        .toLowerCase()
        .slice(0, 120);
    }
  }

  function pauseMessageForResult(code, detail) {
    var map = {};
    map[AUTH_RESULTS.USER_ACTION_REQUIRED] = 'Paused — ATS/Google auth needs your action';
    map[AUTH_RESULTS.CAPTCHA_REQUIRED] = 'Paused — CAPTCHA / Cloudflare verification required';
    map[AUTH_RESULTS.MFA_REQUIRED] = 'Paused — MFA / 2-step verification required';
    map[AUTH_RESULTS.EMAIL_VERIFICATION_REQUIRED] = 'Paused — email verification required';
    map[AUTH_RESULTS.UNSUPPORTED_AUTH_FLOW] = 'Paused — unsupported auth flow (no Google OAuth)';
    map[AUTH_RESULTS.AUTH_FAILED] = 'Paused — Google auth attempt failed';
    map[AUTH_RESULTS.TIMEOUT] = 'Paused — auth timed out; complete sign-in manually';
    map[AUTH_RESULTS.ACCOUNT_ALREADY_EXISTS] = 'Paused — account exists; complete Google/login manually';
    return (map[code] || 'Paused — authentication required') + (detail ? ' — ' + detail : '');
  }

  global.FillApplyAtsAuth = {
    AUTH_RESULTS: AUTH_RESULTS,
    APPLICANT_NAME_PREFERRED: APPLICANT_NAME_PREFERRED,
    APPLICANT_NAME_VARIANTS: APPLICANT_NAME_VARIANTS,
    APPLICANT_NAME_PARTS: APPLICANT_NAME_PARTS,
    normalizePersonName: normalizePersonName,
    namesEquivalent: namesEquivalent,
    preferredNamesFromProfile: preferredNamesFromProfile,
    findGoogleAuthActions: findGoogleAuthActions,
    findContinueAsButtons: findContinueAsButtons,
    listGoogleAccountOptions: listGoogleAccountOptions,
    matchApplicantAccount: matchApplicantAccount,
    detectExistingAccountMessage: detectExistingAccountMessage,
    detectMfaOrEmailVerification: detectMfaOrEmailVerification,
    detectAuthSuccess: detectAuthSuccess,
    isGoogleAccountsHost: isGoogleAccountsHost,
    isContinueApplyingContext: isContinueApplyingContext,
    isFacebookAuthControl: isFacebookAuthControl,
    hasVisibleFacebookSocial: hasVisibleFacebookSocial,
    inspectAuthPage: inspectAuthPage,
    performAuthAction: performAuthAction,
    clickElement: clickElement,
    hostKeyFromUrl: hostKeyFromUrl,
    pauseMessageForResult: pauseMessageForResult,
    EXISTING_ACCOUNT_RE: EXISTING_ACCOUNT_RE,
    GOOGLE_AUTH_LOOSE_RE: GOOGLE_AUTH_LOOSE_RE,
    CONTINUE_APPLYING_RE: CONTINUE_APPLYING_RE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
