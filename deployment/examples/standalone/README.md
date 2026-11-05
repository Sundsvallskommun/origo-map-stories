# Stand-alone installation

Templates for a site where the content API (Node.js, run by pm2) also serves
the Origo site itself from `PUBLIC_DIR`.

| File | Use |
|---|---|
| `pm2.ecosystem.example.js` | Runs `server/content_server_node/server.js` from the unpacked release with `PUBLIC_DIR` pointing at the Origo site folder. |
| `nginx.conf.template` | Optional nginx server block in front of it (TLS, path prefix, `no-cache` for the plugin folder). Replace every `{{...}}` placeholder. |

The site folder holds Origo's build, `index.html`/`index.json` (see
`examples/minimal-map/` and `deployment/examples/existing-origo/*.snippet`),
the release's `plugin/` files under `plugins/` and its `editor/` files next to
`index.html`.

See the product documentation in `docs/` for the full installation guide.
