# <Installation name>

<!-- Template for an Origo Map Stories installation repository. Copy this
folder into a new repository, replace every <...> placeholder, and delete
what you do not need. See docs/instances.md in the product repository. -->

This repository holds everything that is specific to one installation of
[Origo Map Stories](https://github.com/Sundsvallskommun/origo-map-stories):
which product release it runs, its map, theme, editor configuration,
environment settings and deployment procedure. The product itself is not
copied here; it is downloaded from a pinned release.

| Path | Contents |
|---|---|
| `product.version` | The product release this installation runs, and its sha256 |
| `environments/<env>/` | Settings per environment (`instance.env.example`, `server.env.example`) |
| `site/` | The map's `index.html` and `index.json`, or notes on who owns them |
| `theme/` | The installation's stylesheet (`--oms-*` tokens) and images |
| `config/` | `editor-config.json` and other plugin configuration |
| `scripts/` | `fetch-product.ps1` / `fetch-product.sh`: download and verify the pinned release |
| `docs/` | Installation, operations and rollback for this installation |

## Quick reference

```bash
scripts/fetch-product.sh                      # download + verify the pinned release into .product/
scripts/fetch-product.sh --bundle <zip>       # use a zip downloaded by hand
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1 -BundlePath <zip>
```

- Product version: see `product.version`.
- Environments: `<test>`, `<production>`.
- Owner and contacts: `<team, e-mail>`.
- Database: one database per environment, see `docs/operations.md`.

## Rules

- No secrets in git. Environment files with real values (`*.env`) are
  gitignored; only `*.env.example` templates are committed.
- Upgrade by changing `product.version` (version and sha256) in a pull
  request, then deploying it. Never edit product files in place.
- Changes to the product go to the product repository, not here.
