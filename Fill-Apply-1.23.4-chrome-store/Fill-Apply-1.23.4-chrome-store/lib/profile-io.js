/**
 * Versioned applicant profile + adaptive knowledge import/export.
 *
 * Format: fill-apply-profile (schemaVersion 1)
 *   { format, schemaVersion, exportedAt, meta, profile, knowledge, adaptiveDictionary? }
 *   adaptiveDictionary is a documented synonym of knowledge (same shape); export includes
 *   both; import accepts either (or both — knowledge wins on key collision).
 *
 * Export includes the active profile fields and accumulated adaptive KB
 * (keys / aliases / types / values). Excludes secrets, OAuth tokens,
 * passwords, CAPTCHA / runtime / DOM state, ATS account credentials.
 *
 * Import (v1.18.7): persists apply-time `password` / confirm / retype email
 * aliases into the same profile store the fill engine reads (chrome.storage
 * profile record). These are client-provided career-site credentials for
 * autonomous signup/login — not exported again (export still strips them).
 * Documented in docs/PROFILE_IMPORT_EXPORT.md and README.
 *
 * Import validates the full payload before any write. On success it restores
 * profile + knowledge, optionally activates Zahid, and persists so the result
 * survives reload. Unsupported schema → clear error, no corruption.
 *
 * Attaches globalThis.FillApplyProfileIO
 */
(function (global) {
  'use strict';

  var FORMAT = 'fill-apply-profile';
  var SCHEMA_VERSION = 1;
  var SUPPORTED_SCHEMA_VERSIONS = [1, 2];

  /** Keys that must never appear in an export (defense in depth). */
  var SECRET_KEY_RE =
    /^(password|passwd|pwd|secret|token|accessToken|refreshToken|idToken|oauth|clientSecret|apiKey|api_key|cookie|cookies|session|captcha|recaptcha|turnstile|__adaptiveKnowledge|__dom|__runtime|rawHtml|pageHtml)$/i;

  var SECRET_NESTED_RE =
    /(password|passwd|token|secret|oauth|cookie|captcha|credential)/i;

  /**
   * Apply-time career signup/login credentials. Stripped on export; preserved
   * on import into the active profile store so FillApplySignupLogin can read them.
   * Never learned from the page into adaptive KB.
   */
  var APPLY_CREDENTIAL_KEYS = [
    'password',
    'passwd',
    'pwd',
    'confirm_password',
    'retype_password',
    'choose_password',
    'account_password',
    'passwordConfirm',
    'password_confirm',
    'confirm_email',
    'retype_email',
    'emailConfirm',
    'email_confirm'
  ];

  function extractApplyCredentials(raw) {
    var out = { top: {}, customAnswers: {} };
    if (!isPlainObject(raw)) return out;
    APPLY_CREDENTIAL_KEYS.forEach(function (k) {
      if (raw[k] != null && String(raw[k]).trim() !== '') {
        out.top[k] = String(raw[k]);
      }
    });
    // Alias: bare password → also mirror confirm/retype when only password set
    if (out.top.password) {
      if (!out.top.confirm_password) out.top.confirm_password = out.top.password;
      if (!out.top.retype_password) out.top.retype_password = out.top.password;
    }
    if (out.top.emailConfirm && !out.top.confirm_email) out.top.confirm_email = out.top.emailConfirm;
    if (out.top.retype_email && !out.top.confirm_email) out.top.confirm_email = out.top.retype_email;
    var ca = raw.customAnswers;
    if (isPlainObject(ca)) {
      APPLY_CREDENTIAL_KEYS.forEach(function (k) {
        if (ca[k] != null && String(ca[k]).trim() !== '') {
          out.customAnswers[k] = String(ca[k]);
        }
      });
      if (out.customAnswers.password) {
        if (!out.customAnswers.confirm_password) {
          out.customAnswers.confirm_password = out.customAnswers.password;
        }
        if (!out.customAnswers.retype_password) {
          out.customAnswers.retype_password = out.customAnswers.password;
        }
      }
    }
    // Promote customAnswers.password to top-level when top lacks it
    if (!out.top.password && out.customAnswers.password) {
      out.top.password = out.customAnswers.password;
      out.top.confirm_password = out.customAnswers.confirm_password || out.customAnswers.password;
      out.top.retype_password = out.customAnswers.retype_password || out.customAnswers.password;
    }
    return out;
  }

  function reapplyApplyCredentials(out, extracted) {
    if (!extracted) return out;
    Object.keys(extracted.top || {}).forEach(function (k) {
      out[k] = extracted.top[k];
    });
    if (!isPlainObject(out.customAnswers)) out.customAnswers = {};
    Object.keys(extracted.customAnswers || {}).forEach(function (k) {
      out.customAnswers[k] = extracted.customAnswers[k];
    });
    // Keep email confirm aliases aligned with email when only email is known
    if (out.email && !out.confirm_email) out.confirm_email = out.email;
    if (out.email && !out.retype_email) out.retype_email = out.email;
    if (out.email) {
      out.customAnswers.confirm_email = out.customAnswers.confirm_email || out.email;
      out.customAnswers.retype_email = out.customAnswers.retype_email || out.email;
    }
    return out;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function appVersion() {
    try {
      if (global.chrome && chrome.runtime && chrome.runtime.getManifest) {
        var m = chrome.runtime.getManifest();
        if (m && m.version) return String(m.version);
      }
    } catch (_e) { /* ignore */ }
    return '';
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function deepStripSecrets(value, depth) {
    depth = depth || 0;
    if (depth > 12) return undefined;
    if (Array.isArray(value)) {
      return value
        .map(function (item) {
          return deepStripSecrets(item, depth + 1);
        })
        .filter(function (item) {
          return item !== undefined;
        });
    }
    if (!isPlainObject(value)) return value;
    var out = {};
    Object.keys(value).forEach(function (k) {
      if (SECRET_KEY_RE.test(k) || SECRET_NESTED_RE.test(k)) return;
      var v = deepStripSecrets(value[k], depth + 1);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  function foldApplicationQuestions(out) {
    if (!isPlainObject(out.applicationQuestions)) return;
    if (!isPlainObject(out.customAnswers)) out.customAnswers = {};
    if (!Array.isArray(out.customQA)) out.customQA = [];
    Object.keys(out.applicationQuestions).forEach(function (k) {
      var row = out.applicationQuestions[k];
      if (row == null) return;
      var answer =
        typeof row === 'object'
          ? row.answer != null
            ? row.answer
            : row.value
          : row;
      if (answer == null || String(answer).trim() === '') return;
      var question =
        typeof row === 'object' && row.question
          ? String(row.question).trim()
          : String(k).trim();
      var ans = String(answer).trim();
      out.customAnswers[k] = ans;
      if (question) out.customAnswers[question] = ans;
      var exists = out.customQA.some(function (q) {
        return q && String(q.question || '').trim() === question;
      });
      if (!exists && question) {
        out.customQA.push({ question: question, answer: ans });
      }
    });
  }

  function sanitizeProfileFields(raw, opts) {
    opts = opts || {};
    var P = global.FillApplyProfile;
    var defaults = (P && P.DEFAULT_PROFILE) || {};
    var src = isPlainObject(raw) ? raw : {};
    // Import keeps apply credentials; export / default strip still removes them.
    var extracted = opts.preserveApplyCredentials ? extractApplyCredentials(src) : null;
    var cleaned = deepStripSecrets(src) || {};
    // Drop meta / identity keys that belong outside profile fields
    delete cleaned.id;
    delete cleaned.name;
    delete cleaned.createdAt;
    delete cleaned.updatedAt;
    delete cleaned.locked;
    delete cleaned.systemProfile;
    delete cleaned.__adaptiveKnowledge;
    delete cleaned.__dom;
    delete cleaned.__runtime;
    var out = Object.assign({}, defaults, cleaned);
    if (!Array.isArray(out.experienceEntries)) out.experienceEntries = [];
    if (!Array.isArray(out.educationEntries)) out.educationEntries = [];
    if (!Array.isArray(out.customQA)) out.customQA = [];
    if (!isPlainObject(out.customAnswers)) out.customAnswers = {};
    // Honorific: title ↔ salutation
    if (out.title && !out.salutation) out.salutation = out.title;
    if (out.salutation && !out.title) out.title = out.salutation;
    // Address dictionary keys → profile keys (empty stays empty — skip on fill)
    if (out.addressCountry && !out.country) out.country = out.addressCountry;
    if (out.province && !out.state) out.state = out.province;
    if (out.addressLine1 != null && out.street === '' && String(out.addressLine1).trim() === '') {
      /* keep street empty */
    } else if (out.addressLine1 && !out.street) {
      out.street = out.addressLine1;
    }
    foldApplicationQuestions(out);
    // Phone full / E.164: keep import aliases and derive missing pieces.
    (function normalizePhoneFields(o) {
      var ca = o.customAnswers && typeof o.customAnswers === 'object' ? o.customAnswers : {};
      function pick() {
        for (var i = 0; i < arguments.length; i++) {
          var v = arguments[i];
          if (v != null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
      }
      var full = pick(
        o.phoneFull,
        o.phoneE164,
        o.phone_full,
        o.phone_e164,
        ca.phone_full,
        ca.phoneFull,
        ca.phone_complete,
        ca.phone_with_country,
        ca.Phone
      );
      var country = pick(o.phoneCountry, o.phoneCountryCode, o.phone_country, ca.phone_country, ca.phoneCountry);
      var national = pick(o.phone, ca.phone, ca.phone_number);
      if (full) {
        if (!o.phoneFull) o.phoneFull = full;
        if (!o.phoneE164) o.phoneE164 = full.indexOf('+') === 0 ? full : '+' + full.replace(/^\D+/, '');
      }
      if (country && !o.phoneCountry) {
        var cd = String(country).replace(/[^\d+]/g, '');
        o.phoneCountry = cd.charAt(0) === '+' ? cd : '+' + cd.replace(/^\D+/, '');
      }
      if (o.phoneCountry && !o.phoneCountryCode) o.phoneCountryCode = o.phoneCountry;
      // Derive national digits from E.164 when phone is empty.
      if (!national && (o.phoneFull || o.phoneE164) && o.phoneCountry) {
        var dial = String(o.phoneCountry).replace(/\D/g, '');
        var all = String(o.phoneFull || o.phoneE164).replace(/\D/g, '');
        if (dial && all.indexOf(dial) === 0 && all.length > dial.length) {
          national = all.slice(dial.length);
        }
      }
      if (national && !o.phone) o.phone = String(national).replace(/\D/g, '');
      // Compose phoneFull when we have country + national but no full form.
      if (!o.phoneFull && o.phoneCountry && o.phone) {
        o.phoneFull = o.phoneCountry + String(o.phone).replace(/\D/g, '');
        o.phoneE164 = o.phoneFull;
      }
      // salary_text → salaryText / currentSalary fallback for bare Salary fields
      var salaryText = pick(o.salaryText, o.salary_text, ca.salary_text, ca.salary_display, ca.ignite_salary, ca.current_salary_text);
      if (salaryText) {
        o.salaryText = salaryText;
        if (!ca.salary_text) ca.salary_text = salaryText;
      }
      var avail = pick(o.noticePeriod, ca.available_immediately, ca.availability, ca.available_to_start);
      if (avail && !o.noticePeriod) o.noticePeriod = avail;
      o.customAnswers = ca;
    })(out);
    if (extracted) {
      reapplyApplyCredentials(out, extracted);
    } else {
      // Export / non-preserve: drop apply credentials even if DEFAULT_PROFILE lists empty shells
      APPLY_CREDENTIAL_KEYS.forEach(function (k) {
        delete out[k];
      });
      if (isPlainObject(out.customAnswers)) {
        APPLY_CREDENTIAL_KEYS.forEach(function (k) {
          delete out.customAnswers[k];
        });
      }
    }
    return out;
  }

  function normalizeImportStatus(status) {
    var s = String(status || '').toLowerCase().trim();
    if (s === 'rejected') return 'rejected';
    if (s === 'provisional') return 'provisional';
    // Dictionaries often ship status:"active" — treat as confirmed for fill.
    if (s === 'confirmed' || s === 'active' || s === 'learned' || s === '') return 'confirmed';
    return 'confirmed';
  }

  function normalizeImportConfidence(conf) {
    if (typeof conf === 'number' && !isNaN(conf)) {
      return Math.max(0, Math.min(1, conf));
    }
    var s = String(conf || '').toLowerCase().trim();
    if (s === 'shell' || s === 'empty') return 0;
    if (s === 'confirmed' || s === 'high' || s === 'user') return 0.95;
    if (s === 'medium') return 0.7;
    if (s === 'low') return 0.4;
    return 0.9;
  }

  function sanitizeKnowledgeRecords(list) {
    if (!Array.isArray(list)) return [];
    var Policy = global.FillApplyKnowledgePolicy;
    var prepared = list;
    if (Policy && Policy.migrateRecords) {
      prepared = Policy.migrateRecords(list).records || [];
    }
    var out = [];
    prepared.forEach(function (rec) {
      if (!rec || typeof rec !== 'object') return;
      var key = String(rec.canonicalKey || rec.canonical_key || rec.key || '').trim();
      if (Policy && Policy.normalizeSemanticKey) key = Policy.normalizeSemanticKey(key) || key;
      if (!key) return;
      if (Policy && Policy.isRejectedGeneratedKey && Policy.isRejectedGeneratedKey(key)) return;
      if (/password|passwd|secret|token|credential/i.test(key)) return;
      var cleaned = deepStripSecrets(rec) || {};
      var aliases = Array.isArray(cleaned.aliases)
        ? cleaned.aliases
            .map(function (a) {
              return String(a || '').trim();
            })
            .filter(Boolean)
        : [];
      var question = String(cleaned.question || cleaned.label || '').trim();
      if (question && aliases.indexOf(question) === -1) aliases.push(question);
      // phone_country must not claim bare "Country" (collides with residence country)
      if (key === 'phone_country' || key === 'phoneCountry') {
        aliases = aliases.filter(function (a) {
          var n = String(a || '').toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
          return n !== 'country' && n !== 'countries';
        });
      }
      var control = String(cleaned.control || cleaned.controlType || '').trim();
      var rawVal =
        cleaned.value != null
          ? cleaned.value
          : cleaned.displayValue != null
            ? cleaned.displayValue
            : '';
      if (rawVal == null || String(rawVal).trim() === '') return;
      var source = cleaned.source || 'import';
      if (Policy && Policy.isGeneratedSource && Policy.isGeneratedSource(source)) {
        source = 'imported_legacy';
      }
      out.push({
        id: cleaned.id || undefined,
        canonicalKey: key,
        fieldType: cleaned.fieldType || cleaned.field_type || cleaned.type || 'string',
        control: control || undefined,
        question: question || undefined,
        value: rawVal,
        displayValue:
          cleaned.displayValue != null
            ? cleaned.displayValue
            : rawVal,
        aliases: aliases,
        source: source,
        confidence: 0,
        status: source === 'imported_legacy' ? 'provisional' : normalizeImportStatus(cleaned.status),
        usageCount: typeof cleaned.usageCount === 'number' ? cleaned.usageCount : 0,
        createdAt: cleaned.createdAt || undefined,
        updatedAt: cleaned.updatedAt || undefined,
        lastUsedAt: cleaned.lastUsedAt || 0,
        lastSeenLabel: cleaned.lastSeenLabel || question || '',
        profileId: cleaned.profileId != null ? cleaned.profileId : null,
        provenance: isPlainObject(cleaned.provenance) ? cleaned.provenance : { via: 'import' }
      });
    });
    return out;
  }

  /**
   * Full validation before any side effect.
   * Returns { ok:true, data } or { ok:false, errors:[string] }.
   */
  function validateImportPayload(raw) {
    var errors = [];
    if (raw == null) {
      return { ok: false, errors: ['Import is empty.'] };
    }
    var obj = raw;
    if (typeof raw === 'string') {
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        return { ok: false, errors: ['Invalid JSON: ' + (e && e.message ? e.message : String(e))] };
      }
    }
    if (!isPlainObject(obj)) {
      return { ok: false, errors: ['Import root must be a JSON object.'] };
    }
    var format = String(obj.format || '').trim();
    if (format !== FORMAT) {
      errors.push(
        'Unsupported format "' +
          (format || '(missing)') +
          '". Expected "' +
          FORMAT +
          '".'
      );
    }
    var ver = Number(obj.schemaVersion);
    if (!SUPPORTED_SCHEMA_VERSIONS.some(function (v) { return v === ver; })) {
      errors.push(
        'Unsupported schemaVersion ' +
          JSON.stringify(obj.schemaVersion) +
          '. Supported: ' +
          SUPPORTED_SCHEMA_VERSIONS.join(', ') +
          '.'
      );
    }
    if (!isPlainObject(obj.profile)) {
      errors.push('Missing or invalid "profile" object.');
    }
    if (obj.knowledge != null) {
      if (!isPlainObject(obj.knowledge) && !Array.isArray(obj.knowledge)) {
        errors.push('"knowledge" must be an object or array when present.');
      } else if (isPlainObject(obj.knowledge) && obj.knowledge.records != null && !Array.isArray(obj.knowledge.records)) {
        errors.push('"knowledge.records" must be an array when present.');
      }
    }
    if (obj.adaptiveDictionary != null) {
      if (!isPlainObject(obj.adaptiveDictionary) && !Array.isArray(obj.adaptiveDictionary)) {
        errors.push('"adaptiveDictionary" must be an object or array when present.');
      } else if (
        isPlainObject(obj.adaptiveDictionary) &&
        obj.adaptiveDictionary.records != null &&
        !Array.isArray(obj.adaptiveDictionary.records)
      ) {
        errors.push('"adaptiveDictionary.records" must be an array when present.');
      }
    }
    if (obj.questionBank != null) {
      if (!isPlainObject(obj.questionBank) && !Array.isArray(obj.questionBank)) {
        errors.push('"questionBank" must be an object or array when present.');
      } else if (
        isPlainObject(obj.questionBank) &&
        obj.questionBank.records != null &&
        !Array.isArray(obj.questionBank.records)
      ) {
        errors.push('"questionBank.records" must be an array when present.');
      }
    }
    if (errors.length) return { ok: false, errors: errors };

    var meta = isPlainObject(obj.meta) ? obj.meta : {};
    var profile = sanitizeProfileFields(obj.profile, { preserveApplyCredentials: true });
    function extractKnowledgeRecords(block) {
      if (Array.isArray(block)) return block;
      if (block && Array.isArray(block.records)) return block.records;
      return [];
    }
    // Prefer knowledge; merge adaptiveDictionary alias when present (knowledge wins on key).
    var knowledgeRaw = extractKnowledgeRecords(obj.knowledge);
    var adaptiveRaw = extractKnowledgeRecords(obj.adaptiveDictionary);
    if (!knowledgeRaw.length && adaptiveRaw.length) {
      knowledgeRaw = adaptiveRaw;
    } else if (knowledgeRaw.length && adaptiveRaw.length) {
      var seenKeys = {};
      knowledgeRaw.forEach(function (r) {
        if (r && r.canonicalKey) seenKeys[String(r.canonicalKey)] = true;
      });
      adaptiveRaw.forEach(function (r) {
        if (!r || !r.canonicalKey) return;
        if (seenKeys[String(r.canonicalKey)]) return;
        knowledgeRaw.push(r);
      });
    }
    var knowledge = sanitizeKnowledgeRecords(knowledgeRaw);

    return {
      ok: true,
      data: {
        format: FORMAT,
        schemaVersion: ver,
        exportedAt: obj.exportedAt || null,
        meta: meta,
        profile: profile,
        knowledge: knowledge,
        questionBank: extractKnowledgeRecords(obj.questionBank)
      }
    };
  }

  async function buildExportPayload(opts) {
    opts = opts || {};
    var P = global.FillApplyProfile;
    var K = global.FillApplyKnowledgeStore;
    if (!P) throw new Error('FillApplyProfile is not loaded');

    var meta = (await P.getActiveProfileMeta()) || {};
    var profile = await P.getProfile();
    var profileId = await P.getActiveProfileId();
    var fields = sanitizeProfileFields(profile);

    var knowledgeRecords = [];
    if (K && K.listKnowledge) {
      var list = await K.listKnowledge(profileId);
      knowledgeRecords = sanitizeKnowledgeRecords(list);
    } else if (K && K.exportSnapshot) {
      var snap = await K.exportSnapshot(profileId);
      knowledgeRecords = sanitizeKnowledgeRecords(snap && snap.records);
    }

    var knowledgeBlock = {
      version: 1,
      records: knowledgeRecords
    };
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso(),
      meta: {
        profileName: meta.name || opts.profileName || 'Profile',
        profileId: profileId || null,
        activate: true,
        appVersion: appVersion(),
        knowledgeCount: knowledgeRecords.length
      },
      profile: fields,
      knowledge: knowledgeBlock,
      // Documented synonym of knowledge — Field Memory / Adaptive Dictionary naming.
      // Same records; kept so older importers that only read `knowledge` stay compatible.
      adaptiveDictionary: knowledgeBlock,
      questionBank: (function () {
        var QB = global.FillApplyQuestionBank;
        if (QB && QB.exportSnapshot) {
          try {
            return QB.exportSnapshot();
          } catch (_e) {
            return { format: 'fill-apply-question-bank', version: 1, records: [] };
          }
        }
        return { format: 'fill-apply-question-bank', version: 1, records: [] };
      })()
    };
  }

  function suggestExportFilename(payload) {
    var name =
      (payload && payload.meta && payload.meta.profileName) ||
      (payload && payload.profile && (payload.profile.preferredName || payload.profile.firstName)) ||
      'profile';
    var slug = String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile';
    return slug + '-profile.json';
  }

  /**
   * Apply a validated payload: write profile fields, restore knowledge, activate.
   * Never partially applies — validateImportPayload must succeed first.
   */
  async function importValidated(data, opts) {
    opts = opts || {};
    var P = global.FillApplyProfile;
    var K = global.FillApplyKnowledgeStore;
    if (!P) throw new Error('FillApplyProfile is not loaded');

    var meta = data.meta || {};
    var wantedName = String(meta.profileName || opts.profileName || 'Imported').trim() || 'Imported';
    var activate = meta.activate !== false && opts.activate !== false;
    var preferZahid =
      opts.preferZahid !== false &&
      (P.isZahidName(wantedName) ||
        String(meta.preferredProfileId || '').toLowerCase() === 'zahid' ||
        /zahid/i.test(wantedName));

    // Ensure Mock exists and is never destroyed
    if (P.ensureMockProfile) {
      try {
        await P.ensureMockProfile();
      } catch (_e) { /* ignore */ }
    }

    var targetId = null;
    var list = await P.listProfiles();

    if (preferZahid && P.findZahidId) {
      // Ensure empty Zahid shell exists without resetting user data first —
      // we will overwrite fields from the import explicitly.
      var storeProfiles = {};
      list.forEach(function (m) {
        storeProfiles[m.id] = m;
      });
      // Prefer existing Zahid id
      for (var i = 0; i < list.length; i++) {
        if (P.isZahidName(list[i].name) || String(list[i].id) === 'zahid') {
          targetId = list[i].id;
          break;
        }
      }
      if (!targetId && P.ensureZahidProfile) {
        // Create missing empty shell only (no reset of unrelated profiles)
        targetId = await P.ensureZahidProfile({ activate: false, reset: false });
      }
    }

    if (!targetId) {
      // Match by name, else create
      for (var j = 0; j < list.length; j++) {
        if (String(list[j].name || '').toLowerCase() === wantedName.toLowerCase()) {
          if (!(P.isLockedProfile && P.isLockedProfile(list[j]))) {
            targetId = list[j].id;
            break;
          }
        }
      }
    }

    if (!targetId) {
      var created = await P.createProfile(wantedName);
      targetId = created.id;
    }

    await P.setActiveProfile(targetId);
    // Rename to wanted name when not Mock
    try {
      var activeMeta = await P.getActiveProfileMeta();
      if (activeMeta && !activeMeta.locked && activeMeta.name !== wantedName && !P.isMockName(wantedName)) {
        await P.renameProfile(targetId, wantedName);
      }
    } catch (_renameErr) { /* ignore */ }

    // Write profile fields onto active
    await P.saveProfile(data.profile);
    // If preferZahid and name drifted, normalize to Zahid
    if (preferZahid) {
      try {
        var m2 = await P.getActiveProfileMeta();
        if (m2 && !m2.locked && !P.isZahidName(m2.name)) {
          await P.renameProfile(targetId, 'Zahid');
        }
      } catch (_e2) { /* ignore */ }
    }

    if (activate) {
      await P.setActiveProfile(targetId);
    }

    var knowledgeImported = 0;
    var knowledgeErrors = 0;
    if (K && Array.isArray(data.knowledge) && data.knowledge.length) {
      // Prefer durable bundle import so every record (including empty alias
      // shells from trial dictionaries) lands in IndexedDB + hot + memory.
      if (K.importKnowledgeBundle) {
        try {
          var bundle = await K.importKnowledgeBundle(
            { records: data.knowledge, profileId: targetId },
            { mode: 'merge', profileId: targetId, includeEmpty: true }
          );
          knowledgeImported = bundle && typeof bundle.imported === 'number' ? bundle.imported : 0;
          knowledgeErrors = bundle && typeof bundle.skipped === 'number' ? bundle.skipped : 0;
        } catch (_bundleErr) {
          knowledgeErrors += 1;
        }
      }
      // Fallback / fill gaps: per-record putKnowledge (stable id per key+profile)
      if (knowledgeImported < data.knowledge.length && K.putKnowledge) {
        for (var k = 0; k < data.knowledge.length; k++) {
          var src = data.knowledge[k] || {};
          var ck = String(src.canonicalKey || src.canonical_key || src.key || '').trim();
          if (!ck) {
            knowledgeErrors += 1;
            continue;
          }
          var rec = Object.assign({}, src, {
            canonicalKey: ck,
            profileId: targetId,
            id: src.id || 'import:' + targetId + ':' + ck
          });
          try {
            await K.putKnowledge(rec);
            knowledgeImported += 1;
          } catch (_ke) {
            knowledgeErrors += 1;
          }
        }
        // Deduplicate count against prior bundle imports
        if (K.listKnowledge) {
          try {
            var listed = await K.listKnowledge(targetId);
            knowledgeImported = listed ? listed.length : knowledgeImported;
          } catch (_listErr) { /* keep prior */ }
        }
      }
    }

    var saved = await P.getProfile();
    var activeId = await P.getActiveProfileId();
    
    var questionBankImported = 0;
    var QB = global.FillApplyQuestionBank;
    if (QB && Array.isArray(data.questionBank) && data.questionBank.length && QB.importSnapshot) {
      try {
        var qbRes = await QB.importSnapshot(
          { records: data.questionBank },
          { mode: 'merge' }
        );
        questionBankImported =
          qbRes && typeof qbRes.imported === 'number'
            ? qbRes.imported
            : data.questionBank.length;
      } catch (_qbErr) {
        questionBankImported = 0;
      }
    }

return {
      ok: true,
      profileId: activeId,
      profileName: (await P.getActiveProfileMeta() || {}).name || wantedName,
      fieldsRestored: Object.keys(data.profile || {}).length,
      knowledgeImported: knowledgeImported,
      questionBankImported: questionBankImported,
      knowledgeErrors: knowledgeErrors,
      activated: activate && activeId === targetId,
      profile: saved
    };
  }

  /**
   * Validate then import. On validation failure nothing is written.
   */
  async function importPayload(raw, opts) {
    var checked = validateImportPayload(raw);
    if (!checked.ok) {
      return { ok: false, errors: checked.errors, imported: false };
    }
    try {
      var result = await importValidated(checked.data, opts);
      return Object.assign({ imported: true, errors: [] }, result);
    } catch (e) {
      return {
        ok: false,
        imported: false,
        errors: [e && e.message ? e.message : String(e)]
      };
    }
  }

  async function exportActiveProfile(opts) {
    var payload = await buildExportPayload(opts);
    return {
      payload: payload,
      filename: suggestExportFilename(payload),
      json: JSON.stringify(payload, null, 2)
    };
  }

  /**
   * Browser helper: trigger a download of the export JSON.
   */
  async function downloadExport(opts) {
    var bundled = await exportActiveProfile(opts);
    var blob = new Blob([bundled.json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = bundled.filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (_e) { /* ignore */ }
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
    return bundled;
  }

  global.FillApplyProfileIO = {
    APPLY_CREDENTIAL_KEYS: APPLY_CREDENTIAL_KEYS,
    FORMAT: FORMAT,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS: SUPPORTED_SCHEMA_VERSIONS,
    validateImportPayload: validateImportPayload,
    sanitizeProfileFields: sanitizeProfileFields,
    sanitizeKnowledgeRecords: sanitizeKnowledgeRecords,
    deepStripSecrets: deepStripSecrets,
    buildExportPayload: buildExportPayload,
    exportActiveProfile: exportActiveProfile,
    importPayload: importPayload,
    importValidated: importValidated,
    suggestExportFilename: suggestExportFilename,
    downloadExport: downloadExport
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
