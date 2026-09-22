/**
 * Source-based profiles — catalog of required fields per ATS/board,
 * chrome.storage.local keys fillApply.sourceProfiles + fillApply.selectedSourceId,
 * completeness gate, and merge-over-base at fill time.
 *
 * Inheritance: effectiveProfile = merge(baseProfile, sourceAnswers via mapsTo).
 * When selectedSourceId is set, Start is blocked until isSourceProfileComplete.
 */
(function (global) {
  'use strict';

  var PROFILES_KEY = 'fillApply.sourceProfiles';
  var SELECTED_KEY = 'fillApply.selectedSourceId';

  function CORE_CONTACT() {
    return [
      { key: 'firstName', label: 'First name', type: 'text', mapsTo: 'firstName', compulsory: true },
      { key: 'lastName', label: 'Last name', type: 'text', mapsTo: 'lastName', compulsory: true },
      { key: 'email', label: 'Email', type: 'text', mapsTo: 'email', compulsory: true },
      { key: 'phone', label: 'Phone', type: 'text', mapsTo: 'phone', compulsory: true }
    ];
  }

  function BASELINE_ATS() {
    return CORE_CONTACT().concat([
      { key: 'resume', label: 'Resume', type: 'text', mapsTo: 'resumeUrl', compulsory: true },
      { key: 'coverLetter', label: 'Cover letter', type: 'textarea', mapsTo: 'coverLetter', compulsory: true },
      { key: 'authorizedToWork', label: 'Authorized to work', type: 'select', options: ['Yes', 'No'], mapsTo: 'authorizedToWork', compulsory: true },
      { key: 'requiresSponsorship', label: 'Requires sponsorship', type: 'select', options: ['Yes', 'No'], mapsTo: 'requiresSponsorship', compulsory: true }
    ]);
  }

  var SOURCE_CATALOG = [
    {
      id: 'teamtailor',
      label: 'Teamtailor',
      hosts: ['teamtailor.com', 'www.teamtailor.com', 'app.teamtailor.com'],
      requiredFields: CORE_CONTACT().concat([
        {
          key: 'yearsExperience',
          label: 'Years of experience',
          type: 'select',
          options: ['0-2', '3-5', '6-9', '10+'],
          mapsTo: 'customAnswers.yearsExperience',
          compulsory: true
        },
        {
          key: 'currentSalary',
          label: 'Current salary',
          type: 'text',
          mapsTo: 'customAnswers.currentSalary',
          compulsory: true
        },
        {
          key: 'noticePeriod',
          label: 'Notice period',
          type: 'select',
          options: ['Onspot', '15 days', '30 days', '60 days'],
          mapsTo: 'noticePeriod',
          compulsory: true
        },
        {
          key: 'nationality',
          label: 'Nationality / citizenship',
          type: 'text',
          mapsTo: 'nationality',
          compulsory: true
        },
        {
          key: 'basedInRiyadh',
          label: 'Based in Riyadh',
          type: 'select',
          options: ['Yes', 'No'],
          mapsTo: 'customAnswers.basedInRiyadh',
          compulsory: true
        },
        {
          key: 'largestTeamSize',
          label: 'Largest team size',
          type: 'select',
          options: ['1-5', '11-20', '50-100', 'more than 200'],
          mapsTo: 'customAnswers.largestTeamSize',
          compulsory: true
        },
        {
          key: 'educationalCertificate',
          label: 'Educational certificate / شهادة تربوية',
          type: 'select',
          options: ['Yes', 'No', 'In progress'],
          mapsTo: 'customAnswers.educationalCertificate',
          compulsory: true
        },
        {
          key: 'previouslyRecruited',
          label: 'Previously recruited / hired',
          type: 'select',
          options: [
            { value: 'full-process', label: 'Yes — managed full recruitment process end to end' },
            { value: 'partial', label: 'Yes — partial involvement' },
            { value: 'interview-only', label: 'Interviewed candidates only' },
            { value: 'no', label: 'No' }
          ],
          mapsTo: 'customAnswers.previouslyRecruited',
          compulsory: true
        },
        {
          key: 'computerToolsRating',
          label: 'Computer tools / operational data',
          type: 'select',
          options: [
            { value: 'proficient', label: 'I am proficient with most computer tools and can work independently with operational data' },
            { value: 'intermediate', label: 'Intermediate — need occasional help' },
            { value: 'basic', label: 'Basic familiarity' },
            { value: 'learning', label: 'Still learning' }
          ],
          mapsTo: 'customAnswers.computerToolsRating',
          compulsory: true
        },
        {
          key: 'whyHire',
          label: 'Why should we hire you / cover letter',
          type: 'textarea',
          mapsTo: 'coverLetter',
          compulsory: true
        }
      ])
    },
    {
      id: 'indeed',
      label: 'Indeed',
      hosts: ['indeed.com', 'www.indeed.com', 'pk.indeed.com', 'ae.indeed.com'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'phoneCountry', label: 'Phone country code', type: 'text', mapsTo: 'phoneCountry', compulsory: true },
        { key: 'city', label: 'City / location', type: 'text', mapsTo: 'city', compulsory: true },
        { key: 'highestEducation', label: 'Highest education', type: 'text', mapsTo: 'customAnswers.highestEducation', compulsory: true },
        { key: 'gender', label: 'Gender (optional)', type: 'text', mapsTo: 'gender', compulsory: false },
        { key: 'conflictOfInterest', label: 'Conflict of interest', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.conflictOfInterest', compulsory: true },
        { key: 'pif', label: 'PIF', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.PIF', compulsory: true },
        { key: 'linkedin', label: 'LinkedIn / social', type: 'text', mapsTo: 'linkedin', compulsory: true },
        { key: 'dob', label: 'Date of birth (optional)', type: 'text', mapsTo: 'customAnswers.dob', compulsory: false },
        { key: 'expectedSalary', label: 'Expected salary', type: 'text', mapsTo: 'customAnswers.expectedSalary', compulsory: true },
        { key: 'currentSalary', label: 'Current salary', type: 'text', mapsTo: 'customAnswers.currentSalary', compulsory: true },
        { key: 'salutation', label: 'Salutation', type: 'text', mapsTo: 'customAnswers.salutation', compulsory: true },
        { key: 'nationality', label: 'Nationality', type: 'text', mapsTo: 'nationality', compulsory: true },
        { key: 'yearsExperience', label: 'Years of experience', type: 'text', mapsTo: 'customAnswers.yearsExperience', compulsory: true },
        { key: 'workAuth', label: 'Work authorization', type: 'select', options: ['Yes', 'No'], mapsTo: 'authorizedToWork', compulsory: true },
        { key: 'sponsorship', label: 'Sponsorship', type: 'select', options: ['Yes', 'No'], mapsTo: 'requiresSponsorship', compulsory: true },
        { key: 'drivingLicense', label: 'Driving license', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.drivingLicense', compulsory: true },
        { key: 'ownCar', label: 'Own car', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.ownCar', compulsory: true },
        { key: 'coverLetter', label: 'Cover letter', type: 'textarea', mapsTo: 'coverLetter', compulsory: true }
      ])
    },
    {
      id: 'glassdoor',
      label: 'Glassdoor',
      hosts: ['glassdoor.com', 'www.glassdoor.com'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'phoneCountry', label: 'Phone country', type: 'text', mapsTo: 'phoneCountry', compulsory: true },
        { key: 'country', label: 'Country', type: 'text', mapsTo: 'country', compulsory: true },
        { key: 'postcode', label: 'Postal code', type: 'text', mapsTo: 'postcode', compulsory: true },
        { key: 'city', label: 'City', type: 'text', mapsTo: 'city', compulsory: true },
        { key: 'street', label: 'Street address (not shown to employers)', type: 'text', mapsTo: 'street', compulsory: false },
        { key: 'resume', label: 'Resume (PDF/DOCX/RTF/TXT)', type: 'text', mapsTo: 'resumeUrl', compulsory: true }
      ]),
      note: 'Indeed-backed Easy Apply: contact → location → resume → review (+ reCAPTCHA needsHuman). Submit only in submit mode.'
    },
    {
      id: 'icims',
      label: 'iCIMS',
      hosts: ['icims.com'],
      requiredFields: [
        { key: 'nationality', label: 'Nationality', type: 'text', mapsTo: 'nationality', compulsory: true },
        { key: 'gender', label: 'Gender', type: 'text', mapsTo: 'gender', compulsory: true },
        { key: 'noticePeriod', label: 'Notice period', type: 'text', mapsTo: 'noticePeriod', compulsory: true },
        { key: 'education', label: 'Education', type: 'textarea', mapsTo: 'education', compulsory: true },
        { key: 'workHistory', label: 'Work history', type: 'textarea', mapsTo: 'workHistory', compulsory: true },
        { key: 'resume', label: 'Resume', type: 'text', mapsTo: 'resumeUrl', compulsory: true },
        { key: 'authorizedToWork', label: 'Authorized to work', type: 'select', options: ['Yes', 'No'], mapsTo: 'authorizedToWork', compulsory: true },
        { key: 'requiresSponsorship', label: 'Requires sponsorship', type: 'select', options: ['Yes', 'No'], mapsTo: 'requiresSponsorship', compulsory: true },
        { key: 'previouslyEmployed', label: 'Previously employed', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.previouslyEmployed', compulsory: true },
        { key: 'relative', label: 'Relative at company', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.relative', compulsory: true },
        { key: 'marketingConsent', label: 'Marketing consent', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.marketingConsent', compulsory: true },
        { key: 'over18', label: 'Over 18', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.over18', compulsory: true }
      ].concat(CORE_CONTACT())
    },
    {
      id: 'greenhouse',
      label: 'Greenhouse',
      hosts: ['boards.greenhouse.io', 'greenhouse.io', 'job-boards.greenhouse.io'],
      requiredFields: BASELINE_ATS().concat([
        { key: 'location', label: 'Location / country', type: 'text', mapsTo: 'location', compulsory: true },
        { key: 'linkedin', label: 'LinkedIn', type: 'text', mapsTo: 'linkedin', compulsory: true },
        { key: 'priorEmployer', label: 'Prior employer at company', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.priorEmployer', compulsory: true },
        { key: 'whyJoin', label: 'Why join', type: 'textarea', mapsTo: 'customAnswers.whyJoin', compulsory: true }
      ])
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      hosts: ['linkedin.com', 'www.linkedin.com'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'linkedin', label: 'LinkedIn profile URL', type: 'text', mapsTo: 'linkedin', compulsory: true },
        { key: 'resumeSummary', label: 'Resume summary / Easy Apply note', type: 'textarea', mapsTo: 'resumeSummary', compulsory: true },
        { key: 'coverLetter', label: 'Cover / screening answer', type: 'textarea', mapsTo: 'coverLetter', compulsory: true },
        { key: 'authorizedToWork', label: 'Authorized to work', type: 'select', options: ['Yes', 'No'], mapsTo: 'authorizedToWork', compulsory: true },
        { key: 'requiresSponsorship', label: 'Requires sponsorship', type: 'select', options: ['Yes', 'No'], mapsTo: 'requiresSponsorship', compulsory: true }
      ]),
      note: 'Account-first: LinkedIn session required; Easy Apply screening via customAnswers.'
    },
    {
      id: 'naukrigulf',
      label: 'NaukriGulf',
      hosts: ['naukrigulf.com', 'www.naukrigulf.com'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'location', label: 'UAE location', type: 'text', mapsTo: 'location', compulsory: true },
        { key: 'employed', label: 'Currently employed', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.employed', compulsory: true },
        { key: 'industry', label: 'Industry', type: 'text', mapsTo: 'customAnswers.industry', compulsory: true },
        { key: 'resumeSummary', label: 'Profile summary (completeness gate)', type: 'textarea', mapsTo: 'resumeSummary', compulsory: true }
      ]),
      note: 'Profile completeness gate on NaukriGulf account.'
    },
    {
      id: 'swooped',
      label: 'Swooped',
      hosts: ['swooped.co', 'www.swooped.co', 'app.swooped.co'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'resumeStyle', label: 'Resume style', type: 'text', mapsTo: 'customAnswers.resumeStyle', compulsory: true },
        { key: 'salaryOte', label: 'Salary / OTE', type: 'text', mapsTo: 'customAnswers.expectedSalary', compulsory: true },
        { key: 'locatedKSA', label: 'Located in KSA', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.locatedKSA', compulsory: true },
        { key: 'workAuth', label: 'Work auth basis', type: 'text', mapsTo: 'authorizedToWork', compulsory: true },
        { key: 'ofac', label: 'OFAC', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.OFAC', compulsory: true }
      ])
    },
    {
      id: 'jooble',
      label: 'Jooble',
      hosts: ['jooble.org', 'www.jooble.org'],
      requiredFields: CORE_CONTACT().concat([
        { key: 'resumeStyle', label: 'Resume style', type: 'text', mapsTo: 'customAnswers.resumeStyle', compulsory: true },
        { key: 'salaryOte', label: 'Salary / OTE', type: 'text', mapsTo: 'customAnswers.expectedSalary', compulsory: true },
        { key: 'locatedKSA', label: 'Located in KSA', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.locatedKSA', compulsory: true },
        { key: 'workAuth', label: 'Work auth basis', type: 'text', mapsTo: 'authorizedToWork', compulsory: true },
        { key: 'ofac', label: 'OFAC', type: 'select', options: ['Yes', 'No'], mapsTo: 'customAnswers.OFAC', compulsory: true }
      ])
    },
    {
      id: 'ashby',
      label: 'Ashby',
      hosts: ['jobs.ashbyhq.com', 'ashbyhq.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'lever',
      label: 'Lever',
      hosts: ['jobs.lever.co', 'lever.co'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'cats',
      label: 'CATS',
      hosts: ['catsone.com', 'www.catsone.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'recruitee',
      label: 'Recruitee',
      hosts: ['recruitee.com', 'www.recruitee.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'efinancialcareers',
      label: 'eFinancialCareers',
      hosts: ['efinancialcareers.com', 'www.efinancialcareers.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'workday',
      label: 'Workday',
      hosts: ['myworkdayjobs.com', 'workdayjobs.com', 'workday.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'workable',
      label: 'Workable',
      hosts: ['apply.workable.com', 'jobs.workable.com', 'workable.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'smartrecruiters',
      label: 'SmartRecruiters',
      hosts: ['jobs.smartrecruiters.com', 'smartrecruiters.com'],
      requiredFields: BASELINE_ATS()
    },
    {
      id: 'generic',
      label: 'Generic / fallback',
      hosts: [],
      requiredFields: CORE_CONTACT().concat([
        { key: 'resumeSummary', label: 'Resume summary', type: 'textarea', mapsTo: 'resumeSummary', compulsory: true },
        { key: 'coverLetter', label: 'Cover letter', type: 'textarea', mapsTo: 'coverLetter', compulsory: true }
      ])
    }
  ];

  /** Demo answers written into source profiles when seeding Mock. */
  var MOCK_SOURCE_ANSWERS = {
    teamtailor: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      yearsExperience: '6-9',
      currentSalary: '25000',
      noticePeriod: 'Onspot',
      nationality: 'United Arab Emirates',
      basedInRiyadh: 'No',
      largestTeamSize: '11-20',
      educationalCertificate: 'No',
      previouslyRecruited: 'full-process',
      computerToolsRating: 'proficient',
      whyHire:
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner on measurable quality of hire.'
    },
    indeed: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      phoneCountry: '+971',
      city: 'Dubai',
      highestEducation: "Bachelor's",
      gender: 'Male',
      conflictOfInterest: 'No',
      pif: 'No',
      linkedin: 'https://linkedin.com/in/alexrivera',
      dob: '',
      expectedSalary: '25000',
      currentSalary: '25000',
      salutation: 'Mr.',
      nationality: 'United Arab Emirates',
      yearsExperience: '6',
      workAuth: 'Yes',
      sponsorship: 'No',
      drivingLicense: 'Yes',
      ownCar: 'Yes',
      coverLetter:
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner with the team on measurable quality of hire.'
    },
    glassdoor: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      phoneCountry: '+971',
      country: 'United Arab Emirates',
      postcode: '00000',
      city: 'Dubai',
      street: '123 Example St',
      resume: 'https://alexrivera.dev/resume.pdf'
    },
    icims: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      nationality: 'United Arab Emirates',
      gender: 'Male',
      noticePeriod: 'Onspot',
      education: "Bachelor's / B.S. Computer Science, State University (2018)",
      workHistory:
        'Senior Software Engineer @ Acme Corp (2021–present): led hiring tooling and form automation.\nSoftware Engineer @ StartupXYZ (2018–2021): shipped customer-facing dashboards.',
      resume: 'https://alexrivera.dev/resume.pdf',
      authorizedToWork: 'Yes',
      requiresSponsorship: 'No',
      previouslyEmployed: 'No',
      relative: 'No',
      marketingConsent: 'No',
      over18: 'Yes'
    },
    greenhouse: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      resume: 'https://alexrivera.dev/resume.pdf',
      coverLetter:
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner with the team on measurable quality of hire.',
      authorizedToWork: 'Yes',
      requiresSponsorship: 'No',
      location: 'Dubai, United Arab Emirates',
      linkedin: 'https://linkedin.com/in/alexrivera',
      priorEmployer: 'No',
      whyJoin:
        'I want to help harden Apply-start reliability and partner on measurable quality of hire.'
    },
    linkedin: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      linkedin: 'https://linkedin.com/in/alexrivera',
      resumeSummary:
        'Product-minded engineer with 6+ years shipping reliable web platforms across the UAE.',
      coverLetter:
        'I bring six years of shipping hiring and application workflows with clear metrics.',
      authorizedToWork: 'Yes',
      requiresSponsorship: 'No'
    },
    naukrigulf: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      location: 'Dubai, United Arab Emirates',
      employed: 'Yes',
      industry: 'Information Technology',
      resumeSummary:
        'Product-minded engineer with 6+ years shipping reliable web platforms across the UAE.'
    },
    swooped: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      resumeStyle: 'standard',
      salaryOte: '25000',
      locatedKSA: 'No',
      workAuth: 'Yes',
      ofac: 'No'
    },
    jooble: {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '501234567',
      resumeStyle: 'standard',
      salaryOte: '25000',
      locatedKSA: 'No',
      workAuth: 'Yes',
      ofac: 'No'
    }
  };

  var BASELINE_MOCK = {
    firstName: 'Alex',
    lastName: 'Rivera',
    email: 'alex.rivera@example.com',
    phone: '501234567',
    resume: 'https://alexrivera.dev/resume.pdf',
    coverLetter:
      'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner with the team on measurable quality of hire.',
    authorizedToWork: 'Yes',
    requiresSponsorship: 'No'
  };

  ['ashby', 'lever', 'cats', 'recruitee', 'efinancialcareers', 'workday', 'workable', 'smartrecruiters', 'generic'].forEach(
    function (id) {
      if (!MOCK_SOURCE_ANSWERS[id]) {
        MOCK_SOURCE_ANSWERS[id] = Object.assign({}, BASELINE_MOCK);
        if (id === 'generic') {
          MOCK_SOURCE_ANSWERS[id].resumeSummary =
            'Product-minded engineer with 6+ years shipping reliable web platforms across the UAE.';
        }
      }
    }
  );

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (result) {
        resolve(result || {});
      });
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set(obj, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function getSourceDef(sourceId) {
    var id = String(sourceId || '').toLowerCase();
    if (!id || id === 'default') id = 'generic';
    for (var i = 0; i < SOURCE_CATALOG.length; i++) {
      if (SOURCE_CATALOG[i].id === id) return SOURCE_CATALOG[i];
    }
    return null;
  }

  function listSources() {
    return SOURCE_CATALOG.map(function (s) {
      return {
        id: s.id,
        label: s.label,
        hosts: s.hosts || [],
        note: s.note || '',
        requiredCount: (s.requiredFields || []).filter(function (f) {
          return f.compulsory !== false;
        }).length
      };
    });
  }

  function detectSourceIdFromUrl(url) {
    if (global.FillApplyTypes && global.FillApplyTypes.detectSourceId) {
      var id = global.FillApplyTypes.detectSourceId(url);
      if (id && id !== 'default') return id;
    }
    var host = '';
    try {
      host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_e) {
      host = String(url || '').toLowerCase();
    }
    for (var i = 0; i < SOURCE_CATALOG.length; i++) {
      var s = SOURCE_CATALOG[i];
      var hosts = s.hosts || [];
      for (var h = 0; h < hosts.length; h++) {
        var hh = String(hosts[h]).replace(/^www\./, '').toLowerCase();
        if (!hh) continue;
        if (host === hh || host.endsWith('.' + hh) || host.indexOf(hh) !== -1) return s.id;
      }
    }
    return 'generic';
  }

  async function getAllSourceProfiles() {
    var raw = await storageGet([PROFILES_KEY]);
    var store = raw[PROFILES_KEY];
    return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  }

  async function getSelectedSourceId() {
    var raw = await storageGet([SELECTED_KEY]);
    var v = raw[SELECTED_KEY];
    if (v == null || v === '' || v === 'null' || v === 'none') return null;
    return String(v);
  }

  async function setSelectedSourceId(sourceId) {
    var next = sourceId == null || sourceId === '' || sourceId === 'none' ? null : String(sourceId);
    await storageSet({ [SELECTED_KEY]: next });
    return next;
  }

  function emptyShell(def) {
    return {
      sourceId: def.id,
      label: def.label,
      answers: {},
      updatedAt: 0
    };
  }

  async function ensureSourceProfileShells() {
    var store = await getAllSourceProfiles();
    var changed = false;
    SOURCE_CATALOG.forEach(function (def) {
      if (!store[def.id]) {
        store[def.id] = emptyShell(def);
        changed = true;
      } else {
        if (!store[def.id].answers || typeof store[def.id].answers !== 'object') {
          store[def.id].answers = {};
          changed = true;
        }
        if (!store[def.id].label) {
          store[def.id].label = def.label;
          changed = true;
        }
        if (!store[def.id].sourceId) {
          store[def.id].sourceId = def.id;
          changed = true;
        }
      }
    });
    if (changed) await storageSet({ [PROFILES_KEY]: store });
    return store;
  }

  async function getSourceProfile(sourceId) {
    var def = getSourceDef(sourceId);
    if (!def) return null;
    var store = await ensureSourceProfileShells();
    return store[def.id] || emptyShell(def);
  }

  async function saveSourceProfileAnswers(sourceId, answers) {
    var def = getSourceDef(sourceId);
    if (!def) throw new Error('Unknown source: ' + sourceId);
    var store = await ensureSourceProfileShells();
    var prev = store[def.id] || emptyShell(def);
    var nextAnswers = Object.assign({}, prev.answers || {}, answers || {});
    Object.keys(nextAnswers).forEach(function (k) {
      if (nextAnswers[k] == null) delete nextAnswers[k];
    });
    store[def.id] = {
      sourceId: def.id,
      label: def.label,
      answers: nextAnswers,
      updatedAt: Date.now()
    };
    await storageSet({ [PROFILES_KEY]: store });
    return store[def.id];
  }

  async function clearSourceProfileAnswers(sourceId) {
    var def = getSourceDef(sourceId);
    if (!def) throw new Error('Unknown source: ' + sourceId);
    var store = await ensureSourceProfileShells();
    store[def.id] = {
      sourceId: def.id,
      label: def.label,
      answers: {},
      updatedAt: Date.now()
    };
    await storageSet({ [PROFILES_KEY]: store });
    return store[def.id];
  }

  /** Seed empty compulsory shells for all sources (do not invent Zahid screening). */
  async function seedEmptySourceShells() {
    var store = {};
    SOURCE_CATALOG.forEach(function (def) {
      store[def.id] = emptyShell(def);
    });
    await storageSet({ [PROFILES_KEY]: store });
    return store;
  }

  /** Fill all source profiles with Mock demo answers (Reset Mock / demo). */
  async function seedMockSourceProfiles() {
    var store = await ensureSourceProfileShells();
    var now = Date.now();
    SOURCE_CATALOG.forEach(function (def) {
      var answers = Object.assign({}, MOCK_SOURCE_ANSWERS[def.id] || BASELINE_MOCK);
      store[def.id] = {
        sourceId: def.id,
        label: def.label,
        answers: answers,
        updatedAt: now
      };
    });
    await storageSet({ [PROFILES_KEY]: store });
    return store;
  }

  function resolveMapsTo(baseProfile, mapsTo) {
    if (!mapsTo || !baseProfile) return null;
    var path = String(mapsTo);
    if (path.indexOf('customAnswers.') === 0) {
      var ck = path.slice('customAnswers.'.length);
      var ca = baseProfile.customAnswers || {};
      if (!isBlank(ca[ck])) return String(ca[ck]).trim();
      // Also try common label aliases on customAnswers
      var aliases = Object.keys(ca);
      for (var i = 0; i < aliases.length; i++) {
        if (String(aliases[i]).toLowerCase() === ck.toLowerCase() && !isBlank(ca[aliases[i]])) {
          return String(ca[aliases[i]]).trim();
        }
      }
      // Known friendly labels
      var labelMap = {
        yearsExperience: ['Years of experience', 'yearsExperience'],
        currentSalary: ['Current Salary', 'Current monthly salary', 'currentSalary'],
        expectedSalary: ['Expected Salary', 'Salary expectation', 'expectedSalary'],
        basedInRiyadh: ['Based in Riyadh', 'Currently based in Riyadh?', 'based in Riyadh'],
        largestTeamSize: ['Largest team size', 'largestTeamSize'],
        educationalCertificate: ['educational certificate', 'شهادة تربوية'],
        previouslyRecruited: ['Previously recruited/hired', 'previously recruited', 'recruited'],
        computerToolsRating: ['Computer tools / operational data', 'computer tools', 'rate your ability'],
        highestEducation: ['Highest Education'],
        conflictOfInterest: ['Conflict of interest'],
        PIF: ['PIF'],
        salutation: ['Salutation'],
        drivingLicense: ['Driving License'],
        ownCar: ['Do you have your own car?', 'Do you ahve your own car?'],
        previouslyEmployed: ['Previously worked at company'],
        relative: ['Relative at company'],
        marketingConsent: ['Marketing consent'],
        over18: ['Over 18'],
        priorEmployer: ['Previously worked at company'],
        whyJoin: ['Why should we hire you', 'why should we hire'],
        employed: ['Currently employed', 'employed'],
        industry: ['Industry'],
        resumeStyle: ['Resume style'],
        locatedKSA: ['Located in KSA', 'Located in Saudi Arabia'],
        OFAC: ['OFAC'],
        dob: ['Date of birth', 'DOB']
      };
      var labs = labelMap[ck] || [];
      for (var L = 0; L < labs.length; L++) {
        if (!isBlank(ca[labs[L]])) return String(ca[labs[L]]).trim();
      }
      return null;
    }
    if (!isBlank(baseProfile[path])) return String(baseProfile[path]).trim();
    return null;
  }

  function optionDisplayValue(field, stored) {
    if (isBlank(stored)) return '';
    var opts = field && field.options;
    if (!Array.isArray(opts)) return String(stored);
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      if (o && typeof o === 'object') {
        if (String(o.value) === String(stored)) return o.label || o.value;
        if (String(o.label) === String(stored)) return o.label;
      } else if (String(o) === String(stored)) {
        return String(o);
      }
    }
    return String(stored);
  }

  /**
   * Resolve the effective answer for a required field:
   * source answers win, else mapsTo from base profile.
   */
  function resolveFieldValue(field, sourceAnswers, baseProfile) {
    sourceAnswers = sourceAnswers || {};
    if (!isBlank(sourceAnswers[field.key])) {
      return optionDisplayValue(field, sourceAnswers[field.key]);
    }
    if (field.mapsTo) {
      var fromBase = resolveMapsTo(baseProfile, field.mapsTo);
      if (!isBlank(fromBase)) return fromBase;
    }
    return '';
  }

  function completeness(sourceId, baseProfile, sourceProfile) {
    var def = getSourceDef(sourceId);
    if (!def) {
      return { complete: true, filled: 0, total: 0, missing: [], label: sourceId };
    }
    var answers = (sourceProfile && sourceProfile.answers) || {};
    var missing = [];
    var filled = 0;
    var total = 0;
    (def.requiredFields || []).forEach(function (f) {
      if (f.compulsory === false) return;
      total++;
      var v = resolveFieldValue(f, answers, baseProfile);
      if (isBlank(v)) missing.push(f.key);
      else filled++;
    });
    return {
      complete: missing.length === 0,
      filled: filled,
      total: total,
      missing: missing,
      label: def.label,
      sourceId: def.id
    };
  }

  async function isSourceProfileComplete(sourceId, baseProfileOpt) {
    if (!sourceId) return true;
    var base = baseProfileOpt;
    if (!base && global.FillApplyProfile && global.FillApplyProfile.getProfile) {
      base = await global.FillApplyProfile.getProfile();
    }
    var sp = await getSourceProfile(sourceId);
    return completeness(sourceId, base, sp).complete;
  }

  async function getCompleteness(sourceId, baseProfileOpt) {
    var base = baseProfileOpt;
    if (!base && global.FillApplyProfile && global.FillApplyProfile.getProfile) {
      base = await global.FillApplyProfile.getProfile();
    }
    var sp = await getSourceProfile(sourceId);
    return completeness(sourceId, base, sp);
  }

  /**
   * Merge source answers over base profile.
   * Source answers apply via mapsTo into profile keys / customAnswers.
   */
  function mergeSourceOverProfile(baseProfile, sourceAnswers, sourceId) {
    var base = Object.assign({}, baseProfile || {});
    base.customAnswers = Object.assign({}, (baseProfile && baseProfile.customAnswers) || {});
    base.customQA = Array.isArray(baseProfile && baseProfile.customQA)
      ? baseProfile.customQA.slice()
      : [];
    var def = getSourceDef(sourceId);
    var answers = sourceAnswers || {};
    if (!def) return base;

    (def.requiredFields || []).forEach(function (f) {
      var raw = answers[f.key];
      if (isBlank(raw)) return;
      var display = optionDisplayValue(f, raw);
      var mapsTo = f.mapsTo || f.key;
      if (mapsTo.indexOf('customAnswers.') === 0) {
        var ck = mapsTo.slice('customAnswers.'.length);
        base.customAnswers[ck] = display;
        base.customAnswers[f.key] = display;
        // Keep a friendly label copy when select has full text
        if (f.label) base.customAnswers[f.label] = display;
        var qaHit = false;
        for (var i = 0; i < base.customQA.length; i++) {
          if (base.customQA[i] && String(base.customQA[i].question) === f.label) {
            base.customQA[i].answer = display;
            qaHit = true;
            break;
          }
        }
        if (!qaHit && f.label) {
          base.customQA.push({ question: f.label, answer: display });
        }
      } else {
        base[mapsTo] = display;
      }
    });

    // Also apply any extra answer keys not in catalog
    Object.keys(answers).forEach(function (k) {
      if (isBlank(answers[k])) return;
      if (base[k] == null || isBlank(base[k])) {
        // only set unknown keys into customAnswers
        var known = (def.requiredFields || []).some(function (f) {
          return f.key === k;
        });
        if (!known) base.customAnswers[k] = answers[k];
      }
    });

    return base;
  }

  async function getEffectiveProfile(baseProfileOpt, sourceIdOpt) {
    var base =
      baseProfileOpt ||
      (global.FillApplyProfile && global.FillApplyProfile.getProfile
        ? await global.FillApplyProfile.getProfile()
        : {});
    var selected =
      sourceIdOpt !== undefined ? sourceIdOpt : await getSelectedSourceId();
    if (!selected) return base;
    var sp = await getSourceProfile(selected);
    return mergeSourceOverProfile(base, (sp && sp.answers) || {}, selected);
  }

  /**
   * Copy mapsTo-resolved values from active base profile into source answers.
   */
  async function copyFromActiveProfile(sourceId) {
    var def = getSourceDef(sourceId);
    if (!def) throw new Error('Unknown source: ' + sourceId);
    var base =
      global.FillApplyProfile && global.FillApplyProfile.getProfile
        ? await global.FillApplyProfile.getProfile()
        : {};
    var answers = {};
    (def.requiredFields || []).forEach(function (f) {
      var v = resolveMapsTo(base, f.mapsTo || f.key);
      if (isBlank(v)) return;
      var chosen = null;
      var opts = f.options;
      if (Array.isArray(opts)) {
        for (var i = 0; i < opts.length; i++) {
          var o = opts[i];
          if (o && typeof o === 'object') {
            if (String(o.label) === String(v) || String(o.value) === String(v)) {
              chosen = o.value;
              break;
            }
          } else if (String(o) === String(v)) {
            chosen = o;
            break;
          }
        }
      }
      answers[f.key] = chosen != null ? chosen : v;
    });
    return saveSourceProfileAnswers(sourceId, answers);
  }

  /**
   * Stable sort jobs by sourceId then original order.
   */
  function sortJobsBySource(jobs) {
    if (!Array.isArray(jobs)) return [];
    return jobs
      .map(function (j, idx) {
        return { job: j, idx: idx };
      })
      .sort(function (a, b) {
        var sa = String(
          (a.job && (a.job.sourceId || a.job.ats)) ||
            detectSourceIdFromUrl(a.job && a.job.url) ||
            'generic'
        ).toLowerCase();
        var sb = String(
          (b.job && (b.job.sourceId || b.job.ats)) ||
            detectSourceIdFromUrl(b.job && b.job.url) ||
            'generic'
        ).toLowerCase();
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        return a.idx - b.idx;
      })
      .map(function (x) {
        var j = x.job;
        if (j && !j.sourceId) {
          j = Object.assign({}, j, {
            sourceId: detectSourceIdFromUrl(j.url)
          });
        }
        return j;
      });
  }

  /**
   * Gate Start when a source is selected and incomplete.
   * Returns { ok: true } or { ok: false, error, completeness, sourceId }.
   */
  async function assertSelectedSourceComplete(baseProfileOpt) {
    var selected = await getSelectedSourceId();
    if (!selected) return { ok: true, selectedSourceId: null };
    var base = baseProfileOpt;
    if (!base && global.FillApplyProfile && global.FillApplyProfile.getProfile) {
      base = await global.FillApplyProfile.getProfile();
    }
    var c = await getCompleteness(selected, base);
    if (c.complete) return { ok: true, selectedSourceId: selected, completeness: c };
    return {
      ok: false,
      selectedSourceId: selected,
      completeness: c,
      error:
        'Complete the ' +
        (c.label || selected) +
        ' source profile (' +
        c.filled +
        '/' +
        c.total +
        ') in App Settings before Start.'
    };
  }

  global.FillApplySourceProfiles = {
    PROFILES_KEY: PROFILES_KEY,
    SELECTED_KEY: SELECTED_KEY,
    SOURCE_CATALOG: SOURCE_CATALOG,
    MOCK_SOURCE_ANSWERS: MOCK_SOURCE_ANSWERS,
    listSources: listSources,
    getSourceDef: getSourceDef,
    detectSourceIdFromUrl: detectSourceIdFromUrl,
    getAllSourceProfiles: getAllSourceProfiles,
    getSelectedSourceId: getSelectedSourceId,
    setSelectedSourceId: setSelectedSourceId,
    ensureSourceProfileShells: ensureSourceProfileShells,
    getSourceProfile: getSourceProfile,
    saveSourceProfileAnswers: saveSourceProfileAnswers,
    clearSourceProfileAnswers: clearSourceProfileAnswers,
    seedEmptySourceShells: seedEmptySourceShells,
    seedMockSourceProfiles: seedMockSourceProfiles,
    resolveFieldValue: resolveFieldValue,
    completeness: completeness,
    isSourceProfileComplete: isSourceProfileComplete,
    getCompleteness: getCompleteness,
    mergeSourceOverProfile: mergeSourceOverProfile,
    getEffectiveProfile: getEffectiveProfile,
    copyFromActiveProfile: copyFromActiveProfile,
    sortJobsBySource: sortJobsBySource,
    assertSelectedSourceComplete: assertSelectedSourceComplete,
    optionDisplayValue: optionDisplayValue
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
