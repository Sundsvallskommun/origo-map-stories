# Origo Map Stories content API.
#
# Build context: the server/ folder of the release zip, which holds this file
# together with package.json, package-lock.json, content_server_node/ and
# scripts/ (see docs/release-layout.md). From a checkout:
#
#   npm run release:zip
#   (unpack dist/origo-map-stories-<version>.zip, then)
#   docker build -t origo-map-stories-api <unpacked>/server
#
# Podman works the same way. Configuration comes from the environment at run
# time; see deployment/container/content-api.env.example.
FROM node:22.23.4-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY content_server_node/server.js content_server_node/store.js content_server_node/contentArchive.js content_server_node/siteConfig.js content_server_node/compat.js ./content_server_node/
COPY content_server_node/migrations ./content_server_node/migrations
# One-time import of a legacy content/ folder mounted at /app/content:
#   docker exec <container> node scripts/import-content-folder.js /app/content
COPY scripts/import-content-folder.js ./scripts/

# Release version and git SHA served by GET /api/version. In the release zip
# the defaults below are filled in from VERSION and BUILD_SHA by
# scripts/build-release.js; --build-arg overrides them. An empty APP_VERSION
# falls back to the version in package.json.
# Kept as the last layers so they never invalidate the dependency/source layers.
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
RUN echo "$BUILD_SHA" > /app/BUILD_SHA

EXPOSE 3000

CMD ["node", "content_server_node/server.js"]
