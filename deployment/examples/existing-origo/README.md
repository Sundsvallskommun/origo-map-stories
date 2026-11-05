# Existing Origo site

Templates for adding Origo Map Stories to an Origo site that already runs on
its own web server. The content API runs as a container
(`deployment/container/`) and nginx sits in front of both.

| File | Use |
|---|---|
| `nginx.conf.template` | nginx proxy: `{{BASE_PATH}}/api/` and `{{BASE_PATH}}/content-files/` to the content API, the rest to the existing Origo server, `no-cache` for the plugin folder. Replace every `{{...}}` placeholder. |
| `index.html.snippet` | The stylesheet, script tag and control registration to add to the site's `index.html`, plus the CSP sources the plugin needs. |
| `index.json.snippet` | The `mapstories` control entry and its options for `index.json`. |

`apiBase` can be left out when `index.html` is served from the same folder as
the API (`{{BASE_PATH}}/`): the plugin then uses the page's folder.

See the product documentation in `docs/` for the full installation guide.
