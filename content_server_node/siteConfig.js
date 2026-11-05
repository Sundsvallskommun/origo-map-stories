// Site configuration rules shared by the server: layer naming, file paths
// inside a version, and how a saved config is normalised (new submenus get a
// layer, removed submenus' files are left out of the new version).
//
// Functions that touch version content take a commitVersion ctx
// ({ manifest, has, readText, readJson }) and a `changes` object to fill.

function safeLayerName(raw) {
  // Strip only path-traversal and filesystem-unsafe chars; keep åäö etc.
  return raw.replace(/[/\\:*?"<>|.]/g, '_');
}

const SITE_CONFIG = 'site-config.json';
const textPath = name => `layers/${name}/text.json`;
const overlayPath = name => `layers/${name}/overlay.geojson`;

// Every submenu item owns one GeoJSON overlay and one text document under
// layers/<layerName>/. On save the server assigns a layerName to new items,
// creates their empty overlay, and leaves removed items' files out of the new
// version (older versions still have them).

function emptyGeoJson(name) {
  return {
    type: 'FeatureCollection',
    features: [],
    name,
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } }
  };
}

function configLayerNames(config) {
  const names = new Set();
  ((config && config.menus) || []).forEach(menu => {
    (menu.items || []).forEach(item => {
      if (item.layerName) names.add(item.layerName);
    });
  });
  return names;
}

// Strips the retired submenu types and gives every item its own layerName.
// Legacy "maplayers" items stored their text under maplayers__<menu>__<item>;
// that text is copied to the new layerName so it is not lost.
async function normalizeSiteConfig(config, ctx, changes) {
  const normalized = { ...(config || {}) };
  normalized.menus = [];
  for (const menu of (config && config.menus) || []) {
    const items = [];
    for (const item of menu.items || []) {
      const { type, mapLayers, ...rest } = item;
      const next = { ...rest };
      if (!next.layerName) {
        next.layerName = safeLayerName(`undermeny_${next.id}`);
        if (type === 'maplayers') {
          const legacyText = await ctx.readText(textPath(safeLayerName(`maplayers__${menu.id}__${next.id}`)));
          if (legacyText != null && !ctx.has(textPath(next.layerName))) {
            changes[textPath(next.layerName)] = legacyText;
          }
        }
      }
      items.push(next);
    }
    normalized.menus.push({ ...menu, items });
  }
  return normalized;
}

function ensureLayerFiles(config, ctx, changes) {
  configLayerNames(config).forEach(name => {
    const p = overlayPath(safeLayerName(name));
    if (!ctx.has(p) && !changes[p]) changes[p] = emptyGeoJson(name);
  });
}

function dropRemovedLayers(oldConfig, newConfig, ctx, changes) {
  const keep = configLayerNames(newConfig);
  configLayerNames(oldConfig).forEach(name => {
    if (keep.has(name)) return;
    const prefix = `layers/${safeLayerName(name)}/`;
    [...ctx.manifest.keys()].filter(p => p.startsWith(prefix)).forEach(p => { changes[p] = null; });
  });
}

// "Länstransportplan › Geodata" for a layerName, or the layerName itself.
async function describeLayer(ctx, layerName) {
  const config = await ctx.readJson(SITE_CONFIG);
  for (const menu of (config && config.menus) || []) {
    const item = (menu.items || []).find(it => it.layerName === layerName);
    if (item) return [menu.label, item.label].filter(Boolean).join(' › ') || layerName;
  }
  return layerName;
}

module.exports = {
  SITE_CONFIG,
  safeLayerName,
  textPath,
  overlayPath,
  emptyGeoJson,
  configLayerNames,
  normalizeSiteConfig,
  ensureLayerFiles,
  dropRemovedLayers,
  describeLayer
};
