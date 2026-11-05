#!/usr/bin/env node
// Builds the release package described in docs/release-layout.md:
//
//   dist/origo-map-stories-<version>.zip
//   dist/origo-map-stories-<version>.zip.sha256
//
// Usage:
//   node scripts/build-release.js [--version <v>] [--sha <sha>] [--out <dir>]
//   node scripts/build-release.js --verify [<zip>]
//
// The build outputs must exist first (npm run build && npm run build-editor).
// The version defaults to package.json; a leading "v" (tag name) is dropped.
// BUILD_SHA is --sha, else GITHUB_SHA, else `git rev-parse HEAD`, else "dev".
// --verify checks a built zip (default: the one for package.json's version).
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const archiver = require('archiver');
const yauzl = require('yauzl');

const ROOT = path.join(__dirname, '..');
const NAME = 'origo-map-stories';
// Fixed entry timestamp, so the same inputs give the same zip.
const ENTRY_DATE = new Date('2000-01-01T00:00:00Z');

// The legacy file names are byte-identical copies (scripts/copy-legacy-names.js).
const LEGACY_COPIES = [
  ['plugin/origo-map-stories.min.js', 'plugin/structure-map-helper.min.js'],
  ['plugin/origo-map-stories.min.css', 'plugin/structure-map-helper.css']
];

const SERVER_SOURCES = [
  'content_server_node/server.js',
  'content_server_node/store.js',
  'content_server_node/contentArchive.js',
  'content_server_node/siteConfig.js',
  'content_server_node/compat.js',
  'scripts/import-content-folder.js'
];

// Optional root documents: a warning, not an error, when missing.
const ROOT_DOCS = ['README.md', 'LICENSE', 'THIRD_PARTY_LICENSES.md', 'CHANGELOG.md'];

// Entries every package must contain (checked by --verify).
const REQUIRED = [
  'VERSION', 'BUILD_SHA', 'SHA256SUMS',
  'plugin/origo-map-stories.min.js', 'plugin/origo-map-stories.min.css',
  'plugin/structure-map-helper.min.js', 'plugin/structure-map-helper.css',
  'plugin/gor-sa-har.json',
  'plugin/img/button-icon.png', 'plugin/img/corner-logo.png', 'plugin/img/header.png',
  'editor/editor.html', 'editor/editor.js', 'editor/editor-config.example.json',
  'server/Dockerfile', 'server/package.json', 'server/package-lock.json', 'server/BUILD_SHA',
  ...SERVER_SOURCES.map(p => `server/${p}`),
  'examples/minimal-map/index.html', 'examples/minimal-map/index.json',
  'docs/configuration.md', 'docs/deployment.md', 'docs/release-layout.md',
  'docs/upgrading-from-structuremaphelper.md',
  'deployment/container/Dockerfile',
  'deployment/container/compose.example.yml',
  'deployment/container/content-api.env.example'
];

// Never shipped: secrets, source maps, tests, dependencies.
const FORBIDDEN = [
  /(^|\/)\.env$/, /\.env\.(?!example$)[^/]*$/, /(^|\/)[^/]*\.env$/,
  /\.map$/, /(^|\/)node_modules\//, /(^|\/)test\//, /\.\.(\/|$)/, /^\//
];

function fail(message) {
  console.error(`build-release: ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
  const args = { verify: null, version: null, sha: null, out: path.join(ROOT, 'dist') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value`);
      return next;
    };
    if (arg === '--verify') {
      args.verify = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else if (arg === '--version') args.version = value();
    else if (arg === '--sha') args.sha = value();
    else if (arg === '--out') args.out = path.resolve(value());
    else fail(`unknown argument ${arg}`);
  }
  return args;
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function resolveVersion(arg) {
  const version = (arg || packageVersion()).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail(`"${version}" is not a valid version`);
  return version;
}

function resolveSha(arg) {
  if (arg) return arg;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

// All files below dir (repo-relative), sorted; skips the given names.
function walk(dir, skip = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel, skip));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

// ─── Build ──────────────────────────────────────────────────────────────────

function collectEntries(version, sha) {
  const entries = new Map(); // zip path -> Buffer
  const missing = [];
  const add = (zipPath, source) => {
    const abs = path.join(ROOT, source);
    if (!fs.existsSync(abs)) { missing.push(source); return; }
    entries.set(zipPath, fs.readFileSync(abs));
  };
  const text = (zipPath, value) => entries.set(zipPath, Buffer.from(`${value}\n`, 'utf8'));

  text('VERSION', version);
  text('BUILD_SHA', sha);
  for (const doc of ROOT_DOCS) {
    if (fs.existsSync(path.join(ROOT, doc))) add(doc, doc);
    else console.warn(`build-release: warning: ${doc} is missing and is left out of the package`);
  }

  // plugin/
  add('plugin/origo-map-stories.min.js', 'build/js/origo-map-stories.min.js');
  add('plugin/origo-map-stories.min.css', 'build/css/origo-map-stories.min.css');
  add('plugin/structure-map-helper.min.js', 'build/js/structure-map-helper.min.js');
  add('plugin/structure-map-helper.css', 'build/css/structure-map-helper.css');
  add('plugin/gor-sa-har.json', 'public/gor-sa-har.json');
  for (const file of walk('public/img')) add(`plugin/img/${path.posix.basename(file)}`, file);

  // editor/
  add('editor/editor.html', 'public/editor.html');
  add('editor/editor.js', 'build/editor/editor.js');
  add('editor/editor-config.example.json', 'examples/minimal-map/editor-config.json');

  // server/: a self-contained Docker build context.
  add('server/package.json', 'package.json');
  add('server/package-lock.json', 'package-lock.json');
  for (const source of SERVER_SOURCES) add(`server/${source}`, source);
  for (const file of walk('content_server_node/migrations')) add(`server/${file}`, file);
  text('server/BUILD_SHA', sha);
  const dockerfile = path.join(ROOT, 'deployment/container/Dockerfile');
  if (fs.existsSync(dockerfile)) entries.set('server/Dockerfile', Buffer.from(stampDockerfile(fs.readFileSync(dockerfile, 'utf8'), version, sha), 'utf8'));
  else missing.push('deployment/container/Dockerfile');

  // docs/, examples/ and deployment/ (the docs travel with the zip, so links
  // from the examples to ../../docs/ work offline)
  for (const file of walk('docs')) add(file, file);
  for (const file of walk('examples')) add(file, file);
  for (const file of walk('deployment/container')) add(file, file);
  for (const file of walk('deployment/examples')) add(file, file);

  if (missing.length) {
    fail(`missing inputs (run \`npm run build\` and \`npm run build-editor\` first):\n  ${missing.join('\n  ')}`);
  }
  for (const [from, to] of LEGACY_COPIES) {
    if (!entries.get(from).equals(entries.get(to))) fail(`${to} differs from ${from}; rerun \`npm run build\``);
  }
  for (const name of entries.keys()) {
    if (FORBIDDEN.some(re => re.test(name)) && !name.endsWith('.env.example')) fail(`refusing to package ${name}`);
  }
  return entries;
}

// Fills the Dockerfile's ARG defaults, so `docker build server/` reports the
// packaged version and commit without extra --build-arg flags.
function stampDockerfile(source, version, sha) {
  let stamped = source;
  for (const [name, value] of [['APP_VERSION', version], ['BUILD_SHA', sha]]) {
    const re = new RegExp(`^ARG ${name}=.*$`, 'm');
    if (!re.test(stamped)) fail(`deployment/container/Dockerfile has no "ARG ${name}=" line`);
    stamped = stamped.replace(re, `ARG ${name}=${value}`);
  }
  return stamped;
}

function sumsFile(entries) {
  return [...entries.keys()].sort()
    .map(name => `${sha256(entries.get(name))}  ${name}\n`).join('');
}

async function writeZip(file, entries) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(file);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.pipe(output);
    for (const name of [...entries.keys()].sort()) {
      archive.append(entries.get(name), { name, date: ENTRY_DATE, mode: 0o644 });
    }
    archive.finalize();
  });
}

async function build(args) {
  const version = resolveVersion(args.version);
  const sha = resolveSha(args.sha);
  if (version !== packageVersion()) {
    console.warn(`build-release: warning: version ${version} differs from package.json (${packageVersion()})`);
  }
  const entries = collectEntries(version, sha);
  entries.set('SHA256SUMS', Buffer.from(sumsFile(entries), 'utf8'));

  fs.mkdirSync(args.out, { recursive: true });
  const zipName = `${NAME}-${version}.zip`;
  const zipFile = path.join(args.out, zipName);
  await writeZip(zipFile, entries);
  const digest = sha256(fs.readFileSync(zipFile));
  fs.writeFileSync(`${zipFile}.sha256`, `${digest}  ${zipName}\n`);

  console.log(`build-release: ${path.relative(process.cwd(), zipFile)} (${entries.size} files, BUILD_SHA ${sha})`);
  console.log(`build-release: sha256 ${digest}`);
  return zipFile;
}

// ─── Verify ─────────────────────────────────────────────────────────────────

function readZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            if (entries.has(entry.fileName)) return reject(new Error(`duplicate entry ${entry.fileName}`));
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function verify(zipFile) {
  if (!fs.existsSync(zipFile)) fail(`${zipFile} does not exist; run \`npm run release:zip\` first`);
  const problems = [];
  const entries = await readZip(zipFile);
  const textOf = name => (entries.has(name) ? entries.get(name).toString('utf8').trim() : '');

  for (const name of REQUIRED) if (!entries.has(name)) problems.push(`missing ${name}`);
  for (const doc of ROOT_DOCS) if (!entries.has(doc)) console.warn(`build-release: warning: package has no ${doc}`);
  if (![...entries.keys()].some(n => /^server\/content_server_node\/migrations\/.+\.sql$/.test(n))) {
    problems.push('no SQL migrations under server/content_server_node/migrations/');
  }
  for (const name of entries.keys()) {
    if (FORBIDDEN.some(re => re.test(name)) && !name.endsWith('.env.example')) problems.push(`forbidden entry ${name}`);
  }

  // SHA256SUMS: every other file exactly once, with a matching digest.
  const listed = new Map();
  for (const line of textOf('SHA256SUMS').split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) { problems.push(`malformed SHA256SUMS line: ${line}`); continue; }
    listed.set(match[2], match[1]);
  }
  for (const [name, buffer] of entries) {
    if (name === 'SHA256SUMS') continue;
    if (!listed.has(name)) problems.push(`${name} is not in SHA256SUMS`);
    else if (listed.get(name) !== sha256(buffer)) problems.push(`${name} does not match SHA256SUMS`);
  }
  for (const name of listed.keys()) if (!entries.has(name)) problems.push(`SHA256SUMS lists missing ${name}`);

  for (const [from, to] of LEGACY_COPIES) {
    if (entries.has(from) && entries.has(to) && !entries.get(from).equals(entries.get(to))) {
      problems.push(`${to} is not byte-identical to ${from}`);
    }
  }

  const version = textOf('VERSION');
  const sha = textOf('BUILD_SHA');
  if (!sha) problems.push('BUILD_SHA is empty');
  if (textOf('server/BUILD_SHA') !== sha) problems.push('server/BUILD_SHA differs from BUILD_SHA');
  const expectedName = `${NAME}-${version}.zip`;
  if (path.basename(zipFile) !== expectedName) problems.push(`file name should be ${expectedName} for VERSION ${version}`);
  const dockerfile = textOf('server/Dockerfile');
  if (!new RegExp(`^ARG APP_VERSION=${version.replace(/\./g, '\\.')}$`, 'm').test(dockerfile)) problems.push('server/Dockerfile ARG APP_VERSION does not match VERSION');
  if (!dockerfile.split('\n').some(l => l.trim() === `ARG BUILD_SHA=${sha}`)) problems.push('server/Dockerfile ARG BUILD_SHA does not match BUILD_SHA');

  const sumFile = `${zipFile}.sha256`;
  if (!fs.existsSync(sumFile)) problems.push(`${path.basename(sumFile)} is missing`);
  else {
    const expected = `${sha256(fs.readFileSync(zipFile))}  ${path.basename(zipFile)}`;
    if (fs.readFileSync(sumFile, 'utf8').trim() !== expected) problems.push(`${path.basename(sumFile)} does not match the zip`);
  }

  if (problems.length) {
    console.error(`build-release: ${path.basename(zipFile)} FAILED verification:`);
    problems.forEach(p => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log(`build-release: ${path.basename(zipFile)} OK (${entries.size} files, VERSION ${version}, BUILD_SHA ${sha})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verify) {
    const zipFile = args.verify === true
      ? path.join(args.out, `${NAME}-${resolveVersion(args.version)}.zip`)
      : path.resolve(args.verify);
    await verify(zipFile);
  } else {
    await build(args);
  }
}

main().catch(err => fail(err.stack || err.message));
