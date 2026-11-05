import { Mark } from '@tiptap/core';

// Link from a text span to a saved map view. `mapState` is an Origo
// permalink hash (layers=…&center=…&zoom=…) captured with
// viewer.permalink.getHash(), so clicking restores visible layers as well as
// pan/zoom. Older links only carry center/zoom and restore pan/zoom only.
const MapViewMark = Mark.create({
  name: 'mapViewLink',

  addAttributes() {
    return {
      mapState: { default: null, parseHTML: el => el.getAttribute('data-map-state') },
      center: { default: null, parseHTML: el => {
        const raw = el.getAttribute('data-center');
        return raw ? raw.split(',').map(Number) : null;
      } },
      zoom: { default: null, parseHTML: el => {
        const raw = el.getAttribute('data-zoom');
        return raw ? Number(raw) : null;
      } }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-map-state]' }, { tag: 'span[data-center][data-zoom]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { class: 'o-map-view-link' };
    if (HTMLAttributes.mapState) attrs['data-map-state'] = HTMLAttributes.mapState;
    if (HTMLAttributes.center !== null && HTMLAttributes.center !== undefined) {
      attrs['data-center'] = Array.isArray(HTMLAttributes.center) ? HTMLAttributes.center.join(',') : HTMLAttributes.center;
    }
    if (HTMLAttributes.zoom !== null && HTMLAttributes.zoom !== undefined) attrs['data-zoom'] = HTMLAttributes.zoom;
    return ['span', attrs, 0];
  },

  addCommands() {
    return {
      setMapViewLink: attrs => ({ commands }) =>
        commands.setMark(this.name, attrs),
      unsetMapViewLink: () => ({ commands }) =>
        commands.unsetMark(this.name)
    };
  }
});

export default MapViewMark;
