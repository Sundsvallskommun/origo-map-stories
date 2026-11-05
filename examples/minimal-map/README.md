# Minimal map

The smallest Origo map with Origo Map Stories: an OpenStreetMap background in
Web Mercator, centred on Sweden, and the plugin registered as `mapstories`.
`npm run setup` copies these files into `../origo` for local development;
installations can use them as a starting point for their own map page.

| File | Purpose |
|---|---|
| `index.html` | Loads Origo, the plugin stylesheet and script, and registers the control as `mapstories`. Contains a commented example Content-Security-Policy. |
| `index.json` | Origo map configuration (EPSG:3857, OSM). The `mapstories` control entry is where plugin options go. |
| `editor-config.json` | Background and start view of the map editor (`editor.html`), in EPSG:3006. |

## File names

In local development the watchers write `plugins/origo-map-stories.js` and
`.css` into `../origo`, which is what `index.html` loads. A release contains
the minified files `origo-map-stories.min.js` and `.min.css`; when you use
this page with a release, change the two references in `index.html` (or copy
the files under the names the page loads).

## Layout on the web server

```
index.html, index.json
editor.html, editor.js, editor-config.json
js/, css/, ...                  the Origo build
plugins/
  origo-map-stories.min.js
  origo-map-stories.min.css
  gor-sa-har.json
  img/                          neutral fallback images
```

The content API answers `/api/*` and `/content-files/*` in the same folder as
`index.html`. Under a path prefix (for example `/maps/stories/`) the plugin
uses the page's folder automatically. See
[docs/deployment.md](../../docs/deployment.md).

## Plugin options

Set in `index.json`, on the `mapstories` control. All options are optional:

```json
{
  "name": "mapstories",
  "options": {
    "buttonText": "Map content",
    "apiBase": "https://maps.example.org/maps/stories",
    "helpUrl": "https://www.example.org/maps/help",
    "cornerLogoAlt": "Example organisation",
    "assets": { "buttonIcon": "theme/img/button-icon.png", "cornerLogo": "theme/img/corner-logo.png" },
    "contentLayers": [{ "name": "Example_layer", "title": "Example layer" }],
    "defaultMenus": []
  }
}
```

Images uploaded in the site configuration take precedence over `assets`. All
options are described in [docs/configuration.md](../../docs/configuration.md).

## editor-config.json

```json
{
  "background": { "type": "wms", "url": "https://maps.example.org/wms", "layers": "topography",
                  "tileGrid": { "resolutions": [280, 140, 70], "extent": [461400, 6803000, 773960, 7110000] } },
  "center": [600000, 6900000],
  "zoom": 1
}
```

`background.type` is `osm` (default), `wms` or `none`. Coordinates are
EPSG:3006 (SWEREF 99 TM), the data CRS of all content layers. Without the
file the editor shows OpenStreetMap over Sweden. See
[docs/configuration.md](../../docs/configuration.md#map-editor-editor-configjson).
