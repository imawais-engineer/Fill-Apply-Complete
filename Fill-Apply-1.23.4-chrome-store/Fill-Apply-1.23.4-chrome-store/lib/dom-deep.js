/**
 * Deep DOM engine — the single place that knows how to *find* things on a page.
 *
 * Job application forms are rarely plain documents:
 *   - ATS forms are embedded in iframes on company career sites (Greenhouse,
 *     Lever, Workable, SmartRecruiters, iCIMS, Glassdoor→Indeed).
 *   - Design systems put controls behind open shadow roots.
 *   - React/Vue render labels as sibling divs, not <label for>.
 *   - Listbox options render on a later tick, in a portal at <body> level.
 *
 * Every query helper here pierces open shadow roots and same-origin iframes, and
 * every interaction helper emits the full event sequence a real user produces so
 * framework state actually updates.
 *
 * Attaches globalThis.FillApplyDom.
 */
(function (global) {
  'use strict';

  var DEFAULT_WAIT_MS = 6000;
  var DEFAULT_POLL_MS = 120;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function doc() {
    return typeof document !== 'undefined' ? document : null;
  }

  function win(node) {
    try {
      var d = node && node.ownerDocument ? node.ownerDocument : doc();
      return (d && d.defaultView) || (typeof window !== 'undefined' ? window : null);
    } catch (_e) {
      return typeof window !== 'undefined' ? window : null;
    }
  }

  /**
   * All searchable roots reachable from `root`: the root itself, every open
   * shadow root beneath it, and every same-origin iframe document.
   *
   * Cross-origin frames throw on access and are skipped — those are covered by
   * injecting the content scripts with allFrames:true instead.
   */
  function collectRoots(root, maxRoots) {
    root = root || doc();
    maxRoots = maxRoots || 400;
    var out = [];
    if (!root) return out;
    var queue = [root];
    var guard = 0;
    while (queue.length && out.length < maxRoots && guard < 5000) {
      guard += 1;
      var current = queue.shift();
      if (!current || out.indexOf(current) !== -1) continue;
      out.push(current);

      var hosts;
      try {
        hosts = current.querySelectorAll ? current.querySelectorAll('*') : [];
      } catch (_eAll) {
        continue;
      }
      for (var i = 0; i < hosts.length; i++) {
        var el = hosts[i];
        if (el.shadowRoot) queue.push(el.shadowRoot);
        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
          try {
            var innerDoc = el.contentDocument;
            if (innerDoc && innerDoc.documentElement) queue.push(innerDoc);
          } catch (_eFrame) {
            /* cross-origin — handled by allFrames injection */
          }
        }
      }
    }
    return out;
  }

  function queryAll(selector, root) {
    var roots = collectRoots(root);
    var out = [];
    for (var r = 0; r < roots.length; r++) {
      var nodes;
      try {
        nodes = roots[r].querySelectorAll(selector);
      } catch (_e) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        if (out.indexOf(nodes[i]) === -1) out.push(nodes[i]);
      }
    }
    return out;
  }

  function query(selector, root) {
    var all = queryAll(selector, root);
    return all.length ? all[0] : null;
  }

  /** True when `el` is rendered and large enough for a user to interact with. */
  function isVisible(el) {
    if (!el) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        // Inputs styled to zero size but still focusable (custom file pickers)
        // count as present when their control wrapper is visible.
        if (!(el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'file')) return false;
      }
      var view = win(el);
      var style = view && view.getComputedStyle ? view.getComputedStyle(el) : null;
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      // Only a genuinely parsed zero hides an element — an empty or malformed
      // opacity string must not be coerced to 0.
      var opacity = parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity === 0) return false;
      return true;
    } catch (_e) {
      return true;
    }
  }

  function isInteractable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return isVisible(el);
  }

  function textOf(el) {
    if (!el) return '';
    return String(el.innerText || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Everything a human reads on a control: text, value, aria, title. */
  function accessibleText(el) {
    if (!el) return '';
    var parts = [
      textOf(el),
      el.value || '',
      el.getAttribute ? el.getAttribute('aria-label') || '' : '',
      el.getAttribute ? el.getAttribute('title') || '' : '',
      el.getAttribute ? el.getAttribute('data-testid') || '' : ''
    ];
    var labelledBy = el.getAttribute ? el.getAttribute('aria-labelledby') : '';
    if (labelledBy) parts.push(resolveIdRefs(el, labelledBy));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function resolveIdRefs(el, refs) {
    var root = el.getRootNode ? el.getRootNode() : doc();
    return String(refs || '')
      .split(/\s+/)
      .map(function (id) {
        if (!id) return '';
        var node = null;
        try {
          node = root.getElementById ? root.getElementById(id) : null;
        } catch (_e) {
          node = null;
        }
        if (!node) node = query('#' + cssEscape(id));
        return node ? textOf(node) : '';
      })
      .filter(Boolean)
      .join(' ');
  }

  function cssEscape(value) {
    var str = String(value == null ? '' : value);
    try {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
    } catch (_e) {
      /* fall through */
    }
    return str.replace(/([^\w-])/g, '\\$1');
  }

  /**
   * Label text for a form control, tried in order of reliability.
   *
   * The ancestor walk matters most: React ATS forms usually render
   * `<div class="field"><label>Email</label><div><input/></div></div>`, where
   * neither `label[for]` nor `previousElementSibling` finds anything.
   */
  function labelFor(el) {
    if (!el) return '';

    if (el.id) {
      var root = el.getRootNode ? el.getRootNode() : doc();
      var byFor = null;
      try {
        byFor = root.querySelector('label[for="' + cssEscape(el.id) + '"]');
      } catch (_e) {
        byFor = null;
      }
      if (!byFor) byFor = query('label[for="' + cssEscape(el.id) + '"]');
      if (byFor) {
        var forText = stripOptionNoise(textOf(byFor));
        if (forText) return forText;
      }
    }

    var ariaLabel = el.getAttribute ? el.getAttribute('aria-label') : '';
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    var labelledBy = el.getAttribute ? el.getAttribute('aria-labelledby') : '';
    if (labelledBy) {
      var refText = resolveIdRefs(el, labelledBy);
      if (refText) return refText;
    }

    var wrapping = el.closest ? el.closest('label') : null;
    if (wrapping) {
      var clone = wrapping.cloneNode(true);
      try {
        clone.querySelectorAll('input, textarea, select, button').forEach(function (n) {
          n.remove();
        });
      } catch (_eClone) {
        /* ignore */
      }
      var wrapText = stripOptionNoise(textOf(clone));
      if (wrapText) return wrapText;
    }

    var ancestorText = stripOptionNoise(labelFromAncestors(el));
    if (ancestorText) return ancestorText;

    var placeholder = el.getAttribute ? el.getAttribute('placeholder') : '';
    if (placeholder && placeholder.trim()) return stripOptionNoise(placeholder.trim());

    var legend = el.closest ? el.closest('fieldset') : null;
    if (legend) {
      var leg = legend.querySelector('legend');
      if (leg) return stripOptionNoise(textOf(leg));
    }

    return '';
  }

  /**
   * The question a radio group is asking, as opposed to the option the first
   * radio is labelled with. "Years of experience" rather than "0-2".
   */
  function groupQuestionFor(el) {
    if (!el) return '';
    var type = String(el.type || '').toLowerCase();
    if (type !== 'radio') return '';

    var rg = el.closest ? el.closest('[role="radiogroup"]') : null;
    if (rg) {
      var aria = rg.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      var labelledBy = rg.getAttribute('aria-labelledby');
      if (labelledBy) {
        var ref = resolveIdRefs(el, labelledBy);
        if (ref) return ref;
      }
    }

    var fieldset = el.closest ? el.closest('fieldset') : null;
    if (fieldset) {
      var legendEl = fieldset.querySelector('legend');
      if (legendEl) {
        var legendText = textOf(legendEl);
        if (legendText) return legendText;
      }
    }

    var node = el.parentElement;
    for (var depth = 0; depth < 6 && node; depth++) {
      var radios;
      try {
        radios = node.querySelectorAll('input[type="radio"]');
      } catch (_e) {
        radios = [];
      }
      if (radios.length < 2) {
        node = node.parentElement;
        continue;
      }

      var caption = null;
      try {
        caption = node.querySelector(
          'legend, h1, h2, h3, h4, h5, [class*="label" i], [class*="question" i], p'
        );
      } catch (_eCap) {
        caption = null;
      }
      if (caption) {
        var wrappingOne =
          caption.tagName === 'LABEL' && caption.querySelectorAll('input[type="radio"]').length === 1;
        var capText = textOf(caption);
        if (capText && capText.length <= 200 && !wrappingOne) return capText;
      }

      var prev = node.previousElementSibling;
      var hops = 0;
      while (prev && hops < 3) {
        if (!prev.querySelector || !prev.querySelector('input, textarea, select')) {
          var prevText = textOf(prev);
          if (prevText && prevText.length <= 200) return prevText;
        }
        prev = prev.previousElementSibling;
        hops += 1;
      }
      break;
    }
    return '';
  }

  /**
   * Walk up to 5 ancestors looking for the field's own caption. Stops as soon as
   * the container holds more than one control, so a field never inherits the
   * label of its neighbour.
   */
  function labelFromAncestors(el) {
    // Immediate previous siblings of the control itself — flat forms render
    // <label>Experience Level</label><select> under a shared parent that also
    // holds other fields, so the multi-control break below would otherwise
    // skip the caption entirely (Michael Page employment step).
    var prevEl = el.previousElementSibling;
    var hops0 = 0;
    while (prevEl && hops0 < 3) {
      if (!prevEl.querySelector || !prevEl.querySelector('input, textarea, select, [contenteditable="true"]')) {
        var t0 = textOf(prevEl);
        if (t0 && t0.length <= 200) return t0;
      }
      prevEl = prevEl.previousElementSibling;
      hops0 += 1;
    }

    var node = el.parentElement;
    for (var depth = 0; depth < 5 && node; depth++) {
      var controls;
      try {
        controls = node.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]');
      } catch (_e) {
        controls = [];
      }
      if (controls.length > 1) break;

      var caption = null;
      try {
        caption = node.querySelector(
          'label, legend, h1, h2, h3, h4, h5, p, [class*="label" i], [class*="Label"], [class*="question" i], [class*="Question"], [data-testid*="label" i]'
        );
      } catch (_eSel) {
        caption = null;
      }
      if (caption && !caption.contains(el)) {
        var capText = textOf(caption);
        if (capText && capText.length <= 200) return capText;
      }

      var direct = directTextOf(node);
      if (direct && direct.length <= 200) return direct;

      // A caption rendered as the previous sibling of the field's wrapper.
      var prev = node.previousElementSibling;
      var hops = 0;
      while (prev && hops < 3) {
        if (!prev.querySelector || !prev.querySelector('input, textarea, select')) {
          var prevText = textOf(prev);
          if (prevText && prevText.length <= 200) return prevText;
        }
        prev = prev.previousElementSibling;
        hops += 1;
      }

      node = node.parentElement;
    }
    return '';
  }

  /** Text belonging directly to `node`, ignoring text inside child elements. */
  function directTextOf(node) {
    if (!node || !node.childNodes) return '';
    var parts = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3) parts.push(child.textContent || '');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Required detection. ATS forms mark required fields half a dozen ways and the
   * asterisk in the label is often the only signal.
   */
  function isRequired(el, label) {
    if (!el) return false;
    if (el.required) return true;
    if (el.getAttribute) {
      if (el.getAttribute('aria-required') === 'true') return true;
      if (el.getAttribute('data-required') === 'true') return true;
    }
    var text = String(label == null ? labelFor(el) : label);
    if (/\*\s*$/.test(text.trim())) return true;
    if (/\(required\)|\brequired\b/i.test(text)) return true;
    try {
      var wrapper = el.closest('[class*="required" i], [data-required]');
      if (wrapper) return true;
    } catch (_e) {
      /* ignore */
    }
    return false;
  }

  /** Associated <label for> / wrapping label only — not aria/placeholder/name. */
  /**
   * Strip glued radio option text (YesNo / Yes/No) that ATS sometimes appends
   * to the question label when reading container textContent.
   */
  function stripOptionNoise(label) {
    var s = String(label || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    // Trailing "YesNo", "Yes No", "Yes/No", "Y/N" (with or without separators)
    s = s.replace(/[\s:?\-–—]*\bYes\s*\/?\s*No\b\s*$/i, '');
    s = s.replace(/[\s:?\-–—]*\bY\s*\/?\s*N\b\s*$/i, '');
    // Glued without space: "...ACCA?YesNo" or "...ACCAYesNo"
    s = s.replace(/YesNo\s*$/i, '');
    s = s.replace(/\?Yes\s*$/i, '?');
    s = s.replace(/\?No\s*$/i, '?');
    return s.replace(/\s+/g, ' ').trim();
  }

  function associatedLabelText(el) {
    if (!el) return '';
    var root = el.getRootNode ? el.getRootNode() : document;
    var query = function (sel) {
      try {
        return root.querySelector ? root.querySelector(sel) : null;
      } catch (_e) {
        return null;
      }
    };
    if (el.id) {
      var byFor = null;
      try {
        byFor = root.querySelector('label[for="' + cssEscape(el.id) + '"]');
      } catch (_e2) {
        byFor = null;
      }
      if (!byFor) byFor = query('label[for="' + cssEscape(el.id) + '"]');
      if (byFor) {
        var forText = stripOptionNoise(textOf(byFor));
        if (forText) return forText;
      }
    }
    var wrapping = el.closest ? el.closest('label') : null;
    if (wrapping) {
      var clone = wrapping.cloneNode(true);
      try {
        clone.querySelectorAll('input, textarea, select, button').forEach(function (n) {
          n.remove();
        });
      } catch (_eClone) { /* ignore */ }
      var wrapText = stripOptionNoise(textOf(clone));
      if (wrapText) return wrapText;
    }
    var ancestorText = stripOptionNoise(labelFromAncestors(el));
    if (ancestorText) return ancestorText;
    return '';
  }

  function fieldsetLegendText(el) {
    if (!el || !el.closest) return '';
    try {
      var fs = el.closest('fieldset');
      if (!fs) return '';
      var leg = fs.querySelector('legend');
      return leg ? textOf(leg) : '';
    } catch (_e) {
      return '';
    }
  }

  /** Normalized description of a control, used by field mapping and reports. */
  function describeField(el) {
    if (!el) return null;
    var tag = el.tagName || '';
    var type = String(el.type || '').toLowerCase();
    if (!type) {
      if (tag === 'TEXTAREA') type = 'textarea';
      else if (tag === 'SELECT') type = el.multiple ? 'select-multiple' : 'select';
      else if (el.getAttribute && el.getAttribute('contenteditable') != null) type = 'contenteditable';
      else type = 'text';
    }
    var get = function (name) {
      return (el.getAttribute && el.getAttribute(name)) || '';
    };
    var associated = stripOptionNoise(associatedLabelText(el));
    var ariaLabel = (get('aria-label') || '').trim();
    var groupContext = fieldsetLegendText(el);
    var placeholder = (get('placeholder') || '').trim();
    var question = '';
    if (type === 'radio') {
      // The option text ("0-2") is what a wrapping <label> may return.
      // The question the group is asking is what we need to map.
      question = groupQuestionFor(el) || '';
    } else {
      // Question / caption above the field (Michael Page: "First name" above
      // placeholder "Name"). Prefer this over awkward placeholders so mapping
      // does not see only "Name" / "Town" / "Telephone number".
      var ancestorQ = labelFromAncestors(el);
      if (ancestorQ && ancestorQ !== placeholder && ancestorQ !== ariaLabel) {
        question = ancestorQ;
      }
    }
    // Best visible question text for reports / legacy callers
    var label = question || associated || ariaLabel || placeholder || groupContext || '';
    return {
      tag: tag,
      type: type,
      name: get('name'),
      id: el.id || '',
      autocomplete: get('autocomplete'),
      placeholder: get('placeholder'),
      label: label,
      // Structured evidence — kept separate for semantic identity (v1.17.4)
      question: question || associated || '',
      ariaLabel: ariaLabel,
      groupContext: groupContext,
      required: isRequired(el, label),
      visible: isVisible(el),
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      // The control's own constraints decide what shape a value has to be in
      // before it will be accepted (phone masks, ZIP length, numeric ranges).
      pattern: get('pattern'),
      inputMode: get('inputmode'),
      maxLength: Number(el.maxLength) > 0 ? Number(el.maxLength) : null,
      min: get('min'),
      max: get('max'),
      step: get('step'),
      title: get('title'),
      accept: get('accept'),
      options: optionsOf(el)
    };
  }

  function optionsOf(el) {
    if (!el || el.tagName !== 'SELECT' || !el.options) return [];
    var out = [];
    for (var i = 0; i < el.options.length; i++) {
      out.push({
        value: el.options[i].value,
        text: (el.options[i].textContent || '').replace(/\s+/g, ' ').trim()
      });
    }
    return out;
  }

  function scrollIntoView(el) {
    if (!el || !el.scrollIntoView) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_e) {
      try {
        el.scrollIntoView();
      } catch (_e2) {
        /* ignore */
      }
    }
  }

  /**
   * Click the way a browser does: focus, then pointer → mouse → click.
   *
   * Libraries that listen for `pointerdown` or `mousedown` (react-select,
   * Radix, Headless UI, MUI) never open from a bare `.click()`.
   */
  function realClick(el) {
    if (!el) return false;
    scrollIntoView(el);
    var view = win(el);
    var opts = { bubbles: true, cancelable: true, composed: true, view: view };
    try {
      if (el.focus) el.focus({ preventScroll: true });
    } catch (_eFocus) {
      /* ignore */
    }
    var sequence = ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    for (var i = 0; i < sequence.length; i++) {
      try {
        var name = sequence[i];
        var Ctor = /^pointer/.test(name) && view && view.PointerEvent ? view.PointerEvent : view && view.MouseEvent;
        if (!Ctor) continue;
        el.dispatchEvent(new Ctor(name, opts));
      } catch (_eSeq) {
        /* keep going — some events are optional */
      }
    }
    try {
      el.click();
      return true;
    } catch (_eClick) {
      try {
        if (view && view.MouseEvent) {
          el.dispatchEvent(new view.MouseEvent('click', opts));
          return true;
        }
      } catch (_eDispatch) {
        /* ignore */
      }
    }
    return false;
  }

  /**
   * Set a value through the native property setter so React's value tracker sees
   * the change, then emit the events frameworks listen for.
   */
  function setValue(el, value) {
    if (!el) return false;
    var str = value == null ? '' : String(value);
    var view = win(el);
    var tag = el.tagName;

    if (el.getAttribute && el.getAttribute('contenteditable') != null && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      try {
        if (el.focus) el.focus({ preventScroll: true });
      } catch (_e) {
        /* ignore */
      }
      el.textContent = str;
      dispatchInputEvents(el, view);
      return true;
    }

    try {
      if (el.focus) el.focus({ preventScroll: true });
    } catch (_eFocus) {
      /* ignore */
    }

    try {
      var proto =
        tag === 'TEXTAREA'
          ? (view && view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype : null)
          : tag === 'SELECT'
            ? (view && view.HTMLSelectElement ? view.HTMLSelectElement.prototype : null)
            : (view && view.HTMLInputElement ? view.HTMLInputElement.prototype : null);
      var descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && descriptor.set) descriptor.set.call(el, str);
      else el.value = str;
    } catch (_eSet) {
      el.value = str;
    }

    dispatchInputEvents(el, view);
    return true;
  }

  function dispatchInputEvents(el, view) {
    view = view || win(el);
    var fire = function (Ctor, name, init) {
      try {
        if (!Ctor) return;
        el.dispatchEvent(new Ctor(name, init));
      } catch (_e) {
        /* ignore */
      }
    };
    var InputEventCtor = (view && view.InputEvent) || (view && view.Event);
    fire(InputEventCtor, 'input', { bubbles: true, composed: true });
    fire(view && view.Event, 'change', { bubbles: true });
  }

  /** Type into a field character by character — required by typeahead comboboxes. */
  async function typeInto(el, value, opts) {
    opts = opts || {};
    if (!el) return false;
    var str = value == null ? '' : String(value);
    var view = win(el);
    var perChar = opts.perCharMs != null ? opts.perCharMs : 25;

    try {
      if (el.focus) el.focus({ preventScroll: true });
    } catch (_e) {
      /* ignore */
    }
    setValue(el, '');

    for (var i = 0; i < str.length; i++) {
      var next = str.slice(0, i + 1);
      var key = str[i];
      try {
        if (view && view.KeyboardEvent) {
          el.dispatchEvent(new view.KeyboardEvent('keydown', { key: key, bubbles: true, composed: true }));
        }
      } catch (_eKd) {
        /* ignore */
      }
      setValue(el, next);
      try {
        if (view && view.KeyboardEvent) {
          el.dispatchEvent(new view.KeyboardEvent('keyup', { key: key, bubbles: true, composed: true }));
        }
      } catch (_eKu) {
        /* ignore */
      }
      if (perChar > 0) await sleep(perChar);
    }
    return true;
  }

  function pressKey(el, key) {
    if (!el) return false;
    var view = win(el);
    if (!view || !view.KeyboardEvent) return false;
    var init = { key: key, bubbles: true, cancelable: true, composed: true };
    try {
      el.dispatchEvent(new view.KeyboardEvent('keydown', init));
      el.dispatchEvent(new view.KeyboardEvent('keyup', init));
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Resolve as soon as `predicate()` returns something truthy.
   *
   * Backed by a MutationObserver on every reachable root plus a polling
   * fallback, because portalled listbox options are appended outside the
   * subtree that triggered them.
   */
  function waitFor(predicate, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_WAIT_MS;
    var pollMs = opts.pollMs != null ? opts.pollMs : DEFAULT_POLL_MS;
    var root = opts.root || doc();

    return new Promise(function (resolve) {
      var settled = false;
      var observers = [];
      var pollTimer = null;
      var timeoutTimer = null;

      function cleanup() {
        observers.forEach(function (o) {
          try {
            o.disconnect();
          } catch (_e) {
            /* ignore */
          }
        });
        observers = [];
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }

      function check() {
        if (settled) return true;
        var value = null;
        try {
          value = predicate();
        } catch (_e) {
          value = null;
        }
        if (value) {
          settled = true;
          cleanup();
          resolve(value);
          return true;
        }
        return false;
      }

      if (check()) return;

      try {
        if (typeof MutationObserver !== 'undefined') {
          collectRoots(root, 60).forEach(function (r) {
            var target = r.documentElement || r.body || r;
            if (!target || !target.nodeType) return;
            var observer = new MutationObserver(function () {
              check();
            });
            observer.observe(target, { childList: true, subtree: true, attributes: true });
            observers.push(observer);
          });
        }
      } catch (_eObs) {
        /* polling still covers us */
      }

      pollTimer = setInterval(check, pollMs);
      timeoutTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, timeoutMs);
    });
  }

  function waitForSelector(selector, opts) {
    opts = opts || {};
    return waitFor(function () {
      var found = queryAll(selector, opts.root);
      if (opts.visibleOnly !== false) found = found.filter(isVisible);
      return found.length ? found : null;
    }, opts);
  }

  /** Wait until the DOM stops changing, then resolve. */
  function waitForQuiet(opts) {
    opts = opts || {};
    var quietMs = opts.quietMs != null ? opts.quietMs : 400;
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 5000;
    return new Promise(function (resolve) {
      var done = false;
      var quietTimer = null;
      var observers = [];

      function finish() {
        if (done) return;
        done = true;
        if (quietTimer) clearTimeout(quietTimer);
        observers.forEach(function (o) {
          try {
            o.disconnect();
          } catch (_e) {
            /* ignore */
          }
        });
        resolve();
      }

      function bump() {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      }

      try {
        if (typeof MutationObserver !== 'undefined') {
          collectRoots(doc(), 40).forEach(function (r) {
            var target = r.documentElement || r.body || r;
            if (!target || !target.nodeType) return;
            var observer = new MutationObserver(bump);
            observer.observe(target, { childList: true, subtree: true });
            observers.push(observer);
          });
        }
      } catch (_eObs) {
        /* ignore */
      }

      bump();
      setTimeout(finish, timeoutMs);
    });
  }

  global.FillApplyDom = {
    sleep: sleep,
    collectRoots: collectRoots,
    queryAll: queryAll,
    query: query,
    cssEscape: cssEscape,
    isVisible: isVisible,
    isInteractable: isInteractable,
    textOf: textOf,
    directTextOf: directTextOf,
    accessibleText: accessibleText,
    stripOptionNoise: stripOptionNoise,
    labelFor: labelFor,
    groupQuestionFor: groupQuestionFor,
    isRequired: isRequired,
    describeField: describeField,
    scrollIntoView: scrollIntoView,
    realClick: realClick,
    setValue: setValue,
    typeInto: typeInto,
    pressKey: pressKey,
    waitFor: waitFor,
    waitForSelector: waitForSelector,
    waitForQuiet: waitForQuiet
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
