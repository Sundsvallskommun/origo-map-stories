// Regenerates the deterministic test fixtures (content folder + upload files).
//
//   node tests/OrigoMapStories.UiTests/Fixtures/generate-fixtures.js
//
// The output is committed; rerun only when the fixtures need to change.
// Images are written with a tiny PNG encoder so exact sizes and alpha
// channels can be produced without an image library.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const contentDir = path.join(root, 'content');
const uploadsDir = path.join(root, 'uploads');

// ─── PNG ──────────────────────────────────────────────────────────────────────

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

// pixel(x, y) -> [r, g, b, a]; alpha=false writes an RGB PNG (no alpha channel).
function png(width, height, pixel, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = pixel(x, y);
      for (let c = 0; c < channels; c += 1) raw[row + 1 + x * channels + c] = p[c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// A filled circle on a transparent background.
function disc([r, g, b]) {
  return (x, y, w, h) => {
    const dx = x - w / 2;
    const dy = y - h / 2;
    const inside = dx * dx + dy * dy <= (Math.min(w, h) / 2 - 1) ** 2;
    return inside ? [r, g, b, 255] : [0, 0, 0, 0];
  };
}

function image(file, width, height, paint, options) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(width, height, (x, y) => paint(x, y, width, height), options));
}

const stripes = ([r, g, b]) => (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [r, g, b, 255] : [255, 255, 255, 255]);

// ─── Content ──────────────────────────────────────────────────────────────────

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } };

function square(cx, cy, half) {
  return [[[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]];
}

function featureCollection(name, features) {
  return { type: 'FeatureCollection', name, crs: CRS, features };
}

const text = value => ({ type: 'text', text: value });
const paragraph = (...content) => ({ type: 'paragraph', content });
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });

fs.rmSync(contentDir, { recursive: true, force: true });

writeJson(path.join(contentDir, 'site-config.json'), {
  headerText: 'Testkarta',
  images: {
    headerImage: '/content-files/site-assets/header-image.png',
    buttonIcon: '/content-files/site-assets/button-icon.png',
    cornerLogo: '/content-files/site-assets/corner-logo.png'
  },
  menus: [
    {
      id: 'bostader',
      label: 'Bostäder',
      items: [
        { id: 'nulage', label: 'Nuläge', layerName: 'Test_Bostader_Nulage' },
        { id: 'framtid', label: 'Framtid 2040', layerName: 'Test_Bostader_Framtid' }
      ]
    },
    {
      id: 'trafik',
      label: 'Trafik',
      items: [
        { id: 'kollektiv', label: 'Kollektivtrafik', layerName: 'Test_Kollektivtrafik' }
      ]
    }
  ]
});

writeJson(path.join(contentDir, 'Test_Bostader_Nulage.geojson'), featureCollection('Test_Bostader_Nulage', [
  { type: 'Feature', id: 'B1', properties: { fid: 'B1', namn: 'Centrum' }, geometry: { type: 'Polygon', coordinates: square(616000, 6920000, 4000) } },
  { type: 'Feature', id: 'B2', properties: { fid: 'B2', namn: 'Norr' }, geometry: { type: 'Polygon', coordinates: square(630000, 6940000, 4000) } }
]));

writeJson(path.join(contentDir, 'Test_Bostader_Framtid.geojson'), featureCollection('Test_Bostader_Framtid', [
  { type: 'Feature', id: 'F1', properties: { fid: 'F1', namn: 'Nytt område' }, geometry: { type: 'Polygon', coordinates: square(600000, 6930000, 5000) } }
]));

writeJson(path.join(contentDir, 'Test_Kollektivtrafik.geojson'), featureCollection('Test_Kollektivtrafik', [
  { type: 'Feature', id: 'K1', properties: { fid: 'K1', namn: 'Stråk' }, geometry: { type: 'LineString', coordinates: [[590000, 6910000], [620000, 6925000], [650000, 6950000]] } },
  { type: 'Feature', id: 'K2', properties: { fid: 'K2', namn: 'Resecentrum' }, geometry: { type: 'Point', coordinates: [618000, 6921000] } }
]));

writeJson(path.join(contentDir, 'Test_Bostader_Nulage.json'), {
  type: 'doc',
  content: [
    heading(1, 'Bostäder nuläge'),
    paragraph(
      text('Här beskrivs '),
      { type: 'text', text: 'centrumområdet', marks: [{ type: 'mapFeatureLink', attrs: { featureId: 'B1', layerName: 'Test_Bostader_Nulage', extent: null } }] },
      text(' och bostäderna i länet.')
    ),
    { type: 'image', attrs: { src: '/content-files/images/fixture-bild.png', alt: 'Fixturbild', title: null } },
    paragraph(text('Sista stycket.'))
  ]
});

// The heading carries a map link: opening the submenu focuses object K1.
writeJson(path.join(contentDir, 'Test_Kollektivtrafik.json'), {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Kollektivtrafik', marks: [{ type: 'mapFeatureLink', attrs: { featureId: 'K1', layerName: 'Test_Kollektivtrafik', extent: null } }] }]
    },
    paragraph(text('Busslinjer och resecentrum.'))
  ]
});

image(path.join(contentDir, 'images', 'fixture-bild.png'), 64, 48, stripes([30, 120, 200]));
image(path.join(contentDir, 'site-assets', 'button-icon.png'), 38, 49, disc([0, 90, 160]));
image(path.join(contentDir, 'site-assets', 'corner-logo.png'), 240, 82, disc([0, 90, 160]));
image(path.join(contentDir, 'site-assets', 'header-image.png'), 120, 200, stripes([0, 90, 160]), { alpha: false });

// ─── Uploads ─────────────────────────────────────────────────────────────────

fs.rmSync(uploadsDir, { recursive: true, force: true });
image(path.join(uploadsDir, 'icon-valid.png'), 38, 49, disc([200, 40, 40]));
image(path.join(uploadsDir, 'icon-wrong-size.png'), 40, 40, disc([200, 40, 40]));
image(path.join(uploadsDir, 'icon-no-alpha.png'), 38, 49, stripes([200, 40, 40]), { alpha: false });
image(path.join(uploadsDir, 'logo-valid.png'), 240, 82, disc([40, 160, 40]));
image(path.join(uploadsDir, 'header-portrait.png'), 100, 200, stripes([40, 160, 40]), { alpha: false });
image(path.join(uploadsDir, 'header-landscape.png'), 200, 100, stripes([40, 160, 40]), { alpha: false });
image(path.join(uploadsDir, 'text-image.png'), 80, 60, stripes([160, 40, 160]));

console.log('Fixtures written to', root);
