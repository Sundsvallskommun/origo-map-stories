/**
 * "Koppla till karta" modal
 * Lets the admin choose how the selected text links to the map:
 *  - an object in the submenu's own GeoJSON overlay,
 *  - the current map view (visible layers, pan and zoom),
 *  - an object in one of the Origo-config vector layers.
 */

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function MapLinkModal({ vectorLayers, hasSelection, onFeatureLink, onMapViewLink, onLayerFeatureLink, onRemove }) {
  let overlay = null;

  function renderHtml() {
    const layerOptions = vectorLayers.map(l =>
      `<option value="${escapeHtml(l.name)}">${escapeHtml(l.title || l.name)}</option>`).join('');

    return `
      <div class="o-mlink-header">
        <h2>Koppla till karta</h2>
        <button class="o-mlink-close" data-action="cancel" aria-label="Stäng">&times;</button>
      </div>
      <div class="o-mlink-body">
        ${hasSelection ? '' : '<div class="o-mlink-warning">Markera först den text som ska kopplas till kartan.</div>'}
        <button class="o-mlink-option" type="button" data-action="feature" ${hasSelection ? '' : 'disabled'}>
          <span class="o-mlink-option-title">Objekt i undermenyns kartskikt</span>
          <span class="o-mlink-option-desc">Klicka sedan på ett objekt i undermenyns eget kartskikt.</span>
        </button>
        <button class="o-mlink-option" type="button" data-action="mapview" ${hasSelection ? '' : 'disabled'}>
          <span class="o-mlink-option-title">Kartvy</span>
          <span class="o-mlink-option-desc">Sparar synliga kartlager, panorering och zoom som kartan ser ut just nu.</span>
        </button>
        <div class="o-mlink-option o-mlink-option--layer">
          <span class="o-mlink-option-title">Objekt i kartlager</span>
          <span class="o-mlink-option-desc">Välj kartlager och klicka sedan på ett objekt i kartan.</span>
          <div class="o-mlink-layer-row">
            <select class="o-mlink-layer-select" ${hasSelection && vectorLayers.length ? '' : 'disabled'}>
              ${vectorLayers.length ? layerOptions : '<option value="">Inga kartlager med objekt finns</option>'}
            </select>
            <button class="o-btn-primary" type="button" data-action="layerfeature" ${hasSelection && vectorLayers.length ? '' : 'disabled'}>Välj objekt</button>
          </div>
        </div>
      </div>
      <div class="o-mlink-footer">
        <button class="o-btn-secondary" type="button" data-action="remove" ${hasSelection ? '' : 'disabled'}>Ta bort kartkopplingar</button>
        <button class="o-btn-secondary" type="button" data-action="cancel">Avbryt</button>
      </div>`;
  }

  function unmount() {
    if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
    overlay = null;
  }

  function handleAction(action) {
    if (action === 'cancel') {
      unmount();
      return;
    }
    if (action === 'feature') onFeatureLink();
    if (action === 'mapview') onMapViewLink();
    if (action === 'remove') onRemove();
    if (action === 'layerfeature') {
      const layerName = overlay.querySelector('.o-mlink-layer-select').value;
      if (!layerName) return;
      onLayerFeatureLink(layerName);
    }
    unmount();
  }

  function mount(parentElement = document.body) {
    overlay = document.createElement('div');
    overlay.className = 'o-mlink-overlay';
    const modal = document.createElement('div');
    modal.className = 'o-mlink-modal';
    modal.innerHTML = renderHtml();
    overlay.appendChild(modal);
    parentElement.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        unmount();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (btn && !btn.disabled) handleAction(btn.getAttribute('data-action'));
    });
  }

  return { mount, unmount };
}

export default MapLinkModal;
