const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const origo = path.join(root, '..', 'origo');

function copy(src, dest) {
  fs.copyFileSync(path.join(root, src), path.join(origo, dest));
  console.log(`copied ${src} → origo/${dest}`);
}

// Copy the app files: the neutral example map (examples/minimal-map), which
// loads plugins/origo-map-stories.js, and the map editor page.
copy('examples/minimal-map/index.html', 'index.html');
copy('examples/minimal-map/index.json', 'index.json');
copy('examples/minimal-map/editor-config.json', 'editor-config.json');
copy('public/editor.html', 'editor.html');

// Neutral fallback images (button icon, corner logo, header)
fs.mkdirSync(path.join(origo, 'plugins', 'img'), { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'public', 'img'))) {
  copy(`public/img/${file}`, `plugins/img/${file}`);
}

// Text shown under "Gör så här" when the database can't be reached
copy('public/gor-sa-har.json', 'plugins/gor-sa-har.json');

// Patch origo/tasks/webpack.dev.js to add proxy (idempotent)
const webpackPath = path.join(origo, 'tasks', 'webpack.dev.js');
const content = fs.readFileSync(webpackPath, 'utf8');

if (content.includes("context: ['/api'")) {
  console.log('webpack.dev.js already patched');
} else {
  const patched = content.replace(
    'port: 9966\n  }',
    `port: 9966,\n    proxy: [\n      {\n        context: ['/api', '/content-files'],\n        target: 'http://localhost:3000'\n      }\n    ]\n  }`
  );
  fs.writeFileSync(webpackPath, patched, 'utf8');
  console.log('webpack.dev.js patched with proxy config');
}
