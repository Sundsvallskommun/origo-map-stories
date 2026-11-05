#!/usr/bin/env node
// Checks that the product stays neutral: no instance names, host names, IP
// ranges, user names or legacy product names outside the files that exist to
// handle the legacy names (compatibility code, legacy tests, upgrade docs).
//
// Scans every file git tracks or would track (`git ls-files -co
// --exclude-standard`), skipping binary files. Prints file:line:match for
// each hit and exits 1 if there are any.
//
//   npm run check:neutral
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const PATTERNS = [
  /sundsvall/i,
  /hsopublik/i,
  /\brvn\b/i,
  /rvn[-_]/i,
  /v[äa]sternorrland/i,
  /192\.168\./,
  /195\.252\./,
  /kartatest/i,
  /sdas730/i,
  /SUKMAndDah/i,
  /anders@/i,
  /\/home\/anders/i,
  /kartpiloten/i,
  /\boden\b/i,
  /structure.?map.?helper/i,
  /strukturkarta/i
];

// Allowed occurrences, removed from a line before it is checked: the
// product's own repository name, and the file name of the upgrade guide (so
// any document can link to it).
const ALLOWED_TEXT = [/Sundsvallskommun\/origo-map-stories/gi, /upgrading-from-structuremaphelper\.md/gi];

// Files that may mention the legacy names: compatibility code, legacy tests
// and the upgrade documentation.
const ALLOWED_FILES = [
  'src/compat.js',
  'content_server_node/compat.js',
  'scripts/copy-legacy-names.js',
  'scripts/build-release.js',
  'scripts/check-neutral.js',
  'tests/OrigoMapStories.UiTests/Infrastructure/TestServer.cs',
  'tests/**/LegacyCompatibilityTests.cs',
  'tests/**/Fixtures/site/legacy.html',
  'tests/**/ExportImportTests.cs',
  'content_server_node/test/contentArchive.test.js',
  'docs/upgrading-from-structuremaphelper.md',
  // Specifies the legacy plugin file names in the release zip.
  'docs/release-layout.md',
  'CHANGELOG.md',
  // Pending decision D7 (attribution of the original developer).
  'THIRD_PARTY_LICENSES.md'
];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.xcf', '.psd', '.pdf',
  '.zip', '.gz', '.tgz', '.7z', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.dll', '.exe'
]);

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const ALLOWED_FILE_RES = ALLOWED_FILES.map(globToRegExp);

function listFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))].sort();
}

function isBinary(file, buffer) {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  return buffer.subarray(0, 8000).includes(0);
}

function isDoc(file) {
  return file.endsWith('.md') || file.startsWith('docs/');
}

function scan() {
  const hits = [];
  for (const file of listFiles()) {
    if (ALLOWED_FILE_RES.some(re => re.test(file))) continue;
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue; // deleted but still tracked
    const buffer = fs.readFileSync(abs);
    if (isBinary(file, buffer)) continue;
    buffer.toString('utf8').split(/\r?\n/).forEach((line, index) => {
      const checked = ALLOWED_TEXT.reduce((text, re) => text.replace(re, ''), line);
      for (const pattern of PATTERNS) {
        const match = pattern.exec(checked);
        if (match) hits.push({ file, line: index + 1, match: match[0], text: line.trim() });
      }
    });
  }
  return hits;
}

const hits = scan();
if (!hits.length) {
  console.log('check-neutral: no hits');
  process.exit(0);
}
const groups = [
  ['Documentation', hits.filter(h => isDoc(h.file))],
  ['Code and configuration', hits.filter(h => !isDoc(h.file))]
];
for (const [title, list] of groups) {
  if (!list.length) continue;
  console.log(`${title}:`);
  for (const h of list) console.log(`  ${h.file}:${h.line}:${h.match}    ${h.text.slice(0, 160)}`);
}
console.error(`check-neutral: ${hits.length} hit(s) in ${new Set(hits.map(h => h.file)).size} file(s)`);
process.exit(1);
