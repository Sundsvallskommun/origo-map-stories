# Release package layout

Every Origo Map Stories release is published as one zip file plus a checksum:

```
dist/origo-map-stories-<version>.zip
dist/origo-map-stories-<version>.zip.sha256
```

`<version>` is the `version` from `package.json` (for example `1.0.0`). The
`.sha256` file holds one line in `sha256sum` format:
`<hex digest>  origo-map-stories-<version>.zip`, so `sha256sum -c` works in
the folder that holds both files.

The package is built by `scripts/build-release.js` (`npm run release:zip`)
from a tested checkout, after `npm run build` and `npm run build-editor`. The
CI workflow builds and verifies it on every run (artifact
`origo-map-stories-bundle`), and `.github/workflows/release.yml` publishes it
as a GitHub Release when a `v*` tag is pushed. Instance repositories pin a
version, download the zip, verify the checksum and install from the layout
below. They must only rely on the paths listed here.

## Building and verifying

```
npm run build
npm run build-editor
npm run release:zip                      # dist/origo-map-stories-<package.json version>.zip
npm run release:zip -- --version 1.2.0   # explicit version (a leading "v" is dropped)
npm run release:verify                   # verifies dist/origo-map-stories-<version>.zip
npm run release:verify -- path/to/origo-map-stories-1.2.0.zip
```

`release:zip` options: `--version <v>`, `--sha <sha>` (default `GITHUB_SHA`,
else `git rev-parse HEAD`, else `dev`) and `--out <dir>` (default `dist`). It
fails if a build output is missing or if a legacy copy differs from the new
file. A missing `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.md` or
`CHANGELOG.md` gives a warning and is left out.

`release:verify` reads the zip in place and checks that every required entry
below exists, that `SHA256SUMS` lists every other file exactly once with the
right digest, that the legacy copies are byte-identical, that `BUILD_SHA` is
set and equal to `server/BUILD_SHA`, that the `server/Dockerfile` defaults
match `VERSION` and `BUILD_SHA`, that the file name matches `VERSION`, that no
secrets, source maps, tests or `node_modules` are included, and that the
outer `.sha256` file matches the zip.

The zip is reproducible: entries are sorted and have a fixed timestamp, so
the same inputs, version and SHA give the same zip.

## Layout

All paths are relative to the root of the zip. There is no extra top-level
folder.

```
VERSION                         release version, one line (e.g. 1.0.0)
BUILD_SHA                       git commit the package was built from, one line
SHA256SUMS                      sha256 of every other file in the zip (sha256sum format)
README.md                       product overview                 (when present in the repo)
LICENSE                         product licence                  (when present in the repo)
THIRD_PARTY_LICENSES.md         licences of bundled third-party code (when present)
CHANGELOG.md                    release notes                    (when present)

plugin/                         files for the Origo site's plugins/ folder
  origo-map-stories.min.js      the plugin (global OrigoMapStories)
  origo-map-stories.min.css     the plugin's default stylesheet
  structure-map-helper.min.js   legacy name: byte-identical copy of origo-map-stories.min.js
  structure-map-helper.css      legacy name: byte-identical copy of origo-map-stories.min.css
  gor-sa-har.json               text shown under "Gör så här" when the content API is unreachable
  img/
    button-icon.png             neutral fallback button icon
    corner-logo.png             neutral fallback corner logo
    header.png                  neutral fallback panel header image

editor/                         the stand-alone GeoJSON editor (served next to index.html)
  editor.html
  editor.js
  editor-config.example.json    example editor-config.json (background, grid, center, zoom);
                                install it as editor-config.json and adapt it

server/                         self-contained Docker build context for the content API
  Dockerfile                    ARG APP_VERSION and ARG BUILD_SHA default to this release
  package.json
  package-lock.json
  BUILD_SHA                     same as the root BUILD_SHA
  content_server_node/
    server.js
    store.js
    contentArchive.js
    siteConfig.js
    compat.js
    migrations/*.sql            SQL migrations, run at API start
  scripts/
    import-content-folder.js    one-time import of a legacy content/ folder

docs/                           the product documentation (*.md), so the links from
                                README.md, examples/ and deployment/ work offline

examples/
  minimal-map/                  a minimal Origo index.html/index.json/editor-config.json
  instance-template/            starting point for a new instance repository (when present)

deployment/
  container/
    Dockerfile                  the source of server/Dockerfile (unstamped)
    compose.example.yml         content-api service, build context ../../server
    content-api.env.example     the API's environment; placeholders fail in production
    README.md
  examples/
    README.md
    existing-origo/             nginx.conf.template, index.html.snippet, index.json.snippet, README.md
    standalone/                 pm2.ecosystem.example.js, nginx.conf.template, README.md
```

Required entries (checked by `release:verify`): `VERSION`, `BUILD_SHA`,
`SHA256SUMS`, all `plugin/` files, the three `editor/` files, every `server/`
file listed above (at least one migration), `examples/minimal-map/index.html`
and `index.json`, `docs/configuration.md`, `docs/deployment.md`,
`docs/release-layout.md`, `docs/upgrading-from-structuremaphelper.md`, and the
three `deployment/container/` files other than the README.

## Rules

- **Legacy file names.** `plugin/structure-map-helper.min.js` and
  `plugin/structure-map-helper.css` are always byte-identical copies of the new
  files (`scripts/copy-legacy-names.js`). An installation that loads the old
  names can be upgraded by copying the files over without touching its
  `index.html`.
- **No instance material.** The package never contains an instance's
  `index.html`/`index.json`, theme, logos, nginx configuration with real host
  names, environment files or secrets. Those live in the instance
  repositories. The deployment files are templates with `{{...}}`
  placeholders.
- **Editor.** `editor.html` is kept as source in `public/`; `npm run build-editor`
  writes `editor.js` (and a source map, which is not packaged) to
  `build/editor/`. The packaging step combines the two into `editor/`.
- **Server context.** `server/` builds with `docker build server/` (or
  `podman build server/`) without anything from the rest of the zip; the
  repository root is not a build context. Only production dependencies are
  installed in the image (`npm ci --omit=dev`). The packaging step fills the
  Dockerfile's `ARG APP_VERSION=` and `ARG BUILD_SHA=` defaults from `VERSION`
  and `BUILD_SHA`, so `GET /api/version` reports the release without extra
  `--build-arg` flags; `--build-arg` still overrides them.
- **Checksums.** `SHA256SUMS` covers every file in the zip except itself.
- **Stability.** Adding files is a minor change. Moving or removing any path
  listed above is a breaking change and needs a new major version, since the
  instance deploy scripts depend on it.

## Source mapping

| Zip path | Source in the repository |
|---|---|
| `VERSION` | `--version`, else `package.json` `version` |
| `BUILD_SHA`, `server/BUILD_SHA` | `--sha`, else `GITHUB_SHA`, else `git rev-parse HEAD`, else `dev` |
| `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.md`, `CHANGELOG.md` | the same files at the repository root |
| `docs/` | `docs/` (all files) |
| `plugin/origo-map-stories.min.js` | `build/js/origo-map-stories.min.js` (`npm run build`) |
| `plugin/origo-map-stories.min.css` | `build/css/origo-map-stories.min.css` (`npm run build`) |
| `plugin/structure-map-helper.min.js` | `build/js/structure-map-helper.min.js` (`npm run build`) |
| `plugin/structure-map-helper.css` | `build/css/structure-map-helper.css` (`npm run build`) |
| `plugin/gor-sa-har.json` | `public/gor-sa-har.json` |
| `plugin/img/*` | `public/img/*` |
| `editor/editor.html` | `public/editor.html` |
| `editor/editor.js` | `build/editor/editor.js` (`npm run build-editor`) |
| `editor/editor-config.example.json` | `examples/minimal-map/editor-config.json` |
| `server/Dockerfile` | `deployment/container/Dockerfile`, with the ARG defaults filled in |
| `server/package.json`, `server/package-lock.json` | `package.json`, `package-lock.json` |
| `server/content_server_node/*.js` | the five files listed above from `content_server_node/` (not `test/`, not `.env*`) |
| `server/content_server_node/migrations/` | `content_server_node/migrations/` |
| `server/scripts/import-content-folder.js` | `scripts/import-content-folder.js` |
| `examples/` | `examples/` (all files) |
| `deployment/` | `deployment/container/`, `deployment/examples/` (all files) |
