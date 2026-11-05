# Tests

Two suites, both against a separate **test database** whose name must end
with `_test` (never a real one):

| Suite | What | Run |
|---|---|---|
| **UI tests** (C#, Playwright + NUnit) | The real app in a browser, end to end | `dotnet test tests/OrigoMapStories.UiTests` |
| **Server unit tests** (Node, `node:test`) | `store.js`, `contentArchive.js`, `siteConfig.js` directly | `npm run test:server` |

Do not run the two at the same time — both wipe the test database.

## UI tests

What they cover:

| Area | Test class |
|---|---|
| Public mode: menus, texts, layers | `PublicModeTests` |
| Admin login, expired sessions | `AdminLoginTests` |
| Text editing, images | `TextEditingTests` |
| Linking text ↔ map, the "Koppla till karta" dialog, WFS layers (mocked) | `MapLinkTests` |
| Site configuration: menus / graphic profile | `SiteConfigMenuTests`, `SiteConfigProfileTests` |
| Versions, export/import | `VersionsTests`, `ExportImportTests` |
| Concurrent saves | `ConcurrencyTests` |
| Map editor: points, lines, areas, keys, dragging, symbol styles, login | `GeoJsonEditorTests`, `MapEditorDrawingTests` |
| Map editor page: `editor-config.json`, same-origin `?apiBase=` / `?config=` | `EditorConfigTests` |
| Panel behaviour, defaults, missing data | `PanelBehaviourTests` |
| The app under a path prefix (`/maps/stories`) behind a reverse proxy | `BasePathTests` |
| `"apiBase": "/"` on a page in a subfolder calls the API at the origin root | `ApiBaseRootTests` |
| Host pages written for the product's previous name (old file names, global, control key, API global, DOM ids) | `LegacyCompatibilityTests` |
| Phone layout (390×844, touch) | `PhoneLayoutTests` |

The tests start everything themselves:

- they assemble a site folder (Origo build from `../origo/build` + this repo's
  `public/` files + the built plugin and editor), the same layout as a
  standalone installation;
- they start `content_server_node/server.js` on a free port against the test
  database, with their own admin password and JWT secret;
- `BasePathTests` start a second server with `PUBLIC_BASE_PATH=/maps/stories`
  behind `Infrastructure/base-path-proxy.js`, which plays a reverse proxy (strips
  the prefix, answers 404 elsewhere and logs those requests);
- before **every test** the test database is reset to the fixture content in
  `OrigoMapStories.UiTests/Fixtures/content` (version 1);
- all non-local network traffic (background maps, the example WFS) is sent to
  a non-existent proxy and fails at once; tests that need WFS answer it with
  mocked responses (`MapLinkTests`).

### Known issue (skipped tests)

`PhoneLayoutTests` has three tests marked `[Ignore]`: on a phone, the layer
panel and the text panel sit side by side (211 + 241 px), so the map gets
0 px width and the text panel is cut off at the right edge. The tests describe
the wanted behaviour; remove the `Ignore` once a phone layout exists.

### Setup, running and failures

The one-time setup (a test database whose name ends with `_test`,
`.runsettings`, building `../origo`, the plugin and the editor, installing
browsers), the commands to run the suites, and how to open the Playwright
trace of a failing test are described in [docs/testing.md](../docs/testing.md).

Rebuild the plugin (`npm run build`) after changing `src/` or `index.js`; the
tests serve the built bundle, not the sources.

### Structure

| Folder | Contents |
|---|---|
| `Infrastructure/` | `TestServer` (site + node), `TestDatabase` (seed/reset, DB helpers), `UiTestBase` (network blocking, traces, login/API helpers), `base-path-proxy.js` |
| `Pages/` | Page objects — all selectors and map helpers live here |
| `Tests/` | Test classes per area |
| `Fixtures/site/` | The map page: `index.html`/`index.json` (neutral, OSM, mocked `example-wfs`), `legacy.html` (old names), `editor-config.json` |
| `Fixtures/content/` | Seed content (site-config, 3 layers, 2 texts, images, site assets) |
| `Fixtures/uploads/` | Files used by upload tests (valid and invalid icons, header images) |
| `Fixtures/generate-fixtures.js` | Regenerates the fixtures (`node tests/OrigoMapStories.UiTests/Fixtures/generate-fixtures.js`) |

Map helpers take coordinates in SWEREF 99 TM (EPSG:3006, like the fixture
data) and convert them to the map's projection (EPSG:3857) in the page. The
map editor exposes `window.mapStoriesEditor` (map, layer, source) for the
tests.

Tests run one at a time (one server, one database). The database is reset
from an in-memory snapshot before each test, so tests are independent and can
be run in any order or alone.

## Server unit tests

`content_server_node/test/*.test.js`, run with `npm run test:server`
(Node's built-in test runner, no extra packages):

| File | Covers |
|---|---|
| `contentArchive.test.js` | Export → import round trip, `text.html`, every import rejection (format, paths, traversal, JSON, GeoJSON), hand-edited zips, BOM, re-zipped folders |
| `siteConfig.test.js` | Layer naming, normalising saved configs, legacy `maplayers` migration, creating/removing layer files |
| `store.test.js` | Versions as snapshots, deduplication, 409 conflicts, image sync, restore, delete + garbage collection, `current_feature` (PostGIS) incl. broken and 3D geometries, concurrent commits, rollback |

`store.test.js` uses the test database and is skipped when no
`TEST_DATABASE_URL` is found.
