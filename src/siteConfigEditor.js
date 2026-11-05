import {
  getToken, removeToken, assertWritable, listVersions, deleteVersion, restoreVersion, exportVersion, importVersion
} from './contentApi';
import { openAdminLoginModal } from './adminMode';
import { getApiBase } from './apiBase';
import { getFallbackMenus } from './config';
import { LEGACY_DOM } from './compat';

function apiUrl(path) {
  return `${getApiBase()}${path}`;
}

// The catalog's layer names; [] when it can't be fetched.
async function loadCatalogLayers() {
  try {
    const res = await fetch(apiUrl('/api/content-catalog'), { cache: 'no-store' });
    const payload = res.ok ? await res.json() : null;
    return payload && Array.isArray(payload.layers) ? payload.layers : [];
  } catch {
    return [];
  }
}

// Accepted pixel sizes for strict assets
const ICON_SIZES = [[38, 49], [76, 98]];
const LOGO_SIZES = [[240, 82], [480, 164]];

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DISCARD_MESSAGE = 'Du har osparade ändringar. Vill du avbryta utan att spara?';

// ETag of the config as last loaded or saved, sent back as If-Match so a save
// can't silently overwrite another admin's newer save.
let configEtag = null;

async function loadConfig() {
  const res = await fetch(apiUrl('/api/site-config'), { cache: 'no-store' });
  if (!res.ok) throw new Error('Site config request failed');
  const config = await res.json();
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid site config');
  configEtag = res.headers.get('ETag');
  return config;
}

async function saveConfig(config) {
  assertWritable();
  const token = getToken();
  const res = await fetch(apiUrl('/api/site-config'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(configEtag ? { 'If-Match': configEtag } : {})
    },
    body: JSON.stringify(config)
  });
  if (res.status === 401) {
    const err = new Error('Sessionen har gått ut — logga in igen.');
    err.authExpired = true;
    throw err;
  }
  if (res.status === 409) {
    throw new Error('Någon annan har sparat konfigurationen under tiden. Stäng och öppna Sajtkonfiguration igen för att se ändringarna.');
  }
  if (!res.ok) throw new Error(`Kunde inte spara konfigurationen (${res.status})`);
  configEtag = res.headers.get('ETag');
  // The server assigns each new submenu its own GeoJSON layer and returns the
  // normalized config, so the caller should continue from that.
  const body = await res.json().catch(() => ({}));
  return body.config || config;
}

async function uploadAsset(assetType, file) {
  assertWritable();
  const token = getToken();
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(apiUrl(`/api/site-assets/${assetType}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  if (res.status === 401) {
    const err = new Error('Sessionen har gått ut — logga in igen.');
    err.authExpired = true;
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Uppladdning misslyckades (${res.status})`);
  }
  return (await res.json()).url;
}

async function validateImage(file, { requireAlpha, acceptedSizes, requirePortrait }) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);

      if (acceptedSizes) {
        const ok = acceptedSizes.some(([sw, sh]) => w === sw && h === sh);
        if (!ok) {
          const fmt = acceptedSizes.map(([sw, sh]) => `${sw}×${sh}`).join(' eller ');
          return reject(new Error(`Bildstorleken måste vara ${fmt} px (bilden är ${w}×${h})`));
        }
      }

      if (requirePortrait && w >= h) {
        return reject(new Error(`Bilden måste vara i stående format (höjd > bredd). Fick ${w}×${h}`));
      }

      if (requireAlpha) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let found = false;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 255) { found = true; break; }
        }
        if (!found) {
          return reject(new Error('Bilden saknar genomskinlig bakgrund. Spara den som PNG med genomskinlig bakgrund och försök igen.'));
        }
      }

      resolve({ width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kunde inte läsa bildfilen'));
    };
    img.src = url;
  });
}

const VERSION_KIND_LABELS = {
  save: 'Sparad',
  restore: 'Återställd',
  import: 'Importerad',
  migration: 'Migrering'
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

// Reads the image URL currently rendered on the page for a given asset, so the
// editor can show what's actually live even when the config has no override
// and the app is falling back to a hardcoded default (see index.js/plugin.scss).
function currentlyRenderedImageUrl(assetKey) {
  if (assetKey === 'buttonIcon') {
    const el = document.querySelector('.o-mapstories-button-icon') || document.getElementById(LEGACY_DOM.buttonIconId);
    return (el && el.getAttribute('src')) ? el.src : null;
  }
  if (assetKey === 'cornerLogo') {
    const el = document.querySelector('.o-mapstories-corner-logo') || document.getElementById(LEGACY_DOM.cornerLogoId);
    return (el && el.getAttribute('src')) ? el.src : null;
  }
  if (assetKey === 'headerImage') {
    const hero = document.querySelector('.o-lp-header-hero');
    if (!hero) return null;
    const match = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(hero).backgroundImage || '');
    return match ? match[1] : null;
  }
  return null;
}

// Without configured menus the editor starts from the menus the panel shows
// (the defaultMenus option, or one menu listing the catalog's layers).
function draftFromConfig(config, catalogLayers) {
  return JSON.parse(JSON.stringify({
    headerText: config.headerText || '',
    images: Object.assign({ headerImage: null, buttonIcon: null, cornerLogo: null }, config.images || {}),
    menus: Array.isArray(config.menus) ? config.menus : getFallbackMenus(catalogLayers)
  }));
}

function openSiteConfigEditor({ currentConfig, catalogLayers, onSave, onClose }) {
  let draft = draftFromConfig(currentConfig, catalogLayers);

  // Preview-only fallbacks: shown in thumbnails so the editor reflects what's
  // actually live, but never written into draft.images unless the admin uploads
  // a new file — an unset field still saves as "use the default".
  const imagePreviewFallback = {
    headerImage: currentlyRenderedImageUrl('headerImage'),
    buttonIcon: currentlyRenderedImageUrl('buttonIcon'),
    cornerLogo: currentlyRenderedImageUrl('cornerLogo')
  };

  function thumbHtml(prop) {
    const src = draft.images[prop] || imagePreviewFallback[prop];
    return src ? `<img src="${escHtml(src)}" alt="">` : '<span>Nuvarande</span>';
  }

  let statusTimeout = null;

  // ─── Build overlay DOM ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'o-cfg-overlay';
  // escHtml is defined at module level
  overlay.innerHTML = `
    <div class="o-cfg-panel">
      <div class="o-cfg-panel-header">
        <span>⚙ Sajtkonfiguration</span>
        <button class="o-cfg-x-btn" id="o-cfg-x">&#10005;</button>
      </div>

      <div class="o-cfg-panel-body">

        <div class="o-cfg-form" id="o-cfg-form">

          <div class="o-cfg-tabs" id="o-cfg-tabs">
            <button class="o-cfg-tab-btn is-active" type="button" data-tab="menyer">Menyer</button>
            <button class="o-cfg-tab-btn" type="button" data-tab="profil">Grafisk profil</button>
            <button class="o-cfg-tab-btn" type="button" data-tab="versioner">Versionshistorik</button>
          </div>

          <div class="o-cfg-tabpanel" data-tabpanel="menyer">
            <section class="o-cfg-section">
              <div id="o-cfg-menus"></div>
              <button class="o-btn-secondary o-cfg-add-menu-btn" id="o-cfg-add-menu">+ Lägg till meny</button>
            </section>
          </div>

          <div class="o-cfg-tabpanel" data-tabpanel="profil" hidden>
            <section class="o-cfg-section">
              <div class="o-cfg-field">
                <label class="o-cfg-label" for="o-cfg-header-text">Rubriktext</label>
                <input class="o-cfg-input" type="text" id="o-cfg-header-text" value="${escHtml(draft.headerText)}" placeholder="Rubriktext">
              </div>
              <div class="o-cfg-field">
                <label class="o-cfg-label">Toppbild</label>
                <div class="o-cfg-img-row">
                  <div class="o-cfg-img-thumb o-cfg-img-thumb--tall" id="o-cfg-thumb-header-image">
                    ${thumbHtml('headerImage')}
                  </div>
                  <div class="o-cfg-img-meta">
                    <button class="o-btn-secondary o-cfg-pick-btn" data-asset="header-image">Välj bild…</button>
                    <input type="file" class="o-cfg-file-input" id="o-cfg-file-header-image" accept=".png,.jpg,.jpeg" data-asset="header-image">
                    <span class="o-cfg-hint">PNG eller JPEG · stående format (högre än bred) · högst 5 MB. Bilden kan beskäras för att fylla ytan.</span>
                    <span class="o-cfg-img-err" id="o-cfg-err-header-image"></span>
                  </div>
                </div>
              </div>
            </section>

            <section class="o-cfg-section">
              <h3 class="o-cfg-section-title">Ikoner</h3>
              <div class="o-cfg-field">
                <label class="o-cfg-label">Menyknapp</label>
                <div class="o-cfg-img-row">
                  <div class="o-cfg-img-thumb o-cfg-img-thumb--icon" id="o-cfg-thumb-button-icon">
                    ${thumbHtml('buttonIcon')}
                  </div>
                  <div class="o-cfg-img-meta">
                    <button class="o-btn-secondary o-cfg-pick-btn" data-asset="button-icon">Välj bild…</button>
                    <input type="file" class="o-cfg-file-input" id="o-cfg-file-button-icon" accept=".png" data-asset="button-icon">
                    <span class="o-cfg-hint">PNG med genomskinlig bakgrund · 38×49 eller 76×98 px · högst 5 MB. Den större storleken blir skarpare på högupplösta skärmar. Bilden används även som ikon i webbläsarfliken.</span>
                    <span class="o-cfg-img-err" id="o-cfg-err-button-icon"></span>
                  </div>
                </div>
              </div>
              <div class="o-cfg-field">
                <label class="o-cfg-label">Hörnlogotyp</label>
                <div class="o-cfg-img-row">
                  <div class="o-cfg-img-thumb o-cfg-img-thumb--logo" id="o-cfg-thumb-corner-logo">
                    ${thumbHtml('cornerLogo')}
                  </div>
                  <div class="o-cfg-img-meta">
                    <button class="o-btn-secondary o-cfg-pick-btn" data-asset="corner-logo">Välj bild…</button>
                    <input type="file" class="o-cfg-file-input" id="o-cfg-file-corner-logo" accept=".png" data-asset="corner-logo">
                    <span class="o-cfg-hint">PNG med genomskinlig bakgrund · 240×82 eller 480×164 px · högst 5 MB. Den större storleken blir skarpare på högupplösta skärmar.</span>
                    <span class="o-cfg-img-err" id="o-cfg-err-corner-logo"></span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div class="o-cfg-tabpanel" data-tabpanel="versioner" hidden>
            <section class="o-cfg-section">
              <p class="o-cfg-hint o-cfg-versions-intro">
                Varje sparning skapar en ny, komplett version av allt innehåll. Vid återställning och import
                sparas den aktuella versionen först, så inget går förlorat.
              </p>
              <div class="o-cfg-versions-actions">
                <button class="o-btn-secondary" id="o-cfg-export-current" type="button">Exportera aktuell</button>
                <button class="o-btn-secondary" id="o-cfg-import-btn" type="button">Importera version…</button>
                <input type="file" class="o-cfg-file-input" id="o-cfg-import-file" accept=".zip,application/zip">
              </div>
              <div id="o-cfg-versions"></div>
            </section>
          </div>

        </div>
      </div>

      <div class="o-cfg-panel-footer" id="o-cfg-footer">
        <span class="o-cfg-status" id="o-cfg-status"></span>
        <span class="o-cfg-footer-actions">
          <button class="o-btn-secondary" id="o-cfg-cancel">Avbryt</button>
          <button class="o-btn-secondary" id="o-cfg-save-btn">Spara</button>
          <button class="o-btn-primary" id="o-cfg-save-close-btn">Spara och stäng</button>
        </span>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  function $id(id) { return overlay.querySelector(`#${id}`); }

  function setStatus(msg, isError) {
    const el = $id('o-cfg-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#c00' : '#060';
    clearTimeout(statusTimeout);
    if (msg) statusTimeout = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  // ─── Expired session ─────────────────────────────────────────────────────
  // The editor is only reachable in admin mode, so it opens without a login.
  // If a save/upload comes back 401 (expired token), drop the dead token and
  // ask for the password again; the in-progress draft is kept so the admin
  // can simply retry.
  function showLoginGate(message) {
    removeToken();
    openAdminLoginModal({
      message,
      onSuccess: () => setStatus('Inloggad igen — försök spara på nytt.', false)
    });
  }

  // ─── Tabs ────────────────────────────────────────────────────────────────
  overlay.querySelectorAll('.o-cfg-tab-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.getAttribute('data-tab');
      overlay.querySelectorAll('.o-cfg-tab-btn').forEach(b => b.classList.toggle('is-active', b === tabBtn));
      overlay.querySelectorAll('.o-cfg-tabpanel').forEach(panel => {
        panel.hidden = panel.getAttribute('data-tabpanel') !== tab;
      });
      // Version actions take effect immediately; there is nothing to save.
      $id('o-cfg-save-btn').hidden = tab === 'versioner';
      $id('o-cfg-save-close-btn').hidden = tab === 'versioner';
      if (tab === 'versioner') renderVersions();
    });
  });

  // ─── Image uploads ───────────────────────────────────────────────────────
  const IMAGE_CONSTRAINTS = {
    'header-image': { requirePortrait: true },
    'button-icon':  { requireAlpha: true, acceptedSizes: ICON_SIZES },
    'corner-logo':  { requireAlpha: true, acceptedSizes: LOGO_SIZES }
  };

  overlay.querySelectorAll('.o-cfg-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const asset = btn.getAttribute('data-asset');
      overlay.querySelector(`#o-cfg-file-${asset}`).click();
    });
  });

  const ASSET_TO_PROP = {
    'header-image': 'headerImage',
    'button-icon':  'buttonIcon',
    'corner-logo':  'cornerLogo'
  };

  overlay.querySelectorAll('.o-cfg-file-input').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const asset = input.getAttribute('data-asset');
      const errEl = $id(`o-cfg-err-${asset}`);
      const thumb = $id(`o-cfg-thumb-${asset}`);
      errEl.textContent = '';

      try {
        await validateImage(file, IMAGE_CONSTRAINTS[asset]);
        setStatus('Laddar upp…', false);
        const rawUrl = await uploadAsset(asset, file);
        const versionedUrl = `${rawUrl}?v=${Date.now()}`;
        draft.images[ASSET_TO_PROP[asset] || asset] = versionedUrl;
        thumb.innerHTML = `<img src="${versionedUrl}" alt="">`;
        errEl.textContent = '';
        setStatus('Bild uppladdad.', false);
      } catch (e) {
        if (e.authExpired) {
          showLoginGate('Sessionen har gått ut — logga in igen för att ladda upp bilder.');
        } else {
          errEl.textContent = e.message;
        }
        input.value = '';
      }
    });
  });

  // ─── Menu editor ────────────────────────────────────────────────────────
  function getMenus() {
    return draft.menus || [];
  }

  function setMenus(menus) {
    draft.menus = menus;
    renderMenus();
  }

  function renderMenus() {
    const container = $id('o-cfg-menus');
    if (!container) return;
    const menus = getMenus();

    container.innerHTML = menus.map((menu, mi) => `
      <div class="o-cfg-menu-group" data-mi="${mi}">
        <div class="o-cfg-menu-group-header">
          <input class="o-cfg-input o-cfg-menu-label" type="text" value="${escHtml(menu.label)}" placeholder="Menygrupp" data-mi="${mi}" data-field="label">
          <div class="o-cfg-order-btns">
            <button class="o-cfg-order-btn" data-mi="${mi}" data-dir="up" title="Flytta upp">▲</button>
            <button class="o-cfg-order-btn" data-mi="${mi}" data-dir="down" title="Flytta ned">▼</button>
            <button class="o-cfg-del-btn" data-mi="${mi}" title="Ta bort meny">✕</button>
          </div>
        </div>
        <div class="o-cfg-items">
          ${menu.items.map((item, ii) => `
            <div class="o-cfg-item" data-mi="${mi}" data-ii="${ii}">
              <div class="o-cfg-item-row">
                <input class="o-cfg-input o-cfg-item-label" type="text" value="${escHtml(item.label)}" placeholder="Undermenytext" data-mi="${mi}" data-ii="${ii}">
                <div class="o-cfg-order-btns">
                  <button class="o-cfg-order-btn o-cfg-item-order" data-mi="${mi}" data-ii="${ii}" data-dir="up" title="Flytta upp">▲</button>
                  <button class="o-cfg-order-btn o-cfg-item-order" data-mi="${mi}" data-ii="${ii}" data-dir="down" title="Flytta ned">▼</button>
                  <button class="o-cfg-del-btn o-cfg-item-del" data-mi="${mi}" data-ii="${ii}" title="Ta bort punkt">✕</button>
                </div>
              </div>
            </div>`).join('')}
          <button class="o-cfg-add-item-btn" data-mi="${mi}">+ Lägg till undermeny</button>
        </div>
      </div>`).join('');

    // Menu label edits
    container.querySelectorAll('.o-cfg-menu-label').forEach(inp => {
      inp.addEventListener('input', () => {
        const mi = +inp.getAttribute('data-mi');
        draft.menus[mi].label = inp.value;
      });
    });

    // Item label edits
    container.querySelectorAll('.o-cfg-item-label').forEach(inp => {
      inp.addEventListener('input', () => {
        const mi = +inp.getAttribute('data-mi');
        const ii = +inp.getAttribute('data-ii');
        draft.menus[mi].items[ii].label = inp.value;
      });
    });

    // Menu order buttons
    container.querySelectorAll('.o-cfg-order-btn:not(.o-cfg-item-order)').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.getAttribute('data-mi');
        const dir = btn.getAttribute('data-dir');
        const menus = getMenus();
        const to = dir === 'up' ? mi - 1 : mi + 1;
        if (to < 0 || to >= menus.length) return;
        [menus[mi], menus[to]] = [menus[to], menus[mi]];
        setMenus(menus);
      });
    });

    // Menu delete buttons
    container.querySelectorAll('.o-cfg-del-btn:not(.o-cfg-item-del)').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.getAttribute('data-mi');
        const menus = getMenus();
        menus.splice(mi, 1);
        setMenus(menus);
      });
    });

    // Item order buttons
    container.querySelectorAll('.o-cfg-item-order').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.getAttribute('data-mi');
        const ii = +btn.getAttribute('data-ii');
        const dir = btn.getAttribute('data-dir');
        const items = draft.menus[mi].items;
        const to = dir === 'up' ? ii - 1 : ii + 1;
        if (to < 0 || to >= items.length) return;
        [items[ii], items[to]] = [items[to], items[ii]];
        setMenus(draft.menus);
      });
    });

    // Item delete buttons
    container.querySelectorAll('.o-cfg-item-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.getAttribute('data-mi');
        const ii = +btn.getAttribute('data-ii');
        draft.menus[mi].items.splice(ii, 1);
        setMenus(draft.menus);
      });
    });

    // Add item buttons
    container.querySelectorAll('.o-cfg-add-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.getAttribute('data-mi');
        draft.menus[mi].items.push({ id: uid(), label: '' });
        setMenus(draft.menus);
      });
    });
  }

  renderMenus();

  // ─── Add menu ────────────────────────────────────────────────────────────
  $id('o-cfg-add-menu')?.addEventListener('click', () => {
    const menus = getMenus();
    menus.push({ id: uid(), label: '', items: [] });
    setMenus(menus);
  });

  // ─── Unsaved changes ──────────────────────────────────────────────────────
  // The draft (with the header text as typed) as JSON; it is "dirty" while it
  // differs from the snapshot taken when it was loaded or last saved.
  function serializeDraft() {
    return JSON.stringify({
      headerText: ($id('o-cfg-header-text')?.value || '').trim(),
      images: draft.images,
      menus: draft.menus
    });
  }

  let savedSnapshot = serializeDraft();

  function isDirty() {
    return serializeDraft() !== savedSnapshot;
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  // Resolves true when the config was saved (also after logging in again on
  // an expired session), false on an error, a conflict or a cancelled login.
  async function save() {
    draft.headerText = ($id('o-cfg-header-text')?.value || '').trim();

    // Clean up empty menu items
    if (draft.menus) {
      draft.menus = draft.menus
        .filter(m => m.label.trim() || m.items.length)
        .map(m => ({
          ...m,
          // Unnamed items are only kept if they already own a layer, so
          // saving never silently trashes an existing submenu's map and text.
          items: m.items.filter(it => (it.label || '').trim() || it.layerName)
        }));
    }

    try {
      setStatus('Sparar…', false);
      const saved = await saveConfig(draft);
      draft.menus = saved.menus || draft.menus;
      setStatus('Sparades!', false);
      renderMenus();
      savedSnapshot = serializeDraft();
      if (typeof onSave === 'function') onSave(JSON.parse(JSON.stringify(draft)));
      return true;
    } catch (e) {
      if (!e.authExpired) {
        setStatus(e.message, true);
        return false;
      }
      // Expired session: log in again and retry the save.
      if (document.querySelector('.o-admin-login-overlay')) return false;
      removeToken();
      return new Promise(resolve => {
        openAdminLoginModal({
          message: 'Sessionen har gått ut — logga in igen för att spara ändringarna.',
          onSuccess: () => { save().then(resolve); },
          onCancel: () => resolve(false)
        });
      });
    }
  }

  $id('o-cfg-save-btn')?.addEventListener('click', () => { save(); });
  $id('o-cfg-save-close-btn')?.addEventListener('click', async () => {
    if (await save()) close();
  });

  // ─── Versions ─────────────────────────────────────────────────────────────
  function handleVersionError(e) {
    if (e.authExpired) showLoginGate('Sessionen har gått ut — logga in igen.');
    else setStatus(e.message, true);
  }

  async function renderVersions() {
    const container = $id('o-cfg-versions');
    if (!container) return;
    container.innerHTML = '<p class="o-cfg-hint">Laddar versioner…</p>';
    let versions;
    try {
      versions = await listVersions();
    } catch (e) {
      container.innerHTML = '';
      handleVersionError(e);
      return;
    }
    container.innerHTML = `
      <table class="o-cfg-versions-table">
        <thead>
          <tr><th>Version</th><th>Datum/tid</th><th>Typ</th><th>Beskrivning</th><th>Storlek</th><th>Åtgärder</th></tr>
        </thead>
        <tbody>
          ${versions.map(v => `
            <tr class="${v.isCurrent ? 'is-current' : ''}" data-version-id="${v.id}">
              <td>${v.id}${v.isCurrent ? ' <span class="o-cfg-version-badge">Aktuell</span>' : ''}</td>
              <td>${escHtml(formatTime(v.createdAt))}</td>
              <td>${escHtml(VERSION_KIND_LABELS[v.kind] || v.kind)}</td>
              <td>${escHtml(v.description)}</td>
              <td title="${v.fileCount} filer">${formatBytes(v.totalSize)}</td>
              <td><div class="o-cfg-version-actions">
                ${v.isCurrent ? '' : `<button class="o-btn-secondary" data-action="restore" data-id="${v.id}">Återställ</button>`}
                <button class="o-btn-secondary" data-action="export" data-id="${v.id}">Exportera</button>
                ${v.isCurrent ? '' : `<button class="o-cfg-del-btn" data-action="delete" data-id="${v.id}" title="Radera version ${v.id}">✕</button>`}
              </div></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // After a restore or import the live content changed: reload the config
  // into the editor and let the map pick it up.
  async function reloadAfterVersionChange(message) {
    const [fresh, freshCatalog] = await Promise.all([loadConfig(), loadCatalogLayers()]);
    draft = draftFromConfig(fresh, freshCatalog);
    $id('o-cfg-header-text').value = draft.headerText;
    Object.entries(ASSET_TO_PROP).forEach(([asset, prop]) => {
      $id(`o-cfg-thumb-${asset}`).innerHTML = thumbHtml(prop);
    });
    renderMenus();
    savedSnapshot = serializeDraft();
    await renderVersions();
    setStatus(message, false);
    if (typeof onSave === 'function') onSave(JSON.parse(JSON.stringify(fresh)));
  }

  $id('o-cfg-versions')?.addEventListener('click', async evt => {
    const btn = evt.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.getAttribute('data-id'));
    const action = btn.getAttribute('data-action');
    try {
      if (action === 'export') {
        setStatus('Exporterar…', false);
        await exportVersion(id);
        setStatus(`Version ${id} exporterad.`, false);
      } else if (action === 'restore') {
        if (!window.confirm(`Återställa version ${id}?\n\nDen aktuella versionen sparas och finns kvar i listan. Osparade ändringar i de andra flikarna försvinner.`)) return;
        setStatus('Återställer…', false);
        const { versionId } = await restoreVersion(id);
        await reloadAfterVersionChange(`Version ${id} återställd som version ${versionId}.`);
      } else if (action === 'delete') {
        if (!window.confirm(`Radera version ${id} permanent?`)) return;
        await deleteVersion(id);
        await renderVersions();
        setStatus(`Version ${id} raderad.`, false);
      }
    } catch (e) {
      handleVersionError(e);
    }
  });

  $id('o-cfg-export-current')?.addEventListener('click', async () => {
    try {
      const current = (await listVersions()).find(v => v.isCurrent);
      if (!current) { setStatus('Det finns ingen version att exportera.', true); return; }
      setStatus('Exporterar…', false);
      await exportVersion(current.id);
      setStatus(`Version ${current.id} exporterad.`, false);
    } catch (e) {
      handleVersionError(e);
    }
  });

  $id('o-cfg-import-btn')?.addEventListener('click', () => $id('o-cfg-import-file').click());

  $id('o-cfg-import-file')?.addEventListener('change', async evt => {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (!file) return;
    if (!window.confirm(`Importera "${file.name}" som ny aktuell version?\n\nDen aktuella versionen sparas och finns kvar i listan.`)) return;
    try {
      setStatus('Importerar…', false);
      const { versionId, modified } = await importVersion(file);
      const note = modified.length ? ` ${modified.length} filer var manuellt ändrade.` : '';
      await reloadAfterVersionChange(`Importerad som version ${versionId}.${note}`);
    } catch (e) {
      handleVersionError(e);
    }
  });

  // ─── Close ────────────────────────────────────────────────────────────────
  function close() {
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    if (typeof onClose === 'function') onClose();
  }

  // "Avbryt", ✕ and Escape: warn about unsaved changes, then close.
  function requestClose() {
    if (isDirty() && !window.confirm(DISCARD_MESSAGE)) return;
    close();
  }

  function handleKeydown(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('.o-admin-login-overlay')) return;
    e.preventDefault();
    requestClose();
  }

  $id('o-cfg-x')?.addEventListener('click', requestClose);
  $id('o-cfg-cancel')?.addEventListener('click', requestClose);
  document.addEventListener('keydown', handleKeydown);

  return { close };
}

export { openSiteConfigEditor, loadConfig };
