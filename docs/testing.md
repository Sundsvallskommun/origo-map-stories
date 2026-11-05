# Testing

Two test suites, both against a separate **test database**:

| Suite | What | Run |
|---|---|---|
| Server unit tests (Node, `node:test`) | `store.js`, `contentArchive.js`, `siteConfig.js`, start-up checks | `npm run test:server` |
| UI tests (C#, Playwright + NUnit) | The real app in a browser, end to end | `dotnet test tests/OrigoMapStories.UiTests` |

Do not run the two at the same time: both wipe the test database.

What each suite covers, and how the UI tests are organised, is described in
[tests/README.md](https://github.com/Sundsvallskommun/origo-map-stories/blob/main/tests/README.md)
(in the repository; the tests are not part of the release zip).

## The test database guard

Both suites read `TEST_DATABASE_URL` and **refuse to run unless the database
name ends with `_test`**, because every test wipes it. Without a
`TEST_DATABASE_URL` the database-backed server tests are skipped.

Create the database once, as a superuser:

```sql
CREATE ROLE origo_map_stories_test LOGIN PASSWORD '<password>';
CREATE DATABASE origo_map_stories_test OWNER origo_map_stories_test;
\c origo_map_stories_test
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER SCHEMA public OWNER TO origo_map_stories_test;
```

Keep the role a normal user (not a superuser), so it has no access to any
real content database. A throwaway container works too:

```bash
docker run -d --name oms-test-db -e POSTGRES_PASSWORD=test -e POSTGRES_DB=origo_map_stories_test \
  -p 5433:5432 postgis/postgis:16-3.4
```

## `.runsettings`

Copy `tests/OrigoMapStories.UiTests/.runsettings.example` to `.runsettings` in
the same folder (it is gitignored) and fill in `TEST_DATABASE_URL`. The server
unit tests read the same file, so one setting serves both suites. An
environment variable `TEST_DATABASE_URL` takes precedence.

`.runsettings` also selects the browser (`chromium`, `firefox`, `webkit`) and
headless mode (`<Headless>false</Headless>` to watch the tests).

## UI tests: one-time setup

1. **Origo**, built once in `../origo`:

   ```bash
   git -C ../origo checkout "$(cat ci/origo.ref)"   # the commit CI uses
   (cd ../origo && npm ci && npm run build)
   ```

2. **The plugin and the editor**, rebuilt after every change to `index.js`,
   `src/` or `scss/` (the tests serve the built bundle, not the sources):

   ```bash
   npm run build
   npm run build-editor
   ```

3. **Browsers** for Playwright:

   ```powershell
   dotnet build tests/OrigoMapStories.UiTests
   powershell tests/OrigoMapStories.UiTests/bin/Debug/net10.0/playwright.ps1 install chromium
   ```

   On Linux or macOS use `pwsh` instead of `powershell`.

## Running

```bash
npm run test:server

dotnet test tests/OrigoMapStories.UiTests
dotnet test tests/OrigoMapStories.UiTests --filter "FullyQualifiedName~BasePathTests"
dotnet test tests/OrigoMapStories.UiTests -- Playwright.BrowserName=firefox
```

In Windows PowerShell the `--` arguments do not pass through reliably; set
the browser in `.runsettings` instead. In VS Code the tests can also be run
from the Testing view.

When a UI test fails, a Playwright trace is saved under
`tests/OrigoMapStories.UiTests/bin/Debug/net10.0/playwright-traces/`:

```powershell
powershell tests/OrigoMapStories.UiTests/bin/Debug/net10.0/playwright.ps1 show-trace <trace.zip>
```

The content server's output is printed with the failure.

## Neutrality check

`node scripts/check-neutral.js` (also run in CI) fails if organisation names,
internal host names or IP addresses appear outside the files that are allowed
to mention them (the compatibility layer, the legacy tests and the
[upgrade guide](upgrading-from-structuremaphelper.md)). Links to the upgrade
guide's file name are allowed anywhere. Run it before opening a pull request.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

1. starts a PostGIS service with a `_test` database;
2. checks out Origo at `ci/origo.ref` and builds it (cached per commit);
3. builds the plugin and the editor;
4. runs the server unit tests, the full UI suite and the neutrality check;
5. uploads the tested files as the `origo-map-stories-bundle` artifact.

A pull request should only be merged with a green CI run. Releases are built
from tagged commits, see [releasing.md](releasing.md).

## Known skipped tests

Some `PhoneLayoutTests` are marked `[Ignore]`: on a phone the layer panel and
the text panel sit side by side, leaving no width for the map. The tests
describe the wanted behaviour; remove the `Ignore` once a phone layout exists.
