# Deployment

An Origo Map Stories installation has three parts:

1. **The plugin**: `origo-map-stories.min.js` and `.min.css`, plus `img/` and
   `gor-sa-har.json`, in the Origo site's `plugins/` folder.
2. **The map editor**: `editor.html`, `editor.js` and `editor-config.json`,
   served next to the map page (or where `editorUrl`/`basePath` points).
3. **The content API**: the Node.js server in `content_server_node/`, which
   answers `/api/*` and `/content-files/*` and stores everything in
   PostgreSQL/PostGIS.

All three come from the release zip. Its layout is described in
[release-layout.md](release-layout.md); deploy from a release, not from a
working copy. Installation-specific files (the Origo `index.html` and
`index.json`, theme, logos, proxy configuration, environment files) belong in
an installation repository, see [instances.md](instances.md).

There are two deployment models.

| | (a) Standalone | (b) Existing Origo |
|---|---|---|
| Origo | Installed by you, for this map | Already running, owned by someone else |
| Plugin files | In your Origo site's `plugins/` | Added to the existing site, usually in its own folder |
| Content API | pm2 process or container | Container (sidecar) behind the site's reverse proxy |
| Path | Often the site root (`/`) | Usually a path prefix (`/maps/stories/`) |

## Release zip

```bash
gh release download v1.0.0 -R Sundsvallskommun/origo-map-stories -p 'origo-map-stories-*.zip*'
sha256sum -c origo-map-stories-1.0.0.zip.sha256
unzip origo-map-stories-1.0.0.zip -d origo-map-stories-1.0.0
(cd origo-map-stories-1.0.0 && sha256sum -c SHA256SUMS)
```

The folders you need:

| Zip folder | Goes to |
|---|---|
| `plugin/` | The Origo site's `plugins/` folder (or a folder of its own) |
| `editor/` | Next to the map's `index.html` (adjust `editor-config.json`) |
| `server/` | The content API: a self-contained container build context |
| `deployment/` | Templates: container compose file, env file, nginx examples |
| `examples/` | A minimal map and the instance repository template |

The `instance-template` contains fetch scripts that download and verify a
pinned release.

## (a) Standalone: your own Origo and the content API

Build or download an Origo release and put its build output (`index.html`,
`js/`, `css/`, ...) in a web root. Then:

1. Copy `plugin/*` into `<web root>/plugins/` and `editor/*` into `<web root>/`.
2. Write `index.html` and `index.json` for your map (start from
   `examples/minimal-map/`), and register the plugin as `mapstories`.
3. Run the content API (below) and make `/api/` and `/content-files/` reach it
   from the same origin as the map.

### Running the API as a container

```bash
docker build -t origo-map-stories-api:1.0.0 origo-map-stories-1.0.0/server
cp origo-map-stories-1.0.0/deployment/container/content-api.env.example content-api.env
chmod 600 content-api.env            # then fill in real values
docker run -d --name oms-api --restart unless-stopped \
  --env-file content-api.env -p 127.0.0.1:3000:3000 origo-map-stories-api:1.0.0
```

Podman works the same way. `deployment/container/compose.example.yml` shows
the same as a compose file. The image's `BUILD_SHA` and `APP_VERSION` come from
the release, so `/api/version` reports exactly what is running.

### Running the API with pm2

Without containers, the API runs as a Node.js process from the release's
`server/` folder, and can also serve the Origo site itself from `PUBLIC_DIR`,
so one port serves both. `deployment/examples/standalone/pm2.ecosystem.example.js`
is a pm2 process file for this.

```
/opt/origo-map-stories/
├── releases/1.0.0/server/               the zip's server/ folder
│   ├── package.json, package-lock.json
│   ├── node_modules/                    npm ci --omit=dev
│   ├── content_server_node/.env         secrets, chmod 600
│   └── BUILD_SHA
└── site/                                PUBLIC_DIR: Origo build, index.html/json,
                                         plugins/ (plugin/*), editor/* next to index.html
```

```bash
cd /opt/origo-map-stories/releases/1.0.0/server
npm ci --omit=dev --no-audit --no-fund
BUILD_SHA=$(cat BUILD_SHA) pm2 start /opt/origo-map-stories/pm2.ecosystem.js
pm2 save
pm2 startup        # run the printed command once, to start pm2 at boot
```

After an upgrade, start the new release's process the same way (or
`pm2 restart <name> --update-env` with the new `BUILD_SHA`), so `/api/version`
shows the new commit. A reverse proxy in front for TLS is still recommended.

### Reverse proxy for a standalone site

`deployment/examples/standalone/nginx.conf.template` is an optional nginx
server block in front of the API. The essentials:

```nginx
location /api/           { proxy_pass http://127.0.0.1:3000; }
location /content-files/ { proxy_pass http://127.0.0.1:3000; }
location /plugins/       { add_header Cache-Control "no-cache" always; }
client_max_body_size 100m;   # version imports and image uploads
```

## (b) Existing Origo behind a reverse proxy with a base path

Use this when an Origo site is already running and you only add the plugin
and its API, for example under `https://maps.example.org/maps/stories/`.
Treat the existing installation as someone else's system:

- do not replace, rebuild or restart the existing Origo web server;
- change only the files you add (the plugin folder, `editor.*`) and the
  map's `index.html`/`index.json` in agreement with their owner;
- run the content API as a separate container that you can recreate on its
  own.

### Files

```
<existing site>/maps/stories/
├── index.html, index.json        the map (owned by the site; registers the plugin)
├── editor.html, editor.js, editor-config.json
└── origo-map-stories/            the plugin folder (plugin/* from the zip)
    ├── origo-map-stories.min.js, origo-map-stories.min.css
    ├── gor-sa-har.json
    └── img/
```

`deployment/examples/existing-origo/` contains the `index.html` and
`index.json` snippets. Because the map page is at `/maps/stories/`, the plugin
finds its API at `/maps/stories/api/...` with no options (see
[API base resolution](configuration.md#api-base-resolution)). Set
`PUBLIC_BASE_PATH=/maps/stories` in the API's environment so uploaded images
get URLs under the prefix.

### Reverse proxy

The proxy in front of the existing web server routes two prefixes to the
content API and strips the base path; everything else goes to the existing
site unchanged. `deployment/examples/existing-origo/nginx.conf.template`
follows this pattern (shown here with the placeholders filled in):

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;   # the container network's DNS; adjust
client_max_body_size 100m;

location /maps/stories/api/ {
  set $content_api http://content-api:3000;
  rewrite ^/maps/stories/api/(.*)$ /api/$1 break;
  proxy_pass $content_api;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location /maps/stories/content-files/ {
  set $content_api http://content-api:3000;
  rewrite ^/maps/stories/content-files/(.*)$ /content-files/$1 break;
  proxy_pass $content_api;
  proxy_set_header Host $host;
}

# The plugin keeps its file names between releases: make browsers and
# intermediate proxies revalidate instead of using a cached old copy.
location /maps/stories/origo-map-stories/ {
  set $site http://existing-origo:8080;
  proxy_pass $site;
  proxy_hide_header Cache-Control;
  add_header Cache-Control "no-cache" always;
}

location / {
  set $site http://existing-origo:8080;
  proxy_pass $site;
  proxy_set_header Host $host;
}
```

Notes:

- **Variables in `proxy_pass` plus a `resolver`** make nginx look up the
  container name per request. With a literal `proxy_pass http://content-api:3000`
  nginx resolves the name once at start-up, so recreating the API container
  (new IP) gives 502 errors, and a DNS gap during the recreate makes
  `nginx -t` fail with "host not found in upstream". The resolver is the
  container network's DNS server (for Docker `127.0.0.11`; for Podman the
  network gateway, see `podman network inspect <network>`).
- Do not make the proxy container depend on the API container
  (`depends_on`): recreating the API must not require recreating the proxy.
- Recreate only the API container on upgrades; never take down the whole
  compose project if it also runs the existing site.
- If the proxy configuration is a single-file bind mount, edit it in place
  (`cat new.conf > nginx.conf`) instead of replacing the file, or the container
  keeps seeing the old file. Validate with `nginx -t`, then `nginx -s reload`.

## Content-Security-Policy

If the map page sends a Content-Security-Policy (as a header or a `<meta>`
tag), it must allow what the plugin does:

| Directive | Needed for |
|---|---|
| `frame-src 'self'` | The map editor, which opens `editor.html` in an iframe. Without it "Redigera kartan" shows an empty frame. |
| `connect-src 'self'` (plus the API origin if it differs) | Calls to `/api/*` and `/content-files/*`, and `gor-sa-har.json`. Add WFS origins that Origo layers query. |
| `img-src 'self' data:` plus tile hosts | Uploaded images, the fallback images, and background tiles, e.g. `https://tile.openstreetmap.org` for OSM and your WMS hosts. |
| `style-src 'self' 'unsafe-inline'` | Inline styles set by Origo and the plugin. |
| `script-src 'self'` (plus what Origo itself needs) | The plugin script. |

`editor.html` is a separate page; if your server adds a CSP header to it, it
needs `connect-src` for the API and `img-src` for the editor's background
(OSM or your WMS). The minimal example's `index.html` contains a commented
example policy.

## Database

The content API needs **PostgreSQL with PostGIS**.

- **One database per installation.** This is strongly recommended. The
  database holds one site: one site configuration, one version history, one
  admin password. Two installations pointed at the same database share and
  overwrite each other's content. Only do this if they are meant to show the
  same content (for example a test and a production front end on purpose),
  and keep both on the same product version.
- Use a dedicated database user that owns the database and is not a
  superuser.
- **Migrations run automatically** when the API starts
  (`content_server_node/migrations/`), under a PostgreSQL advisory lock, so
  several API processes starting at once do not race. If the database has
  migrations the running build does not know, the API logs a warning: another
  installation with a newer version uses the same database.

Creating a database (as a superuser):

```sql
CREATE ROLE origo_map_stories LOGIN PASSWORD '<password>';
CREATE DATABASE origo_map_stories OWNER origo_map_stories;
\c origo_map_stories
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER SCHEMA public OWNER TO origo_map_stories;
```

Then set `DATABASE_URL=postgres://origo_map_stories:<password>@<db host>:5432/origo_map_stories`.
On first start the API creates its tables and logs that the database has no
content yet. An administrator can then build menus in the browser or import
an exported zip.

### Backup and restore

All content (texts, map layers, images, site configuration, every version)
is in the database. Nothing content-related is on the web server's disk, so a
deploy never overwrites content.

**Back up the database** regularly with `pg_dump`, for example nightly:

```bash
pg_dump -Fc -d "$DATABASE_URL" -f /backup/origo_map_stories_$(date +%F).dump
```

**Restore** into an empty database with the same name and owner:

```bash
# stop the content API first
createdb -O origo_map_stories origo_map_stories_restored
psql -d origo_map_stories_restored -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
pg_restore --no-owner --role=origo_map_stories -d origo_map_stories_restored /backup/origo_map_stories_2026-01-31.dump
# point DATABASE_URL at the restored database (or rename it), start the API
```

Test the restore procedure; a backup that has never been restored is not
known to work.

**Zip export and import** (*Sajtkonfiguration → Versionshistorik*) move one
content version between installations: export on one, import on the other.
An import always creates a new version, so the previous current version stays
available. The zip is readable: `site-config.json`, `layers/<name>/` with
`overlay.geojson`, `text.json` and a generated `text.html`, `images/` and
`site-assets/`. Exports are a convenient extra copy, but they hold only one
version; they do not replace database backups.

### Importing a legacy content folder

Very old installations stored content in a `content/` folder. Import it once
into an empty database:

```bash
node scripts/import-content-folder.js /path/to/content
# in a container, with the folder mounted at /app/content:
docker exec oms-api node scripts/import-content-folder.js /app/content
```

The script refuses to import into a database that already has content unless
`--force` is given; the current version is then kept as a backup version.

## Secrets

- Keep `content-api.env` / `content_server_node/.env` outside git, readable only
  by the service (`chmod 600`). Installation repositories track only
  `*.env.example` templates.
- Use `NODE_ENV=production` on every server. The API then refuses to start
  when `JWT_SECRET` or `ADMIN_PASSWORD` is missing or a placeholder, or when
  `JWT_SECRET` is shorter than 32 characters. Generate a secret with
  `openssl rand -base64 48`.
- Changing `JWT_SECRET` logs out every administrator.

See [security.md](security.md).

## Smoke checks after a deploy

Check through the public URL, so the checks see what users get (proxy, cache,
correct folder):

| Check | Catches |
|---|---|
| `GET <base>/api/version` returns the expected `version` and `sha` | The API still runs the old image or process (not rebuilt or not recreated) |
| `GET <base>/api/content-catalog` returns 200 | API down, database unreachable, proxy route broken |
| The served plugin script contains the release's `BUILD_SHA` (fetch it with a cache-busting query, e.g. `?check=<timestamp>`) | Plugin copied to the wrong folder, or an old copy served from a cache |
| The plugin script response has `Cache-Control: no-cache` | The proxy rule for the plugin folder is not active |
| `GET <base>/` and `<base>/editor.html` return 200 | Web server or proxy broken, editor not deployed |
| `GET <plugin folder>/gor-sa-har.json` returns 200 | Help text missing |

```bash
curl -fsS https://maps.example.org/maps/stories/api/version
# {"sha":"<40-character sha>","version":"1.0.0"}
curl -fsS "https://maps.example.org/maps/stories/origo-map-stories/origo-map-stories.min.js?check=$(date +%s)" \
  | grep -c "$(cat BUILD_SHA)"
```

In the browser console the plugin logs `OrigoMapStories build <sha>`, and
`window.OrigoMapStoriesBuild` holds the same value.

## "The old version is still served"

Lessons from earlier deployments; each one has a countermeasure that a
deploy script should apply:

| Cause | Countermeasure |
|---|---|
| The plugin was copied to a folder that is not the one the web server serves (a file share, a second copy of the web root, `plugins/` instead of the plugin folder) | Write to exactly one known path, then verify over HTTP that the served script contains the new `BUILD_SHA` |
| Browser or intermediate proxy cache: the file name did not change and no `?v=` was bumped | Serve the plugin folder with `Cache-Control: no-cache` (revalidate with ETag), and check the public URL with a cache-busting query |
| The API container kept its old image: `up` without a rebuild, or a build cache hit despite a new `BUILD_SHA` | Build without cache (or with the release's `BUILD_SHA` as build argument), recreate the container, then require `/api/version` to report the new SHA and version |
| The proxy configuration was replaced by a new file (new inode), so the single-file bind mount still showed the old one | Write the file in place, run `nginx -t`, reload |
| Taking down the whole compose project recreated (and upgraded) the existing site's web server | Recreate only the API container; record the web server container's start time and fail the deploy if it changes |
| 502 after recreating the API (nginx kept the old IP), or `host not found in upstream` during a DNS gap | `resolver` plus variables in `proxy_pass`; no `depends_on` from the proxy to the API; wait for DNS and retry `nginx -t`/reload |
| Checks such as `sleep 5` that never failed the deploy | Retry loops with a time limit, `set -euo pipefail`, and an automatic rollback with a non-zero exit code |

Keep the previous release (zip, container image tagged `:previous`, backups of
replaced files) until the new one has passed the smoke checks, so a rollback
is one step.
