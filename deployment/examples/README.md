# Deployment examples

Configuration templates. Nothing here is used as is: copy a template into
your instance repository and replace every `{{...}}` placeholder.

- `existing-origo/` - add the plugin and the content API to an Origo site
  that already runs on its own web server (nginx proxy, `index.html` and
  `index.json` snippets).
- `standalone/` - the content API also serves the Origo site (pm2, optional
  nginx).
- `../container/` - the content API as a container (Dockerfile,
  `compose.example.yml`, `content-api.env.example`).
