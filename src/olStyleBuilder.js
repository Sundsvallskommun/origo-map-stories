import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape } from 'ol/style';
import { Point } from 'ol/geom';
import { getSymbolById } from './symbolLibrary';

function toRgba(c) {
  const a = c.length === 4 ? c[3] : 1;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function nodeStyles(sym) {
  const styles = [];
  const { rings, radius, color } = sym;
  const rgba = toRgba(color.concat([1]));

  // Draw rings from outermost inward, alternating fill/white
  for (let i = rings; i >= 0; i--) {
    const r = radius * (1 - (rings - i) / (rings + 0.5));
    const filled = i % 2 === 0;
    styles.push(new Style({
      image: new CircleStyle({
        radius: Math.max(r, 2),
        fill: new Fill({ color: filled ? rgba : 'rgba(255,255,255,1)' }),
        stroke: new Stroke({ color: rgba, width: 1.5 })
      })
    }));
  }

  // Dark center dot
  styles.push(new Style({
    image: new CircleStyle({
      radius: Math.max(radius * 0.13, 2),
      fill: new Fill({ color: 'rgba(25,15,5,0.9)' }),
      stroke: new Stroke({ color: 'transparent', width: 0 })
    })
  }));

  return styles;
}

function lineStyles(sym, feature) {
  const rgba = toRgba(sym.lineColor);
  const strokeOpts = {
    color: rgba,
    width: sym.lineWidth,
    lineCap: sym.lineCap || 'round',
    lineJoin: sym.lineJoin || 'round'
  };
  if (sym.lineDash) strokeOpts.lineDash = sym.lineDash;

  const styles = [new Style({ stroke: new Stroke(strokeOpts) })];

  if (sym.arrow && feature) {
    const coords = feature.getGeometry().getCoordinates();
    if (coords.length >= 2) {
      const [x1, y1] = coords[coords.length - 2];
      const [x2, y2] = coords[coords.length - 1];
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ar = sym.lineWidth * 1.5;
      styles.push(new Style({
        geometry: new Point([x2, y2]),
        image: new RegularShape({
          points: 3,
          radius: ar,
          // OL RegularShape: default vertex at screen-top (geographic north).
          // Rotate so triangle tip points in the direction of the line segment.
          rotation: Math.PI / 2 - angle,
          fill: new Fill({ color: rgba }),
          stroke: new Stroke({ color: 'transparent', width: 0 })
        })
      }));
    }
  }

  return styles;
}

function polygonStyles(sym) {
  return [new Style({
    fill: new Fill({ color: toRgba(sym.fillColor) }),
    stroke: new Stroke({ color: toRgba(sym.strokeColor), width: sym.strokeWidth || 2 })
  })];
}

const DEFAULT_STYLE = new Style({
  fill: new Fill({ color: 'rgba(100,100,200,0.2)' }),
  stroke: new Stroke({ color: 'rgba(60,60,180,0.8)', width: 2 }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(100,100,200,0.6)' }),
    stroke: new Stroke({ color: 'rgba(60,60,180,0.9)', width: 1.5 })
  })
});

export function styleFunction(feature) {
  const symbolType = feature.get('symbolType');
  if (!symbolType) return [DEFAULT_STYLE];
  const sym = getSymbolById(symbolType);
  if (!sym) return [DEFAULT_STYLE];
  if (sym.geometryType === 'Point') return nodeStyles(sym);
  if (sym.geometryType === 'LineString') return lineStyles(sym, feature);
  if (sym.geometryType === 'Polygon') return polygonStyles(sym);
  return [DEFAULT_STYLE];
}

export function selectStyleFunction(feature) {
  const base = styleFunction(feature);
  return [...base, new Style({
    stroke: new Stroke({ color: 'rgba(30,120,255,0.9)', width: 3, lineDash: [8, 5] }),
    fill: new Fill({ color: 'rgba(30,120,255,0.08)' }),
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: 'rgba(30,120,255,0.12)' }),
      stroke: new Stroke({ color: 'rgba(30,120,255,0.9)', width: 2, lineDash: [4, 3] })
    })
  })];
}

// Map object linked from the text: picked as a link target or followed
// from a link. A white halo under a strong orange outline keeps it readable
// on both the grey and the colour background maps.
const LINK_HIGHLIGHT_STYLES = [
  new Style({
    stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 8 }),
    image: new CircleStyle({ radius: 11, fill: new Fill({ color: 'rgba(255,255,255,0.9)' }) })
  }),
  new Style({
    stroke: new Stroke({ color: 'rgba(255,120,0,1)', width: 4 }),
    fill: new Fill({ color: 'rgba(255,170,0,0.35)' }),
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: 'rgba(255,170,0,0.6)' }),
      stroke: new Stroke({ color: 'rgba(255,120,0,1)', width: 3 })
    })
  })
];

export function linkHighlightStyleFunction() {
  return LINK_HIGHLIGHT_STYLES;
}

// Style used as draw-interaction preview (no feature context yet)
export function previewStyleForSym(sym) {
  if (!sym) return [DEFAULT_STYLE];
  if (sym.geometryType === 'Point') return nodeStyles(sym);
  if (sym.geometryType === 'Polygon') return polygonStyles(sym);
  // Line preview: stroke only, no arrowhead (no coordinates yet)
  const rgba = toRgba(sym.lineColor);
  const strokeOpts = {
    color: rgba,
    width: sym.lineWidth,
    lineCap: sym.lineCap || 'round',
    lineJoin: sym.lineJoin || 'round'
  };
  if (sym.lineDash) strokeOpts.lineDash = sym.lineDash;
  return [new Style({ stroke: new Stroke(strokeOpts) })];
}
