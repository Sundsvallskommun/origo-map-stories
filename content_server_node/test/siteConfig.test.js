const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeLayerName, textPath, overlayPath, configLayerNames,
  normalizeSiteConfig, ensureLayerFiles, dropRemovedLayers, describeLayer
} = require('../siteConfig');

// A fake commitVersion ctx over an in-memory { path: text } map.
function ctx(files = {}) {
  const manifest = new Map(Object.keys(files).map(p => [p, `sha-${p}`]));
  return {
    manifest,
    has: p => manifest.has(p),
    readText: async p => (p in files ? files[p] : null),
    readJson: async p => (p in files ? JSON.parse(files[p]) : null)
  };
}

test('safeLayerName strips path and filesystem characters but keeps åäö', () => {
  assert.equal(safeLayerName('Område mask'), 'Område mask');
  assert.equal(safeLayerName('../a/b\\c:d*e?f"g<h>i|j.k'), '___a_b_c_d_e_f_g_h_i_j_k');
});

test('paths of a layer', () => {
  assert.equal(textPath('X'), 'layers/X/text.json');
  assert.equal(overlayPath('X'), 'layers/X/overlay.geojson');
});

test('configLayerNames collects all submenu layers', () => {
  const names = configLayerNames({ menus: [{ items: [{ layerName: 'A' }, { layerName: 'B' }] }, { items: [{}] }] });
  assert.deepEqual([...names], ['A', 'B']);
  assert.equal(configLayerNames(null).size, 0);
});

test('normalize gives new submenus their own layer and keeps existing ones', async () => {
  const changes = {};
  const out = await normalizeSiteConfig({
    headerText: 'X',
    menus: [{ id: 'm', items: [{ id: 'new1', label: 'Ny' }, { id: 'old', label: 'Gammal', layerName: 'Befintlig' }] }]
  }, ctx(), changes);

  assert.equal(out.headerText, 'X');
  assert.deepEqual(out.menus[0].items.map(i => i.layerName), ['undermeny_new1', 'Befintlig']);
  assert.deepEqual(changes, {});
});

test('normalize strips retired submenu types', async () => {
  const out = await normalizeSiteConfig({
    menus: [{ id: 'm', items: [{ id: 'i', layerName: 'L', type: 'maplayers', mapLayers: ['x'] }] }]
  }, ctx(), {});
  assert.deepEqual(out.menus[0].items[0], { id: 'i', layerName: 'L' });
});

test('normalize copies legacy maplayers text to the new layer', async () => {
  const legacy = textPath('maplayers__m__i');
  const changes = {};
  await normalizeSiteConfig({ menus: [{ id: 'm', items: [{ id: 'i', type: 'maplayers' }] }] },
    ctx({ [legacy]: '{"type":"doc"}' }), changes);
  assert.deepEqual(changes, { [textPath('undermeny_i')]: '{"type":"doc"}' });
});

test('normalize does not overwrite an existing text with legacy text', async () => {
  const changes = {};
  await normalizeSiteConfig({ menus: [{ id: 'm', items: [{ id: 'i', type: 'maplayers' }] }] },
    ctx({ [textPath('maplayers__m__i')]: 'gammal', [textPath('undermeny_i')]: 'ny' }), changes);
  assert.deepEqual(changes, {});
});

test('normalize handles a config without menus', async () => {
  const out = await normalizeSiteConfig({}, ctx(), {});
  assert.deepEqual(out.menus, []);
});

test('ensureLayerFiles creates empty overlays only where missing', () => {
  const changes = {};
  ensureLayerFiles({ menus: [{ items: [{ layerName: 'Finns' }, { layerName: 'Saknas' }] }] },
    ctx({ [overlayPath('Finns')]: '{}' }), changes);

  assert.deepEqual(Object.keys(changes), [overlayPath('Saknas')]);
  const gj = changes[overlayPath('Saknas')];
  assert.equal(gj.type, 'FeatureCollection');
  assert.deepEqual(gj.features, []);
  assert.equal(gj.crs.properties.name, 'urn:ogc:def:crs:EPSG::3006');
});

test('dropRemovedLayers removes every file of removed submenus only', () => {
  const changes = {};
  const files = {
    [overlayPath('Kvar')]: '{}', [textPath('Kvar')]: '{}',
    [overlayPath('Bort')]: '{}', [textPath('Bort')]: '{}',
    'images/x.png': ''
  };
  dropRemovedLayers(
    { menus: [{ items: [{ layerName: 'Kvar' }, { layerName: 'Bort' }] }] },
    { menus: [{ items: [{ layerName: 'Kvar' }] }] },
    ctx(files), changes);
  assert.deepEqual(changes, { [overlayPath('Bort')]: null, [textPath('Bort')]: null });
});

test('dropRemovedLayers does nothing without an old config', () => {
  const changes = {};
  dropRemovedLayers(null, { menus: [] }, ctx({ [overlayPath('A')]: '{}' }), changes);
  assert.deepEqual(changes, {});
});

test('describeLayer uses menu and submenu labels', async () => {
  const c = ctx({ 'site-config.json': JSON.stringify({ menus: [{ label: 'Trafik', items: [{ label: 'Buss', layerName: 'L' }] }] }) });
  assert.equal(await describeLayer(c, 'L'), 'Trafik › Buss');
  assert.equal(await describeLayer(c, 'Okänd'), 'Okänd');
  assert.equal(await describeLayer(ctx(), 'L'), 'L');
});
