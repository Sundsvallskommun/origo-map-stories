# Origo Map Stories

Origo Map Stories is a plugin for the [Origo](https://github.com/origo-map/origo)
web map, together with a small content API. It lets an organisation tell
stories with a map: a side panel with menus, a rich-text page per menu item,
links from the text to objects and views on the map, and a map editor for
drawing the item's own map content. Everything is edited in the browser by an
administrator and stored, fully versioned, in PostgreSQL/PostGIS.

Origo Map Stories was previously released under another name. Existing
installations keep working after an upgrade; see the
[upgrade guide](docs/upgrading-from-structuremaphelper.md).

## Features

- **Layer panel** with a header image, a title and configurable menus and
  submenus. Each submenu item has its own text and its own GeoJSON map layer.
- **Text panel** with a rich-text editor (headings, lists, links, images),
  "next item" navigation, and links that select map objects or move the map
  to a saved view.
- **Map editor** (`editor.html`) for points, lines and areas with a symbol
  library. Data is stored in EPSG:3006 (SWEREF 99 TM).
- **Site configuration** in the browser: header text, menus, header image,
  button icon and corner logo.
- **Version history**: every save creates a complete version. Admins can
  restore, delete, export (zip) and import versions.
- **Safe concurrent editing**: optimistic locking with ETags, so a save never
  silently overwrites someone else's change.
- **Neutral defaults and theming**: neutral fallback images and colours,
  themable through `--oms-*` CSS custom properties and plugin options.
- **Works under a path prefix** (for example `/maps/stories/`) behind a
  reverse proxy, inside an existing Origo installation or standalone.
- **Release packages**: one zip per release with the plugin, the editor, a
  container build context for the API, examples and deployment templates.

## Quick start (local development)

Prerequisites: Node.js 22, Git, and a PostgreSQL server with PostGIS where you
can create a database. The Origo source must be checked out next to this
repository, in `../origo`.

```bash
git clone https://github.com/origo-map/origo.git origo
(cd origo && npm install)

git clone https://github.com/Sundsvallskommun/origo-map-stories.git
cd origo-map-stories
npm install
cp content_server_node/.env.example content_server_node/.env
```

Edit `content_server_node/.env`: point `DATABASE_URL` at a development database
whose name ends with `_dev` (for example `origo_map_stories_dev`), set
`ADMIN_PASSWORD`, and remove the `NODE_ENV=production` line. See
[docs/development.md](docs/development.md#database) for creating the database.

```bash
npm run setup          # copies the example map into ../origo and adds the dev proxy
npm start              # plugin and Sass watchers, and the content API on :3000
```

In a second terminal:

```bash
cd ../origo
npm start              # Origo dev server on :9966
```

Open <http://localhost:9966/> for the public map and
<http://localhost:9966/?admin> to log in as administrator.

## Documentation

| Document | Contents |
|---|---|
| [docs/configuration.md](docs/configuration.md) | Plugin options, API base resolution, site configuration, editor configuration, theming, server environment variables |
| [docs/deployment.md](docs/deployment.md) | Standalone and existing-Origo deployments, reverse proxy, CSP, database, backup, smoke checks |
| [docs/instances.md](docs/instances.md) | Setting up an installation repository that pins a product release |
| [docs/upgrading-from-structuremaphelper.md](docs/upgrading-from-structuremaphelper.md) | Compatibility with installations of the previous product name, and upgrade steps |
| [docs/security.md](docs/security.md) | Secrets, the admin login model, editor URL rules, reporting vulnerabilities |
| [docs/development.md](docs/development.md) | Development setup, project structure, data model |
| [docs/testing.md](docs/testing.md) | Server unit tests and the Playwright UI suite |
| [docs/releasing.md](docs/releasing.md) | Versioning, the release workflow, maintainer access |
| [docs/release-layout.md](docs/release-layout.md) | Layout of the release zip |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Compatibility

- **Origo:** tested in CI against the Origo commit pinned in `ci/origo.ref`.
- **Content API:** Node.js 22 and PostgreSQL with PostGIS.
- **Coordinates:** content data is stored in EPSG:3006 (SWEREF 99 TM). The map
  itself can use another projection; Origo reprojects the content layers.
- **Installations of the previous product name** keep working: the old file
  names, globals, control key, DOM ids and export format are still accepted
  (see the [upgrade guide](docs/upgrading-from-structuremaphelper.md)).

## License

`package.json` declares the MIT License. The `LICENSE` file, which names the
copyright holder, has not been added yet; it is pending a decision. Until it is
in place, contact the maintainers before redistributing. Third-party components
are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Reporting issues

Report bugs and feature requests as GitHub issues in
[Sundsvallskommun/origo-map-stories](https://github.com/Sundsvallskommun/origo-map-stories/issues).
Include the product version (from `GET <api base>/api/version`), the browser,
and the steps to reproduce. Do not post passwords, tokens, internal host names
or content you may not share.

Do not report security vulnerabilities in public issues; see
[docs/security.md](docs/security.md#reporting-a-vulnerability).
