/**
 * Common career-site signup / login helper (SuccessFactors, Oracle, generic).
 *
 * Client policy (v1.22.7): Environment.registrationPassword (preferred) or profile.password
 * (legacy) when set, Auto Fill may fill Email + Retype Email and Password +
 * Retype/Confirm Password and complete registration. Prefer "Sign in" when
 * the page says the email is already registered. Never invent passwords —
 * if profile password is missing, keep the human-gate auth-wall pause.
 * Never learn passwords from the page into adaptive KB (see knowledge-learn).
 *
 * Attaches FillApplySignupLogin to globalThis.
 */
(function (global) {
  'use strict';

  var ALREADY_REGISTERED_RE =
    /already\s+(a\s+)?registered\s+user|already\s+have\s+an\s+account|please\s+sign\s+in|existing\s+(user|account|candidate)/i;

  var SIGN_IN_LINK_RE = /^(sign\s*in|log\s*in|login|returning\s+candidate)$/i;
  var SIGN_IN_SOFT_RE = /\bsign\s*in\b|\blog\s*in\b|\blogin\b/i;

  function trim(s) {
    return String(s == null ? '' : s).trim();
  }

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function pageText(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return '';
    try {
      return String((doc.body && (doc.body.innerText || doc.body.textContent)) || '').slice(0, 16000);
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

  function buttonText(el) {
    return String(
      (el &&
        (el.innerText ||
          el.textContent ||
          el.value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title'))) ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelNear(el, doc) {
    doc = doc || (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (!el || !doc) return '';
    var parts = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
      el.name || '',
      el.id || ''
    ];
    try {
      if (el.id) {
        var esc = el.id;
        try {
          if (typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(el.id);
        } catch (_eEsc) {}
        var lab = doc.querySelector('label[for="' + esc + '"]');
        if (lab) parts.push(buttonText(lab));
      }
      var parent = el.closest(
        'label, .form-group, .field, [class*="field"], fieldset, [class*="Form"], [class*="form"]'
      );
      if (parent) parts.push(buttonText(parent).slice(0, 220));
    } catch (_e) {}
    return parts.join(' ');
  }

  /**
   * Resolve apply credentials from profile (top-level or customAnswers).
   * Never invent — blank password → null.
   */
  function resolveCredentials(profile) {
    profile = profile || {};
    var ca = profile.customAnswers && typeof profile.customAnswers === 'object' ? profile.customAnswers : {};
    function pick() {
      var keys = Array.prototype.slice.call(arguments);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!isBlank(profile[k])) return trim(profile[k]);
        if (!isBlank(ca[k])) return trim(ca[k]);
      }
      return '';
    }
    var email = pick('email', 'confirm_email', 'retype_email', 'Email');
    var emailConfirm = pick('confirm_email', 'retype_email', 'emailConfirm', 'email_confirm', 'email');
    var password = pick(
      'password',
      'confirm_password',
      'retype_password',
      'choose_password',
      'account_password',
      'passwordConfirm'
    );
    var passwordConfirm = pick(
      'confirm_password',
      'retype_password',
      'passwordConfirm',
      'password_confirm',
      'choose_password',
      'account_password',
      'password'
    );
    // ENVIRONMENT store wins for registration password (never from Adaptive / QB).
    try {
      var Env = global.FillApplyEnvironment;
      if (Env) {
        var env = typeof Env.get === 'function' ? Env.get() : null;
        if (env && !isBlank(env.registrationPassword)) {
          password = trim(env.registrationPassword);
          passwordConfirm = password;
        }
      }
    } catch (_env) { /* ignore */ }
    return {
      email: email,
      emailConfirm: emailConfirm || email,
      password: password,
      passwordConfirm: passwordConfirm || password,
      hasPassword: !isBlank(password),
      hasEmail: !isBlank(email)
    };
  }

  function profileHasCredentials(profile) {
    var c = resolveCredentials(profile);
    return !!(c.hasEmail && c.hasPassword);
  }

  /**
   * Classify the visible auth / registration surface.
   * @returns {{ mode: 'sign_in'|'register'|'none', alreadyRegistered: boolean, passwordFields: number, detail: string }}
   */
  function detectMode(doc, profile) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    var empty = { mode: 'none', alreadyRegistered: false, passwordFields: 0, detail: '' };
    if (!doc) return empty;
    var text = pageText(doc);
    var pw = doc.querySelectorAll('input[type="password"]');
    var visiblePw = 0;
    for (var i = 0; i < pw.length; i++) {
      if (isVisible(pw[i]) && !pw[i].disabled) visiblePw += 1;
    }
    var already = ALREADY_REGISTERED_RE.test(text);
    var hasRegisterCopy =
      /create\s+(an?\s+)?account|create\s+a\s+login|sign\s*up|register|new\s+user|candidate\s+registration/i.test(
        text
      ) || visiblePw >= 2;
    var hasSignInCopy = SIGN_IN_SOFT_RE.test(text) || /returning\s+candidate|log\s+back\s+in/i.test(text);

    // Prefer sign-in when page says email already registered and we have credentials
    if (already && profileHasCredentials(profile) && (visiblePw >= 1 || hasSignInCopy)) {
      return {
        mode: 'sign_in',
        alreadyRegistered: true,
        passwordFields: visiblePw,
        detail: 'Already registered — prefer Sign in'
      };
    }
    if (visiblePw >= 2 || (visiblePw >= 1 && hasRegisterCopy)) {
      return {
        mode: 'register',
        alreadyRegistered: already,
        passwordFields: visiblePw,
        detail: 'Registration / create-login form'
      };
    }
    if (visiblePw >= 1 && hasSignInCopy) {
      return {
        mode: 'sign_in',
        alreadyRegistered: already,
        passwordFields: visiblePw,
        detail: 'Sign-in form'
      };
    }
    return Object.assign({}, empty, { passwordFields: visiblePw });
  }

  function findAlreadyRegisteredSignInLink(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var text = pageText(doc);
    if (!ALREADY_REGISTERED_RE.test(text)) return null;
    var nodes = doc.querySelectorAll('a, button, [role="button"], span[role="link"]');
    var soft = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isVisible(el)) continue;
      var t = buttonText(el).slice(0, 80);
      if (!t) continue;
      if (SIGN_IN_LINK_RE.test(t.trim())) return el;
      if (!soft && SIGN_IN_SOFT_RE.test(t) && t.length < 40) soft = el;
    }
    return soft;
  }

  function preferSignIn(doc) {
    var link = findAlreadyRegisteredSignInLink(doc);
    if (!link) return { clicked: false, reason: 'no_sign_in_link' };
    try {
      link.click();
      return { clicked: true, text: buttonText(link) };
    } catch (_e) {
      return { clicked: false, reason: 'click_failed' };
    }
  }

  function classifyPasswordField(el, doc) {
    var lab = labelNear(el, doc).toLowerCase();
    if (/re-?type|re-?enter|confirm|verify|repeat|again/.test(lab)) return 'confirm';
    return 'password';
  }

  function classifyEmailField(el, doc) {
    var lab = labelNear(el, doc).toLowerCase();
    var type = String(el.type || '').toLowerCase();
    var nameId = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
    if (/re-?type|re-?enter|confirm|verify|repeat/.test(lab) || /confirm|retype|re_enter/.test(nameId)) {
      return 'confirm';
    }
    if (type === 'email' || /e-?mail/.test(lab) || /email/.test(nameId)) return 'email';
    return null;
  }

  function setInputValue(el, value) {
    if (!el || value == null) return false;
    var str = String(value);
    try {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, str);
      else el.value = str;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_e) {
      try {
        el.value = str;
        return true;
      } catch (_e2) {
        return false;
      }
    }
  }

  /**
   * Fill email / retype email / password / confirm password when credentials exist.
   * Uses FillApply setNativeValue when available.
   */
  function fillCredentials(doc, profile, opts) {
    opts = opts || {};
    doc = doc || (typeof document !== 'undefined' ? document : null);
    var creds = resolveCredentials(profile);
    var out = {
      ok: false,
      filled: 0,
      details: [],
      skipped: false,
      reason: '',
      credentials: { hasEmail: creds.hasEmail, hasPassword: creds.hasPassword }
    };
    if (!doc) {
      out.reason = 'no_document';
      return out;
    }
    if (!creds.hasPassword) {
      out.skipped = true;
      out.reason = 'no_profile_password';
      return out;
    }
    if (!creds.hasEmail) {
      out.skipped = true;
      out.reason = 'no_profile_email';
      return out;
    }

    var setter =
      opts.setValue ||
      (global.__fillApply && global.__fillApply.setNativeValue
        ? function (el, v, ctx) {
            return global.__fillApply.setNativeValue(el, v, ctx || {});
          }
        : setInputValue);

    var emails = doc.querySelectorAll('input[type="email"], input[type="text"], input:not([type])');
    var emailFilled = false;
    var emailConfirmFilled = false;
    for (var e = 0; e < emails.length; e++) {
      var em = emails[e];
      if (!isVisible(em) || em.disabled) continue;
      var kind = classifyEmailField(em, doc);
      if (!kind) continue;
      var ev = kind === 'confirm' ? creds.emailConfirm : creds.email;
      if (setter(em, ev, { key: kind === 'confirm' ? 'emailConfirm' : 'email', profile: profile }) !== false) {
        out.filled += 1;
        out.details.push({ key: kind === 'confirm' ? 'emailConfirm' : 'email', action: 'FILLED' });
        if (kind === 'confirm') emailConfirmFilled = true;
        else emailFilled = true;
      }
    }
    // If only one email box, ensure it got the address
    if (!emailFilled && !emailConfirmFilled) {
      for (var e2 = 0; e2 < emails.length; e2++) {
        var em2 = emails[e2];
        if (!isVisible(em2) || em2.disabled) continue;
        var blob = labelNear(em2, doc).toLowerCase();
        if (/e-?mail|email/.test(blob) || String(em2.type).toLowerCase() === 'email') {
          if (setter(em2, creds.email, { key: 'email', profile: profile }) !== false) {
            out.filled += 1;
            out.details.push({ key: 'email', action: 'FILLED' });
            emailFilled = true;
            break;
          }
        }
      }
    }

    var pws = doc.querySelectorAll('input[type="password"]');
    var primaryDone = false;
    var confirmDone = false;
    for (var p = 0; p < pws.length; p++) {
      var pwEl = pws[p];
      if (!isVisible(pwEl) || pwEl.disabled) continue;
      var pk = classifyPasswordField(pwEl, doc);
      // First password field → primary if not already confirm-labelled
      if (pk === 'confirm' || (primaryDone && !confirmDone)) {
        if (setter(pwEl, creds.passwordConfirm, { key: 'passwordConfirm', profile: profile }) !== false) {
          out.filled += 1;
          out.details.push({ key: 'passwordConfirm', action: 'FILLED' });
          confirmDone = true;
        }
      } else if (!primaryDone) {
        if (setter(pwEl, creds.password, { key: 'password', profile: profile }) !== false) {
          out.filled += 1;
          out.details.push({ key: 'password', action: 'FILLED' });
          primaryDone = true;
        }
      } else {
        if (setter(pwEl, creds.passwordConfirm, { key: 'passwordConfirm', profile: profile }) !== false) {
          out.filled += 1;
          out.details.push({ key: 'passwordConfirm', action: 'FILLED' });
          confirmDone = true;
        }
      }
    }

    out.ok = out.filled > 0;
    out.reason = out.ok ? 'filled' : 'no_credential_fields';
    return out;
  }

  /**
   * True when auth wall should pause for a human (no profile password).
   * When credentials exist, callers should fill instead of pausing.
   */
  function shouldPauseForAuth(doc, profile) {
    var Auth = global.FillApplyAuthWalls;
    var wall = Auth && Auth.detectAuthWall ? Auth.detectAuthWall(doc) : null;
    if (!wall || !wall.challenged) return { pause: false, wall: wall };
    if (profileHasCredentials(profile)) {
      return {
        pause: false,
        wall: wall,
        autoFill: true,
        detail: 'Profile password present — auto-fill signup/login instead of pause'
      };
    }
    return {
      pause: true,
      wall: wall,
      autoFill: false,
      detail: (wall && wall.detail) || 'Sign in / register required — complete manually (no profile password)'
    };
  }

  /**
   * One-shot: prefer Sign in if already-registered copy; else fill credentials
   * on the register/login form. Returns a summary for the fill engine.
   */
  async function prepareSignupOrLogin(doc, profile, opts) {
    opts = opts || {};
    doc = doc || (typeof document !== 'undefined' ? document : null);
    var creds = resolveCredentials(profile);
    var result = {
      ok: true,
      mode: 'none',
      preferredSignIn: null,
      credentialsFill: null,
      pause: false,
      pauseReason: null,
      detail: ''
    };
    if (!doc) return result;

    var gate = shouldPauseForAuth(doc, profile);
    var modeInfo = detectMode(doc, profile);
    result.mode = modeInfo.mode;

    if (gate.pause) {
      result.pause = true;
      result.pauseReason = 'auth_wall';
      result.detail = gate.detail;
      result.ok = false;
      return result;
    }

    if (!creds.hasPassword) {
      // No wall (or SSO) and no password — nothing to do here
      result.detail = 'no_profile_password';
      return result;
    }

    if (modeInfo.mode === 'sign_in' && modeInfo.alreadyRegistered) {
      result.preferredSignIn = preferSignIn(doc);
      if (result.preferredSignIn && result.preferredSignIn.clicked && opts.waitMs) {
        await new Promise(function (r) {
          setTimeout(r, opts.waitMs);
        });
      }
    }

    result.credentialsFill = fillCredentials(doc, profile, opts);
    result.detail = modeInfo.detail || result.credentialsFill.reason;
    result.ok = !!(result.credentialsFill && result.credentialsFill.ok) || !!(result.preferredSignIn && result.preferredSignIn.clicked);
    return result;
  }

  global.FillApplySignupLogin = {
    resolveCredentials: resolveCredentials,
    profileHasCredentials: profileHasCredentials,
    detectMode: detectMode,
    findAlreadyRegisteredSignInLink: findAlreadyRegisteredSignInLink,
    preferSignIn: preferSignIn,
    fillCredentials: fillCredentials,
    shouldPauseForAuth: shouldPauseForAuth,
    prepareSignupOrLogin: prepareSignupOrLogin,
    ALREADY_REGISTERED_RE: ALREADY_REGISTERED_RE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
