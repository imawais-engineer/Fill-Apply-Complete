/**
 * Persist ATS account auth state (no passwords, tokens, cookies, or secrets).
 * Uses chrome.storage.local via FillApplyStorage patterns.
 *
 * Record shape:
 *   {
 *     host,           // e.g. boards.greenhouse.io
 *     email,          // profile email used (optional)
 *     status,         // authenticated | account_created | already_exists | needs_user | unknown
 *     lastResult,     // AUTH_* code
 *     lastDetail,     // short message
 *     googleUsed,     // bool
 *     updatedAt       // ms
 *   }
 *
 * Attaches FillApplyAtsAuthStore to globalThis (service worker).
 */
(function (global) {
  'use strict';

  var KEY =
    (global.FillApplyTypes &&
      global.FillApplyTypes.STORAGE_KEYS &&
      global.FillApplyTypes.STORAGE_KEYS.atsAccounts) ||
    'fillApply.atsAccounts';

  var MAX_RECORDS = 200;

  function storageGet(keys) {
    if (global.FillApplyStorage && global.FillApplyStorage.get) {
      return global.FillApplyStorage.get(keys);
    }
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, function (result) {
        resolve(result || {});
      });
    });
  }

  function storageSet(obj) {
    if (global.FillApplyStorage && global.FillApplyStorage.set) {
      return global.FillApplyStorage.set(obj);
    }
    return new Promise(function (resolve, reject) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
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

  function hostKey(urlOrHost) {
    if (global.FillApplyAtsAuth && global.FillApplyAtsAuth.hostKeyFromUrl) {
      // If it looks like a bare host, still run through URL parser safely
      var s = String(urlOrHost || '');
      if (s && s.indexOf('://') === -1 && s.indexOf('/') === -1) {
        return s.replace(/^www\./, '').toLowerCase();
      }
      return global.FillApplyAtsAuth.hostKeyFromUrl(s);
    }
    try {
      return new URL(String(urlOrHost || '')).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_e) {
      return String(urlOrHost || '')
        .replace(/^www\./, '')
        .toLowerCase()
        .slice(0, 120);
    }
  }

  async function getAll() {
    var result = await storageGet([KEY]);
    var list = result[KEY];
    return Array.isArray(list) ? list : [];
  }

  async function saveAll(list) {
    var trimmed = Array.isArray(list) ? list.slice() : [];
    while (trimmed.length > MAX_RECORDS) trimmed.shift();
    var payload = {};
    payload[KEY] = trimmed;
    await storageSet(payload);
    return trimmed;
  }

  async function getForHost(urlOrHost, email) {
    var host = hostKey(urlOrHost);
    var em = String(email || '')
      .trim()
      .toLowerCase();
    var all = await getAll();
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var row = all[i];
      if (!row || row.host !== host) continue;
      if (em && row.email && row.email === em) return row;
      if (!best) best = row;
      if (!em && !row.email) best = row;
    }
    return best;
  }

  /**
   * Upsert ATS account state. Strips any accidental secret-like fields.
   */
  async function upsert(entry) {
    if (!entry || !entry.host && !entry.url) return getAll();
    var host = hostKey(entry.host || entry.url);
    var email = String(entry.email || '')
      .trim()
      .toLowerCase();
    var status = String(entry.status || 'unknown');
    var allowedStatus = {
      authenticated: 1,
      account_created: 1,
      already_exists: 1,
      needs_user: 1,
      unknown: 1
    };
    if (!allowedStatus[status]) status = 'unknown';

    var record = {
      host: host,
      email: email || null,
      status: status,
      lastResult: entry.lastResult ? String(entry.lastResult).slice(0, 80) : null,
      lastDetail: entry.lastDetail ? String(entry.lastDetail).slice(0, 240) : null,
      googleUsed: !!entry.googleUsed,
      updatedAt: entry.updatedAt || Date.now()
    };

    // Hard security: never persist these if a caller accidentally passes them
    delete record.password;
    delete record.token;
    delete record.cookies;
    delete record.refreshToken;
    delete record.accessToken;
    delete record.secret;

    var all = await getAll();
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (!all[i] || all[i].host !== host) continue;
      if (email && all[i].email === email) {
        idx = i;
        break;
      }
      if (!email && !all[i].email) {
        idx = i;
        break;
      }
      if (idx === -1) idx = i;
    }
    if (idx >= 0) {
      all[idx] = Object.assign({}, all[idx], record);
    } else {
      all.push(record);
    }
    await saveAll(all);
    return record;
  }

  function statusFromAuthResult(code) {
    var AR = (global.FillApplyAtsAuth && global.FillApplyAtsAuth.AUTH_RESULTS) || {};
    if (code === AR.AUTHENTICATED) return 'authenticated';
    if (code === AR.ACCOUNT_CREATED) return 'account_created';
    if (code === AR.ACCOUNT_ALREADY_EXISTS) return 'already_exists';
    if (
      code === AR.USER_ACTION_REQUIRED ||
      code === AR.CAPTCHA_REQUIRED ||
      code === AR.MFA_REQUIRED ||
      code === AR.EMAIL_VERIFICATION_REQUIRED ||
      code === AR.UNSUPPORTED_AUTH_FLOW ||
      code === AR.AUTH_FAILED ||
      code === AR.TIMEOUT
    ) {
      return 'needs_user';
    }
    return 'unknown';
  }

  global.FillApplyAtsAuthStore = {
    KEY: KEY,
    hostKey: hostKey,
    getAll: getAll,
    saveAll: saveAll,
    getForHost: getForHost,
    upsert: upsert,
    statusFromAuthResult: statusFromAuthResult
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
