/**
 * Adaptive knowledge persistence.
 *
 * Layers:
 *   1. in-memory (always) — same-pass reflection
 *   2. chrome.storage.local fillApply.knowledgeHot — same-session re-inject
 *   3. IndexedDB (extension origin only) — durable source of truth
 *
 * Page isolated worlds never open the host page's IndexedDB.
 * A future Sync API hooks applyMutation / exportSnapshot / importSnapshot.
 *
 * Attaches globalThis.FillApplyKnowledgeStore and FillApplyKnowledgeSync.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'fillApply.knowledge';
  var DB_VERSION = 1;
  var HOT_KEY = 'fillApply.knowledgeHot';
  var SETTINGS_KEY = 'fillApply.knowledgeSettings';
  var CONFLICTS_KEY = 'fillApply.knowledgeConflicts';
  var HOT_MAX = 200;

  var memory = {
    knowledge: {},
    aliases: {},
    events: [],
    history: [],
    conflicts: {}
  };

  var dbPromise = null;
  var syncHooks = [];
  var listeners = [];

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function now() {
    return Date.now();
  }

  function useExtensionIdb() {
    if (typeof indexedDB === 'undefined') return false;
    try {
      if (typeof location === 'undefined') return true;
      return location.protocol === 'chrome-extension:';
    } catch (_e) {
      return false;
    }
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

  function openDb() {
    if (!useExtensionIdb()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onerror = function () {
        resolve(null);
      };
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains('knowledge')) {
          var ks = db.createObjectStore('knowledge', { keyPath: 'id' });
          ks.createIndex('canonicalKey', 'canonicalKey', { unique: false });
          ks.createIndex('profileId', 'profileId', { unique: false });
          ks.createIndex('status', 'status', { unique: false });
          ks.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('aliases')) {
          var as = db.createObjectStore('aliases', { keyPath: 'id' });
          as.createIndex('aliasNorm', 'aliasNorm', { unique: false });
          as.createIndex('canonicalKey', 'canonicalKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('events')) {
          var es = db.createObjectStore('events', { keyPath: 'id' });
          es.createIndex('ts', 'ts', { unique: false });
          es.createIndex('canonicalKey', 'canonicalKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('history')) {
          var hs = db.createObjectStore('history', { keyPath: 'id' });
          hs.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
    });
    return dbPromise;
  }

  function idbAll(storeName) {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        var out = [];
        try {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).getAll();
          req.onsuccess = function () {
            resolve(Array.isArray(req.result) ? req.result : []);
          };
          req.onerror = function () {
            resolve(out);
          };
        } catch (_e) {
          resolve(out);
        }
      });
    });
  }

  function idbPut(storeName, record) {
    return openDb().then(function (db) {
      if (!db) return record;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(record);
          tx.oncomplete = function () {
            resolve(record);
          };
          tx.onerror = function () {
            resolve(record);
          };
        } catch (_e) {
          resolve(record);
        }
      });
    });
  }

  function idbDelete(storeName, id) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(id);
          tx.oncomplete = function () {
            resolve();
          };
          tx.onerror = function () {
            resolve();
          };
        } catch (_e) {
          resolve();
        }
      });
    });
  }

  function memoryPut(storeName, record) {
    if (storeName === 'knowledge') memory.knowledge[record.id] = record;
    else if (storeName === 'aliases') memory.aliases[record.id] = record;
    else if (storeName === 'events') {
      memory.events.push(record);
      while (memory.events.length > 400) memory.events.shift();
    } else if (storeName === 'history') {
      memory.history.push(record);
      while (memory.history.length > 200) memory.history.shift();
    }
  }

  function memoryDeleteKnowledge(id) {
    delete memory.knowledge[id];
    Object.keys(memory.aliases).forEach(function (aid) {
      if (memory.aliases[aid] && memory.aliases[aid].knowledgeId === id) {
        delete memory.aliases[aid];
      }
    });
  }

  function emit(kind, record) {
    listeners.forEach(function (fn) {
      try {
        fn(kind, record);
      } catch (_e) { /* ignore */ }
    });
  }

  function notifySync(mutation) {
    syncHooks.forEach(function (fn) {
      try {
        fn(mutation);
      } catch (_e) { /* ignore */ }
    });
  }

  async function readHot() {
    var res = await storageGet([HOT_KEY]);
    return Array.isArray(res[HOT_KEY]) ? res[HOT_KEY] : [];
  }

  async function writeHot(list) {
    var trimmed = (list || []).slice(-HOT_MAX);
    var payload = {};
    payload[HOT_KEY] = trimmed;
    await storageSet(payload);
    return trimmed;
  }

  async function upsertHot(record) {
    var list = await readHot();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === record.id) {
        list[i] = record;
        found = true;
        break;
      }
    }
    if (!found) list.push(record);
    return writeHot(list);
  }

  async function removeHot(id) {
    var list = await readHot();
    return writeHot(
      list.filter(function (r) {
        return !r || r.id !== id;
      })
    );
  }

  function matchesProfile(record, profileId) {
    if (!profileId) return true;
    if (record.profileId == null || record.profileId === '') return true;
    return String(record.profileId) === String(profileId);
  }

  function recordScopeKey(rec) {
    return String(rec && rec.profileId != null ? rec.profileId : '') + '::' + String(rec && rec.canonicalKey || '');
  }

  function mergeRecords(lists) {
    var byId = {};
    var byScope = {};
    lists.forEach(function (list) {
      (list || []).forEach(function (rec) {
        if (!rec || !rec.id) return;
        var prev = byId[rec.id];
        if (!prev || (rec.updatedAt || 0) >= (prev.updatedAt || 0)) {
          byId[rec.id] = rec;
        }
      });
    });
    Object.keys(byId).forEach(function (id) {
      var rec = byId[id];
      if (!rec.canonicalKey) return;
      var k = recordScopeKey(rec);
      var prev = byScope[k];
      if (!prev || (rec.updatedAt || 0) >= (prev.updatedAt || 0)) {
        byScope[k] = rec;
      }
    });
    return Object.keys(byScope).map(function (k) {
      return byScope[k];
    });
  }

  function normalizeRecord(partial) {
    var C = global.FillApplyKnowledgeCanonical;
    var P = global.FillApplyKnowledgePolicy;
    var ts = now();
    var fieldType = partial.fieldType || 'string';
    if (C && C.normalizeFieldType) fieldType = C.normalizeFieldType(fieldType);
    else if (C && C.isValidFieldType && !C.isValidFieldType(fieldType)) fieldType = 'string';
    var display =
      C && C.normalizeValue
        ? C.normalizeValue(partial.displayValue != null ? partial.displayValue : partial.value, fieldType)
        : String(partial.value == null ? '' : partial.value).trim();
    var aliases = Array.isArray(partial.aliases)
      ? partial.aliases
          .map(function (a) {
            return String(a || '').trim();
          })
          .filter(Boolean)
      : [];
    // Deduplicate aliases (case-insensitive) while preserving first casing
    var seenAlias = {};
    aliases = aliases.filter(function (a) {
      var n = C && C.normalize ? C.normalize(a) : a.toLowerCase();
      if (!n || seenAlias[n]) return false;
      seenAlias[n] = true;
      return true;
    });
    var canonKey = String(partial.canonicalKey || '').trim();
    if (P && P.normalizeSemanticKey) canonKey = P.normalizeSemanticKey(canonKey) || canonKey;
    var source = partial.source || 'user_confirmed';
    if (source === 'user_confirm' || source === 'user_explicit') source = 'user_confirmed';
    return {
      id: partial.id || uuid(),
      canonicalKey: canonKey,
      fieldType: fieldType,
      value: display,
      displayValue: display,
      aliases: aliases,
      source: source,
      confidence: typeof partial.confidence === 'number' ? Math.max(0, Math.min(1, partial.confidence)) : 0,
      status: (function () {
        var s = String(partial.status || 'confirmed').toLowerCase();
        if (s === 'rejected') return 'rejected';
        if (s === 'provisional') return 'provisional';
        if (s === 'active' || s === 'learned' || s === '' || s === 'confirmed') return 'confirmed';
        return 'confirmed';
      })(),
      usageCount: typeof partial.usageCount === 'number' ? partial.usageCount : 0,
      createdAt: partial.createdAt || ts,
      updatedAt: partial.updatedAt || ts,
      lastUsedAt: partial.lastUsedAt || 0,
      lastSeenLabel: partial.lastSeenLabel || '',
      profileId: partial.profileId != null ? partial.profileId : null,
      provenance: partial.provenance && typeof partial.provenance === 'object' ? partial.provenance : {}
    };
  }

  /**
   * User-facing view: Key — Aliases — Type — Value.
   * Provenance/confidence stay internal.
   */
  function toDisplayRecord(rec) {
    if (!rec) return null;
    var C = global.FillApplyKnowledgeCanonical;
    var type =
      C && C.toUserFieldType ? C.toUserFieldType(rec.fieldType) : String(rec.fieldType || 'string');
    return {
      key: rec.canonicalKey || '',
      aliases: Array.isArray(rec.aliases) ? rec.aliases.slice() : [],
      type: type,
      value: rec.displayValue != null ? rec.displayValue : rec.value != null ? rec.value : '',
      id: rec.id,
      status: rec.status,
      confidence: rec.confidence,
      source: rec.source
    };
  }

  /**
   * Single write path. Memory → hot overlay → IDB. Sync hooks fire after.
   */
  async function applyMutation(mutation) {
    mutation = mutation || {};
    var kind = mutation.kind || 'upsert';
    var record = mutation.record ? normalizeRecord(mutation.record) : null;

    if (kind === 'upsert' && record) {
      var Policy = global.FillApplyKnowledgePolicy;
      if (!record.canonicalKey) {
        return null;
      }
      if (Policy && Policy.isRejectedGeneratedKey && Policy.isRejectedGeneratedKey(record.canonicalKey)) {
        return null;
      }
      if (isSecretKnowledgeRecord(record)) {
        return null;
      }
    }

    if (kind === 'upsert' && record && record.canonicalKey) {
      memoryPut('knowledge', record);
      (record.aliases || []).forEach(function (alias) {
        var C = global.FillApplyKnowledgeCanonical;
        var norm = C && C.normalize ? C.normalize(alias) : String(alias).toLowerCase();
        if (!norm) return;
        var a = {
          id: 'alias:' + record.canonicalKey + ':' + norm,
          aliasNorm: norm,
          canonicalKey: record.canonicalKey,
          knowledgeId: record.id,
          createdAt: record.updatedAt
        };
        memoryPut('aliases', a);
        idbPut('aliases', a);
      });
      await upsertHot(record);
      await idbPut('knowledge', record);
      emit('upsert', record);
    } else if (kind === 'delete' && mutation.id) {
      memoryDeleteKnowledge(mutation.id);
      await removeHot(mutation.id);
      await idbDelete('knowledge', mutation.id);
      emit('delete', { id: mutation.id });
    } else if (kind === 'event' && mutation.event) {
      var ev = Object.assign({ id: uuid(), ts: now() }, mutation.event);
      memoryPut('events', ev);
      await idbPut('events', ev);
    } else if (kind === 'history' && mutation.entry) {
      var h = Object.assign({ id: uuid(), ts: now() }, mutation.entry);
      memoryPut('history', h);
      await idbPut('history', h);
    }

    notifySync(mutation);
    return record;
  }

  async function putKnowledge(partial) {
    return applyMutation({ kind: 'upsert', record: partial });
  }

  async function deleteKnowledge(id) {
    return applyMutation({ kind: 'delete', id: id });
  }

  async function addEvent(event) {
    return applyMutation({ kind: 'event', event: event });
  }

  async function addHistory(entry) {
    return applyMutation({ kind: 'history', entry: entry });
  }

  async function listKnowledge(profileId) {
    var fromIdb = await idbAll('knowledge');
    var fromHot = await readHot();
    var fromMem = Object.keys(memory.knowledge).map(function (id) {
      return memory.knowledge[id];
    });
    return mergeRecords([fromIdb, fromHot, fromMem]).filter(function (rec) {
      return rec && rec.status !== 'rejected' && matchesProfile(rec, profileId);
    });
  }

  async function getByCanonical(canonicalKey, profileId) {
    var list = await listKnowledge(profileId);
    var key = String(canonicalKey || '');
    for (var i = 0; i < list.length; i++) {
      if (list[i].canonicalKey === key) return list[i];
    }
    return null;
  }

  var SECRET_KNOWLEDGE_RE =
    /password|passwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|credential|private[_-]?key/i;

  function isSecretKnowledgeRecord(rec) {
    if (!rec) return true;
    if (SECRET_KNOWLEDGE_RE.test(String(rec.canonicalKey || ''))) return true;
    if (SECRET_KNOWLEDGE_RE.test(String(rec.fieldType || ''))) return true;
    if (SECRET_KNOWLEDGE_RE.test(String(rec.lastSeenLabel || ''))) return true;
    var aliases = rec.aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      if (SECRET_KNOWLEDGE_RE.test(String(aliases[i] || ''))) return true;
    }
    return false;
  }

  function hasKnowledgeValue(rec) {
    if (!rec) return false;
    if (rec.value != null && String(rec.value).trim() !== '') return true;
    if (rec.displayValue != null && String(rec.displayValue).trim() !== '') return true;
    return false;
  }

  /**
   * Compact snapshot for injection / Options download.
   * Never exports password / secret-like keys.
   */
  async function exportSnapshot(profileId) {
    var records = await listKnowledge(profileId);
    records = records.filter(function (r) {
      return r && !isSecretKnowledgeRecord(r);
    });
    return {
      version: 1,
      kind: 'fill-apply-adaptive-knowledge',
      exportedAt: now(),
      profileId: profileId || null,
      records: records
    };
  }

  /**
   * Sync in-memory hydrate (fill inject / resolver). Skips secrets; does not invent values.
   */
  function importSnapshot(snapshot) {
    var records = snapshot && Array.isArray(snapshot.records) ? snapshot.records : [];
    var imported = 0;
    var skipped = 0;
    records.forEach(function (rec) {
      if (!rec || !rec.canonicalKey) {
        skipped += 1;
        return;
      }
      if (isSecretKnowledgeRecord(rec) || !hasKnowledgeValue(rec)) {
        skipped += 1;
        return;
      }
      if (!rec.id) rec = Object.assign({}, rec, { id: uuid() });
      memoryPut('knowledge', rec);
      imported += 1;
    });
    return { imported: imported, skipped: skipped };
  }

  /**
   * Durable Options import: merge (default) or replace into IDB + hot + memory.
   * Never invents values; never imports password-like keys.
   */
  async function importKnowledgeBundle(snapshot, opts) {
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var profileId =
      opts.profileId != null
        ? opts.profileId
        : snapshot && snapshot.profileId != null
          ? snapshot.profileId
          : null;
    var records = snapshot && Array.isArray(snapshot.records) ? snapshot.records : [];
    var imported = 0;
    var skipped = 0;

    if (mode === 'replace') {
      var existing = await listKnowledge(profileId);
      for (var d = 0; d < existing.length; d++) {
        if (existing[d] && existing[d].id) {
          try {
            await deleteKnowledge(existing[d].id);
          } catch (_eDel) {
            /* continue */
          }
        }
      }
    }

    var P = global.FillApplyKnowledgePolicy;
    var prepared = records;
    if (P && P.migrateRecords) {
      var migrated = P.migrateRecords(records);
      prepared = migrated.records;
      skipped += migrated.discarded || 0;
    }
    for (var i = 0; i < prepared.length; i++) {
      var rec = prepared[i];
      if (!rec) {
        skipped += 1;
        continue;
      }
      if (P && P.coerceRecordShape) rec = P.coerceRecordShape(rec) || rec;
      if (!rec || !rec.canonicalKey) {
        skipped += 1;
        continue;
      }
      if (P && P.isRejectedGeneratedKey && P.isRejectedGeneratedKey(rec.canonicalKey)) {
        skipped += 1;
        continue;
      }
      if (isSecretKnowledgeRecord(rec)) {
        skipped += 1;
        continue;
      }
      // Profile dictionary import may include empty alias shells (includeEmpty).
      // Adaptive KB-only imports still skip blanks so we never invent answers.
      if (!hasKnowledgeValue(rec) && !opts.includeEmpty) {
        skipped += 1;
        continue;
      }
      var partial = Object.assign({}, rec);
      if (profileId != null && profileId !== '') partial.profileId = profileId;
      if (mode === 'merge') {
        try {
          var prior = await getByCanonical(partial.canonicalKey, profileId);
          if (prior && prior.id) partial.id = prior.id;
        } catch (_ePrior) {
          /* ignore */
        }
      }
      if (!partial.id) partial.id = uuid();
      var saved = await putKnowledge(partial);
      if (saved) imported += 1;
      else skipped += 1;
    }
    return { imported: imported, skipped: skipped, mode: mode };
  }

  /**
   * Stamp a shallow profile copy with the snapshot. Never mutate the saved profile.
   */
  async function attachToProfile(profile) {
    var copy = profile && typeof profile === 'object' ? Object.assign({}, profile) : {};
    var profileId = copy.id || copy.profileId || null;
    if (!profileId && global.FillApplyProfile && global.FillApplyProfile.getActiveProfileId) {
      try {
        profileId = await global.FillApplyProfile.getActiveProfileId();
      } catch (_e) { /* ignore */ }
    }
    copy.__adaptiveKnowledge = await exportSnapshot(profileId);
    return copy;
  }

  async function getSettings() {
    var res = await storageGet([SETTINGS_KEY]);
    var raw = res[SETTINGS_KEY];
    return Object.assign({ learningEnabled: true }, raw && typeof raw === 'object' ? raw : {});
  }

  async function saveSettings(partial) {
    var cur = await getSettings();
    var next = Object.assign({}, cur, partial || {});
    var payload = {};
    payload[SETTINGS_KEY] = next;
    await storageSet(payload);
    return next;
  }


  function conflictKey(c) {
    return String((c && (c.id || c.canonicalKey)) || '') + '::' + String((c && c.proposedValue) || '');
  }

  async function readConflictsBag() {
    var bag = await storageGet([CONFLICTS_KEY]);
    var raw = bag && bag[CONFLICTS_KEY];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  async function writeConflictsBag(map) {
    var payload = {};
    payload[CONFLICTS_KEY] = map || {};
    await storageSet(payload);
  }

  /**
   * Queue an explicit conflict for Options review.
   * Never overwrites confirmed high-confidence knowledge by itself.
   */
  async function putConflict(partial) {
    partial = partial || {};
    var id = partial.id || uuid();
    var row = {
      id: id,
      canonicalKey: String(partial.canonicalKey || ''),
      label: String(partial.label || ''),
      fieldType: partial.fieldType || 'string',
      existingValue: partial.existingValue != null ? String(partial.existingValue) : '',
      proposedValue: partial.proposedValue != null ? String(partial.proposedValue) : '',
      existingConfidence: partial.existingConfidence != null ? Number(partial.existingConfidence) : null,
      existingStatus: partial.existingStatus || 'confirmed',
      existingId: partial.existingId || null,
      profileId: partial.profileId != null ? partial.profileId : null,
      host: partial.host || '',
      url: partial.url || '',
      reason: partial.reason || 'conflict_high_confidence',
      status: 'pending',
      createdAt: partial.createdAt || now(),
      updatedAt: now()
    };
    memory.conflicts[id] = row;
    try {
      var map = await readConflictsBag();
      // Dedupe pending rows for same key + proposed value
      Object.keys(map).forEach(function (k) {
        var cur = map[k];
        if (
          cur &&
          cur.status === 'pending' &&
          cur.canonicalKey === row.canonicalKey &&
          String(cur.proposedValue) === String(row.proposedValue) &&
          String(cur.profileId || '') === String(row.profileId || '')
        ) {
          delete map[k];
          delete memory.conflicts[k];
        }
      });
      map[id] = row;
      await writeConflictsBag(map);
    } catch (_e) { /* memory still holds it */ }
    emit('conflict', row);
    return row;
  }

  async function listConflicts(opts) {
    opts = opts || {};
    var map = {};
    try {
      map = await readConflictsBag();
    } catch (_e) {
      map = {};
    }
    Object.keys(memory.conflicts || {}).forEach(function (id) {
      map[id] = memory.conflicts[id];
    });
    var out = Object.keys(map)
      .map(function (id) {
        return map[id];
      })
      .filter(function (c) {
        if (!c) return false;
        if (opts.includeResolved) return true;
        return c.status === 'pending';
      })
      .sort(function (a, b) {
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });
    return out;
  }

  async function clearConflict(id) {
    if (!id) return false;
    delete memory.conflicts[id];
    try {
      var map = await readConflictsBag();
      if (map[id]) {
        delete map[id];
        await writeConflictsBag(map);
      }
    } catch (_e) { /* ignore */ }
    emit('conflict_cleared', { id: id });
    return true;
  }

  /**
   * Explicit resolution: keep | replace | alias.
   * keep — dismiss, leave confirmed value
   * replace — overwrite knowledge with proposed value (user confirmed)
   * alias — keep value, add proposed label as alias
   */
  async function resolveConflict(id, action, extra) {
    extra = extra || {};
    action = String(action || '').toLowerCase();
    var list = await listConflicts({ includeResolved: true });
    var row = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        row = list[i];
        break;
      }
    }
    if (!row) return { ok: false, reason: 'not_found' };
    if (action !== 'keep' && action !== 'replace' && action !== 'alias') {
      return { ok: false, reason: 'bad_action' };
    }

    var record = null;
    if (action === 'replace') {
      var existing = null;
      if (row.existingId) {
        var all = await listKnowledge(row.profileId);
        for (var j = 0; j < all.length; j++) {
          if (all[j].id === row.existingId) {
            existing = all[j];
            break;
          }
        }
      }
      if (!existing && row.canonicalKey) {
        existing = await getByCanonical(row.canonicalKey, row.profileId);
      }
      var aliases = existing && Array.isArray(existing.aliases) ? existing.aliases.slice() : [];
      if (row.label && aliases.indexOf(row.label) === -1) aliases.push(row.label);
      record = await putKnowledge({
        id: existing && existing.id,
        canonicalKey: row.canonicalKey,
        fieldType: row.fieldType || (existing && existing.fieldType) || 'string',
        value: row.proposedValue,
        displayValue: row.proposedValue,
        aliases: aliases,
        source: 'user_confirm',
        confidence: 1,
        status: 'confirmed',
        usageCount: existing ? (existing.usageCount || 0) + 1 : 1,
        createdAt: existing && existing.createdAt,
        lastSeenLabel: row.label || (existing && existing.lastSeenLabel) || '',
        profileId: row.profileId != null ? row.profileId : existing && existing.profileId,
        provenance: {
          host: row.host || '',
          url: row.url || '',
          originalLabel: row.label || '',
          previousValue: row.existingValue || '',
          autofilled: false,
          conflictResolution: 'replace'
        }
      });
    } else if (action === 'alias') {
      var existingA = null;
      if (row.canonicalKey) existingA = await getByCanonical(row.canonicalKey, row.profileId);
      if (existingA) {
        var aliasesA = Array.isArray(existingA.aliases) ? existingA.aliases.slice() : [];
        var label = row.label || extra.label || '';
        if (label && aliasesA.indexOf(label) === -1) aliasesA.push(label);
        existingA.aliases = aliasesA;
        existingA.updatedAt = now();
        existingA.source = existingA.source || 'user_confirm';
        record = await putKnowledge(existingA);
      }
    }
    // keep: no knowledge mutation

    await addEvent({
      kind: 'conflict_resolved',
      canonicalKey: row.canonicalKey,
      label: row.label,
      value: action === 'replace' ? row.proposedValue : row.existingValue,
      fieldType: row.fieldType,
      host: row.host || '',
      accepted: true,
      reason: 'resolve_' + action
    });

    await clearConflict(id);
    return { ok: true, action: action, record: record, conflict: row };
  }

  async function listEvents(limit) {
    var fromIdb = await idbAll('events');
    var all = fromIdb.concat(memory.events);
    var seen = {};
    var out = [];
    all
      .sort(function (a, b) {
        return (b.ts || 0) - (a.ts || 0);
      })
      .forEach(function (ev) {
        if (!ev || !ev.id || seen[ev.id]) return;
        seen[ev.id] = true;
        out.push(ev);
      });
    return out.slice(0, typeof limit === 'number' ? limit : 80);
  }

  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  function resetMemory() {
    memory.knowledge = {};
    memory.aliases = {};
    memory.events = [];
    memory.history = [];
    memory.conflicts = {};
  }

  global.FillApplyKnowledgeSync = {
    register: function (fn) {
      if (typeof fn === 'function') syncHooks.push(fn);
    },
    hooks: function () {
      return syncHooks.slice();
    }
  };


  async function migrateAndSanitizeKnowledge(profileId) {
    var P = global.FillApplyKnowledgePolicy;
    var list = await listKnowledge(profileId);
    if (!P || !P.migrateRecords) {
      return { kept: list.length, discarded: 0, records: list };
    }
    var result = P.migrateRecords(list);
    var keepIds = {};
    result.records.forEach(function (r) {
      if (r && r.id) keepIds[r.id] = true;
    });
    // Delete rows whose id is not among survivors (invalid / dupes without winning id)
    for (var i = 0; i < list.length; i++) {
      var cur = list[i];
      if (!cur || !cur.id) continue;
      if (!keepIds[cur.id]) {
        try {
          await deleteKnowledge(cur.id);
        } catch (_e) { /* continue */ }
      }
    }
    for (var j = 0; j < result.records.length; j++) {
      var rec = result.records[j];
      if (!rec || !rec.canonicalKey) continue;
      if (P.isRejectedGeneratedKey && P.isRejectedGeneratedKey(rec.canonicalKey)) continue;
      try {
        await putKnowledge(rec);
      } catch (_e2) { /* continue */ }
    }
    return result;
  }

  async function recordFillUsage(canonicalKey, profileId) {
    if (!canonicalKey) return null;
    var existing = await getByCanonical(canonicalKey, profileId);
    if (!existing) return null;
    existing.usageCount = (existing.usageCount || 0) + 1;
    existing.lastUsedAt = now();
    return putKnowledge(existing);
  }

  global.FillApplyKnowledgeStore = {
    DB_NAME: DB_NAME,
    HOT_KEY: HOT_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    uuid: uuid,
    useExtensionIdb: useExtensionIdb,
    open: openDb,
    applyMutation: applyMutation,
    putKnowledge: putKnowledge,
    deleteKnowledge: deleteKnowledge,
    addEvent: addEvent,
    addHistory: addHistory,
    listKnowledge: listKnowledge,
    getByCanonical: getByCanonical,
    exportSnapshot: exportSnapshot,
    importSnapshot: importSnapshot,
    importKnowledgeBundle: importKnowledgeBundle,
    migrateAndSanitizeKnowledge: migrateAndSanitizeKnowledge,
    recordFillUsage: recordFillUsage,
    isSecretKnowledgeRecord: isSecretKnowledgeRecord,
    attachToProfile: attachToProfile,
    getSettings: getSettings,
    saveSettings: saveSettings,
    listEvents: listEvents,
    CONFLICTS_KEY: CONFLICTS_KEY,
    putConflict: putConflict,
    listConflicts: listConflicts,
    resolveConflict: resolveConflict,
    clearConflict: clearConflict,
    deleteConflict: clearConflict,
    subscribe: subscribe,
    resetMemory: resetMemory,
    normalizeRecord: normalizeRecord,
    toDisplayRecord: toDisplayRecord
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
