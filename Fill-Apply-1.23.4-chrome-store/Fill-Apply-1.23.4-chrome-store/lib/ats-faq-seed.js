/**
 * Built-in Universal ATS FAQ seed (generic — NO applicant PII).
 *
 * Documents question SEMANTICS + answer STRATEGY. Concrete values come from
 * the imported profile / adaptive knowledge at fill time.
 *
 * Architecture:
 *   Built-in FAQ seed + Imported profile + Adaptive knowledge = unified resolver
 *   (confirmed profile / Tier-2 knowledge wins over FAQ strategy hints).
 *
 * Attaches globalThis.FillApplyAtsFaqSeed.
 */
(function (global) {
  'use strict';

  /**
   * Each entry:
   *   key          — canonical key (aligned with field-map / knowledge catalog)
   *   category     — grouping for docs / Options
   *   aliases      — question phrasings (semantics only)
   *   strategy     — how to answer (never invent values here)
   *   controlHints — preferred DOM control types
   *   knownPolicy  — KNOWN | UNKNOWN | AMBIGUOUS | PROFILE | CONSENT
   *   notes        — human-readable guidance
   */
  var FAQ_ENTRIES = [
    /* —— Identity —— */
    {
      key: 'salutation',
      category: 'identity',
      aliases: ['salutation', 'title', 'prefix', 'mr/mrs/ms'],
      strategy: 'Map profile.salutation to select/radio options (Mr/Ms/Mrs/Mx). Never invent.',
      controlHints: ['select', 'radio'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'firstName',
      category: 'identity',
      aliases: ['first name', 'given name', 'forename'],
      strategy: 'Use profile first name (or nameParts.first from fullName).',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'lastName',
      category: 'identity',
      aliases: ['last name', 'surname', 'family name'],
      strategy: 'Use profile last name (remainder after first token when only fullName exists).',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'fullName',
      category: 'identity',
      aliases: ['full name', 'complete name', 'legal name'],
      strategy: 'Prefer profile.fullName; else join first+last.',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'dateOfBirth',
      category: 'identity',
      aliases: ['date of birth', 'dob', 'birth date', 'birthday'],
      strategy: 'Canonical ISO in profile; control-adapter formats for type=date / placeholder / pattern. Never type human date into type=date.',
      controlHints: ['date', 'text', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'gender',
      category: 'identity',
      aliases: ['gender', 'sex'],
      strategy: 'Only fill select/radio/combobox when profile.gender is set. Skip free-text. Skip sexual orientation / EEO unless profile opted in.',
      controlHints: ['select', 'radio', 'combobox'],
      knownPolicy: 'PROFILE'
    },

    /* —— Contact —— */
    {
      key: 'email',
      category: 'contact',
      aliases: ['email', 'e-mail', 'email address'],
      strategy: 'profile.email into type=email or text.',
      controlHints: ['email', 'text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'phone',
      category: 'contact',
      aliases: ['phone', 'mobile', 'telephone', 'cell'],
      strategy: 'If a separate country/dial-code control exists, fill national number only — never duplicate +country. Else full E.164.',
      controlHints: ['tel', 'text'],
      knownPolicy: 'PROFILE',
      notes: 'Pairs with phoneCountry. control-adapter.adaptPhone strips leading country when hasPhoneCountryField.'
    },
    {
      key: 'phoneCountry',
      category: 'contact',
      aliases: ['country code', 'dial code', 'phone country', 'calling code'],
      strategy: 'Select dial code from profile.phoneCountry / phone prefix. Distinct from residence country.',
      controlHints: ['select', 'combobox'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'linkedin',
      category: 'contact',
      aliases: ['linkedin', 'linkedin url', 'linkedin profile'],
      strategy: 'profile.linkedin URL as-is.',
      controlHints: ['url', 'text'],
      knownPolicy: 'PROFILE'
    },

    /* —— Address / geo —— */
    {
      key: 'country',
      category: 'address',
      aliases: ['country', 'country of residence', 'current country', 'residing country'],
      strategy: 'Residence country from profile.country / location. NEVER use nationality.',
      controlHints: ['select', 'combobox', 'autocomplete'],
      knownPolicy: 'PROFILE',
      notes: 'Country vs nationality disambiguation is mandatory.'
    },
    {
      key: 'nationality',
      category: 'address',
      aliases: ['nationality', 'citizenship', 'citizen of', 'passport country'],
      strategy: 'profile.nationality only. NEVER use residence country.',
      controlHints: ['select', 'combobox', 'autocomplete'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'city',
      category: 'address',
      aliases: ['city', 'town', 'current city'],
      strategy: 'profile.city.',
      controlHints: ['text', 'autocomplete'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'street',
      category: 'address',
      aliases: ['street', 'address', 'address line 1'],
      strategy: 'profile.street.',
      controlHints: ['text', 'textarea'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'zip',
      category: 'address',
      aliases: ['zip', 'postal code', 'postcode', 'zip code'],
      strategy: 'profile.zip || profile.postcode.',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },

    /* —— Education —— */
    {
      key: 'highestEducation',
      category: 'education',
      aliases: ['highest education', 'highest qualification', 'education level', 'degree level'],
      strategy: 'Match profile.highestEducation to select buckets (Bachelor/Master/PhD…).',
      controlHints: ['select', 'radio'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'degree',
      category: 'education',
      aliases: ['degree', 'qualification', 'b.com', 'm.com', 'mba'],
      strategy: 'profile.degree / customAnswers; semantic match to options (B.Com, M.Com, Masters).',
      controlHints: ['select', 'text', 'combobox'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'school',
      category: 'education',
      aliases: ['school', 'university', 'college', 'institution'],
      strategy: 'profile.school.',
      controlHints: ['text', 'autocomplete'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'fieldOfStudy',
      category: 'education',
      aliases: ['field of study', 'major', 'specialization'],
      strategy: 'profile.fieldOfStudy.',
      controlHints: ['text', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'graduationYear',
      category: 'education',
      aliases: ['graduation year', 'year of graduation', 'year completed'],
      strategy: 'profile.graduationYear as number/year text.',
      controlHints: ['number', 'text', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'caOrAcca',
      category: 'education',
      aliases: ['ca or acca', 'ca/acca', 'chartered accountant or acca', 'are you ca or acca'],
      strategy: 'Yes/No from knowledge/profile. Distinct from CA-only questions.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE',
      notes: 'Trial pattern: CA or ACCA vs CA-only must not share answers.'
    },
    {
      key: 'caOnly',
      category: 'education',
      aliases: ['are you a ca', 'chartered accountant only', 'icai ca'],
      strategy: 'Separate key from caOrAcca. Answer only if profile has explicit CA-only fact.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },

    /* —— Employment —— */
    {
      key: 'currentTitle',
      category: 'employment',
      aliases: ['current job title', 'current title', 'position title'],
      strategy: 'profile.currentTitle.',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'currentCompany',
      category: 'employment',
      aliases: ['current employer', 'current company', 'organization'],
      strategy: 'profile.currentCompany.',
      controlHints: ['text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'yearsExperience',
      category: 'experience',
      aliases: ['years of experience', 'total experience', 'years experience', 'how many years'],
      strategy: 'Normalize "15 years" / "15+" → number when control is number; else match select buckets (10+).',
      controlHints: ['number', 'select', 'text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'experienceLevel',
      category: 'experience',
      aliases: ['experience level', 'seniority', 'level'],
      strategy: 'Map years/title to options (Director, Manager, Senior…). Do not invent.',
      controlHints: ['select', 'radio'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'noticePeriod',
      category: 'availability',
      aliases: ['notice period', 'notice', 'availability to join'],
      strategy: 'profile.noticePeriod; match Immediate / 30 days / etc.',
      controlHints: ['select', 'text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'availableFrom',
      category: 'availability',
      aliases: ['available from', 'start date', 'earliest start'],
      strategy: 'profile.availableFrom as date or text.',
      controlHints: ['date', 'text'],
      knownPolicy: 'PROFILE'
    },

    /* —— Salary (strategy only — blank stays UNKNOWN) —— */
    {
      key: 'currentSalary',
      category: 'salary',
      aliases: ['current salary', 'current ctc', 'present salary', 'current remuneration'],
      strategy: 'ONLY fill when profile/customAnswers has a value. If blank → UNKNOWN — never invent.',
      controlHints: ['text', 'number'],
      knownPolicy: 'UNKNOWN'
    },
    {
      key: 'expectedSalary',
      category: 'salary',
      aliases: ['expected salary', 'salary expectation', 'desired salary', 'expected ctc'],
      strategy: 'ONLY fill when known. If blank → UNKNOWN — never invent.',
      controlHints: ['text', 'number'],
      knownPolicy: 'UNKNOWN'
    },
    {
      key: 'salaryCurrency',
      category: 'salary',
      aliases: ['salary currency', 'currency', 'pay currency'],
      strategy: 'From profile when present; else leave UNKNOWN.',
      controlHints: ['select', 'text'],
      knownPolicy: 'UNKNOWN'
    },

    /* —— Screening yes/no —— */
    {
      key: 'authorizedToWork',
      category: 'work_auth',
      aliases: ['authorized to work', 'legally authorized', 'work authorization', 'eligible to work'],
      strategy: 'Boolean Yes/No from profile.authorizedToWork. Click real radio; verify checked.',
      controlHints: ['radio', 'select', 'checkbox'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'requiresSponsorship',
      category: 'sponsorship',
      aliases: ['require sponsorship', 'visa sponsorship', 'need sponsorship', 'sponsorship required'],
      strategy: 'profile.requiresSponsorship Yes/No. Distinct from work auth.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'middleEastVisa',
      category: 'work_auth',
      aliases: ['middle east visa', 'gcc visa', 'me working visa', 'transferable visa'],
      strategy: 'Explicit profile/knowledge only. Do not infer from nationality.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'willingToRelocate',
      category: 'relocation',
      aliases: ['willing to relocate', 'open to relocate', 'relocation'],
      strategy: 'profile.willingToRelocate Yes/No/select.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'willingToTravel',
      category: 'travel',
      aliases: ['willing to travel', 'travel required', 'travel percentage'],
      strategy: 'From profile/customAnswers when known; else UNKNOWN.',
      controlHints: ['radio', 'select', 'number'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'conflictOfInterest',
      category: 'screening',
      aliases: ['conflict of interest', 'related to employee', 'know anyone at'],
      strategy: 'Default No unless profile states otherwise. Yes/No radio click+verify.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'previouslyEmployed',
      category: 'screening',
      aliases: ['previously worked', 'former employee', 'worked here before'],
      strategy: 'Yes/No from profile; never invent employer history.',
      controlHints: ['radio', 'select'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'over18',
      category: 'screening',
      aliases: ['over 18', 'at least 18', '18 years or older'],
      strategy: 'Usually Yes from DOB/profile; checkbox/radio.',
      controlHints: ['checkbox', 'radio'],
      knownPolicy: 'PROFILE'
    },

    /* —— Finance / accounting quals —— */
    {
      key: 'erpExperience',
      category: 'finance',
      aliases: ['erp', 'sap', 'oracle', 'erp experience'],
      strategy: 'From skills/customAnswers; multiselect check each match.',
      controlHints: ['multiselect', 'checkbox-group', 'text'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'professionalQualification',
      category: 'finance',
      aliases: ['professional qualification', 'certifications', 'acca', 'cpa', 'cfa'],
      strategy: 'List from profile certifications; match options; no invent.',
      controlHints: ['multiselect', 'text', 'checkbox-group'],
      knownPolicy: 'PROFILE'
    },

    /* —— Consents —— */
    {
      key: 'consent',
      category: 'consents',
      aliases: ['i agree', 'i consent', 'privacy policy', 'terms and conditions', 'i acknowledge'],
      strategy: 'Tick required consent checkboxes during fill/ready/submit. Never type "Yes" into checkbox. Distinguish consent vs factual Yes/No.',
      controlHints: ['checkbox'],
      knownPolicy: 'CONSENT'
    },

    /* —— Demographics —— */
    {
      key: 'demographics',
      category: 'demographics',
      aliases: ['race', 'ethnicity', 'veteran', 'disability', 'sexual orientation', 'eeo'],
      strategy: 'Prefer not to invent. Skip voluntary EEO unless profile explicitly opted in (gender exception when profile.gender set).',
      controlHints: ['select', 'radio'],
      knownPolicy: 'UNKNOWN'
    },

    /* —— Skills —— */
    {
      key: 'skills',
      category: 'skills',
      aliases: ['skills', 'key skills', 'technical skills'],
      strategy: 'Multiselect/checkbox-group: resolve each skill; check matches; verify each. No blind Enter on combobox.',
      controlHints: ['multiselect', 'checkbox-group', 'combobox', 'autocomplete'],
      knownPolicy: 'PROFILE'
    },

    /* —— Documents —— */
    {
      key: 'resume',
      category: 'documents',
      aliases: ['resume', 'cv', 'curriculum vitae', 'upload resume'],
      strategy: 'Attach only if local document configured; else BLOCKER with clear message.',
      controlHints: ['file'],
      knownPolicy: 'PROFILE'
    },
    {
      key: 'coverLetter',
      category: 'documents',
      aliases: ['cover letter', 'covering letter', 'motivation letter'],
      strategy: 'Attach only if configured; else BLOCKER or skip if optional.',
      controlHints: ['file', 'textarea'],
      knownPolicy: 'PROFILE'
    }
  ];

  function byKey(key) {
    var k = String(key || '');
    for (var i = 0; i < FAQ_ENTRIES.length; i++) {
      if (FAQ_ENTRIES[i].key === k) return FAQ_ENTRIES[i];
    }
    return null;
  }

  function byCategory(category) {
    var c = String(category || '');
    return FAQ_ENTRIES.filter(function (e) {
      return e.category === c;
    });
  }

  /** Strategy-only lookup: never returns an invented answer value. */
  function strategyFor(keyOrLabel) {
    var hit = byKey(keyOrLabel);
    if (hit) return hit;
    var n = String(keyOrLabel || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    for (var i = 0; i < FAQ_ENTRIES.length; i++) {
      var e = FAQ_ENTRIES[i];
      for (var a = 0; a < (e.aliases || []).length; a++) {
        if (n.indexOf(e.aliases[a]) !== -1 || e.aliases[a].indexOf(n) !== -1) return e;
      }
    }
    return null;
  }

  /** Keys whose knownPolicy is UNKNOWN must not be auto-filled when blank. */
  function isExplicitUnknownPolicy(key) {
    var e = byKey(key);
    return !!(e && e.knownPolicy === 'UNKNOWN');
  }

  /**
   * Export alias hints for catalog strengthening (wording only — no values).
   */
  function aliasMap() {
    var out = {};
    FAQ_ENTRIES.forEach(function (e) {
      out[e.key] = (e.aliases || []).slice();
    });
    return out;
  }

  global.FillApplyAtsFaqSeed = {
    FAQ_ENTRIES: FAQ_ENTRIES,
    byKey: byKey,
    byCategory: byCategory,
    strategyFor: strategyFor,
    isExplicitUnknownPolicy: isExplicitUnknownPolicy,
    aliasMap: aliasMap,
    version: '1.20.0'
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
