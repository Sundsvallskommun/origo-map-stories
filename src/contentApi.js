import { getApiBase } from './apiBase';

function getToken() {
  return localStorage.getItem('cms_token');
}

function setToken(token) {
  localStorage.setItem('cms_token', token);
}

function removeToken() {
  localStorage.removeItem('cms_token');
}

// Set during a database outage: a save could then overwrite real data with
// what the client wrongly holds, so nothing may be written at all.
let writesLocked = false;

function setWritesLocked(locked) {
  writesLocked = locked;
}

function assertWritable() {
  if (writesLocked) throw new Error('Databasen är inte uppkopplad. Det går inte att spara just nu.');
}

function isAuthenticated() {
  return Boolean(getToken());
}

async function login(password) {
  const res = await fetch(`${getApiBase()}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error('Wrong password');
  const { token } = await res.json();
  setToken(token);
}

// ETag (content hash) of each text as last loaded or saved. Sent back as
// If-Match on save so the server can refuse to overwrite someone else's
// newer save (409).
const textEtags = new Map();

async function fetchContent(layerName) {
  const res = await fetch(`${getApiBase()}/api/content/${encodeURIComponent(layerName)}`, {
    cache: 'no-store'
  });
  // 204: no text saved yet (404 from older servers).
  if (res.status === 204 || res.status === 404) {
    textEtags.set(layerName, '"none"');
    return null;
  }
  if (!res.ok) throw new Error('Failed to load content');
  textEtags.set(layerName, res.headers.get('ETag'));
  return res.json();
}

function authExpiredError() {
  const err = new Error('Sessionen har gått ut — logga in igen.');
  err.authExpired = true;
  return err;
}

// fetch() with the admin token. Throws an authExpired error on 401, a
// conflict error on 409 and the server's message on other failures.
async function authFetch(path, options = {}) {
  if (options.method && options.method !== 'GET') assertWritable();
  const token = getToken();
  if (!token) throw authExpiredError();
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    removeToken();
    throw authExpiredError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Begäran misslyckades (${res.status})`);
    err.conflict = res.status === 409;
    throw err;
  }
  return res;
}

async function saveContent(layerName, doc) {
  const etag = textEtags.get(layerName);
  const res = await authFetch(`/api/content/${encodeURIComponent(layerName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {})
    },
    body: JSON.stringify(doc)
  });
  textEtags.set(layerName, res.headers.get('ETag'));
}

async function uploadImage(file) {
  assertWritable();
  const token = getToken();
  if (!token) throw new Error('Du är inte inloggad');
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${getApiBase()}/api/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  if (res.status === 401) {
    removeToken();
    throw new Error('Sessionen har gått ut — logga in igen.');
  }
  if (!res.ok) throw new Error(`Uppladdning av bilden misslyckades (${res.status})`);
  const { url } = await res.json();
  return url;
}

// ─── Versions ─────────────────────────────────────────────────────────────────

async function listVersions() {
  const res = await authFetch('/api/versions', { cache: 'no-store' });
  return (await res.json()).versions;
}

async function deleteVersion(id) {
  await authFetch(`/api/versions/${id}`, { method: 'DELETE' });
}

async function restoreVersion(id) {
  const res = await authFetch(`/api/versions/${id}/restore`, { method: 'POST' });
  return res.json();
}

// Downloads the version as a zip file in the browser.
async function exportVersion(id) {
  const res = await authFetch(`/api/versions/${id}/export`);
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : `origo-map-stories_v${id}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importVersion(file) {
  const body = new FormData();
  body.append('file', file);
  const res = await authFetch('/api/versions/import', { method: 'POST', body });
  return res.json();
}

export {
  getToken, isAuthenticated, login, removeToken, authFetch, setWritesLocked, assertWritable,
  fetchContent, saveContent, uploadImage,
  listVersions, deleteVersion, restoreVersion, exportVersion, importVersion
};
