import { Mark } from '@tiptap/core';

// Link from a text span to one object on the map. Used both for objects in
// the submenu's own GeoJSON overlay and for objects in Origo-config vector
// layers (WFS etc.). `extent` is the object's bbox in map projection, so the
// map can zoom to it even before a bbox-loaded WFS source has fetched it.
const MapFeatureMark = Mark.create({
  name: 'mapFeatureLink',

  addAttributes() {
    return {
      featureId: { default: null, parseHTML: el => el.getAttribute('data-feature-id') },
      layerName: { default: null, parseHTML: el => el.getAttribute('data-layer-name') },
      extent: { default: null, parseHTML: el => {
        const raw = el.getAttribute('data-extent');
        return raw ? raw.split(',').map(Number) : null;
      } }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-feature-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      class: 'o-map-link',
      'data-feature-id': HTMLAttributes.featureId,
      'data-layer-name': HTMLAttributes.layerName
    };
    if (Array.isArray(HTMLAttributes.extent)) attrs['data-extent'] = HTMLAttributes.extent.join(',');
    return ['span', attrs, 0];
  },

  addCommands() {
    return {
      setMapFeatureLink: attrs => ({ commands }) =>
        commands.setMark(this.name, attrs),
      unsetMapFeatureLink: () => ({ commands }) =>
        commands.unsetMark(this.name)
    };
  }
});

export default MapFeatureMark;
