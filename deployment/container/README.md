# Container

| File | Use |
|---|---|
| `Dockerfile` | The content API image. In the release zip it is `server/Dockerfile`, and `server/` is the complete build context: `docker build server/`. |
| `compose.example.yml` | Runs the content API from the unpacked release (`content-api` service only). |
| `content-api.env.example` | The API's environment. Copy to `content-api.env` and replace every value; the placeholders are rejected in production. |

From a checkout, build the release first (`npm run build`, `npm run
build-editor`, `npm run release:zip`) and build the image from the zip's
`server/` folder. The repository root is not a build context.
