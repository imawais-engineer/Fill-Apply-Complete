/**
 * App Settings — Adaptive Dictionary (compact searchable cards).
 * Model: Question + Answer + Type + Semantic identity + Aliases.
 * No meaningless % confidence. source=user_confirmed; usage on fill only.
 */
(function () {
  'use strict';

  var listEl = document.getElementById('knowledgeList');
  var emptyEl = document.getElementById('knowledgeEmpty');
  var filterEl = document.getElementById('knowledgeFilter');
  var typeFilterEl = document.getElementById('knowledgeTypeFilter');
  var sortEl = document.getElementById('knowledgeSort');
  var statusEl = document.getElementById('knowledgeStatus');
  var countEl = document.getElementById('knowledgeCountHint');
  var enabledEl = document.getElementById('knowledgeLearningEnabled');
  var btnRefresh = document.getElementById('btnKnowledgeRefresh');
  var btnAdd = document.getElementById('btnKnowledgeAdd');
  var btnExport = document.getElementById('btnKnowledgeExport');
  var btnImport = document.getElementById('btnKnowledgeImport');
  var importFile = document.getElementById('importKnowledgeFile');
  var conflictListEl = document.getElementById('knowledgeConflictList');
  var conflictEmptyEl = document.getElementById('knowledgeConflictEmpty');
  var conflictHintEl = document.getElementById('knowledgeConflictHint');

  if (!listEl) return;

  var cache = [];
  var conflictCache = [];
  var expanded = {};

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function store() {
    return globalThis.FillApplyKnowledgeStore;
  }

  function canonical() {
    return globalThis.FillApplyKnowledgeCanonical;
  }

  function userTypes() {
    var C = canonical();
    return (C && C.USER_FIELD_TYPES) || [
      'boolean',
      'string',
      'number',
      'date',
      'select',
      'multiselect'
    ];
  }

  function toUserType(t) {
    var C = canonical();
    return C && C.toUserFieldType ? C.toUserFieldType(t) : String(t || 'string');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function matchesFilter(rec, q, typeF) {
    if (typeF && toUserType(rec.fieldType) !== typeF) return false;
    if (!q) return true;
    var hay = [
      rec.canonicalKey,
      rec.displayValue,
      rec.value,
      rec.status,
      rec.fieldType,
      (rec.aliases || []).join(' '),
      rec.lastSeenLabel
    ]
      .join(' ')
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function sorted(list) {
    var mode = sortEl ? sortEl.value : 'updated';
    var out = list.slice();
    out.sort(function (a, b) {
      if (mode === 'key') {
        return String(a.canonicalKey || '').localeCompare(String(b.canonicalKey || ''));
      }
      if (mode === 'usage') {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return out;
  }

  function render() {
    var q = filterEl ? String(filterEl.value || '').trim().toLowerCase() : '';
    var typeF = typeFilterEl ? String(typeFilterEl.value || '') : '';
    listEl.innerHTML = '';
    var shown = sorted(
      cache.filter(function (rec) {
        return matchesFilter(rec, q, typeF);
      })
    );
    if (countEl) {
      countEl.textContent = cache.length ? '(' + cache.length + ')' : '';
    }
    if (emptyEl) {
      emptyEl.hidden = shown.length > 0;
      if (!cache.length) {
        emptyEl.textContent =
          'No learned facts yet. Confirm answers via Save on forms or Complete Missing Information.';
      } else if (!shown.length) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'No facts match this filter.';
      }
    }
    shown.forEach(function (rec) {
      listEl.appendChild(cardFor(rec));
    });
  }

  function cardFor(rec) {
    var card = document.createElement('article');
    card.className = 'knowledge-card knowledge-card-compact';
    card.dataset.id = rec.id;
    var isOpen = !!expanded[rec.id];
    var question =
      (rec.aliases && rec.aliases[0]) || rec.lastSeenLabel || rec.canonicalKey || '';
    var answer = rec.displayValue != null ? rec.displayValue : rec.value || '';
    var used = rec.usageCount || 0;
    var userType = toUserType(rec.fieldType);

    card.innerHTML =
      '<button type="button" class="k-summary" aria-expanded="' +
      (isOpen ? 'true' : 'false') +
      '">' +
      '<span class="k-summary-q">' +
      escapeHtml(question) +
      '</span>' +
      '<span class="k-summary-a">' +
      escapeHtml(answer) +
      '</span>' +
      '<span class="k-summary-meta">' +
      escapeHtml(userType) +
      ' · ' +
      escapeHtml(rec.canonicalKey || '') +
      (used ? ' · used ' + used + '×' : '') +
      '</span>' +
      '</button>' +
      '<div class="k-expand" ' +
      (isOpen ? '' : 'hidden') +
      '>' +
      '<div class="k-model">' +
      '<label class="k-row"><span class="k-label">Semantic key</span><input class="k-key-input" readonly /></label>' +
      '<label class="k-row"><span class="k-label">Question / aliases</span><input class="k-alias-edit" placeholder="Wording variants, comma-separated" /></label>' +
      '<div class="k-row-grid">' +
      '<label class="k-row"><span class="k-label">Type</span><select class="k-type"></select></label>' +
      '<label class="k-row"><span class="k-label">Answer</span><input class="k-value" /></label>' +
      '</div>' +
      '</div>' +
      '<p class="k-meta-line"></p>' +
      '<div class="k-actions">' +
      '<button type="button" class="primary k-save">Save</button>' +
      '<button type="button" class="ghost k-delete">Delete</button>' +
      '</div>' +
      '</div>';

    card.querySelector('.k-key-input').value = rec.canonicalKey || '';
    card.querySelector('.k-value').value = answer;
    card.querySelector('.k-alias-edit').value = (rec.aliases || []).join(', ');
    card.querySelector('.k-meta-line').textContent =
      (rec.source || 'user_confirmed') +
      (rec.status && rec.status !== 'confirmed' ? ' · ' + rec.status : '') +
      (used ? ' · used ' + used + '× on fill' : ' · not yet used on fill');

    var typeSel = card.querySelector('.k-type');
    userTypes().forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === userType) opt.selected = true;
      typeSel.appendChild(opt);
    });

    card.querySelector('.k-summary').addEventListener('click', function () {
      expanded[rec.id] = !expanded[rec.id];
      render();
    });
    card.querySelector('.k-save').addEventListener('click', function () {
      saveCard(card, rec);
    });
    card.querySelector('.k-delete').addEventListener('click', function () {
      removeCard(rec);
    });
    return card;
  }

  async function saveCard(card, rec) {
    var S = store();
    if (!S) return;
    var value = card.querySelector('.k-value').value;
    var aliases = String(card.querySelector('.k-alias-edit').value || '')
      .split(',')
      .map(function (a) {
        return a.trim();
      })
      .filter(Boolean);
    var next = Object.assign({}, rec, {
      displayValue: value,
      value: value,
      fieldType: card.querySelector('.k-type').value,
      aliases: aliases,
      source: 'user_confirmed',
      confidence: 0,
      status: 'confirmed',
      updatedAt: Date.now()
    });
    try {
      await S.putKnowledge(next);
      setStatus('Saved ' + next.canonicalKey, 'ok');
      await load();
    } catch (e) {
      setStatus('Save failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function removeCard(rec) {
    var S = store();
    if (!S) return;
    if (!confirm('Delete learned fact “' + rec.canonicalKey + '”?')) return;
    try {
      await S.deleteKnowledge(rec.id);
      setStatus('Deleted ' + rec.canonicalKey, 'ok');
      await load();
    } catch (e) {
      setStatus('Delete failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  function renderConflicts() {
    if (!conflictListEl) return;
    conflictListEl.innerHTML = '';
    if (conflictHintEl) {
      conflictHintEl.hidden = !conflictCache.length;
      conflictHintEl.textContent = conflictCache.length
        ? conflictCache.length +
          ' pending conflict' +
          (conflictCache.length === 1 ? '' : 's') +
          ' — Keep / Replace / Add alias / Cancel.'
        : '';
    }
    if (conflictEmptyEl) {
      conflictEmptyEl.hidden = conflictCache.length > 0;
    }
    conflictCache.forEach(function (row) {
      conflictListEl.appendChild(conflictCard(row));
    });
  }

  function conflictCard(row) {
    var card = document.createElement('article');
    card.className = 'knowledge-card knowledge-conflict-card';
    card.dataset.id = row.id;
    var host = row.host ? ' · ' + row.host : '';
    card.innerHTML =
      '<p class="k-conflict-title"><strong>Conflict</strong> on <code class="k-key">' +
      escapeHtml(row.canonicalKey || '') +
      '</code>' +
      escapeHtml(host) +
      '</p>' +
      '<p class="k-meta-line">Question: ' +
      escapeHtml(row.label || '(none)') +
      '</p>' +
      '<div class="k-conflict-values">' +
      '<div><span class="k-label">Stored</span><div class="k-conflict-val">' +
      escapeHtml(row.existingValue || '') +
      '</div></div>' +
      '<div><span class="k-label">Proposed</span><div class="k-conflict-val">' +
      escapeHtml(row.proposedValue || '') +
      '</div></div>' +
      '</div>' +
      '<div class="k-actions">' +
      '<button type="button" class="ghost k-keep">Keep</button>' +
      '<button type="button" class="primary k-replace">Replace</button>' +
      '<button type="button" class="ghost k-alias">Add Alias</button>' +
      '<button type="button" class="ghost k-cancel">Cancel</button>' +
      '</div>';
    card.querySelector('.k-keep').addEventListener('click', function () {
      resolveConflictRow(row.id, 'keep');
    });
    card.querySelector('.k-replace').addEventListener('click', function () {
      resolveConflictRow(row.id, 'replace');
    });
    card.querySelector('.k-alias').addEventListener('click', function () {
      resolveConflictRow(row.id, 'alias');
    });
    card.querySelector('.k-cancel').addEventListener('click', function () {
      resolveConflictRow(row.id, 'cancel');
    });
    return card;
  }

  async function resolveConflictRow(id, action) {
    var S = store();
    if (!S || !S.resolveConflict) return;
    try {
      var res = await S.resolveConflict(id, action === 'cancel' ? 'keep' : action);
      if (action === 'cancel' && S.deleteConflict) {
        try {
          await S.deleteConflict(id);
        } catch (_e) {
          /* fall through — keep resolves + dismisses */
        }
      }
      if (!res || !res.ok) {
        setStatus('Conflict resolve failed: ' + ((res && res.reason) || 'unknown'), 'err');
        return;
      }
      setStatus(
        action === 'keep' || action === 'cancel'
          ? action === 'cancel'
            ? 'Cancelled'
            : 'Kept stored answer'
          : action === 'replace'
            ? 'Replaced with proposed answer'
            : 'Added question wording as alias (value unchanged)',
        'ok'
      );
      await load();
    } catch (e) {
      setStatus('Conflict resolve failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function load() {
    var S = store();
    if (!S) {
      setStatus('Knowledge store not loaded', 'err');
      return;
    }
    try {
      if (S.migrateAndSanitizeKnowledge) {
        try {
          await S.migrateAndSanitizeKnowledge();
        } catch (_m) { /* non-fatal */ }
      }
      cache = await S.listKnowledge();
      render();
      if (S.listConflicts) {
        conflictCache = await S.listConflicts();
        renderConflicts();
      }
      var settings = await S.getSettings();
      if (enabledEl) enabledEl.checked = settings.learningEnabled !== false;
    } catch (e) {
      setStatus('Could not load knowledge: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function addFact() {
    var S = store();
    if (!S) return;
    var key = prompt('Semantic key (e.g. sap_experience)', '');
    if (!key) return;
    var Policy = globalThis.FillApplyKnowledgePolicy;
    if (Policy && Policy.normalizeSemanticKey) key = Policy.normalizeSemanticKey(key);
    if (Policy && Policy.isRejectedGeneratedKey && Policy.isRejectedGeneratedKey(key)) {
      setStatus('Rejected generated key', 'err');
      return;
    }
    var value = prompt('Answer', '');
    if (value == null || String(value).trim() === '') return;
    var label = prompt('Question wording (optional)', key.replace(/_/g, ' '));
    var type = prompt('Type (boolean|string|number|date|select|multiselect)', 'string') || 'string';
    try {
      await S.putKnowledge({
        canonicalKey: String(key)
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_'),
        value: value,
        displayValue: value,
        fieldType: type,
        aliases: label ? [label] : [],
        source: 'user_confirmed',
        confidence: 0,
        status: 'confirmed',
        lastSeenLabel: label || ''
      });
      setStatus('Added ' + key, 'ok');
      await load();
    } catch (e) {
      setStatus('Add failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  function downloadJson(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  async function exportKnowledge() {
    var S = store();
    if (!S || !S.exportSnapshot) {
      setStatus('Knowledge store not loaded', 'err');
      return;
    }
    try {
      var snap = await S.exportSnapshot();
      var stamp = new Date().toISOString().slice(0, 10);
      downloadJson('fill-apply-knowledge-' + stamp + '.json', snap);
      setStatus('Exported ' + (snap.records || []).length + ' facts (secrets excluded)', 'ok');
    } catch (e) {
      setStatus('Export failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function importKnowledgeFromFile(file) {
    var S = store();
    if (!S) return;
    if (!file) return;
    var mode = 'merge';
    try {
      var choice = window.prompt(
        'Import mode: type "merge" (default, upsert by key) or "replace" (clear then import)',
        'merge'
      );
      if (choice == null) return;
      if (String(choice).trim().toLowerCase() === 'replace') mode = 'replace';
    } catch (_e) {
      mode = 'merge';
    }
    try {
      var text = await file.text();
      var snap = JSON.parse(text);
      if (!snap || typeof snap !== 'object') throw new Error('Invalid JSON');
      var result;
      if (typeof S.importKnowledgeBundle === 'function') {
        result = await S.importKnowledgeBundle(snap, { mode: mode });
      } else {
        result = S.importSnapshot(snap);
      }
      setStatus(
        'Imported ' +
          (result.imported || 0) +
          ' (' +
          mode +
          '); skipped ' +
          (result.skipped || 0),
        'ok'
      );
      await load();
    } catch (e) {
      setStatus('Import failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  if (btnRefresh) btnRefresh.addEventListener('click', load);
  if (btnAdd) btnAdd.addEventListener('click', addFact);
  if (filterEl) filterEl.addEventListener('input', render);
  if (typeFilterEl) typeFilterEl.addEventListener('change', render);
  if (sortEl) sortEl.addEventListener('change', render);
  if (btnExport) btnExport.addEventListener('click', exportKnowledge);
  if (btnImport && importFile) {
    btnImport.addEventListener('click', function () {
      importFile.value = '';
      importFile.click();
    });
    importFile.addEventListener('change', function () {
      var f = importFile.files && importFile.files[0];
      if (f) importKnowledgeFromFile(f);
    });
  }
  if (enabledEl) {
    enabledEl.addEventListener('change', function () {
      var S = store();
      if (!S) return;
      S.saveSettings({ learningEnabled: !!enabledEl.checked }).then(function () {
        setStatus(enabledEl.checked ? 'Learning on' : 'Learning paused', 'ok');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
