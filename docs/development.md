# Development

## Prerequisites

| Tool | Purpose |
|---|---|
| Node.js 22 | Plugin build and the content API (the version used by CI and the container image) |
| Git | Version control |
| PostgreSQL with PostGIS | The content database (a local server or a container is fine) |
| .NET SDK 10 | Only for the UI tests, see [testing.md](testing.md) |

The [Origo](https://github.com/origo-map/origo) source must be checked out
next to this repository, as `../origo`. CI tests against the commit in
`ci/origo.ref`; check out the same commit if you see differences.

```
<workspace>/
├── origo/                 Origo (do not modify, apart from the dev proxy added by npm run setup)
└── origo-map-stories/     this repository
```

## Database

Use a database of your own for development, never a shared or production
database. Name it with a `_dev` (or `_local`) suffix: outside production the
API warns when the database name does not end with `_dev`, `_test` or
`_local`, and `OMS_STRICT_DEV_DB=1` turns the warning into a refusal to start.

With Docker:

```bash
docker run -d --name oms-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=origo_map_stories_dev \
  -p 5432:5432 postgis/postgis:16-3.4
```

On an existing server, as a superuser:

```sql
CREATE ROLE origo_map_stories_dev LOGIN PASSWORD '<password>';
CREATE DATABASE origo_map_stories_dev OWNER origo_map_stories_dev;
\c origo_map_stories_dev
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER SCHEMA public OWNER TO origo_map_stories_dev;
```

Copy `content_server_node/.env.example` to `content_server_node/.env` (it is
gitignored) and set:

```
PORT=3000
DATABASE_URL=postgres://origo_map_stories_dev:<password>@localhost:5432/origo_map_stories_dev
ADMIN_PASSWORD=<a password for the local admin>
JWT_SECRET=<any random string of 32+ characters>
# OMS_STRICT_DEV_DB=1
```

Leave `NODE_ENV` unset locally. The tables are created on first start. To get
content, export a version from another installation and import it under
*Sajtkonfiguration → Versionshistorik*, or build menus in the browser.

## Running

```bash
npm install
npm run setup     # once; also runs automatically before the JS watcher
npm start
```

`npm run setup` (`scripts/setup.js`):

- copies `examples/minimal-map/index.html`, `index.json` and
  `editor-config.json`, and `public/editor.html`, into `../origo`;
- copies the neutral fallback images (`public/img/`) and `public/gor-sa-har.json`
  into `../origo/plugins/`;
- adds a proxy for `/api` and `/content-files` to `localhost:3000` in
  `../origo/tasks/webpack.dev.js` (idempotent).

`npm start` runs in parallel:

- the plugin watcher (webpack), writing `../origo/plugins/origo-map-stories.js`;
- the Sass watcher, writing `../origo/plugins/origo-map-stories.css`;
- the content API on <http://localhost:3000>.

Start Origo in a second terminal (`cd ../origo && npm start`) and open
<http://localhost:9966/> (public) or <http://localhost:9966/?admin> (admin;
the password is `ADMIN_PASSWORD`).

The map editor is built separately: `npm run watch-editor` while working on
`src/geoJsonEditor.js`, which writes `editor.js` into `../origo`.

## Builds

| Command | Output |
|---|---|
| `npm run build` | `build/js/origo-map-stories.min.js`, `build/css/origo-map-stories.min.css`, and byte-identical copies under the legacy file names (`scripts/copy-legacy-names.js`) |
| `npm run build-editor` | `build/editor/editor.js` |
| `npm run test:server` | Server unit tests, see [testing.md](testing.md) |
| `npm run release:zip` | The release zip, see [releasing.md](releasing.md) |

The production bundle contains the git commit it was built from
(`window.OrigoMapStoriesBuild`, logged at start-up as
`OrigoMapStories build <sha>`).

## Project structure

```
origo-map-stories/
├── index.js                    plugin entry point: registers the control, content layers, panels
├── src/
│   ├── config.js               plugin options and their defaults
│   ├── apiBase.js              API base and application base resolution
│   ├── compat.js               legacy names (globals, DOM ids)
│   ├── layerPanel.js           menus panel
│   ├── textPanel.js            text panel, map editor iframe
│   ├── editor.js               TipTap rich-text editor, image upload
│   ├── featureSync.js          links between text and map objects
│   ├── siteConfigEditor.js     site configuration and version history UI
│   ├── siteStatus.js           loading, empty and outage states
│   ├── geoJsonEditor.js        the map editor page (editor.js)
│   └── ...
├── scss/plugin.scss            plugin styles and the --oms-* tokens
├── public/                     editor.html, gor-sa-har.json, img/ (neutral fallback images)
├── content_server_node/
│   ├── server.js               HTTP API and start-up checks
│   ├── store.js                versioned content store (PostgreSQL/PostGIS)
│   ├── contentArchive.js       zip export/import of a version
│   ├── siteConfig.js           site configuration rules
│   ├── compat.js               legacy names on the server (export format)
│   ├── migrations/             database schema, applied at start-up
│   └── test/                   server unit tests
├── scripts/                    setup, release packaging, legacy content import, checks
├── examples/                   minimal map and the instance repository template
├── deployment/                 container build and deployment templates
├── tests/OrigoMapStories.UiTests/   Playwright UI tests
└── tasks/                      webpack configurations
```

## Content storage

All content (site configuration, layer texts, GeoJSON overlays, images and
site assets) is stored in PostgreSQL as **versions**. Every save creates a
new, complete version of the whole site; `current_version` points at the live
one. File contents are stored once per unique content (sha256), so many
versions take little space.

| Table | Contents |
|---|---|
| `version` | One row per version: time, kind (`save`, `restore`, `import`, `migration`), description |
| `version_file` | The complete file list of each version (`path` → `sha256`) |
| `blob` | File contents, deduplicated by sha256 |
| `current_version` | Single row pointing at the live version |
| `pending_upload` | Images uploaded in the text editor but not yet saved with a text |
| `current_feature` | Features of the live version's overlays as `geometry(…, 3006)`, read-only, for GIS clients |

Paths inside a version (and inside an export zip):

```
site-config.json
layers/<layerName>/overlay.geojson
layers/<layerName>/text.json
images/<file>
site-assets/<header-image|button-icon|corner-logo>.<ext>
```

The public URLs (`/content-files/<layer>.geojson`, `/content-files/images/…`,
`/api/content/<layer>`, …) always serve the current version.

Saves use optimistic locking: every read returns an `ETag` (the file's
sha256) and the client sends it back as `If-Match`. If someone else saved the
same file in between, the server answers `409` and the editor keeps the
draft. Writes are serialized with a transaction-level advisory lock;
migrations at start-up take a session-level advisory lock.

### Export format

An export zip has a `manifest.json` with `"format": "origo-map-stories-content"`
and `"formatVersion": 1`, a `LÄSMIG.txt`, and the version's files at the paths
above, plus a generated `text.html` per layer (ignored on import). Imports
also accept the legacy format id (`content_server_node/compat.js`).

## Code style

ESLint with the Airbnb base configuration (`.eslintrc.json`). Keep the
product neutral: no organisation names, host names or IP addresses in the
code, examples or docs (`scripts/check-neutral.js` checks this in CI).
Instance-specific material belongs in installation repositories.
