(function () {
  'use strict';

  const SECTIONS_KEY = 'fillApply.ui.sections';
  const DEFAULT_SECTIONS = {
    profiles: true,
    sourceProfiles: true,
    profileSettings: false,
    backend: false,
    caps: false,
    applicationDatabase: false,
    applicationQueue: true,
    documents: false,
    customQa: false,
    knowledge: true
  };

  const form = document.getElementById('profileForm');
  const qaList = document.getElementById('qaList');
  const statusEl = document.getElementById('status');
  const btnAddQA = document.getElementById('btnAddQA');
  const btnSeed = document.getElementById('btnSeed');
  const btnReset = document.getElementById('btnReset');

  const configStatus = document.getElementById('configStatus');
  const docsStatus = document.getElementById('docsStatus');
  const docsMeta = document.getElementById('docsMeta');
  const btnSaveConfig = document.getElementById('btnSaveConfig');
  const btnSaveDocs = document.getElementById('btnSaveDocs');
  const btnClearDocs = document.getElementById('btnClearDocs');
  const btnSaveMockUrls = document.getElementById('btnSaveMockUrls');
  const btnResetMock = document.getElementById('btnResetMock');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const mockUrlsStatus = document.getElementById('mockUrlsStatus');
  const mockUrlsMeta = document.getElementById('mockUrlsMeta');
  const mockQueueUrlsEl = document.getElementById('mockQueueUrls');
  const bucketCountsEl = document.getElementById('bucketCounts');
  const realtimeLogEl = document.getElementById('realtimeLog');
  const btnClearSessionLog = document.getElementById('btnClearSessionLog');

  const profileSelect = document.getElementById('profileSelect');
  const profileChipsEl = document.getElementById('profileChips');
  const profileMgrStatus = document.getElementById('profileMgrStatus');
  const headerActiveChip = document.getElementById('headerActiveChip');
  const formActiveProfileHint = document.getElementById('formActiveProfileHint');
  const btnProfileRename = document.getElementById('btnProfileRename');
  const btnProfileDuplicate = document.getElementById('btnProfileDuplicate');
  const btnProfileSetActive = document.getElementById('btnProfileSetActive');
  const btnProfileDelete = document.getElementById('btnProfileDelete');
  const btnZahidGeneral = document.getElementById('btnZahidGeneral');
  const btnResetMockProfile = document.getElementById('btnResetMockProfile');
  const btnExportProfile = document.getElementById('btnExportProfile');
  const btnImportProfile = document.getElementById('btnImportProfile');
  const importProfileFile = document.getElementById('importProfileFile');

  const selectedSourceIdEl = document.getElementById('selectedSourceId');
  const sourceCompletenessMeter = document.getElementById('sourceCompletenessMeter');
  const sourceNoteEl = document.getElementById('sourceNote');
  const sourceFieldsForm = document.getElementById('sourceFieldsForm');
  const sourceProfileStatus = document.getElementById('sourceProfileStatus');
  const btnSaveSourceProfile = document.getElementById('btnSaveSourceProfile');
  const btnClearSourceProfile = document.getElementById('btnClearSourceProfile');
  const btnCopySourceFromProfile = document.getElementById('btnCopySourceFromProfile');
  const btnSeedMockSources = document.getElementById('btnSeedMockSources');

  // Must mirror the inputs in #profileForm.
  const TEXT_FIELDS = [
    'salutation', 'preferredName', 'firstName', 'middleName', 'lastName', 'fullName',
    'headline', 'email', 'phone', 'phoneCountry', 'dateOfBirth',
    'nationality', 'gender',
    'location', 'street', 'city', 'state', 'country', 'zip', 'postcode',
    'authorizedToWork', 'requiresSponsorship',
    'currentTitle', 'currentCompany', 'yearsExperience', 'languages', 'skills',
    'certifications', 'references',
    'highestEducation', 'degree', 'school', 'fieldOfStudy', 'graduationYear', 'gpa',
    'noticePeriod', 'availableFrom', 'willingToRelocate', 'remotePreference',
    'driversLicense', 'currentSalary', 'expectedSalary', 'salaryCurrency', 'referralSource',
    'linkedin',
    'resumeSummary', 'workHistory', 'education', 'coverLetter'
  ];

  /**
   * The profile the form was last loaded from. Kept so a save carries over the
   * parts of the profile this form does not render — the structured work and
   * education entries, and the answer aliases that never had a Q&A row.
   */
  let loadedProfile = null;

  let dirty = false;
  let suppressDirty = false;
  let profilesCache = [];
  let activeIdCache = null;
  let selectedIdCache = null;

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function send(type, extra) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (res) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res || res.ok === false) {
          reject(new Error((res && res.error) || 'Request failed'));
          return;
        }
        resolve(res.data !== undefined ? res.data : res);
      });
    });
  }

  function markDirty() {
    if (suppressDirty) return;
    dirty = true;
  }

  function clearDirty() {
    dirty = false;
  }

  function confirmIfDirty(message) {
    if (!dirty) return true;
    return confirm(message || 'You have unsaved profile changes. Discard them?');
  }

  /* ---- collapsible sections persistence ---- */
  function loadSectionState() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([SECTIONS_KEY], function (result) {
        var saved = result[SECTIONS_KEY];
        resolve(Object.assign({}, DEFAULT_SECTIONS, saved && typeof saved === 'object' ? saved : {}));
      });
    });
  }

  function saveSectionState(state) {
    var payload = {};
    payload[SECTIONS_KEY] = state;
    return new Promise(function (resolve) {
      chrome.storage.local.set(payload, resolve);
    });
  }

  async function initSections() {
    var state = await loadSectionState();
    document.querySelectorAll('details[data-sec]').forEach(function (el) {
      var key = el.getAttribute('data-sec');
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        el.open = !!state[key];
      }
      el.addEventListener('toggle', function () {
        loadSectionState().then(function (cur) {
          cur[key] = el.open;
          return saveSectionState(cur);
        });
      });
    });
  }

  function addQARow(question, answer) {
    const row = document.createElement('div');
    row.className = 'qa-row';
    row.innerHTML =
      '<input class="q" placeholder="Question (matched to labels)" />' +
      '<input class="a" placeholder="Answer" />' +
      '<button type="button" class="icon danger" title="Remove">×</button>';
    row.querySelector('.q').value = question || '';
    row.querySelector('.a').value = answer || '';
    row.querySelector('button').addEventListener('click', function () {
      row.remove();
      markDirty();
    });
    row.querySelector('.q').addEventListener('input', markDirty);
    row.querySelector('.a').addEventListener('input', markDirty);
    qaList.appendChild(row);
  }

  function readQA() {
    return Array.from(qaList.querySelectorAll('.qa-row'))
      .map(function (row) {
        return {
          question: row.querySelector('.q').value.trim(),
          answer: row.querySelector('.a').value.trim()
        };
      })
      .filter(function (qa) { return qa.question || qa.answer; });
  }

  /** Date inputs require yyyy-MM-dd; never assign free-text like "Available immediately". */
  function valueForFormControl(el, raw) {
    // Structured arrays/objects must not stringify to "[object Object]"
    if (raw != null && typeof raw === 'object') {
      if (Array.isArray(raw)) {
        raw = formatStructuredList(raw);
      } else {
        raw = formatStructuredItem(raw);
      }
    }
    var value = raw == null ? '' : String(raw);
    if (value === '[object Object]') value = '';
    if (!el) return value;
    var type = String(el.type || '').toLowerCase();
    if (type === 'date' || type === 'month' || type === 'week' || type === 'time' || type === 'datetime-local') {
      if (!value) return '';
      // Native date: yyyy-MM-dd; month: yyyy-MM; datetime-local: yyyy-MM-ddThh:mm
      if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      if (type === 'month' && /^\d{4}-\d{2}$/.test(value)) return value;
      if (type === 'datetime-local' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
        return value.slice(0, 16);
      }
      // Non-conforming text (e.g. notice phrases parked on availableFrom) → leave blank
      return '';
    }
    return value;
  }

  function formatStructuredItem(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.name || row.issuer) {
      return [row.name, row.issuer, row.year].filter(Boolean).join(' — ');
    }
    if (row.degree || row.school) {
      return [row.degree, row.school, row.endYear || row.end || row.graduationYear]
        .filter(Boolean)
        .join(' · ');
    }
    try {
      return Object.keys(row)
        .map(function (k) {
          var v = row[k];
          if (v == null || v === '') return '';
          if (typeof v === 'object') return '';
          return String(v);
        })
        .filter(Boolean)
        .join(' · ');
    } catch (_e) {
      return '';
    }
  }

  function formatStructuredList(list) {
    if (!Array.isArray(list)) return '';
    return list
      .map(formatStructuredItem)
      .filter(Boolean)
      .join('; ');
  }

  function renderStructuredBlock(elementId, title, entries, describe) {
    var el = document.getElementById(elementId);
    if (!el) return;
    var list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      el.innerHTML = '';
      return;
    }
    var items = list
      .map(function (row) {
        var line = describe(row);
        if (!line) return '';
        return '<li>' + escapeHtmlLite(line) + '</li>';
      })
      .filter(Boolean)
      .join('');
    el.innerHTML =
      '<h3 class="subhead">' +
      title +
      '</h3><ul class="structured-ul">' +
      items +
      '</ul>';
  }

  function escapeHtmlLite(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fillForm(profile) {
    suppressDirty = true;
    loadedProfile = profile || {};
    TEXT_FIELDS.forEach(function (name) {
      const el = form.elements.namedItem(name);
      if (el) el.value = valueForFormControl(el, profile[name]);
    });
    qaList.innerHTML = '';
    const list = Array.isArray(profile.customQA) ? profile.customQA : [];
    if (!list.length) addQARow('', '');
    else list.forEach(function (qa) { addQARow(qa.question, qa.answer); });
    renderEntriesHint('experienceEntriesHint', profile.experienceEntries, function (row) {
      return [row.title, row.company, [row.start, row.end].filter(Boolean).join(' – ')]
        .filter(Boolean)
        .join(' · ');
    }, 'roles');
    renderEntriesHint('educationEntriesHint', profile.educationEntries, function (row) {
      return [row.degree, row.school, row.end || row.endYear].filter(Boolean).join(' · ');
    }, 'degrees');
    renderStructuredBlock(
      'educationStructured',
      'Education (structured)',
      profile.educationEntries && profile.educationEntries.length
        ? profile.educationEntries
        : profile.education,
      function (row) {
        if (typeof row === 'string') return row;
        return formatStructuredItem(row);
      }
    );
    renderStructuredBlock(
      'certificationsStructured',
      'Certifications (structured)',
      profile.certifications,
      function (row) {
        if (typeof row === 'string') return row;
        return formatStructuredItem(row);
      }
    );
    renderCompleteness(profile);
    suppressDirty = false;
    clearDirty();
  }

  /** Structured history is filled from the profile but not editable here. */
  function renderEntriesHint(elementId, entries, describe, noun) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      el.textContent = '';
      return;
    }
    el.textContent =
      list.length + ' structured ' + noun + ' kept with this profile: ' +
      list.map(describe).filter(Boolean).join(' | ');
  }

  function renderCompleteness(profile) {
    const el = document.getElementById('profileCompleteness');
    if (!el || !window.FillApplyProfile || !FillApplyProfile.profileGaps) return;
    const gaps = FillApplyProfile.profileGaps(profile);
    if (!gaps.groups.length) {
      el.textContent = 'Completeness: 100% — every commonly-asked field has an answer.';
      return;
    }
    el.textContent =
      'Completeness: ' + gaps.percent + '% (' + gaps.filled + '/' + gaps.total + '). ' +
      'Still blank — the run pauses and asks rather than guessing: ' +
      gaps.groups
        .map(function (g) {
          return g.group + ' (' + g.missing.join(', ') + ')';
        })
        .join('; ');
  }

  function readForm() {
    // Start from the loaded record so structured entries and answer aliases
    // are not dropped by a form that does not render them.
    const profile = Object.assign({}, loadedProfile || {});
    delete profile.id;
    delete profile.name;
    TEXT_FIELDS.forEach(function (name) {
      const el = form.elements.namedItem(name);
      profile[name] = el ? el.value.trim() : '';
    });
    const previousQA = Array.isArray(loadedProfile && loadedProfile.customQA)
      ? loadedProfile.customQA
      : [];
    profile.customQA = readQA();

    // Keep alias keys, drop answers whose Q&A row the user just removed.
    const answers = {};
    const wasQARow = {};
    previousQA.forEach(function (qa) {
      if (qa && qa.question) wasQARow[qa.question] = true;
    });
    const loadedAnswers = (loadedProfile && loadedProfile.customAnswers) || {};
    Object.keys(loadedAnswers).forEach(function (key) {
      if (!wasQARow[key]) answers[key] = loadedAnswers[key];
    });
    profile.customQA.forEach(function (qa) {
      if (qa.question) answers[qa.question] = qa.answer;
    });
    profile.customAnswers = answers;

    if (profile.postcode && !profile.zip) profile.zip = profile.postcode;
    if (profile.zip && !profile.postcode) profile.postcode = profile.zip;
    return profile;
  }

  function selectedProfileId() {
    return profileSelect && profileSelect.value ? profileSelect.value : null;
  }

  function findMeta(id) {
    for (var i = 0; i < profilesCache.length; i++) {
      if (profilesCache[i].id === id) return profilesCache[i];
    }
    return null;
  }

  function updateActiveLabels() {
    var meta = findMeta(activeIdCache);
    var name = meta ? meta.name : '—';
    if (headerActiveChip) headerActiveChip.textContent = name;
    if (formActiveProfileHint) {
      var selMeta = findMeta(selectedIdCache || activeIdCache);
      formActiveProfileHint.textContent = selMeta ? '(editing: ' + selMeta.name + ')' : '';
    }
  }

  function renderProfileSelect() {
    if (!profileSelect) return;
    var keep = selectedIdCache || activeIdCache;
    profileSelect.innerHTML = '';
    profilesCache.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.id === activeIdCache ? ' (active)' : '');
      profileSelect.appendChild(opt);
    });
    if (keep && findMeta(keep)) {
      profileSelect.value = keep;
      selectedIdCache = keep;
    } else if (activeIdCache) {
      profileSelect.value = activeIdCache;
      selectedIdCache = activeIdCache;
    }
    renderProfileChips();
    updateActiveLabels();
    updateDeleteButtonState();
  }

  function profileIsLocked(p) {
    if (!p) return false;
    if (p.locked || p.systemProfile) return true;
    if (String(p.name || '').trim().toLowerCase() === 'mock') return true;
    if (String(p.id || '') === 'mock') return true;
    if (FillApplyProfile.isLockedProfile && FillApplyProfile.isLockedProfile(p)) return true;
    return false;
  }

  function updateDeleteButtonState() {
    if (!btnProfileDelete) return;
    var meta = findMeta(selectedIdCache || activeIdCache);
    var locked = profileIsLocked(meta);
    btnProfileDelete.disabled = !!locked;
    btnProfileDelete.title = locked
      ? 'Mock profile cannot be deleted. Switch to another profile instead.'
      : 'Delete selected profile';
    if (btnProfileRename) {
      btnProfileRename.disabled = !!locked;
      btnProfileRename.title = locked ? 'Mock cannot be renamed' : 'Rename selected profile';
    }
    if (btnResetMockProfile) {
      btnResetMockProfile.hidden = !locked;
    }
  }

  function profileSortKey(p) {
    var name = String((p && p.name) || '').toLowerCase();
    var isActive = p && p.id === activeIdCache;
    var isMock = FillApplyProfile.isMockName
      ? FillApplyProfile.isMockName(p.name)
      : name === 'mock';
    // Active first, then Mock demo, then imported profiles
    if (isActive) return 0;
    if (isMock) return 1;
    return 50;
  }

  function renderProfileChips() {
    if (!profileChipsEl) return;
    profileChipsEl.innerHTML = '';
    var hierarchy = document.createElement('p');
    hierarchy.className = 'profile-hierarchy-label';
    var activeMeta = findMeta(activeIdCache);
    hierarchy.textContent =
      'Active: ' + ((activeMeta && activeMeta.name) || '—');
    profileChipsEl.appendChild(hierarchy);

    var sorted = profilesCache.slice().sort(function (a, b) {
      var ka = profileSortKey(a);
      var kb = profileSortKey(b);
      if (ka !== kb) return ka - kb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    sorted.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-chip';
      btn.setAttribute('role', 'listitem');
      var locked = profileIsLocked(p);
      var name = String(p.name || '').toLowerCase();
      var isMock = locked || (FillApplyProfile.isMockName && FillApplyProfile.isMockName(p.name));
      if (locked) btn.classList.add('locked');
      if (isMock) btn.classList.add('secondary-profile');
      var label = p.name || 'Untitled';
      if (p.id === activeIdCache) label = '● ' + label;
      if (locked) label += ' 🔒';
      if (isMock) label = label.replace(/🔒/, '').trim() + ' (demo)';
      btn.textContent = label;
      if (p.id === selectedIdCache) btn.classList.add('selected');
      if (p.id === activeIdCache) btn.classList.add('active-mark');
      btn.addEventListener('click', async function () {
        selectedIdCache = p.id;
        profileSelect.value = p.id;
        updateActiveLabels();
        renderProfileChips();
        updateDeleteButtonState();
        try {
          await switchToProfile(p.id);
        } catch (e) {
          setStatus(profileMgrStatus, e.message, 'err');
        }
      });
      profileChipsEl.appendChild(btn);
    });
    /* Create New Profile removed — import-only for real data; Mock is the built-in demo. */
  }

  async function refreshProfilesUI(opts) {
    opts = opts || {};
    profilesCache = await FillApplyProfile.listProfiles();
    activeIdCache = await FillApplyProfile.getActiveProfileId();
    if (opts.selectId) selectedIdCache = opts.selectId;
    else if (!selectedIdCache) selectedIdCache = activeIdCache;
    renderProfileSelect();
    if (opts.loadForm !== false) {
      var profile = await FillApplyProfile.getProfile();
      fillForm(profile);
    }
  }

  async function switchToProfile(id, force) {
    if (!id) return;
    if (id === activeIdCache && !force) {
      selectedIdCache = id;
      var profileSame = await FillApplyProfile.getProfileById
        ? await FillApplyProfile.getProfileById(id)
        : await FillApplyProfile.getProfile();
      if (profileSame) fillForm(profileSame);
      updateActiveLabels();
      renderProfileChips();
      return;
    }
    if (!confirmIfDirty('You have unsaved changes. Discard them and switch profile?')) {
      profileSelect.value = selectedIdCache || activeIdCache;
      renderProfileChips();
      return;
    }
    await FillApplyProfile.setActiveProfile(id);
    activeIdCache = id;
    selectedIdCache = id;
    var profile = await FillApplyProfile.getProfile();
    fillForm(profile);
    renderProfileSelect();
    setStatus(profileMgrStatus, 'Active profile: ' + (findMeta(id) || {}).name, 'ok');
  }

  async function createNewProfile() {
    if (!confirmIfDirty('You have unsaved changes. Discard them and create a new profile?')) return;
    var name = prompt('New profile name:', 'New profile');
    if (name == null) return;
    name = String(name).trim();
    if (!name) {
      setStatus(profileMgrStatus, 'Name required.', 'err');
      return;
    }
    try {
      var meta = await FillApplyProfile.createProfile(name);
      activeIdCache = meta.id;
      selectedIdCache = meta.id;
      await refreshProfilesUI({ selectId: meta.id });
      var settings = document.getElementById('sec-profile-settings');
      if (settings) settings.open = true;
      setStatus(profileMgrStatus, 'Created and activated "' + meta.name + '".', 'ok');
    } catch (e) {
      setStatus(profileMgrStatus, e.message, 'err');
    }
  }

  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var data = readForm();
      await FillApplyProfile.saveProfile(data);
      loadedProfile = Object.assign({}, loadedProfile || {}, data);
      renderCompleteness(data);
      // Mirror resume/cover URLs onto documents links when set
      try {
        var patch = {};
        if (data.resumeUrl) patch.resumeLink = data.resumeUrl;
        if (data.coverUrl) patch.coverLink = data.coverUrl;
        if (Object.keys(patch).length) {
          await FillApplyStorage.saveDocuments(patch);
          var linkEl = document.getElementById('resumeLink');
          var coverEl = document.getElementById('coverLink');
          if (linkEl && data.resumeUrl) linkEl.value = data.resumeUrl;
          if (coverEl && data.coverUrl) coverEl.value = data.coverUrl;
          await refreshDocsMeta();
        }
      } catch (_e) { /* ignore */ }
      clearDirty();
      setStatus(statusEl, 'Saved to active profile.', 'ok');
      await refreshProfilesUI({ loadForm: false, selectId: activeIdCache });
    } catch (err) {
      setStatus(statusEl, 'Save failed: ' + err.message, 'err');
    }
  });

  btnAddQA.addEventListener('click', function () {
    addQARow('', '');
    markDirty();
  });

  btnSeed.addEventListener('click', async function () {
    fillForm(FillApplyProfile.SAMPLE_PROFILE);
    markDirty();
    setStatus(statusEl, 'Sample loaded into active form — click Save to persist.', 'ok');
  });

  btnReset.addEventListener('click', async function () {
    if (!confirm('Clear fields on the active profile?')) return;
    try {
      await FillApplyProfile.saveProfile(Object.assign({}, FillApplyProfile.DEFAULT_PROFILE));
      fillForm(FillApplyProfile.DEFAULT_PROFILE);
      setStatus(statusEl, 'Cleared active profile fields.', 'ok');
    } catch (err) {
      setStatus(statusEl, err.message, 'err');
    }
  });

  if (btnProfileRename) {
    btnProfileRename.addEventListener('click', async function () {
      var id = selectedProfileId();
      var meta = findMeta(id);
      if (!meta) return;
      var name = prompt('Rename profile:', meta.name);
      if (name == null) return;
      name = String(name).trim();
      if (!name) {
        setStatus(profileMgrStatus, 'Name required.', 'err');
        return;
      }
      try {
        await FillApplyProfile.renameProfile(id, name);
        await refreshProfilesUI({ loadForm: false, selectId: id });
        setStatus(profileMgrStatus, 'Renamed to "' + name + '".', 'ok');
      } catch (e) {
        setStatus(profileMgrStatus, e.message, 'err');
      }
    });
  }

  if (btnProfileDuplicate) {
    btnProfileDuplicate.addEventListener('click', async function () {
      if (!confirmIfDirty('You have unsaved changes. Discard them and duplicate?')) return;
      var id = selectedProfileId();
      if (!id) return;
      try {
        var meta = await FillApplyProfile.duplicateProfile(id);
        activeIdCache = meta.id;
        selectedIdCache = meta.id;
        await refreshProfilesUI({ selectId: meta.id });
        setStatus(profileMgrStatus, 'Duplicated as "' + meta.name + '" (now active).', 'ok');
      } catch (e) {
        setStatus(profileMgrStatus, e.message, 'err');
      }
    });
  }

  if (btnProfileSetActive) {
    btnProfileSetActive.addEventListener('click', async function () {
      var id = selectedProfileId();
      try {
        await switchToProfile(id, true);
      } catch (e) {
        setStatus(profileMgrStatus, e.message, 'err');
      }
    });
  }

  if (btnProfileDelete) {
    btnProfileDelete.addEventListener('click', async function () {
      var id = selectedProfileId();
      var meta = findMeta(id);
      if (!meta) return;
      if (profileIsLocked(meta)) {
        setStatus(
          profileMgrStatus,
          'Mock profile cannot be deleted. Switch to another profile instead.',
          'err'
        );
        return;
      }
      if (profilesCache.length <= 1) {
        setStatus(profileMgrStatus, 'Cannot delete the last profile.', 'err');
        return;
      }
      if (!confirm('Delete profile "' + meta.name + '"? This cannot be undone.')) return;
      try {
        var result = await FillApplyProfile.deleteProfile(id);
        selectedIdCache = result.activeId;
        activeIdCache = result.activeId;
        await refreshProfilesUI({ selectId: result.activeId });
        setStatus(profileMgrStatus, 'Deleted "' + meta.name + '".', 'ok');
      } catch (e) {
        setStatus(profileMgrStatus, e.message, 'err');
      }
    });
  }

  if (btnResetMockProfile) {
    btnResetMockProfile.addEventListener('click', async function () {
      if (!confirmIfDirty('You have unsaved changes. Discard them and Reset Mock?')) return;
      try {
        var profile = await FillApplyProfile.resetMockProfile();
        activeIdCache = profile.id;
        selectedIdCache = profile.id;
        await refreshProfilesUI({ selectId: profile.id });
        clearDirty();
        setStatus(profileMgrStatus, 'Mock profile reset to sample (locked).', 'ok');
        setStatus(statusEl, 'Mock reseeded from SAMPLE + source answers.', 'ok');
        if (typeof refreshSourceProfilesUI === 'function') {
          await refreshSourceProfilesUI();
        }
      } catch (e) {
        setStatus(profileMgrStatus, e.message, 'err');
      }
    });
  }

  // Create/Reset Zahid shell removed from store UI — import private profile JSON instead.

  if (btnExportProfile) {
    btnExportProfile.addEventListener('click', async function () {
      try {
        if (!globalThis.FillApplyProfileIO) {
          setStatus(profileMgrStatus, 'Profile export module not loaded.', 'err');
          return;
        }
        var bundled = await FillApplyProfileIO.downloadExport();
        var kc =
          bundled.payload && bundled.payload.knowledge && Array.isArray(bundled.payload.knowledge.records)
            ? bundled.payload.knowledge.records.length
            : 0;
        setStatus(
          profileMgrStatus,
          'Exported ' +
            bundled.filename +
            ' (profile + ' +
            kc +
            ' knowledge fact' +
            (kc === 1 ? '' : 's') +
            ').',
          'ok'
        );
      } catch (e) {
        setStatus(profileMgrStatus, e.message || String(e), 'err');
      }
    });
  }

  if (btnImportProfile && importProfileFile) {
    btnImportProfile.addEventListener('click', function () {
      if (!confirmIfDirty('You have unsaved changes. Discard them and import a profile?')) return;
      importProfileFile.value = '';
      importProfileFile.click();
    });
    importProfileFile.addEventListener('change', async function () {
      var file = importProfileFile.files && importProfileFile.files[0];
      if (!file) return;
      try {
        if (!globalThis.FillApplyProfileIO) {
          setStatus(profileMgrStatus, 'Profile import module not loaded.', 'err');
          return;
        }
        var text = await file.text();
        var checked = FillApplyProfileIO.validateImportPayload(text);
        if (!checked.ok) {
          setStatus(
            profileMgrStatus,
            'Import blocked (no changes applied): ' + (checked.errors || []).join(' '),
            'err'
          );
          return;
        }
        var result = await FillApplyProfileIO.importPayload(text, { activate: true });
        if (!result.ok) {
          setStatus(
            profileMgrStatus,
            'Import failed (no changes applied): ' + (result.errors || []).join(' '),
            'err'
          );
          return;
        }
        activeIdCache = result.profileId;
        selectedIdCache = result.profileId;
        await refreshProfilesUI({ selectId: result.profileId });
        clearDirty();
        if (typeof refreshKnowledgeUI === 'function') {
          try {
            await refreshKnowledgeUI();
          } catch (_k) { /* optional */ }
        } else if (globalThis.FillApplyKnowledgeUI && FillApplyKnowledgeUI.refresh) {
          try {
            await FillApplyKnowledgeUI.refresh();
          } catch (_k2) { /* optional */ }
        }
        setStatus(
          profileMgrStatus,
          'Imported "' +
            (result.profileName || 'profile') +
            '": ' +
            (result.fieldsRestored || 0) +
            ' profile fields, ' +
            (result.knowledgeImported || 0) +
            ' knowledge fact' +
            ((result.knowledgeImported || 0) === 1 ? '' : 's') +
            ' restored' +
            (result.activated ? ' (active).' : '.'),
          'ok'
        );
        setStatus(statusEl, 'Profile import complete — ready to fill.', 'ok');
      } catch (e) {
        setStatus(profileMgrStatus, e.message || String(e), 'err');
      }
    });
  }

  async function loadConfig() {
    const cfg = await FillApplyStorage.getRunConfig();
    document.getElementById('backendBaseUrl').value = cfg.backendBaseUrl || '';
    document.getElementById('mockMode').checked = !!cfg.mockMode;
    document.getElementById('delaySec').value = String(Math.round((cfg.delayMs || 0) / 1000));
    var aminEl = document.getElementById('actionDelayMinMs');
    var amaxEl = document.getElementById('actionDelayMaxMs');
    if (aminEl) aminEl.value = String(cfg.actionDelayMinMs != null ? cfg.actionDelayMinMs : 400);
    if (amaxEl) amaxEl.value = String(cfg.actionDelayMaxMs != null ? cfg.actionDelayMaxMs : 900);
    var fhEl = document.getElementById('focusHud');
    if (fhEl) fhEl.checked = cfg.focusHud !== false;
    const mode = cfg.runMode || (cfg.autoSubmit ? 'submit' : 'fill');
    document.getElementById('runMode').value = mode;
    document.getElementById('autoCloseAppliedTab').checked = cfg.autoCloseAppliedTab !== false;
    const keepEl = document.getElementById('keepRecentTabs');
    if (keepEl) keepEl.value = String(cfg.keepRecentTabs != null ? cfg.keepRecentTabs : 5);
    const pdfEl = document.getElementById('autoPdfReport');
    if (pdfEl) pdfEl.checked = cfg.autoPdfReport !== false;
    const lim = cfg.sourceApplyLimits || {};
    function setCap(id, key) {
      const el = document.getElementById(id);
      if (!el) return;
      const v = lim[key] != null ? lim[key] : 2;
      el.value = String(Math.min(3, Math.max(1, Number(v) || 2)));
    }
    setCap('capAshby', 'ashby');
    setCap('capIndeed', 'indeed');
    setCap('capGreenhouse', 'greenhouse');
    setCap('capLever', 'lever');
    setCap('capDefault', 'default');
  }

  async function loadMockUrls() {
    const urls = await FillApplyStorage.getMockQueueUrls();
    mockQueueUrlsEl.value = urls.join('\n');
    mockUrlsMeta.textContent = urls.length
      ? urls.length + ' https URL(s) configured — Start (Batch) serves these into Queued.'
      : 'No URLs yet — Batch Start will prompt to fill the current page or open App Settings queue.';
  }

  async function refreshBucketCounts() {
    try {
      const data = await send('FILL_APPLY_GET_BUCKETS');
      const c = data.counts || {};
      bucketCountsEl.textContent =
        'Buckets — Queued: ' +
        (c.queued || 0) +
        ' · Applied: ' +
        (c.applied || 0) +
        ' · Failed: ' +
        (c.failed || 0) +
        ' · Cancelled: ' +
        (c.cancelled || 0);
    } catch (_e) {
      bucketCountsEl.textContent = '';
    }
  }

  function formatLogEntry(entry) {
    if (!entry) return '';
    var ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
    var parts = [];
    if (entry.type) parts.push(entry.type);
    if (entry.jobId) parts.push('job=' + entry.jobId);
    if (entry.title) parts.push(entry.title);
    if (entry.url) parts.push(String(entry.url).slice(0, 60));
    if (entry.error) parts.push('err: ' + entry.error);
    if (entry.message) parts.push(entry.message);
    if (entry.ms != null) parts.push(entry.ms + 'ms');
    if (entry.mode) parts.push('mode=' + entry.mode);
    if (!parts.length) {
      try { parts.push(JSON.stringify(entry)); } catch (_e) { parts.push(String(entry)); }
    }
    return { ts: ts, text: parts.join(' · ') };
  }

  async function refreshRealtimeLog() {
    if (!realtimeLogEl) return;
    try {
      var log = await FillApplyStorage.getSessionLog();
      var slice = (log || []).slice(-40);
      if (!slice.length) {
        realtimeLogEl.innerHTML = '<p class="empty">No session events yet — Start the runner to see live activity.</p>';
        return;
      }
      realtimeLogEl.innerHTML = slice
        .map(function (e) {
          var f = formatLogEntry(e);
          return (
            '<p class="log-line"><span class="log-ts">' +
            f.ts +
            '</span>' +
            f.text.replace(/</g, '&lt;') +
            '</p>'
          );
        })
        .join('');
      realtimeLogEl.scrollTop = realtimeLogEl.scrollHeight;
    } catch (_e) {
      /* ignore */
    }
  }

  if (btnClearSessionLog) {
    btnClearSessionLog.addEventListener('click', async function () {
      try {
        await FillApplyStorage.clearSessionLog();
        await refreshRealtimeLog();
      } catch (e) {
        setStatus(mockUrlsStatus, e.message, 'err');
      }
    });
  }

  btnSaveConfig.addEventListener('click', async function () {
    try {
      const sec = Number(document.getElementById('delaySec').value);
      const runMode = document.getElementById('runMode').value || 'fill';
      const keepRaw = Number(document.getElementById('keepRecentTabs').value);
      const keep = Number.isFinite(keepRaw) ? Math.min(10, Math.max(3, Math.round(keepRaw))) : 5;
      function readCap(id) {
        const raw = Number(document.getElementById(id).value);
        if (!Number.isFinite(raw)) return 2;
        return Math.min(3, Math.max(1, Math.round(raw)));
      }
      const sourceApplyLimits = {
        ashby: readCap('capAshby'),
        indeed: readCap('capIndeed'),
        greenhouse: readCap('capGreenhouse'),
        lever: readCap('capLever'),
        default: readCap('capDefault')
      };
      var aminRaw = Number((document.getElementById('actionDelayMinMs') || {}).value);
      var amaxRaw = Number((document.getElementById('actionDelayMaxMs') || {}).value);
      var amin = Number.isFinite(aminRaw) && aminRaw >= 0 ? Math.round(aminRaw) : 400;
      var amax = Number.isFinite(amaxRaw) && amaxRaw >= 0 ? Math.round(amaxRaw) : 900;
      if (amax < amin) { var sw = amin; amin = amax; amax = sw; }
      var focusHudEl = document.getElementById('focusHud');
      const next = await FillApplyStorage.saveRunConfig({
        backendBaseUrl: document.getElementById('backendBaseUrl').value.trim(),
        mockMode: document.getElementById('mockMode').checked,
        delayMs: (Number.isFinite(sec) && sec >= 0 ? sec : 3) * 1000,
        runMode: runMode,
        autoSubmit: runMode === 'submit',
        autoCloseAppliedTab: document.getElementById('autoCloseAppliedTab').checked,
        keepRecentTabs: keep,
        autoPdfReport: document.getElementById('autoPdfReport').checked,
        sourceApplyLimits: sourceApplyLimits,
        actionDelayMinMs: amin,
        actionDelayMaxMs: amax,
        focusHud: focusHudEl ? !!focusHudEl.checked : true
      });
      document.getElementById('keepRecentTabs').value = String(next.keepRecentTabs);
      const L = next.sourceApplyLimits || sourceApplyLimits;
      document.getElementById('capAshby').value = String(L.ashby);
      document.getElementById('capIndeed').value = String(L.indeed);
      document.getElementById('capGreenhouse').value = String(L.greenhouse);
      document.getElementById('capLever').value = String(L.lever);
      document.getElementById('capDefault').value = String(L.default);
      setStatus(
        configStatus,
        'Config saved (mode ' + next.runMode + '; delay ' + next.delayMs + 'ms).',
        'ok'
      );
    } catch (e) {
      setStatus(configStatus, e.message, 'err');
    }
  });

  btnSaveMockUrls.addEventListener('click', async function () {
    try {
      const data = await send('FILL_APPLY_SAVE_MOCK_URLS', {
        urlsText: mockQueueUrlsEl.value
      });
      mockQueueUrlsEl.value = (data.urls || []).join('\n');
      mockUrlsMeta.textContent = data.remaining
        ? data.remaining + ' job(s) in queued from saved https URLs.'
        : 'No valid https URLs — add Target apply URLs above.';
      setStatus(
        mockUrlsStatus,
        data.remaining
          ? 'Saved ' + data.urls.length + ' URL(s); queued rebuilt.'
          : 'Saved, but queued is empty (need https:// URLs).',
        data.remaining ? 'ok' : 'err'
      );
      await refreshBucketCounts();
    } catch (e) {
      setStatus(mockUrlsStatus, e.message, 'err');
    }
  });

  btnResetMock.addEventListener('click', async function () {
    if (
      !confirm(
        'Clear all Application queue URLs and empty the queued list? Applied history is kept.'
      )
    ) {
      return;
    }
    try {
      const data = await send('FILL_APPLY_RESET_MOCK');
      mockQueueUrlsEl.value = '';
      setStatus(mockUrlsStatus, 'Queue and URLs cleared. Applied history kept.', 'ok');
      mockUrlsMeta.textContent = 'No URLs configured.';
      await refreshBucketCounts();
      void data;
    } catch (e) {
      setStatus(mockUrlsStatus, e.message, 'err');
    }
  });

  btnClearHistory.addEventListener('click', async function () {
    if (!confirm('Clear applied / failed / cancelled history? Queued is unchanged.')) return;
    try {
      await send('FILL_APPLY_CLEAR_HISTORY');
      setStatus(mockUrlsStatus, 'History cleared.', 'ok');
      await refreshBucketCounts();
    } catch (e) {
      setStatus(mockUrlsStatus, e.message, 'err');
    }
  });

  async function refreshDocsMeta() {
    const docs = await FillApplyStorage.getDocuments();
    const parts = [];
    if (docs.resume && docs.resume.name) {
      parts.push('Resume: ' + docs.resume.name + ' (' + ((docs.resume.base64 || '').length) + ' b64 chars)');
    } else parts.push('Resume: none');
    if (docs.cover && docs.cover.name) {
      parts.push('Cover: ' + docs.cover.name + ' (' + ((docs.cover.base64 || '').length) + ' b64 chars)');
    } else parts.push('Cover: none');
    if (docs.resumeLink) parts.push('Resume link set');
    if (docs.coverLink) parts.push('Cover link set');
    docsMeta.textContent = parts.join(' · ') + ' · Shared across profiles';
    var resumeLinkEl = document.getElementById('resumeLink');
    var coverLinkEl = document.getElementById('coverLink');
    if (resumeLinkEl && document.activeElement !== resumeLinkEl) {
      resumeLinkEl.value = docs.resumeLink || '';
    }
    if (coverLinkEl && document.activeElement !== coverLinkEl) {
      coverLinkEl.value = docs.coverLink || '';
    }
  }

  async function readFileAsDoc(fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return null;
    const base64 = await FillApplyFiles.blobToBase64(file);
    return { name: file.name, mime: file.type || 'application/octet-stream', base64: base64 };
  }

  btnSaveDocs.addEventListener('click', async function () {
    try {
      const patch = {};
      const resume = await readFileAsDoc(document.getElementById('resumeFile'));
      const cover = await readFileAsDoc(document.getElementById('coverFile'));
      if (resume) patch.resume = resume;
      if (cover) patch.cover = cover;
      const resumeLink = (document.getElementById('resumeLink').value || '').trim();
      const coverLink = (document.getElementById('coverLink').value || '').trim();
      patch.resumeLink = resumeLink;
      patch.coverLink = coverLink;
      if (!resume && !cover && !resumeLink && !coverLink) {
        setStatus(docsStatus, 'Choose a file or paste a Drive/URL first.', 'err');
        return;
      }
      await FillApplyStorage.saveDocuments(patch);
      // Also mirror onto active profile URL fields when links provided
      try {
        if (resumeLink || coverLink) {
          var cur = await FillApplyProfile.getProfile();
          var upd = {};
          var changed = false;
          if (resumeLink && resumeLink !== (cur.resumeUrl || '')) {
            upd.resumeUrl = resumeLink;
            changed = true;
          }
          if (coverLink && coverLink !== (cur.coverUrl || '')) {
            upd.coverUrl = coverLink;
            changed = true;
          }
          if (changed) {
            await FillApplyProfile.saveProfile(Object.assign({}, cur, upd));
            if (upd.resumeUrl && form.elements.namedItem('resumeUrl')) {
              form.elements.namedItem('resumeUrl').value = upd.resumeUrl;
            }
            if (upd.coverUrl && form.elements.namedItem('coverUrl')) {
              form.elements.namedItem('coverUrl').value = upd.coverUrl;
            }
          }
        }
      } catch (_e) { /* ignore */ }
      await refreshDocsMeta();
      setStatus(docsStatus, 'Documents saved.', 'ok');
    } catch (e) {
      setStatus(docsStatus, e.message, 'err');
    }
  });

  btnClearDocs.addEventListener('click', async function () {
    if (!confirm('Clear stored resume/cover blobs and links?')) return;
    await FillApplyStorage.saveDocuments({
      resume: null,
      cover: null,
      resumeLink: '',
      coverLink: ''
    });
    document.getElementById('resumeFile').value = '';
    document.getElementById('coverFile').value = '';
    document.getElementById('resumeLink').value = '';
    document.getElementById('coverLink').value = '';
    await refreshDocsMeta();
    setStatus(docsStatus, 'Documents cleared.', 'ok');
  });

  initSections().catch(function () {});

  refreshProfilesUI()
    .catch(function (err) {
      setStatus(statusEl, 'Load failed: ' + err.message, 'err');
      fillForm(FillApplyProfile.DEFAULT_PROFILE);
    });

  loadConfig().catch(function (e) { setStatus(configStatus, e.message, 'err'); });
  loadMockUrls().catch(function (e) { setStatus(mockUrlsStatus, e.message, 'err'); });
  refreshDocsMeta().catch(function () {});
  refreshBucketCounts().catch(function () {});
  refreshRealtimeLog().catch(function () {});
  setInterval(function () {
    refreshRealtimeLog().catch(function () {});
    refreshBucketCounts().catch(function () {});
  }, 2000);

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes['fillApply.sessionLog']) refreshRealtimeLog().catch(function () {});
    });
  }


  /* ---- Application database (collapsible field groups) ---- */
  async function refreshApplicationDatabase() {
    var listEl = document.getElementById('appDbList');
    var emptyEl = document.getElementById('appDbEmpty');
    var statusEl = document.getElementById('appDbStatus');
    if (!listEl) return;
    try {
      var data = await send('FILL_APPLY_GET_REPORTS');
      var reports = (data && data.reports) || [];
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = reports.length > 0;
      if (!reports.length) {
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.className = 'status';
        }
        return;
      }
      var Report = globalThis.FillApplyReport;
      reports
        .slice()
        .reverse()
        .forEach(function (r) {
          var card = document.createElement('details');
          card.className = 'app-db-card';
          var sum = document.createElement('summary');
          sum.textContent =
            (r.title || r.company || 'Application') +
            (r.company && r.title ? ' · ' + r.company : '') +
            ' · ' +
            (r.status || 'submitted');
          card.appendChild(sum);
          var meta = document.createElement('p');
          meta.className = 'app-db-meta';
          meta.textContent =
            (r.url || '') +
            (r.timestamp ? ' · ' + new Date(r.timestamp).toLocaleString() : '');
          card.appendChild(meta);
          var groups =
            Report && Report.groupApplicationFields
              ? Report.groupApplicationFields(r.fields || {})
              : [{ group: 'Other', fields: Object.keys(r.fields || {}).map(function (k) {
                  return { label: k, value: r.fields[k] };
                }) }];
          groups.forEach(function (g) {
            var det = document.createElement('details');
            det.className = 'app-db-group';
            // Compact by default — do not set open
            var gsum = document.createElement('summary');
            gsum.textContent = g.group + ' (' + g.fields.length + ')';
            det.appendChild(gsum);
            var table = document.createElement('table');
            table.className = 'app-db-table';
            g.fields.forEach(function (f) {
              var tr = document.createElement('tr');
              var td1 = document.createElement('td');
              td1.textContent = f.label;
              var td2 = document.createElement('td');
              td2.textContent = f.value;
              tr.appendChild(td1);
              tr.appendChild(td2);
              table.appendChild(tr);
            });
            det.appendChild(table);
            card.appendChild(det);
          });
          listEl.appendChild(card);
        });
      if (statusEl) {
        statusEl.textContent = reports.length + ' report(s)';
        statusEl.className = 'status ok';
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = e && e.message ? e.message : String(e);
        statusEl.className = 'status err';
      }
    }
  }

  var btnAppDbRefresh = document.getElementById('btnAppDbRefresh');
  if (btnAppDbRefresh) {
    btnAppDbRefresh.addEventListener('click', function () {
      refreshApplicationDatabase();
    });
  }
  // Lazy load when section opened
  var secAppDb = document.getElementById('sec-app-db');
  if (secAppDb) {
    secAppDb.addEventListener('toggle', function () {
      if (secAppDb.open) refreshApplicationDatabase();
    });
  }


  const btnLastReport = document.getElementById('btnLastReport');
  const reportStatus = document.getElementById('reportStatus');
  if (btnLastReport) {
    btnLastReport.addEventListener('click', async function () {
      try {
        const data = await send('FILL_APPLY_GET_LAST_REPORT');
        const r = data && data.report;
        if (!r) {
          setStatus(reportStatus, 'No submitted reports yet.', 'warn');
          return;
        }
        setStatus(
          reportStatus,
          'Last: ' +
            (r.company || r.title || r.jobId || r.id) +
            (r.filename ? ' → Downloads/' + r.filename : '') +
            (r.timestamp ? ' @ ' + new Date(r.timestamp).toLocaleString() : ''),
          'ok'
        );
      } catch (e) {
        setStatus(reportStatus, e.message, 'err');
      }
    });
  }


  // --- Source selection & profiles ---
  function optionValue(opt) {
    if (opt && typeof opt === 'object') return String(opt.value);
    return String(opt);
  }
  function optionLabel(opt) {
    if (opt && typeof opt === 'object') return String(opt.label || opt.value);
    return String(opt);
  }

  function renderSourceFields(def, answers) {
    if (!sourceFieldsForm) return;
    sourceFieldsForm.innerHTML = '';
    if (!def) {
      sourceFieldsForm.innerHTML = '<p class="hint">Select a source to edit compulsory fields.</p>';
      return;
    }
    answers = answers || {};
    (def.requiredFields || []).forEach(function (f) {
      var wrap = document.createElement('label');
      var req = f.compulsory !== false;
      wrap.innerHTML = '';
      var title = document.createElement('span');
      title.innerHTML = (f.label || f.key) + (req ? ' <span class="req">*</span>' : '');
      wrap.appendChild(title);
      var control;
      var val = answers[f.key] != null ? answers[f.key] : '';
      if (f.type === 'textarea') {
        control = document.createElement('textarea');
        control.rows = 3;
        control.value = val;
      } else if (f.type === 'select') {
        control = document.createElement('select');
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '—';
        control.appendChild(blank);
        (f.options || []).forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = optionValue(o);
          opt.textContent = optionLabel(o);
          if (String(opt.value) === String(val) || String(optionLabel(o)) === String(val)) {
            opt.selected = true;
          }
          control.appendChild(opt);
        });
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.value = val;
      }
      control.dataset.fieldKey = f.key;
      control.name = 'src_' + f.key;
      wrap.appendChild(control);
      sourceFieldsForm.appendChild(wrap);
    });
  }

  function readSourceFieldsFromForm() {
    var out = {};
    if (!sourceFieldsForm) return out;
    sourceFieldsForm.querySelectorAll('[data-field-key]').forEach(function (el) {
      out[el.dataset.fieldKey] = el.value;
    });
    return out;
  }

  async function refreshSourceProfilesUI() {
    if (!globalThis.FillApplySourceProfiles) return;
    var SP = FillApplySourceProfiles;
    await SP.ensureSourceProfileShells();
    var sources = SP.listSources();
    var selected = await SP.getSelectedSourceId();
    if (selectedSourceIdEl) {
      var prev = selectedSourceIdEl.value;
      selectedSourceIdEl.innerHTML = '';
      var none = document.createElement('option');
      none.value = 'none';
      none.textContent = 'None (no gate)';
      selectedSourceIdEl.appendChild(none);
      sources.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        selectedSourceIdEl.appendChild(opt);
      });
      selectedSourceIdEl.value = selected || (prev && prev !== 'none' ? prev : 'none');
      if (!selected) selectedSourceIdEl.value = 'none';
      else selectedSourceIdEl.value = selected;
    }
    var sid = selectedSourceIdEl && selectedSourceIdEl.value !== 'none' ? selectedSourceIdEl.value : selected;
    if (!sid || sid === 'none') {
      if (sourceCompletenessMeter) {
        sourceCompletenessMeter.textContent = 'Completeness: no source selected (gate off)';
        sourceCompletenessMeter.classList.remove('incomplete');
      }
      if (sourceNoteEl) sourceNoteEl.textContent = '';
      renderSourceFields(null, {});
      return;
    }
    var def = SP.getSourceDef(sid);
    var sp = await SP.getSourceProfile(sid);
    var base = await FillApplyProfile.getProfile();
    var c = await SP.getCompleteness(sid, base);
    if (sourceCompletenessMeter) {
      sourceCompletenessMeter.textContent =
        'Completeness: ' + c.filled + '/' + c.total + (c.complete ? ' ✓' : ' — incomplete');
      sourceCompletenessMeter.classList.toggle('incomplete', !c.complete);
    }
    if (sourceNoteEl) {
      sourceNoteEl.textContent = def && def.note ? def.note : '';
    }
    renderSourceFields(def, (sp && sp.answers) || {});
  }

  if (selectedSourceIdEl) {
    selectedSourceIdEl.addEventListener('change', async function () {
      try {
        var v = selectedSourceIdEl.value;
        await FillApplySourceProfiles.setSelectedSourceId(v === 'none' ? null : v);
        await refreshSourceProfilesUI();
        setStatus(sourceProfileStatus, v === 'none' ? 'Source gate off.' : 'Selected ' + v + '.', 'ok');
      } catch (e) {
        setStatus(sourceProfileStatus, e.message, 'err');
      }
    });
  }

  if (btnSaveSourceProfile) {
    btnSaveSourceProfile.addEventListener('click', async function () {
      try {
        var sid = selectedSourceIdEl && selectedSourceIdEl.value;
        if (!sid || sid === 'none') {
          setStatus(sourceProfileStatus, 'Select a source first.', 'warn');
          return;
        }
        var answers = readSourceFieldsFromForm();
        await FillApplySourceProfiles.saveSourceProfileAnswers(sid, answers);
        await refreshSourceProfilesUI();
        setStatus(sourceProfileStatus, 'Source answers saved.', 'ok');
      } catch (e) {
        setStatus(sourceProfileStatus, e.message, 'err');
      }
    });
  }

  if (btnClearSourceProfile) {
    btnClearSourceProfile.addEventListener('click', async function () {
      try {
        var sid = selectedSourceIdEl && selectedSourceIdEl.value;
        if (!sid || sid === 'none') {
          setStatus(sourceProfileStatus, 'Select a source first.', 'warn');
          return;
        }
        if (!confirm('Clear all answers for ' + sid + '?')) return;
        await FillApplySourceProfiles.clearSourceProfileAnswers(sid);
        await refreshSourceProfilesUI();
        setStatus(sourceProfileStatus, 'Source answers cleared.', 'ok');
      } catch (e) {
        setStatus(sourceProfileStatus, e.message, 'err');
      }
    });
  }

  if (btnCopySourceFromProfile) {
    btnCopySourceFromProfile.addEventListener('click', async function () {
      try {
        var sid = selectedSourceIdEl && selectedSourceIdEl.value;
        if (!sid || sid === 'none') {
          setStatus(sourceProfileStatus, 'Select a source first.', 'warn');
          return;
        }
        await FillApplySourceProfiles.copyFromActiveProfile(sid);
        await refreshSourceProfilesUI();
        setStatus(sourceProfileStatus, 'Copied from active profile.', 'ok');
      } catch (e) {
        setStatus(sourceProfileStatus, e.message, 'err');
      }
    });
  }

  if (btnSeedMockSources) {
    btnSeedMockSources.addEventListener('click', async function () {
      try {
        await FillApplySourceProfiles.seedMockSourceProfiles();
        await refreshSourceProfilesUI();
        setStatus(sourceProfileStatus, 'Mock source answers seeded for all platforms.', 'ok');
      } catch (e) {
        setStatus(sourceProfileStatus, e.message, 'err');
      }
    });
  }

  // Deep-link: open source section when hash is #sec-source-profiles
  try {
    if (location.hash === '#sec-source-profiles') {
      var sec = document.getElementById('sec-source-profiles');
      if (sec) {
        sec.open = true;
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  } catch (_h) { /* ignore */ }

  refreshSourceProfilesUI().catch(function (e) {
    if (sourceProfileStatus) setStatus(sourceProfileStatus, e.message, 'err');
  });

  try {
    var man = chrome.runtime.getManifest && chrome.runtime.getManifest();
    if (man && man.version) {
      var verEl = document.getElementById('extVersion');
      if (verEl) verEl.textContent = 'v' + man.version;
    }
  } catch (_e) { /* ignore */ }
})();
