# Releasing

## Versioning

Origo Map Stories uses [semantic versioning](https://semver.org/). The version
is the `version` field in `package.json`; tags are `v<version>` (for example
`v1.0.0`).

| Change | Version |
|---|---|
| Bug fixes, no change to options, API, export format or release layout | patch (`1.0.1`) |
| New options, new API endpoints, new files in the release zip, new database migrations that older versions tolerate | minor (`1.1.0`) |
| Removed or renamed options, API paths, legacy names or release zip paths; migrations older versions cannot run against; export format changes older versions cannot import | major (`2.0.0`) |

Database migrations deserve extra care: installations that share a database
(not recommended, see [deployment.md](deployment.md#database)) must be
upgraded together. Mention every migration in the changelog.

## Making a release

1. Make sure `main` is green in CI (`.github/workflows/ci.yml` runs on every
   push to `main` and on every pull request).
2. Update `CHANGELOG.md`: move the items under a new heading
   `## [x.y.z] - YYYY-MM-DD`. The release workflow uses this section as the
   release notes; the version must be the heading's first word after `##`.
3. Set `version` in `package.json` (and `package-lock.json`):
   `npm version x.y.z --no-git-tag-version`.
4. Build and check the package locally:

   ```bash
   npm ci
   npm run build && npm run build-editor
   npm run test:server
   npm run check:neutral
   dotnet test tests/OrigoMapStories.UiTests --settings tests/OrigoMapStories.UiTests/.runsettings
   npm run release:zip
   npm run release:verify
   ```

   The server tests and the UI suite need a `_test` database (see
   [testing.md](testing.md)); run them one after the other, since both wipe it.

   This writes `dist/origo-map-stories-x.y.z.zip` and its `.sha256`; see
   [release-layout.md](release-layout.md).
5. Commit, merge to `main` through a pull request, and wait for CI.
6. Tag the merged commit and push the tag:

   ```bash
   git tag -a vx.y.z -m "Origo Map Stories x.y.z"
   git push origin vx.y.z
   ```

7. `.github/workflows/release.yml` runs on the `v*` tag, in three jobs:
   - `check-tag` fails unless the tag (without `v`) equals `version` in
     `package.json`;
   - `ci` calls `ci.yml` with that version: neutrality check, plugin and
     editor build, server tests and the full UI suite against a throwaway
     PostGIS database, then `release:zip` and `release:verify` for the tagged
     commit (`BUILD_SHA` is the tag's commit), uploaded as the artifact
     `origo-map-stories-bundle`;
   - `release` downloads that artifact, checks it with `sha256sum -c`, takes
     the release notes from the version's `CHANGELOG.md` section (GitHub's
     generated notes if there is none), and creates the GitHub Release
     `Origo Map Stories x.y.z` with the zip and its `.sha256`
     (`gh release create --verify-tag`).

   Only the `release` job has write permission (`contents: write`); every
   other job and workflow is read-only (`contents: read`) and uses only the
   built-in `GITHUB_TOKEN`.
8. Check the release page: the zip, the `.sha256` file, and the release notes.

Installation repositories then pin the new version and checksum in their
`product.version` (see [instances.md](instances.md)). Do not replace the
assets of a published release; publish a new patch version instead, since
installations have pinned the checksum.

## Release contents

The zip holds the plugin under both its new and its legacy file names, the map
editor, a container build context for the content API, the documentation
(`README.md` and `docs/`), the examples and the deployment templates, plus
`VERSION`, `BUILD_SHA`, `SHA256SUMS`, the licence files and the changelog. The exact layout is a contract with installation
repositories; see [release-layout.md](release-layout.md) for what may change
in a minor or a major version.

## Maintainer access (GitHub)

The repository `Sundsvallskommun/origo-map-stories` lives in a GitHub
organisation. The steps
below describe a typical setup; the organisation's own policy takes
precedence where it differs.

- **Repository creation** is done by a person with the right to create
  repositories in the organisation. The repository is public; branch
  protection on `main` requires a pull request and a green CI run.
- **Maintainers from outside the organisation** are added as outside
  collaborators with the **Write** role on this repository only (not on the
  organisation). Write lets them push branches, merge pull requests and push
  release tags; repository settings stay with the organisation's admins.
- **Two-factor authentication** is required for everyone with write access.
- **Git authentication:** use HTTPS with
  [Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)
  (it stores a token after a browser login), or SSH with a key added to your
  GitHub account. Do not store personal access tokens in scripts or in the
  repository.
- **GitHub CLI** (`gh auth login`) is needed for `gh release` and `gh run`
  commands; installation repositories use it to download releases.
- **Secrets:** the release workflow uses only the built-in `GITHUB_TOKEN`. No
  deployment credentials are stored in this repository or its settings;
  deployments run from installation repositories.
