import { getToken, removeToken, login } from './contentApi';

// The app has two entry links: the public map (/) and the admin map
// (/?admin). Admin UI (cogwheel, edit buttons, map editor) is only shown on
// the admin link AND with a valid login — a token left in localStorage from
// an earlier admin session never turns the public link into an editor.

function isAdminRequested() {
  return new URLSearchParams(window.location.search).has('admin');
}

function decodeTokenPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function hasValidToken() {
  const token = getToken();
  if (!token) return false;
  const payload = decodeTokenPayload(token);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
    removeToken();
    return false;
  }
  return true;
}

function isAdmin() {
  return isAdminRequested() && hasValidToken();
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Modal admin login. Resolves onSuccess after a successful login; "Avbryt"
// just closes it and leaves the page in public mode.
function openAdminLoginModal({ onSuccess, onCancel, message } = {}) {
  if (document.querySelector('.o-admin-login-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'o-mlink-overlay o-admin-login-overlay';
  overlay.innerHTML = `
    <div class="o-mlink-modal o-admin-login-modal" role="dialog" aria-modal="true" aria-labelledby="o-admin-login-title">
      <div class="o-mlink-header">
        <h2 id="o-admin-login-title">Logga in som administratör</h2>
        <button class="o-mlink-close" data-action="cancel" aria-label="Stäng">&times;</button>
      </div>
      <div class="o-mlink-body">
        ${message ? `<div class="o-mlink-warning">${escHtml(message)}</div>` : ''}
        <label for="o-admin-login-pw">Lösenord</label>
        <input id="o-admin-login-pw" type="password" autocomplete="current-password">
        <div class="o-admin-login-err" aria-live="polite"></div>
      </div>
      <div class="o-mlink-footer">
        <button class="o-btn-secondary" type="button" data-action="cancel">Avbryt</button>
        <button class="o-btn-primary" type="button" data-action="login">Logga in</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#o-admin-login-pw');
  const errEl = overlay.querySelector('.o-admin-login-err');

  function close() {
    overlay.remove();
  }

  function cancel() {
    close();
    if (typeof onCancel === 'function') onCancel();
  }

  async function submit() {
    errEl.textContent = '';
    if (!input.value) {
      errEl.textContent = 'Ange lösenord.';
      return;
    }
    try {
      await login(input.value);
      close();
      if (typeof onSuccess === 'function') onSuccess();
    } catch {
      errEl.textContent = 'Fel lösenord.';
      input.select();
    }
  }

  overlay.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.getAttribute('data-action') === 'login') submit();
    else cancel();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.focus();
}

export { isAdminRequested, hasValidToken, isAdmin, openAdminLoginModal };
