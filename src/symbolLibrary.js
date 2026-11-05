export const SYMBOL_CATEGORIES = ['Noder', 'Stråk', 'Rörelser', 'Ytor'];

export const SYMBOLS = [
  // ── Nodes (Point) ──────────────────────────────────────────────────────────
  {
    id: 'node-regional',
    label: 'Regionalt centrum',
    category: 'Noder',
    geometryType: 'Point',
    rings: 4,
    radius: 28,
    color: [215, 70, 25]
  },
  {
    id: 'node-main',
    label: 'Huvudort',
    category: 'Noder',
    geometryType: 'Point',
    rings: 3,
    radius: 20,
    color: [215, 70, 25]
  },
  {
    id: 'node-local',
    label: 'Tätort',
    category: 'Noder',
    geometryType: 'Point',
    rings: 2,
    radius: 13,
    color: [215, 70, 25]
  },
  {
    id: 'node-small',
    label: 'Mindre ort',
    category: 'Noder',
    geometryType: 'Point',
    rings: 1,
    radius: 8,
    color: [215, 70, 25]
  },

  // ── Corridors (LineString) ─────────────────────────────────────────────────
  {
    id: 'corridor-major',
    label: 'Primärt stråk',
    category: 'Stråk',
    geometryType: 'LineString',
    lineWidth: 22,
    lineColor: [240, 185, 140, 0.88],
    lineCap: 'round',
    lineJoin: 'round'
  },
  {
    id: 'corridor-minor',
    label: 'Sekundärt stråk',
    category: 'Stråk',
    geometryType: 'LineString',
    lineWidth: 12,
    lineColor: [240, 185, 140, 0.88],
    lineCap: 'round',
    lineJoin: 'round'
  },
  {
    id: 'corridor-dashed',
    label: 'Planerat stråk',
    category: 'Stråk',
    geometryType: 'LineString',
    lineWidth: 8,
    lineColor: [215, 95, 35, 0.85],
    lineDash: [14, 8],
    lineCap: 'butt',
    lineJoin: 'miter'
  },

  // ── Arrows / flows (LineString with arrowhead) ────────────────────────────
  {
    id: 'arrow-regional',
    label: 'Regional rörelse',
    category: 'Rörelser',
    geometryType: 'LineString',
    lineWidth: 18,
    lineColor: [240, 185, 140, 0.88],
    lineCap: 'round',
    lineJoin: 'round',
    arrow: true
  },
  {
    id: 'arrow-local',
    label: 'Lokal rörelse',
    category: 'Rörelser',
    geometryType: 'LineString',
    lineWidth: 8,
    lineColor: [75, 155, 55, 0.9],
    lineCap: 'round',
    lineJoin: 'round',
    arrow: true
  },
  {
    id: 'arrow-water',
    label: 'Vattensamband',
    category: 'Rörelser',
    geometryType: 'LineString',
    lineWidth: 6,
    lineColor: [95, 175, 215, 0.9],
    lineCap: 'round',
    lineJoin: 'round',
    arrow: true
  },

  // ── Areas (Polygon) ────────────────────────────────────────────────────────
  {
    id: 'area-region',
    label: 'Regiongräns',
    category: 'Ytor',
    geometryType: 'Polygon',
    fillColor: [120, 190, 80, 0.25],
    strokeColor: [80, 150, 40, 0.8],
    strokeWidth: 2
  },
  {
    id: 'area-urban',
    label: 'Tätortsyta',
    category: 'Ytor',
    geometryType: 'Polygon',
    fillColor: [215, 95, 35, 0.18],
    strokeColor: [185, 70, 25, 0.7],
    strokeWidth: 1.5
  }
];

export function getSymbolById(id) {
  return SYMBOLS.find(s => s.id === id) || null;
}

function toSvgColor(c) {
  const a = c.length === 4 ? c[3] : 1;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function buildSymbolPreviewSvg(sym) {
  const W = 56, H = 34;

  if (sym.geometryType === 'Point') {
    const cx = W / 2, cy = H / 2;
    const r = Math.min(sym.radius * 0.55, H / 2 - 2);
    const rgba = toSvgColor(sym.color.concat([1]));
    let circles = '';
    for (let i = sym.rings; i >= 0; i--) {
      const ri = r * (1 - (sym.rings - i) / (sym.rings + 0.5));
      const filled = i % 2 === 0;
      circles += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(ri, 1.5).toFixed(1)}"
        fill="${filled ? rgba : 'white'}" stroke="${rgba}" stroke-width="1.2"/>`;
    }
    circles += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"
      r="${Math.max(r * 0.15, 1.5).toFixed(1)}" fill="rgba(30,20,10,0.85)"/>`;
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">${circles}</svg>`;
  }

  if (sym.geometryType === 'LineString') {
    const rgba = toSvgColor(sym.lineColor);
    const sw = Math.min(sym.lineWidth * 0.65, 14);
    const y = H / 2;
    const x2 = sym.arrow ? W - sw - 4 : W - 4;
    const dashAttr = sym.lineDash ? `stroke-dasharray="${sym.lineDash.join(' ')}"` : '';
    let svg = `<line x1="4" y1="${y}" x2="${x2}" y2="${y}"
      stroke="${rgba}" stroke-width="${sw.toFixed(1)}"
      stroke-linecap="${sym.lineCap || 'round'}" ${dashAttr}/>`;
    if (sym.arrow) {
      const ah = Math.min(sw * 1.6, 13);
      const ax = W - 2;
      svg += `<polygon points="${ax},${y} ${(ax - ah * 1.2).toFixed(1)},${(y - ah * 0.65).toFixed(1)} ${(ax - ah * 1.2).toFixed(1)},${(y + ah * 0.65).toFixed(1)}" fill="${rgba}"/>`;
    }
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  }

  if (sym.geometryType === 'Polygon') {
    const fillRgba = toSvgColor(sym.fillColor);
    const strokeRgba = toSvgColor(sym.strokeColor);
    const sw = sym.strokeWidth || 2;
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${sw}" y="${sw}" width="${W - sw * 2}" height="${H - sw * 2}"
        fill="${fillRgba}" stroke="${strokeRgba}" stroke-width="${sw}" rx="3"/>
    </svg>`;
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"></svg>`;
}
