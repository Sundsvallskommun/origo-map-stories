# Changelog

All notable changes to Origo Map Stories are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - unreleased

The first release under the name Origo Map Stories. It continues
StructureMapHelper, renamed, made configurable and given neutral defaults.
Installations set up for StructureMapHelper keep working; see
[docs/upgrading-from-structuremaphelper.md](docs/upgrading-from-structuremaphelper.md).

### Renamed (with compatibility)

- The product is now **Origo Map Stories**: global `OrigoMapStories`, bundle
  `origo-map-stories.min.js`/`.min.css`, control key `mapstories` in the docs
  and examples, DOM classes `o-mapstories`, `o-mapstories-button-icon` and
  `o-mapstories-corner-logo`, API global `ORIGO_MAP_STORIES_API_BASE`.
- Compatibility: `window.StructureMapHelper` and `StructureMapHelperBuild` are
  still set; every build also writes byte-identical copies under the old file
  names `structure-map-helper.min.js` and `structure-map-helper.css`; the
  control key `structuremaphelper` keeps working; the old DOM ids and classes
  are still set; `STRUCTURE_MAP_HELPER_API_BASE` and the option
  `contentServerUrl` are still read. All legacy names are in `src/compat.js`
  and `content_server_node/compat.js`, and covered by `LegacyCompatibilityTests`.
- Exports use the format id `origo-map-stories-content`. Imports accept it and
  the old `structuremaphelper-content`. **Exports made by 1.0.0 cannot be
  imported by StructureMapHelper.**

### Added

- Plugin options: `apiBase`, `basePath`, `editorUrl`,
  `assets.buttonIcon`/`cornerLogo`/`headerImage`, `cornerLogoAlt`,
  `contentLayers`, `defaultMenus`, `helpUrl` and `buttonText`
  ([docs/configuration.md](docs/configuration.md)).
- API base resolution: option, global, legacy global, `basePath`, then the
  page's folder. The app now works under any path prefix without code
  changes (`BasePathTests`).
- The map editor reads `editor-config.json` next to `editor.html`
  (background `osm`, `wms` or `none`, tile grid, centre, zoom). EPSG:3006 is
  documented as the product's data CRS.
- Theme tokens `--oms-*` (colours, font, header image) for instance
  stylesheets, and `data-oms` attributes on the button icon and corner logo.
- When the site configuration has no menus, a menu "Innehåll" listing every
  content layer is generated, so no content is unreachable.
- `GET /api/version` also returns `version` (from `APP_VERSION` or
  `package.json`): `{"sha": "...", "version": "1.0.0"}`.
- The API warns when the database has migrations this build does not know
  (another installation with a newer version shares the database).
- Release zip `origo-map-stories-<version>.zip` with `.sha256`, published from
  `v*` tags: plugin (new and legacy names), editor, a self-contained container
  build context for the API, the documentation, examples and deployment
  templates
  ([docs/release-layout.md](docs/release-layout.md)).
- `examples/minimal-map/` and `examples/instance-template/` (installation
  repository template with release fetch scripts).
- Product documentation in `docs/`.
- A neutrality check (`npm run check:neutral`) in CI.

### Changed

- **Neutral defaults.** The built-in organisation logos, header image,
  colours, font, menus and content layer list are gone. Without
  configuration the plugin shows neutral images from `plugins/img/`, neutral
  colours and the system font. Uploaded images in the site configuration are
  unaffected.
- The map editor's default background is OpenStreetMap over Sweden (was a
  fixed WMS); configure another one in `editor-config.json`.
- Without an explicit API base the plugin uses the page's folder (was the
  origin root, with one hard-coded path prefix as exception).
- **Production secret check.** With `NODE_ENV=production` the API refuses to
  start if `JWT_SECRET` or `ADMIN_PASSWORD` is missing or a placeholder, or if
  `JWT_SECRET` is shorter than 32 characters (was a warning).
  `ALLOW_INSECURE_DEFAULTS=1` overrides this in an emergency.
- Outside production the API warns when the database name does not end with
  `_dev`, `_test` or `_local`; `OMS_STRICT_DEV_DB=1` makes it a refusal.
- Database migrations at start-up run under a PostgreSQL advisory lock, so
  several API processes can start against one database at once.
- `editor.js` is no longer committed; `npm run build-editor` writes it to
  `build/editor/`.
- The editor page has a neutral title.

### Security

- The map editor accepts `?apiBase=` and `?config=` only from its own origin,
  so a link cannot make it send the admin token elsewhere.

### Database

- No new migrations. The schema is identical to the last StructureMapHelper
  version; old and new versions can run against the same database.

### Removed

- Leftover references to the former .NET content server (removed earlier);
  the Node.js API is the only content server.
- Installation-specific files (map pages, themes, deploy scripts, proxy
  configuration) moved to installation repositories.
