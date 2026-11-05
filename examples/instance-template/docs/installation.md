# Installation

<!-- First-time installation of <installation name> in one environment.
Replace the placeholders; delete the model you do not use. The product's
docs/deployment.md describes both models in detail. -->

## Overview

| | |
|---|---|
| Environment | `<test / production>` |
| Public URL | `<https://maps.example.org/maps/stories/>` |
| Model | `<standalone / existing Origo site>` |
| Web server | `<host, who operates it>` |
| Content API | `<container / pm2 process>` on `<host>` |
| Database | `<database name>` on `<database host>` (one database per environment) |

## Prerequisites

- [ ] Access to the server (`<ssh user>`), and to `sudo` if needed.
- [ ] A PostgreSQL database with PostGIS, created by `<who>`:
  `CREATE EXTENSION postgis;`, owned by a dedicated non-superuser.
- [ ] `server.env` created on the server from
  `environments/<env>/server.env.example`, `chmod 600`.
- [ ] The map page owner has agreed to the changes in `site/` (CSP:
  `frame-src 'self'`, `connect-src`, `img-src`).

## Steps

1. Fetch and verify the product: `scripts/fetch-product.sh` (or
   `scripts\fetch-product.ps1`).
2. Copy `plugin/*` from `.product/<version>/` to `PLUGIN_DIR`, and
   `editor/editor.html` and `editor/editor.js` to `SITE_DIR`, plus
   `config/editor-config.json`.
3. Deploy the theme (`theme/theme.css`, `theme/img/`).
4. Build and start the content API from `.product/<version>/server/` with
   `server.env`.
5. Configure the reverse proxy (`/api/`, `/content-files/`, `no-cache` for the
   plugin folder).
6. Deploy or request the map page changes (`site/`).
7. Smoke checks: `/api/version` shows the pinned version and `BUILD_SHA`; the
   served plugin script contains `BUILD_SHA`; the map and `?admin` load.
8. Log in on `<public URL>?admin`, build menus or import a content export.

## Record

| Date | Version | Done by | Notes |
|---|---|---|---|
| `<yyyy-mm-dd>` | `<v1.0.0>` | `<name>` | |
