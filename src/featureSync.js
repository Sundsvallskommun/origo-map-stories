import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { getCenter, getHeight, getWidth } from 'ol/extent';
import { getAllLayers, setLayerVisibleWithParents } from './layerUtils';
import { linkHighlightStyleFunction } from './olStyleBuilder';

// Zoom to a linked object. Limits are resolutions (map units per pixel, i.e.
// metres in the projected CRSs used here), because installations use different
// projections and zoom levels.
const POINT_ZOOM_RESOLUTION = 2;
const FIT_MIN_RESOLUTION = 0.5;
const FIT_PADDING_PX = 100;
const ZOOM_DURATION_MS = 400;

function FeatureSync({ viewer }) {
  let textPanelEl = null;
  let pickMode = false;
  let pickCallback = null;
  let mapClickHandler = null;
  let trackingHandler = null;
  let highlightLayer = null;
  // Bumped whenever a focus is started or cancelled; async focus work (WFS
  // fetch, waiting for features to load) applies only if it is still current.
  let focusGeneration = 0;
  let pendingFocusCleanup = null;
  // The DOM event of the latest click handled by pick mode. Its singleclick
  // arrives later, possibly after the pick has ended.
  let pickClickEvent = null;

  function cancelPendingFocus() {
    focusGeneration += 1;
    if (pendingFocusCleanup) {
      pendingFocusCleanup();
      pendingFocusCleanup = null;
    }
  }

  // Draws a copy of the linked object's geometry on a layer of our own above
  // everything else, so the highlight survives the source layer reloading
  // its features (WFS bbox loading) and works for any vector layer type.
  function highlightLinkedFeature(feature) {
    const geom = feature && typeof feature.getGeometry === 'function' ? feature.getGeometry() : null;
    if (!geom) return;
    if (!highlightLayer) {
      // Origo's layer control lists it; without a title it reads "Titel saknas".
      highlightLayer = new VectorLayer({
        title: 'Selekterat objekt',
        source: new VectorSource(),
        style: linkHighlightStyleFunction,
        zIndex: 10000
      });
      viewer.getMap().addLayer(highlightLayer);
    }
    const source = highlightLayer.getSource();
    source.clear();
    source.addFeature(new Feature(geom.clone()));
  }

  function clearActiveTextLinks(exceptEl) {
    if (!textPanelEl) return;
    textPanelEl.querySelectorAll('.o-map-link.o-map-link--active').forEach(el => {
      if (el !== exceptEl) el.classList.remove('o-map-link--active');
    });
  }

  // Clears the selection in both the map and the text.
  function clearLinkHighlight() {
    cancelPendingFocus();
    if (highlightLayer) highlightLayer.getSource().clear();
    clearActiveTextLinks();
  }

  function resolveFeatureIdentifier(featureOrId) {
    if (featureOrId === undefined || featureOrId === null) return null;
    if (typeof featureOrId === 'string' || typeof featureOrId === 'number') {
      return String(featureOrId);
    }

    const feature = featureOrId;
    if (typeof feature.getId === 'function') {
      const id = feature.getId();
      if (id !== undefined && id !== null && id !== '') return String(id);
    }

    if (typeof feature.get === 'function') {
      const candidates = ['fid', 'id', 'ID', 'TextKoppling', 'textkoppling', 'OBJECTID'];
      for (let i = 0; i < candidates.length; i += 1) {
        const value = feature.get(candidates[i]);
        if (value !== undefined && value !== null && value !== '') {
          return String(value);
        }
      }
    }

    return null;
  }

  function setTextPanel(el) {
    textPanelEl = el;
  }

  function findLinkSpan(featureId, layerName) {
    if (!textPanelEl) return null;
    const spans = textPanelEl.querySelectorAll('.o-map-link[data-feature-id]');
    return Array.from(spans).find(span =>
      span.getAttribute('data-feature-id') === featureId
      && (!layerName || span.getAttribute('data-layer-name') === layerName)) || null;
  }

  // Map → Text: highlight the text span matching the selected feature
  function onFeatureSelected(featureOrId, layerName) {
    const featureId = resolveFeatureIdentifier(featureOrId);
    if (!textPanelEl || !featureId) return false;
    const target = findLinkSpan(featureId, layerName);
    if (!target) return false;
    clearActiveTextLinks();
    target.classList.add('o-map-link--active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  // Text → Map: zoom to feature or restore map view for a link span (or an
  // element inside one). Returns false when the element is not a map link.
  function activateLinkSpan(target) {
    const featureSpan = target.closest('.o-map-link');
    if (featureSpan) {
      clearActiveTextLinks(featureSpan);
      const featureId = featureSpan.getAttribute('data-feature-id');
      const layerName = featureSpan.getAttribute('data-layer-name');
      const extentRaw = featureSpan.getAttribute('data-extent');
      const extent = extentRaw ? extentRaw.split(',').map(Number) : null;
      if (featureId && layerName) focusFeatureOnMap(featureId, layerName, extent);
      return true;
    }

    const viewSpan = target.closest('.o-map-view-link');
    if (viewSpan) {
      clearActiveTextLinks();
      const mapState = viewSpan.getAttribute('data-map-state');
      const centerRaw = viewSpan.getAttribute('data-center');
      const zoomRaw = viewSpan.getAttribute('data-zoom');
      focusMapView({
        mapState,
        center: centerRaw ? centerRaw.split(',').map(Number) : null,
        zoom: zoomRaw ? Number(zoomRaw) : null
      });
      return true;
    }
    return false;
  }

  function attachTextClickHandlers(el) {
    el.addEventListener('click', e => activateLinkSpan(e.target));
  }

  // Origo-declared layers a map-view link controls: everything with a real
  // group, excluding chrome ("none") and the plugin's own content overlays.
  function isStateControlledLayer(layer) {
    if (!layer || typeof layer.setVisible !== 'function') return false;
    if (layer.get('contentLayer')) return false;
    if (!layer.get('name')) return false;
    const group = layer.get('group');
    return Boolean(group) && group !== 'none';
  }

  // Text → Map: restore a saved map view. A link carrying an Origo permalink
  // state restores visible layers (and their opacity) plus center/zoom; older
  // links only carry center/zoom.
  function focusMapView({ mapState, center, zoom }) {
    cancelPendingFocus();
    let targetCenter = center;
    let targetZoom = zoom;

    if (mapState && viewer.permalink && typeof viewer.permalink.parsePermalink === 'function') {
      const state = viewer.permalink.parsePermalink(mapState);
      const stateLayers = state.layers || {};
      getAllLayers(viewer).filter(isStateControlledLayer).forEach(layer => {
        const saved = stateLayers[layer.get('name')];
        if (saved && saved.visible) {
          setLayerVisibleWithParents(layer, true);
          if (Number.isFinite(saved.opacity) && typeof layer.setOpacity === 'function') {
            layer.setOpacity(saved.opacity);
          }
        } else {
          layer.setVisible(false);
        }
      });
      if (Array.isArray(state.center)) targetCenter = state.center;
      if (Number.isFinite(state.zoom)) targetZoom = state.zoom;
    }

    if (!Array.isArray(targetCenter) || targetCenter.length !== 2 || !Number.isFinite(targetZoom)) return;
    viewer.getMap().getView().animate({ center: targetCenter, zoom: targetZoom, duration: 400 });
  }

  function findFeature(source, featureId) {
    let feature = source.getFeatureById(featureId);
    if (!feature && typeof source.getFeatures === 'function') {
      feature = source.getFeatures().find(item => resolveFeatureIdentifier(item) === String(featureId));
    }
    return feature || null;
  }

  // The single zoom for linked objects, so the result does not depend on
  // whether the geometry or only the stored extent is at hand. A point has a
  // zero-size extent, both from its geometry and as stored in the link.
  function zoomToLinkedExtent(extent) {
    const view = viewer.getMap().getView();
    if (getWidth(extent) === 0 && getHeight(extent) === 0) {
      view.animate({ center: getCenter(extent), resolution: POINT_ZOOM_RESOLUTION, duration: ZOOM_DURATION_MS });
      return;
    }
    view.fit(extent, {
      duration: ZOOM_DURATION_MS,
      minResolution: FIT_MIN_RESOLUTION,
      padding: [FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX]
    });
  }

  function highlightAndZoom(feature) {
    highlightLinkedFeature(feature);
    const geom = feature.getGeometry();
    if (geom) zoomToLinkedExtent(geom.getExtent());
  }

  // Text → Map: show the feature's layer, zoom to the feature and highlight
  // it. Bbox-loaded sources (WFS) may not hold the feature until the map has
  // moved there, so zoom to the stored extent first and retry once loaded.
  // Without an extent (e.g. a just-shown overlay), wait for the load and
  // zoom then. A newer focus or a cleared highlight drops the pending work.
  function focusFeatureOnMap(featureId, layerName, extent) {
    cancelPendingFocus();
    const generation = focusGeneration;
    const isCurrent = () => generation === focusGeneration;
    const hasExtent = Array.isArray(extent) && extent.length === 4;
    const layer = viewer.getLayer(layerName);
    if (!layer) return;
    setLayerVisibleWithParents(layer, true);
    if (layer.get('type') === 'WMS') {
      fetchWfsFeature(layer, featureId).then(feature => {
        if (!isCurrent()) return;
        if (feature) highlightAndZoom(feature);
        else if (hasExtent) zoomToLinkedExtent(extent);
      }).catch(() => {});
      return;
    }
    const source = layer.getSource();
    if (!source) return;

    const feature = findFeature(source, featureId);
    if (feature) {
      highlightAndZoom(feature);
      return;
    }

    let timer = null;
    let onLoaded = null;
    const cleanup = () => {
      source.un('featuresloadend', onLoaded);
      clearTimeout(timer);
      if (pendingFocusCleanup === cleanup) pendingFocusCleanup = null;
    };
    onLoaded = () => {
      const loaded = findFeature(source, featureId);
      if (!loaded) return;
      cleanup();
      if (hasExtent) highlightLinkedFeature(loaded);
      else highlightAndZoom(loaded);
    };
    source.on('featuresloadend', onLoaded);
    timer = setTimeout(cleanup, 15000);
    pendingFocusCleanup = cleanup;
    if (hasExtent) zoomToLinkedExtent(extent);
  }

  // Always-on map click listener: maps clicks → text highlight. Matches the
  // clicked feature against every feature link in the text, whatever layer
  // it points at (the submenu's own overlay or an Origo vector layer). A
  // click that matches no link clears the selection.
  function startMapFeatureTracking() {
    stopMapFeatureTracking();
    const map = viewer.getMap();
    trackingHandler = evt => {
      if (pickMode) return;
      const hit = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        if (!layer) return undefined;
        const featureId = resolveFeatureIdentifier(feature);
        if (featureId && onFeatureSelected(featureId, layer.get('name'))) {
          highlightLinkedFeature(feature);
          return true;
        }
        return undefined;
      }, { hitTolerance: 5 });
      // The click that completed a pick must not clear what it just highlighted
      // (a picked WMS object has no feature on the map to hit).
      if (!hit && evt.originalEvent !== pickClickEvent) clearLinkHighlight();
    };
    map.on('singleclick', trackingHandler);
  }

  function stopMapFeatureTracking() {
    if (trackingHandler) {
      viewer.getMap().un('singleclick', trackingHandler);
      trackingHandler = null;
    }
  }

  // Origo's featureinfo listens to every map click and drops a pin when it
  // finds nothing queryable; switch it off while picking, the same way
  // Origo's own draw/measure tools do.
  function setFeatureInfoSuspended(suspended) {
    if (typeof viewer.dispatch !== 'function') return;
    viewer.dispatch('toggleClickInteraction', { name: 'mapstories-pick', active: suspended });
  }

  // WMS layers have no client-side features. Pick: GetFeatureInfo gives the
  // object's id, then a WFS GetFeature by that id gives its geometry. Focus
  // reuses the WFS lookup.
  function getWfsUrl(layer) {
    const sourceName = layer.get('sourceName');
    const sourceDef = (viewer.getMapSource() || {})[sourceName];
    if (!sourceDef || !sourceDef.url) return null;
    return sourceDef.url.replace(/\/wms(?=\?|$)/i, '/wfs');
  }

  async function fetchWfsFeature(layer, featureId) {
    const wfsUrl = getWfsUrl(layer);
    if (!wfsUrl) return null;
    const projection = viewer.getProjection().getCode();
    const sep = wfsUrl.includes('?') ? '&' : '?';
    const url = `${wfsUrl}${sep}service=WFS&version=1.1.0&request=GetFeature`
      + `&featureID=${encodeURIComponent(featureId)}&srsName=${encodeURIComponent(projection)}`
      + '&outputFormat=application/json';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const features = new GeoJSON().readFeatures(data, { dataProjection: projection, featureProjection: projection });
    return features[0] || null;
  }

  async function pickWmsFeature(layer, evt) {
    const view = viewer.getMap().getView();
    const projection = view.getProjection();
    const url = layer.getSource().getFeatureInfoUrl(evt.coordinate, view.getResolution(), projection, {
      INFO_FORMAT: 'application/json',
      FEATURE_COUNT: 1
    });
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data && Array.isArray(data.features) ? data.features[0] : null;
    if (!hit || !hit.id) return null;
    const feature = await fetchWfsFeature(layer, hit.id);
    return feature ? { featureId: String(hit.id), feature } : null;
  }

  // Enter "pick a feature" mode: next click on a feature in `layerName`
  // captures its id, layer name and extent. A click that hits nothing
  // calls `onMiss` and stays in pick mode.
  function enterPickMode(callback, { layerName, onMiss } = {}) {
    if (mapClickHandler) {
      exitPickMode();
    }

    pickMode = true;
    pickCallback = callback;
    const map = viewer.getMap();
    const container = map.getTargetElement();
    container.style.cursor = 'crosshair';
    setFeatureInfoSuspended(true);

    const targetLayer = layerName ? viewer.getLayer(layerName) : null;
    const isWms = Boolean(targetLayer) && targetLayer.get('type') === 'WMS';

    mapClickHandler = evt => {
      if (!pickMode) return;
      pickClickEvent = evt.originalEvent;
      if (isWms) {
        pickWmsFeature(targetLayer, evt).then(result => {
          if (!pickMode) return;
          if (!result) {
            if (typeof onMiss === 'function') onMiss();
            return;
          }
          const geom = result.feature.getGeometry();
          const extent = geom ? geom.getExtent().map(coord => Math.round(coord)) : null;
          const cb = pickCallback;
          exitPickMode();
          highlightLinkedFeature(result.feature);
          cb(result.featureId, layerName, extent);
        }).catch(() => {
          if (typeof onMiss === 'function') onMiss();
        });
        return;
      }
      const hit = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        const featureId = resolveFeatureIdentifier(feature);
        const pickedLayerName = layer.get('name');
        if (featureId && pickedLayerName) {
          const geom = feature.getGeometry();
          const extent = geom ? geom.getExtent().map(coord => Math.round(coord)) : null;
          const cb = pickCallback;
          exitPickMode();
          highlightLinkedFeature(feature);
          cb(featureId, pickedLayerName, extent);
          return true;
        }
        return undefined;
      }, {
        hitTolerance: 5,
        layerFilter: layer => Boolean(layer) && (!layerName || layer.get('name') === layerName)
      });
      if (!hit && typeof onMiss === 'function') onMiss();
    };
    map.on('click', mapClickHandler);
  }

  function exitPickMode() {
    const wasPicking = pickMode;
    pickMode = false;
    pickCallback = null;
    const map = viewer.getMap();
    map.getTargetElement().style.cursor = '';
    if (mapClickHandler) {
      map.un('click', mapClickHandler);
      mapClickHandler = null;
    }
    if (wasPicking) setFeatureInfoSuspended(false);
  }

  return {
    setTextPanel,
    onFeatureSelected,
    attachTextClickHandlers,
    activateLinkSpan,
    startMapFeatureTracking,
    stopMapFeatureTracking,
    enterPickMode,
    exitPickMode,
    focusFeatureOnMap,
    focusMapView,
    clearLinkHighlight,
    resolveFeatureIdentifier
  };
}

export default FeatureSync;
