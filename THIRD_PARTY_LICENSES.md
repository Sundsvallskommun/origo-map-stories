# Third-party licenses

This document lists the open-source components that Origo Map Stories
distributes or depends on, and their licenses.

## This project

<!-- Pending decision D7: whether the acknowledgement below is kept, and the
copyright holder of the project itself (decision D6, LICENSE file). -->
Origo Map Stories (formerly StructureMapHelper) was originally developed by
Region Västernorrland.

`package.json` declares the **MIT License** for the project's own code. The
`LICENSE` file is pending.

## Bundled into the plugin (`origo-map-stories.min.js`)

| Component | Version | License |
|---|---|---|
| [@tiptap/core](https://tiptap.dev) | 3.x | MIT |
| [@tiptap/starter-kit](https://tiptap.dev) | 3.x | MIT |
| [@tiptap/extension-image](https://tiptap.dev) | 3.x | MIT |
| [@tiptap/extension-link](https://tiptap.dev) | 3.x | MIT |
| [@tiptap/pm](https://tiptap.dev) (ProseMirror bindings) | 3.x | MIT |
| [ProseMirror](https://prosemirror.net/) (`prosemirror-*`, via `@tiptap/pm`) | 1.x | MIT |
| [linkifyjs](https://linkify.js.org/) (via `@tiptap/extension-link`) | 4.x | MIT |

Origo and OpenLayers are **not** bundled into the plugin: the plugin uses the
host page's Origo (`externals: ['Origo']`).

## Bundled into the map editor (`editor.js`)

| Component | Version | License |
|---|---|---|
| [OpenLayers](https://openlayers.org/) (`ol`) | 10.x | BSD-2-Clause |
| [proj4js](https://github.com/proj4js/proj4js) (`proj4`) | 2.x | MIT |
| [rbush](https://github.com/mourner/rbush) (via `ol`) | 4.x | MIT |
| [quickselect](https://github.com/mourner/quickselect) (via `ol`) | 3.x | ISC |
| [earcut](https://github.com/mapbox/earcut) (via `ol`) | 3.x | ISC |
| [pbf](https://github.com/mapbox/pbf) (via `ol`, if included by the build) | 4.x | BSD-3-Clause |
| [mgrs](https://github.com/proj4js/mgrs), [wkt-parser](https://github.com/proj4js/wkt-parser) (via `proj4`) | 1.x | MIT |

The editor imports only the OpenLayers modules it uses; webpack leaves out
the rest (for example the GeoTIFF and Zarr dependencies of `ol`).

## Content API (`server/`, installed with `npm ci --omit=dev`)

| Component | Version | License |
|---|---|---|
| [Express](https://expressjs.com) | 5.x | MIT |
| [multer](https://github.com/expressjs/multer) | 2.x | MIT |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | 9.x | MIT |
| [cors](https://github.com/expressjs/cors) | 2.x | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | 17.x | BSD-2-Clause |
| [pg](https://node-postgres.com/) (node-postgres) | 8.x | MIT |
| [archiver](https://github.com/archiverjs/node-archiver) | 7.x | MIT |
| [yauzl](https://github.com/thejoshwolfe/yauzl) | 3.x | MIT |

The content API's dependencies install about 140 transitive packages. Nearly
all are MIT; the others are ISC (for example `glob`, `minimatch`, `semver`,
`pg-int8`, `split2`), Apache-2.0 (for example `readdir-glob`, `crc-32`,
`ecdsa-sig-formatter`, `text-decoder`) and BSD-3-Clause (`qs`,
`buffer-equal-constant-time`). For the exact list of a release, run
`npx license-checker --production` (or inspect `package-lock.json`) in the
release's `server/` folder.

The front-end tiptap/ProseMirror and OpenLayers/proj4 trees likewise contain
further small MIT, ISC and BSD packages; `package-lock.json` is
authoritative.

## Build and test tools (not distributed)

Used only to build and test the product; not included in the release zip.

| Component | License |
|---|---|
| [webpack](https://webpack.js.org), [webpack-cli](https://github.com/webpack/webpack-cli), [webpack-dev-server](https://github.com/webpack/webpack-dev-server), [webpack-merge](https://github.com/survivejs/webpack-merge) | MIT |
| [sass](https://sass-lang.com), [sass-loader](https://github.com/webpack-contrib/sass-loader), [css-loader](https://github.com/webpack-contrib/css-loader), [style-loader](https://github.com/webpack-contrib/style-loader), [mini-css-extract-plugin](https://github.com/webpack-contrib/mini-css-extract-plugin) | MIT |
| [autoprefixer](https://github.com/postcss/autoprefixer), [compression-webpack-plugin](https://github.com/webpack-contrib/compression-webpack-plugin) | MIT |
| [eslint](https://eslint.org), [eslint-config-airbnb-base](https://github.com/airbnb/javascript), [eslint-plugin-import](https://github.com/import-js/eslint-plugin-import) | MIT |
| [npm-run-all2](https://github.com/bcomnes/npm-run-all2) | MIT |
| [Playwright for .NET](https://playwright.dev/dotnet/), [NUnit](https://nunit.org/) (UI tests) | Apache-2.0, MIT |

## Runtime platforms (not distributed)

| Platform | License |
|---|---|
| [Origo](https://github.com/origo-map/origo) (the host map) | BSD-2-Clause |
| [Node.js](https://nodejs.org) | MIT |
| [PostgreSQL](https://www.postgresql.org) | PostgreSQL License |
| [PostGIS](https://postgis.net) | GPL-2.0-or-later (used as a database extension; not distributed) |

## Map data

The default background of the map editor and of the example map is
[OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap
contributors, available under the Open Database License (ODbL). Installations
that use OpenStreetMap tiles must show the attribution and follow the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
