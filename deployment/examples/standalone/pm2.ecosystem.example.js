// pm2 process file for a stand-alone installation: the content API also
// serves the Origo site (index.html, index.json, Origo's js/ and css/, the
// plugin and the editor) from PUBLIC_DIR, so no other web server is needed.
//
//   cd <unpacked release>/server && npm ci --omit=dev
//   pm2 start pm2.ecosystem.example.js
//
// Secrets (JWT_SECRET, ADMIN_PASSWORD, DATABASE_URL) do not belong here: put
// them in server/content_server_node/.env (see
// deployment/container/content-api.env.example for the variables). The
// server refuses to start in production with missing or placeholder secrets.
//
// Placeholders: {{INSTALL_DIR}} (where the release is unpacked), {{SITE_DIR}}
// (the Origo site folder), {{BASE_PATH}} (path prefix, empty for the root).
module.exports = {
  apps: [
    {
      name: 'origo-map-stories-api',
      cwd: '{{INSTALL_DIR}}/server',
      script: 'content_server_node/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        PUBLIC_DIR: '{{SITE_DIR}}',
        PUBLIC_BASE_PATH: '{{BASE_PATH}}'
      },
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
