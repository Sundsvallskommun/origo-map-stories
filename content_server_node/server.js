require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const os = require('os');
const path = require('path');
const store = require('./store');
const { streamExport, parseImport } = require('./contentArchive');
const {
  SITE_CONFIG, safeLayerName, textPath, overlayPath,
  normalizeSiteConfig, ensureLayerFiles, dropRemovedLayers, describeLayer
} = require('./siteConfig');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const PUBLIC_BASE_PATH = (process.env.PUBLIC_BASE_PATH || '').replace(/\/$/, '');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && IMAGE_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new store.StoreError(400, 'Endast bilder (PNG, JPEG, GIF, WebP) är tillåtna'));
  }
});

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(cors({ exposedHeaders: ['ETag', 'Content-Disposition'] }));
app.use(express.json({ limit: '50mb' }));
// PUBLIC_DIR lets the UI tests serve an assembled site (Origo build + plugin).
app.use(express.static(process.env.PUBLIC_DIR || path.join(__dirname, '../public')));

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Optimistic locking: the client sends back the ETag it loaded. "none" means
// it loaded nothing (204), so the file must still not exist.
function expectFromIfMatch(req, filePath) {
  const header = req.get('If-Match');
  if (!header || header === '*') return {};
  const tag = header.replace(/^W\//, '').replace(/"/g, '').trim();
  return { [filePath]: tag === 'none' ? null : tag };
}

function sendFile(req, res, file, mime, cacheControl = 'no-cache') {
  res.set('ETag', `"${file.sha256}"`);
  res.set('Cache-Control', cacheControl);
  if (req.fresh) return res.status(304).end();
  res.type(mime).send(file.content);
}

function sendSaved(res, manifest, filePath, body = { ok: true }) {
  const hash = manifest.get(filePath);
  if (hash) res.set('ETag', `"${hash}"`);
  res.json(body);
}

// ─── Site configuration (rules in siteConfig.js) ────────────────────────────

app.get('/api/site-config', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const file = await store.getCurrentFile(SITE_CONFIG);
  if (!file) {
    res.set('ETag', '"none"');
    return res.json({});
  }
  res.set('ETag', `"${file.sha256}"`);
  res.type('application/json').send(file.content);
});

app.put('/api/site-config', verifyToken, async (req, res) => {
  const { manifest, result } = await store.commitVersion({
    kind: 'save',
    description: 'Sparade sajtkonfiguration',
    expect: expectFromIfMatch(req, SITE_CONFIG),
    changes: async ctx => {
      const changes = {};
      const oldConfig = await ctx.readJson(SITE_CONFIG);
      const config = await normalizeSiteConfig(req.body, ctx, changes);
      ensureLayerFiles(config, ctx, changes);
      dropRemovedLayers(oldConfig, config, ctx, changes);
      changes[SITE_CONFIG] = config;
      return { changes, result: config };
    }
  });
  sendSaved(res, manifest, SITE_CONFIG, { ok: true, config: result });
});

// Applies normalizeSiteConfig to the stored config once at startup, e.g. after
// an import of an older export.
async function migrateSiteConfig() {
  const file = await store.getCurrentFile(SITE_CONFIG);
  if (!file) return;
  const original = file.content.toString('utf8');
  await store.commitVersion({
    kind: 'migration',
    description: 'Uppdaterade sajtkonfigurationen till aktuellt format',
    expect: { [SITE_CONFIG]: file.sha256 },
    changes: async ctx => {
      const changes = {};
      const config = await normalizeSiteConfig(JSON.parse(original), ctx, changes);
      ensureLayerFiles(config, ctx, changes);
      if (JSON.stringify(config) !== JSON.stringify(JSON.parse(original))) changes[SITE_CONFIG] = config;
      if (!Object.keys(changes).length) throw Object.assign(new Error('no-op'), { noop: true });
      return { changes };
    }
  }).then(() => console.log('Migrated site-config.json to single submenu type'))
    .catch(err => { if (!err.noop) throw err; });
}

// ─── Version ────────────────────────────────────────────────────────────────

// The product version: APP_VERSION from the environment, else the version in
// package.json (next to content_server_node/ both in the repo and in the
// container image, /app/package.json).
let packageVersion;
function appVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  if (packageVersion === undefined) {
    try {
      packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || 'unknown';
    } catch {
      packageVersion = 'unknown';
    }
  }
  return packageVersion;
}

// Git SHA baked into the image (Dockerfile ARG BUILD_SHA) and the product
// version; the deploy smoke checks compare them with what they deployed.
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ sha: process.env.BUILD_SHA || 'dev', version: appVersion() });
});

// ─── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// ─── Layers: catalog, text, GeoJSON ─────────────────────────────────────────

app.get('/api/content-catalog', async (req, res) => {
  const layers = (await store.listCurrentPaths())
    .map(p => /^layers\/([^/]+)\/overlay\.geojson$/.exec(p))
    .filter(Boolean)
    .map(m => m[1])
    .sort((a, b) => a.localeCompare(b, 'sv'));
  res.set('Cache-Control', 'no-store');
  res.json({ layers });
});

app.get('/api/content/:layerName', async (req, res) => {
  const file = await store.getCurrentFile(textPath(safeLayerName(req.params.layerName)));
  res.set('Cache-Control', 'no-store');
  // No text yet is a normal state, not an error: 204 rather than 404, which
  // the browser would log as a failed request on every empty submenu.
  if (!file) {
    res.set('ETag', '"none"');
    return res.status(204).end();
  }
  res.set('ETag', `"${file.sha256}"`);
  res.type('application/json').send(file.content);
});

app.post('/api/content/:layerName', verifyToken, async (req, res) => {
  const name = safeLayerName(req.params.layerName);
  const p = textPath(name);
  const { manifest } = await store.commitVersion({
    kind: 'save',
    expect: expectFromIfMatch(req, p),
    changes: async ctx => ({
      changes: { [p]: JSON.stringify(req.body, null, 2) },
      description: `Sparade text: ${await describeLayer(ctx, name)}`
    })
  });
  sendSaved(res, manifest, p);
});

// GeoJSON read/write (used by the standalone GeoJSON editor)
app.get('/api/geojson/:layerName', async (req, res) => {
  const file = await store.getCurrentFile(overlayPath(safeLayerName(req.params.layerName)));
  res.set('Cache-Control', 'no-store');
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.set('ETag', `"${file.sha256}"`);
  res.type('application/json').send(file.content);
});

app.put('/api/geojson/:layerName', verifyToken, async (req, res) => {
  const name = safeLayerName(req.params.layerName);
  const p = overlayPath(name);
  const { manifest } = await store.commitVersion({
    kind: 'save',
    expect: expectFromIfMatch(req, p),
    changes: async ctx => ({
      changes: { [p]: JSON.stringify(req.body, null, 2) },
      description: `Sparade kartlager: ${await describeLayer(ctx, name)}`
    })
  });
  sendSaved(res, manifest, p);
});

// ─── Images and site assets ─────────────────────────────────────────────────

// Uploaded images are pending until a text that references them is saved;
// the text save then includes them in the new version.
app.post('/api/images', verifyToken, imageUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!req.file.size) return res.status(400).json({ error: 'Filen är tom' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const base = path.basename(req.file.originalname, ext).replace(/[^a-z0-9]/gi, '_');
  const filePath = `images/${Date.now()}-${base}${ext}`;
  await store.addPendingUpload(filePath, req.file.buffer);
  res.json({ url: `${PUBLIC_BASE_PATH}/content-files/${filePath}` });
});

const SITE_ASSETS = {
  'header-image': 'Toppbild',
  'button-icon': 'Menyknapp',
  'corner-logo': 'Hörnlogotyp'
};

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new store.StoreError(400, 'Endast bildfiler är tillåtna'));
  }
});

app.post('/api/site-assets/:assetType', verifyToken, (req, res, next) => {
  if (!SITE_ASSETS[req.params.assetType]) return res.status(400).json({ error: 'Unknown asset type' });
  next();
}, assetUpload.single('file'), async (req, res) => {
  const { assetType } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Ingen fil uppladdad' });
  if (!req.file.size) return res.status(400).json({ error: 'Filen är tom' });
  let ext = path.extname(req.file.originalname).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) ext = '.png';

  const changes = {};
  ['.png', '.jpg', '.jpeg'].forEach(e => { changes[`site-assets/${assetType}${e}`] = null; });
  changes[`site-assets/${assetType}${ext}`] = req.file.buffer;

  await store.commitVersion({ kind: 'save', description: `Ny bild: ${SITE_ASSETS[assetType]}`, changes });
  res.json({ url: `${PUBLIC_BASE_PATH}/content-files/site-assets/${assetType}${ext}` });
});

// ─── Public file URLs ───────────────────────────────────────────────────────
//
//   /content-files/<layer>.geojson     overlay of the current version
//   /content-files/images/<file>       image (current version, or pending upload)
//   /content-files/site-assets/<file>  site asset of the current version
//   /content-files/v/<sha256>          any stored file by content hash (immutable)

app.get('/content-files/*splat', async (req, res) => {
  const rel = [].concat(req.params.splat).join('/');

  const blobMatch = /^v\/([0-9a-f]{64})$/.exec(rel);
  if (blobMatch) {
    const file = await store.getBlob(blobMatch[1]);
    if (!file) return res.status(404).end();
    return sendFile(req, res, file, file.mime, 'public, max-age=31536000, immutable');
  }

  let filePath = null;
  if (/^[^/]+\.geojson$/.test(rel)) filePath = overlayPath(safeLayerName(rel.slice(0, -'.geojson'.length)));
  else if (/^(images|site-assets)\/[^/]+$/.test(rel)) filePath = rel;
  if (!filePath) return res.status(404).end();

  let file = await store.getCurrentFile(filePath);
  if (!file && filePath.startsWith('images/')) file = await store.getPendingFile(filePath);
  if (!file) return res.status(404).end();
  sendFile(req, res, file, store.mimeFor(filePath));
});

// ─── Versions ───────────────────────────────────────────────────────────────

function versionIdParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new store.StoreError(400, 'Ogiltigt versionsnummer');
  return id;
}

app.get('/api/versions', verifyToken, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ versions: await store.listVersions() });
});

app.delete('/api/versions/:id', verifyToken, async (req, res) => {
  await store.deleteVersion(versionIdParam(req));
  res.json({ ok: true });
});

// The restored content becomes a new version; the version that was current
// stays in the list as the backup.
app.post('/api/versions/:id/restore', verifyToken, async (req, res) => {
  const id = versionIdParam(req);
  const { versionId } = await store.commitVersion({
    kind: 'restore',
    base: id,
    description: `Återställd från version ${id}`,
    sourceVersion: id
  });
  res.json({ ok: true, versionId });
});

app.get('/api/versions/:id/export', verifyToken, async (req, res) => {
  const version = await store.getVersion(versionIdParam(req));
  if (!version) return res.status(404).json({ error: 'Versionen finns inte' });
  await streamExport(version, res, { server: req.get('host') || os.hostname() });
});

app.post('/api/versions/import', verifyToken, zipUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil uppladdad' });
  const { files, manifest, modified } = await parseImport(req.file.buffer);

  const src = manifest.source || {};
  let description = `Importerad: ${req.file.originalname}`;
  if (src.versionId) description += ` (v${src.versionId}${src.server ? ` från ${src.server}` : ''})`;
  if (modified.length) description += ` – manuellt ändrad (${modified.length} filer)`;

  const { versionId } = await store.commitVersion({ kind: 'import', base: 'empty', description, changes: files });
  res.json({ ok: true, versionId, modified });
});

// ─── Errors ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  // Multer's own messages are in English; the limit differs per upload route.
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Filen är för stor' : err.message;
  res.status(status).json({ error: status >= 500 ? 'Serverfel' : message, path: err.path });
});

// ─── Startup checks ─────────────────────────────────────────────────────────

// Values shipped in .env.example files and the code's own fallbacks. Real
// secrets never match these; values are compared, never printed.
const PLACEHOLDER_SECRET_RES = [
  /^fallback-secret$/i,
  /^change[-_]?me/i,
  /^replace[-_]?(with|me)/i,
  /^<.*>$/
];
const MIN_JWT_SECRET_LENGTH = 32;

function secretProblem(name, value) {
  if (!value) return `${name} is not set`;
  if (PLACEHOLDER_SECRET_RES.some(re => re.test(value.trim()))) return `${name} is still a placeholder value`;
  if (name === 'JWT_SECRET' && value.length < MIN_JWT_SECRET_LENGTH) return `JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters`;
  return null;
}

// Production refuses to start with missing or placeholder secrets, unless
// ALLOW_INSECURE_DEFAULTS=1. Runs before the database is touched.
function checkProductionSecrets(env) {
  if (env.NODE_ENV !== 'production') return true;
  const problems = ['JWT_SECRET', 'ADMIN_PASSWORD'].map(name => secretProblem(name, env[name])).filter(Boolean);
  if (!problems.length) return true;
  if (env.ALLOW_INSECURE_DEFAULTS === '1') {
    console.warn('⚠️  ⚠️  ⚠️  INSECURE: starting in production anyway because ALLOW_INSECURE_DEFAULTS=1:');
    problems.forEach(p => console.warn(`⚠️    - ${p}`));
    console.warn('⚠️  Anyone who knows the default values can log in as admin. Set real secrets in .env and remove ALLOW_INSECURE_DEFAULTS.');
    return true;
  }
  console.error('Refusing to start in production (NODE_ENV=production):');
  problems.forEach(p => console.error(`  - ${p}`));
  console.error(`Set JWT_SECRET (a random string of at least ${MIN_JWT_SECRET_LENGTH} characters) and ADMIN_PASSWORD in .env. ALLOW_INSECURE_DEFAULTS=1 overrides this check (not recommended).`);
  return false;
}

// Local development should use its own database, not a shared or production
// one: warn unless the database name ends with _dev, _test or _local, and
// refuse to start with OMS_STRICT_DEV_DB=1.
function checkDevelopmentDatabase(env) {
  if (env.NODE_ENV === 'production' || !env.DATABASE_URL) return true;
  let database;
  try {
    database = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  } catch {
    return true; // Not a URL; pg reports the problem itself.
  }
  if (/_(dev|test|local)$/.test(database)) return true;
  const message = `the database '${database}' does not end with _dev, _test or _local, but NODE_ENV is not 'production'. Local development should not use a shared or production database.`;
  if (env.OMS_STRICT_DEV_DB === '1') {
    console.error(`Refusing to start (OMS_STRICT_DEV_DB=1): ${message}`);
    return false;
  }
  console.warn(`⚠️  ⚠️  ⚠️  WARNING: ${message}`);
  return true;
}

// ─── Start ──────────────────────────────────────────────────────────────────

// Exported for the unit tests, which require() the app without starting it.
// pm2 (pm_id set) loads the script through its own wrapper, so it always starts.
module.exports = app;

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function startWithDatabaseRetry() {
  const maxAttempts = positiveIntegerEnv('DB_STARTUP_MAX_ATTEMPTS', 10);
  const initialDelayMs = positiveIntegerEnv('DB_STARTUP_RETRY_DELAY_MS', 1000);
  const maxDelayMs = positiveIntegerEnv('DB_STARTUP_MAX_DELAY_MS', 15000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await store.init(process.env.DATABASE_URL);
      const { versionId } = await store.getCurrentManifest();
      if (versionId) {
        await migrateSiteConfig();
        await store.rebuildAllFeatures();
        await store.gcBlobs();
      } else {
        console.warn('⚠️  The database has no content yet — run: node scripts/import-content-folder.js <content-dir>');
      }
      return;
    } catch (err) {
      await store.close().catch(() => {});
      if (attempt === maxAttempts) throw err;
      const delayMs = Math.min(maxDelayMs, initialDelayMs * (2 ** (attempt - 1)));
      console.warn(`Database startup attempt ${attempt}/${maxAttempts} failed: ${err.message}. Retrying in ${delayMs}ms.`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

if (require.main === module || process.env.pm_id !== undefined) (async () => {
  if (!checkProductionSecrets(process.env) || !checkDevelopmentDatabase(process.env)) process.exit(1);
  await startWithDatabaseRetry();
  // Express 5 passes listen errors (e.g. EADDRINUSE) to the callback instead
  // of throwing; without this check the process would exit with code 0 and
  // pm2 would restart it forever without logging an error.
  app.listen(PORT, err => {
    if (err) throw err;
    console.log(`Content server running on http://localhost:${PORT}`);
  });
})().catch(err => {
  console.error('Failed to start content server:', err.message);
  process.exit(1);
});
