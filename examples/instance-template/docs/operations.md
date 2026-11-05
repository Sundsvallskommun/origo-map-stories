# Operations

<!-- Day-to-day operation of <installation name>. Replace the placeholders. -->

## Contacts

| Role | Who |
|---|---|
| Content administrators | `<names / team>` |
| Technical owner | `<name / team>` |
| Web server / Origo site | `<team>` |
| Database | `<team>` |

## Upgrading the product

1. Read the product's `CHANGELOG.md` for the new version (migrations,
   changed defaults, breaking changes).
2. Update `PRODUCT_VERSION` and `PRODUCT_SHA256` in `product.version` in a
   pull request.
3. Export the current content version and back up the database.
4. Deploy to the test environment, run the smoke checks, check the map.
5. Deploy to production the same way.

## Checks

- Version: `curl -fsS <public URL>api/version` returns `{"sha": "...", "version": "..."}`.
- Content API logs: `<docker/podman logs ... | pm2 logs ...>`.
- The API log warns about database migrations it does not know when another
  installation with a newer version uses the same database.

## Backups

| What | How | Schedule | Kept | Restore tested |
|---|---|---|---|---|
| Database | `pg_dump -Fc` | `<nightly>` | `<30 days>` | `<date>` |
| Content export (zip) | *Sajtkonfiguration → Versionshistorik → Exportera* | before every upgrade | `<where>` | |

Restore: see the product's `docs/deployment.md#backup-and-restore`.

## Secrets

- `server.env` on `<host>:<path>`, `chmod 600`. Never in git.
- Rotate `JWT_SECRET` and `ADMIN_PASSWORD` when someone with access leaves or
  a value may have leaked. Changing `JWT_SECRET` logs out all administrators.
