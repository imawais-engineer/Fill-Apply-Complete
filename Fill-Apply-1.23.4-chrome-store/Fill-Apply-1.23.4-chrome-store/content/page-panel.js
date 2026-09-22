/**
 * On-page floating control panel — Auto Register / Auto Fill / Auto Navigate / Auto Ready / Auto Submit.
 *
 * Injected as a top-frame content script on http(s) job/application pages.
 * Isolated via Shadow DOM + `all: initial` on the host so page CSS cannot
 * restyle the panel and panel CSS cannot leak into the host.
 *
 * Positioning: compact fixed box, never a full-page overlay. Candidate
 * slots are the four corners plus mid-left / mid-right. The slot with the
 * least overlap against job titles, Apply/Start/Submit CTAs, and form
 * fields wins (ties prefer bottom-right). pointer-events stay on the
 * panel only, so scrolling and page clicks are unaffected.
 *
 * Buttons message the service worker (FILL_APPLY_FILL_ONCE) which runs
 * injectAndFill on sender.tab.id — the page this panel is sitting on.
 *
 * Attaches globalThis.FillApplyPagePanel (layout + mount helpers for tests).
 */
(function (global) {
  'use strict';

  function isContextDeadError(msg) {
    msg = String(msg || '');
    return /Extension context invalidated|Receiving end does not exist|Could not establish connection|message port closed/i.test(msg);
  }


  var HOST_ID = 'fill-apply-page-panel-host';
  var ATTR = 'data-fill-apply-page-panel';
  var PANEL_WIDTH = 216;
  var PANEL_HEIGHT = 248;
  var COLLAPSED_WIDTH = 156;
  var COLLAPSED_HEIGHT = 36;
  var MARGIN = 16;

  var KNOWN_HOST_RE =
    /linkedin\.com|indeed\.com|greenhouse\.io|ashbyhq\.com|lever\.co|workable\.com|myworkdayjobs\.com|workdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|teamtailor\.com|naukrigulf\.com|glassdoor\.com|efinancialcareers\.com|wellfound\.com|angel\.co|remoteok\.(com|io)|weworkremotely\.com|workingnomads\.com|jooble\.org|swooped\.co|bayt\.com|gulftalent\.com|flexjobs\.com|remote\.co|remotive\.(com|io)|himalayas\.app|otta\.com|jobgether\.com|ycombinator\.com|workatastartup\.com|builtin\.com|upwork\.com|freehire\.com|catsone\.com|recruitee\.com|michaelpage\.|hays\.com|roberthalf\.com|cooperfitch\.com|charterhouse\.|robertwalters\.com|jivaropartners\.com|lhh\.com|zahid-jobpool\.vercel\.app|jobpool/i;

  var JOB_PATH_RE =
    /\/jobs?(\/|$)|\/careers?(\/|$)|\/apply(\/|$)|\/applications?(?:\/|$)|\/application|\/vacanc|\/opening|\/positions?(\/|$)|\/easy-apply|\/job-listing|\/jobid|\/viewjob|\/posting/i;

  var CTA_TEXT_RE =
    /\b(apply(\s+now)?|easy\s+apply|start\s+(your\s+)?application|start\s+apply|submit(\s+application)?|finish\s+application)\b/i;

  var STATUS = {
    idle: 'idle',
    running: 'running',
    paused: 'paused',
    done: 'done',
    error: 'error',
    // Reliability + universal workflow phases
    DETECTING: 'DETECTING',
    FILLING: 'FILLING',
    REGISTERING: 'REGISTERING',
    NAVIGATING: 'NAVIGATING',
    WAITING_FOR_DEPENDENT_FIELDS: 'WAITING_FOR_DEPENDENT_FIELDS',
    VALIDATING: 'VALIDATING',
    MISSING_INFORMATION: 'MISSING_INFORMATION',
    BLOCKED: 'BLOCKED',
    READY: 'READY',
    SUBMITTING: 'SUBMITTING',
    COMPLETE: 'COMPLETE',
    WAITING_FOR_USER: 'WAITING_FOR_USER',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AMBIGUOUS: 'AMBIGUOUS',
    TIMEOUT: 'TIMEOUT'
  };

  var SLOTS = [
    { id: 'bottom-right', v: 'bottom', h: 'right' },
    { id: 'bottom-left', v: 'bottom', h: 'left' },
    { id: 'top-right', v: 'top', h: 'right' },
    { id: 'top-left', v: 'top', h: 'left' },
    { id: 'mid-right', v: 'mid', h: 'right' },
    { id: 'mid-left', v: 'mid', h: 'left' }
  ];

  var collapsed = false;
  var currentState = STATUS.idle;
  var busy = false;
  var lastHref = '';
  var repositionTimer = null;
  var spaTimer = null;
  var hostEl = null;
  var shadowRoot = null;
  var statusEl = null;
  var buttons = {};

  function normalizeRunMode(mode) {
    var m = String(mode || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (m === 'register' || m === 'autoregister' || m === 'signup') return 'register';
    if (m === 'navigate' || m === 'autonavigate' || m === 'nav') return 'navigate';
    if (m === 'ready' || m === 'autoready') return 'ready';
    if (m === 'submit' || m === 'autosubmit') return 'submit';
    if (m === 'fill' || m === 'autofill') return 'fill';
    return 'fill';
  }

  function isRestrictedUrl(url) {
    if (!url) return true;
    if (/^chrome-extension:\/\//i.test(url)) return true;
    return /^(chrome|edge|about|devtools|view-source|moz-extension|safari-web-extension):/i.test(url);
  }

  function parseUrl(url) {
    try {
      return new URL(String(url || ''), typeof location !== 'undefined' ? location.href : undefined);
    } catch (_e) {
      return null;
    }
  }

  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Show on known ATS/board hosts (with LinkedIn/Indeed path tightening),
   * career-like paths on unknown hosts, or when the DOM already looks like
   * a job posting / open application.
   */
  function isRelevantPage(url, doc) {
    if (isRestrictedUrl(url)) return false;
    var parsed = parseUrl(url);
    if (!parsed) return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
      return false;
    }
    var host = (parsed.hostname || '').replace(/^www\./, '').toLowerCase();
    var path = (parsed.pathname || '') + (parsed.search || '');

    if (/linkedin\.com$/i.test(host)) {
      if (/\/jobs?(\/|$)|\/easy-apply|\/job\//i.test(path)) return true;
      return pageLooksLikeApplication(doc);
    }
    if (/(^|\.)indeed\.com$/i.test(host)) {
      if (/\/viewjob|\/apply|\/jobs?(\/|$)|\/job\//i.test(path)) return true;
      return pageLooksLikeApplication(doc);
    }
    // JobPool hub — always show panel on Applications (SPA may hydrate late).
    if (/zahid-jobpool\.vercel\.app/i.test(host) || /jobpool/i.test(host)) {
      if (/\/applications?/i.test(path) || /intelligent\s+opportunity\s+hub/i.test(path)) return true;
      return true; // JobPool origin is the apply hub for this extension
    }
    if (KNOWN_HOST_RE.test(host) || KNOWN_HOST_RE.test(parsed.href)) return true;
    if (JOB_PATH_RE.test(path)) return true;
    return pageLooksLikeApplication(doc);
  }

  function pageLooksLikeApplication(doc) {
    if (!doc || !doc.querySelector) return false;
    try {
      if (global.FillApplySynonyms) {
        var S = global.FillApplySynonyms;
        if (S.isApplicationFormOpen && S.isApplicationFormOpen(doc)) return true;
        if (S.findApplyStartButtons && S.findApplyStartButtons(doc).length) return true;
        if (S.looksLikeJobPosting && S.looksLikeJobPosting(doc)) return true;
      }
    } catch (_e) {}
    try {
      var email = doc.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
      var name = doc.querySelector(
        'input[name*="first" i], input[name*="name" i], input[autocomplete="given-name"], input[id*="first" i]'
      );
      if (email && name) return true;
      var nodes = doc.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]');
      for (var i = 0; i < nodes.length && i < 80; i++) {
        var t = (
          (nodes[i].textContent || '') +
          ' ' +
          (nodes[i].value || '') +
          ' ' +
          (nodes[i].getAttribute('aria-label') || '')
        ).replace(/\s+/g, ' ');
        if (CTA_TEXT_RE.test(t) && !/upgrade|subscribe|pricing|auto-apply with ai/i.test(t)) return true;
      }
    } catch (_e2) {}
    return false;
  }

  function overlapArea(a, b) {
    if (!a || !b) return 0;
    var x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    var y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  }

  function slotRect(slot, viewport, panel, margin) {
    var vw = viewport.width;
    var vh = viewport.height;
    var pw = panel.width;
    var ph = panel.height;
    var m = margin == null ? MARGIN : margin;
    var left = m;
    if (slot.h === 'right') left = Math.max(m, vw - pw - m);
    var top = m;
    if (slot.v === 'bottom') top = Math.max(m, vh - ph - m);
    else if (slot.v === 'mid') top = Math.max(m, Math.round((vh - ph) / 2));
    return {
      id: slot.id,
      left: left,
      top: top,
      right: left + pw,
      bottom: top + ph,
      width: pw,
      height: ph
    };
  }

  /**
   * Pick the least-overlapping corner/edge. Ties keep SLOTS order
   * (bottom-right first) so the default stays out of typical title/CTA columns.
   */
  function pickAnchor(viewport, panel, keepOuts, margin) {
    viewport = viewport || { width: 1280, height: 800 };
    panel = panel || { width: PANEL_WIDTH, height: PANEL_HEIGHT };
    keepOuts = keepOuts || [];
    var best = null;
    var bestOverlap = Infinity;
    for (var i = 0; i < SLOTS.length; i++) {
      var rect = slotRect(SLOTS[i], viewport, panel, margin);
      var overlap = 0;
      for (var j = 0; j < keepOuts.length; j++) {
        overlap += overlapArea(rect, keepOuts[j]);
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        best = Object.assign({ overlap: overlap }, SLOTS[i], rect);
      }
    }
    return best || Object.assign({}, SLOTS[0], slotRect(SLOTS[0], viewport, panel, margin), { overlap: 0 });
  }

  function elementText(el) {
    if (!el) return '';
    return (
      (el.textContent || '') +
      ' ' +
      (el.value || '') +
      ' ' +
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('title') || '')
    ).replace(/\s+/g, ' ');
  }

  function visibleBox(el, vw, vh) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    try {
      var r = el.getBoundingClientRect();
      if (!r || r.width < 8 || r.height < 8) return null;
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return null;
      var style = el.ownerDocument && el.ownerDocument.defaultView
        ? el.ownerDocument.defaultView.getComputedStyle(el)
        : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return null;
      }
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height
      };
    } catch (_e) {
      return null;
    }
  }

  /**
   * Keep-out rectangles: job titles, Apply/Start/Submit CTAs, form fields.
   * Intentionally not `main`/`article` — those cover the viewport and would
   * make every slot look equally blocked, forcing a useless default.
   */
  function collectKeepOutRects(doc, viewport) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.querySelectorAll) return [];
    var vw = (viewport && viewport.width) || (global.innerWidth || 1280);
    var vh = (viewport && viewport.height) || (global.innerHeight || 800);
    var out = [];
    var seen = [];

    function add(el) {
      if (!el || seen.indexOf(el) !== -1) return;
      if (el.id === HOST_ID || (el.closest && el.closest('#' + HOST_ID))) return;
      var box = visibleBox(el, vw, vh);
      if (!box) return;
      seen.push(el);
      out.push(box);
    }

    var titleSel = 'h1, h2, [role="heading"][aria-level="1"], [class*="job-title" i], [class*="JobTitle"], [data-testid*="job-title" i]';
    try {
      doc.querySelectorAll(titleSel).forEach(add);
    } catch (_t) {}

    try {
      doc.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]').forEach(function (el) {
        if (CTA_TEXT_RE.test(elementText(el))) add(el);
      });
    } catch (_c) {}

    try {
      doc
        .querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]'
        )
        .forEach(function (el) {
          add(el);
        });
    } catch (_f) {}

    return out;
  }

  function applyAnchor(host, anchor) {
    if (!host || !host.style || !anchor) return;
    host.style.top = Math.round(anchor.top) + 'px';
    host.style.left = Math.round(anchor.left) + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.setAttribute('data-anchor', anchor.id || '');
  }

  function panelSize() {
    return collapsed
      ? { width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
      : { width: PANEL_WIDTH, height: PANEL_HEIGHT };
  }

  function reposition(doc) {
    if (!hostEl) return null;
    var vw = global.innerWidth || 1280;
    var vh = global.innerHeight || 800;
    var keepOuts = collectKeepOutRects(doc || document, { width: vw, height: vh });
    var anchor = pickAnchor({ width: vw, height: vh }, panelSize(), keepOuts, MARGIN);
    applyAnchor(hostEl, anchor);
    return anchor;
  }

  function scheduleReposition() {
    if (repositionTimer) clearTimeout(repositionTimer);
    repositionTimer = setTimeout(function () {
      repositionTimer = null;
      try {
        reposition(document);
      } catch (_e) {}
    }, 120);
  }

  function cssText() {
    return [
      ':host{all:initial;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;}',
      '*{box-sizing:border-box;}',
      '.wrap{pointer-events:auto;width:' +
        PANEL_WIDTH +
        'px;color:#e2e8f0;background:#0f172af2;border:1px solid #334155;border-radius:10px;box-shadow:0 8px 24px #0f172a55;backdrop-filter:blur(8px);padding:8px;user-select:none;}',
      '.wrap.collapsed{width:' + COLLAPSED_WIDTH + 'px;padding:4px 6px;}',
      '.bar{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
      '.wrap.collapsed .bar{margin:0;}',
      '.brand{font-size:11px;font-weight:700;letter-spacing:.02em;color:#93c5fd;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.toggle{all:unset;cursor:pointer;color:#94a3b8;font-size:12px;padding:2px 6px;border-radius:6px;}',
      '.toggle:hover{background:#1e293b;color:#e2e8f0;}',
      '.btns{display:flex;flex-direction:column;gap:4px;}',
      '.wrap.collapsed .btns,.wrap.collapsed .status{display:none;}',
      'button.act{all:unset;display:block;width:100%;text-align:center;font-size:12px;font-weight:650;line-height:1.2;padding:7px 8px;border-radius:7px;cursor:pointer;border:1px solid #1f2937;}',
      'button.act:hover:not(:disabled){filter:brightness(1.08);}',
      'button.act:disabled{opacity:.55;cursor:default;}',
      'button[data-mode="register"]{background:#6d28d9;color:#fff;}',
      'button[data-mode="fill"]{background:#1d4ed8;color:#fff;}',
      'button[data-mode="navigate"]{background:#0369a1;color:#fff;}',
      'button[data-mode="ready"]{background:#0f766e;color:#fff;}',
      'button[data-mode="submit"]{background:#b45309;color:#fff;}',
      '.status{margin-top:6px;font-size:11px;line-height:1.3;color:#94a3b8;min-height:2.6em;}',
      '.status.running{color:#93c5fd;}',
      '.status.paused{color:#fbbf24;}',
      '.status.done{color:#4ade80;}',
      '.status.error{color:#f87171;}'
    ].join('');
  }

  function setCollapsed(on) {
    collapsed = !!on;
    if (shadowRoot) {
      var wrap = shadowRoot.querySelector('.wrap');
      if (wrap) wrap.classList.toggle('collapsed', collapsed);
      var tog = shadowRoot.querySelector('.toggle');
      if (tog) {
        tog.textContent = collapsed ? '▸' : '▾';
        tog.setAttribute('aria-label', collapsed ? 'Expand Fill & Apply' : 'Collapse Fill & Apply');
      }
    }
    try {
      if (global.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ 'fillApply.pagePanel.collapsed': collapsed });
      }
    } catch (_e) {}
    scheduleReposition();
  }

  function setBusy(on) {
    busy = !!on;
    Object.keys(buttons).forEach(function (k) {
      if (buttons[k]) buttons[k].disabled = busy;
    });
  }

  function setStatus(state, message) {
    currentState = STATUS[state] ? state : currentState;
    if (statusEl) {
      statusEl.textContent = message || labelFor(currentState);
      statusEl.className = 'status ' + currentState;
    }
    if (
      state === STATUS.running ||
      state === STATUS.DETECTING ||
      state === STATUS.FILLING ||
      state === STATUS.REGISTERING ||
      state === STATUS.NAVIGATING ||
      state === STATUS.WAITING_FOR_DEPENDENT_FIELDS ||
      state === STATUS.VALIDATING ||
      state === STATUS.SUBMITTING
    ) {
      setBusy(true);
    }
    if (
      state === STATUS.idle ||
      state === STATUS.done ||
      state === STATUS.error ||
      state === STATUS.paused ||
      state === STATUS.READY ||
      state === STATUS.COMPLETE ||
      state === STATUS.BLOCKED ||
      state === STATUS.MISSING_INFORMATION ||
      state === STATUS.WAITING_FOR_USER ||
      state === STATUS.AUTH_REQUIRED ||
      state === STATUS.AMBIGUOUS ||
      state === STATUS.TIMEOUT
    ) {
      setBusy(false);
    }
  }

  function labelFor(state) {
    if (state === STATUS.running) return 'Running…';
    if (state === STATUS.paused) return 'Paused — action needed';
    if (state === STATUS.done) return 'Done';
    if (state === STATUS.error) return 'Error';
    if (state === STATUS.DETECTING) return 'Detecting…';
    if (state === STATUS.REGISTERING) return 'Auto Register — Signing up…';
    if (state === STATUS.FILLING) return 'Auto Fill — Filling…';
    if (state === STATUS.NAVIGATING) return 'Auto Navigate — Next step…';
    if (state === STATUS.WAITING_FOR_DEPENDENT_FIELDS) return 'Waiting for dependent fields…';
    if (state === STATUS.VALIDATING) return 'Validating…';
    if (state === STATUS.MISSING_INFORMATION) return 'Missing information';
    if (state === STATUS.BLOCKED) return 'Blocked';
    if (state === STATUS.READY) return 'Ready';
    if (state === STATUS.SUBMITTING) return 'Auto Submit — Submitting…';
    if (state === STATUS.COMPLETE) return 'Complete';
    if (state === STATUS.WAITING_FOR_USER) return 'Waiting for user…';
    if (state === STATUS.AUTH_REQUIRED) return 'Sign in required';
    if (state === STATUS.AMBIGUOUS) return 'Ambiguous — choose manually';
    if (state === STATUS.TIMEOUT) return 'Timed out — no progress';
    return 'Idle — current tab';
  }

  function sendRun(runMode) {
    var mode = normalizeRunMode(runMode);
    var startLabel = {
      register: 'Auto Register — Starting…',
      fill: 'Auto Fill — Filling…',
      navigate: 'Auto Navigate — Starting…',
      ready: 'Auto Ready — Starting…',
      submit: 'Auto Submit — Starting…'
    };
    setStatus(STATUS.running, startLabel[mode] || ('Starting ' + mode + '…'));
    if (!global.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      setStatus(STATUS.error, 'Extension background unavailable');
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'FILL_APPLY_FILL_ONCE', runMode: mode }, function (res) {
        if (chrome.runtime.lastError) {
          var errMsg = chrome.runtime.lastError.message || 'Message failed';
          if (isContextDeadError(errMsg)) {
            setStatus(
              STATUS.error,
              'Extension was reloaded — refresh this tab, then try again (Load unpacked / Update).'
            );
            return;
          }
          setStatus(STATUS.error, errMsg);
          return;
        }
        if (!res || res.ok === false) {
          var err = (res && res.error) || 'Request failed';
          if (/captcha|cloudflare/i.test(err)) {
            setStatus(STATUS.BLOCKED, 'Blocked — CAPTCHA…');
          } else if (/auth|sign in|log in|register/i.test(err)) {
            setStatus(STATUS.AUTH_REQUIRED, err);
          } else if (/paused|missing profile|action needed|waiting for user/i.test(err)) {
            setStatus(STATUS.WAITING_FOR_USER, err);
          } else if (/timeout|no progress|plateau/i.test(err)) {
            setStatus(STATUS.TIMEOUT, err);
          } else if (/ambiguous/i.test(err)) {
            setStatus(STATUS.AMBIGUOUS, err);
          } else {
            setStatus(STATUS.error, err);
          }
          return;
        }
        applyResult(res.data || res);
      });
    } catch (e) {
      setStatus(STATUS.error, String((e && e.message) || e));
    }
  }

  function applyResult(data) {
    if (!data) {
      setStatus(STATUS.done, 'Done');
      return;
    }
    if (data.state && STATUS[data.state]) {
      setStatus(data.state, data.message || data.error || labelFor(data.state));
      return;
    }
    var result = data.result || data;
    if (result.needsHuman || data.pausedForHuman) {
      setStatus(STATUS.paused, result.error || data.message || 'Paused — action needed');
      return;
    }
    if (result.ok === false) {
      setStatus(STATUS.error, result.error || data.error || 'Fill failed');
      return;
    }
    var bits = [];
    if (result.filled != null) bits.push('filled ' + result.filled + '/' + (result.total != null ? result.total : '?'));
    if (result.advanced) bits.push('ready');
    if (result.submitted) bits.push('submitted');
    if (result.adapterId) bits.push(result.adapterId);
    setStatus(STATUS.done, bits.length ? bits.join(' · ') : 'Done');
  }

  function mount(doc) {
    doc = doc || document;
    if (!doc || !doc.documentElement) return null;
    var existing = doc.getElementById(HOST_ID);
    if (existing) {
      hostEl = existing;
      shadowRoot = existing.shadowRoot;
      if (shadowRoot) {
        statusEl = shadowRoot.querySelector('.status');
        buttons.register = shadowRoot.querySelector('[data-mode="register"]');
        buttons.fill = shadowRoot.querySelector('[data-mode="fill"]');
        buttons.navigate = shadowRoot.querySelector('[data-mode="navigate"]');
        buttons.ready = shadowRoot.querySelector('[data-mode="ready"]');
        buttons.submit = shadowRoot.querySelector('[data-mode="submit"]');
      }
      existing.hidden = false;
      scheduleReposition();
      return existing;
    }

    var host = doc.createElement('div');
    host.id = HOST_ID;
    host.setAttribute(ATTR, '1');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Fill & Apply');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'z-index: 2147483646',
      'top: auto',
      'left: auto',
      'right: ' + MARGIN + 'px',
      'bottom: ' + MARGIN + 'px',
      'width: auto',
      'height: auto',
      'pointer-events: none',
      'margin: 0',
      'padding: 0',
      'border: 0',
      'display: block'
    ].join(';');

    var shadow = host.attachShadow({ mode: 'open' });
    var style = doc.createElement('style');
    style.textContent = cssText();
    shadow.appendChild(style);

    var wrap = doc.createElement('div');
    wrap.className = 'wrap' + (collapsed ? ' collapsed' : '');

    var bar = doc.createElement('div');
    bar.className = 'bar';
    var brand = doc.createElement('div');
    brand.className = 'brand';
    brand.textContent = 'Fill & Apply';
    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-label', collapsed ? 'Expand Fill & Apply' : 'Collapse Fill & Apply');
    toggle.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setCollapsed(!collapsed);
    });
    bar.appendChild(brand);
    bar.appendChild(toggle);
    wrap.appendChild(bar);

    var btns = doc.createElement('div');
    btns.className = 'btns';
    [
      { mode: 'register', label: 'Auto Register' },
      { mode: 'fill', label: 'Auto Fill' },
      { mode: 'navigate', label: 'Auto Navigate' },
      { mode: 'ready', label: 'Auto Ready' },
      { mode: 'submit', label: 'Auto Submit' }
    ].forEach(function (def) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'act';
      b.setAttribute('data-mode', def.mode);
      b.textContent = def.label;
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (busy) return;
        sendRun(def.mode);
      });
      buttons[def.mode] = b;
      btns.appendChild(b);
    });
    wrap.appendChild(btns);

    var st = doc.createElement('div');
    st.className = 'status idle';
    st.textContent = 'Idle — current tab';
    wrap.appendChild(st);
    shadow.appendChild(wrap);

    (doc.documentElement || doc.body).appendChild(host);

    hostEl = host;
    shadowRoot = shadow;
    statusEl = st;
    scheduleReposition();
    return host;
  }

  function unmount(doc) {
    doc = doc || document;
    var el = (doc && doc.getElementById(HOST_ID)) || hostEl;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    hostEl = null;
    shadowRoot = null;
    statusEl = null;
    buttons = {};
  }

  function hide() {
    if (hostEl) hostEl.hidden = true;
  }

  function maybeShow() {
    if (!isTopFrame()) return;
    var url = typeof location !== 'undefined' ? location.href : '';
    if (!isRelevantPage(url, typeof document !== 'undefined' ? document : null)) {
      hide();
      return;
    }
    mount(document);
    if (hostEl) hostEl.hidden = false;
    scheduleReposition();
  }

  function watchSpa() {
    lastHref = typeof location !== 'undefined' ? location.href : '';
    function check() {
      var href = typeof location !== 'undefined' ? location.href : '';
      if (href !== lastHref) {
        lastHref = href;
        maybeShow();
      }
    }
    try {
      window.addEventListener('popstate', check);
      window.addEventListener('hashchange', check);
      window.addEventListener('resize', scheduleReposition);
      window.addEventListener('scroll', scheduleReposition, { passive: true });
    } catch (_e) {}
    if (spaTimer) clearInterval(spaTimer);
    // Keep-alive interval only in a real extension tab — jsdom tests must exit.
    if (global.chrome && chrome.runtime && typeof setInterval === 'function') {
      spaTimer = setInterval(check, 1500);
    }
    try {
      var mo = new MutationObserver(function () {
        scheduleReposition();
      });
      if (document.documentElement) {
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (_m) {}
  }

  function listenRuntime() {
    try {
      if (!global.chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
      chrome.runtime.onMessage.addListener(function (message) {
        if (!message || !message.type) return;
        if (message.type === 'FILL_APPLY_PAGE_PANEL_STATUS' || message.type === 'FILL_APPLY_FILL_ONCE_STATUS') {
          var msg = message.message || message.error || '';
          if (message.phase && String(msg).indexOf(message.phase) === -1) {
            msg = message.phase + (msg ? ' — ' + msg : '');
          }
          // Prefer explicit phase as visual state when it is a known STATUS key
          var st = message.state || currentState;
          if (message.phase && STATUS[message.phase]) st = message.phase;
          setStatus(st, msg);
          if (message.result) applyResult(message);
        }
      });
    } catch (_e) {}
    try {
      if (global.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['fillApply.pagePanel.collapsed'], function (res) {
          if (res && res['fillApply.pagePanel.collapsed']) setCollapsed(true);
        });
      }
    } catch (_s) {}
  }

  function boot() {
    if (typeof document === 'undefined') return;
    if (!isTopFrame()) return;
    if (isRestrictedUrl(typeof location !== 'undefined' ? location.href : '')) return;
    listenRuntime();
    maybeShow();
    watchSpa();
  }

  var api = {
    HOST_ID: HOST_ID,
    ATTR: ATTR,
    PANEL_WIDTH: PANEL_WIDTH,
    PANEL_HEIGHT: PANEL_HEIGHT,
    COLLAPSED_WIDTH: COLLAPSED_WIDTH,
    COLLAPSED_HEIGHT: COLLAPSED_HEIGHT,
    KNOWN_HOST_RE: KNOWN_HOST_RE,
    JOB_PATH_RE: JOB_PATH_RE,
    STATUS: STATUS,
    SLOTS: SLOTS,
    isRestrictedUrl: isRestrictedUrl,
    isRelevantPage: isRelevantPage,
    pageLooksLikeApplication: pageLooksLikeApplication,
    normalizeRunMode: normalizeRunMode,
    overlapArea: overlapArea,
    slotRect: slotRect,
    pickAnchor: pickAnchor,
    collectKeepOutRects: collectKeepOutRects,
    applyAnchor: applyAnchor,
    mount: mount,
    unmount: unmount,
    hide: hide,
    maybeShow: maybeShow,
    setStatus: setStatus,
    setCollapsed: setCollapsed,
    reposition: reposition,
    boot: boot
  };

  global.FillApplyPagePanel = api;

  if (typeof document !== 'undefined' && global.document && !global.__FILL_APPLY_PAGE_PANEL_NOBOOT) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
