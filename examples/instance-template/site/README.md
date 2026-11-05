# Site

The map page of this installation: the Origo `index.html` and `index.json`
that load and configure Origo Map Stories.

Choose one of the two cases and delete the other.

## This installation owns the map page

Keep `index.html` and `index.json` here and deploy them with the plugin.
Start from `examples/minimal-map/` in the release zip:

- `index.html` loads `plugins/origo-map-stories.min.css`, then the theme
  stylesheet (`theme/theme.css`), then `js/origo.js` and
  `plugins/origo-map-stories.min.js`, and registers the control:
  `Origo('index.json', { controls: { mapstories: OrigoMapStories } })`.
- `index.json` has the `mapstories` control with the plugin options (see
  `docs/configuration.md` in the product repository), the background map and
  the layers that text can link to.
- Add a Content-Security-Policy that allows the editor iframe
  (`frame-src 'self'`), the API (`connect-src`) and the tile hosts
  (`img-src`).

## Someone else owns the map page

The plugin is added to an Origo site that another team maintains. Do not keep
copies of their files here; record instead:

- who owns `index.html` and `index.json`, and how changes are requested;
- how the page loads the plugin (file names, control key, any
  `window.ORIGO_MAP_STORIES_API_BASE`), as snippets
  (`index.html.snippet`, `index.json.snippet`);
- the CSP the page needs (`frame-src 'self'`, `connect-src`, `img-src`).
