// Imports a legacy content/ folder (flat files) into the versioned database as
// one new version.
//
//   node scripts/import-content-folder.js <content-dir> [--force]
//
// Mapping:
//   site-config.json   -> site-config.json
//   <name>.geojson     -> layers/<name>/overlay.geojson
//   <name>.json        -> layers/<name>/text.json
//   images/<file>      -> images/<file>
//   site-assets/<file> -> site-assets/<file>
// Anything else (e.g. .qmd styles, _deleted/) is skipped.
//
// Refuses to run when the database already has content unless --force is
// given; the current version is then kept as a backup like any other import.
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', 'content_server_node', '.env') });
const store = require('../content_server_node/store');

const IMAGE_RE = /^[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/i;
const ASSET_RE = /^(header-image|button-icon|corner-logo)\.(png|jpe?g)$/i;

function safeLayerName(raw) {
  return raw.replace(/[/\\:*?"<>|.]/g, '_');
}

function collectFiles(dir) {
  const files = {};
  const skipped = [];

  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const pattern = { images: IMAGE_RE, 'site-assets': ASSET_RE }[entry.name];
      if (!pattern) { skipped.push(`${entry.name}/`); return; }
      fs.readdirSync(full).forEach(name => {
        if (pattern.test(name)) files[`${entry.name}/${name}`] = fs.readFileSync(path.join(full, name));
        else skipped.push(`${entry.name}/${name}`);
      });
      return;
    }

    const ext = path.extname(entry.name).toLowerCase();
    const base = path.basename(entry.name, path.extname(entry.name));
    if (entry.name === 'site-config.json') files['site-config.json'] = fs.readFileSync(full);
    else if (ext === '.geojson') files[`layers/${safeLayerName(base)}/overlay.geojson`] = fs.readFileSync(full);
    else if (ext === '.json') files[`layers/${safeLayerName(base)}/text.json`] = fs.readFileSync(full);
    else skipped.push(entry.name);
  });

  Object.entries(files).forEach(([p, data]) => {
    if (!/\.(geo)?json$/.test(p)) return;
    try {
      JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
    } catch (err) {
      throw new Error(`${p} is not valid JSON: ${err.message}`);
    }
  });

  return { files, skipped };
}

(async () => {
  const dir = process.argv[2];
  const force = process.argv.includes('--force');
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node scripts/import-content-folder.js <content-dir> [--force]');
    process.exit(1);
  }

  await store.init(process.env.DATABASE_URL);
  const { versionId: existing } = await store.getCurrentManifest();
  if (existing && !force) {
    console.error(`The database already has content (current version ${existing}). Use --force to import anyway.`);
    process.exit(1);
  }

  const { files, skipped } = collectFiles(path.resolve(dir));
  const { versionId } = await store.commitVersion({
    kind: 'migration',
    base: 'empty',
    description: `Importerad från mappen ${path.basename(path.resolve(dir))}`,
    changes: files
  });

  console.log(`Created version ${versionId} with ${Object.keys(files).length} files.`);
  Object.keys(files).sort().forEach(p => console.log(`  + ${p}`));
  if (skipped.length) {
    console.log('Skipped:');
    skipped.forEach(p => console.log(`  - ${p}`));
  }
  process.exit(0);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
