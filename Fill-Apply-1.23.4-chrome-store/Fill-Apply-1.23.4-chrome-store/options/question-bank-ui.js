/**
 * Question Bank Options UI — search / add / edit / delete / import / export.
 */
(function () {
  'use strict';

  var listEl = document.getElementById('qbList');
  var emptyEl = document.getElementById('qbEmpty');
  var filterEl = document.getElementById('qbFilter');
  var statusEl = document.getElementById('qbStatus');
  var countEl = document.getElementById('questionBankCountHint');
  var btnAdd = document.getElementById('btnQbAdd');
  var btnRefresh = document.getElementById('btnQbRefresh');
  var btnExport = document.getElementById('btnQbExport');
  var btnImport = document.getElementById('btnQbImport');
  var importFile = document.getElementById('importQbFile');
  if (!listEl) return;

  var cache = [];
  var expanded = {};

  function QB() {
    return globalThis.FillApplyQuestionBank;
  }

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    var q = filterEl ? String(filterEl.value || '').trim() : '';
    var api = QB();
    var shown = api && api.search ? api.search(q) : cache;
    listEl.innerHTML = '';
    if (countEl) countEl.textContent = cache.length ? '(' + cache.length + ')' : '';
    if (emptyEl) {
      emptyEl.hidden = shown.length > 0;
    }
    shown.forEach(function (rec) {
      listEl.appendChild(cardFor(rec));
    });
  }

  function cardFor(rec) {
    var card = document.createElement('article');
    card.className = 'knowledge-card knowledge-card-compact';
    var isOpen = !!expanded[rec.id];
    card.innerHTML =
      '<button type="button" class="k-summary">' +
      '<span class="k-summary-q">' +
      escapeHtml(rec.question) +
      '</span>' +
      '<span class="k-summary-a">' +
      escapeHtml(rec.answer) +
      '</span>' +
      '</button>' +
      '<div class="k-expand" ' +
      (isOpen ? '' : 'hidden') +
      '>' +
      '<label class="k-row"><span class="k-label">Question</span><input class="qb-q" /></label>' +
      '<label class="k-row"><span class="k-label">Answer</span><input class="qb-a" /></label>' +
      '<label class="k-row"><span class="k-label">Aliases</span><input class="qb-aliases" placeholder="comma-separated" /></label>' +
      '<div class="k-actions">' +
      '<button type="button" class="primary qb-save">Save</button>' +
      '<button type="button" class="ghost qb-del">Delete</button>' +
      '</div></div>';
    card.querySelector('.qb-q').value = rec.question || '';
    card.querySelector('.qb-a').value = rec.answer || '';
    card.querySelector('.qb-aliases').value = (rec.aliases || []).join(', ');
    card.querySelector('.k-summary').addEventListener('click', function () {
      expanded[rec.id] = !expanded[rec.id];
      render();
    });
    card.querySelector('.qb-save').addEventListener('click', async function () {
      var api = QB();
      if (!api) return;
      var aliases = String(card.querySelector('.qb-aliases').value || '')
        .split(',')
        .map(function (a) {
          return a.trim();
        })
        .filter(Boolean);
      var res = await api.upsert({
        id: rec.id,
        question: card.querySelector('.qb-q').value,
        answer: card.querySelector('.qb-a').value,
        aliases: aliases,
        fieldType: rec.fieldType || 'string'
      });
      setStatus(res.ok ? 'Saved' : 'Save failed', res.ok ? 'ok' : 'err');
      await load();
    });
    card.querySelector('.qb-del').addEventListener('click', async function () {
      if (!confirm('Delete this question-bank entry?')) return;
      var api = QB();
      if (!api) return;
      await api.remove(rec.id);
      setStatus('Deleted', 'ok');
      await load();
    });
    return card;
  }

  async function load() {
    var api = QB();
    if (!api) {
      setStatus('Question Bank not loaded', 'err');
      return;
    }
    await api.load();
    cache = api.list();
    render();
  }

  async function addEntry() {
    var api = QB();
    if (!api) return;
    var q = prompt('Question', '');
    if (!q) return;
    var a = prompt('Answer', '');
    if (a == null) return;
    var res = await api.upsert({ question: q, answer: a, aliases: [q] });
    setStatus(res.ok ? 'Added' : 'Add failed', res.ok ? 'ok' : 'err');
    await load();
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

  if (btnAdd) btnAdd.addEventListener('click', addEntry);
  if (btnRefresh) btnRefresh.addEventListener('click', load);
  if (filterEl) filterEl.addEventListener('input', render);
  if (btnExport) {
    btnExport.addEventListener('click', function () {
      var api = QB();
      if (!api) return;
      downloadJson('fill-apply-question-bank.json', api.exportSnapshot());
      setStatus('Exported', 'ok');
    });
  }
  if (btnImport && importFile) {
    btnImport.addEventListener('click', function () {
      importFile.value = '';
      importFile.click();
    });
    importFile.addEventListener('change', async function () {
      var f = importFile.files && importFile.files[0];
      if (!f) return;
      try {
        var snap = JSON.parse(await f.text());
        var api = QB();
        var res = await api.importSnapshot(snap, { mode: 'merge' });
        setStatus('Imported ' + (res.imported || 0), 'ok');
        await load();
      } catch (e) {
        setStatus('Import failed: ' + (e && e.message ? e.message : e), 'err');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
