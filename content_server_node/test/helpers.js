// Shared helpers for the server unit tests (node --test).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PassThrough } = require('stream');

// ─── Test database ───────────────────────────────────────────────────────────

// TEST_DATABASE_URL from the environment, or from the UI tests' local
// .runsettings. Refuses anything that is not a *_test database: the store
// tests wipe it.
function testDatabaseUrl() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const runsettings = path.join(__dirname, '..', '..', 'tests', 'OrigoMapStories.UiTests', '.runsettings');
    if (fs.existsSync(runsettings)) {
      const m = /<TEST_DATABASE_URL>([^<]+)<\/TEST_DATABASE_URL>/.exec(fs.readFileSync(runsettings, 'utf8'));
      if (m) url = m[1].trim();
    }
  }
  if (!url) return null;
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run: the test database '${database}' does not end with '_test'.`);
  }
  return url;
}

const TABLES = 'version, version_file, blob, current_version, pending_upload, current_feature';

// ─── Zip files ───────────────────────────────────────────────────────────────

// Writes a zip (stored, no compression) with exactly the given entry names —
// including names a normal zip library would refuse, such as "../evil.txt".
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = zlib.crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// Runs contentArchive.streamExport into a buffer (it normally streams to an
// Express response).
async function exportToBuffer(streamExport, version) {
  const res = new PassThrough();
  res.headers = {};
  res.set = (k, v) => { res.headers[k] = v; };
  const chunks = [];
  res.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); });
  await streamExport(version, res, { server: 'test' });
  await done;
  return { buffer: Buffer.concat(chunks), headers: res.headers };
}

module.exports = { testDatabaseUrl, TABLES, makeZip, exportToBuffer };
