/**
 * Observe explicit applicant input on application fields.
 * Autofill writes are not trusted. Corrections of autofilled values are learned.
 *
 * Attaches globalThis.FillApplyKnowledgeObserve.
 */
(function (global) {
  'use strict';

  var FILLED_ATTR = 'data-fill-apply-filled';
  var VALUE_ATTR = 'data-fill-apply-value';
  var DEBOUNCE_MS = 700;
  var timers = {};
  var started = false;

  function learnApi() {
    return global.FillApplyKnowledgeLearn;
  }

  function canonical() {
    return global.FillApplyKnowledgeCanonical;
  }

  function fillApi() {
    return global.__fillApply;
  }

  function labelFor(el) {
    var fill = fillApi();
    if (fill && typeof fill.getLabelText === 'function') return fill.getLabelText(el);
    var D = global.FillApplyDom;
    if (D && D.labelFor) return D.labelFor(el);
    return (el && el.getAttribute && (el.getAttribute('aria-label') || '')) || '';
  }

  function isSkippable(el) {
    if (!el) return true;
    var type = String(el.type || '').toLowerCase();
    if (type === 'password' || type === 'file' || type === 'hidden' || type === 'submit' || type === 'button') {
      return true;
    }
    return false;
  }

  function readValue(el) {
    var type = String(el.type || '').toLowerCase();
    if (type === 'checkbox') return el.checked ? 'Yes' : 'No';
    if (type === 'radio') {
      if (!el.checked) return '';
      var fill = fillApi();
      var lab = labelFor(el);
      return (el.value && el.value !== 'on' ? el.value : lab) || 'Yes';
    }
    if (el.tagName === 'SELECT' && el.multiple) {
      var picked = [];
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].selected) picked.push((el.options[i].textContent || el.options[i].value || '').trim());
      }
      return picked.join('; ');
    }
    if (el.tagName === 'SELECT') {
      var opt = el.options && el.options[el.selectedIndex];
      if (!opt) return String(el.value || '').trim();
      var t = (opt.textContent || '').trim();
      if (/^(select|choose|please select|--)/i.test(t)) return '';
      return t || String(el.value || '').trim();
    }
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      return String(el.textContent || '').trim();
    }
    return String(el.value || '').trim();
  }

  function hostInfo() {
    var host = '';
    var href = '';
    try {
      host = location.hostname;
      href = location.href;
    } catch (_e) { /* ignore */ }
    return { host: host, url: href };
  }

  function schedule(el) {
    var key = el.id || el.name || labelFor(el) || String(el.tagName);
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      delete timers[key];
      capture(el);
    }, DEBOUNCE_MS);
  }

  function capture(el) {
    if (isSkippable(el)) return;
    var Learn = learnApi();
    if (!Learn || typeof Learn.learn !== 'function') return;
    var C = canonical();
    var label = labelFor(el);
    var value = readValue(el);
    if (!value) return;
    var previous = el.getAttribute && el.getAttribute(VALUE_ATTR);
    var autofilled = !!(el.getAttribute && el.getAttribute(FILLED_ATTR));
    var kind = 'observe';
    if (autofilled && previous != null && String(previous) !== String(value)) kind = 'correct';
    var loc = hostInfo();
    var fieldType = C && C.inferFieldType ? C.inferFieldType(el, { type: el.type, label: label }) : 'text';
    var controlType = C && C.detectControlType ? C.detectControlType(el, { type: el.type, label: label }) : '';
    // Persist Key / Type / Value using the DOM control type when it is more specific
    // (select / radio / boolean) so gender never lands as free text in the dictionary.
    if (controlType === 'select' || controlType === 'multiselect' || controlType === 'radio') {
      fieldType = controlType === 'radio' ? 'select' : controlType;
    } else if (controlType === 'checkbox') {
      fieldType = 'boolean';
    }
    Promise.resolve(
      Learn.learn({
        label: label,
        value: value,
        fieldType: fieldType,
        controlType: controlType || fieldType,
        kind: kind,
        host: loc.host,
        url: loc.url,
        previousValue: previous || '',
        autofilled: autofilled && kind === 'correct',
        name: el.getAttribute && el.getAttribute('name'),
        placeholder: el.getAttribute && el.getAttribute('placeholder'),
        id: el.id || '',
        options: el.tagName === 'SELECT' && el.options
          ? Array.prototype.map.call(el.options, function (o) {
              return { value: o.value, text: (o.textContent || '').trim() };
            })
          : []
      })
    ).then(function (res) {
      if (!res) return;
      if (res.pending && res.proposal) {
        showConfirmToast(res.proposal, Learn);
        return;
      }
      if (res.accepted !== false || res.reason !== 'conflict_high_confidence') return;
      try {
        if (global.chrome && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'FILL_APPLY_KNOWLEDGE_CONFLICTS',
            notify: true,
            conflict: res.conflict || null,
            canonicalKey: res.canonicalKey || ''
          });
        }
      } catch (_e) { /* ignore */ }
    });
  }

  function showConfirmToast(proposal, Learn) {
    try {
      var existing = document.getElementById('fill-apply-learn-confirm');
      if (existing) existing.remove();
      var bar = document.createElement('div');
      bar.id = 'fill-apply-learn-confirm';
      bar.setAttribute('role', 'dialog');
      bar.style.cssText =
        'position:fixed;z-index:2147483646;right:16px;bottom:16px;max-width:360px;' +
        'background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:10px;' +
        'padding:12px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)';
      var q = String(proposal.label || proposal.canonicalKey || 'Answer');
      var v = String(proposal.value || '');
      bar.innerHTML =
        '<div style="font-weight:600;margin-bottom:6px">Save to Adaptive Dictionary?</div>' +
        '<div style="opacity:.85;margin-bottom:10px"><strong>' +
        escapeText(q) +
        '</strong><br/>' +
        escapeText(v).slice(0, 160) +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button type="button" data-act="no" style="padding:6px 10px;border-radius:6px;border:1px solid #4b5563;background:transparent;color:inherit;cursor:pointer">Don\'t Save</button>' +
        '<button type="button" data-act="yes" style="padding:6px 10px;border-radius:6px;border:0;background:#2563eb;color:#fff;cursor:pointer">Save</button>' +
        '</div>';
      document.documentElement.appendChild(bar);
      bar.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        bar.remove();
        if (act === 'yes' && Learn && Learn.confirmProposal) {
          Learn.confirmProposal(proposal.id);
        } else if (act === 'no' && Learn && Learn.rejectProposal) {
          Learn.rejectProposal(proposal.id);
        }
      });
    } catch (_e) { /* ignore */ }
  }

  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function onEvent(ev) {
    if (!ev || ev.isTrusted === false) return;
    var el = ev.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !(el.getAttribute && el.getAttribute('contenteditable') === 'true')) {
      return;
    }
    if (ev.type === 'change' || ev.type === 'blur') schedule(el);
  }

  function start() {
    if (started) return;
    started = true;
    document.addEventListener('change', onEvent, true);
    document.addEventListener('blur', onEvent, true);
  }

  start();

  global.FillApplyKnowledgeObserve = {
    start: start,
    capture: capture,
    readValue: readValue
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
