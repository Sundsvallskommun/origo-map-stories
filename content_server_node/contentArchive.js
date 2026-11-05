// Export/import of one content version as a readable zip file.
//
//   manifest.json                     format, source version and sha256 per file
//   LÄSMIG.txt                        short explanation of the layout
//   site-config.json
//   layers/<layerName>/overlay.geojson
//   layers/<layerName>/text.json      rich text (Tiptap JSON)
//   layers/<layerName>/text.html      readable rendering, generated on export, ignored on import
//   images/<file>                     images used in the texts
//   site-assets/<asset>.<ext>         header image, button icon, corner logo
//
// Paths inside the zip are the same as the version manifest paths.
const archiver = require('archiver');
const yauzl = require('yauzl');
const { sha256 } = require('./store');
const { LEGACY_EXPORT_FORMATS } = require('./compat');

const FORMAT = 'origo-map-stories-content';
const ACCEPTED_FORMATS = [FORMAT, ...LEGACY_EXPORT_FORMATS];
const FORMAT_VERSION = 1;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 2000;

const LAYER_NAME = '[^/\\\\:*?"<>|.]+';
const CONTENT_PATH_RES = [
  /^site-config\.json$/,
  new RegExp(`^layers/${LAYER_NAME}/(overlay\\.geojson|text\\.json)$`),
  /^images\/[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/i,
  /^site-assets\/(header-image|button-icon|corner-logo)\.(png|jpe?g)$/i
];
const OS_JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
const IGNORED_PATH_RES = [
  /^manifest\.json$/,
  /^LÄSMIG\.txt$/,
  new RegExp(`^layers/${LAYER_NAME}/text\\.html$`),
  OS_JUNK_RE
];

const README = `Origo Map Stories – export av innehåll
======================================

Den här zip-filen innehåller en komplett version av kartans innehåll och kan
importeras igen under Sajtkonfiguration → Versionshistorik → "Importera version…".

  manifest.json          Formatbeskrivning och kontrollsumma (sha256) per fil.
  site-config.json       Menyer, rubriktext och bildreferenser.
  layers/<lager>/
    overlay.geojson      Kartlagrets objekt (EPSG:3006). Kan öppnas i QGIS.
    text.json            Lagrets text i redigerarens format.
    text.html            Läsbar kopia av texten. Ignoreras vid import.
  images/                Bilder som används i texterna.
  site-assets/           Toppbild, menyknapp och hörnlogotyp.

Filer kan ändras för hand innan import. Ändrade filer upptäcks via
kontrollsumman och importeras ändå, men versionen märks "manuellt ändrad".
`;

// ─── Tiptap JSON → HTML (for text.html) ─────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Image URLs point at the server; in the zip the image sits two folders up.
function localImageSrc(src) {
  const m = /\/content-files\/(images\/[^"'?#\s]+)/.exec(src || '');
  return m ? `../../${m[1]}` : src;
}

function renderMarks(text, marks = []) {
  return marks.reduce((html, mark) => {
    if (mark.type === 'bold') return `<strong>${html}</strong>`;
    if (mark.type === 'italic') return `<em>${html}</em>`;
    if (mark.type === 'code') return `<code>${html}</code>`;
    if (mark.type === 'strike') return `<s>${html}</s>`;
    if (mark.type === 'link') return `<a href="${esc(mark.attrs && mark.attrs.href)}">${html}</a>`;
    if (mark.type === 'mapFeatureLink' || mark.type === 'mapViewLink') return `<span class="map-link" title="Kartlänk">${html}</span>`;
    return html;
  }, esc(text));
}

function renderNodes(nodes) {
  return (nodes || []).map(renderNode).join('');
}

function renderNode(node) {
  if (!node) return '';
  const inner = () => renderNodes(node.content);
  switch (node.type) {
    case 'doc': return inner();
    case 'text': return renderMarks(node.text, node.marks);
    case 'paragraph': return `<p>${inner()}</p>\n`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs && node.attrs.level) || 1));
      return `<h${level}>${inner()}</h${level}>\n`;
    }
    case 'bulletList': return `<ul>\n${inner()}</ul>\n`;
    case 'orderedList': return `<ol>\n${inner()}</ol>\n`;
    case 'listItem': return `<li>${inner()}</li>\n`;
    case 'blockquote': return `<blockquote>${inner()}</blockquote>\n`;
    case 'codeBlock': return `<pre><code>${inner()}</code></pre>\n`;
    case 'horizontalRule': return '<hr>\n';
    case 'hardBreak': return '<br>';
    case 'image': {
      const a = node.attrs || {};
      return `<p><img src="${esc(localImageSrc(a.src))}" alt="${esc(a.alt)}"></p>\n`;
    }
    default: return inner();
  }
}

function textToHtml(layerName, textJson) {
  let doc;
  try { doc = JSON.parse(textJson); } catch { return null; }
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>${esc(layerName)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  img { max-width: 100%; }
  .map-link { color: #0b5cad; border-bottom: 1px dotted #0b5cad; }
</style>
</head>
<body>
${renderNode(doc)}</body>
</html>
`;
}

// ─── Export ─────────────────────────────────────────────────────────────────

function exportFileName(version) {
  const d = new Date(version.created_at);
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `origo-map-stories_v${version.id}_${stamp}.zip`;
}

// Streams a version (from store.getVersion) as a zip to an HTTP response.
function streamExport(version, res, { server } = {}) {
  const manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      versionId: version.id,
      createdAt: version.created_at,
      kind: version.kind,
      description: version.description,
      server: server || null
    },
    files: version.files.map(f => ({ path: f.path, sha256: f.sha256, size: f.size }))
  };

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${exportFileName(version)}"`);

  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', err => res.destroy(err));
  zip.pipe(res);

  zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  zip.append(README, { name: 'LÄSMIG.txt' });
  version.files.forEach(f => {
    zip.append(f.content, { name: f.path });
    const m = /^layers\/([^/]+)\/text\.json$/.exec(f.path);
    if (m) {
      const html = textToHtml(m[1], f.content.toString('utf8'));
      if (html) zip.append(html, { name: `layers/${m[1]}/text.html` });
    }
  });
  return zip.finalize();
}

// ─── Import ─────────────────────────────────────────────────────────────────

function importError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function readZipEntries(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openErr, zip) => {
      if (openErr) return reject(importError(`Filen är inte en giltig zip-fil (${openErr.message})`));
      const entries = new Map();
      let total = 0;
      zip.on('error', err => reject(importError(`Zip-filen är skadad (${err.message})`)));
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        if (entries.size >= MAX_ENTRIES) { zip.close(); reject(importError(`Zip-filen innehåller fler än ${MAX_ENTRIES} filer`)); return; }
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL_BYTES) { zip.close(); reject(importError('Zip-filens innehåll är större än 100 MB')); return; }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) { reject(importError(`Kunde inte läsa ${entry.fileName}`)); return; }
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('error', err => reject(importError(`Kunde inte läsa ${entry.fileName} (${err.message})`)));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

// A zip re-packed from an unzipped folder (e.g. Windows "Skicka till →
// Komprimerad mapp") has everything under one top folder; strip it.
function stripCommonFolder(entries) {
  if (entries.has('manifest.json')) return entries;
  const names = [...entries.keys()].filter(n => !OS_JUNK_RE.test(n));
  const top = names.length && names[0].includes('/') ? names[0].split('/')[0] : null;
  if (!top || !names.every(n => n.startsWith(`${top}/`))) return entries;
  return new Map([...entries].map(([name, data]) => [name.slice(top.length + 1), data]));
}

function parseJson(name, buffer) {
  try {
    return JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw importError(`${name} är inte giltig JSON (${err.message})`);
  }
}

// Validates an uploaded zip and returns { files: {path: Buffer}, manifest, modified: [paths] }.
async function parseImport(buffer) {
  const entries = stripCommonFolder(await readZipEntries(buffer));

  if (!entries.has('manifest.json')) {
    throw importError('manifest.json saknas – filen är inte en export från Origo Map Stories');
  }
  const manifest = parseJson('manifest.json', entries.get('manifest.json'));
  if (!ACCEPTED_FORMATS.includes(manifest.format)) {
    throw importError(`Okänt format "${manifest.format}" – filen är inte en export från Origo Map Stories`);
  }
  if (!(manifest.formatVersion >= 1 && manifest.formatVersion <= FORMAT_VERSION)) {
    throw importError(`Formatversion ${manifest.formatVersion} stöds inte (högst ${FORMAT_VERSION})`);
  }

  const files = {};
  const rejected = [];
  entries.forEach((data, name) => {
    if (IGNORED_PATH_RES.some(re => re.test(name))) return;
    if (CONTENT_PATH_RES.some(re => re.test(name))) files[name] = data;
    else rejected.push(name);
  });
  if (rejected.length) {
    throw importError(`Otillåtna filer i zip-filen: ${rejected.slice(0, 10).join(', ')}${rejected.length > 10 ? ' …' : ''}`);
  }
  if (!files['site-config.json']) throw importError('site-config.json saknas i zip-filen');

  Object.entries(files).forEach(([name, data]) => {
    if (name.endsWith('.json')) parseJson(name, data);
    if (name.endsWith('.geojson')) {
      const gj = parseJson(name, data);
      if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
        throw importError(`${name} är inte en GeoJSON FeatureCollection`);
      }
    }
  });

  const expected = new Map((Array.isArray(manifest.files) ? manifest.files : []).map(f => [f.path, f.sha256]));
  const modified = [
    ...Object.keys(files).filter(name => expected.get(name) !== sha256(files[name])),
    ...[...expected.keys()].filter(name => !files[name])
  ];

  // Windows editors may save JSON with a UTF-8 BOM; store it without, so the
  // server can read the file back with JSON.parse.
  Object.keys(files).forEach(name => {
    const data = files[name];
    if (/\.(geo)?json$/.test(name) && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) files[name] = data.subarray(3);
  });

  return { files, manifest, modified };
}

module.exports = { streamExport, parseImport, textToHtml, FORMAT, ACCEPTED_FORMATS, FORMAT_VERSION };
