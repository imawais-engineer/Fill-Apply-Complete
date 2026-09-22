/**
 * SAP SuccessFactors external career sites (e.g. Al-Futtaim afuturewithus.com).
 *
 * Uses FillApplySignupLogin for email/password (+ retype) when profile provides
 * a password; otherwise pauses on auth walls. CV upload + identity selects
 * (Title, Nationality, Country of Residence, phone country code, AF questions,
 * Terms) ride the universal fill / field-map. DOB and job-currency salary stay
 * empty when blank in profile → Complete Missing Info / pause on ready/submit.
 */
(function (global) {
  'use strict';

  var HOST_RE =
    /afuturewithus\.com|successfactors\.com|successfactors\.eu|sap\.com|career[s]?\.alfuttaim|alfuttaim/i;

  var CONTENT_RE =
    /successfactors|sap\s*success\s*factors|powered by sap|al-?futtaim|afuturewithus/i;

  function detect(url, doc) {
    url = String(url || '');
    try {
      var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
    } catch (_e) {
      if (HOST_RE.test(url)) return true;
    }
    if (!doc) return false;
    try {
      var text = String((doc.body && (doc.body.innerText || doc.body.textContent)) || '').slice(0, 8000);
      if (CONTENT_RE.test(text)) return true;
      if (doc.querySelector('[class*="successfactors" i], [id*="successfactors" i], meta[content*="SuccessFactors"]')) {
        return true;
      }
    } catch (_e2) {}
    return false;
  }

  var FIELD_MAPS = [
    {
      key: 'emailConfirm',
      names: ['confirmEmail', 'emailConfirm'],
      labels: ['retype email', 'confirm email', 're-enter email']
    },
    {
      key: 'password',
      names: ['password', 'pwd'],
      labels: ['password', 'choose password']
    },
    {
      key: 'passwordConfirm',
      names: ['confirmPassword', 'passwordConfirm'],
      labels: ['retype password', 'confirm password', 're-enter password']
    },
    {
      key: 'phoneCountry',
      names: ['countryRegionCode', 'country_region_code'],
      labels: ['country/region code', 'country region code']
    },
    {
      key: 'title',
      names: ['title', 'salutation'],
      labels: ['title', 'salutation']
    },
    {
      key: 'nationality',
      names: ['nationality'],
      labels: ['nationality']
    },
    {
      key: 'country',
      names: ['countryOfResidence', 'country_of_residence'],
      labels: ['country of residence', 'country/region of residence']
    },
    {
      key: 'referralSource',
      names: ['howDidYouHear'],
      labels: ['how did you hear about this position', 'how did you hear about us']
    }
  ];

  async function fill(ctx) {
    ctx = ctx || {};
    var profile = ctx.profile || {};
    var doc = typeof document !== 'undefined' ? document : null;
    var Signup = global.FillApplySignupLogin;
    var Auth = global.FillApplyAuthWalls;

    if (Signup && Signup.shouldPauseForAuth) {
      var gate = Signup.shouldPauseForAuth(doc, profile);
      if (gate && gate.pause) {
        return {
          ok: false,
          adapterId: 'successfactors',
          needsHuman: true,
          pauseReason: 'auth_wall',
          error: gate.detail || 'Sign in / register required — no profile password',
          filled: 0,
          unmatched: 0,
          total: 0,
          submitted: false
        };
      }
    } else if (Auth && Auth.detectAuthWall && !(Auth.canAutoFillCredentials && Auth.canAutoFillCredentials(profile))) {
      var wall = Auth.detectAuthWall(doc);
      if (wall && wall.challenged) {
        return {
          ok: false,
          adapterId: 'successfactors',
          needsHuman: true,
          pauseReason: 'auth_wall',
          error: wall.detail || 'Auth wall',
          filled: 0,
          unmatched: 0,
          total: 0,
          submitted: false
        };
      }
    }

    if (Signup && Signup.prepareSignupOrLogin) {
      try {
        await Signup.prepareSignupOrLogin(doc, profile, { waitMs: 350 });
      } catch (_e) {}
    }

    var fb = global.FillApplyFallbackAdapter;
    if (!fb) {
      return { ok: false, adapterId: 'successfactors', error: 'Fallback adapter missing', filled: 0, unmatched: 0, total: 0 };
    }
    return fb.fill(
      Object.assign({}, ctx, {
        adapterId: 'successfactors',
        fieldMaps: (ctx.fieldMaps || []).concat(FIELD_MAPS),
        fileInputHints: ctx.fileInputHints || [
          { kind: 'resume', match: 'resume|cv|curriculum' },
          { kind: 'cover', match: 'cover' }
        ],
        submitSelector:
          ctx.submitSelector ||
          'button[type="submit"], input[type="submit"], button[data-action="submit"], button.apply'
      })
    );
  }

  var adapter = {
    id: 'successfactors',
    name: 'SAP SuccessFactors',
    category: 'ats',
    hosts: ['afuturewithus.com', 'successfactors.com', 'successfactors.eu'],
    detect: detect,
    fieldMaps: FIELD_MAPS,
    fill: fill
  };

  if (global.FillApplyRegistry) {
    global.FillApplyRegistry.register(adapter);
  }
  global.FillApplySuccessFactorsAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
