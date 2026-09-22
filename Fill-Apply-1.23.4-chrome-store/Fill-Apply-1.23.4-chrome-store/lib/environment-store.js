/**
 * ENVIRONMENT store — registration password only (strict isolation).
 * Never written into Adaptive Dictionary, Question Bank, exports, logs, or fixtures.
 *
 * Attaches globalThis.FillApplyEnvironment.
 */
(function (global) {
  'use strict';

  var KEY = 'fillApply.environment';

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

  var memory = { registrationPassword: '' };

  async function load() {
    var res = await storageGet([KEY]);
    var raw = res[KEY];
    if (raw && typeof raw === 'object') {
      memory.registrationPassword = String(raw.registrationPassword || '');
    }
    return get();
  }

  function get() {
    return {
      registrationPassword: memory.registrationPassword || ''
    };
  }

  async function save(partial) {
    partial = partial || {};
    if (Object.prototype.hasOwnProperty.call(partial, 'registrationPassword')) {
      memory.registrationPassword = String(partial.registrationPassword == null ? '' : partial.registrationPassword);
    }
    var payload = {};
    payload[KEY] = {
      registrationPassword: memory.registrationPassword || ''
    };
    await storageSet(payload);
    return get();
  }

  async function clearPassword() {
    return save({ registrationPassword: '' });
  }

  /** Safe snapshot for diagnostics — never includes the password value. */
  function publicMeta() {
    return {
      hasRegistrationPassword: !!(memory.registrationPassword && String(memory.registrationPassword).length)
    };
  }

  global.FillApplyEnvironment = {
    KEY: KEY,
    load: load,
    get: get,
    save: save,
    clearPassword: clearPassword,
    publicMeta: publicMeta
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
