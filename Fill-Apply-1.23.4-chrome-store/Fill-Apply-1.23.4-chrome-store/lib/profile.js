/**
 * Multi-profile applicant storage + chrome.storage.local helpers.
 * Keys:
 *   fillApply.profiles        — { [profileId]: { id, name, createdAt, updatedAt, ...fields } }
 *   fillApply.activeProfileId — string
 * Legacy single profile (fillApply.profile) migrates into a "Mock" profile when multi store is empty.
 * getProfile() / saveProfile() always read/write the active profile only.
 * Attaches API to globalThis.FillApplyProfile (classic script; no bundler).
 */
(function (global) {
  'use strict';

  const LEGACY_PROFILE_KEY = 'fillApply.profile';
  const PROFILES_KEY = 'fillApply.profiles';
  const ACTIVE_PROFILE_ID_KEY = 'fillApply.activeProfileId';

  /**
   * Every field an application form is known to ask for, in one shape.
   *
   * The list is wider than a CV because ATS forms split what a CV writes as
   * prose: a résumé says "MBA Finance, Virtual University of Pakistan, 2018"
   * while Workday asks for school, degree, field of study and graduation year
   * as four separate controls, each with its own dropdown.
   */
  const DEFAULT_PROFILE = {
    // Identity
    salutation: '',
    firstName: '',
    middleName: '',
    lastName: '',
    preferredName: '',
    fullName: '',
    headline: '',
    email: '',
    emailConfirm: '',
    confirm_email: '',
    retype_email: '',
    // Apply-time career signup/login only (import preserves; export strips). Never invent.
    password: '',
    passwordConfirm: '',
    confirm_password: '',
    retype_password: '',
    phone: '',
    phoneCountry: '',
    phoneCountryCode: '',
    phoneFull: '',
    phoneE164: '',
    dateOfBirth: '',
    nationality: '',
    gender: '',

    // Location
    location: '',
    street: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    province: '',
    country: '',
    addressCountry: '',
    zip: '',
    postcode: '',
    // Honorific (Mr. / Ms.) — distinct from currentTitle
    title: '',

    // Availability and preferences
    noticePeriod: '',
    availableFrom: '',
    willingToRelocate: '',
    remotePreference: '',
    referralSource: '',
    driversLicense: '',

    // Links
    linkedin: '',
    portfolio: '',
    website: '',
    github: '',
    resumeUrl: '',
    coverUrl: '',

    // Professional
    currentTitle: '',
    currentCompany: '',
    yearsExperience: '',
    skills: '',
    languages: '',
    certifications: '',
    references: '',

    // Education
    highestEducation: '',
    school: '',
    degree: '',
    fieldOfStudy: '',
    graduationYear: '',
    gpa: '',

    // Compensation
    currentSalary: '',
    expectedSalary: '',
    salaryText: '',
    salaryCurrency: '',

    // Work authorization
    authorizedToWork: 'Yes',
    requiresSponsorship: 'No',

    // Long form
    resumeSummary: '',
    workHistory: '',
    education: '',
    coverLetter: '',

    // Structured history, for forms that ask for one row per role or degree
    experienceEntries: [],
    educationEntries: [],

    customQA: [],
    customAnswers: {},
    applicationQuestions: {}
  };

  /**
   * Fields worth having before applying anywhere, grouped by what breaks
   * without them. Used to tell the applicant what is still missing instead of
   * discovering it mid-application — the engine never invents these.
   */
  const PROFILE_COMPLETENESS = [
    {
      group: 'Identity',
      keys: ['firstName', 'lastName', 'email', 'phone', 'phoneCountry', 'nationality']
    },
    { group: 'Location', keys: ['city', 'country', 'zip'] },
    { group: 'Work authorization', keys: ['authorizedToWork', 'requiresSponsorship'] },
    { group: 'Professional', keys: ['currentTitle', 'yearsExperience', 'skills', 'linkedin'] },
    {
      group: 'Education',
      keys: ['highestEducation', 'school', 'degree', 'fieldOfStudy', 'graduationYear']
    },
    { group: 'Availability', keys: ['noticePeriod', 'willingToRelocate'] },
    { group: 'Compensation', keys: ['currentSalary', 'expectedSalary'] },
    { group: 'Documents & long form', keys: ['resumeSummary', 'workHistory', 'coverLetter'] }
  ];

  const SAMPLE_PROFILE = {
    firstName: 'Alex',
    lastName: 'Rivera',
    fullName: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    phone: '501234567',
    phoneCountry: '+971',
    location: 'Dubai, United Arab Emirates',
    street: 'Sheikh Zayed Road',
    city: 'Dubai',
    state: 'Dubai',
    country: 'United Arab Emirates',
    zip: '00000',
    postcode: '00000',
    nationality: 'United Arab Emirates',
    gender: 'Male',
    noticePeriod: 'I can start immediately',
    linkedin: 'https://linkedin.com/in/alexrivera',
    portfolio: 'https://alexrivera.dev',
    website: 'https://alexrivera.dev',
    github: 'https://github.com/alexrivera',
    resumeUrl: 'https://alexrivera.dev/resume.pdf',
    coverUrl: '',
    resumeSummary:
      'Product-minded engineer with 6+ years shipping reliable web platforms across the UAE. Strong in JavaScript, TypeScript, React, and Node.js; comfortable owning hiring tooling and form workflows end to end.',
    workHistory:
      'Senior Software Engineer @ Acme Corp (2021–present): led hiring tooling and form automation.\nSoftware Engineer @ StartupXYZ (2018–2021): shipped customer-facing dashboards.',
    education: "Bachelor's / B.S. Computer Science, State University (2018)",
    coverLetter:
      'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner with the team on measurable quality of hire.',
    authorizedToWork: 'Yes',
    requiresSponsorship: 'No',
    customQA: [
      { question: 'Expected Salary', answer: '25000 AED' },
      { question: 'Salary expectation', answer: '25000 AED' },
      { question: 'Current monthly salary', answer: '25000 AED' },
      { question: 'Notice period', answer: 'I can start immediately' },
      { question: 'Years of experience', answer: '6' },
      { question: 'Highest Education', answer: "Bachelor's" },
      { question: 'Salutation', answer: 'Mr.' },
      { question: 'Driving License', answer: 'Yes' },
      { question: 'Located in UAE', answer: 'Yes' },
      { question: 'Located in Saudi Arabia', answer: 'No' },
      { question: 'Located in KSA', answer: 'No' },
      { question: 'Primary work location', answer: 'Dubai' },
      { question: 'Over 18', answer: 'Yes' },
      { question: 'Conflict of interest', answer: 'No' },
      { question: 'PIF', answer: 'No' },
      { question: 'Previously worked at company', answer: 'No' },
      { question: 'OFAC', answer: 'No' },
      { question: 'Willing to work EST', answer: 'Yes' },
      { question: 'Authorized to work', answer: 'Yes' },
      { question: 'Requires sponsorship', answer: 'No' },
      { question: 'Work authorization', answer: 'Yes' },
      { question: 'Sponsorship', answer: 'No' },
      { question: 'Citizenship', answer: 'United Arab Emirates' },
      { question: 'Based in Riyadh', answer: 'No' },
      { question: 'Currently based in Riyadh?', answer: 'No' },
      { question: 'Largest team size', answer: '11-20' },
      { question: 'شهادة تربوية', answer: 'No' },
      { question: 'educational certificate', answer: 'No' },
      {
        question: 'Previously recruited/hired',
        answer: 'Yes — managed full recruitment process end to end'
      },
      {
        question: 'Computer tools / operational data',
        answer: 'I am proficient with most computer tools and can work independently with operational data'
      },
      {
        question: 'Why should we hire you',
        answer:
          'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner on measurable quality of hire.'
      },
      { question: 'Willing to relocate', answer: 'Yes' },
      { question: 'Do you have your own car?', answer: 'Yes' },
      { question: 'years UAE Contracting experience', answer: '3' }
    ],
    customAnswers: {
      'Expected Salary': '25000 AED',
      'Salary expectation': '25000 AED',
      'Current monthly salary': '25000 AED',
      'Current Salary': '25000 AED',
      currentSalary: '25000 AED',
      'Expected Salary / salary expectation': '25000 AED',
      'Notice period': 'I can start immediately',
      'Years of experience': '6',
      yearsExperience: '6',
      'Highest Education': "Bachelor's",
      Salutation: 'Mr.',
      'Driving License': 'Yes',
      'Located in UAE': 'Yes',
      'Located in Saudi Arabia': 'No',
      'Located in KSA': 'No',
      'Located in Saudi Arabia / KSA': 'No',
      'Primary work location': 'Dubai',
      'Over 18': 'Yes',
      'Conflict of interest': 'No',
      PIF: 'No',
      'Previously worked at company': 'No',
      OFAC: 'No',
      'Willing to work EST': 'Yes',
      'Authorized to work': 'Yes',
      'Requires sponsorship': 'No',
      'Work authorization': 'Yes',
      Sponsorship: 'No',
      Citizenship: 'United Arab Emirates',
      nationality: 'United Arab Emirates',
      'Based in Riyadh': 'No',
      'Currently based in Riyadh?': 'No',
      'based in Riyadh': 'No',
      'Largest team size': '11-20',
      largestTeamSize: '11-20',
      'شهادة تربوية': 'No',
      'educational certificate': 'No',
      'Previously recruited/hired': 'Yes — managed full recruitment process end to end',
      'previously recruited': 'Yes — managed full recruitment process end to end',
      recruited: 'Yes — managed full recruitment process end to end',
      'hired members': 'Yes — managed full recruitment process end to end',
      'Computer tools / operational data':
        'I am proficient with most computer tools and can work independently with operational data',
      'computer tools':
        'I am proficient with most computer tools and can work independently with operational data',
      'operational data':
        'I am proficient with most computer tools and can work independently with operational data',
      'rate your ability':
        'I am proficient with most computer tools and can work independently with operational data',
      'Why should we hire you':
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner on measurable quality of hire.',
      'why should we hire':
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner on measurable quality of hire.',
      'first 6 months':
        'Map the apply funnel, harden Apply-start for Teamtailor modals, and publish completion-rate metrics with the hiring team.',
      'Do you ahve your own car?': 'Yes',
      'Do you have your own car?': 'Yes',
      'years UAE Contracting experience': '3',
      uaeContractingYears: '3',
      // Teamtailor / source-profile short codes (Mock demo)
      '0-2': '0-2',
      '3-5': '3-5',
      '6-9': '6-9',
      '10+': '10+',
      Onspot: 'Onspot',
      'notice period Onspot': 'Onspot',
      basedInRiyadh: 'No',
      educationalCertificate: 'No',
      previouslyRecruited: 'full-process',
      computerToolsRating: 'proficient',
      whyHire:
        'I bring six years of shipping hiring and application workflows with clear metrics (time-to-fill, completion rate). In the first six months I would map your funnel, harden Apply-start reliability, and partner on measurable quality of hire.',
      expectedSalary: '25000',
      highestEducation: "Bachelor's",
      conflictOfInterest: 'No',
      salutation: 'Mr.',
      drivingLicense: 'Yes',
      ownCar: 'Yes',
      previouslyEmployed: 'No',
      relative: 'No',
      marketingConsent: 'No',
      over18: 'Yes',
      priorEmployer: 'No',
      whyJoin:
        'I want to help harden Apply-start reliability and partner on measurable quality of hire.',
      employed: 'Yes',
      industry: 'Information Technology',
      resumeStyle: 'standard',
      locatedKSA: 'No',
      'Current monthly salary': '25000'
    }
  };

  /**
   * Public built-in Zahid shell (empty / generic). Real applicant PII is NOT
   * shipped in the Chrome Web Store package — import it via Options → Import
   * Profile from a private fill-apply-profile JSON (client handoff only).
   * Create / Reset Zahid restores this empty shell; it never auto-runs on update.
   */
  const ZAHID_GENERAL_PROFILE = {
    name: 'Zahid',
    salutation: '',
    firstName: '',
    middleName: '',
    lastName: '',
    preferredName: '',
    fullName: '',
    headline: '',
    email: '',
    phone: '',
    phoneCountry: '',
    phoneCountryCode: '',
    phoneFull: '',
    phoneE164: '',
    dateOfBirth: '',
    location: '',
    street: '',
    city: '',
    state: '',
    country: '',
    zip: '',
    postcode: '',
    nationality: '',
    gender: '',
    noticePeriod: '',
    availableFrom: '',
    willingToRelocate: '',
    remotePreference: '',
    referralSource: '',
    driversLicense: '',
    linkedin: '',
    portfolio: '',
    website: '',
    github: '',
    resumeUrl: '',
    coverUrl: '',
    currentTitle: '',
    currentCompany: '',
    yearsExperience: '',
    highestEducation: '',
    school: '',
    degree: '',
    fieldOfStudy: '',
    graduationYear: '',
    gpa: '',
    certifications: '',
    skills: '',
    languages: '',
    references: '',
    currentSalary: '',
    expectedSalary: '',
    salaryText: '',
    salaryCurrency: '',
    authorizedToWork: 'Yes',
    requiresSponsorship: 'No',
    resumeSummary: '',
    workHistory: '',
    education: '',
    coverLetter: '',
    experienceEntries: [],
    educationEntries: [],
    customQA: [],
    customAnswers: {}
  };

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

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function normalizeCustomAnswers(stored) {
    var map = {};
    if (stored && typeof stored.customAnswers === 'object' && !Array.isArray(stored.customAnswers)) {
      Object.keys(stored.customAnswers).forEach(function (k) {
        map[k] = stored.customAnswers[k];
      });
    }
    var qa = Array.isArray(stored && stored.customQA) ? stored.customQA : [];
    qa.forEach(function (row) {
      if (row && row.question && map[row.question] == null) {
        map[row.question] = row.answer;
      }
    });
    return map;
  }

  function stripMeta(record) {
    if (!record || typeof record !== 'object') return Object.assign({}, DEFAULT_PROFILE);
    var out = Object.assign({}, DEFAULT_PROFILE, record, {
      customQA: Array.isArray(record.customQA) ? record.customQA : [],
      customAnswers: normalizeCustomAnswers(record)
    });
    if (!out.postcode && out.zip) out.postcode = out.zip;
    if (!out.zip && out.postcode) out.zip = out.postcode;
    return out;
  }

  function fieldsFromInput(profile) {
    var customQA = Array.isArray(profile && profile.customQA) ? profile.customQA : [];
    var customAnswers =
      profile &&
      profile.customAnswers &&
      typeof profile.customAnswers === 'object' &&
      !Array.isArray(profile.customAnswers)
        ? Object.assign({}, profile.customAnswers)
        : {};
    customQA.forEach(function (row) {
      if (row && row.question) customAnswers[row.question] = row.answer;
    });
    var toSave = Object.assign({}, DEFAULT_PROFILE, profile || {}, {
      customQA: customQA,
      customAnswers: customAnswers
    });
    if (!toSave.postcode && toSave.zip) toSave.postcode = toSave.zip;
    if (!toSave.zip && toSave.postcode) toSave.zip = toSave.postcode;
    delete toSave.id;
    delete toSave.name;
    delete toSave.createdAt;
    delete toSave.updatedAt;
    delete toSave.locked;
    delete toSave.systemProfile;
    return toSave;
  }

  function isMockName(name) {
    return String(name || '').trim().toLowerCase() === 'mock';
  }

  function isZahidName(name) {
    var n = String(name || '').trim().toLowerCase();
    return n === 'zahid' || n === 'zahid general';
  }

  function findZahidId(profiles) {
    var ids = Object.keys(profiles || {});
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var p = profiles[id];
      if (!p) continue;
      if (String(p.id || id) === 'zahid' || isZahidName(p.name)) return id;
    }
    return null;
  }

  function findMockId(profiles) {
    var ids = Object.keys(profiles || {});
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var p = profiles[id];
      if (!p) continue;
      if (String(p.id || id) === 'mock' || isMockName(p.name)) return id;
    }
    return null;
  }

  /** Prefer Mock when picking a fallback active id (never invent a switch away from an explicit selection). */
  function preferDefaultActiveId(profiles, currentActiveId) {
    if (currentActiveId && profiles[currentActiveId]) return currentActiveId;
    var mockId = findMockId(profiles);
    if (mockId) return mockId;
    var zahidId = findZahidId(profiles);
    if (zahidId) return zahidId;
    var ids = Object.keys(profiles || {});
    if (!ids.length) return null;
    return ids.sort(function (a, b) {
      return (profiles[a].createdAt || 0) - (profiles[b].createdAt || 0);
    })[0];
  }

  function isLockedProfile(record) {
    if (!record) return false;
    if (record.locked || record.systemProfile) return true;
    if (isMockName(record.name)) return true;
    if (String(record.id || '') === 'mock') return true;
    return false;
  }

  function metaOnly(record) {
    return {
      id: record.id,
      name: record.name || 'Untitled',
      createdAt: record.createdAt || 0,
      updatedAt: record.updatedAt || 0,
      locked: !!record.locked || !!record.systemProfile || isMockName(record.name) || String(record.id || '') === 'mock',
      systemProfile: !!record.systemProfile || isMockName(record.name) || String(record.id || '') === 'mock'
    };
  }

  function mergeMissingSampleFields(existing) {
    var sample = SAMPLE_PROFILE;
    var out = Object.assign({}, fieldsFromInput(existing));
    Object.keys(sample).forEach(function (k) {
      if (k === 'customQA' || k === 'customAnswers') return;
      if (out[k] == null || String(out[k]).trim() === '') {
        if (sample[k] != null && String(sample[k]).trim() !== '') out[k] = sample[k];
      }
    });
    var sampleQA = Array.isArray(sample.customQA) ? sample.customQA : [];
    var qa = Array.isArray(out.customQA) ? out.customQA.slice() : [];
    var haveQ = {};
    qa.forEach(function (row) {
      if (row && row.question) haveQ[String(row.question).toLowerCase()] = true;
    });
    sampleQA.forEach(function (row) {
      if (!row || !row.question) return;
      var key = String(row.question).toLowerCase();
      if (!haveQ[key]) {
        qa.push({ question: row.question, answer: row.answer });
        haveQ[key] = true;
      } else {
        for (var i = 0; i < qa.length; i++) {
          if (qa[i] && String(qa[i].question || '').toLowerCase() === key) {
            if (qa[i].answer == null || String(qa[i].answer).trim() === '') {
              qa[i].answer = row.answer;
            }
            break;
          }
        }
      }
    });
    out.customQA = qa;
    var answers = Object.assign({}, sample.customAnswers || {}, out.customAnswers || {});
    qa.forEach(function (row) {
      if (row && row.question) {
        if (answers[row.question] == null || String(answers[row.question]).trim() === '') {
          answers[row.question] = row.answer;
        }
      }
    });
    out.customAnswers = answers;
    return out;
  }

  async function ensureMockProfile() {
    var store = await readStoreRaw();
    var profiles = store.profiles;
    var mockId = null;
    Object.keys(profiles).forEach(function (id) {
      var p = profiles[id];
      if (!p) return;
      if (String(p.id || id) === 'mock' || isMockName(p.name)) {
        mockId = id;
      }
    });
    var now = Date.now();
    var changed = false;
    if (!mockId) {
      mockId = 'mock';
      var fields = fieldsFromInput(SAMPLE_PROFILE);
      profiles[mockId] = Object.assign({}, fields, {
        id: mockId,
        name: 'Mock',
        locked: true,
        systemProfile: true,
        createdAt: now,
        updatedAt: now
      });
      changed = true;
    } else {
      var existing = profiles[mockId];
      var patched = Object.assign({}, existing, {
        name: 'Mock',
        locked: true,
        systemProfile: true
      });
      // Prefer stable id "mock" when safe
      if (mockId !== 'mock' && !profiles.mock) {
        delete profiles[mockId];
        patched.id = 'mock';
        if (store.activeId === mockId) store.activeId = 'mock';
        mockId = 'mock';
        profiles[mockId] = patched;
        changed = true;
      }
      if (patched.locked || patched.systemProfile) {
        var merged = mergeMissingSampleFields(patched);
        var next = Object.assign({}, merged, {
          id: mockId,
          name: 'Mock',
          locked: true,
          systemProfile: true,
          createdAt: patched.createdAt || now,
          updatedAt: now
        });
        // Only write if something meaningful was missing
        var before = JSON.stringify({
          g: existing.gender,
          n: existing.nationality,
          c: existing.customAnswers && existing.customAnswers['Current monthly salary'],
          t: existing.customAnswers && existing.customAnswers['Largest team size'],
          r: existing.customAnswers && existing.customAnswers['Based in Riyadh']
        });
        var after = JSON.stringify({
          g: next.gender,
          n: next.nationality,
          c: next.customAnswers && next.customAnswers['Current monthly salary'],
          t: next.customAnswers && next.customAnswers['Largest team size'],
          r: next.customAnswers && next.customAnswers['Based in Riyadh']
        });
        if (before !== after || !existing.locked || !existing.systemProfile || existing.name !== 'Mock') {
          profiles[mockId] = next;
          changed = true;
        } else if (!existing.locked || !existing.systemProfile || existing.name !== 'Mock') {
          profiles[mockId] = Object.assign({}, existing, {
            name: 'Mock',
            locked: true,
            systemProfile: true,
            id: mockId
          });
          changed = true;
        }
      }
    }
    if (changed) {
      var keepActive = preferDefaultActiveId(profiles, store.activeId);
      await writeStore(profiles, keepActive || mockId);
    }
    if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.ensureSourceProfileShells) {
      try {
        await global.FillApplySourceProfiles.ensureSourceProfileShells();
      } catch (_e) {
        /* ignore */
      }
    }
    return mockId;
  }

  async function readStoreRaw() {
    await ensureMigrated();
    var result = await storageGet([PROFILES_KEY, ACTIVE_PROFILE_ID_KEY]);
    var profiles =
      result[PROFILES_KEY] && typeof result[PROFILES_KEY] === 'object' && !Array.isArray(result[PROFILES_KEY])
        ? result[PROFILES_KEY]
        : {};
    var activeId = result[ACTIVE_PROFILE_ID_KEY];
    if (!activeId || !profiles[activeId]) {
      activeId = preferDefaultActiveId(profiles, activeId);
    }
    return { profiles: profiles, activeId: activeId };
  }

  var migratePromise = null;

  function ensureMigrated() {
    if (migratePromise) return migratePromise;
    migratePromise = (async function () {
      var result = await storageGet([PROFILES_KEY, ACTIVE_PROFILE_ID_KEY, LEGACY_PROFILE_KEY]);
      var profiles = result[PROFILES_KEY];
      var activeId = result[ACTIVE_PROFILE_ID_KEY];
      var hasProfiles =
        profiles && typeof profiles === 'object' && !Array.isArray(profiles) && Object.keys(profiles).length > 0;

      if (hasProfiles) {
        var renamed = false;
        Object.keys(profiles).forEach(function (pid) {
          var nm = String(profiles[pid].name || '').trim();
          if (nm === 'Default' || isMockName(nm) || String(pid) === 'mock') {
            var p = profiles[pid];
            var need =
              p.name !== 'Mock' || !p.locked || !p.systemProfile || String(p.id || pid) !== String(pid);
            if (need) {
              p.name = 'Mock';
              p.locked = true;
              p.systemProfile = true;
              p.id = pid;
              p.updatedAt = Date.now();
              renamed = true;
            }
          }
        });
        var patch = {};
        if (!activeId || !profiles[activeId]) {
          patch[ACTIVE_PROFILE_ID_KEY] = preferDefaultActiveId(profiles, activeId);
        }
        if (renamed) patch[PROFILES_KEY] = profiles;
        if (Object.keys(patch).length) await storageSet(patch);
        return;
      }

      var now = Date.now();
      var legacy = result[LEGACY_PROFILE_KEY];
      var mockSrc =
        legacy && typeof legacy === 'object' && (legacy.email || legacy.firstName || legacy.fullName)
          ? legacy
          : SAMPLE_PROFILE;
      var mockRecord = Object.assign({}, fieldsFromInput(mockSrc), {
        id: 'mock',
        name: 'Mock',
        locked: true,
        systemProfile: true,
        createdAt: now,
        updatedAt: now
      });
      var map = {};
      map.mock = mockRecord;
      var payload = {};
      payload[PROFILES_KEY] = map;
      // Fresh init: Mock is the only built-in profile (import real applicant data)
      payload[ACTIVE_PROFILE_ID_KEY] = 'mock';
      await storageSet(payload);
    })().catch(function (err) {
      migratePromise = null;
      throw err;
    });
    return migratePromise;
  }

  async function readStore() {
    await ensureMigrated();
    // Ensure Mock exists. Never auto-create Zahid — import or explicit createZahid only.
    try {
      await ensureMockProfile();
    } catch (_eMock) {
      /* ignore — store may be mid-migrate */
    }
    return readStoreRaw();
  }

  async function writeStore(profiles, activeId) {
    var payload = {};
    payload[PROFILES_KEY] = profiles;
    payload[ACTIVE_PROFILE_ID_KEY] = activeId;
    // Keep legacy key mirrored to active fields for any old readers
    if (activeId && profiles[activeId]) {
      payload[LEGACY_PROFILE_KEY] = fieldsFromInput(profiles[activeId]);
    }
    await storageSet(payload);
  }

  async function listProfiles() {
    var store = await readStore();
    return Object.keys(store.profiles)
      .map(function (id) {
        return metaOnly(store.profiles[id]);
      })
      .sort(function (a, b) {
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
  }

  async function getActiveProfileId() {
    var store = await readStore();
    return store.activeId;
  }

  async function getActiveProfileMeta() {
    var store = await readStore();
    if (!store.activeId || !store.profiles[store.activeId]) return null;
    return metaOnly(store.profiles[store.activeId]);
  }

  async function getProfile() {
    var store = await readStore();
    if (!store.activeId || !store.profiles[store.activeId]) {
      return Object.assign({}, DEFAULT_PROFILE);
    }
    return stripMeta(store.profiles[store.activeId]);
  }

  async function getProfileById(id) {
    var store = await readStore();
    if (!id || !store.profiles[id]) return null;
    return stripMeta(store.profiles[id]);
  }

  async function saveProfile(profile) {
    var store = await readStore();
    if (!store.activeId || !store.profiles[store.activeId]) {
      throw new Error('No active profile');
    }
    var existing = store.profiles[store.activeId];
    var fields = fieldsFromInput(profile);
    var now = Date.now();
    store.profiles[store.activeId] = Object.assign({}, fields, {
      id: existing.id,
      name: isLockedProfile(existing) ? 'Mock' : existing.name,
      locked: !!existing.locked || isLockedProfile(existing),
      systemProfile: !!existing.systemProfile || isLockedProfile(existing),
      createdAt: existing.createdAt || now,
      updatedAt: now
    });
    await writeStore(store.profiles, store.activeId);
    return stripMeta(store.profiles[store.activeId]);
  }

  async function createProfile(name) {
    var store = await readStore();
    var now = Date.now();
    var id = newId();
    var trimmed = String(name || '').trim() || 'Untitled';
    if (isMockName(trimmed)) {
      throw new Error('Name "Mock" is reserved for the system demo profile.');
    }
    var record = Object.assign({}, DEFAULT_PROFILE, {
      id: id,
      name: trimmed,
      createdAt: now,
      updatedAt: now
    });
    store.profiles[id] = record;
    await writeStore(store.profiles, id);
    return metaOnly(record);
  }

  async function renameProfile(id, name) {
    var store = await readStore();
    if (!id || !store.profiles[id]) throw new Error('Profile not found');
    if (isLockedProfile(store.profiles[id])) {
      throw new Error('Mock profile cannot be renamed. Use Reset Mock to restore sample fields.');
    }
    var trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Name required');
    if (isMockName(trimmed)) throw new Error('Name "Mock" is reserved for the system demo profile.');
    store.profiles[id].name = trimmed;
    store.profiles[id].updatedAt = Date.now();
    await writeStore(store.profiles, store.activeId);
    return metaOnly(store.profiles[id]);
  }

  async function deleteProfile(id) {
    var store = await readStore();
    if (!id || !store.profiles[id]) throw new Error('Profile not found');
    var victim = store.profiles[id];
    if (isLockedProfile(victim)) {
      throw new Error('Mock profile cannot be deleted. Switch to another profile instead.');
    }
    var ids = Object.keys(store.profiles);
    if (ids.length <= 1) throw new Error('Cannot delete the last profile');
    delete store.profiles[id];
    var nextActive = store.activeId;
    if (nextActive === id) {
      nextActive = Object.keys(store.profiles).sort(function (a, b) {
        return (store.profiles[a].createdAt || 0) - (store.profiles[b].createdAt || 0);
      })[0];
    }
    await writeStore(store.profiles, nextActive);
    return { deletedId: id, activeId: nextActive };
  }

  async function setActiveProfile(id) {
    var store = await readStore();
    if (!id || !store.profiles[id]) throw new Error('Profile not found');
    await writeStore(store.profiles, id);
    return metaOnly(store.profiles[id]);
  }

  async function duplicateProfile(id) {
    var store = await readStore();
    if (!id || !store.profiles[id]) throw new Error('Profile not found');
    var src = store.profiles[id];
    var now = Date.now();
    var newProfileId = newId();
    var fields = fieldsFromInput(src);
    var baseName = (src.name || 'Untitled').replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Untitled';
    var copyName = baseName + ' (copy)';
    var existingNames = {};
    Object.keys(store.profiles).forEach(function (pid) {
      existingNames[String(store.profiles[pid].name || '').toLowerCase()] = true;
    });
    var n = 2;
    while (existingNames[copyName.toLowerCase()]) {
      copyName = baseName + ' (copy ' + n + ')';
      n++;
    }
    var record = Object.assign({}, fields, {
      id: newProfileId,
      name: copyName,
      createdAt: now,
      updatedAt: now
    });
    store.profiles[newProfileId] = record;
    await writeStore(store.profiles, newProfileId);
    return metaOnly(record);
  }


  /**
   * Ensure the Zahid (primary) profile exists with intended structure.
   * Does NOT force-activate when an explicit active selection already exists —
   * callers that need activation (Create/Reset Zahid, fresh init) pass activate.
   */
  async function ensureZahidProfile(opts) {
    opts = opts || {};
    var store = await readStoreRaw();
    var profiles = store.profiles;
    var now = Date.now();
    var zahidId = findZahidId(profiles);
    var fields = fieldsFromInput(ZAHID_GENERAL_PROFILE);
    var changed = false;
    if (!zahidId) {
      zahidId = 'zahid';
      // Avoid clobbering an unrelated id collision
      if (profiles[zahidId] && !isZahidName(profiles[zahidId].name)) {
        zahidId = newId();
      }
      profiles[zahidId] = Object.assign({}, fields, {
        id: zahidId,
        name: 'Zahid',
        locked: false,
        systemProfile: false,
        createdAt: now,
        updatedAt: now
      });
      changed = true;
    } else if (opts.reset) {
      var existing = profiles[zahidId];
      profiles[zahidId] = Object.assign({}, fields, {
        id: zahidId,
        name: 'Zahid',
        locked: false,
        systemProfile: false,
        createdAt: existing.createdAt || now,
        updatedAt: now
      });
      changed = true;
    } else {
      // Normalize display name Zahid General → Zahid without wiping user edits
      var cur = profiles[zahidId];
      if (cur && String(cur.name || '') === 'Zahid General') {
        profiles[zahidId] = Object.assign({}, cur, { name: 'Zahid', updatedAt: now });
        changed = true;
      }
    }
    var activeId = store.activeId;
    if (opts.activate) {
      activeId = zahidId;
      changed = true;
    } else if (!activeId || !profiles[activeId]) {
      activeId = preferDefaultActiveId(profiles, activeId);
      changed = true;
    }
    if (changed) {
      await writeStore(profiles, activeId);
    }
    return zahidId;
  }

  /**
   * Ensure Mock (only built-in) exists. Zahid is NOT auto-seeded —
   * only when opts.forceZahidActive / opts.resetZahid (explicit API).
   * Import creates named profiles from JSON. Never wipe imported data.
   */
  async function ensureDefaultProfiles(opts) {
    opts = opts || {};
    await ensureMockProfile();
    var store = await readStoreRaw();
    var zahidId = findZahidId(store.profiles);
    if (opts.forceZahidActive || opts.resetZahid) {
      zahidId = await ensureZahidProfile({
        activate: !!opts.forceZahidActive,
        reset: !!opts.resetZahid
      });
      store = await readStoreRaw();
    }
    if (!findMockId(store.profiles)) {
      await ensureMockProfile();
      store = await readStoreRaw();
    }
    var mockId = findMockId(store.profiles);
    if (opts.forceZahidActive && zahidId && store.profiles[zahidId]) {
      if (store.activeId !== zahidId) await writeStore(store.profiles, zahidId);
    } else if (opts.fresh && mockId && store.profiles[mockId]) {
      if (store.activeId !== mockId) await writeStore(store.profiles, mockId);
    } else if (!store.activeId || !store.profiles[store.activeId]) {
      if (mockId && store.profiles[mockId]) await writeStore(store.profiles, mockId);
    }
    return { zahidId: findZahidId((await readStoreRaw()).profiles), mockId: findMockId((await readStoreRaw()).profiles) };
  }

  async function createZahidGeneralProfile() {
    // Explicit user action: reset Zahid to the public empty shell; keep Mock; activate.
    await ensureMockProfile();
    var zahidId = await ensureZahidProfile({ reset: true, activate: true });
    var store = await readStoreRaw();
    var record = store.profiles[zahidId];
    // Ensure source profile shells exist; do not invent Zahid screening answers
    if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.ensureSourceProfileShells) {
      try {
        await global.FillApplySourceProfiles.ensureSourceProfileShells();
      } catch (_e) {
        /* ignore */
      }
    }
    return Object.assign(stripMeta(record), { id: record.id, name: record.name });
  }

  async function resetMockProfile() {
    var store = await readStore();
    var mockId = null;
    Object.keys(store.profiles).forEach(function (id) {
      if (String(id) === 'mock' || isMockName(store.profiles[id].name)) mockId = id;
    });
    var now = Date.now();
    var fields = fieldsFromInput(SAMPLE_PROFILE);
    if (!mockId) {
      mockId = 'mock';
      store.profiles[mockId] = Object.assign({}, fields, {
        id: mockId,
        name: 'Mock',
        locked: true,
        systemProfile: true,
        createdAt: now,
        updatedAt: now
      });
    } else {
      var existing = store.profiles[mockId];
      store.profiles[mockId] = Object.assign({}, fields, {
        id: mockId,
        name: 'Mock',
        locked: true,
        systemProfile: true,
        createdAt: existing.createdAt || now,
        updatedAt: now
      });
    }
    var keepActive = preferDefaultActiveId(store.profiles, store.activeId);
    await writeStore(store.profiles, keepActive || mockId);
    if (global.FillApplySourceProfiles && global.FillApplySourceProfiles.seedMockSourceProfiles) {
      try {
        await global.FillApplySourceProfiles.seedMockSourceProfiles();
      } catch (_e) {
        /* ignore — source profiles optional at boot */
      }
    }
    return Object.assign(stripMeta(store.profiles[mockId]), {
      id: mockId,
      name: 'Mock',
      locked: true,
      systemProfile: true
    });
  }

  async function seedSampleProfile() {
    // Always reseed the locked Mock profile (keeps same id).
    return resetMockProfile();
  }

  function profileSummary(profile) {
    const name =
      (profile && (profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' '))) ||
      '(no name)';
    const email = (profile && profile.email) || '(no email)';
    return name + ' · ' + email;
  }

  async function profileSummaryWithActive() {
    // Active applicant identity only (name · email) — do not prepend profile chip name.
    var profile = await getProfile();
    return profileSummary(profile);
  }


  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function missingKeys(profile, keys) {
    profile = profile || {};
    var out = [];
    (keys || []).forEach(function (k) {
      if (isBlank(profile[k])) out.push(k);
    });
    return out;
  }

  /**
   * Which of the commonly-asked fields are still blank, by group, plus a
   * percentage. A blank field is not an error — salary and date of birth are
   * the applicant's to give — but it does predict where a run will pause.
   */
  function profileGaps(profile) {
    profile = profile || {};
    var groups = [];
    var total = 0;
    var filled = 0;
    PROFILE_COMPLETENESS.forEach(function (row) {
      var missing = missingKeys(profile, row.keys);
      total += row.keys.length;
      filled += row.keys.length - missing.length;
      if (missing.length) groups.push({ group: row.group, missing: missing });
    });
    return {
      groups: groups,
      missing: groups.reduce(function (acc, g) {
        return acc.concat(g.missing);
      }, []),
      filled: filled,
      total: total,
      percent: total ? Math.round((filled / total) * 100) : 0
    };
  }

  /**
   * Lookup a profile field-map key or customAnswers / customQA label.
   * Never invents a value — blank → { value: null, missing: true }.
   */
  function answerForLabel(profile, label) {
    profile = profile || {};
    var raw = label == null ? '' : String(label).trim();
    if (!raw) return { value: null, missing: true };

    // Direct profile key
    if (Object.prototype.hasOwnProperty.call(profile, raw) && !isBlank(profile[raw])) {
      return { value: String(profile[raw]).trim(), missing: false, source: 'profile.' + raw };
    }

    // Field-map key match by label / names
    var mapApi = global.FillApplyFieldMap;
    if (mapApi && Array.isArray(mapApi.FIELD_MAP)) {
      var labLower = raw.toLowerCase();
      for (var i = 0; i < mapApi.FIELD_MAP.length; i++) {
        var entry = mapApi.FIELD_MAP[i];
        if (!entry || !entry.key) continue;
        var hit = entry.key.toLowerCase() === labLower;
        var labels = entry.labels || [];
        var names = entry.names || [];
        for (var L = 0; !hit && L < labels.length; L++) {
          if (labLower.indexOf(String(labels[L]).toLowerCase()) !== -1) hit = true;
        }
        for (var N = 0; !hit && N < names.length; N++) {
          if (labLower.indexOf(String(names[N]).toLowerCase()) !== -1) hit = true;
        }
        if (hit) {
          if (!isBlank(profile[entry.key])) {
            return { value: String(profile[entry.key]).trim(), missing: false, source: 'fieldMap.' + entry.key };
          }
          return { value: null, missing: true, key: entry.key };
        }
      }
    }

    // customAnswers fuzzy
    var cmap = profile.customAnswers;
    if (cmap && typeof cmap === 'object' && !Array.isArray(cmap)) {
      var keys = Object.keys(cmap);
      var best = null;
      var bestScore = 0;
      var bestKey = null;
      var nLab = raw.toLowerCase().replace(/\s+/g, ' ');
      for (var c = 0; c < keys.length; c++) {
        var k = keys[c];
        var nk = String(k).toLowerCase().replace(/\s+/g, ' ');
        if (!nk) continue;
        if (nLab.indexOf(nk) !== -1 || nk.indexOf(nLab) !== -1) {
          var score = Math.min(nk.length, nLab.length);
          if (score > bestScore) {
            bestScore = score;
            best = cmap[k];
            bestKey = k;
          }
        }
      }
      if (bestKey != null) {
        if (isBlank(best)) return { value: null, missing: true, key: bestKey };
        return { value: String(best).trim(), missing: false, source: 'customAnswers.' + bestKey };
      }
    }

    // customQA
    if (mapApi && typeof mapApi.matchCustomQA === 'function') {
      var qa = mapApi.matchCustomQA(profile.customQA, raw, '');
      if (!isBlank(qa)) return { value: String(qa).trim(), missing: false, source: 'customQA' };
    } else if (Array.isArray(profile.customQA)) {
      var nLab2 = raw.toLowerCase();
      for (var q = 0; q < profile.customQA.length; q++) {
        var row = profile.customQA[q];
        if (!row || !row.question) continue;
        var nq = String(row.question).toLowerCase();
        if (nLab2.indexOf(nq) !== -1 || nq.indexOf(nLab2) !== -1) {
          if (isBlank(row.answer)) return { value: null, missing: true, key: row.question };
          return { value: String(row.answer).trim(), missing: false, source: 'customQA' };
        }
      }
    }

    return { value: null, missing: true };
  }

  /**
   * Adapters call this before filling a known mapped field.
   * If blank → needsHuman payload with missingProfileFields (never invent).
   */

  /**
   * Strip currency codes/symbols and keep digits + optional decimal.
   * "25000 AED" → "25000"; "$1,200.50" → "1200.50"; empty if no digits.
   */
  function numericAmount(str) {
    if (str == null) return '';
    var s = String(str).trim();
    if (!s) return '';
    s = s.replace(/(AED|SAR|USD|EUR|GBP|PKR|INR|CAD|AUD|CHF|JPY|CNY|QAR|KWD|BHD|OMR|EGP)\b/gi, '');
    s = s.replace(/[£$€¥₹]/s);
    s = s.replace(/,/g, '');
    s = s.replace(/\s+/g, '');
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? m[0] : '';
  }

  var MISSING_FIELD_KEY_MAP = {
    nationality: 'nationality',
    citizenship: 'nationality',
    country: 'country',
    gender: 'gender',
    'notice period': 'noticePeriod',
    'phone full': 'phoneFull',
    phonefull: 'phoneFull',
    phone_full: 'phoneFull',
    phonee164: 'phoneE164',
    phone_e164: 'phoneE164',
    'salary text': 'salaryText',
    salarytext: 'salaryText',
    salary_text: 'salaryText',
    noticeperiod: 'noticePeriod',
    'authorized to work': 'authorizedToWork',
    authorizedtowork: 'authorizedToWork',
    'requires sponsorship': 'requiresSponsorship',
    requiressponsorship: 'requiresSponsorship',
    phone: 'phone',
    email: 'email',
    city: 'city',
    state: 'state',
    zip: 'zip',
    postcode: 'postcode',
    linkedin: 'linkedin',
    salutation: 'salutation',
    'years of experience': 'yearsExperience',
    yearsofexperience: 'yearsExperience',
    'highest education': 'highestEducation',
    highesteducation: 'highestEducation',
    'current title': 'currentTitle',
    'job title': 'currentTitle',
    'current company': 'currentCompany',
    'current employer': 'currentCompany',
    'willing to relocate': 'willingToRelocate',
    'current salary': 'currentSalary',
    currentsalary: 'currentSalary',
    'expected salary': 'expectedSalary',
    expectedsalary: 'expectedSalary',
    school: 'school',
    university: 'school',
    degree: 'degree',
    'field of study': 'fieldOfStudy',
    'graduation year': 'graduationYear',
    'date of birth': 'dateOfBirth',
    dob: 'dateOfBirth'
  };

  function normalizeMissingLabel(label) {
    return String(label || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Write user-supplied missing-field answers into the active profile:
   * known keys + customAnswers + customQA.
   * fieldValues: { [labelOrKey]: value } or [{ field, value }]
   */
  async function applyMissingFieldAnswers(fieldValues) {
    var map = {};
    if (Array.isArray(fieldValues)) {
      fieldValues.forEach(function (row) {
        if (!row) return;
        var k = row.field != null ? row.field : row.key != null ? row.key : row.label;
        if (k == null) return;
        map[String(k)] = row.value;
      });
    } else if (fieldValues && typeof fieldValues === 'object') {
      map = fieldValues;
    }
    var profile = await getProfile();
    var answers =
      profile.customAnswers && typeof profile.customAnswers === 'object'
        ? Object.assign({}, profile.customAnswers)
        : {};
    var qa = Array.isArray(profile.customQA) ? profile.customQA.slice() : [];

    Object.keys(map).forEach(function (label) {
      var value = map[label];
      if (value == null || String(value).trim() === '') return;
      var raw = String(value).trim();
      var nk = normalizeMissingLabel(label);
      var compact = nk.replace(/\s+/g, '');
      var mapped = MISSING_FIELD_KEY_MAP[nk] || MISSING_FIELD_KEY_MAP[compact];
      if (Object.prototype.hasOwnProperty.call(DEFAULT_PROFILE, label)) {
        profile[label] = raw;
      } else if (mapped && Object.prototype.hasOwnProperty.call(DEFAULT_PROFILE, mapped)) {
        profile[mapped] = raw;
      }
      answers[label] = raw;
      if (/\bcurrent\s*salary\b|\bpresent\s*salary\b|\bcurrent\s*ctc\b/i.test(nk) || compact === 'currentsalary') {
        answers.currentSalary = raw;
        answers['Current monthly salary'] = raw;
        answers['Current Salary'] = raw;
        profile.currentSalary = raw;
      }
      if (/\bexpected\s*salary\b|\bsalary\s*expectation\b|\bdesired\s*salary\b|\bexpected\s*ctc\b/i.test(nk) || compact === 'expectedsalary') {
        answers.expectedSalary = raw;
        answers['Expected salary'] = raw;
        answers['Salary expectation'] = raw;
        profile.expectedSalary = raw;
      }
      if (/notice\s*period/i.test(nk)) {
        answers['Notice period'] = raw;
        profile.noticePeriod = raw;
      }
      if (/nationality|citizenship/i.test(nk)) {
        answers.Nationality = raw;
        profile.nationality = raw;
      }
      var found = false;
      for (var i = 0; i < qa.length; i++) {
        if (qa[i] && normalizeMissingLabel(qa[i].question) === nk) {
          qa[i] = Object.assign({}, qa[i], { answer: raw });
          found = true;
          break;
        }
      }
      if (!found) qa.push({ question: String(label), answer: raw });
    });

    profile.customAnswers = answers;
    profile.customQA = qa;
    return saveProfile(profile);
  }

  function requireOrPause(profile, keyOrLabel) {
    var key = keyOrLabel == null ? '' : String(keyOrLabel).trim();
    if (!key) {
      return {
        value: null,
        missing: true,
        needsHuman: true,
        pauseReason: 'missing_profile_field',
        missingProfileFields: ['(unknown field)'],
        error: 'Missing profile field — fill in Options or on the page, then Resume'
      };
    }
    if (Object.prototype.hasOwnProperty.call(profile || {}, key) && !isBlank(profile[key])) {
      return { value: String(profile[key]).trim(), missing: false };
    }
    var looked = answerForLabel(profile, key);
    if (!looked.missing && !isBlank(looked.value)) {
      return { value: looked.value, missing: false, source: looked.source };
    }
    var label = looked.key || key;
    return {
      value: null,
      missing: true,
      needsHuman: true,
      pauseReason: 'missing_profile_field',
      missingProfileFields: [label],
      error:
        'Missing profile field: ' +
        label +
        ' — fill in App Settings or on the page, then Resume'
    };
  }

  global.FillApplyProfile = {
    PROFILE_STORAGE_KEY: LEGACY_PROFILE_KEY,
    PROFILES_KEY: PROFILES_KEY,
    ACTIVE_PROFILE_ID_KEY: ACTIVE_PROFILE_ID_KEY,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    PROFILE_COMPLETENESS: PROFILE_COMPLETENESS,
    profileGaps: profileGaps,
    SAMPLE_PROFILE: SAMPLE_PROFILE,
    ZAHID_GENERAL_PROFILE: ZAHID_GENERAL_PROFILE,
    createZahidGeneralProfile: createZahidGeneralProfile,
    ensureZahidProfile: ensureZahidProfile,
    ensureDefaultProfiles: ensureDefaultProfiles,
    isZahidName: isZahidName,
    findZahidId: findZahidId,
    findMockId: findMockId,
    getProfile: getProfile,
    getProfileById: getProfileById,
    saveProfile: saveProfile,
    seedSampleProfile: seedSampleProfile,
    resetMockProfile: resetMockProfile,
    ensureMockProfile: ensureMockProfile,
    isLockedProfile: isLockedProfile,
    isMockName: isMockName,
    profileSummary: profileSummary,
    profileSummaryWithActive: profileSummaryWithActive,
    listProfiles: listProfiles,
    getActiveProfileId: getActiveProfileId,
    getActiveProfileMeta: getActiveProfileMeta,
    createProfile: createProfile,
    renameProfile: renameProfile,
    deleteProfile: deleteProfile,
    setActiveProfile: setActiveProfile,
    duplicateProfile: duplicateProfile,
    isBlank: isBlank,
    numericAmount: numericAmount,
    applyMissingFieldAnswers: applyMissingFieldAnswers,
    missingKeys: missingKeys,
    answerForLabel: answerForLabel,
    requireOrPause: requireOrPause,
    ensureMigrated: ensureMigrated
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
