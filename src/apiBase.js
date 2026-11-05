import { getOptions } from './config';
import { getLegacyApiBase } from './compat';

function trimTrailingSlash(value) {
  return String(value).trim().replace(/\/+$/, '');
}

// "/maps/stories" or "https://example.org/maps/stories" → absolute URL;
// "/" → the origin root.
function toAbsolute(pathOrUrl) {
  const value = trimTrailingSlash(pathOrUrl);
  if (/^https?:\/\//i.test(value)) return value;
  if (!value) return window.location.origin;
  return `${window.location.origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

// The folder of the current page. A last path segment without a dot is
// taken as a folder, one with a dot as a file:
//   /maps/stories, /maps/stories/, /maps/stories/index.html → <origin>/maps/stories
//   /, /index.html                                         → <origin>
function getPageDirectory() {
  const { origin, pathname } = window.location;
  const segments = pathname.split('/');
  if (segments[segments.length - 1].includes('.')) segments.pop();
  return `${origin}${trimTrailingSlash(segments.join('/'))}`;
}

// Where the app's own files (editor.html) live: the basePath option, or the
// page's folder.
function getApplicationBase() {
  const { basePath } = getOptions();
  return basePath ? toAbsolute(basePath) : getPageDirectory();
}

// The content API base set explicitly by the host page (option or global),
// or '' when it is derived from the page's location.
function getExplicitApiBase() {
  const { apiBase } = getOptions();
  const explicit = apiBase
    || (window.ORIGO_MAP_STORIES_API_BASE ? String(window.ORIGO_MAP_STORIES_API_BASE) : '')
    || getLegacyApiBase();
  return explicit ? toAbsolute(explicit) : '';
}

// The content API base, in order: the apiBase (or contentServerUrl) option,
// window.ORIGO_MAP_STORIES_API_BASE, the legacy global, the basePath option,
// and last the page's folder.
function getApiBase() {
  return getExplicitApiBase() || getApplicationBase();
}

export { getApiBase, getApplicationBase, getExplicitApiBase, getPageDirectory };
