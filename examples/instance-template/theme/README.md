# Theme

The installation's look: colours, font and images. The product stylesheet is
neutral; this folder adapts it.

| File | Use |
|---|---|
| `theme.example.css` | Copy to `theme.css`. Overrides the `--oms-*` tokens and, if needed, styles the plugin's DOM hooks. |
| `img/` | Logos and header image, if they are deployed as files rather than uploaded in the site configuration. |

How it is applied:

- Load `theme.css` **after** the plugin stylesheet in `index.html`.
- Images can be set in three ways; the first one that is present wins:
  1. uploaded by an administrator in *Sajtkonfiguration* (stored in the
     database, part of every version);
  2. the plugin options `assets.buttonIcon`, `assets.cornerLogo`,
     `assets.headerImage` in `index.json`;
  3. the product's neutral fallback images.
- If you set `--oms-header-image` here, use an absolute or root-relative URL:
  the URL is resolved against the plugin stylesheet, not this file.
- Image requirements: button icon PNG with transparency, 38×49 or 76×98 px;
  corner logo PNG with transparency, 240×82 or 480×164 px; header image
  portrait.

Record the licence or permission for every logo and image you add here.
