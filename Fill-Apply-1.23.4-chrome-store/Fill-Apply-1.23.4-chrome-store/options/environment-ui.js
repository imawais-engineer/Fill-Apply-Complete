/**
 * Environment Options UI — registration password (masked), isolated store.
 */
(function () {
  'use strict';

  var input = document.getElementById('envRegistrationPassword');
  var statusEl = document.getElementById('envStatus');
  var btnSave = document.getElementById('btnEnvSave');
  var btnClear = document.getElementById('btnEnvClear');
  if (!input) return;

  function Env() {
    return globalThis.FillApplyEnvironment;
  }

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function load() {
    var api = Env();
    if (!api) return;
    await api.load();
    var cur = api.get();
    // Never echo the real password into the DOM value for screenshots — show placeholder if set
    input.value = '';
    input.placeholder = cur.registrationPassword ? '•••••••• (saved — type to replace)' : '••••••••';
  }

  if (btnSave) {
    btnSave.addEventListener('click', async function () {
      var api = Env();
      if (!api) return;
      var val = input.value;
      if (!val) {
        setStatus('Enter a password to save (or Clear to remove)', 'err');
        return;
      }
      await api.save({ registrationPassword: val });
      input.value = '';
      input.placeholder = '•••••••• (saved — type to replace)';
      setStatus('Environment password saved (not exported)', 'ok');
    });
  }
  if (btnClear) {
    btnClear.addEventListener('click', async function () {
      var api = Env();
      if (!api) return;
      if (!confirm('Clear registration password from Environment?')) return;
      await api.clearPassword();
      input.value = '';
      input.placeholder = '••••••••';
      setStatus('Password cleared', 'ok');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
