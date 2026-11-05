# Installation repositories

The product repository contains no installation-specific material: no map
page of a real site, no theme, logos, host names, proxy configuration or
secrets. Each installation keeps those in **its own repository**, which pins
a product release and describes how that installation is deployed and run.

```
origo-map-stories                  the product (this repository): code, releases
<installation>                     one per installation: which release, map, theme, settings
<another installation>
```

Benefits:

- every installation upgrades on its own schedule, by changing one file;
- the product stays neutral and can be public, while an installation
  repository can be private if it contains internal host names;
- what runs where is reviewable: the pinned version and checksum, the
  configuration, and the deployment procedure are all in git.

## Creating an installation repository

The release zip and this repository contain a template in
[`examples/instance-template/`](../examples/instance-template/):

```
README.md                          what the installation is, owners, quick reference
product.version                    PRODUCT_VERSION=v1.0.0, PRODUCT_SHA256=<sha256 of the zip>
.gitignore                         *.env (except *.env.example), .product/, _incoming/
.gitattributes                     *.sh with LF line endings
environments/example/
  instance.env.example             non-secret settings per environment (URLs, paths, host)
  server.env.example               the content API's environment (secrets as placeholders)
site/README.md                     the map page: owned here, or by whom
theme/README.md, theme.example.css --oms-* tokens and images
config/editor-config.example.json  the map editor's background and start view
scripts/fetch-product.ps1          download + verify the pinned release (Windows PowerShell 5.1+)
scripts/fetch-product.sh           the same for bash
docs/installation.md               first installation, per environment
docs/operations.md                 contacts, upgrades, checks, backups, secrets
docs/rollback.md                   returning to the previous version
```

Steps:

1. Create an empty repository (private if it will hold internal host names or
   IP addresses) and copy the template into it.
2. Fill in `README.md`. Rename `environments/example/` after your
   environments (`test`, `production`) and fill in the `*.env.example` files
   with placeholders only.
3. Pin the release: set `PRODUCT_VERSION`, run the fetch script once with
   `PRODUCT_SHA256` empty, compare the printed digest with the `.sha256` file
   on the release page, and write it into `product.version`.
4. Add the map page (`site/`), the theme (`theme/theme.css`) and
   `config/editor-config.json`, or document who owns them.
5. Write the deploy procedure in `docs/installation.md`. Deploy scripts that
   you add should read `product.version` and `environments/<env>/instance.env`,
   install only from the verified `.product/<version>/` folder, and run the
   smoke checks in [deployment.md](deployment.md#smoke-checks-after-a-deploy).

## Pinning and fetching a release

`product.version`:

```
PRODUCT_VERSION=v1.0.0
PRODUCT_SHA256=<64 hex characters>
# PRODUCT_REPO=Sundsvallskommun/origo-map-stories
```

The fetch scripts:

```bash
scripts/fetch-product.sh                      # gh release download, verify, unpack
scripts/fetch-product.sh --bundle <zip>       # a zip downloaded in the browser
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1 -BundlePath <zip>
```

They download the release with
`gh release download $PRODUCT_VERSION -R Sundsvallskommun/origo-map-stories -p 'origo-map-stories-*.zip*'`
(or copy the given zip), then:

1. check the zip against its `.sha256` file, when present;
2. check the zip against `PRODUCT_SHA256` and stop on any difference (or
   print the digest and stop if it is not pinned yet);
3. unpack it into `.product/<version>/` (gitignored);
4. check that `VERSION` in the zip matches the pinned version, and verify
   every file against the zip's `SHA256SUMS`.

`gh` must be logged in (`gh auth login`); the product repository is public,
so no special permission is needed. Without `gh`, download the zip (and its
`.sha256`) from the release page and use `--bundle` / `-BundlePath`.

## Upgrading an installation

1. Read the product's `CHANGELOG.md` between the current and the new version.
2. In a branch, update `PRODUCT_VERSION` and `PRODUCT_SHA256`, and adjust
   configuration for any changed defaults.
3. Export the content and back up the database.
4. Deploy to a test environment, run the smoke checks, check the map.
5. Merge, then deploy to production.

Rollback is the same procedure with the previous `product.version`; see the
template's `docs/rollback.md`.

## What belongs where

| Item | Product repository | Installation repository |
|---|---|---|
| Plugin, editor, content API code | yes | no (downloaded from a release) |
| Neutral fallback images, `gor-sa-har.json` | yes | no |
| Container build context, generic templates (nginx, compose, pm2) | yes | copies adapted to the installation |
| `index.html`, `index.json` of the real map | no | yes, or a note on who owns them |
| Theme, logos, header image | no | yes (with licence information) |
| `editor-config.json` with the installation's background | no (example only) | yes |
| Host names, IP addresses, paths on servers | no | yes (private repository, or an untracked env file) |
| Secrets (`JWT_SECRET`, `ADMIN_PASSWORD`, database password) | no | no: only on the server |
| Content (texts, layers, images) | no | no: in the installation's database |
