const test = require('node:test');
const assert = require('node:assert/strict');
const { streamExport, parseImport, textToHtml, FORMAT, ACCEPTED_FORMATS } = require('../contentArchive');
const { sha256 } = require('../store');
const { makeZip, exportToBuffer } = require('./helpers');

const json = value => Buffer.from(JSON.stringify(value, null, 2));

const TEXT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Rubrik' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Länk', marks: [{ type: 'mapFeatureLink', attrs: { featureId: 'A' } }] }] },
    { type: 'image', attrs: { src: '/maps/content-files/images/bild.png?v=1', alt: 'Bild' } }
  ]
};

const FILES = {
  'site-config.json': json({ menus: [] }),
  'layers/Lager/overlay.geojson': json({ type: 'FeatureCollection', features: [] }),
  'layers/Lager/text.json': json(TEXT),
  'images/bild.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'site-assets/button-icon.png': Buffer.from([1, 2, 3])
};

function version(files = FILES) {
  return {
    id: 7,
    created_at: new Date('2026-10-14T10:30:00Z'),
    kind: 'save',
    description: 'Test',
    files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content), size: content.length, content }))
  };
}

function manifest(files = FILES, extra = {}) {
  return json({
    format: 'origo-map-stories-content',
    formatVersion: 1,
    files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content), size: content.length })),
    ...extra
  });
}

const zipOf = (files, m = manifest(files)) => makeZip({ 'manifest.json': m, ...files });

async function rejects(buffer, message) {
  await assert.rejects(parseImport(buffer), err => {
    assert.equal(err.status, 400);
    assert.match(err.message, message);
    return true;
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

test('export round-trips through import unchanged', async () => {
  const { buffer, headers } = await exportToBuffer(streamExport, version());
  assert.match(headers['Content-Disposition'], /filename="origo-map-stories_v7_\d{4}-\d{2}-\d{2}_\d{4}\.zip"/);

  const { files, manifest: m, modified } = await parseImport(buffer);

  assert.deepEqual(Object.keys(files).sort(), Object.keys(FILES).sort());
  for (const [p, content] of Object.entries(FILES)) assert.deepEqual(files[p], content, p);
  assert.deepEqual(modified, []);
  assert.equal(m.source.versionId, 7);
  assert.equal(m.source.server, 'test');
});

test('export writes the origo-map-stories-content format', async () => {
  const { buffer } = await exportToBuffer(streamExport, version());
  const { manifest: m } = await parseImport(buffer);
  assert.equal(FORMAT, 'origo-map-stories-content');
  assert.equal(m.format, 'origo-map-stories-content');
  assert.equal(m.formatVersion, 1);
});

test('export adds a readable text.html and LÄSMIG.txt that import ignores', async () => {
  const { buffer } = await exportToBuffer(streamExport, version());
  const { files } = await parseImport(buffer);
  assert.equal(files['layers/Lager/text.html'], undefined);
  assert.equal(files['LÄSMIG.txt'], undefined);
});

// ─── text.html ───────────────────────────────────────────────────────────────

test('text.html renders headings, map links and local image paths', () => {
  const html = textToHtml('Lager', JSON.stringify(TEXT));
  assert.match(html, /<h1>Rubrik<\/h1>/);
  assert.match(html, /<span class="map-link" title="Kartlänk">Länk<\/span>/);
  assert.match(html, /<img src="\.\.\/\.\.\/images\/bild\.png" alt="Bild">/);
});

test('text.html escapes HTML in the text', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }] };
  const html = textToHtml('<b>Lager</b>', JSON.stringify(doc));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<title>&lt;b&gt;Lager&lt;\/b&gt;<\/title>/);
});

test('text.html is skipped for text that is not JSON', () => {
  assert.equal(textToHtml('Lager', 'inte json'), null);
});

// ─── Import validation ───────────────────────────────────────────────────────

test('import rejects a file that is not a zip', async () => {
  await rejects(Buffer.from('hej'), /inte en giltig zip-fil/);
});

test('import rejects a zip without manifest', async () => {
  await rejects(makeZip(FILES), /manifest\.json saknas – filen är inte en export från Origo Map Stories/);
});

test('import rejects an unknown format', async () => {
  await rejects(zipOf(FILES, json({ format: 'annat', formatVersion: 1 })), /Okänt format "annat" – filen är inte en export från Origo Map Stories/);
});

test('import accepts a legacy structuremaphelper-content export', async () => {
  const { files, manifest: m, modified } = await parseImport(zipOf(FILES, manifest(FILES, { format: 'structuremaphelper-content' })));
  assert.equal(m.format, 'structuremaphelper-content');
  assert.deepEqual(Object.keys(files).sort(), Object.keys(FILES).sort());
  assert.deepEqual(modified, []);
});

test('import accepts both the new and the legacy format id', async () => {
  assert.deepEqual(ACCEPTED_FORMATS, ['origo-map-stories-content', 'structuremaphelper-content']);
  for (const format of ACCEPTED_FORMATS) {
    const { files } = await parseImport(zipOf(FILES, manifest(FILES, { format })));
    assert.deepEqual(Object.keys(files).sort(), Object.keys(FILES).sort(), format);
  }
});

test('import rejects a newer format version', async () => {
  await rejects(zipOf(FILES, manifest(FILES, { formatVersion: 2 })), /Formatversion 2 stöds inte/);
});

test('import rejects path traversal', async () => {
  await rejects(zipOf({ ...FILES, '../evil.txt': 'x' }), /Zip-filen är skadad/);
});

test('import rejects absolute paths', async () => {
  await rejects(zipOf({ ...FILES, '/etc/passwd': 'x' }), /Zip-filen är skadad/);
});

test('import rejects files outside the allowed layout', async () => {
  await rejects(zipOf({ ...FILES, 'scripts/x.js': 'x' }), /Otillåtna filer i zip-filen: scripts\/x\.js/);
  await rejects(zipOf({ ...FILES, 'images/x.svg': '<svg/>' }), /Otillåtna filer/);
  await rejects(zipOf({ ...FILES, 'layers/a.b/text.json': '{}' }), /Otillåtna filer/);
  await rejects(zipOf({ ...FILES, 'site-assets/other.png': 'x' }), /Otillåtna filer/);
});

test('import requires site-config.json', async () => {
  const { 'site-config.json': _, ...rest } = FILES;
  await rejects(zipOf(rest), /site-config\.json saknas/);
});

test('import rejects invalid JSON', async () => {
  await rejects(zipOf({ ...FILES, 'layers/Lager/text.json': Buffer.from('{trasig') }), /layers\/Lager\/text\.json är inte giltig JSON/);
});

test('import rejects GeoJSON that is not a FeatureCollection', async () => {
  await rejects(zipOf({ ...FILES, 'layers/Lager/overlay.geojson': json({ type: 'Feature' }) }), /inte en GeoJSON FeatureCollection/);
});

test('import accepts JSON with a UTF-8 BOM (files saved in Windows editors)', async () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), FILES['site-config.json']]);
  const { files, modified } = await parseImport(zipOf({ ...FILES, 'site-config.json': withBom }, manifest(FILES)));
  assert.deepEqual(files['site-config.json'], FILES['site-config.json'], 'stored without the BOM');
  assert.deepEqual(modified, ['site-config.json'], 'the edit is still reported');
});

// ─── Hand-edited zips ────────────────────────────────────────────────────────

test('import reports changed and removed files as modified', async () => {
  const { 'images/bild.png': _, ...withoutImage } = FILES;
  const edited = { ...withoutImage, 'site-config.json': json({ menus: [], headerText: 'Ändrad' }) };
  const { modified } = await parseImport(zipOf(edited, manifest(FILES)));
  assert.deepEqual(modified.sort(), ['images/bild.png', 'site-config.json']);
});

test('import strips a common top folder (re-zipped folder)', async () => {
  const nested = Object.fromEntries(Object.entries({ 'manifest.json': manifest(), ...FILES }).map(([k, v]) => [`export/${k}`, v]));
  const { files, modified } = await parseImport(makeZip(nested));
  assert.deepEqual(Object.keys(files).sort(), Object.keys(FILES).sort());
  assert.deepEqual(modified, []);
});

test('import ignores operating-system junk files', async () => {
  const { files } = await parseImport(zipOf({ ...FILES, '__MACOSX/._x': 'x', '.DS_Store': 'x', 'images/Thumbs.db': 'x' }));
  assert.deepEqual(Object.keys(files).sort(), Object.keys(FILES).sort());
});
