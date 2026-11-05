# Rollback

<!-- How to return <installation name> to the previous product version.
Replace the placeholders. -->

## Before every deploy

- Keep the previous release in `.product/<previous version>/`.
- Tag the running content API image as `:previous` (container model), or keep
  the previous release folder (pm2 model).
- Keep backups of every file the deploy replaces (`<backup folder>`).
- Export the current content version.

## Roll back the product

1. Put back the previous plugin files, `gor-sa-har.json`, `img/` and the editor
   files from the backups (or from `.product/<previous version>/`).
2. Return the content API to the previous version:
   - container: re-tag `:previous` as the current image and recreate only the
     content API container;
   - pm2: start the previous release's server folder.
3. Reload the reverse proxy if its configuration changed.
4. Smoke checks: `/api/version` shows the previous version and `BUILD_SHA`.
5. Set `product.version` back to the previous version in git.

## Roll back content

Content changes are versions in the database; they do not need a deploy.

- An unwanted edit: *Sajtkonfiguration → Versionshistorik*, restore an
  earlier version (this creates a new version; nothing is lost).
- A damaged database: restore the latest `pg_dump` backup (product
  `docs/deployment.md#backup-and-restore`).

Check the product's `CHANGELOG.md` before rolling back across a version that
added database migrations: an older version may not work with the newer schema.
