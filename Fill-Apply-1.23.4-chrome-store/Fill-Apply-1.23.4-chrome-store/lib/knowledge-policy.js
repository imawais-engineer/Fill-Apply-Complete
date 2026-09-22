/**
 * Adaptive dictionary policy: generated-key rejection, semantic identity,
 * and idempotent migration/dedupe.
 *
 * Attaches globalThis.FillApplyKnowledgePolicy.
 */
(function (global) {
  'use strict';

  /** Fixture / consolidation tags that must never be canonical primary identity. */
  var GENERATED_KEY_PREFIXES = [
    'trial_history_consolidate_',
    'qiddiya_',
    'ats_dictionary_shells_',
    'portfolio_ng_',
    'alfuttaim_signup_',
    'michael_page_',
    'client_qa_',
    'user_provided_'
  ];

  /** Same tags used as `source` on bulk dumps — never treat as user_confirmed. */
  var GENERATED_SOURCE_PREFIXES = GENERATED_KEY_PREFIXES.slice();

  var URL_RE = /^(https?:\/\/|www\.)/i;
  var TIMESTAMP_KEY_RE = /(^|_)(20\d{2}[-_]?\d{2}[-_]?\d{2}|\d{10,13})(_|$)/;
  var COMPANY_SLUG_RE =
    /^(careers?|jobs?|apply|boards?)[_-]|^[a-z0-9-]{2,}\.(com|io|co|net|org)(_|$)/i;

  /** Legacy phone number identity → canonical semantic `mobile`. */
  var KEY_ALIASES = {
    phone: 'mobile',
    phone_number: 'mobile',
    telephone: 'mobile',
    cell: 'mobile',
    cellphone: 'mobile',
    mobile_number: 'mobile',
    phonenumber: 'mobile'
  };

  function trim(s) {
    return String(s == null ? '' : s).trim();
  }

  function extractCanonicalKey(rec) {
    if (!rec || typeof rec !== 'object') return '';
    return trim(rec.canonicalKey || rec.canonical_key || rec.key || '');
  }

  function normalizeSemanticKey(key) {
    var k = trim(key).toLowerCase().replace(/\s+/g, '_');
    if (!k) return '';
    if (KEY_ALIASES[k]) return KEY_ALIASES[k];
    return k;
  }

  function isRejectedGeneratedKey(key) {
    var k = trim(key);
    if (!k) return true;
    var lower = k.toLowerCase();
    // Dump-script prefixes used as primary identity (not catalog keys like qiddiya_privacy_ack)
    var hardPrefixes = [
      'trial_history_consolidate_',
      'ats_dictionary_shells_',
      'portfolio_ng_',
      'alfuttaim_signup_',
      'michael_page_',
      'client_qa_',
      'user_provided_'
    ];
    for (var i = 0; i < hardPrefixes.length; i++) {
      if (lower.indexOf(hardPrefixes[i]) === 0) return true;
    }
    // qiddiya_* only when it looks like a dated dump tag, not semantic catalog keys
    if (/^qiddiya_/.test(lower) && (/\d{4}/.test(lower) || /name_dob/.test(lower) || /consolidate|shells|signup/.test(lower))) {
      return true;
    }
    if (URL_RE.test(k)) return true;
    if (/^https?:/i.test(k) || /%2f/i.test(k)) return true;
    // Bare timestamp / date as the entire identity
    if (/^20\d{2}[-_]?\d{2}[-_]?\d{2}$/.test(lower) || /^\d{10,13}$/.test(lower)) return true;
    if (COMPANY_SLUG_RE.test(lower)) return true;
    return false;
  }

  function isGeneratedSource(source) {
    var s = trim(source).toLowerCase();
    if (!s) return false;
    for (var i = 0; i < GENERATED_SOURCE_PREFIXES.length; i++) {
      if (s.indexOf(GENERATED_SOURCE_PREFIXES[i]) === 0) return true;
    }
    if (s === 'portfolio_import' || s === 'ignite_2026-09-19' || /^ignite_/i.test(s)) return true;
    return false;
  }

  function hasUsableValue(rec) {
    if (!rec) return false;
    var v = rec.displayValue != null ? rec.displayValue : rec.value;
    if (v == null) return false;
    if (typeof v === 'object') return false;
    return String(v).trim() !== '';
  }

  function coerceRecordShape(rec) {
    if (!rec || typeof rec !== 'object') return null;
    var key = normalizeSemanticKey(extractCanonicalKey(rec));
    var aliases = Array.isArray(rec.aliases)
      ? rec.aliases.map(function (a) { return trim(a); }).filter(Boolean)
      : [];
    var question = trim(rec.question || rec.label || rec.lastSeenLabel || '');
    if (question && aliases.indexOf(question) === -1) aliases.push(question);
    var fieldType = rec.fieldType || rec.field_type || rec.type || 'string';
    var rawVal = rec.value != null ? rec.value : rec.displayValue != null ? rec.displayValue : '';
    var status = String(rec.status || '').toLowerCase();
    if (status === 'active' || status === 'learned' || status === '') status = 'confirmed';
    if (status !== 'confirmed' && status !== 'provisional' && status !== 'rejected') {
      status = 'confirmed';
    }
    var source = trim(rec.source || '');
    if (isGeneratedSource(source)) {
      // Bulk fixture dumps are not user confirmations.
      source = 'imported_legacy';
      if (status === 'confirmed') status = 'provisional';
    }
    if (!source) source = 'imported';
    return {
      id: rec.id,
      canonicalKey: key,
      fieldType: fieldType,
      value: rawVal,
      displayValue: rec.displayValue != null ? rec.displayValue : rawVal,
      aliases: aliases,
      source: source,
      confidence: typeof rec.confidence === 'number' ? rec.confidence : 0,
      status: status,
      usageCount: typeof rec.usageCount === 'number' ? rec.usageCount : 0,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      lastUsedAt: rec.lastUsedAt || 0,
      lastSeenLabel: rec.lastSeenLabel || question || '',
      profileId: rec.profileId != null ? rec.profileId : null,
      provenance: rec.provenance && typeof rec.provenance === 'object' ? rec.provenance : {}
    };
  }

  /**
   * Idempotent sanitize + dedupe by semantic identity.
   * Discards invalid / empty / generated-key records.
   */
  function migrateRecords(list) {
    var input = Array.isArray(list) ? list : [];
    var byKey = {};
    var discarded = 0;
    var kept = 0;
    input.forEach(function (raw) {
      var rec = coerceRecordShape(raw);
      if (!rec || !rec.canonicalKey) {
        discarded += 1;
        return;
      }
      if (isRejectedGeneratedKey(rec.canonicalKey)) {
        discarded += 1;
        return;
      }
      if (!hasUsableValue(rec) && rec.status !== 'confirmed') {
        discarded += 1;
        return;
      }
      // Empty shells with no value — discard
      if (!hasUsableValue(rec)) {
        discarded += 1;
        return;
      }
      var prev = byKey[rec.canonicalKey];
      if (!prev) {
        byKey[rec.canonicalKey] = rec;
        kept += 1;
        return;
      }
      // Prefer user_confirmed / higher usage / newer
      var preferNew =
        (rec.source === 'user_confirmed' && prev.source !== 'user_confirmed') ||
        ((rec.usageCount || 0) > (prev.usageCount || 0)) ||
        ((rec.updatedAt || 0) > (prev.updatedAt || 0));
      if (preferNew) {
        // Merge aliases
        var merged = (prev.aliases || []).slice();
        (rec.aliases || []).forEach(function (a) {
          if (merged.indexOf(a) === -1) merged.push(a);
        });
        rec.aliases = merged;
        if (!rec.id && prev.id) rec.id = prev.id;
        byKey[rec.canonicalKey] = rec;
      } else {
        (rec.aliases || []).forEach(function (a) {
          if ((prev.aliases || []).indexOf(a) === -1) prev.aliases.push(a);
        });
      }
      discarded += 1; // duplicate slot
    });
    return {
      records: Object.keys(byKey).map(function (k) {
        return byKey[k];
      }),
      discarded: discarded,
      kept: Object.keys(byKey).length
    };
  }

  function isUserConfirmedSource(source) {
    var s = trim(source).toLowerCase();
    return (
      s === 'user_confirmed' ||
      s === 'user_confirm' ||
      s === 'user_correction' ||
      s === 'user_edit' ||
      s === 'user_explicit'
    );
  }

  global.FillApplyKnowledgePolicy = {
    GENERATED_KEY_PREFIXES: GENERATED_KEY_PREFIXES,
    isRejectedGeneratedKey: isRejectedGeneratedKey,
    isGeneratedSource: isGeneratedSource,
    isUserConfirmedSource: isUserConfirmedSource,
    normalizeSemanticKey: normalizeSemanticKey,
    extractCanonicalKey: extractCanonicalKey,
    coerceRecordShape: coerceRecordShape,
    migrateRecords: migrateRecords,
    hasUsableValue: hasUsableValue,
    KEY_ALIASES: KEY_ALIASES
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
