# Configuration

Origo Map Stories is configured in four places:

| Where | What | Who changes it |
|---|---|---|
| Plugin options in the Origo `index.json` | API location, fallback images, help link, button text, default menus | The installation (deploy time) |
| `editor-config.json` next to `editor.html` | Background map and start view of the map editor | The installation (deploy time) |
| Site configuration (stored in the database) | Header text, menus, uploaded images | Administrators, in the browser |
| Instance stylesheet | Colours, font, header image, layout tweaks | The installation (deploy time) |

The content API is configured with environment variables (see
[Server environment variables](#server-environment-variables)).

## Registering the plugin

The host page loads Origo, then the plugin script and stylesheet, and registers
the plugin as an Origo control. The recommended control key is `mapstories`:

```html
<link href="css/style.css" rel="stylesheet">
<link href="plugins/origo-map-stories.min.css" rel="stylesheet">
<!-- instance theme, after the plugin stylesheet -->
<link href="theme/theme.css" rel="stylesheet">
...
<script src="js/origo.js"></script>
<script src="plugins/origo-map-stories.min.js"></script>
<script>
  var origo = Origo('index.json', {
    controls: { mapstories: OrigoMapStories }
  });
</script>
```

The plugin options are given on the control in `index.json`:

```json
{
  "controls": [
    { "name": "home" },
    {
      "name": "mapstories",
      "options": {
        "buttonText": "Map content"
      }
    }
  ]
}
```

The host page chooses the control key; the `name` in `index.json` must match
it. The control key and global of the product's previous name still work
(see the [upgrade guide](upgrading-from-structuremaphelper.md)).
A complete example is in [`examples/minimal-map/`](../examples/minimal-map/).

## Plugin options

Every option is optional. Without any options the plugin shows neutral images
and talks to a content API in the same folder as the map page.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiBase` | string | derived, see [API base](#api-base-resolution) | Base URL of the content API, without `/api`. Absolute (`https://maps.example.org/stories`) or root-relative (`/stories`); `"/"` is the origin root. |
| `contentServerUrl` | string | | Alias of `apiBase`, kept for older configurations. `apiBase` wins if both are set. |
| `basePath` | string | the page's folder | Where the application's own files (`editor.html`) are served, for example `/maps/stories`. Also used as API base when no explicit API base is set. |
| `editorUrl` | string | `<basePath or page folder>/editor.html` | URL of the map editor page, if it is not next to the map page. |
| `assets.buttonIcon` | string | `img/button-icon.png` next to the plugin script | Image in the plugin's map button. |
| `assets.cornerLogo` | string | `img/corner-logo.png` next to the plugin script | Logo in the lower right corner of the map. |
| `assets.headerImage` | string | none (the stylesheet's `--oms-header-image` applies) | Image at the top of the layer panel. |
| `cornerLogoAlt` | string | the header text | Alt text of the corner logo. An empty string marks the logo as decorative. |
| `contentLayers` | array | `[]` | Titles and styles for content layers, by layer name (see below). |
| `defaultMenus` | array | `[]` | Menus shown when the site configuration has no menus (see [Menus](#menus)). |
| `helpUrl` | string | the product README | Link in the "Gör så här" help text shown when the content API cannot be reached. |
| `buttonText` | string | `Kartinnehåll` | Tooltip and alt text of the plugin's map button. |

Images uploaded by an administrator in the site configuration always take
precedence over `assets`.

Relative `assets` URLs are resolved against the map page, not the plugin
script. The defaults are resolved against the plugin script, so the plugin
finds its own `img/` folder wherever it is installed.

### Full example

```json
{
  "name": "mapstories",
  "options": {
    "buttonText": "Map content",
    "basePath": "/maps/stories",
    "apiBase": "/maps/stories",
    "helpUrl": "https://www.example.org/maps/help",
    "cornerLogoAlt": "Example organisation",
    "assets": {
      "buttonIcon": "theme/img/button-icon.png",
      "cornerLogo": "theme/img/corner-logo.png",
      "headerImage": "theme/img/header.jpg"
    },
    "contentLayers": [
      { "name": "Housing_today", "title": "Housing today" },
      { "name": "Housing_2040", "title": "Housing 2040", "style": "housing" }
    ],
    "defaultMenus": [
      {
        "id": "housing",
        "label": "Housing",
        "items": [
          { "id": "today", "label": "Today", "layerName": "Housing_today" },
          { "id": "future", "label": "2040", "layerName": "Housing_2040" }
        ]
      }
    ]
  }
}
```

### `contentLayers`

Every layer in the content catalog (`GET /api/content-catalog`) is added to the
map as a hidden GeoJSON layer, loaded from
`<api base>/content-files/<name>.geojson` in EPSG:3006. Its title is the layer
name with underscores replaced by spaces, unless `contentLayers` gives one:

| Field | Description |
|---|---|
| `name` | Layer name in the catalog (required). |
| `title` | Title shown in Origo (legend, feature info). |
| `style` | Name of an Origo style in `index.json`. |
| `styleDef` | An inline Origo style definition; takes precedence over `style`. |

While a content layer is shown with its text, the plugin draws it with the
symbol styles set in the map editor.

## API base resolution

The plugin finds the content API in this order; the first one that is set
wins:

1. the `apiBase` option (or its alias `contentServerUrl`);
2. the global `window.ORIGO_MAP_STORIES_API_BASE`, set by the host page before
   the plugin starts;
3. the legacy global of the previous product name (see the
   [upgrade guide](upgrading-from-structuremaphelper.md));
4. the `basePath` option;
5. the folder of the map page.

The API base never ends with `/api`: the plugin appends `/api/...` and
`/content-files/...` itself. A root-relative value is resolved against the
page's origin; `"/"` means the origin root, so a map page in a folder can
use a content API at `/api/` with `"apiBase": "/"`.

**The page-folder rule.** The last segment of the page's path is a file if it
contains a dot, otherwise it is a folder:

| Page URL | API base |
|---|---|
| `https://maps.example.org/` | `https://maps.example.org` |
| `https://maps.example.org/index.html` | `https://maps.example.org` |
| `https://maps.example.org/maps/stories/` | `https://maps.example.org/maps/stories` |
| `https://maps.example.org/maps/stories` | `https://maps.example.org/maps/stories` |
| `https://maps.example.org/maps/stories/index.html` | `https://maps.example.org/maps/stories` |
| `https://maps.example.org/maps/v1.2` | `https://maps.example.org/maps` (dot: treated as a file) |

If a folder name contains a dot, set `basePath` or `apiBase` explicitly.

The same rule decides where the map editor is opened: `editorUrl`, else
`<basePath>/editor.html`, else `editor.html` in the page's folder. The editor
opens in an iframe over the map. When the API base was set explicitly (steps
1–3), it is passed on to the editor as `?apiBase=`; otherwise the editor uses
its own folder.

## Map editor: `editor-config.json`

`editor.html` reads `editor-config.json` from its own folder at start-up. All
coordinates are in **EPSG:3006 (SWEREF 99 TM)**, the data CRS of every content
layer; the editor's map also uses EPSG:3006.

```json
{
  "background": {
    "type": "wms",
    "url": "https://maps.example.org/wms",
    "layers": "topography",
    "version": "1.1.1",
    "format": "image/png",
    "tileGrid": {
      "resolutions": [280, 140, 70, 35, 17.5, 8.75, 4.375, 2.1875, 1.09375, 0.546875],
      "extent": [-1200000, 4700000, 2600000, 8500000]
    }
  },
  "center": [600000, 6900000],
  "zoom": 1
}
```

| Field | Default | Description |
|---|---|---|
| `background.type` | `osm` | `osm` (OpenStreetMap, reprojected), `wms` or `none`. |
| `background.url` | OpenStreetMap's tile server | `wms`: the WMS endpoint. `osm`: an optional XYZ tile URL template (Web Mercator tiles). |
| `background.layers` | | WMS layer names (`wms` only). |
| `background.version`, `format` | `1.1.1`, `image/png` | WMS version and image format. |
| `background.tileGrid.resolutions` | 4096 m/px halved per level, 16 levels | Zoom levels in metres per pixel. |
| `background.tileGrid.extent` | the SWEREF 99 TM grid extent | Tile grid extent `[minX, minY, maxX, maxY]`. |
| `center` | `[600000, 6900000]` | Start centre. |
| `zoom` | `1` | Start zoom level, an index into the resolutions. |

Without the file (or with an invalid one) the editor shows OpenStreetMap over
all of Sweden. A WMS background must be served in EPSG:3006.

**URL parameters.** The editor also accepts `?apiBase=<url>` (where the
content API is) and `?config=<url>` (another editor configuration file). Both
are accepted **only if they point to the editor's own origin**; values from
another origin are ignored with a console warning. The editor sends the
administrator's token to its API base, so a link must never be able to point it
elsewhere. To use an API on another origin, serve `editor.html` from that
origin or proxy the API under the editor's origin.

## Site configuration

The site configuration is stored in the database as `site-config.json` and is
edited by administrators under the cogwheel in the layer panel
(*Sajtkonfiguration*). It is part of every content version.

```json
{
  "headerText": "Our city in 2040",
  "images": {
    "headerImage": "/content-files/site-assets/header-image.png",
    "buttonIcon": "/content-files/site-assets/button-icon.png",
    "cornerLogo": "/content-files/site-assets/corner-logo.png"
  },
  "menus": [
    {
      "id": "housing",
      "label": "Housing",
      "items": [
        { "id": "today", "label": "Today", "layerName": "Housing_today" }
      ]
    }
  ]
}
```

### Header text

`headerText` (*Rubriktext* in the editor) is shown at the top of the layer
panel and is also used as the browser tab title (`document.title`) and as the
corner logo's alt text (unless `cornerLogoAlt` is set). Without it the panel
shows the placeholder "Rubriktext".

### Images

Uploaded images replace the plugin's fallback images:

| Image | Requirement | Fallback |
|---|---|---|
| Header image | portrait (taller than wide), PNG or JPEG | `assets.headerImage`, else `--oms-header-image` |
| Button icon | PNG with transparency, 38×49 or 76×98 px | `assets.buttonIcon`, else `plugins/img/button-icon.png` |
| Corner logo | PNG with transparency, 240×82 or 480×164 px | `assets.cornerLogo`, else `plugins/img/corner-logo.png` |

The button icon is also used as the page's favicon.

### Menus

`menus` is a list of menus, each with submenu `items`. Every item owns one
text and one GeoJSON layer, named by `layerName`; the server assigns a layer
name to new items and creates their empty layer when the configuration is
saved.

If the site configuration has no `menus` at all, the plugin shows:

1. the `defaultMenus` option, if it is not empty; otherwise
2. a generated menu **"Innehåll"** listing every layer in the content catalog,
   so that no content is unreachable; otherwise
3. no menus (an empty database). An administrator can then import content or
   build menus in the site configuration.

When the content API cannot be reached, the panel shows a single "Gör så här"
item with the text from `plugins/gor-sa-har.json`, whose link goes to
`helpUrl`.

## Theming

### CSS custom properties

The plugin stylesheet defines neutral theme tokens on `:root`. Override them in
an instance stylesheet that is loaded **after** the plugin stylesheet:

| Token | Default | Used for |
|---|---|---|
| `--oms-primary` | `#1f5f8b` | Buttons, active items, links |
| `--oms-text` | `#1d1d1f` | Body text |
| `--oms-muted-text` | `#4f4f55` | Secondary text |
| `--oms-surface` | `#ffffff` | Panel background |
| `--oms-panel` | `#f5f6f8` | Section and dialog backgrounds |
| `--oms-border` | `#d3d8de` | Borders and dividers |
| `--oms-focus` | `#1f5f8b` | Focus outlines |
| `--oms-font` | the system font stack | All plugin text |
| `--oms-header-image` | `url('img/header.png')` | Layer panel header image |

```css
/* theme/theme.css, loaded after plugins/origo-map-stories.min.css */
:root {
  --oms-primary: #00594f;
  --oms-focus: #00594f;
  --oms-font: "Source Sans 3", system-ui, sans-serif;
  --oms-header-image: url('https://maps.example.org/theme/img/header.jpg');
}
```

A `url()` inside a custom property is resolved against the stylesheet where the
property is **used** (the plugin stylesheet), not the one where it is set. Use
an absolute URL (or a root-relative one such as `/theme/img/header.jpg`) when
you override `--oms-header-image`, or use the `assets.headerImage` option
instead.

### DOM hooks

Stable class names and attributes an instance stylesheet can target:

| Selector | Element |
|---|---|
| `.o-mapstories` | The plugin's map button |
| `.o-mapstories-button-icon`, `[data-oms="button-icon"]` | The image in the map button |
| `.o-mapstories-corner-logo`, `[data-oms="corner-logo"]` | The corner logo on the map |
| `#o-layer-panel` | The layer panel |
| `.o-lp-header`, `.o-lp-header-hero`, `.o-lp-header-title` | Layer panel header, header image, title |
| `.o-lp-section-btn`, `.o-lp-subitem`, `.o-lp-subitem.is-active` | Menus and submenu items |
| `#o-text-panel`, `.o-tp-header`, `.o-tp-title`, `.o-tp-body` | The text panel |
| `.o-tiptap-content` | Rendered rich text |
| `.o-plugin-layout`, `.o-has-layer-panel`, `.o-has-text-panel` | Layout state on the map's parent element |

The plugin also keeps the class names and ids of its previous name, so
existing instance stylesheets keep working; they are listed in the
[upgrade guide](upgrading-from-structuremaphelper.md)'s compatibility table.

Other class names are internal and may change between minor versions.

## Server environment variables

The content API (`content_server_node/server.js`) reads its configuration from
the environment, or from `content_server_node/.env` (template:
`content_server_node/.env.example`).

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL/PostGIS connection string, e.g. `postgres://user:password@db.example.org:5432/origo_map_stories`. One database per installation. |
| `JWT_SECRET` | `fallback-secret` (development only) | Secret that signs admin tokens. Random, at least 32 characters, unique per installation. |
| `ADMIN_PASSWORD` | `changeme` (development only) | The administrator password. |
| `NODE_ENV` | | Set to `production` on servers. The server then **refuses to start** if `JWT_SECRET` or `ADMIN_PASSWORD` is missing or a placeholder, or if `JWT_SECRET` is shorter than 32 characters. |
| `ALLOW_INSECURE_DEFAULTS` | | `1` starts a production server despite failing secret checks, with a loud warning. Emergencies only. |
| `OMS_STRICT_DEV_DB` | | Outside production the server warns when the database name does not end with `_dev`, `_test` or `_local`; `1` makes that a refusal to start. |
| `PORT` | `3000` | HTTP port. |
| `PUBLIC_BASE_PATH` | empty | Path prefix the site is served under behind a reverse proxy, e.g. `/maps/stories`. Used in the URLs of uploaded images and site assets. |
| `PUBLIC_DIR` | `../public` relative to `content_server_node/` | Folder of static files the server also serves (in a standalone install: the Origo site). |
| `APP_VERSION` | `version` in `package.json` | Version reported by `GET /api/version`. Set by the release container image. |
| `BUILD_SHA` | `dev` | Git commit reported by `GET /api/version`. Set by the release container image. |
| `DB_STARTUP_MAX_ATTEMPTS` | `10` | Database connection and migration attempts at start-up. |
| `DB_STARTUP_RETRY_DELAY_MS` | `1000` | First retry delay; doubled per attempt. |
| `DB_STARTUP_MAX_DELAY_MS` | `15000` | Maximum retry delay. |

Never commit real values. See [security.md](security.md).
