// Legacy StructureMapHelper names, kept so existing installations work
// unchanged after the rename to Origo Map Stories. Every old name the plugin
// still answers to is collected here.

// The global the host page registers the control with, e.g.
//   Origo('index.json', { controls: { structuremaphelper: StructureMapHelper } })
export const LEGACY_GLOBAL = 'StructureMapHelper';
// Build marker global (the deployed git SHA), read by deploy checks.
export const LEGACY_BUILD_GLOBAL = 'StructureMapHelperBuild';

// Exposes the plugin and its build marker under the legacy global names. The
// legacy global is only set when the page has not defined it itself.
export function installLegacyGlobals(plugin, buildMarker) {
  if (typeof window === 'undefined') return;
  if (typeof window[LEGACY_GLOBAL] === 'undefined') {
    window[LEGACY_GLOBAL] = plugin;
  }
  window[LEGACY_BUILD_GLOBAL] = buildMarker;
}

// Legacy global holding the content API base URL, set by older host pages:
//   window.STRUCTURE_MAP_HELPER_API_BASE = "https://example.org/api-host";
export const LEGACY_API_BASE_GLOBAL = 'STRUCTURE_MAP_HELPER_API_BASE';

export function getLegacyApiBase() {
  if (typeof window === 'undefined') return '';
  const value = window[LEGACY_API_BASE_GLOBAL];
  return value ? String(value) : '';
}

// Legacy DOM names. Host stylesheets written for StructureMapHelper target
// these, so the plugin still puts them on its elements next to the new
// o-mapstories-* names.
export const LEGACY_DOM = {
  buttonClass: 'o-structuremaphelper',
  buttonIconId: 'o-btn-rvn-logo-img',
  buttonIconClass: 'o-btn-rvn-logo',
  cornerLogoId: 'o-rvn-logo-corner',
  cornerLogoClass: 'o-rvn-logo-corner'
};
