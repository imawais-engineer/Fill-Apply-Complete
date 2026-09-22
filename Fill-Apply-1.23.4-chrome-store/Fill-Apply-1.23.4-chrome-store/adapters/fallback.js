/**
 * Generic heuristic fill adapter — wraps content/fill.js (__fillApply) + file attach.
 * Supports runMode: register | fill | navigate | ready | submit.
 */
(function (global) {
  'use strict';

  function detect(_url, _doc) {
    return true;
  }

  async function fill(ctx) {
    ctx = ctx || {};
    const profile = ctx.profile || {};
    const options = ctx.options || {};
    const documents = ctx.documents || {};
    const fieldMaps = ctx.fieldMaps || null;
    const fileInputHints = ctx.fileInputHints || [];
    const submitSelector = ctx.submitSelector || null;
    // Prefer runMode; migrate legacy autoSubmit
    let runMode = ctx.runMode || options.runMode;
    if (!runMode) {
      runMode = ctx.autoSubmit || options.autoSubmit ? 'submit' : 'fill';
    }
    if (['register', 'fill', 'navigate', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

    if (!global.__fillApply || typeof global.__fillApply.run !== 'function') {
      return {
        ok: false,
        adapterId: 'fallback',
        filled: 0,
        unmatched: 0,
        total: 0,
        error: 'Fill engine (__fillApply) not loaded'
      };
    }

    // Auto Register: reuse ats-auth / auth-walls / signup-login (no parallel auth).
    if (runMode === 'register') {
      try {
        var docR = typeof document !== 'undefined' ? document : null;
        var Ats = global.FillApplyAtsAuth;
        var Walls = global.FillApplyAuthWalls;
        var SignupR = global.FillApplySignupLogin;

        // Already authenticated → registration unnecessary; hand off to fill.
        if (Ats && typeof Ats.detectAuthSuccess === 'function') {
          var success = Ats.detectAuthSuccess(docR, { profile: profile });
          if (success && (success.ok || success.authenticated || success.result === 'AUTHENTICATED')) {
            return {
              ok: true,
              adapterId: ctx.adapterId || 'fallback',
              runMode: 'register',
              phase: 'READY',
              terminal: 'READY',
              registerUnnecessary: true,
              handoffToFill: true,
              message: 'Already signed in — registration not needed',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false
            };
          }
        }

        var Challenges = global.FillApplyChallenges;
        if (Challenges && typeof Challenges.detectChallenge === 'function') {
          var chal = Challenges.detectChallenge(docR);
          if (chal && chal.kind) {
            return {
              ok: false,
              adapterId: ctx.adapterId || 'fallback',
              needsHuman: true,
              phase: 'BLOCKED',
              terminal: 'BLOCKED',
              pauseReason: chal.kind,
              error: 'Blocked — CAPTCHA…',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              runMode: 'register'
            };
          }
        }

        if (Ats && typeof Ats.detectMfaOrEmailVerification === 'function') {
          var mfa = Ats.detectMfaOrEmailVerification(docR);
          if (mfa && mfa.code) {
            return {
              ok: false,
              adapterId: ctx.adapterId || 'fallback',
              needsHuman: true,
              phase: 'WAITING_FOR_USER',
              terminal: 'WAITING_FOR_USER',
              pauseReason: mfa.code,
              error: mfa.detail || 'Waiting for user — verification required',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              runMode: 'register'
            };
          }
        }

        // Prefer Google social when present
        if (Ats && typeof Ats.findGoogleAuthActions === 'function') {
          var googleBtns = Ats.findGoogleAuthActions(docR) || [];
          if (googleBtns.length) {
            var g0 = googleBtns[0];
            var gEl = g0 && (g0.el || g0.element || g0);
            if (Ats.clickElement) Ats.clickElement(gEl);
            else if (gEl && gEl.click) gEl.click();
            return {
              ok: true,
              adapterId: ctx.adapterId || 'fallback',
              runMode: 'register',
              phase: 'WAITING_FOR_USER',
              terminal: 'WAITING_FOR_USER',
              needsHuman: true,
              googleAuthClicked: true,
              message: 'Continue with Google — complete sign-in if prompted',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false
            };
          }
        }

        // Email/password register via signup-login (passwords never leave profile → never into knowledge)
        if (SignupR && typeof SignupR.prepareSignupOrLogin === 'function') {
          var prep = await SignupR.prepareSignupOrLogin(docR, profile, { waitMs: 400 });
          if (prep && prep.pause) {
            return {
              ok: false,
              adapterId: ctx.adapterId || 'fallback',
              needsHuman: true,
              phase: prep.pauseReason === 'captcha' ? 'BLOCKED' : 'AUTH_REQUIRED',
              terminal: prep.pauseReason === 'captcha' ? 'BLOCKED' : 'AUTH_REQUIRED',
              pauseReason: prep.pauseReason || 'auth_wall',
              error: prep.detail || 'Sign in / register required',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              runMode: 'register',
              signupLogin: prep
            };
          }
          return {
            ok: !!(prep && prep.ok !== false),
            adapterId: ctx.adapterId || 'fallback',
            runMode: 'register',
            phase: prep && prep.authenticated ? 'READY' : 'FILLING',
            terminal: prep && prep.authenticated ? 'READY' : undefined,
            filled: (prep && prep.filled) || 0,
            unmatched: 0,
            total: 0,
            submitted: false,
            signupLogin: prep,
            message: (prep && prep.detail) || 'Registration fields filled'
          };
        }

        if (Walls && Walls.detectAuthWall) {
          var wall = Walls.detectAuthWall(docR);
          if (wall && wall.hit) {
            return {
              ok: false,
              adapterId: ctx.adapterId || 'fallback',
              needsHuman: true,
              phase: 'AUTH_REQUIRED',
              terminal: 'AUTH_REQUIRED',
              pauseReason: 'auth_wall',
              error: wall.detail || 'Sign in / register required',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              runMode: 'register'
            };
          }
        }
      } catch (regErr) {
        return {
          ok: false,
          adapterId: ctx.adapterId || 'fallback',
          error: String((regErr && regErr.message) || regErr),
          phase: 'BLOCKED',
          terminal: 'BLOCKED',
          filled: 0,
          unmatched: 0,
          total: 0,
          submitted: false,
          runMode: 'register'
        };
      }
    }

    // Auth wall: pause only when profile has no password; else signup-login fills credentials.
    // Skip for register mode (handled above).
    if (runMode !== 'register') {
      try {
        var Signup = global.FillApplySignupLogin;
        var doc = typeof document !== 'undefined' ? document : null;
        if (Signup && Signup.shouldPauseForAuth) {
          var gate = Signup.shouldPauseForAuth(doc, profile);
          if (gate && gate.pause) {
            return {
              ok: false,
              adapterId: ctx.adapterId || 'fallback',
              needsHuman: true,
              phase: 'AUTH_REQUIRED',
              terminal: 'AUTH_REQUIRED',
              pauseReason: 'auth_wall',
              error: gate.detail || 'Sign in / register required — complete manually (no profile password)',
              filled: 0,
              unmatched: 0,
              total: 0,
              submitted: false,
              runMode: runMode
            };
          }
        }
      } catch (_authGate) { /* continue to fill */ }
    }

    if (fieldMaps && global.FillApplyFieldMap && Array.isArray(fieldMaps)) {
      try {
        const registry = global.FillApplyFieldMap.FIELD_MAP;
        fieldMaps.forEach(function (entry) {
          if (!entry || !entry.key) return;
          // fill() runs repeatedly on the same page during re-detect retries;
          // without this guard the shared FIELD_MAP grows on every pass.
          const already = registry.some(function (existing) {
            return existing && existing.key === entry.key && existing.__adapterId === ctx.adapterId;
          });
          if (already) return;
          registry.push(Object.assign({ __adapterId: ctx.adapterId }, entry));
        });
      } catch (_e) {
        /* ignore */
      }
    }

    let fillResult = await global.__fillApply.run(profile, {
      highlightUnmatched: !!options.highlightUnmatched,
      minOpenFormFields: options.minOpenFormFields,
      formWaitMs: options.formWaitMs,
      // The engine waits for the upload control and attaches the documents the
      // applicant already loaded, rather than leaving it to a later blind pass.
      documents: documents,
      fileInputHints: fileInputHints,
      progressPlateauMs: options.progressPlateauMs,
      runMode: runMode
    });

    // Apply-start open step: form not open yet — runner / Fill once should wait + re-detect
    if (
      fillResult &&
      (fillResult.clickedApplyStart || fillResult.reDetect) &&
      !(fillResult.filled > 0)
    ) {
      return {
        ok: true,
        adapterId: ctx.adapterId || 'fallback',
        clickedApplyStart: true,
        reDetect: true,
        handedOff: true,
        deferToPageAdapter: true,
        externalApply: !!fillResult.externalApply,
        filled: 0,
        unmatched: 0,
        total: 0,
        submitted: false,
        runMode: runMode,
        message: fillResult.message || 'Clicked Apply to open application — re-detect after load',
        applyStartText: fillResult.applyStartText || '',
        error: null
      };
    }

    const Files = global.FillApplyFiles;
    let filesAttached = fillResult.filesAttached || null;
    if (!filesAttached && Files && typeof Files.attachDocuments === 'function') {
      filesAttached = Files.attachDocuments(documents, fileInputHints);
    }
    if (!filesAttached) {
      filesAttached = {
        ok: true,
        attached: [],
        alreadyAttached: [],
        inputCount: 0,
        resumeAttached: false,
        coverAttached: false
      };
    }

    let advanced = false;
    let submitted = false;
    let navigateSteps = 0;
    let plateauTimedOut = false;
    const plateauMs =
      (options.progressPlateauMs != null
        ? options.progressPlateauMs
        : global.FillApplyTypes && global.FillApplyTypes.PROGRESS_PLATEAU_MS) || 10000;

    async function sleep(ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    }

    // ready / submit / navigate: click Next/Continue/Review (never Submit unless submit mode)
    if (runMode === 'ready' || runMode === 'submit' || runMode === 'navigate') {
      if (global.__fillApply.clickContinueButtons) {
        const clicked = global.__fillApply.clickContinueButtons();
        advanced = !!(clicked && clicked.length);
        if (advanced) navigateSteps += 1;
      }
    }

    // Auto Navigate: fill → continue → stabilize → re-fill loop; prefer stop at READY; never Submit
    if (runMode === 'navigate') {
      const maxSteps = options.maxNavigateSteps != null ? options.maxNavigateSteps : 8;
      let lastProgressAt = Date.now();
      let lastFilled = fillResult.filled || 0;
      while (navigateSteps < maxSteps) {
        if (Date.now() - lastProgressAt > plateauMs) {
          plateauTimedOut = true;
          break;
        }
        // Stop if page looks review/ready (submit visible, no more continue)
        var synNav = global.FillApplySynonyms;
        var contClicked = [];
        if (global.__fillApply.clickContinueButtons) {
          contClicked = global.__fillApply.clickContinueButtons() || [];
        }
        if (!contClicked.length) {
          // No continue — treat as READY
          advanced = advanced || navigateSteps > 0;
          break;
        }
        advanced = true;
        navigateSteps += 1;
        lastProgressAt = Date.now();
        await sleep(options.navigateStabilizeMs != null ? options.navigateStabilizeMs : 600);
        // Re-fill newly revealed fields
        var again = await global.__fillApply.run(profile, {
          highlightUnmatched: !!options.highlightUnmatched,
          documents: documents,
          fileInputHints: fileInputHints,
          skipApplyStart: true,
          progressPlateauMs: plateauMs
        });
        if (again && again.phase === 'TIMEOUT') {
          plateauTimedOut = true;
          fillResult = again;
          break;
        }
        if (again && (again.filled || 0) > lastFilled) {
          lastFilled = again.filled;
          lastProgressAt = Date.now();
        }
        if (again) {
          fillResult = again;
          if (again.filesAttached) filesAttached = again.filesAttached;
        }
      }
    }

    // Multi-step applications keep the resume step behind Continue, so the
    // upload control often only exists after advancing.
    if (
      advanced &&
      Files &&
      typeof Files.attachDocumentsAsync === 'function' &&
      filesAttached.pending &&
      filesAttached.pending.length
    ) {
      const afterStep = await Files.attachDocumentsAsync(documents, fileInputHints, { timeoutMs: 2000 });
      if (afterStep && (afterStep.attached.length || afterStep.alreadyAttached.length)) {
        filesAttached = afterStep;
      }
    }

    if (runMode === 'submit') {
      if (global.__fillApply.clickSubmitButtons) {
        submitted = !!global.__fillApply.clickSubmitButtons(submitSelector);
      } else {
        const sel =
          submitSelector ||
          'button[type="submit"], input[type="submit"], button[data-qa="btn-submit"], [data-testid="submit"]';
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          submitted = true;
        }
      }
    }

    // Discover ALL unknown fields (required + optional). Prefer fill engine metadata.
    var missingProfileFields = [];
    var unknownFieldMeta = Array.isArray(fillResult.unknownFields) ? fillResult.unknownFields.slice() : [];
    if (Array.isArray(fillResult.missingProfileFields) && fillResult.missingProfileFields.length) {
      missingProfileFields = fillResult.missingProfileFields.slice();
    } else if (Array.isArray(fillResult.missingRequired) && fillResult.missingRequired.length) {
      missingProfileFields = fillResult.missingRequired.slice();
    }
    var P = global.FillApplyFieldMap || global.FillApplyProfile;
    var details = fillResult.details || [];
    for (var di = 0; di < details.length; di++) {
      var d = details[di];
      if (!d || d.ok) continue;
      var lab = d.label || d.name || d.key || '';
      if (!lab) continue;
      // Capture every unmatched/unknown control — not only required / mapped keys
      if (missingProfileFields.indexOf(lab) === -1) missingProfileFields.push(lab);
      var keyHint = d.key;
      if (keyHint && P && typeof P.isBlank === 'function' && P.isBlank(profile[keyHint])) {
        if (missingProfileFields.indexOf(keyHint) === -1) missingProfileFields.push(keyHint);
      }
    }
    // Deduplicate
    var seenM = {};
    missingProfileFields = missingProfileFields.filter(function (f) {
      var k = String(f);
      if (seenM[k]) return false;
      seenM[k] = true;
      return true;
    });

    if (missingProfileFields.length && (runMode === 'ready' || runMode === 'submit')) {
      return {
        ok: false,
        adapterId: ctx.adapterId || 'fallback',
        needsHuman: true,
        pauseReason: 'missing_profile_field',
        missingProfileFields: missingProfileFields,
        unknownFields: unknownFieldMeta.length ? unknownFieldMeta : fillResult.unknownFields || [],
        filled: fillResult.filled || 0,
        unmatched: fillResult.unmatched || 0,
        total: fillResult.total || 0,
        details: details,
        applicationFields: fillResult.applicationFields || [],
        filesAttached: filesAttached,
        resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
        coverAttached: !!(filesAttached && filesAttached.coverAttached),
        runMode: runMode,
        advanced: advanced,
        submitted: false,
        error:
          'Missing profile field(s): ' +
          missingProfileFields.join(', ') +
          ' — fill in Options or on the page, then Resume'
      };
    }

    var phase = fillResult.phase || null;
    var terminal = null;
    if (plateauTimedOut || phase === 'TIMEOUT') {
      phase = 'TIMEOUT';
      terminal = 'TIMEOUT';
    } else if (submitted) {
      phase = 'COMPLETE';
      terminal = 'COMPLETE';
    } else if (runMode === 'navigate' && advanced && !plateauTimedOut) {
      phase = 'READY';
      terminal = 'READY';
    } else if (advanced && (runMode === 'ready' || runMode === 'navigate')) {
      phase = phase || 'READY';
      terminal = 'READY';
    } else if (phase === 'READY' || phase === 'BLOCKED' || phase === 'MISSING_INFORMATION') {
      terminal = phase;
    } else if (fillResult.ok && !(missingProfileFields && missingProfileFields.length)) {
      phase = phase || 'READY';
      terminal = 'READY';
    }

    return {
      ok: plateauTimedOut ? true : !!fillResult.ok,
      adapterId: ctx.adapterId || 'fallback',
      filled: fillResult.filled || 0,
      unmatched: fillResult.unmatched || 0,
      total: fillResult.total || 0,
      details: fillResult.details || [],
      applicationFields: fillResult.applicationFields || [],
      applicationReport: fillResult.applicationReport || null,
      filesAttached: filesAttached,
      resumeAttached: !!(filesAttached && filesAttached.resumeAttached),
      coverAttached: !!(filesAttached && filesAttached.coverAttached),
      documentsPending: filesAttached.pending || [],
      documentsNeedManual: !!filesAttached.needsManual,
      inspection: fillResult.inspection || null,
      formSignals: fillResult.formSignals || null,
      skipped: fillResult.skipped || [],
      missingRequired: fillResult.missingRequired || [],
      unknownFields: unknownFieldMeta.length ? unknownFieldMeta : fillResult.unknownFields || [],
      customDropdownsFilled: fillResult.customDropdownsFilled || [],
      runMode: runMode,
      advanced: advanced,
      submitted: submitted,
      navigateSteps: navigateSteps,
      phase: phase,
      terminal: terminal,
      error: plateauTimedOut
        ? 'Timed out — no progress for ~10s'
        : fillResult.error || null,
      missingProfileFields: missingProfileFields.length ? missingProfileFields : undefined,
      debugResolutions: fillResult.debugResolutions || null
    };
  }

  const adapter = {
    id: 'fallback',
    name: 'Generic fallback',
    detect: detect,
    fieldMaps: null,
    submitSelector:
      'button[type="submit"], input[type="submit"], button[data-qa="btn-submit"]',
    fileInputHints: [
      { kind: 'resume', match: 'resume|cv|curriculum' },
      { kind: 'cover', match: 'cover|letter' }
    ],
    fill: fill
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApplyFallbackAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
