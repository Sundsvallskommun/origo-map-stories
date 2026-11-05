import Origo from 'Origo';
import LayerPanel, { getHeaderText } from './src/layerPanel';
import TextPanel from './src/textPanel';
import FeatureSync from './src/featureSync';
import { styleFunction } from './src/olStyleBuilder';
import { openSiteConfigEditor, loadConfig } from './src/siteConfigEditor';
import { getApiBase } from './src/apiBase';
import { isAdminRequested, hasValidToken, openAdminLoginModal } from './src/adminMode';
import { getAllLayers, getLayerIdentifier } from './src/layerUtils';
import { setWritesLocked } from './src/contentApi';
import { SITE_STATUS, classifySiteStatus } from './src/siteStatus';
import { installLegacyGlobals, LEGACY_DOM } from './src/compat';
import { configure, resolveContentLayer } from './src/config';

/* global __BUILD_SHA__ */
// Git SHA injected by webpack DefinePlugin (tasks/webpack.common.js).
const BUILD_MARKER = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
window.OrigoMapStoriesBuild = BUILD_MARKER;
console.info(`OrigoMapStories build ${BUILD_MARKER}`);

// Origo layer types whose objects are vector features that can be picked.
const LINKABLE_LAYER_TYPES = ['WFS', 'GEOJSON', 'AGS_FEATURE', 'TOPOJSON', 'WMS'];
// A server that never answers counts as an outage after this long.
const SITE_LOAD_TIMEOUT_MS = 30000;

function resolveMountTarget(viewerInstance) {
  const candidates = [];
  const main = viewerInstance && viewerInstance.getMain ? viewerInstance.getMain() : null;
  const nav = main && main.getNavigation ? main.getNavigation() : null;
  if (nav && typeof nav.getId === 'function') {
    const navId = nav.getId();
    if (navId) candidates.push(navId);
  }

  candidates.push(
    'o-tools-left',
    'o-tools-right',
    'o-tools-top',
    'o-tools-bottom',
    'o-map',
    'app-wrapper'
  );

  for (const candidate of candidates) {
    if (!candidate) continue;
    const el = candidate.startsWith('#') || candidate.startsWith('.')
      ? document.querySelector(candidate)
      : document.getElementById(candidate);
    if (el) return candidate;
  }

  return null;
}

// The layer names in the catalog. Throws on any failure.
async function fetchCatalogLayers() {
  const base = getApiBase();
  const response = await fetch(`${base}/api/content-catalog`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Catalog request failed');

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.layers)) throw new Error('Invalid catalog');
  return payload.layers;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

const OrigoMapStories = function OrigoMapStories(options = {}) {
  const config = configure(options);
  const { buttonText } = config;

  let pluginButton;
  let viewer;
  let target;
  let layerPanel = null;
  let textPanel = null;
  let featureSync = null;
  let siteConfig = {};
  let siteStatus = SITE_STATUS.LOADING;
  // Layer names in the content catalog, as last fetched.
  let catalogLayers = [];
  let mapLayerBaseline = null;
  // True while onLayerSelect swaps the text panel for a new selection, so
  // the old panel's onClose doesn't clear that new selection in the menu.
  let replacingTextPanel = false;

  function applyConfigAssets(cfg) {
    // Browser tab title follows the panel header ("Rubriktext").
    document.title = getHeaderText(cfg);

    // Button icon
    const btnImg = document.querySelector('.o-mapstories-button-icon');
    if (btnImg && cfg.images && cfg.images.buttonIcon) {
      btnImg.src = cfg.images.buttonIcon;
    }

    // Corner logo
    const logo = document.querySelector('.o-mapstories-corner-logo');
    if (logo) {
      if (cfg.images && cfg.images.cornerLogo) logo.src = cfg.images.cornerLogo;
      logo.alt = getCornerLogoAlt(cfg);
    }

    // Favicon (browser tab icon)
    if (cfg.images && cfg.images.buttonIcon) {
      let favicon = document.querySelector('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.type = 'image/png';
      favicon.href = `${cfg.images.buttonIcon}?t=${Date.now()}`;
    }
  }

  // The cornerLogoAlt option, or else the header text ("Rubriktext").
  function getCornerLogoAlt(cfg) {
    return config.cornerLogoAlt !== null ? config.cornerLogoAlt : getHeaderText(cfg);
  }

  function mountCornerLogo(cfg) {
    const mapContainer = document.getElementById(viewer.getId());
    if (!mapContainer) return;

    if (mapContainer.querySelector('.o-mapstories-corner-logo')) {
      applyConfigAssets(cfg);
      return;
    }

    const currentPosition = window.getComputedStyle(mapContainer).position;
    if (!currentPosition || currentPosition === 'static') {
      mapContainer.style.position = 'relative';
    }

    const logo = document.createElement('img');
    // The id and the second class are the legacy names (src/compat.js).
    logo.id = LEGACY_DOM.cornerLogoId;
    logo.className = `o-mapstories-corner-logo ${LEGACY_DOM.cornerLogoClass}`;
    logo.setAttribute('data-oms', 'corner-logo');
    logo.src = (cfg.images && cfg.images.cornerLogo) || config.assets.cornerLogo;
    logo.alt = getCornerLogoAlt(cfg);
    mapContainer.appendChild(logo);
  }

  // Moves between the empty and the normal state as an admin adds content.
  function setSiteStatus(status) {
    if (status === siteStatus) return;
    siteStatus = status;
    // The open text belongs to the menu that is being replaced.
    if (textPanel) textPanel.unmount();
  }

  function onConfigSaved(newConfig) {
    siteConfig = newConfig;
    applyConfigAssets(newConfig);
    if (siteStatus === SITE_STATUS.EMPTY && Array.isArray(newConfig.menus)) setSiteStatus(SITE_STATUS.READY);
    if (layerPanel) layerPanel.updateConfig(newConfig);
    // New submenus get their GeoJSON created server-side on save.
    registerContentLayers();
  }

  // Re-render admin-gated UI in whatever panels are open, e.g. right after
  // logging in on the admin link.
  function refreshAdminUi() {
    if (layerPanel) layerPanel.refresh();
    if (textPanel) textPanel.refreshAdminUi();
  }

  function openConfigEditor() {
    if (siteStatus === SITE_STATUS.OUTAGE || siteStatus === SITE_STATUS.LOADING) return;
    openSiteConfigEditor({
      currentConfig: siteConfig,
      catalogLayers,
      onSave: onConfigSaved,
      // Re-fetch the persisted config and re-apply it to the map/layer panel
      // when the editor closes, so the map always reflects whatever ended up
      // saved — regardless of exactly how the admin got there (Spara, X,
      // Avbryt after an earlier save, etc.) — not just the moment Save was
      // clicked while the modal was still open.
      onClose: async () => {
        try {
          const [freshConfig, layerNames] = await Promise.all([loadConfig(), fetchCatalogLayers()]);
          catalogLayers = layerNames;
          setSiteStatus(classifySiteStatus(freshConfig, layerNames));
          onConfigSaved(freshConfig);
        } catch {
          // Keep whatever config is already applied if the re-fetch fails.
        }
      }
    });
  }

  // Any failure to fetch config or catalog means an outage: the plugin's menu
  // is replaced and nothing can be saved until the page is reloaded.
  async function initSiteStatus() {
    let layerNames = [];
    try {
      const [loadedConfig, names] = await withTimeout(
        Promise.all([loadConfig(), fetchCatalogLayers()]),
        SITE_LOAD_TIMEOUT_MS
      );
      siteConfig = loadedConfig;
      layerNames = names;
      catalogLayers = names;
      siteStatus = classifySiteStatus(loadedConfig, names);
    } catch {
      siteConfig = {};
      siteStatus = SITE_STATUS.OUTAGE;
      setWritesLocked(true);
    }
    applyConfigAssets(siteConfig);
    if (layerPanel) layerPanel.updateConfig(siteConfig);
    return layerNames;
  }

  async function registerContentLayers(knownLayerNames) {
    let layerNames = knownLayerNames;
    if (!layerNames) {
      try {
        layerNames = await fetchCatalogLayers();
        catalogLayers = layerNames;
        if (layerPanel) layerPanel.refresh();
      } catch {
        // Keep the layers already registered if the catalog can't be fetched.
        return;
      }
    }
    const contentLayers = layerNames.map(resolveContentLayer);
    const existingNames = new Set(
      getAllLayers(viewer).map(getLayerIdentifier).filter(Boolean)
    );

    contentLayers.forEach(({ name, title, style, styleDef }) => {
      if (existingNames.has(name)) {
        const existing = getAllLayers(viewer).find(layer => getLayerIdentifier(layer) === name);
        if (existing) {
          existing.set('contentLayer', true);
          if (typeof existing.setVisible === 'function') {
            existing.setVisible(false);
          }
        }
        return;
      }

      const layerDef = {
        name,
        title,
        group: 'none',
        queryable: true,
        source: `${getApiBase()}/content-files/${name}.geojson`,
        projection: 'EPSG:3006',
        type: 'GEOJSON',
        visible: false,
        contentLayer: true
      };
      if (styleDef) layerDef.styleDef = styleDef;
      else if (style) layerDef.style = style;
      viewer.addLayer(layerDef);
    });

  }

  function setGeoJsonLayerVisibility(activeLayerName) {
    getAllLayers(viewer).forEach(layer => {
      if (!layer.get('contentLayer')) return;
      if (typeof layer.setVisible !== 'function') return;
      const name = getLayerIdentifier(layer);
      if (!name) return;
      const isActive = name === activeLayerName;
      layer.setVisible(isActive);
      if (isActive) {
        // Origo's own background/overlay layers can end up duplicated in the
        // layers collection (e.g. re-added later by other controls) with no
        // explicit zIndex of their own. Without a zIndex here, render order
        // falls back to insertion order, so a later-added duplicate paints
        // over this content layer and hides it entirely. Force it to the top
        // regardless of where any base layers ended up in the collection.
        if (typeof layer.setZIndex === 'function') layer.setZIndex(1000);
        if (typeof layer.setStyle === 'function') layer.setStyle(styleFunction);
      }
    });
  }

  // Origo's GEOJSON source fetches its file once; after the map editor has
  // saved, clear it so the loader re-fetches and the edits show up.
  function reloadContentLayer(layerName) {
    const layer = getAllLayers(viewer).find(l => l.get('contentLayer') && getLayerIdentifier(l) === layerName);
    const source = layer && typeof layer.getSource === 'function' ? layer.getSource() : null;
    if (source && typeof source.refresh === 'function') source.refresh();
  }

  // Snapshot of every Origo-declared layer's visibility/opacity at startup.
  // Map-view links in the text change which layers are shown; this is what
  // the map is reset to when a submenu is (de)selected or the panels close.
  // Also captures parent layer groups so they're restored alongside children.
  function captureMapLayerBaseline() {
    mapLayerBaseline = new Map();
    getAllLayers(viewer).forEach(layer => {
      const group = layer.get('group');
      const name = layer.get('name');
      if (layer.get('contentLayer') || !name) return;
      const isNamedGroup = group && group !== 'none';
      const isLayerGroup = typeof layer.getLayers === 'function' && !group;
      if (!isNamedGroup && !isLayerGroup) return;
      mapLayerBaseline.set(name, {
        visible: layer.getVisible(),
        opacity: typeof layer.getOpacity === 'function' ? layer.getOpacity() : null
      });
    });
  }

  function restoreDefaultMapLayers() {
    if (!mapLayerBaseline) return;
    const layers = getAllLayers(viewer);
    mapLayerBaseline.forEach(({ visible, opacity }, name) => {
      const layer = layers.find(l => getLayerIdentifier(l) === name);
      if (!layer || typeof layer.setVisible !== 'function') return;
      layer.setVisible(visible);
      if (opacity !== null && typeof layer.setOpacity === 'function') layer.setOpacity(opacity);
    });
  }

  function isEffectivelyVisible(layer) {
    let current = layer;
    while (current) {
      if (typeof current.getVisible === 'function' && !current.getVisible()) return false;
      current = typeof current.getParent === 'function' ? current.getParent() : null;
    }
    return true;
  }

  function getCandidateLinkLayers() {
    return getAllLayers(viewer)
      .filter(l => !l.get('contentLayer') && l.get('name')
        && LINKABLE_LAYER_TYPES.includes(l.get('type'))
        && (l.get('type') !== 'WMS' || l.get('queryable') !== false)
        && l.get('group') && l.get('group') !== 'none'
        && isEffectivelyVisible(l));
  }

  // Asks the layer's data source whether it holds at least one object.
  // WFS layers are probed with a single-feature GetFeature request; file
  // based layers (GeoJSON/TopoJSON) by fetching the file. Unknown types are
  // assumed to have objects.
  async function probeLayerHasObjects(layer) {
    let source = typeof layer.getSource === 'function' ? layer.getSource() : null;
    if (source && typeof source.getSource === 'function') source = source.getSource();
    if (source && typeof source.getFeatures === 'function' && source.getFeatures().length > 0) return true;

    const type = layer.get('type');
    const sourceName = layer.get('sourceName');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      if (type === 'WFS') {
        const sourceDef = (viewer.getMapSource() || {})[sourceName];
        if (!sourceDef || !sourceDef.url) return false;
        const typeName = layer.get('id') || layer.get('name');
        const sep = sourceDef.url.includes('?') ? '&' : '?';
        const url = `${sourceDef.url}${sep}service=WFS&version=1.1.0&request=GetFeature`
          + `&typeName=${encodeURIComponent(typeName)}&maxFeatures=1&outputFormat=application/json`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data.features) && data.features.length > 0;
      }
      if (type === 'GEOJSON' || type === 'TOPOJSON') {
        if (typeof sourceName !== 'string' || !sourceName) return false;
        const res = await fetch(sourceName, { signal: controller.signal });
        if (!res.ok) return false;
        const data = await res.json();
        if (type === 'GEOJSON') return Array.isArray(data.features) && data.features.length > 0;
        return Object.values(data.objects || {}).some(obj => Array.isArray(obj.geometries) && obj.geometries.length > 0);
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // Probe results per layer name, so the check runs once per page load.
  const layerObjectProbes = new Map();
  function layerHasObjects(layer) {
    const name = layer.get('name');
    if (!layerObjectProbes.has(name)) {
      layerObjectProbes.set(name, probeLayerHasObjects(layer));
    }
    return layerObjectProbes.get(name);
  }

  // Origo-config vector layers whose objects text can link to (excluding
  // chrome in group "none", the plugin's own content overlays and layers
  // whose source has no objects to pick).
  async function getLinkableLayers() {
    const candidates = getCandidateLinkLayers();
    const hasObjects = await Promise.all(candidates.map(layerHasObjects));
    return candidates
      .filter((_, i) => hasObjects[i])
      .map(l => ({ name: l.get('name'), title: l.get('title') || l.get('name') }))
      .sort((a, b) => a.title.localeCompare(b.title, 'sv'));
  }

  function clearSelections() {
    const featureinfo = viewer.getFeatureinfo();
    if (featureinfo && typeof featureinfo.clear === 'function') featureinfo.clear();
    const selectionManager = viewer.getSelectionManager();
    if (selectionManager) selectionManager.clearHighlightedFeatures();
    if (featureSync) featureSync.clearLinkHighlight();
  }

  function closeAll() {
    if (layerPanel) { layerPanel.unmount(); layerPanel = null; }
    if (textPanel) { textPanel.unmount(); textPanel = null; }
    updatePluginButtonState();
  }

  // Kartinnehåll-knappen ska vara inaktiv medan ett sidopanel (lagerpanel
  // eller textpanel) är öppet — stängning sker då bara via panelens egen
  // X-knapp, inte genom att klicka knappen igen.
  function updatePluginButtonState() {
    if (!pluginButton || typeof pluginButton.setState !== 'function') return;
    pluginButton.setState((layerPanel || textPanel) ? 'disabled' : 'initial');
  }

  function onLayerSelect({ contentKey, layerName, layer, layerTitle, loadDoc }) {
    if (textPanel) {
      replacingTextPanel = true;
      textPanel.unmount();
      replacingTextPanel = false;
      textPanel = null;
    }

    restoreDefaultMapLayers();
    setGeoJsonLayerVisibility(layerName);

    const resolvedTitle = layerTitle || (layer ? (layer.get('title') || layerName) : layerName);
    textPanel = TextPanel({
      viewer,
      featureSync,
      getLinkableLayers,
      loadDoc,
      getNextItem: () => (layerPanel ? layerPanel.getNextItem() : null),
      // Goes through the layer panel, exactly like clicking the next submenu.
      onNext: () => { if (layerPanel) layerPanel.selectNext(); },
      onEditorClose: async (editedLayerName) => {
        await registerContentLayers();
        reloadContentLayer(editedLayerName);
        setGeoJsonLayerVisibility(editedLayerName);
      },
      onClose: () => {
        setGeoJsonLayerVisibility(null);
        restoreDefaultMapLayers();
        clearSelections();
        if (layerPanel && !replacingTextPanel) layerPanel.deactivate();
        textPanel = null;
        updatePluginButtonState();
      }
    });

    textPanel.mount(contentKey, resolvedTitle);
    updatePluginButtonState();
  }

  return Origo.ui.Component({
    name: 'mapstories',
    onInit() {
      pluginButton = Origo.ui.Button({
        // The second class is the legacy name (src/compat.js).
        cls: `o-mapstories ${LEGACY_DOM.buttonClass} light box-shadow`,
        click() {
          // Inaktiv medan ett sidopanel redan är öppet — stäng via panelens
          // egen X-knapp istället för att klicka Kartinnehåll igen.
          if (layerPanel || textPanel) return;
          layerPanel = LayerPanel({
            viewer,
            siteConfig,
            getSiteStatus: () => siteStatus,
            getCatalogLayers: () => catalogLayers,
            onLayerSelect,
            onConfigEdit: openConfigEditor,
            // Switching/closing the submenu while its text has unsaved edits
            // asks first.
            canLeaveSelection: () => !textPanel || textPanel.confirmDiscard(),
            onClose: () => {
              setGeoJsonLayerVisibility(null);
              restoreDefaultMapLayers();
              clearSelections();
              if (textPanel) { textPanel.unmount(); textPanel = null; }
              layerPanel = null;
              updatePluginButtonState();
            },
            onDeactivate: () => {
              setGeoJsonLayerVisibility(null);
              restoreDefaultMapLayers();
              clearSelections();
              if (textPanel) { textPanel.unmount(); textPanel = null; }
              updatePluginButtonState();
            }
          });
          layerPanel.mount();
          updatePluginButtonState();
        },
        // The id and the second class are the legacy names (src/compat.js).
        text: `<img src="${escapeAttr(config.assets.buttonIcon)}" alt="${escapeAttr(buttonText)}"`
          + ` class="o-mapstories-button-icon ${LEGACY_DOM.buttonIconClass}" id="${LEGACY_DOM.buttonIconId}"`
          + ' data-oms="button-icon">',
        tooltipText: buttonText,
        tooltipPlacement: 'east'
      });
    },
    onAdd(evt) {
      viewer = evt.target;
      captureMapLayerBaseline();
      featureSync = FeatureSync({ viewer });

      const detectedTarget = resolveMountTarget(viewer);
      if (detectedTarget) target = detectedTarget;
      this.addComponents([pluginButton]);
      this.render();
      initSiteStatus().then(layerNames => {
        // Logging in goes through the content server, so not during an outage.
        if (siteStatus !== SITE_STATUS.OUTAGE && isAdminRequested() && !hasValidToken()) {
          openAdminLoginModal({ onSuccess: refreshAdminUi });
        }
        mountCornerLogo(siteConfig);
        if (siteStatus !== SITE_STATUS.OUTAGE) registerContentLayers(layerNames);
      });
      // Only admins link text to map objects; warm the layer probes so the
      // "Koppla till karta" dialog opens without waiting.
      if (isAdminRequested()) getLinkableLayers();
    },
    render() {
      const targetEl = target && (target.startsWith('#') || target.startsWith('.'))
        ? document.querySelector(target)
        : document.getElementById(target);
      if (!targetEl) return;

      // Guard against duplicate renders if Origo triggers render again.
      if (!targetEl.querySelector('.o-mapstories')) {
        const el = Origo.ui.dom.html(pluginButton.render());
        targetEl.appendChild(el);
      }

      this.dispatch('render');
    }
  });
};

installLegacyGlobals(OrigoMapStories, BUILD_MARKER);

export default OrigoMapStories;
