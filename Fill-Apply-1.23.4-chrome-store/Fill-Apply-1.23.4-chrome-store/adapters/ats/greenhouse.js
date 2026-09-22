/**
 * Greenhouse adapter — boards.greenhouse.io, job-boards.greenhouse.io, *.greenhouse.io.
 *
 * Hardened for classic GH forms (e.g. GitLab Manager Strategic Finance) and newer
 * job-boards embeds (e.g. Figma Strategic Finance):
 *   Resume/CV* + Cover Attach (DataTransfer), First/Last/Email/Phone (+ phone country),
 *   Location city / country of residence, LinkedIn, Other Website, preferred first name,
 *   sponsorship / authorized to work / previously worked / employment agreements /
 *   based in US — Yes/No/Select fuzzy from profile + customAnswers,
 *   long text (why join / additional info / accessibility) from coverLetter or
 *   customAnswers by question snippet, team-interest radios via customAnswers,
 *   voluntary EEO/diversity skipped (prefer not — never invent),
 *   Submit: Apply for this job / Submit application synonyms.
 *
 * Often reached via Working Nomads (and other boards) external Apply handoff.
 * Modes: fill / ready = no final submit; submit clicks Apply/Submit synonyms.
 */
(function (global) {
  'use strict';

  function detect(url, doc) {
    url = String(url || '');
    if (
      /boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io/i.test(url)
    ) {
      return true;
    }
    if (
      doc &&
      (doc.querySelector(
        '#application-form, #greenhouse-job-application, [data-provides="greenhouse"], form#application, #main_fields, .application--container, #apply_form, .greenhouse-application'
      ) ||
        /greenhouse/i.test((doc.body && doc.body.className) || ''))
    ) {
      return true;
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
      (el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label'))) ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLabelFor(el) {
    if (global.__fillApply && global.__fillApply.getLabelText) {
      return global.__fillApply.getLabelText(el) || '';
    }
    if (!el) return '';
    if (el.id) {
      try {
        var esc = el.id;
        try {
          if (typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(el.id);
        } catch (_eEsc) {}
        var byFor = document.querySelector('label[for="' + esc + '"]');
        if (byFor) return byFor.textContent.trim();
      } catch (_e) {}
    }
    var parent = el.closest(
      'label, .field, .form-field, .application--field, [class*="field"], [data-field], .select2-container'
    );
    if (parent) {
      var t = (parent.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 200) t = t.slice(0, 200);
      return t;
    }
    return el.getAttribute('aria-label') || el.placeholder || el.name || '';
  }

  function isGenderField(labelBlob) {
    var t = String(labelBlob || '');
    if (!/\b(gender(\s*identity)?|sex)\b/i.test(t)) return false;
    if (/sexual\s*orientation/i.test(t)) return false;
    return true;
  }

  function isDiversityField(labelBlob) {
    return /diversity|eeo|equal opportunity|race|ethnicity|gender identity|gender\b|veteran|disability|sexual orientation|hispanic|latino|lgbt|decline to (self-)?identify|voluntary self.?identif/i.test(
      String(labelBlob || '')
    );
  }

  /** Skip EEO fields, but fill Gender Identity when the profile has a gender. */
  function shouldSkipDiversity(labelBlob, el, profile) {
    if (!(isDiversityField(labelBlob) || isInDiversitySection(el))) return false;
    if (isGenderField(labelBlob) && profile && String(profile.gender || '').trim()) return false;
    return true;
  }

  function isInDiversitySection(el) {
    if (!el) return false;
    try {
      var sec = el.closest(
        'section, fieldset, [class*="eeo"], [class*="EEO"], [id*="eeo"], [id*="demographic"], [class*="demographic"], [class*="diversity"]'
      );
      if (sec) {
        var h =
          ((sec.querySelector('h1,h2,h3,h4,legend,.section-header') || sec).textContent || '')
            .slice(0, 400);
        if (isDiversityField(h)) return true;
      }
      var prev = el.previousElementSibling;
      for (var i = 0; i < 4 && prev; i++) {
        if (isDiversityField(prev.textContent || '')) return true;
        prev = prev.previousElementSibling;
      }
    } catch (_e) {}
    return false;
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var tag = el.tagName;
    var type = String(el.type || '').toLowerCase();
    var str = value == null ? '' : String(value);

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
        var opt = el.options[i];
        var t = (opt.textContent || '').trim().toLowerCase();
        var v = String(opt.value || '').toLowerCase();
        if (t === wantL || v === wantL || (wantL.length > 1 && t.indexOf(wantL) !== -1)) {
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
        tag === 'TEXTAREA'
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

  function profileValue(profile, key) {
    if (!profile) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') {
      return String(profile[key]).trim();
    }
    if (key === 'fullName') {
      return (
        String(profile.fullName || '').trim() ||
        [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
      );
    }
    if (key === 'preferredName' || key === 'preferredFirstName') {
      return (
        String(profile.preferredName || profile.preferredFirstName || '').trim() ||
        String(profile.firstName || '').trim()
      );
    }
    if (key === 'location' || key === 'workLocation') {
      var parts = [profile.city, profile.state, profile.country].filter(Boolean);
      if (parts.length) return parts.join(', ');
      return String(profile.location || '').trim();
    }
    if (key === 'website') {
      return String(profile.website || profile.portfolio || profile.github || '').trim();
    }
    if (key === 'phoneCountry') {
      return String(profile.phoneCountry || '').trim();
    }
    return '';
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

  function yesNoFromProfile(profile, label, defaultVal) {
    var custom = answerFromCustom(profile, label);
    if (custom != null) return custom;
    var lab = norm(label);
    if (/sponsor|visa/.test(lab)) {
      return profileValue(profile, 'requiresSponsorship') || defaultVal || 'No';
    }
    if (/authorized|legally|work authorization|eligible to work|right to work/.test(lab)) {
      return profileValue(profile, 'authorizedToWork') || defaultVal || 'Yes';
    }
    if (/previously worked|worked (at|for|with)|prior (employment|employee)|former employee/.test(lab)) {
      return answerFromCustom(profile, label) || defaultVal || 'No';
    }
    if (/based in (the )?us|united states|us[- ]based|located in the united states/.test(lab)) {
      var country = norm(profileValue(profile, 'country') || profileValue(profile, 'location'));
      if (/united states|usa|\bu\.?s\.?a\.?\b|\bus\b/.test(country)) return 'Yes';
      if (country) return 'No';
      return answerFromCustom(profile, label) || defaultVal || 'No';
    }
    if (/employment agreement|offer letter|non.?compet|confidentiality|agree to/.test(lab)) {
      return answerFromCustom(profile, label) || defaultVal || 'Yes';
    }
    return answerFromCustom(profile, label) || defaultVal || '';
  }

  function makeFile(Files, doc, fallbackName) {
    if (!Files || !doc || !doc.base64) return null;
    return Files.fileFromBase64(
      doc.base64,
      doc.name || fallbackName,
      doc.mime || 'application/pdf'
    );
  }

  /**
   * Greenhouse-specific file attach: known IDs + Attach buttons + hidden inputs.
   */
  function attachGreenhouseFiles(documents) {
    var Files = global.FillApplyFiles;
    if (!Files) {
      return {
        ok: false,
        attached: [],
        errors: ['FillApplyFiles missing'],
        resumeAttached: false,
        coverAttached: false,
        inputCount: 0
      };
    }

    var hints = [
      {
        kind: 'resume',
        match: 'resume|cv|curriculum',
        selector:
          'input[type=file]#resume, input[type=file][name="resume"], input[type=file][name*="resume"], input[type=file][name*="job_application[resume]"], input[type=file][id*="resume" i], input[type=file][data-testid*="resume" i]'
      },
      {
        kind: 'cover',
        match: 'cover',
        selector:
          'input[type=file]#cover_letter, input[type=file][name="cover_letter"], input[type=file][name*="cover"], input[type=file][name*="job_application[cover"], input[type=file][id*="cover" i]'
      }
    ];

    var resumeFile = makeFile(Files, documents && documents.resume, 'resume.pdf');
    var coverFile = makeFile(Files, documents && documents.cover, 'cover-letter.pdf');
    var directAttached = [];

    function tryDirect(sel, file, kind) {
      if (!file) return null;
      var els = [];
      try {
        els = Array.prototype.slice.call(document.querySelectorAll(sel));
      } catch (_e) {
        return null;
      }
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (String(el.type || '').toLowerCase() !== 'file') continue;
        var r = Files.assignFilesToInput(el, file);
        if (r && r.ok) return { kind: kind, name: file.name };
      }
      return null;
    }

    var resumeDirect =
      tryDirect('#resume', resumeFile, 'resume') ||
      tryDirect('input[type=file][name="job_application[resume]"]', resumeFile, 'resume') ||
      tryDirect('input[type=file][name*="resume" i]', resumeFile, 'resume') ||
      tryDirect('input[type=file][id*="resume" i]', resumeFile, 'resume') ||
      tryDirect('input[type=file][data-testid*="resume" i]', resumeFile, 'resume');
    if (resumeDirect) directAttached.push(resumeDirect);

    var coverDirect =
      tryDirect('#cover_letter', coverFile, 'cover') ||
      tryDirect('input[type=file][name="job_application[cover_letter]"]', coverFile, 'cover') ||
      tryDirect('input[type=file][name*="cover" i]', coverFile, 'cover') ||
      tryDirect('input[type=file][id*="cover" i]', coverFile, 'cover');
    if (coverDirect) directAttached.push(coverDirect);

    var generic = Files.attachDocuments(documents || {}, hints);

    var resumeAttached = !!resumeDirect || !!(generic && generic.resumeAttached);
    var coverAttached = !!coverDirect || !!(generic && generic.coverAttached);

    var attached = (generic && generic.attached ? generic.attached.slice() : []).slice();
    directAttached.forEach(function (a) {
      if (
        !attached.some(function (x) {
          return x.kind === a.kind;
        })
      ) {
        attached.push(a);
      }
    });

    return {
      ok: (generic && generic.ok !== false) || attached.length > 0,
      attached: attached,
      errors: (generic && generic.errors) || [],
      inputCount: (generic && generic.inputCount) || 0,
      resumeAttached: resumeAttached,
      coverAttached: coverAttached
    };
  }

  function selectYesNoOrOption(questionRe, answer) {
    var want = String(answer || '').trim();
    if (!want) return false;
    var wantYes = /^(yes|y|true|1)$/i.test(want);
    var wantNo = /^(no|n|false|0)$/i.test(want);
    var roots = document.querySelectorAll(
      'fieldset, .field, .form-field, .application--field, [class*="Question"], [data-field], form div, label, .select'
    );
    var candidates = [];
    for (var i = 0; i < roots.length; i++) {
      var lab = (roots[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (shouldSkipDiversity(lab, roots[i], profile)) continue;
      if (questionRe.test(lab) && lab.length < 500) candidates.push(roots[i]);
    }
    for (var c = 0; c < candidates.length; c++) {
      var root = candidates[c];
      var radios = root.querySelectorAll('input[type="radio"], button, [role="radio"]');
      for (var j = 0; j < radios.length; j++) {
        var radio = radios[j];
        var rLab = getLabelFor(radio) || radio.value || buttonText(radio) || '';
        var rN = norm(rLab);
        var isYes = /^(yes|y)$/i.test(rLab.trim()) || /^yes\b/i.test(rLab);
        var isNo = /^(no|n)$/i.test(rLab.trim()) || /^no\b/i.test(rLab);
        var fuzzy =
          (wantYes && isYes) ||
          (wantNo && isNo) ||
          rN === norm(want) ||
          (want.length > 1 && rN.indexOf(norm(want)) !== -1);
        if (fuzzy) {
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
        if (wantYes && setNativeValue(selects[s], 'Yes')) return true;
        if (wantNo && setNativeValue(selects[s], 'No')) return true;
        if (setNativeValue(selects[s], want)) return true;
      }
    }
    return false;
  }

  function fillMatchingFields(profile, predicates) {
    var filled = 0;
    var inputs = document.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = String(el.type || '').toLowerCase();
      if (
        type === 'hidden' ||
        type === 'submit' ||
        type === 'button' ||
        type === 'file' ||
        type === 'password' ||
        type === 'checkbox' ||
        type === 'radio'
      ) {
        continue;
      }
      if (el.disabled || el.readOnly) continue;
      if (!visible(el) && el.tagName !== 'SELECT') continue;
      var label = getLabelFor(el);
      var blob = norm(
        label + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')
      );
      if (shouldSkipDiversity(blob, el, profile)) continue;
      for (var p = 0; p < predicates.length; p++) {
        var pred = predicates[p];
        if (pred.match(blob, el, label)) {
          var val = typeof pred.value === 'function' ? pred.value(profile, el, label) : pred.value;
          if (val == null || String(val).trim() === '') break;
          if (setNativeValue(el, val)) filled++;
          break;
        }
      }
    }
    return filled;
  }

  function fillBasicInfo(profile) {
    return fillMatchingFields(profile, [
      {
        match: function (b) {
          return (
            (/preferred (first )?name|preferred name|what should we call|nickname/.test(b)) &&
            !/legal|first name|last name/.test(b.replace(/preferred[^ ]*/g, ''))
          );
        },
        value: function (p) {
          return profileValue(p, 'preferredName');
        }
      },
      {
        match: function (b) {
          return /first name|firstname|given name/.test(b) && !/preferred|last/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'firstName');
        }
      },
      {
        match: function (b) {
          return /last name|lastname|surname|family name/.test(b) && !/preferred/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'lastName');
        }
      },
      {
        match: function (b) {
          return (
            (/^(name|full name)$/.test(b) || /\bfull name\b|\byour name\b/.test(b)) &&
            !/first|last|company|file|user|preferred/.test(b)
          );
        },
        value: function (p) {
          return profileValue(p, 'fullName');
        }
      },
      {
        match: function (b) {
          return /e-?mail/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'email');
        }
      },
      {
        match: function (b, el) {
          if (/phone.?country|country.?code|dial.?code|country for phone/.test(b)) return true;
          // Greenhouse often labels the dial select just "Country*".
          if (/^country\b/.test(b) || /\bcountry\*?$/.test(b)) {
            if (el && el.tagName === 'SELECT' && el.options) {
              var dialish = 0;
              for (var i = 0; i < Math.min(el.options.length, 40); i++) {
                var t = String(el.options[i].textContent || el.options[i].value || '');
                if (/\+\d{1,4}\b/.test(t)) dialish++;
              }
              if (dialish >= 3) return true;
            }
          }
          return false;
        },
        value: function (p) {
          return profileValue(p, 'phoneCountry');
        }
      },
      {
        match: function (b) {
          return /phone|mobile|tel/.test(b) && !/country|code/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'phone');
        }
      },
      {
        match: function (b) {
          return /\bgender(\s*identity)?\b|\bsex\b/.test(b) && !/sexual\s*orientation/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'gender');
        }
      },
      {
        match: function (b) {
          return /linkedin/.test(b);
        },
        value: function (p) {
          return profileValue(p, 'linkedin');
        }
      },
      {
        match: function (b) {
          return (
            (/other website|portfolio|personal (site|website)|github|website/.test(b)) &&
            !/linkedin/.test(b)
          );
        },
        value: function (p, el) {
          var blob = norm(getLabelFor(el) + ' ' + (el.name || ''));
          if (/github/.test(blob)) return profileValue(p, 'github') || profileValue(p, 'website');
          return profileValue(p, 'website');
        }
      },
      {
        match: function (b) {
          return (
            (/\bcity\b|location city|work.?from.?city|current city/.test(b)) &&
            !/country|state|phone/.test(b)
          );
        },
        value: function (p) {
          return profileValue(p, 'city') || profileValue(p, 'location');
        }
      },
      {
        match: function (b) {
          return (
            (/\bstate\b|province|region|work.?from.?state/.test(b)) &&
            !/united states|country|statement/.test(b)
          );
        },
        value: function (p) {
          return profileValue(p, 'state');
        }
      },
      {
        match: function (b) {
          return (
            (/country of residence|\bcountry\b|work.?from.?country/.test(b)) &&
            !/phone|code|authorized|sponsor/.test(b)
          );
        },
        value: function (p) {
          return profileValue(p, 'country');
        }
      },
      {
        match: function (b) {
          return /work.?from|where (will|do) you (work|be based)|location \(city|current location/.test(
            b
          );
        },
        value: function (p) {
          return (
            profileValue(p, 'workLocation') ||
            [profileValue(p, 'city'), profileValue(p, 'state')].filter(Boolean).join(', ') ||
            profileValue(p, 'location')
          );
        }
      }
    ]);
  }

  function fillYesNoSelects(profile) {
    var filled = 0;
    var pairs = [
      {
        re: /sponsorship|visa|require.*(sponsor|visa)|will you now or in the future require/i,
        ans: yesNoFromProfile(profile, 'sponsorship visa', 'No')
      },
      {
        re: /authorized to work|legally (authorized|entitled)|work authorization|eligible to work|right to work|permitted to work/i,
        ans: yesNoFromProfile(profile, 'authorized to work', 'Yes')
      },
      {
        re: /previously worked|worked (at|for|with).*(before|previously)|prior (employment|employee)|former employee|have you (ever )?worked/i,
        ans: yesNoFromProfile(profile, 'previously worked', 'No')
      },
      {
        re: /based in (the )?u\.?s|united states|us[- ]based|located in the united states/i,
        ans: yesNoFromProfile(profile, 'based in US', 'No')
      },
      {
        re: /employment agreement|offer letter|non.?compete|confidentiality agreement|agree to the terms/i,
        ans: yesNoFromProfile(profile, 'employment agreements', 'Yes')
      }
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (selectYesNoOrOption(pairs[i].re, pairs[i].ans)) filled++;
    }

    // Native <select> country of residence / country when not already filled
    var selects = document.querySelectorAll('select');
    for (var s = 0; s < selects.length; s++) {
      var el = selects[s];
      if (!visible(el) && el.offsetParent === null) continue;
      var lab = getLabelFor(el);
      var blob = norm(lab + ' ' + (el.name || '') + ' ' + (el.id || ''));
      if (shouldSkipDiversity(blob, el, profile)) continue;
      if (/country of residence|\bcountry\b/.test(blob) && !/phone|code|sponsor|authorized/.test(blob)) {
        var c = profileValue(profile, 'country');
        if (c && setNativeValue(el, c)) filled++;
      }
      if (/phone.?country|country.?code|dial/.test(blob)) {
        var pc = profileValue(profile, 'phoneCountry');
        if (pc && setNativeValue(el, pc)) filled++;
      }
    }
    return filled;
  }

  function fillLongText(profile) {
    var filled = 0;
    var emptyRequired = [];
    var nodes = document.querySelectorAll('textarea, input[type="text"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'file') continue;
      var label = getLabelFor(el);
      var blob = norm(label + ' ' + (el.name || '') + ' ' + (el.id || ''));
      if (shouldSkipDiversity(blob, el, profile)) continue;
      if (
        /^(name|email|linkedin|phone|city|country|location|preferred|website|first|last)/.test(blob) &&
        blob.length < 48
      ) {
        continue;
      }
      if (/resume|cv|file|attach/.test(blob) && el.tagName !== 'TEXTAREA') continue;

      var isLong =
        el.tagName === 'TEXTAREA' ||
        /why (join|do you want|are you interested)|additional (info|information)|tell us|describe|cover letter|accessibility|accommodation|motivat/i.test(
          label
        );

      if (!isLong && el.tagName !== 'TEXTAREA') continue;

      var ans = answerFromCustom(profile, label);
      if (
        !ans &&
        /why (join|do you want|are you interested)|additional (info|information)|cover letter|motivat|tell us about/i.test(
          label
        )
      ) {
        ans = profileValue(profile, 'coverLetter') || profileValue(profile, 'resumeSummary');
      }
      // Accessibility / accommodations: only from customAnswers — never invent
      if (/accessibility|accommodation|disability accommodation/i.test(label) && !ans) {
        continue;
      }
      if (ans) {
        if (setNativeValue(el, ans)) filled++;
      } else {
        var required =
          el.required ||
          el.getAttribute('aria-required') === 'true' ||
          /\*/.test(label) ||
          /\(required\)/i.test(label);
        if (required && (!el.value || !String(el.value).trim())) {
          emptyRequired.push(label || blob);
        }
      }
    }
    return { filled: filled, emptyRequired: emptyRequired };
  }

  /**
   * Team interest radios (Corporate / GTM / Growth) — only from customAnswers.
   * If required and unmapped in submit mode, caller pauses.
   */
  function fillTeamInterestRadios(profile) {
    var filled = 0;
    var unmappedRequired = [];
    var roots = document.querySelectorAll(
      'fieldset, [role="radiogroup"], [role="group"], .field, .form-field, .application--field, form div'
    );
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      var lab = (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (shouldSkipDiversity(lab, root, profile)) continue;
      if (
        !/team interest|which team|interest(ed)? in|corporate|gtm|growth|go.to.market/i.test(lab)
      ) {
        continue;
      }
      // Must look like a team-interest control set (not random page text)
      var radios = root.querySelectorAll('input[type="radio"], [role="radio"]');
      if (!radios.length) continue;
      var hasTeamOpt = false;
      for (var r = 0; r < radios.length; r++) {
        var rt = norm(getLabelFor(radios[r]) || radios[r].value || buttonText(radios[r]));
        if (/corporate|gtm|growth|go.to.market|product|engineering|sales|marketing/.test(rt)) {
          hasTeamOpt = true;
          break;
        }
      }
      if (!hasTeamOpt && !/team interest|which team/i.test(lab)) continue;

      var ans = answerFromCustom(profile, lab) || answerFromCustom(profile, 'team interest');
      if (!ans) {
        var required =
          /required|\*/i.test(lab) ||
          root.querySelector('[required], [aria-required="true"]');
        if (required) unmappedRequired.push(lab.slice(0, 120));
        continue;
      }
      var want = norm(ans);
      for (var j = 0; j < radios.length; j++) {
        var radio = radios[j];
        var rLab = norm(getLabelFor(radio) || radio.value || buttonText(radio));
        if (rLab === want || rLab.indexOf(want) !== -1 || want.indexOf(rLab) !== -1) {
          try {
            radio.click();
            if (radio.tagName === 'INPUT') {
              radio.checked = true;
              radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            filled++;
            break;
          } catch (_e) {}
        }
      }
    }
    return { filled: filled, unmappedRequired: unmappedRequired };
  }

  function skipDiversity(profile) {
    // Prefer "Prefer not to answer" / leave blank — never invent demographics
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var el = selects[i];
      var lab = getLabelFor(el);
      var blob = lab + ' ' + (el.name || '') + ' ' + (el.id || '');
      if (!isDiversityField(blob) && !isInDiversitySection(el)) continue;
      // Gender Identity is filled from the profile when present — do not blank it.
      if (isGenderField(blob) && profile && String(profile.gender || '').trim()) continue;
      for (var o = 0; o < el.options.length; o++) {
        var t = (el.options[o].textContent || '').trim();
        if (/prefer not|decline|do not wish|choose not|not to (self-)?identify/i.test(t)) {
          el.selectedIndex = o;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
    var radios = document.querySelectorAll('input[type="radio"]');
    for (var r = 0; r < radios.length; r++) {
      var radio = radios[r];
      var wrap = radio.closest('fieldset, [role="group"], .field, div') || radio.parentElement;
      var wLab = ((wrap && wrap.textContent) || '') + ' ' + getLabelFor(radio);
      if (!isDiversityField(wLab) && !isInDiversitySection(radio)) continue;
      if (isGenderField(wLab) && profile && String(profile.gender || '').trim()) continue;
      var rLab = getLabelFor(radio) || radio.value || '';
      if (/prefer not|decline|do not wish|choose not|not to (self-)?identify/i.test(rLab)) {
        try {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_e) {}
      }
    }
  }

  function clickSubmitApplication() {
    var buttons = document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a.button, [role="button"]'
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!visible(btn) || btn.disabled) continue;
      var t = buttonText(btn);
      if (!t) continue;
      var score = 0;
      if (/^submit application$/i.test(t)) score = 100;
      if (/apply for this job/i.test(t)) score = 95;
      if (/^submit$/i.test(t)) score = 80;
      if (/^apply$/i.test(t) && t.length < 12) score = 70;
      if (/\bsubmit (application|& apply)\b/i.test(t)) score = Math.max(score, 90);
      if (/\bapply now\b/i.test(t)) score = Math.max(score, 75);
      if (global.FillApplySynonyms && global.FillApplySynonyms.isSubmitCta) {
        if (global.FillApplySynonyms.isSubmitCta(t)) score = Math.max(score, 85);
      }
      if (score > bestScore) {
        bestScore = score;
        best = btn;
      }
    }
    if (best && bestScore >= 70) {
      try {
        best.click();
        return true;
      } catch (_e) {}
    }
    if (global.__fillApply && global.__fillApply.clickSubmitButtons) {
      return !!global.__fillApply.clickSubmitButtons(adapter.submitSelector);
    }
    try {
      var el = document.querySelector(adapter.submitSelector);
      if (el && visible(el)) {
        el.click();
        return true;
      }
    } catch (_e2) {}
    return false;
  }

  function dismissAutofillBanner() {
    // Figma GH: "Autofill" optional — ignore / dismiss if it blocks, never required
    var nodes = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var t = buttonText(nodes[i]);
      if (/^dismiss$|^close$|no.?thanks|skip autofill/i.test(t) && visible(nodes[i])) {
        try {
          nodes[i].click();
        } catch (_e) {}
        return;
      }
    }
  }

  var adapter = {
    category: 'ats',
    id: 'greenhouse',
    name: 'Greenhouse',
    detect: detect,
    fieldMaps: [],
    submitSelector:
      'input[type="submit"]#submit_app, #submit_app, button[type="submit"], input[type="submit"], button.btn-submit, button[data-testid*="submit" i]',
    fileInputHints: [
      {
        kind: 'resume',
        match: 'resume|cv|curriculum',
        selector:
          'input[type=file]#resume, input[type=file][name*="resume"], input[type=file][id*="resume" i]'
      },
      {
        kind: 'cover',
        match: 'cover',
        selector:
          'input[type=file]#cover_letter, input[type=file][name*="cover"], input[type=file][id*="cover" i]'
      }
    ],
    fill: function (ctx) {
      ctx = ctx || {};
      var profile = ctx.profile || {};
      var documents = ctx.documents || {};
      var runMode = ctx.runMode || (ctx.options && ctx.options.runMode) || 'fill';
      if (['fill', 'ready', 'submit'].indexOf(runMode) === -1) runMode = 'fill';

      return Promise.resolve().then(async function () {
        // CAPTCHA/Cloudflare: wait ~10s and re-check before pausing. If the
        // challenge clears or is a widget on a fillable GH form, continue fill.
        if (global.FillApplyChallenges) {
          var C = global.FillApplyChallenges;
          var ch = null;
          if (typeof C.detectChallengeWithSettle === 'function') {
            ch = await C.detectChallengeWithSettle(document, { settleMs: C.CHALLENGE_SETTLE_MS || 10000 });
          } else if (typeof C.detectChallenge === 'function') {
            ch = C.detectChallenge(document);
            if (ch && ch.challenged) {
              await sleep(10000);
              ch = C.detectChallenge(document);
              if (
                ch &&
                ch.challenged &&
                typeof C.shouldPauseForChallenge === 'function' &&
                !C.shouldPauseForChallenge(ch, document)
              ) {
                ch = { challenged: false, kind: null, detail: '', markers: [], suppressed: true };
              }
            }
          }
          if (ch && ch.challenged) {
            return {
              ok: false,
              adapterId: 'greenhouse',
              needsHuman: true,
              challenge: ch,
              filled: 0,
              unmatched: 0,
              total: 0,
              error:
                (C.describeChallenge && C.describeChallenge(ch)) || 'Human verification required',
              pauseReason: 'challenge'
            };
          }
        }

        var totalFilled = 0;
        var submitted = false;

        dismissAutofillBanner();
        await sleep(150);

        // Open-application: classic GH "Apply for this job" before #application fields
        try {
          var syn = global.FillApplySynonyms;
          var appRoot = document.querySelector(
            '#application, #application-form, form#application, #main_fields'
          );
          var appOpen =
            appRoot &&
            syn &&
            typeof syn.countFillableApplicationInputs === 'function' &&
            syn.countFillableApplicationInputs(appRoot) >= 2;
          if (!appOpen && syn && typeof syn.tryClickApplyStart === 'function') {
            var opened = syn.tryClickApplyStart(document, {});
            if (opened && opened.clicked) {
              await sleep(500 + Math.floor(Math.random() * 300));
              appRoot = document.querySelector(
                '#application, #application-form, form#application, #main_fields'
              );
              appOpen =
                appRoot &&
                syn.countFillableApplicationInputs(appRoot) >= 2;
              if (!appOpen) {
                return {
                  ok: true,
                  adapterId: 'greenhouse',
                  clickedApplyStart: true,
                  reDetect: true,
                  handedOff: true,
                  deferToPageAdapter: true,
                  filled: 0,
                  unmatched: 0,
                  total: 0,
                  submitted: false,
                  message:
                    'Clicked Apply for this job (Greenhouse) — waiting for application form'
                };
              }
            }
          }
        } catch (_openErr) {}

        // 1) Attach files FIRST (DataTransfer — before any continue/submit)
        var filesAttached = attachGreenhouseFiles(documents);
        if (filesAttached.resumeAttached) totalFilled++;
        if (filesAttached.coverAttached) totalFilled++;

        // 2) Classic + embed fields
        totalFilled += fillBasicInfo(profile);
        totalFilled += fillYesNoSelects(profile);

        var long = fillLongText(profile);
        totalFilled += long.filled || 0;

        var team = fillTeamInterestRadios(profile);
        totalFilled += team.filled || 0;

        // 3) Diversity/EEO voluntary — skip / prefer not (never invent)
        skipDiversity(profile);

        // 4) Generic fallback heuristics without re-attaching files
        if (global.FillApplyFallbackAdapter) {
          try {
            var fb = global.FillApplyFallbackAdapter.fill(
              Object.assign({}, ctx, {
                adapterId: 'greenhouse',
                documents: {},
                runMode: 'fill',
                autoSubmit: false,
                submitSelector: adapter.submitSelector,
                fileInputHints: adapter.fileInputHints,
                fieldMaps: adapter.fieldMaps
              })
            );
            if (fb && typeof fb.then === 'function') fb = await fb;
            if (fb && fb.filled) totalFilled += fb.filled;
          } catch (_fbErr) {}
        }

        var pauseGaps = (long.emptyRequired || []).concat(team.unmappedRequired || []);
        if (pauseGaps.length && runMode === 'submit') {
          return {
            ok: false,
            adapterId: 'greenhouse',
            needsHuman: true,
            filled: totalFilled,
            unmatched: pauseGaps.length,
            total: totalFilled + pauseGaps.length,
            submitted: false,
            resumeAttached: !!filesAttached.resumeAttached,
            coverAttached: !!filesAttached.coverAttached,
            filesAttached: filesAttached,
            error:
              'Greenhouse required field unmapped — add customAnswers or answer manually: "' +
              String(pauseGaps[0]).slice(0, 100) +
              '"',
            pauseReason: 'structure_drift',
            driftLabel: pauseGaps[0],
            runMode: runMode
          };
        }

        if (runMode === 'submit') {
          submitted = clickSubmitApplication();
          if (submitted) await sleep(400);
        }

        return {
          ok: true,
          adapterId: 'greenhouse',
          filled: totalFilled,
          unmatched: pauseGaps.length || 0,
          total: totalFilled + (pauseGaps.length || 0),
          submitted: !!submitted,
          resumeAttached: !!filesAttached.resumeAttached,
          coverAttached: !!filesAttached.coverAttached,
          filesAttached: filesAttached,
          runMode: runMode
        };
      });
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
  global.FillApply_greenhouseAdapter = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
