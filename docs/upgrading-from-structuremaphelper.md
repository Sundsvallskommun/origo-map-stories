# Upgrading from StructureMapHelper

Origo Map Stories 1.0.0 is the first release under the new name. It is the
same plugin and content API as StructureMapHelper, renamed, made configurable
and given neutral defaults. An installation set up for StructureMapHelper can
be upgraded by replacing the plugin and the API, without changing its
`index.html`, `index.json`, stylesheet, proxy configuration or database.

This page is the only product document that uses the old names; they are
needed to describe what stays compatible.

## Compatibility

| Area | StructureMapHelper | Origo Map Stories 1.0.0 | Compatible? |
|---|---|---|---|
| Global | `StructureMapHelper` | `OrigoMapStories` | Yes: `window.StructureMapHelper` is still set (unless the page defines it itself) |
| Build marker | `window.StructureMapHelperBuild` | `window.OrigoMapStoriesBuild` | Yes: both are set |
| Bundle file names | `structure-map-helper.min.js`, `structure-map-helper.css` | `origo-map-stories.min.js`, `origo-map-stories.min.css` | Yes: every release contains byte-identical copies under the old names (`plugin/structure-map-helper.*`) |
| Control key | `structuremaphelper` | `mapstories` in docs and examples | Yes: the host page chooses the key; `structuremaphelper` keeps working |
| Plugin options | `buttonText`, `contentServerUrl` | all options in [configuration.md](configuration.md) | Yes: `contentServerUrl` is an alias of `apiBase` |
| API base global | `window.STRUCTURE_MAP_HELPER_API_BASE` | `window.ORIGO_MAP_STORIES_API_BASE` | Yes: the old global is still read (after the new one) |
| API base without options | the origin root (with one hard-coded path prefix as exception) | the page's folder | **Check**: see [API base](#api-base) below |
| DOM: map button | class `o-structuremaphelper` | class `o-mapstories` | Yes: both classes are set |
| DOM: button icon | id `o-btn-rvn-logo-img`, class `o-btn-rvn-logo` | class `o-mapstories-button-icon`, `data-oms="button-icon"` | Yes: the old id and class are still set |
| DOM: corner logo | id `o-rvn-logo-corner`, class `o-rvn-logo-corner` | class `o-mapstories-corner-logo`, `data-oms="corner-logo"` | Yes: the old id and class are still set |
| Panels | `#o-layer-panel`, `#o-text-panel`, `.o-lp-*`, `.o-tp-*` | unchanged | Yes |
| CSS custom properties | `--rvn-*` | `--oms-*` | **No**: the `--rvn-*` tokens are gone from the product stylesheet. Instance stylesheets that set colours directly on the legacy ids and classes keep working |
| API paths | `/api/*`, `/content-files/*` | unchanged | Yes |
| Admin token | `cms_token` in `localStorage` | unchanged | Yes: logged-in admins stay logged in |
| Server environment variables | `PORT`, `JWT_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL`, `NODE_ENV`, `PUBLIC_BASE_PATH`, `DB_STARTUP_*` | unchanged, plus new optional ones | Yes, but see [production secrets](#production-secrets) |
| Database | schema as of the last StructureMapHelper version | **no new migrations in 1.0.0** | Yes: old and new versions can run against the same database |
| Export format | `structuremaphelper-content` | `origo-map-stories-content` | One way: imports accept both; **new exports cannot be imported by StructureMapHelper** |
| `/api/version` | `{"sha": "..."}` | `{"sha": "...", "version": "1.0.0"}` | Yes, if your checks read the `sha` field rather than comparing the whole response |

The legacy names are collected in `src/compat.js` and
`content_server_node/compat.js`, and covered by the `LegacyCompatibilityTests`
UI tests. They will be kept for the whole 1.x series.

## What changes visibly

StructureMapHelper had one organisation's graphic profile and menus built in.
Origo Map Stories has neutral defaults. What an installation sees after the
upgrade depends on what it has configured:

| What | Before | After, if not configured | How to keep a custom look |
|---|---|---|---|
| Button icon and corner logo | Built-in organisation logos, shown when the site configuration had no uploaded images | Neutral images from `plugins/img/` | Upload images in *Sajtkonfiguration*, or set `assets.buttonIcon` / `assets.cornerLogo` |
| Panel header image | Built-in organisation image | Neutral image (`--oms-header-image`) | Upload a header image, set `assets.headerImage`, or override `--oms-header-image` in the instance stylesheet |
| Colours and font | Built-in organisation colours, Calibri | Neutral colours, the system font | Override the `--oms-*` tokens in an instance stylesheet loaded after the plugin's |
| Menus when the site configuration has none | Built-in organisation menus | The `defaultMenus` option, else a generated "Innehåll" menu listing all layers | Save menus in *Sajtkonfiguration* (installations that already have saved menus see no change) |
| Titles of content layers | Built-in list | Layer name with underscores as spaces | The `contentLayers` option |
| Map editor background | A built-in WMS | OpenStreetMap over Sweden | An `editor-config.json` next to `editor.html` |
| Help link in "Gör så här" (shown when the API is unreachable) | The old project's README | The Origo Map Stories README | The `helpUrl` option |

Images uploaded in the site configuration always take precedence, so an
installation that has uploaded its own images sees no change there.

## API base

Without an explicit API base, StructureMapHelper used the origin root (apart
from one hard-coded path prefix). Origo Map Stories uses **the folder of the
map page** (see [API base resolution](configuration.md#api-base-resolution)):

- Map page at the site root (`/` or `/index.html`): no change.
- Map page in a folder whose API is proxied under the same folder (for example
  `/maps/stories/` with `/maps/stories/api/`): works, with no special rule.
  This includes the path prefix that StructureMapHelper had hard-coded.
- Map page in a folder, but the API at the origin root (`/api/`): **set the
  API base explicitly**: `"apiBase": "/"` (the origin root) in the plugin
  options, or `window.ORIGO_MAP_STORIES_API_BASE = "/";` in `index.html`.
- Pages that set `contentServerUrl` or `STRUCTURE_MAP_HELPER_API_BASE`: no
  change.

## Production secrets

The API now **refuses to start** with `NODE_ENV=production` if `JWT_SECRET` or
`ADMIN_PASSWORD` is missing or a placeholder, or if `JWT_SECRET` is shorter
than 32 characters. StructureMapHelper only logged a warning. Check the
server's env file before upgrading; generate a new secret with
`openssl rand -base64 48` if needed (this logs out all admins).
`ALLOW_INSECURE_DEFAULTS=1` restores the old behaviour temporarily.

Outside production, the API warns when the database name does not end with
`_dev`, `_test` or `_local`. That is a hint that a development setup points at
a real database.

## Upgrade steps

Before you start, for every installation:

1. Export the current content version (*Sajtkonfiguration →
   Versionshistorik → Exportera*) and keep the zip.
2. Back up the database with `pg_dump` (see
   [deployment.md](deployment.md#backup-and-restore)).
3. Keep the files you will replace (plugin, editor, API image or server
   files), so you can roll back.
4. Download the release and verify it (see
   [deployment.md](deployment.md#release-zip)).

### Installed into an existing Origo site

The site's `index.html`, `index.json` and stylesheet do not need to change.

1. Copy the plugin from the zip over the files the page loads, **keeping the
   names the page uses**:
   - `plugin/structure-map-helper.min.js` → the plugin script the page loads
     (whatever it is called on your server);
   - `plugin/gor-sa-har.json` and the `plugin/img/` folder → **the same
     folder as the plugin script** (the plugin finds its fallback images and
     help text next to its own script).
   - Do not overwrite a stylesheet that the site maintains by hand; compare it
     with `plugin/structure-map-helper.css` and merge what you need.
2. Copy `editor/editor.html` and `editor/editor.js` over the existing editor
   files. Add an `editor-config.json` next to them if the editor should keep a
   specific background; otherwise it shows OpenStreetMap.
3. Make sure the page's CSP allows the editor iframe (`frame-src 'self'`) and,
   for the OpenStreetMap editor background, `img-src` for
   `https://tile.openstreetmap.org` (see
   [deployment.md](deployment.md#content-security-policy)).
4. Build the API image from the zip's `server/` folder and recreate **only**
   the API container with the same env file. Proxy routes and
   `PUBLIC_BASE_PATH` are unchanged.
5. Run the [smoke checks](deployment.md#smoke-checks-after-a-deploy):
   `/api/version` reports `1.0.0` and the release SHA, and the served plugin
   script contains the SHA.
6. Open the map, check the menus, a text, the map editor, and the images
   (see [What changes visibly](#what-changes-visibly)).

### Standalone installation

1. Replace the plugin files in `plugins/`. You can switch the page to the new
   names (`origo-map-stories.min.js`/`.css`, control key `mapstories`,
   global `OrigoMapStories`) or keep the old ones; both work.
2. Copy `plugin/img/` and `plugin/gor-sa-har.json` into `plugins/`. The old
   organisation-specific fallback images are no longer used and can be
   removed once the new version runs.
3. Replace `editor.html` and `editor.js`, and add `editor-config.json`.
4. Replace the server files (`content_server_node/*.js`, `migrations/`,
   `package*.json`) from the zip's `server/` folder, run
   `npm ci --omit=dev`, and restart the process (for pm2:
   `BUILD_SHA=<sha> pm2 restart <name> --update-env`).
5. Run the smoke checks and check the map as above.

### Several installations sharing one database

Mixed versions are safe in 1.0.0: there are no new migrations and the stored
format is unchanged. But exports made by 1.0.0 cannot be imported by
StructureMapHelper, so **upgrade every installation before moving export
files between them**. Consider giving each installation its own database; see
[deployment.md](deployment.md#database).

## Rollback

1.0.0 does not change the database, so a rollback only restores files and the
API:

1. Put back the saved plugin, `gor-sa-har.json` and editor files.
2. Put back the previous API image (for example re-tag the image you saved as
   `:previous`) or the previous server files, and recreate or restart the API.
3. Run the smoke checks: `/api/version` shows the old SHA.

Content saved with 1.0.0 stays readable by StructureMapHelper. Only export zips
made by 1.0.0 cannot be imported by the old version; use the export you made
before the upgrade, or restore the database backup if needed.
