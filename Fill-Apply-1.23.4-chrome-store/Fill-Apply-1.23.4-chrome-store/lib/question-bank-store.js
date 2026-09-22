/**
 * QUESTION BANK — authored Q→A with aliases (separate from Adaptive Dictionary).
 * Resolution order: after Adaptive confirmed, before generic. Never overrides
 * current user answer or Profile.
 *
 * Attaches globalThis.FillApplyQuestionBank.
 */
(function (global) {
  'use strict';

  var KEY = 'fillApply.questionBank';
  var memory = { records: [] };

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'qb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function hasChromeStorage() {
    return !!(global.chrome && chrome.storage && chrome.storage.local);
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      if (!hasChromeStorage()) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, function (result) {
        resolve(result || {});
      });
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve, reject) {
      if (!hasChromeStorage()) {
        resolve();
        return;
      }
      chrome.storage.local.set(obj, function () {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function normalize(rec) {
    if (!rec || typeof rec !== 'object') return null;
    var question = String(rec.question || rec.label || '').trim();
    var answer = rec.answer != null ? String(rec.answer) : rec.value != null ? String(rec.value) : '';
    answer = String(answer).trim();
    if (!question && !answer) return null;
    var aliases = Array.isArray(rec.aliases)
      ? rec.aliases.map(function (a) { return String(a || '').trim(); }).filter(Boolean)
      : [];
    if (question && aliases.indexOf(question) === -1) aliases.unshift(question);
    var Policy = global.FillApplyKnowledgePolicy;
    if (Policy && Policy.isRejectedGeneratedKey && Policy.isRejectedGeneratedKey(rec.canonicalKey || rec.id || '')) {
      /* still allow QB with human question text */
    }
    // Strip secrets
    var SecretStore = global.FillApplyKnowledgeStore;
    if (SecretStore && SecretStore.isSecretKnowledgeRecord) {
      if (
        SecretStore.isSecretKnowledgeRecord({
          canonicalKey: question,
          aliases: aliases,
          fieldType: 'string'
        })
      ) {
        return null;
      }
    }
    if (/\bpassword\b/i.test(question) || /\bpassword\b/i.test(answer)) return null;
    return {
      id: rec.id || uuid(),
      question: question || aliases[0] || '',
      answer: answer,
      aliases: aliases,
      fieldType: rec.fieldType || 'string',
      createdAt: rec.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  async function persist() {
    var payload = {};
    payload[KEY] = { version: 1, records: memory.records };
    await storageSet(payload);
    return memory.records;
  }

  async function load() {
    var res = await storageGet([KEY]);
    var raw = res[KEY];
    var list = [];
    if (raw && Array.isArray(raw.records)) list = raw.records;
    else if (Array.isArray(raw)) list = raw;
    memory.records = list
      .map(normalize)
      .filter(Boolean);
    return listRecords();
  }

  function listRecords() {
    return memory.records.slice().sort(function (a, b) {
      return String(a.question || '').localeCompare(String(b.question || ''));
    });
  }

  async function upsert(partial) {
    var rec = normalize(partial);
    if (!rec) return { ok: false, reason: 'invalid' };
    var idx = -1;
    for (var i = 0; i < memory.records.length; i++) {
      if (memory.records[i].id === rec.id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      // Match by question text
      for (var j = 0; j < memory.records.length; j++) {
        if (
          String(memory.records[j].question || '').toLowerCase() ===
          String(rec.question || '').toLowerCase()
        ) {
          idx = j;
          rec.id = memory.records[j].id;
          rec.createdAt = memory.records[j].createdAt;
          break;
        }
      }
    }
    if (idx >= 0) memory.records[idx] = rec;
    else memory.records.push(rec);
    await persist();
    return { ok: true, record: rec };
  }

  async function remove(id) {
    memory.records = memory.records.filter(function (r) {
      return r.id !== id;
    });
    await persist();
    return { ok: true };
  }

  function search(query) {
    var q = String(query || '')
      .trim()
      .toLowerCase();
    var list = listRecords();
    if (!q) return list;
    return list.filter(function (r) {
      var hay = [r.question, r.answer, (r.aliases || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function normalizeText(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Resolve a label against authored QB. Returns { value, record } or null.
   */
  function resolveLabel(label) {
    var n = normalizeText(label);
    if (!n) return null;
    var best = null;
    var bestScore = 0;
    memory.records.forEach(function (r) {
      var candidates = [r.question].concat(r.aliases || []);
      candidates.forEach(function (c) {
        var cn = normalizeText(c);
        if (!cn) return;
        var score = 0;
        if (cn === n) score = 100;
        else if (n.indexOf(cn) !== -1 || cn.indexOf(n) !== -1) score = Math.min(cn.length, n.length);
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      });
    });
    if (!best || bestScore < 8) return null;
    if (!best.answer) return null;
    return { value: best.answer, record: best, source: 'questionBank' };
  }

  function exportSnapshot() {
    return {
      format: 'fill-apply-question-bank',
      version: 1,
      records: listRecords().map(function (r) {
        return {
          id: r.id,
          question: r.question,
          answer: r.answer,
          aliases: r.aliases,
          fieldType: r.fieldType
        };
      })
    };
  }

  async function importSnapshot(snap, opts) {
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var records = snap && Array.isArray(snap.records) ? snap.records : Array.isArray(snap) ? snap : [];
    if (mode === 'replace') memory.records = [];
    var imported = 0;
    var skipped = 0;
    for (var i = 0; i < records.length; i++) {
      var res = await upsert(records[i]);
      if (res.ok) imported += 1;
      else skipped += 1;
    }
    return { imported: imported, skipped: skipped, mode: mode };
  }

  // Eager memory empty; callers should await load() once.
  global.FillApplyQuestionBank = {
    KEY: KEY,
    load: load,
    list: listRecords,
    search: search,
    upsert: upsert,
    remove: remove,
    resolveLabel: resolveLabel,
    exportSnapshot: exportSnapshot,
    importSnapshot: importSnapshot,
    resetMemory: function () {
      memory.records = [];
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
