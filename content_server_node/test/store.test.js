// Tests for the versioned store against the test database (TEST_DATABASE_URL
// or the UI tests' .runsettings). The database is wiped before every test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const store = require('../store');
const { testDatabaseUrl, TABLES } = require('./helpers');

const url = testDatabaseUrl();
const skip = url ? false : 'TEST_DATABASE_URL is not set';
let db;

const json = v => JSON.stringify(v);
const textWithImage = src => json({ type: 'doc', content: [{ type: 'image', attrs: { src } }] });
const count = async sql => Number((await db.query(sql)).rows[0].count);

test.before(async () => {
  if (skip) return;
  await store.init(url);
  db = new Client({ connectionString: url });
  await db.connect();
});

test.after(async () => {
  if (skip) return;
  await db.end();
  await store.close();
});

test.beforeEach(async () => {
  if (skip) return;
  await db.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
});

async function seed() {
  return store.commitVersion({
    kind: 'migration',
    description: 'seed',
    base: 'empty',
    changes: {
      'site-config.json': json({ menus: [] }),
      'layers/A/overlay.geojson': json({ type: 'FeatureCollection', features: [] }),
      'layers/A/text.json': json({ type: 'doc', content: [] })
    }
  });
}

test('a commit creates a complete version and makes it current', { skip }, async () => {
  const { versionId } = await seed();
  assert.equal(versionId, 1);

  const file = await store.getCurrentFile('layers/A/text.json');
  assert.equal(file.content.toString(), json({ type: 'doc', content: [] }));
  assert.equal(file.sha256, store.sha256(Buffer.from(json({ type: 'doc', content: [] }))));
  assert.deepEqual(await store.listCurrentPaths(), ['layers/A/overlay.geojson', 'layers/A/text.json', 'site-config.json']);
});

test('every version is a full snapshot; identical content is stored once', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'b', changes: { 'layers/A/text.json': json({ v: 2 }) } });

  assert.equal(await count('SELECT count(*) FROM version_file WHERE version_id = 2'), 3);
  assert.equal(await count('SELECT count(*) FROM blob'), 4, 'only the changed file adds a blob');
});

test('a stale expectation is refused with 409 and nothing is saved', { skip }, async () => {
  await seed();
  const { sha256: before } = await store.getCurrentFile('layers/A/text.json');
  await store.commitVersion({ kind: 'save', description: 'other admin', changes: { 'layers/A/text.json': json({ v: 'x' }) } });

  await assert.rejects(
    store.commitVersion({ kind: 'save', description: 'me', expect: { 'layers/A/text.json': before }, changes: { 'layers/A/text.json': json({ v: 'y' }) } }),
    err => err instanceof store.StoreError && err.status === 409 && err.path === 'layers/A/text.json');
  assert.equal(await count('SELECT count(*) FROM version'), 2);
});

test('expecting "no file" fails when the file was created meanwhile', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'x', expect: { 'layers/B/text.json': null }, changes: { 'layers/B/text.json': '{}' } });
  await assert.rejects(
    store.commitVersion({ kind: 'save', description: 'y', expect: { 'layers/B/text.json': null }, changes: { 'layers/B/text.json': '{"a":1}' } }),
    { status: 409 });
});

test('null in changes removes a file from the new version only', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'rm', changes: { 'layers/A/text.json': null } });
  assert.equal(await store.getCurrentFile('layers/A/text.json'), null);
  assert.equal(await count("SELECT count(*) FROM version_file WHERE version_id = 1 AND path = 'layers/A/text.json'"), 1);
});

test('saving a text adds the pending images it uses and drops unused ones', { skip }, async () => {
  await seed();
  await store.addPendingUpload('images/1-a.png', Buffer.from('a'));
  await store.addPendingUpload('images/2-b.png', Buffer.from('b'));

  await store.commitVersion({ kind: 'save', description: 'img', changes: { 'layers/A/text.json': textWithImage('/maps/content-files/images/1-a.png?v=3') } });
  let paths = await store.listCurrentPaths();
  assert.ok(paths.includes('images/1-a.png'), 'used image is added (prefix and query ignored)');
  assert.ok(!paths.includes('images/2-b.png'), 'unused pending image is not');
  assert.equal(await count("SELECT count(*) FROM pending_upload WHERE path = 'images/1-a.png'"), 0);

  await store.commitVersion({ kind: 'save', description: 'no img', changes: { 'layers/A/text.json': json({ type: 'doc' }) } });
  paths = await store.listCurrentPaths();
  assert.ok(!paths.includes('images/1-a.png'), 'image no longer used is dropped');
});

test('images referenced from the site-config are kept', { skip }, async () => {
  await seed();
  await store.addPendingUpload('images/logo.png', Buffer.from('l'));
  await store.commitVersion({ kind: 'save', description: 'cfg', changes: { 'site-config.json': json({ logo: '/content-files/images/logo.png' }) } });
  assert.ok((await store.listCurrentPaths()).includes('images/logo.png'));
});

test('restore and import do not prune images', { skip }, async () => {
  await store.commitVersion({ kind: 'import', description: 'imp', base: 'empty', changes: { 'site-config.json': '{}', 'images/orphan.png': 'x' } });
  assert.ok((await store.listCurrentPaths()).includes('images/orphan.png'));
});

test('restoring a version copies its exact manifest into a new version', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'b', changes: { 'layers/A/text.json': json({ v: 2 }), 'layers/B/text.json': '{}' } });

  const { versionId } = await store.commitVersion({ kind: 'restore', base: 1, description: 'r', sourceVersion: 1 });

  assert.equal(versionId, 3);
  const diff = await count('SELECT count(*) FROM ((SELECT path, sha256 FROM version_file WHERE version_id = 1) EXCEPT (SELECT path, sha256 FROM version_file WHERE version_id = 3)) d');
  assert.equal(diff, 0);
  assert.equal(await count('SELECT count(*) FROM version_file WHERE version_id = 3'), 3);
});

test('restoring a missing version is a 404', { skip }, async () => {
  await seed();
  await assert.rejects(store.commitVersion({ kind: 'restore', base: 99, description: 'r' }), { status: 404 });
});

test('the current version cannot be deleted; others can, and their unused blobs go', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'b', changes: { 'layers/A/text.json': json({ only: 'in v2' }) } });
  await store.commitVersion({ kind: 'save', description: 'c', changes: { 'layers/A/text.json': json({ v: 3 }) } });

  await assert.rejects(store.deleteVersion(3), { status: 400 });
  await assert.rejects(store.deleteVersion(42), { status: 404 });

  const blobs = await count('SELECT count(*) FROM blob');
  await store.deleteVersion(2);
  assert.equal(await count('SELECT count(*) FROM version'), 2);
  assert.equal(await count('SELECT count(*) FROM blob'), blobs - 1);
});

test('stale pending uploads are garbage-collected, fresh ones kept', { skip }, async () => {
  await seed();
  await store.addPendingUpload('images/old.png', Buffer.from('old'));
  await store.addPendingUpload('images/new.png', Buffer.from('new'));
  await db.query("UPDATE pending_upload SET created_at = now() - interval '2 days' WHERE path = 'images/old.png'");

  await store.gcBlobs();

  assert.equal(await store.getPendingFile('images/old.png'), null);
  assert.ok(await store.getPendingFile('images/new.png'));
});

test('version list reports file count, size and the current version', { skip }, async () => {
  await seed();
  await store.commitVersion({ kind: 'save', description: 'b', changes: { 'x/y.json': '12345' } });
  const versions = await store.listVersions();
  assert.deepEqual(versions.map(v => [v.id, v.isCurrent, v.fileCount]), [[2, true, 4], [1, false, 3]]);
  assert.ok(versions[0].totalSize > versions[1].totalSize);
});

// ─── current_feature (PostGIS) ────────────────────────────────────────────────

const fc = features => json({ type: 'FeatureCollection', features });
const point = (x, y, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [x, y] } });

test('overlays are indexed into current_feature in EPSG:3006', { skip }, async () => {
  await store.commitVersion({ kind: 'save', description: 'f', base: 'empty', changes: { 'layers/A/overlay.geojson': fc([point(600000, 6900000, { n: 1 }), point(610000, 6910000)]) } });

  const { rows } = await db.query("SELECT feature_index, properties, ST_SRID(geom) srid, ST_X(geom) x FROM current_feature WHERE layer_name = 'A' ORDER BY feature_index");
  assert.deepEqual(rows.map(r => [r.feature_index, r.srid, r.x]), [[0, 3006, 600000], [1, 3006, 610000]]);
  assert.deepEqual(rows[0].properties, { n: 1 });
});

test('3D coordinates are stored as 2D', { skip }, async () => {
  await store.commitVersion({ kind: 'save', description: 'f', base: 'empty', changes: { 'layers/A/overlay.geojson': fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [600000, 6900000, 12] } }]) } });
  assert.equal(Number((await db.query("SELECT ST_NDims(geom) d FROM current_feature")).rows[0].d), 2);
});

test('a broken geometry does not block saving the overlay', { skip }, async () => {
  const broken = fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: 'trasig' } }]);
  await store.commitVersion({ kind: 'save', description: 'f', base: 'empty', changes: { 'layers/B/overlay.geojson': broken, 'layers/A/overlay.geojson': fc([point(1, 2)]) } });

  assert.ok(await store.getCurrentFile('layers/B/overlay.geojson'), 'file saved');
  assert.equal(await count("SELECT count(*) FROM current_feature WHERE layer_name = 'B'"), 0);
  assert.equal(await count("SELECT count(*) FROM current_feature WHERE layer_name = 'A'"), 1, 'other layers still indexed');
});

test('features without geometry are kept with a null geom', { skip }, async () => {
  await store.commitVersion({ kind: 'save', description: 'f', base: 'empty', changes: { 'layers/A/overlay.geojson': fc([{ type: 'Feature', properties: { a: 1 }, geometry: null }]) } });
  assert.equal(await count('SELECT count(*) FROM current_feature WHERE geom IS NULL'), 1);
});

test('removing an overlay or restoring updates current_feature', { skip }, async () => {
  await store.commitVersion({ kind: 'save', description: 'v1', base: 'empty', changes: { 'layers/A/overlay.geojson': fc([point(1, 2)]) } });
  await store.commitVersion({ kind: 'save', description: 'v2', changes: { 'layers/A/overlay.geojson': null } });
  assert.equal(await count('SELECT count(*) FROM current_feature'), 0);

  await store.commitVersion({ kind: 'restore', description: 'r', base: 1 });
  assert.equal(await count('SELECT count(*) FROM current_feature'), 1);
});

test('rebuildAllFeatures re-creates the index from the current version', { skip }, async () => {
  await store.commitVersion({ kind: 'save', description: 'v1', base: 'empty', changes: { 'layers/A/overlay.geojson': fc([point(1, 2), point(3, 4)]) } });
  await db.query('DELETE FROM current_feature');
  await store.rebuildAllFeatures();
  assert.equal(await count('SELECT count(*) FROM current_feature'), 2);
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

test('concurrent commits are serialized and none is lost', { skip }, async () => {
  await seed();
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    store.commitVersion({ kind: 'save', description: `c${i}`, changes: { [`layers/L${i}/text.json`]: json({ i }) } })));

  const versions = await store.listVersions();
  assert.equal(versions.length, 11);
  const paths = await store.listCurrentPaths();
  for (let i = 0; i < 10; i++) assert.ok(paths.includes(`layers/L${i}/text.json`), `L${i} kept`);
});

test('a failing commit rolls back completely', { skip }, async () => {
  await seed();
  await assert.rejects(store.commitVersion({
    kind: 'save',
    description: 'fails',
    changes: async () => { throw new Error('boom'); }
  }), /boom/);
  assert.equal(await count('SELECT count(*) FROM version'), 1);
  assert.equal((await store.getCurrentManifest()).versionId, 1);
});
