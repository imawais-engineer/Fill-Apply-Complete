/**
 * Workable adapter — apply.workable.com / jobs.workable.com / qiddiya.com careers.
 *
 * Strengthens generic fill for Qiddiya-style Workable forms:
 *   Highest Education → Masters (MBA), Conflict of interest → No,
 *   PIF/affiliate → skip if empty, Social media → LinkedIn,
 *   Current Location → Riyadh, DOB → format per field (MM/DD/YYYY → 04/06/1979),
 *   Expected/Current monthly salary → skip if empty,
 *   Salutation Mr. / Nationality Pakistan, Years of relevant experience 15,
 *   Working for Qiddiya → No, Privacy ack / never had conviction → Yes,
 *   Resume upload via fileInputHints.
 *
 * Fill still delegates to the generic fallback engine.
 */
(function (global) {
  'use strict';

  function detect(url, doc) {
    url = String(url || '');
    if (/apply\.workable\.com|jobs\.workable\.com|workable\.com/i.test(url)) return true;
    if (/qiddiya\.com/i.test(url)) return true;
    if (doc && doc.querySelector('[data-ui="application-form"], .job-application, #job-application')) {
      return true;
    }
    return false;
  }

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function ca(profile) {
    return (profile && profile.customAnswers && typeof profile.customAnswers === 'object'
      ? profile.customAnswers
      : {}) || {};
  }

  /**
   * Ensure First/Last use the multi-word last name, DOB stays canonical ISO,
   * and Qiddiya screening keys are visible to field-map / customAnswers.
   * Empty salary / PIF answers stay blank so the engine skips (Complete Missing).
   */
  function enrichProfile(profile) {
    profile = profile || {};
    var out = Object.assign({}, profile);
    var answers = Object.assign({}, ca(profile));
    out.customAnswers = answers;

    var fmt = global.FillApplyFormat;
    var parts =
      fmt && typeof fmt.nameParts === 'function'
        ? fmt.nameParts(out)
        : {
            first: out.firstName || '',
            last: out.lastName || '',
            full: out.fullName || ''
          };
    if (parts.first) out.firstName = parts.first;
    if (parts.last) out.lastName = parts.last;
    if (parts.full) out.fullName = parts.full;

    // Canonical DOB — format.js converts to MM/DD or DD/MM at fill time.
    var dob =
      out.dateOfBirth ||
      answers.date_of_birth ||
      answers.dob_iso ||
      answers.dob ||
      '';
    if (!isBlank(dob)) {
      out.dateOfBirth = String(dob).trim();
      answers.date_of_birth = out.dateOfBirth;
      answers.dob = out.dateOfBirth;
    }

    if (isBlank(out.salutation) && !isBlank(answers.salutation || answers.title)) {
      out.salutation = answers.salutation || answers.title;
    }
    if (isBlank(out.salutation)) out.salutation = 'Mr.';

    if (isBlank(out.nationality)) out.nationality = answers.nationality || 'Pakistan';
    if (isBlank(out.city) && !isBlank(answers.current_location || answers.location)) {
      out.city = answers.current_location || answers.location;
    }
    if (isBlank(out.location) && !isBlank(out.city)) out.location = out.city;
    if (isBlank(out.linkedin) && !isBlank(answers.social_media_profiles || answers.social_media)) {
      out.linkedin = answers.social_media_profiles || answers.social_media;
    }

    if (isBlank(out.highestEducation)) {
      out.highestEducation =
        answers.highest_education ||
        answers.Highest_Education_Level ||
        answers['Highest Education Level'] ||
        "Master's Degree";
    }
    // Workable often lists "Masters" / "Master's" / "MBA".
    answers['Highest Education Level'] =
      answers['Highest Education Level'] || answers.education_level || 'Masters';
    answers.highest_education = answers.highest_education || out.highestEducation;
    answers.education_level = answers.education_level || 'Masters';

    if (isBlank(out.yearsExperience)) {
      out.yearsExperience =
        answers.years_of_relevant_experience || answers.years_experience || '15';
    }
    answers['Years of relevant experience'] =
      answers['Years of relevant experience'] || out.yearsExperience || '15';

    // Screening defaults from portfolio — never invent salary or PIF.
    if (isBlank(answers.conflict_of_interest) && isBlank(answers['Conflict of interest'])) {
      answers.conflict_of_interest = 'No';
      answers['Conflict of interest'] = 'No';
    }
    out.conflictOfInterest = out.conflictOfInterest || answers.conflict_of_interest || 'No';

    if (isBlank(answers.working_for_qiddiya)) {
      answers.working_for_qiddiya =
        answers['Are you currently involved or working directly for Qiddiya'] || 'No';
    }
    out.workingForQiddiya = out.workingForQiddiya || answers.working_for_qiddiya || 'No';

    // PIF/affiliate: leave empty when unset so fill skips → Complete Missing Info.
    if (!Object.prototype.hasOwnProperty.call(answers, 'worked_for_pif_or_affiliate')) {
      answers.worked_for_pif_or_affiliate =
        answers[
          'Are you currently or have you ever worked directly for PIF or one of its affiliated companies?'
        ] || '';
    }

    answers.never_had_criminal_conviction =
      answers.never_had_criminal_conviction ||
      answers['I hereby confirm that I have never had any criminal conviction'] ||
      'Yes';
    // Prefer the affirmative never-had key over a conflicting long-label No.
    if (/^yes$/i.test(String(answers.never_had_criminal_conviction).trim())) {
      answers['I hereby confirm that I have never had any criminal conviction'] = 'Yes';
    }
    out.neverHadCriminalConviction =
      out.neverHadCriminalConviction || answers.never_had_criminal_conviction || 'Yes';

    answers.qiddiya_privacy_ack = answers.qiddiya_privacy_ack || answers.privacy_accepted || 'Yes';
    answers.privacy_accepted = answers.privacy_accepted || 'Yes';
    out.privacyAccepted = out.privacyAccepted || answers.privacy_accepted || 'Yes';

    answers.social_media_profiles =
      answers.social_media_profiles || out.linkedin || answers['Social media'] || '';
    answers['Social media'] = answers['Social media'] || answers.social_media_profiles;
    answers['Do you have any social media accounts'] =
      answers['Do you have any social media accounts'] || answers.social_media_profiles;

    answers.current_location = answers.current_location || out.city || 'Riyadh';
    answers['Current Location'] = answers['Current Location'] || answers.current_location;

    // Empty salary → leave blank (required → Complete Missing Info).
    [
      'currentSalary',
      'expectedSalary',
      'current_monthly_salary',
      'expected_salary',
      'Current monthly salary',
      'Expected monthly salary',
      'What is your current monthly salary?',
      'What is your expected salary?',
      'What is your current monthly salary (In Job Location Currency)?',
      'What is your expected salary (In Job Location Currency)?'
    ].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(answers, k) && isBlank(answers[k])) {
        answers[k] = '';
      }
    });
    if (isBlank(out.currentSalary)) out.currentSalary = '';
    if (isBlank(out.expectedSalary)) out.expectedSalary = '';

    return out;
  }

  var FIELD_MAPS = [
    {
      key: 'highestEducation',
      autocomplete: [],
      names: ['education', 'education_level'],
      labels: ['highest education level', 'highest education', 'education level'],
      placeholders: []
    },
    {
      key: 'conflictOfInterest',
      autocomplete: [],
      names: ['conflict_of_interest'],
      labels: ['conflict of interest'],
      placeholders: []
    },
    {
      key: 'workingForQiddiya',
      autocomplete: [],
      names: ['working_for_qiddiya'],
      labels: [
        'working for qiddiya',
        'are you currently involved or working directly for qiddiya'
      ],
      placeholders: []
    },
    {
      key: 'workedForPifOrAffiliate',
      autocomplete: [],
      names: ['worked_for_pif_or_affiliate', 'pif'],
      labels: [
        'pif or one of its affiliated companies',
        'worked directly for pif',
        'public investment fund'
      ],
      placeholders: []
    },
    {
      key: 'neverHadCriminalConviction',
      autocomplete: [],
      names: ['never_had_criminal_conviction', 'criminal_conviction'],
      labels: [
        'never had any criminal conviction',
        'i hereby confirm that i have never had any criminal conviction'
      ],
      placeholders: []
    },
    {
      key: 'socialMedia',
      autocomplete: [],
      names: ['social_media', 'social_media_profiles'],
      labels: ['social media', 'social media accounts', 'do you have any social media accounts'],
      placeholders: []
    },
    {
      key: 'location',
      autocomplete: [],
      names: ['current_location'],
      labels: ['current location'],
      placeholders: []
    },
    {
      key: 'dateOfBirth',
      autocomplete: ['bday'],
      names: ['date_of_birth', 'dob'],
      labels: ['date of birth', 'birth date'],
      placeholders: ['mm/dd/yyyy', 'dd/mm/yyyy']
    },
    {
      key: 'yearsExperience',
      autocomplete: [],
      names: ['years_of_relevant_experience'],
      labels: ['years of relevant experience', 'years of experience'],
      placeholders: []
    },
    {
      key: 'privacyAccepted',
      autocomplete: [],
      names: ['qiddiya_privacy_ack', 'privacy_accepted'],
      labels: ['privacy acknowledgement', 'privacy notice', 'data privacy'],
      placeholders: []
    }
  ];

  var adapter = {
    id: 'workable',
    name: 'Workable',
    category: 'ats',
    detect: detect,
    fieldMaps: FIELD_MAPS,
    enrichProfile: enrichProfile,
    submitSelector:
      'button[type="submit"], button[data-ui="submit"], [data-ui="application-form"] button[type="submit"]',
    fileInputHints: [
      {
        kind: 'resume',
        match: 'resume|cv|curriculum',
        selector: 'input[type=file][name*="resume"], input[type=file][name*="cv"], input[type=file]'
      },
      { kind: 'cover', match: 'cover' }
    ],
    fill: function (ctx) {
      var fb = global.FillApplyFallbackAdapter;
      if (!fb) {
        return {
          ok: false,
          adapterId: 'workable',
          error: 'Fallback adapter missing',
          filled: 0,
          unmatched: 0,
          total: 0
        };
      }
      var profile = enrichProfile((ctx && ctx.profile) || {});
      return fb.fill(
        Object.assign({}, ctx, {
          profile: profile,
          adapterId: 'workable',
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: (adapter.fieldMaps || []).concat((ctx && ctx.fieldMaps) || [])
        })
      );
    }
  };

  if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
})(typeof globalThis !== 'undefined' ? globalThis : self);
