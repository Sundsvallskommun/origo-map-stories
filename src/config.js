// Plugin options. The host page passes them where it registers the control,
// either in index.json ("options" of the control) or in the Origo call:
//
//   Origo('index.json', { controls: { mapstories: OrigoMapStories } })
//
// Every option is optional; the defaults give a neutral map that talks to a
// content API in the same folder as the map page.

const DEFAULT_HELP_URL = 'https://github.com/Sundsvallskommun/origo-map-stories#readme';
const DEFAULT_BUTTON_TEXT = 'Kartinnehåll';
// Label of the menu generated from the catalog when no menus are configured.
const GENERATED_MENU_LABEL = 'Innehåll';

// The plugin script's own URL. document.currentScript is only set while the
// classic plugin script runs, so it is captured when the bundle is evaluated.
const pluginScriptUrl = typeof document !== 'undefined' && document.currentScript
  ? document.currentScript.src
  : '';

// A file shipped next to the plugin script (e.g. plugins/img/button-icon.png),
// so the plugin finds its own files whatever folder it is installed in.
function pluginFileUrl(relativePath) {
  return new URL(relativePath, pluginScriptUrl || document.baseURI).href;
}

function trimTrailingSlash(value) {
  return String(value).trim().replace(/\/+$/, '');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveOptions(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const assets = input.assets && typeof input.assets === 'object' ? input.assets : {};
  const apiBase = nonEmptyString(input.apiBase) || nonEmptyString(input.contentServerUrl);
  const basePath = nonEmptyString(input.basePath);
  return {
    // "/" is the origin root: keep it, since trimming would leave '' (unset).
    apiBase: apiBase ? trimTrailingSlash(apiBase) || '/' : '',
    basePath: basePath ? trimTrailingSlash(basePath) || '/' : '',
    editorUrl: nonEmptyString(input.editorUrl),
    assets: {
      buttonIcon: nonEmptyString(assets.buttonIcon) || pluginFileUrl('img/button-icon.png'),
      cornerLogo: nonEmptyString(assets.cornerLogo) || pluginFileUrl('img/corner-logo.png'),
      // null: the stylesheet's --oms-header-image applies.
      headerImage: nonEmptyString(assets.headerImage) || null
    },
    // null: the corner logo's alt text follows the header text ("Rubriktext").
    cornerLogoAlt: typeof input.cornerLogoAlt === 'string' ? input.cornerLogoAlt : null,
    contentLayers: Array.isArray(input.contentLayers) ? input.contentLayers.filter(l => l && l.name) : [],
    defaultMenus: Array.isArray(input.defaultMenus) ? input.defaultMenus : [],
    helpUrl: nonEmptyString(input.helpUrl) || DEFAULT_HELP_URL,
    buttonText: nonEmptyString(input.buttonText) || DEFAULT_BUTTON_TEXT
  };
}

let current = resolveOptions({});

// Called once when the plugin is created; returns the resolved options.
function configure(rawOptions) {
  current = resolveOptions(rawOptions);
  return current;
}

function getOptions() {
  return current;
}

// "Sammanlagd_Strukturbild" → "Sammanlagd Strukturbild"
function buildDefaultTitle(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A catalog layer with the title and style given in the contentLayers option.
function resolveContentLayer(name) {
  const known = current.contentLayers.find(layer => layer.name === name) || {};
  return {
    ...known,
    name,
    title: known.title || buildDefaultTitle(name)
  };
}

// Menus used when the site config has none: the defaultMenus option, or else
// one menu listing every catalog layer, so that no layer is unreachable.
function getFallbackMenus(catalogLayerNames) {
  if (current.defaultMenus.length > 0) return current.defaultMenus;
  const names = Array.isArray(catalogLayerNames) ? catalogLayerNames : [];
  if (names.length === 0) return [];
  return [{
    id: 'innehall',
    label: GENERATED_MENU_LABEL,
    items: names.map(name => ({ id: name, label: resolveContentLayer(name).title, layerName: name }))
  }];
}

export {
  DEFAULT_HELP_URL,
  DEFAULT_BUTTON_TEXT,
  configure,
  getOptions,
  pluginFileUrl,
  buildDefaultTitle,
  resolveContentLayer,
  getFallbackMenus
};
