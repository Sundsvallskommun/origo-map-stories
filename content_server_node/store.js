// Versioned content store backed by PostgreSQL/PostGIS.
//
// Every change creates a new, complete version of the whole site: a manifest
// of path -> sha256 (version_file) pointing at deduplicated file contents
// (blob). current_version points at the live one. All writers take the same
// transaction-scoped advisory lock, so saves are serialized and a crash in the
// middle of a save rolls back instead of leaving a half-written state.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATION_LOCK_KEY = 73_590_000;
const WRITE_LOCK_KEY = 73_590_001;
const PENDING_UPLOAD_TTL = '24 hours';

const MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

// Image URLs inside texts and site-config, e.g. "/maps/content-files/images/123-a.png?v=1"
const IMAGE_REF_RE = /\/content-files\/(images\/[^"'?#\s)\\]+)/g;

class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

let pool = null;

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(JSON.stringify(data, null, 2), 'utf8');
}

function layerNameFromOverlayPath(p) {
  const m = /^layers\/([^/]+)\/overlay\.geojson$/.exec(p);
  return m ? m[1] : null;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function init(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString });
  await runMigrations();
}

// Several API instances (or a restart racing a still-running process) may
// start against the same database at once. A session-level advisory lock on
// the migrating client makes them migrate one at a time; the later one then
// finds every migration applied. Takes a pool so the tests can run it against
// a separate schema.
async function runMigrations(targetPool = pool) {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const client = await targetPool.connect();
  let destroyClient = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const { rows } = await client.query('SELECT name FROM schema_migrations');
      const applied = new Set(rows.map(r => r.name));
      for (const file of files) {
        if (applied.has(file)) continue;
        await client.query('BEGIN');
        try {
          await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Applied migration ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      warnUnknownMigrations(applied, files);
    } finally {
      // If the unlock fails the connection is closed instead of returned to
      // the pool, which releases the lock as well.
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => { destroyClient = true; });
    }
  } finally {
    client.release(destroyClient);
  }
}

// Migrations recorded in the database that this build does not have mean that
// another installation sharing the database runs newer code. Only logged: the
// schema is still expected to be compatible.
function warnUnknownMigrations(applied, files) {
  const known = new Set(files);
  const unknown = [...applied].filter(name => !known.has(name)).sort();
  if (unknown.length) {
    console.warn(`⚠️  The database has migrations this build does not know: ${unknown.join(', ')}. Another installation sharing this database probably runs a newer version.`);
  }
  return unknown;
}

async function withWriteLock(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK_KEY]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Low-level helpers (take a client) ───────────────────────────────────────

async function currentVersionId(client) {
  const { rows } = await client.query('SELECT version_id FROM current_version WHERE id = 1');
  return rows.length ? rows[0].version_id : null;
}

async function loadManifest(client, versionId) {
  const { rows } = await client.query('SELECT path, sha256 FROM version_file WHERE version_id = $1', [versionId]);
  return new Map(rows.map(r => [r.path, r.sha256]));
}

async function putBlob(client, filePath, data) {
  const buffer = toBuffer(data);
  const hash = sha256(buffer);
  await client.query(
    'INSERT INTO blob (sha256, content, mime, size) VALUES ($1, $2, $3, $4) ON CONFLICT (sha256) DO NOTHING',
    [hash, buffer, mimeFor(filePath), buffer.length]
  );
  return hash;
}

async function readBlobText(client, hash) {
  const { rows } = await client.query('SELECT content FROM blob WHERE sha256 = $1', [hash]);
  return rows.length ? rows[0].content.toString('utf8') : null;
}

// Keeps exactly the images that some text or the site-config references:
// unreferenced images are dropped from the version, referenced images that
// were just uploaded (pending) are added to it.
async function syncImages(client, manifest) {
  const referenced = new Set();
  for (const [p, hash] of manifest) {
    if (p === 'site-config.json' || p.endsWith('/text.json')) {
      const text = await readBlobText(client, hash);
      for (const m of (text || '').matchAll(IMAGE_REF_RE)) {
        try { referenced.add(decodeURIComponent(m[1])); } catch { referenced.add(m[1]); }
      }
    }
  }
  for (const p of [...manifest.keys()]) {
    if (p.startsWith('images/') && !referenced.has(p)) manifest.delete(p);
  }
  const missing = [...referenced].filter(p => !manifest.has(p));
  if (missing.length) {
    const { rows } = await client.query('SELECT path, sha256 FROM pending_upload WHERE path = ANY($1)', [missing]);
    rows.forEach(r => manifest.set(r.path, r.sha256));
  }
}

async function rebuildLayerFeatures(client, layerName, hash) {
  await client.query('DELETE FROM current_feature WHERE layer_name = $1', [layerName]);
  if (!hash) return;
  const text = await readBlobText(client, hash);
  await client.query('SAVEPOINT features');
  try {
    await client.query(`
      INSERT INTO current_feature (layer_name, feature_index, properties, geom)
      SELECT $1, (f.ord - 1)::int, f.feat->'properties',
             CASE WHEN jsonb_typeof(f.feat->'geometry') = 'object'
                  THEN ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(f.feat->>'geometry'), 3006))
             END
      FROM jsonb_array_elements(COALESCE($2::jsonb->'features', '[]'::jsonb)) WITH ORDINALITY AS f(feat, ord)`,
    [layerName, text]);
    await client.query('RELEASE SAVEPOINT features');
  } catch (err) {
    // A broken geometry must not block saving the overlay itself.
    await client.query('ROLLBACK TO SAVEPOINT features');
    console.warn(`current_feature: could not index layer "${layerName}": ${err.message}`);
  }
}

async function syncFeatures(client, before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const p of paths) {
    const layerName = layerNameFromOverlayPath(p);
    if (layerName && before.get(p) !== after.get(p)) {
      await rebuildLayerFeatures(client, layerName, after.get(p) || null);
    }
  }
}

// ─── Commit ──────────────────────────────────────────────────────────────────

// Creates a new version and makes it current.
//
//   kind           'save' | 'restore' | 'import' | 'migration'
//   description    shown in the version table
//   base           'current' (default), 'empty', or a version id to start from
//   changes        { path: Buffer|string|object|null } (null removes the path),
//                  or async (ctx) => ({ changes, description?, result? }) when
//                  the change depends on the locked current state
//   expect         { path: sha256|null } optimistic check against current;
//                  a mismatch throws a 409 StoreError
//   sourceVersion  for restore/import: the version it came from
async function commitVersion({ kind, description, base = 'current', changes = {}, expect = {}, sourceVersion = null }) {
  return withWriteLock(async client => {
    const currentId = await currentVersionId(client);
    const current = currentId ? await loadManifest(client, currentId) : new Map();

    for (const [p, expected] of Object.entries(expect)) {
      if ((current.get(p) || null) !== (expected || null)) {
        throw new StoreError(409, 'Någon annan har sparat ändringar i detta innehåll. Ladda om för att se dem.', { path: p });
      }
    }

    let manifest;
    if (base === 'empty') {
      manifest = new Map();
    } else if (typeof base === 'number') {
      const { rowCount } = await client.query('SELECT 1 FROM version WHERE id = $1', [base]);
      if (!rowCount) throw new StoreError(404, `Version ${base} finns inte`);
      manifest = await loadManifest(client, base);
    } else {
      manifest = new Map(current);
    }

    let finalDescription = description;
    let result;
    let changeSet = changes;
    if (typeof changes === 'function') {
      const ctx = {
        manifest,
        has: p => manifest.has(p),
        readText: async p => (manifest.has(p) ? readBlobText(client, manifest.get(p)) : null),
        readJson: async p => {
          const text = await ctx.readText(p);
          if (text == null) return null;
          try { return JSON.parse(text); } catch { return null; }
        }
      };
      const out = (await changes(ctx)) || {};
      changeSet = out.changes || {};
      if (out.description) finalDescription = out.description;
      result = out.result;
    }

    for (const [p, data] of Object.entries(changeSet)) {
      if (data === null) manifest.delete(p);
      else manifest.set(p, await putBlob(client, p, data));
    }

    if (kind === 'save') await syncImages(client, manifest);

    const { rows } = await client.query(
      'INSERT INTO version (kind, description, source_version) VALUES ($1, $2, $3) RETURNING id, created_at',
      [kind, finalDescription, sourceVersion]
    );
    const versionId = rows[0].id;
    await client.query(
      'INSERT INTO version_file (version_id, path, sha256) SELECT $1::int, * FROM unnest($2::text[], $3::text[])',
      [versionId, [...manifest.keys()], [...manifest.values()]]
    );
    await client.query(
      `INSERT INTO current_version (id, version_id) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET version_id = EXCLUDED.version_id`,
      [versionId]
    );
    await client.query('DELETE FROM pending_upload WHERE path = ANY($1)', [[...manifest.keys()]]);
    await syncFeatures(client, current, manifest);

    return { versionId, manifest, result };
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

async function getCurrentFile(filePath) {
  const { rows } = await pool.query(`
    SELECT b.content, b.sha256, b.mime
    FROM current_version c
    JOIN version_file f ON f.version_id = c.version_id AND f.path = $1
    JOIN blob b ON b.sha256 = f.sha256
    WHERE c.id = 1`, [filePath]);
  return rows[0] || null;
}

async function getPendingFile(filePath) {
  const { rows } = await pool.query(`
    SELECT b.content, b.sha256, b.mime
    FROM pending_upload p JOIN blob b ON b.sha256 = p.sha256
    WHERE p.path = $1`, [filePath]);
  return rows[0] || null;
}

async function getBlob(hash) {
  const { rows } = await pool.query('SELECT content, sha256, mime FROM blob WHERE sha256 = $1', [hash]);
  return rows[0] || null;
}

async function listCurrentPaths() {
  const { rows } = await pool.query(`
    SELECT f.path FROM current_version c
    JOIN version_file f ON f.version_id = c.version_id
    WHERE c.id = 1 ORDER BY f.path`);
  return rows.map(r => r.path);
}

async function getCurrentManifest() {
  const client = await pool.connect();
  try {
    const id = await currentVersionId(client);
    return { versionId: id, manifest: id ? await loadManifest(client, id) : new Map() };
  } finally {
    client.release();
  }
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

async function addPendingUpload(filePath, buffer) {
  return withWriteLock(async client => {
    const hash = await putBlob(client, filePath, buffer);
    await client.query(
      `INSERT INTO pending_upload (path, sha256) VALUES ($1, $2)
       ON CONFLICT (path) DO UPDATE SET sha256 = EXCLUDED.sha256, created_at = now()`,
      [filePath, hash]
    );
    return hash;
  });
}

// ─── Versions ────────────────────────────────────────────────────────────────

async function listVersions() {
  const { rows } = await pool.query(`
    SELECT v.id, v.created_at, v.kind, v.description, v.source_version,
           count(f.path)::int AS file_count,
           COALESCE(sum(b.size), 0)::bigint AS total_size,
           (v.id = (SELECT version_id FROM current_version WHERE id = 1)) AS is_current
    FROM version v
    LEFT JOIN version_file f ON f.version_id = v.id
    LEFT JOIN blob b ON b.sha256 = f.sha256
    GROUP BY v.id
    ORDER BY v.id DESC`);
  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    description: r.description,
    sourceVersion: r.source_version,
    fileCount: r.file_count,
    totalSize: Number(r.total_size),
    isCurrent: r.is_current
  }));
}

async function getVersion(versionId) {
  const { rows } = await pool.query('SELECT id, created_at, kind, description FROM version WHERE id = $1', [versionId]);
  if (!rows.length) return null;
  const files = await pool.query(`
    SELECT f.path, f.sha256, b.size, b.content
    FROM version_file f JOIN blob b ON b.sha256 = f.sha256
    WHERE f.version_id = $1 ORDER BY f.path`, [versionId]);
  return { ...rows[0], files: files.rows };
}

async function deleteVersion(versionId) {
  await withWriteLock(async client => {
    if (versionId === await currentVersionId(client)) {
      throw new StoreError(400, 'Den aktuella versionen kan inte raderas');
    }
    const { rowCount } = await client.query('DELETE FROM version WHERE id = $1', [versionId]);
    if (!rowCount) throw new StoreError(404, `Version ${versionId} finns inte`);
  });
  await gcBlobs();
}

// Removes file contents that no version and no fresh pending upload uses.
async function gcBlobs() {
  return withWriteLock(async client => {
    await client.query(`DELETE FROM pending_upload WHERE created_at < now() - interval '${PENDING_UPLOAD_TTL}'`);
    const { rowCount } = await client.query(`
      DELETE FROM blob b
      WHERE NOT EXISTS (SELECT 1 FROM version_file f WHERE f.sha256 = b.sha256)
        AND NOT EXISTS (SELECT 1 FROM pending_upload p WHERE p.sha256 = b.sha256)`);
    return rowCount;
  });
}

// Re-indexes every overlay of the current version into current_feature.
async function rebuildAllFeatures() {
  return withWriteLock(async client => {
    const id = await currentVersionId(client);
    const manifest = id ? await loadManifest(client, id) : new Map();
    await client.query('DELETE FROM current_feature');
    for (const [p, hash] of manifest) {
      const layerName = layerNameFromOverlayPath(p);
      if (layerName) await rebuildLayerFeatures(client, layerName, hash);
    }
  });
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = {
  StoreError,
  init,
  runMigrations,
  close,
  mimeFor,
  sha256,
  commitVersion,
  getCurrentFile,
  getPendingFile,
  getBlob,
  listCurrentPaths,
  getCurrentManifest,
  addPendingUpload,
  listVersions,
  getVersion,
  deleteVersion,
  gcBlobs,
  rebuildAllFeatures
};
