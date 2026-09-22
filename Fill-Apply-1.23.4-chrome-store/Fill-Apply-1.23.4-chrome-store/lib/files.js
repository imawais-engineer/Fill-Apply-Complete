/**
 * File / DataTransfer helpers for attaching resume & cover letter.
 * Handles visible + hidden file inputs and Attach/Upload buttons
 * (Greenhouse / Ashby style).
 *
 * Attaches API to globalThis.FillApplyFiles.
 */
(function (global) {
  'use strict';

  function base64ToUint8Array(base64) {
    const cleaned = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
    const binary = atob(cleaned);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error('FileReader failed'));
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Forms validate the File's own `type`, so a .docx stored with a generic
   * content type gets rejected. Infer the type from the filename instead.
   */
  const MIME_BY_EXT = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf',
    txt: 'text/plain'
  };

  function extensionOf(name) {
    const m = String(name || '')
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function mimeForName(name, storedMime) {
    const stored = String(storedMime || '').toLowerCase();
    const inferred = MIME_BY_EXT[extensionOf(name)];
    if (stored && stored !== 'application/octet-stream' && stored !== 'binary/octet-stream') {
      return stored;
    }
    return inferred || stored || 'application/octet-stream';
  }

  function fileFromBase64(base64, name, mime) {
    const bytes = base64ToUint8Array(base64);
    const type = mimeForName(name, mime);
    const blob = new Blob([bytes], { type: type });
    try {
      return new File([blob], name || 'document.bin', { type: type });
    } catch (e) {
      blob.name = name || 'document.bin';
      return blob;
    }
  }

  function fileFromArrayBuffer(buffer, name, mime) {
    const type = mime || 'application/octet-stream';
    const blob = new Blob([buffer], { type: type });
    try {
      return new File([blob], name || 'document.bin', { type: type });
    } catch (e) {
      blob.name = name || 'document.bin';
      return blob;
    }
  }

  /** Inputs this run has already filled, so repeated passes stay idempotent. */
  const ATTACHED_ATTR = 'data-fill-apply-attached';

  /** A DataTransfer holding `files`, or null where the API is unavailable. */
  function fileTransfer(files) {
    try {
      const dt = new DataTransfer();
      files.forEach(function (f) {
        if (f) dt.items.add(f);
      });
      return dt;
    } catch (_e) {
      return null;
    }
  }

  /** FileList stand-in for environments without a constructible DataTransfer. */
  function fileListLike(files) {
    const list = files.slice();
    list.item = function (i) {
      return list[i] || null;
    };
    return list;
  }

  /**
   * Assign one or more File objects to an <input type="file">.
   *
   * DataTransfer is the only way to give an input a real FileList, which is
   * what makes this work without ever opening the operating system's file
   * dialog. Where the input refuses the assignment the value is defined on the
   * element directly so framework change handlers still see the file.
   */
  function assignFilesToInput(input, files) {
    if (!input || String(input.type || '').toLowerCase() !== 'file') {
      return { ok: false, error: 'Not a file input' };
    }
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (!list.length) return { ok: false, error: 'No file to attach' };

    let assigned = false;
    const dt = fileTransfer(list);
    if (dt) {
      try {
        input.files = dt.files;
        assigned = !!(input.files && input.files.length);
      } catch (_e) {
        assigned = false;
      }
    }
    if (!assigned) {
      try {
        Object.defineProperty(input, 'files', {
          configurable: true,
          writable: true,
          value: fileListLike(list)
        });
        assigned = !!(input.files && input.files.length);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (!assigned) return { ok: false, error: 'Input rejected the file assignment' };

    try {
      input.setAttribute(ATTACHED_ATTR, list[0].name || 'document');
    } catch (_e) {
      /* ignore */
    }
    dispatchFileEvents(input);
    return {
      ok: true,
      count: input.files.length,
      hasFiles: true,
      usedDataTransfer: !!dt
    };
  }

  function dispatchFileEvents(input) {
    ['input', 'change'].forEach(function (type) {
      try {
        input.dispatchEvent(new Event(type, { bubbles: true }));
      } catch (_e) {
        /* ignore */
      }
    });
    try {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_e) {
      /* ignore */
    }
  }

  /**
   * Run `fn` with the native file dialog disabled.
   *
   * Revealing a hidden input usually means clicking an Attach button whose
   * handler calls `input.click()`. In a browser that opens the operating
   * system's file chooser and hands the job back to the applicant — the exact
   * thing pre-loading documents is meant to avoid. Intercepting the call still
   * tells us which input the site wanted to use, which is all we need.
   */
  function withPickerSuppressed(fn) {
    const proto = typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null;
    const state = { clicked: [], suppressed: 0 };
    if (!proto) return fn(state);

    const originalClick = proto.click;
    const originalShowPicker = proto.showPicker;
    const hadShowPicker = typeof originalShowPicker === 'function';

    function intercept(original) {
      return function () {
        if (String(this.type || '').toLowerCase() === 'file') {
          state.suppressed += 1;
          if (state.clicked.indexOf(this) === -1) state.clicked.push(this);
          return undefined;
        }
        return original ? original.apply(this, arguments) : undefined;
      };
    }

    proto.click = intercept(originalClick);
    if (hadShowPicker) proto.showPicker = intercept(originalShowPicker);
    try {
      return fn(state);
    } finally {
      proto.click = originalClick;
      if (hadShowPicker) proto.showPicker = originalShowPicker;
      else delete proto.showPicker;
    }
  }

  /** Does this input's `accept` list allow the file we hold? */
  function acceptsFile(input, file) {
    const accept = String((input.getAttribute && input.getAttribute('accept')) || '').trim();
    if (!accept) return true;
    const ext = '.' + extensionOf(file && file.name);
    const mime = String((file && file.type) || '').toLowerCase();
    return accept.split(',').some(function (token) {
      const t = token.trim().toLowerCase();
      if (!t) return false;
      if (t === '*' || t === '*/*') return true;
      if (t.charAt(0) === '.') return t === ext;
      if (t.slice(-2) === '/*') return mime.indexOf(t.slice(0, -1)) === 0;
      return t === mime;
    });
  }

  /** Visible text around an input, used to spot a filename the page already shows. */
  function containerTextNear(el) {
    let node = el && el.parentElement;
    for (let i = 0; i < 3 && node; i++) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
      node = node.parentElement;
    }
    return '';
  }

  /**
   * A document already on this input — either one we attached, or one the site
   * kept from a previous application (Indeed and LinkedIn both do). Replacing
   * someone's existing upload is not this extension's call to make.
   */
  function existingAttachment(input) {
    if (!input) return null;
    if (input.files && input.files.length) {
      return { name: input.files[0].name || 'file', source: 'input' };
    }
    if (input.getAttribute && input.getAttribute(ATTACHED_ATTR)) {
      return { name: input.getAttribute(ATTACHED_ATTR), source: 'previous_pass' };
    }
    // Spaces are excluded so a neighbouring label is not read as part of the
    // filename ("Resume alex-cv.pdf" is a label plus a file, not one name).
    const m = containerTextNear(input).match(/[\w][\w\-.]*\.(pdf|docx?|odt|rtf|txt)\b/i);
    return m ? { name: m[0].trim(), source: 'page' } : null;
  }

  function dom() {
    return global.FillApplyDom || null;
  }

  /** Deep query (shadow roots + same-origin frames) with a flat-DOM fallback. */
  function queryAllDeep(selector, root) {
    const D = dom();
    if (D && D.queryAll) return D.queryAll(selector, root);
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    } catch (_e) {
      return [];
    }
  }

  function escapeId(value) {
    const D = dom();
    if (D && D.cssEscape) return D.cssEscape(value);
    try {
      return CSS.escape(value);
    } catch (_e) {
      return String(value).replace(/([^\w-])/g, '\\$1');
    }
  }

  function nearbyText(el) {
    const parts = [];
    if (!el) return '';
    parts.push(el.name || '', el.id || '', el.getAttribute('accept') || '');
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('data-testid') || '');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(function (id) {
        const n = queryAllDeep('#' + escapeId(id))[0];
        if (n) parts.push(n.textContent || '');
      });
    }
    const label = el.closest('label');
    if (label) parts.push(label.textContent || '');
    if (el.id) {
      const byFor = queryAllDeep('label[for="' + escapeId(el.id) + '"]')[0];
      if (byFor) parts.push(byFor.textContent || '');
    }
    // Walk up a few ancestors for section headings / "Resume" text
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++) {
      const heading = node.querySelector(
        'label, legend, h1, h2, h3, h4, .label, [class*="label"], [class*="Label"]'
      );
      if (heading) parts.push(heading.textContent || '');
      const direct = Array.from(node.childNodes)
        .filter(function (c) {
          return c.nodeType === 3;
        })
        .map(function (c) {
          return c.textContent || '';
        })
        .join(' ');
      if (direct.trim()) parts.push(direct);
      node = node.parentElement;
    }
    return parts.join(' ').toLowerCase();
  }

  function classifyKind(meta, hintsList) {
    let kind = 'unknown';
    // Cover letter first so "cover letter / CV pack" does not become resume-only.
    if (/cover\s*letter|coverletter|cover_letter|covering\s*letter|letter\s*of\s*interest|motivation\s*letter/.test(meta)) {
      kind = 'cover';
    } else if (/\bresume\b|\bcv\b|c\.v\.?|curriculum(\s*vitae)?/.test(meta)) {
      kind = 'resume';
    }

    if (hintsList && hintsList.length) {
      for (let i = 0; i < hintsList.length; i++) {
        const h = hintsList[i];
        if (h && h.match && new RegExp(h.match, 'i').test(meta)) {
          kind = h.kind || kind;
        }
      }
    }
    return kind;
  }

  /**
   * Find all file inputs including hidden ones.
   */
  function findFileInputs(hints) {
    const hintsList = Array.isArray(hints) ? hints : [];
    const found = [];
    const seen = new Set();
    const all = queryAllDeep('input[type="file"]');
    all.forEach(function (el) {
      if (el.disabled) return;
      if (seen.has(el)) return;
      seen.add(el);
      const meta = nearbyText(el);
      let kind = classifyKind(meta, hintsList);

      if (hintsList.length) {
        for (let i = 0; i < hintsList.length; i++) {
          const h = hintsList[i];
          if (h && h.selector) {
            try {
              if (el.matches(h.selector)) kind = h.kind || kind;
              const matched = queryAllDeep(h.selector)[0];
              if (matched === el) kind = h.kind || kind;
            } catch (_e) {
              /* ignore */
            }
          }
        }
      }

      found.push({
        el: el,
        kind: kind,
        meta: meta,
        hidden:
          el.offsetParent === null ||
          el.style.display === 'none' ||
          el.style.visibility === 'hidden' ||
          el.getAttribute('hidden') != null ||
          (el.className && /hidden|sr-only|visually-hidden/i.test(String(el.className)))
      });
    });
    return found;
  }

  /**
   * Find Attach / Upload buttons near Resume / Cover labels.
   */
  function findAttachButtons() {
    const buttons = [];
    const candidates = queryAllDeep(
      [
        'button',
        'a',
        '[role="button"]',
        'label',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        'div[class*="attach" i]',
        'span[class*="attach" i]',
        'div[class*="upload" i]',
        'span[class*="upload" i]',
        'div[class*="file" i]',
        'span[class*="file" i]',
        'div[class*="browse" i]',
        'span[class*="browse" i]'
      ].join(', ')
    );
    // Also short text nodes that say Choose File / Upload CV (Ignite, WordPress forms).
    queryAllDeep('span, div, p, strong, em').forEach(function (el) {
      if (candidates.indexOf(el) !== -1) return;
      const raw = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length > 48) return;
      if (
        /^(choose\s*(a\s*)?file|upload\s*(a\s*)?(cv|resume|file)|browse\s*files?|select\s*(a\s*)?file)$/i.test(
          raw
        )
      ) {
        candidates.push(el);
      }
    });
    candidates.forEach(function (el) {
      const valueText =
        el && el.tagName === 'INPUT' ? String(el.value || el.getAttribute('value') || '') : '';
      const text = (
        (el.textContent || '') +
        ' ' +
        (el.getAttribute('aria-label') || '') +
        ' ' +
        (el.getAttribute('title') || '') +
        ' ' +
        valueText
      )
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!text || text.length > 120) return;
      const isAttach =
        /\battach\b|\bupload\b|\bchoose\s*(a\s*)?file\b|\bbrowse\b|\bselect\s*(a\s*)?file\b|\bupload\s*(cv|resume)\b/.test(
          text
        ) || (/resume|cv|cover/.test(text) && /attach|upload|file|browse|choose/.test(text));
      if (!isAttach) return;
      // Skip final submit / navigation buttons that are not file CTAs.
      if (
        /\bsubmit\b|\bapply\b|\bnext\b|\bcontinue\b/.test(text) &&
        !/attach|upload|file|browse|choose|cv|resume/.test(text)
      ) {
        return;
      }
      const meta = nearbyText(el) + ' ' + text;
      const kind = classifyKind(meta, []);
      buttons.push({ el: el, kind: kind, text: text, meta: meta });
    });
    return buttons;
  }

  /**
   * The file input an Attach button belongs to: its own child, the control a
   * label points at, or a hidden input nearby.
   */
  function findInputNear(el) {
    if (!el) return null;
    let input = el.querySelector && el.querySelector('input[type="file"]');
    if (input) return input;
    if (el.control && String(el.control.type || '').toLowerCase() === 'file') return el.control;
    const forId = el.getAttribute && el.getAttribute('for');
    if (forId) {
      const target = queryAllDeep('#' + escapeId(forId))[0];
      if (target && String(target.type || '').toLowerCase() === 'file') return target;
    }
    const parent = (el.closest && el.closest('label, div, section, li, fieldset, form')) || el.parentElement;
    if (parent) {
      input = parent.querySelector('input[type="file"]');
      if (input) return input;
    }
    // Greenhouse often puts the hidden input in an ancestor container.
    let sib = el.parentElement;
    for (let i = 0; i < 4 && sib; i++) {
      input = sib.querySelector('input[type="file"]');
      if (input) return input;
      sib = sib.parentElement;
    }
    return null;
  }

  /**
   * Clicking a <label> bound to a file input opens the native dialog through
   * the label's activation behaviour, which no amount of patching intercepts.
   * Such labels are only ever used to locate their input, never clicked.
   */
  function opensNativeDialog(el) {
    if (!el) return false;
    if (el.tagName === 'LABEL') return !!findInputNear(el);
    return String(el.type || '').toLowerCase() === 'file';
  }

  /** Drag-and-drop targets (Ashby, Lever, Workday, Workable) with no usable input. */
  function findDropzones() {
    const zones = [];
    const seen = new Set();
    const bySelector = queryAllDeep(
      '[class*="dropzone" i], [class*="drop-zone" i], [class*="filedrop" i], [data-testid*="drop" i]'
    );
    const byText = queryAllDeep('div, section, label, p').filter(function (el) {
      const text = String(el.textContent || '');
      if (text.length > 200) return false;
      return /drag\s*(and|&)?\s*drop|drop your (cv|resume|file)|drop file/i.test(text);
    });
    bySelector.concat(byText).forEach(function (el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      zones.push(el);
    });
    return zones;
  }

  /**
   * Hand a file to a dropzone the way a drag would. Used only when no file
   * input can be found, since a real input is always the more reliable route.
   */
  function dropFileOnZone(zone, file) {
    if (!zone || !file) return { ok: false, error: 'No dropzone or file' };
    const dt = fileTransfer([file]) || {
      files: fileListLike([file]),
      items: fileListLike([file]),
      types: ['Files']
    };
    const dispatched = ['dragenter', 'dragover', 'drop'].map(function (type) {
      let event = null;
      try {
        event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      } catch (_e) {
        try {
          event = new Event(type, { bubbles: true, cancelable: true });
          event.dataTransfer = dt;
        } catch (_e2) {
          return false;
        }
      }
      if (!event.dataTransfer) {
        try {
          Object.defineProperty(event, 'dataTransfer', { value: dt, configurable: true });
        } catch (_e3) {
          /* ignore */
        }
      }
      try {
        zone.dispatchEvent(event);
        return true;
      } catch (_e4) {
        return false;
      }
    });
    return { ok: dispatched[2] === true };
  }

  function makeFile(doc, fallbackName) {
    if (!doc || !doc.base64) return null;
    return fileFromBase64(doc.base64, doc.name || fallbackName, doc.mime);
  }

  /**
   * Attach the documents already loaded in the extension to this page's upload
   * controls, so reaching the resume step never sends the applicant back to
   * their file system.
   *
   * Order of preference: assign straight onto a file input (including hidden
   * ones), then use an Attach button purely to find out which input the site
   * wants — with the native dialog disabled — and only fall back to a
   * synthesized drop when the page offers no input at all.
   */
  function attachDocuments(documents, hints) {
    documents = documents || {};
    const hintsList = Array.isArray(hints) ? hints : [];
    const resumeFile = makeFile(documents.resume, 'resume.pdf');
    const coverFile = makeFile(documents.cover, 'cover-letter.pdf');

    const attached = [];
    const alreadyAttached = [];
    const rejected = [];
    const errors = [];
    let resumeAttached = false;
    let coverAttached = false;
    let inputCount = 0;
    let suppressedPickers = 0;

    if (!resumeFile && !coverFile) {
      return {
        ok: true,
        noDocuments: true,
        attached: [],
        alreadyAttached: [],
        rejected: [],
        errors: [],
        inputCount: 0,
        resumeAttached: false,
        coverAttached: false,
        needsManual: false,
        message: 'No documents stored in the extension'
      };
    }

    function markDone(kind) {
      if (kind === 'resume') resumeAttached = true;
      if (kind === 'cover') coverAttached = true;
    }

    function tryAssign(input, file, kind) {
      if (!input || !file) return false;
      if (attached.some(function (a) { return a.el === input; })) return false;

      const existing = existingAttachment(input);
      if (existing) {
        alreadyAttached.push({ kind: kind, name: existing.name, source: existing.source });
        markDone(kind);
        return true;
      }
      if (!acceptsFile(input, file)) {
        rejected.push({
          kind: kind,
          name: file.name,
          accept: (input.getAttribute && input.getAttribute('accept')) || ''
        });
        return false;
      }

      const result = assignFilesToInput(input, file);
      if (result.ok && result.hasFiles !== false) {
        attached.push({ kind: kind, name: file.name, el: input });
        markDone(kind);
        return true;
      }
      errors.push((result && result.error) || 'attach failed for ' + kind);
      return false;
    }

    function fileFor(kind) {
      if (kind === 'resume') return resumeFile && !resumeAttached ? resumeFile : null;
      if (kind === 'cover') return coverFile && !coverAttached ? coverFile : null;
      return null;
    }

    withPickerSuppressed(function (picker) {
      // 1) Inputs we can identify, hidden ones included.
      const inputs = findFileInputs(hintsList);
      inputCount = inputs.length;
      inputs.forEach(function (item) {
        let kind = item.kind;
        let file = fileFor(kind);
        if (!file && kind === 'unknown') {
          file = fileFor('resume');
          if (file) kind = 'resume';
        }
        if (file) tryAssign(item.el, file, kind);
      });

      // 2) Attach buttons, used only to locate the input behind them.
      if (fileFor('resume') || fileFor('cover')) {
        findAttachButtons().forEach(function (btn) {
          let kind = btn.kind;
          let file = fileFor(kind);
          if (!file && kind === 'unknown') {
            if (fileFor('resume')) {
              file = fileFor('resume');
              kind = 'resume';
            } else if (fileFor('cover')) {
              file = fileFor('cover');
              kind = 'cover';
            }
          }
          if (!file) return;

          let input = findInputNear(btn.el);
          if (!input && !opensNativeDialog(btn.el)) {
            const D = dom();
            if (D && D.realClick) D.realClick(btn.el);
            else {
              try {
                btn.el.click();
              } catch (_e) {
                /* ignore */
              }
            }
            // The handler's own input.click() was intercepted; that call named
            // the input the site intended to use.
            input = picker.clicked[picker.clicked.length - 1] || findInputNear(btn.el);
            if (!input) {
              const after = findFileInputs(hintsList);
              for (let i = 0; i < after.length; i++) {
                const candidate = after[i];
                const matchesKind = candidate.kind === kind || candidate.kind === 'unknown';
                const taken = attached.some(function (a) { return a.el === candidate.el; });
                if (matchesKind && !taken) {
                  input = candidate.el;
                  break;
                }
              }
            }
          }
          if (input) tryAssign(input, file, kind);
        });
      }

      // 3) Best-effort only for still-unknown inputs.
      // Never put a resume on a cover-letter control (or vice versa).
      ['resume', 'cover'].forEach(function (kind) {
        const file = fileFor(kind);
        if (!file) return;
        const leftover = findFileInputs(hintsList);
        for (let i = 0; i < leftover.length; i++) {
          const lk = leftover[i].kind;
          if (lk === 'resume' && kind !== 'resume') continue;
          if (lk === 'cover' && kind !== 'cover') continue;
          // Known opposite already skipped; prefer unknown for best-effort.
          if (lk !== 'unknown' && lk !== kind) continue;
          if (tryAssign(leftover[i].el, file, kind)) break;
        }
      });

      // 4) No input anywhere — treat the page's dropzone as the drop target.
      if (fileFor('resume') || fileFor('cover')) {
        const zones = findDropzones();
        for (let z = 0; z < zones.length; z++) {
          const kind = fileFor('resume') ? 'resume' : 'cover';
          const file = fileFor(kind);
          if (!file) break;
          if (dropFileOnZone(zones[z], file).ok) {
            const revealed = picker.clicked[picker.clicked.length - 1];
            if (revealed && tryAssign(revealed, file, kind)) continue;
            attached.push({ kind: kind, name: file.name, el: zones[z], via: 'dropzone' });
            markDone(kind);
          }
        }
      }

      suppressedPickers = picker.suppressed;
    });

    const pending = [];
    if (resumeFile && !resumeAttached) pending.push('resume');
    if (coverFile && !coverAttached) pending.push('cover');

    const messages = rejected.map(function (r) {
      return (
        r.kind +
        ': stored file ' +
        r.name +
        ' is not one of the types this form accepts (' +
        r.accept +
        ') — upload manually'
      );
    });

    return {
      ok: errors.length === 0 && !rejected.length,
      attached: attached.map(function (a) {
        return { kind: a.kind, name: a.name, via: a.via || 'input' };
      }),
      alreadyAttached: alreadyAttached,
      rejected: rejected,
      errors: errors.concat(messages),
      inputCount: inputCount,
      pending: pending,
      suppressedPickers: suppressedPickers,
      needsManual: rejected.length > 0,
      resumeAttached: resumeAttached,
      coverAttached: coverAttached
    };
  }

  /**
   * Same as attachDocuments, but waits for an upload control to appear first.
   *
   * Multi-step applications only render the resume step once earlier steps are
   * done, and React reveals hidden inputs a tick after the Attach button is
   * clicked, so a single synchronous pass can arrive before the control exists.
   */
  async function attachDocumentsAsync(documents, hints, opts) {
    opts = opts || {};
    const D = dom();
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 1500;

    if (D && D.waitFor && timeoutMs > 0) {
      await D.waitFor(
        function () {
          if (queryAllDeep('input[type="file"]').length) return true;
          return findAttachButtons().length ? true : null;
        },
        { timeoutMs: timeoutMs, pollMs: 100 }
      );
    }

    let result = attachDocuments(documents, hints);
    if (result.noDocuments || !result.pending || !result.pending.length) return result;

    // An Attach button may have revealed its input on the following tick.
    if (D && D.waitFor) {
      await D.waitFor(
        function () {
          return queryAllDeep('input[type="file"]:not([' + ATTACHED_ATTR + '])').length ? true : null;
        },
        { timeoutMs: 800, pollMs: 100 }
      );
      const second = attachDocuments(documents, hints);
      if (second.attached.length || second.alreadyAttached.length) {
        result = mergeAttachResults(result, second);
      }
    }
    return result;
  }

  function mergeAttachResults(first, second) {
    return {
      ok: first.ok && second.ok,
      attached: first.attached.concat(second.attached),
      alreadyAttached: first.alreadyAttached.concat(second.alreadyAttached),
      rejected: first.rejected.concat(second.rejected),
      errors: first.errors.concat(second.errors),
      inputCount: Math.max(first.inputCount, second.inputCount),
      pending: second.pending,
      suppressedPickers: (first.suppressedPickers || 0) + (second.suppressedPickers || 0),
      needsManual: first.needsManual || second.needsManual,
      resumeAttached: first.resumeAttached || second.resumeAttached,
      coverAttached: first.coverAttached || second.coverAttached
    };
  }


  /**
   * Best-effort: if no local resume/cover blob but an https Drive/direct link is set
   * (documents.resumeLink/coverLink or profile.resumeUrl/coverUrl), fetch → File.
   * CORS/auth failures return needsManual with an honest message — never invent files.
   */
  async function fetchLinkAsDoc(url, fallbackName) {
    const href = String(url || '').trim();
    if (!/^https?:\/\//i.test(href)) return { ok: false, skipped: true };
    try {
      const res = await fetch(href, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) {
        return {
          ok: false,
          needsManual: true,
          error: 'Open Drive link or upload file manually (HTTP ' + res.status + ')'
        };
      }
      const blob = await res.blob();
      if (!blob || !blob.size) {
        return {
          ok: false,
          needsManual: true,
          error: 'Open Drive link or upload file manually (empty response)'
        };
      }
      const mime = blob.type || 'application/octet-stream';
      let name = fallbackName;
      try {
        const u = new URL(href);
        const last = (u.pathname.split('/').filter(Boolean).pop() || '').split('?')[0];
        if (last && /\.[a-z0-9]{2,5}$/i.test(last)) name = decodeURIComponent(last);
      } catch (_e) {}
      const base64 = await blobToBase64(blob);
      return { ok: true, doc: { name: name, mime: mime, base64: base64 } };
    } catch (e) {
      return {
        ok: false,
        needsManual: true,
        error: 'Open Drive link or upload file manually (CORS/auth blocked)'
      };
    }
  }

  async function resolveDocumentLinks(documents, profile) {
    documents = Object.assign({ resume: null, cover: null, resumeLink: '', coverLink: '' }, documents || {});
    profile = profile || {};
    const out = Object.assign({}, documents);
    const errors = [];
    let needsManual = false;

    async function ensure(kind) {
      const existing = out[kind];
      if (existing && existing.base64) return;
      const link =
        (kind === 'resume'
          ? out.resumeLink || profile.resumeUrl
          : out.coverLink || profile.coverUrl) || '';
      if (!String(link).trim()) return;
      const fetched = await fetchLinkAsDoc(
        link,
        kind === 'resume' ? 'resume.pdf' : 'cover-letter.pdf'
      );
      if (fetched.ok && fetched.doc) {
        out[kind] = fetched.doc;
      } else if (fetched.needsManual) {
        needsManual = true;
        errors.push(kind + ': ' + (fetched.error || 'Open Drive link or upload file manually'));
      }
    }

    await ensure('resume');
    await ensure('cover');
    return { documents: out, needsManual: needsManual, errors: errors };
  }

  global.FillApplyFiles = {
    ATTACHED_ATTR,
    base64ToUint8Array,
    arrayBufferToBase64,
    blobToBase64,
    fileFromBase64,
    fileFromArrayBuffer,
    mimeForName,
    assignFilesToInput,
    acceptsFile,
    existingAttachment,
    withPickerSuppressed,
    findFileInputs,
    findAttachButtons,
    findInputNear,
    findDropzones,
    dropFileOnZone,
    attachDocuments,
    attachDocumentsAsync,
    resolveDocumentLinks,
    fetchLinkAsDoc
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
