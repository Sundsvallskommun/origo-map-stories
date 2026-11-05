export function getAllLayers(viewer) {
  const layers = [];

  function visit(collection) {
    if (!collection) return;
    const entries = typeof collection.getArray === 'function'
      ? collection.getArray()
      : collection;
    if (!Array.isArray(entries)) return;

    entries.forEach(layer => {
      layers.push(layer);
      if (typeof layer.getLayers === 'function') visit(layer.getLayers());
    });
  }

  visit(viewer.getLayers());
  return layers;
}

export function debugLayerStructure(viewer) {
  const allLayers = getAllLayers(viewer);
  console.log('[OrigoMapStories] === LAYER STRUCTURE DEBUG ===');
  console.log('[OrigoMapStories] Total layers:', allLayers.length);
  
  const topLevel = viewer.getLayers();
  if (topLevel && typeof topLevel.getArray === 'function') {
    const entries = topLevel.getArray();
    console.log('[OrigoMapStories] Top-level layer groups:', entries.length);
    entries.forEach((layer, idx) => {
      const name = layer.get('name');
      const hasChildren = typeof layer.getLayers === 'function';
      if (hasChildren) {
        const children = layer.getLayers().getArray();
        console.log(`  [${idx}] GROUP: ${name} (${children.length} children)`);
        children.forEach((child, cidx) => {
          const childName = child.get('name');
          const childGroup = child.get('group');
          console.log(`    [${cidx}] ${childName} (group: ${childGroup})`);
        });
      } else {
        const group = layer.get('group');
        console.log(`  [${idx}] LAYER: ${name} (group: ${group})`);
      }
    });
  }
}

export function getLayerIdentifier(layer) {
  return layer.get('name') || layer.get('id') || layer.get('layerName');
}

// Recursively ensure parent layer groups are visible if a child layer is made visible
export function setLayerVisibleWithParents(layer, visible) {
  if (!layer || typeof layer.setVisible !== 'function') return;
  
  layer.setVisible(visible);
  console.log('[OrigoMapStories] Layer:', layer.get('name'), 'set to visible:', visible);
  
  // Walk up the parent chain to ensure all parent groups are visible too
  if (visible && typeof layer.getParent === 'function') {
    let parent = layer.getParent();
    let level = 1;
    while (parent) {
      if (typeof parent.setVisible === 'function') {
        const parentName = parent.get ? parent.get('name') : 'unnamed-parent';
        parent.setVisible(true);
        console.log('[OrigoMapStories] Parent level', level, '(' + parentName + ') set to visible: true');
      }
      parent = typeof parent.getParent === 'function' ? parent.getParent() : null;
      level++;
    }
  }
}

// Find a layer by name and set its visibility, ensuring all parents are visible
export function findAndSetLayerVisibility(viewer, layerName, visible) {
  const allLayers = getAllLayers(viewer);
  const layer = allLayers.find(l => getLayerIdentifier(l) === layerName);
  
  if (!layer) {
    console.log('[OrigoMapStories] Layer not found by name:', layerName);
    return false;
  }
  
  setLayerVisibleWithParents(layer, visible);
  return true;
}

// Find parent layer group by name
export function findLayerGroup(viewer, groupName) {
  const allLayers = getAllLayers(viewer);
  return allLayers.find(l => 
    typeof l.getLayers === 'function' &&  // Is a group
    (l.get('name') === groupName || l.get('id') === groupName)
  );
}
