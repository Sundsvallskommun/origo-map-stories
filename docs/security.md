# Security

## Secrets

The content API has two secrets, both set in its environment
(`content_server_node/.env` or the container's env file):

| Secret | Purpose |
|---|---|
| `ADMIN_PASSWORD` | The password administrators log in with |
| `JWT_SECRET` | Signs the admin tokens; anyone who knows it can create a valid token |

Rules:

- Unique per installation and environment. Never reuse a secret between test
  and production.
- Never in git. Installation repositories track `*.env.example` templates with
  placeholders only; the real files are `chmod 600` on the server.
- Generate `JWT_SECRET` randomly, at least 32 characters:
  `openssl rand -base64 48`.
- With `NODE_ENV=production` the API **refuses to start** if a secret is
  missing, still a placeholder (such as `change-me` or `<...>`), or if
  `JWT_SECRET` is shorter than 32 characters. `ALLOW_INSECURE_DEFAULTS=1`
  overrides the check with a loud warning; use it only in an emergency and
  remove it again.
- If a secret has been exposed (committed, pasted in a ticket, shared in a
  chat), rotate it. Changing `JWT_SECRET` invalidates all admin tokens;
  changing `ADMIN_PASSWORD` does not, so change both.
- `DATABASE_URL` contains the database password and is a secret too.

## The admin model

- There is **one administrator role and one shared password** per
  installation. There are no user accounts; anyone with the password can
  change all content. Share it only with the people who edit content, and
  change it when someone should no longer have access.
- Logging in (`POST /api/auth`) returns a JWT valid for **8 hours**. The
  browser stores it in `localStorage` (`cms_token`) and sends it as
  `Authorization: Bearer <token>` on writes.
- All write endpoints (texts, map layers, images, site configuration,
  versions, import/export) require the token. Reads of published content are
  public.
- The admin interface is only shown on the admin link (`?admin`) **and** with
  a valid token. A token left in the browser never turns the public link into
  an editor.
- Use HTTPS. The password and the token are otherwise sent in clear text.
- Every change creates a new version, so unwanted changes can be undone under
  *Sajtkonfiguration → Versionshistorik*. Back up the database as well.

There is no rate limiting on the login endpoint. If the site is on the
public internet, consider limiting `POST <base>/api/auth` in the reverse
proxy, or restricting the admin link to your network.

## The map editor and its URL parameters

The map editor (`editor.html`) uses the same admin token. It accepts
`?apiBase=` and `?config=` URL parameters, but **only when they point to the
editor's own origin**; other values are ignored with a console warning.
Otherwise a crafted link could make the editor send the admin token, or
uploaded data, to another server. The plugin passes its API base on to the
editor; if the API is on another origin, serve the editor from that origin
or proxy the API under the editor's origin.

## Content and uploads

- Uploaded images are limited to PNG, JPEG, GIF and WebP, up to 10 MB each;
  version imports up to 100 MB. Imports are validated (format, paths, path
  traversal, JSON and GeoJSON) before anything is written.
- Rich text is stored as TipTap JSON and displayed through the TipTap editor,
  which only renders the nodes and marks of its schema; the stored JSON is
  not inserted into the page as raw HTML.
- Use a Content-Security-Policy on the map page; see
  [deployment.md](deployment.md#content-security-policy).

## Database

- One database and one database user per installation. The user owns its
  database and is not a superuser.
- Development and tests use their own databases (`_dev`, `_test`); the test
  suites refuse any other database, and `OMS_STRICT_DEV_DB=1` makes the API
  refuse a non-development database outside production.

## Reporting a vulnerability

Do not report security problems in public issues. Use GitHub's private
vulnerability reporting for
[Sundsvallskommun/origo-map-stories](https://github.com/Sundsvallskommun/origo-map-stories/security)
(*Security → Report a vulnerability*). If that is not enabled, open an issue
that asks the maintainers for a private contact, without any details of the
problem.

Please include the affected version (`GET <api base>/api/version`), the steps
to reproduce, and the impact as you understand it. Do not test against
installations you do not operate.
