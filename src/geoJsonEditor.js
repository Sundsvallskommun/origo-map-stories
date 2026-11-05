import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import OSM from 'ol/source/OSM';
import TileGrid from 'ol/tilegrid/TileGrid';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Select from 'ol/interaction/Select';
import Translate from 'ol/interaction/Translate';
import { click } from 'ol/events/condition';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection } from 'ol/proj';

import { SYMBOLS, SYMBOL_CATEGORIES, getSymbolById, buildSymbolPreviewSvg } from './symbolLibrary';
import { styleFunction, selectStyleFunction, previewStyleForSym } from './olStyleBuilder';
import { getApiBase } from './apiBase';

// EPSG:3006 (SWEREF 99 TM) is the product's data CRS: every content layer is
// stored in it, and the editor map uses it as its view projection.
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
register(proj4);
// Extent of the common SWEREF 99 TM tile grids; needed for default tile grids
// and for reprojecting a background in another projection (OSM).
getProjection('EPSG:3006').setExtent([-1200000, 4700000, 2600000, 8500000]);

const DATA_PROJ = 'EPSG:3006';
const MAP_PROJ = DATA_PROJ;

// The editor's background and start view come from editor-config.json next
// to editor.html (or the same-origin file given by ?config=):
//   {
//     "background": { "type": "wms" | "osm" | "none", "url": "...", "layers": "...",
//                     "version": "1.1.1", "format": "image/png",
//                     "tileGrid": { "resolutions": [...], "extent": [minX, minY, maxX, maxY] } },
//     "center": [x, y],   // EPSG:3006
//     "zoom": 1           // index into the tile grid's resolutions
//   }
// Without the file the editor shows OpenStreetMap over all of Sweden.
const EDITOR_CONFIG_FILE = 'editor-config.json';
const DEFAULT_EDITOR_CONFIG = {
  background: { type: 'osm' },
  center: [600000, 6900000],
  zoom: 1
};
// Zoom levels without a configured tile grid: 4096 m/px, halved per level.
const DEFAULT_RESOLUTIONS = Array.from({ length: 16 }, (_, i) => 4096 / (2 ** i));
// Furthest zoom-in when fitting a loaded layer without a configured grid.
const DEFAULT_FIT_MIN_RESOLUTION = 0.125;

let map, vectorSource, vectorLayer;
let selectInteraction, modifyInteraction, translateInteraction;
let activeDrawInteraction = null;
let currentLayerName = null;
// ETag of the loaded layer, sent back as If-Match so a save can't silently
// overwrite someone else's newer save.
let currentLayerEtag = null;
let activeSymbolId = null;
// Counts feature changes (add/modify/delete/properties); the layer is dirty
// while it differs from the count at the last load or successful save.
let changeCount = 0;
let savedChangeCount = 0;
let authToken = localStorage.getItem('cms_token') || null;
// Furthest zoom-in when fitting a loaded layer (set from the editor config).
let fitMinResolution = DEFAULT_FIT_MIN_RESOLUTION;

// ── Same-origin URL parameters ───────────────────────────────────────────────

// A URL parameter that points at a URL, accepted only on the editor's own
// origin: the editor sends the admin token to its API base, so a link must
// not be able to redirect it elsewhere.
function sameOriginParam(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    if (url.origin === window.location.origin) return url;
  } catch {
    // not a URL
  }
  console.warn(`[OrigoMapStories] Ignoring ?${name}= from another origin: ${value}`);
  return null;
}

// The content API: ?apiBase= (same origin only), otherwise the editor page's folder.
function resolveApiBase() {
  const url = sameOriginParam('apiBase');
  return url ? `${url.origin}${url.pathname}`.replace(/\/+$/, '') : getApiBase();
}

const apiBase = resolveApiBase();

window.addEventListener('storage', event => {
  if (event.key !== 'cms_token') return;
  authToken = event.newValue;
  updateLoginBtn();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function setStatus(msg, isError) {
  const el = $('ed-status');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'ed-status ed-status-error' : 'ed-status';
}

const DISCARD_MESSAGE = 'Du har osparade ändringar. Vill du avbryta utan att spara?';

function isDirty() {
  return changeCount !== savedChangeCount;
}

function markClean() {
  savedChangeCount = changeCount;
}

// "Avbryt" / Escape: warns about unsaved changes, then closes the editor.
function requestClose() {
  if (isDirty() && !window.confirm(DISCARD_MESSAGE)) return;
  closeEditor();
}

function closeEditor() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'editor-close', layerName: currentLayerName }, '*');
  } else {
    window.close();
  }
}

// ── Map setup ─────────────────────────────────────────────────────────────────

// ── Editor config ─────────────────────────────────────────────────────────────

async function loadEditorConfig() {
  const url = sameOriginParam('config') || new URL(EDITOR_CONFIG_FILE, window.location.href);
  try {
    const res = await fetch(url.href, { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_EDITOR_CONFIG;
    const cfg = await res.json();
    return cfg && typeof cfg === 'object' ? cfg : DEFAULT_EDITOR_CONFIG;
  } catch (err) {
    console.warn(`[OrigoMapStories] ${EDITOR_CONFIG_FILE} could not be read, using the default background`, err);
    return DEFAULT_EDITOR_CONFIG;
  }
}

function validResolutions(tileGrid) {
  const resolutions = tileGrid && Array.isArray(tileGrid.resolutions)
    ? tileGrid.resolutions.filter(n => typeof n === 'number' && n > 0)
    : [];
  return resolutions.length > 0 ? resolutions : null;
}

function validExtent(tileGrid) {
  const extent = tileGrid && tileGrid.extent;
  return Array.isArray(extent) && extent.length === 4 && extent.every(n => typeof n === 'number') ? extent : null;
}

function createBackgroundLayer(background) {
  const type = background && background.type ? String(background.type).toLowerCase() : 'osm';
  if (type === 'none') return null;
  if (type === 'wms' && background.url) {
    const resolutions = validResolutions(background.tileGrid);
    const extent = validExtent(background.tileGrid);
    return new TileLayer({
      source: new TileWMS({
        url: background.url,
        params: {
          LAYERS: background.layers || '',
          FORMAT: background.format || 'image/png',
          VERSION: background.version || '1.1.1',
          TILED: true
        },
        projection: MAP_PROJ,
        // Without a grid OpenLayers uses its default grid over the projection extent.
        ...(resolutions ? {
          tileGrid: new TileGrid({
            extent: extent || getProjection(MAP_PROJ).getExtent(),
            resolutions,
            tileSize: 256
          })
        } : {})
      })
    });
  }
  // OSM tiles are in Web Mercator; OpenLayers reprojects them into the view.
  return new TileLayer({ source: new OSM(background && background.url ? { url: background.url } : {}) });
}

function initMap(editorConfig) {
  const cfg = editorConfig || DEFAULT_EDITOR_CONFIG;
  const background = cfg.background || DEFAULT_EDITOR_CONFIG.background;
  // The tile grid only describes which tiles the background serves; the view
  // is not bound to it, so the map can be panned anywhere and zoomed 32x past
  // both ends of the grid (outside it the nearest tile level is stretched).
  const resolutions = validResolutions(background.tileGrid) || DEFAULT_RESOLUTIONS;
  const requestedZoom = Number.isInteger(cfg.zoom) ? cfg.zoom : DEFAULT_EDITOR_CONFIG.zoom;
  const zoom = Math.min(Math.max(requestedZoom, 0), resolutions.length - 1);
  const center = Array.isArray(cfg.center) && cfg.center.length === 2 ? cfg.center : DEFAULT_EDITOR_CONFIG.center;
  fitMinResolution = validResolutions(background.tileGrid)
    ? resolutions[Math.min(12, resolutions.length - 1)]
    : DEFAULT_FIT_MIN_RESOLUTION;

  vectorSource = new VectorSource();
  ['addfeature', 'removefeature', 'changefeature', 'clear'].forEach(type => {
    vectorSource.on(type, () => { changeCount += 1; });
  });
  vectorLayer = new VectorLayer({ source: vectorSource, style: styleFunction, zIndex: 10 });
  const backgroundLayer = createBackgroundLayer(background);

  map = new Map({
    target: 'ed-map',
    layers: backgroundLayer ? [backgroundLayer, vectorLayer] : [vectorLayer],
    // No extent and no fixed resolution list: free panning and smooth zoom.
    view: new View({
      center,
      resolution: resolutions[zoom],
      projection: MAP_PROJ,
      maxResolution: resolutions[0] * 32,
      minResolution: resolutions[resolutions.length - 1] / 32
    })
  });

  selectInteraction = new Select({ condition: click, style: selectStyleFunction });
  modifyInteraction = new Modify({ features: selectInteraction.getFeatures() });
  translateInteraction = new Translate({ features: selectInteraction.getFeatures() });

  map.addInteraction(selectInteraction);
  map.addInteraction(modifyInteraction);
  map.addInteraction(translateInteraction);

  // Read-only handles for the UI tests and for debugging in the console.
  window.mapStoriesEditor = {
    map, layer: vectorLayer, source: vectorSource, selected: selectInteraction.getFeatures(), apiBase, config: cfg
  };

  // Keyboard delete shortcut
  document.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputFocused()) {
      deleteSelected();
    }
    if (e.key === 'Escape') {
      // An active drawing tool is left first; only then does Escape close.
      if (activeDrawInteraction) {
        activeDrawInteraction.abortDrawing();
        setSelectMode();
      } else if (!$('ed-login-dlg')) {
        requestClose();
      }
    }
  });
}

function isInputFocused() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ── Load / Save ───────────────────────────────────────────────────────────────

async function loadLayer(name) {
  vectorSource.clear();
  currentLayerEtag = null;
  setStatus('Laddar…');
  try {
    const res = await fetch(`${apiBase}/content-files/${encodeURIComponent(name)}.geojson`, { cache: 'no-store' });
    if (res.status === 404) { currentLayerEtag = '"none"'; setStatus(`Nytt lager – ${name}`); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentLayerEtag = res.headers.get('ETag');
    const gj = await res.json();
    const features = new GeoJSON().readFeatures(gj, {
      dataProjection: DATA_PROJ, featureProjection: MAP_PROJ
    });
    vectorSource.addFeatures(features);
    if (features.length > 0) {
      map.getView().fit(vectorSource.getExtent(), { padding: [60, 60, 60, 60], minResolution: fitMinResolution });
    }
    setStatus(`${features.length} objekt laddade`);
  } catch (err) {
    setStatus(`Laddningsfel: ${err.message}`, true);
  } finally {
    markClean();
  }
}

// Saves the layer. Resolves true when it was saved (also after logging in
// in the dialog), false on an error, a conflict or a cancelled login.
function saveLayer() {
  return new Promise(resolve => { attemptSave(resolve); });
}

function loginThenSave(done) {
  if ($('ed-login-dlg')) { done(false); return; }
  openLoginDialog(() => attemptSave(done), () => done(false));
}

async function attemptSave(done) {
  authToken = localStorage.getItem('cms_token') || null;
  if (!currentLayerName) { setStatus('Välj ett lager först', true); done(false); return; }
  if (!authToken) { loginThenSave(done); return; }
  const requestToken = authToken;

  const changesAtSave = changeCount;
  const features = vectorSource.getFeatures();
  const gj = new GeoJSON().writeFeaturesObject(features, {
    dataProjection: DATA_PROJ, featureProjection: MAP_PROJ
  });
  gj.name = currentLayerName;
  gj.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } };

  setStatus('Sparar…');
  try {
    const res = await fetch(`${apiBase}/api/geojson/${encodeURIComponent(currentLayerName)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(currentLayerEtag ? { 'If-Match': currentLayerEtag } : {})
      },
      body: JSON.stringify(gj)
    });
    if (res.status === 401) {
      const latestToken = localStorage.getItem('cms_token');
      if (latestToken && latestToken !== requestToken) {
        authToken = latestToken;
        attemptSave(done);
        return;
      }
      authToken = null;
      localStorage.removeItem('cms_token');
      setStatus('Session utgången', true);
      loginThenSave(done);
      return;
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      setStatus(body.error || 'Någon annan har sparat ändringar i lagret. Ladda om för att se dem.', true);
      done(false);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentLayerEtag = res.headers.get('ETag');
    // Changes made while the request was under way are still unsaved.
    savedChangeCount = changesAtSave;
    setStatus(`Sparat – ${features.length} objekt`);
    done(true);
  } catch (err) {
    setStatus(`Sparfel: ${err.message}`, true);
    done(false);
  }
}

async function saveAndClose() {
  if (await saveLayer()) closeEditor();
}

// ── Auth dialog ───────────────────────────────────────────────────────────────

function openLoginDialog(onSuccess, onCancel) {
  if ($('ed-login-dlg')) return;
  const el = document.createElement('div');
  el.id = 'ed-login-dlg';
  el.innerHTML = `
    <div class="ed-dlg-backdrop">
      <div class="ed-dlg">
        <h3>Logga in</h3>
        <input id="ed-login-pw" type="password" placeholder="Lösenord" autocomplete="current-password">
        <p id="ed-login-err" class="ed-dlg-err"></p>
        <div class="ed-dlg-row">
          <button id="ed-login-ok" class="ed-btn-primary">Logga in</button>
          <button id="ed-login-cancel" class="ed-btn-secondary">Avbryt</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  $('ed-login-pw').focus();

  async function doLogin() {
    const pw = $('ed-login-pw').value;
    const errEl = $('ed-login-err');
    try {
      const res = await fetch(`${apiBase}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (!res.ok) throw new Error('Fel lösenord');
      const { token } = await res.json();
      authToken = token;
      localStorage.setItem('cms_token', token);
      el.remove();
      setStatus('Inloggad');
      if (typeof onSuccess === 'function') onSuccess();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  $('ed-login-ok').addEventListener('click', doLogin);
  $('ed-login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('ed-login-cancel').addEventListener('click', () => {
    el.remove();
    if (typeof onCancel === 'function') onCancel();
  });
}

// ── Drawing interactions ──────────────────────────────────────────────────────

function clearDrawTool() {
  if (activeDrawInteraction) {
    map.removeInteraction(activeDrawInteraction);
    activeDrawInteraction = null;
  }
}

function setSelectMode() {
  clearDrawTool();
  activeSymbolId = null;
  selectInteraction.setActive(true);
  modifyInteraction.setActive(true);
  translateInteraction.setActive(true);
  document.querySelectorAll('.ed-sym-btn').forEach(b => b.classList.remove('is-active'));
  $('ed-tool-select')?.classList.add('is-active');
  $('ed-tool-delete')?.classList.remove('is-active');
}

function activateSymbol(symId) {
  clearDrawTool();
  selectInteraction.getFeatures().clear();
  activeSymbolId = symId;

  const sym = getSymbolById(symId);
  if (!sym) return;

  selectInteraction.setActive(false);
  modifyInteraction.setActive(false);
  translateInteraction.setActive(false);

  activeDrawInteraction = new Draw({
    source: vectorSource,
    type: sym.geometryType,
    style: previewStyleForSym(sym)
  });

  activeDrawInteraction.on('drawend', evt => {
    evt.feature.set('symbolType', symId);
    // Force re-render so the committed feature gets its proper style
    vectorLayer.changed();
  });

  map.addInteraction(activeDrawInteraction);

  document.querySelectorAll('.ed-sym-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.symId === symId);
  });
  $('ed-tool-select')?.classList.remove('is-active');
}

function deleteSelected() {
  const feats = selectInteraction.getFeatures();
  feats.forEach(f => vectorSource.removeFeature(f));
  feats.clear();
}

// ── Symbol panel ──────────────────────────────────────────────────────────────

function buildSymbolPanel() {
  const panel = $('ed-symbol-panel');
  if (!panel) return;
  let html = '';
  SYMBOL_CATEGORIES.forEach(cat => {
    html += `<div class="ed-cat-label">${cat}</div>`;
    SYMBOLS.filter(s => s.category === cat).forEach(sym => {
      html += `<button class="ed-sym-btn" data-sym-id="${sym.id}" title="${sym.label}">
        ${buildSymbolPreviewSvg(sym)}
        <span class="ed-sym-label">${sym.label}</span>
      </button>`;
    });
  });
  panel.innerHTML = html;
  panel.querySelectorAll('.ed-sym-btn').forEach(btn => {
    btn.addEventListener('click', () => activateSymbol(btn.dataset.symId));
  });
}

// ── Layer ─────────────────────────────────────────────────────────────────────

// The editor always edits the GeoJSON owned by the submenu it was opened
// from (?layer=…); there is no way to switch layer from inside the editor.
function openLayer(name) {
  if (!name) {
    setStatus('Undermenyn saknar ett kopplat kartlager', true);
    return;
  }
  currentLayerName = name;
  document.title = `Kartredigerare – ${name.replace(/_/g, ' ')}`;
  loadLayer(name);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  initMap(await loadEditorConfig());
  buildSymbolPanel();
  openLayer(new URLSearchParams(window.location.search).get('layer'));
  setSelectMode();

  $('ed-tool-select')?.addEventListener('click', setSelectMode);
  $('ed-tool-delete')?.addEventListener('click', () => {
    deleteSelected();
    setSelectMode();
  });

  $('ed-btn-save')?.addEventListener('click', () => { saveLayer(); });
  $('ed-btn-save-close')?.addEventListener('click', saveAndClose);
  $('ed-btn-close')?.addEventListener('click', requestClose);

  if (authToken) setStatus('Inloggad');
}

document.addEventListener('DOMContentLoaded', init);
