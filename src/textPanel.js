import { createEditor } from './editor';
import { fetchContent, saveContent } from './contentApi';
import { isAdmin, isAdminRequested, openAdminLoginModal } from './adminMode';
import { styleFunction } from './olStyleBuilder';
import { getApplicationBase, getExplicitApiBase } from './apiBase';
import { getOptions } from './config';
import MapLinkModal from './mapLinkModal';
import { setLayerVisibleWithParents } from './layerUtils';

const PLACEHOLDER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Välkommen till kartinnehållet' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Det här är en platshållartext kopplad till det valda GeoJSON-lagret. Klicka på objekt i kartan för att navigera till motsvarande avsnitt i texten, eller klicka på markerade textdelar för att zooma till objektet i kartan.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Om lagret' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Varje lager i kartan kan ha ett eget textdokument med beskrivningar, bilder och länkar till kartans objekt. Texten kan redigeras av en administratör direkt i webbläsaren.' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Klicka på ett objekt i kartan för att markera det i texten.' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Klicka på en blå länk i texten för att zooma till objektet i kartan.' }] }] }
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ändringar sparas på servern när du klickar på Spara och finns kvar vid nästa besök.' }] }
  ]
};

// The map editor page for a layer: the editorUrl option, or editor.html in
// the app's folder. An explicitly configured API base is passed on; the
// editor only accepts it when it has the editor's own origin.
function buildEditorUrl(layerName) {
  const { editorUrl } = getOptions();
  const url = new URL(editorUrl || `${getApplicationBase()}/editor.html`, document.baseURI);
  url.searchParams.set('layer', layerName);
  const apiBase = getExplicitApiBase();
  if (apiBase) url.searchParams.set('apiBase', apiBase);
  return url.href;
}

const DISCARD_MESSAGE = 'Du har osparade ändringar. Vill du avbryta utan att spara?';

function openMapEditor(layerName, viewer, onClose) {
  if (document.getElementById('o-map-editor-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'o-map-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;';

  const iframe = document.createElement('iframe');
  iframe.src = buildEditorUrl(layerName);
  iframe.style.cssText = 'flex:1;width:100%;border:0;display:block;';
  modal.appendChild(iframe);
  document.body.appendChild(modal);
  // Give the editor keyboard focus so Escape reaches it right away.
  iframe.addEventListener('load', () => {
    try { iframe.contentWindow.focus(); } catch { /* ignore */ }
  });

  function onMessage(evt) {
    if (!evt.data || evt.data.type !== 'editor-close') return;
    modal.remove();
    window.removeEventListener('message', onMessage);
    if (typeof onClose === 'function') onClose(layerName);
  }
  window.addEventListener('message', onMessage);
}

const TextPanel = function TextPanel({
  viewer, featureSync, onClose, onEditorClose, getLinkableLayers, getNextItem, onNext, loadDoc
}) {
  // A built-in text (no database behind it): read-only, nothing to save and
  // no connection to the map.
  const isBuiltInText = typeof loadDoc === 'function';
  let el = null;
  let editorInstance = null;
  let currentLayer = null;
  let viewerEl = null;
  let parentEl = null;
  // The document as it was when editing started or was last saved, as JSON
  // text; the text is "dirty" while the editor content differs from it.
  let savedSnapshot = null;

  function showStatus(msg, isError) {
    const bar = el && el.querySelector('.o-tp-status');
    if (!bar) return;
    bar.textContent = msg;
    bar.style.color = isError ? '#c00' : '#060';
    setTimeout(() => { bar.textContent = ''; }, isError ? 8000 : 3000);
  }

  function isEditing() {
    return !!el && el.querySelector('#o-tp-save-btn').style.display !== 'none';
  }

  function snapshot() {
    return editorInstance ? JSON.stringify(editorInstance.getJSON()) : null;
  }

  function isDirty() {
    return isEditing() && !!editorInstance && snapshot() !== savedSnapshot;
  }

  // True when it is fine to throw away the current edit: nothing unsaved, or
  // the admin confirmed discarding it.
  function confirmDiscard() {
    return !isDirty() || window.confirm(DISCARD_MESSAGE);
  }

  // Saves the text. Resolves true when it was saved (also after logging in
  // again on an expired session), false on an error or a cancelled login.
  function save() {
    if (isBuiltInText) return Promise.resolve(false);
    return new Promise(resolve => {
      async function attempt() {
        if (!editorInstance) { resolve(false); return; }
        try {
          const doc = editorInstance.getJSON();
          await saveContent(currentLayer, doc);
          savedSnapshot = JSON.stringify(doc);
          showStatus('Sparat!', false);
          resolve(true);
        } catch (e) {
          if (e.authExpired && isAdminRequested()) {
            if (document.querySelector('.o-admin-login-overlay')) { resolve(false); return; }
            openAdminLoginModal({ message: e.message, onSuccess: attempt, onCancel: () => resolve(false) });
            return;
          }
          showStatus(e.message, true);
          resolve(false);
        }
      }
      attempt();
    });
  }

  function handleSave() {
    save();
  }

  // "Spara och stäng": back to read mode only when the save went through.
  async function handleSaveAndClose() {
    if (await save()) leaveEditMode();
  }

  // Edit controls exist only on the admin link with a valid login; the
  // public link never shows them.
  function refreshAdminUi() {
    if (!el) return;
    const admin = isAdmin() && !isBuiltInText;
    const editing = el.querySelector('#o-tp-save-btn').style.display !== 'none';
    el.querySelector('#o-tp-edit-btn').style.display = admin && !editing ? 'inline-block' : 'none';
    el.querySelector('#o-tp-geojson-btn').style.display = admin ? 'inline-block' : 'none';
  }

  // "Next" arrow at the end of the text, leading to the following submenu.
  // Hidden on the last submenu and while the text is being edited.
  function refreshNextButton() {
    const btn = el && el.querySelector('#o-tp-next-btn');
    if (!btn) return;
    const next = typeof getNextItem === 'function' ? getNextItem() : null;
    const editing = el.querySelector('#o-tp-save-btn').style.display !== 'none';
    btn.hidden = !next || editing;
    if (!next) return;
    const label = `Nästa: ${next.label}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function setEditButtons(editing) {
    el.querySelector('#o-tp-edit-btn').style.display = editing ? 'none' : 'inline-block';
    ['#o-tp-cancel-btn', '#o-tp-save-btn', '#o-tp-save-close-btn'].forEach(sel => {
      el.querySelector(sel).style.display = editing ? 'inline-block' : 'none';
    });
  }

  function handleEdit() {
    if (isBuiltInText) return;
    editorInstance.setEditable(true);
    savedSnapshot = snapshot();
    setEditButtons(true);
    refreshNextButton();
  }

  // "Avbryt": warns about unsaved changes, then returns to read mode.
  function handleCancelEdit() {
    if (!confirmDiscard()) return;
    leaveEditMode();
  }

  // Back to read mode, showing the text as saved on the server.
  async function leaveEditMode() {
    if (!el || !editorInstance || isBuiltInText) return;
    featureSync.exitPickMode();
    editorInstance.setEditable(false);
    setEditButtons(false);
    savedSnapshot = null;
    refreshNextButton();
    // Reload from server to discard unsaved edits
    try {
      const doc = await fetchContent(currentLayer);
      editorInstance.setContent(doc || PLACEHOLDER);
    } catch {
      editorInstance.setContent(PLACEHOLDER);
    }
  }

  function pickFeature(layerName) {
    showStatus('Klicka på ett objekt i kartan för att länka...', false);
    featureSync.enterPickMode((featureId, pickedLayerName, extent) => {
      editorInstance.applyFeatureLink(featureId, pickedLayerName, extent);
      showStatus(`Länkat till objekt ${featureId}`, false);
    }, {
      layerName,
      onMiss: () => showStatus('Inget objekt i det valda kartlagret här – klicka på ett objekt.', true)
    });
  }

  async function openMapLinkModal() {
    featureSync.exitPickMode();
    const hasSelection = editorInstance.saveSelection();
    let linkableLayers = [];
    if (typeof getLinkableLayers === 'function') {
      showStatus('Kontrollerar kartlager...', false);
      linkableLayers = await getLinkableLayers();
      showStatus('', false);
    }
    if (!editorInstance) return;
    MapLinkModal({
      vectorLayers: linkableLayers,
      hasSelection,
      onFeatureLink: () => pickFeature(currentLayer),
      onMapViewLink: () => {
        editorInstance.applyMapViewLink(viewer.permalink.getHash(viewer));
        showStatus('Länkat till nuvarande kartvy.', false);
      },
      onLayerFeatureLink: layerName => {
        const layer = viewer.getLayer(layerName);
        if (!layer) {
          showStatus(`Kartlagret "${layerName}" är inte laddat.`, true);
          return;
        }
        setLayerVisibleWithParents(layer, true);
        pickFeature(layerName);
      },
      onRemove: () => {
        editorInstance.unsetMapLinks();
        showStatus('Kartkopplingar borttagna.', false);
      }
    }).mount();
  }

  function renderHTML(layerTitle) {
    return `
      <div id="o-text-panel">
        <div class="o-tp-header">
          <span class="o-tp-title">${layerTitle}</span>
          <button id="o-tp-close-btn" class="o-tp-close">&times;</button>
        </div>
        <div class="o-profile-wave" aria-hidden="true"></div>
        <div class="o-tp-toolbar-slot"></div>
        <div class="o-tp-body">
          <div id="o-tp-editor-mount"></div>
          <div class="o-tp-next">
            <button id="o-tp-next-btn" class="o-tp-next-btn" type="button" hidden>
              <span aria-hidden="true">&#8595;</span>
            </button>
          </div>
        </div>
        <div class="o-tp-footer">
          <span class="o-tp-status"></span>
          <button id="o-tp-edit-btn" class="o-btn-primary" style="display:none">&#9998; Redigera texten</button>
          <button id="o-tp-geojson-btn" class="o-btn-secondary" title="Öppna karteditor" style="display:none">&#9998; Redigera kartan</button>
          <button id="o-tp-cancel-btn" class="o-btn-secondary" style="display:none">Avbryt</button>
          <button id="o-tp-save-btn" class="o-btn-secondary" style="display:none">Spara</button>
          <button id="o-tp-save-close-btn" class="o-btn-primary" style="display:none">Spara och stäng</button>
        </div>
      </div>`;
  }

  // mount is async: content is loaded BEFORE the editor is created,
  // so there is no second setContent() call that could overwrite a paste.
  async function mount(layerName, layerTitle) {
    currentLayer = layerName;

    viewerEl = document.getElementById(viewer.getId());
    parentEl = viewerEl ? viewerEl.parentNode : null;
    if (!viewerEl || !parentEl) return;

    parentEl.classList.add('o-plugin-layout', 'o-has-text-panel');
    viewerEl.classList.add('o-plugin-viewer');

    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderHTML(layerTitle);
    el = wrapper.firstElementChild;
    parentEl.insertBefore(el, viewerEl);

    el.querySelector('#o-tp-close-btn').addEventListener('click', () => {
      if (!confirmDiscard()) return;
      unmount();
    });
    el.querySelector('#o-tp-edit-btn').addEventListener('click', handleEdit);
    el.querySelector('#o-tp-save-btn').addEventListener('click', handleSave);
    el.querySelector('#o-tp-save-close-btn').addEventListener('click', handleSaveAndClose);
    el.querySelector('#o-tp-cancel-btn').addEventListener('click', handleCancelEdit);
    document.addEventListener('keydown', handleKeydown);
    el.querySelector('#o-tp-geojson-btn').addEventListener('click', () => {
      if (isBuiltInText) return;
      openMapEditor(layerName, viewer, onEditorClose);
    });
    el.querySelector('#o-tp-next-btn').addEventListener('click', () => {
      if (typeof onNext === 'function') onNext();
    });
    // Load saved content first, then create the editor with it as initial content
    let initialContent = PLACEHOLDER;
    if (isBuiltInText) {
      initialContent = await loadDoc();
    } else {
      try {
        const doc = await fetchContent(layerName);
        if (doc) initialContent = doc;
      } catch { /* use placeholder */ }
    }
    // The panel may have been closed (or replaced) while the text loaded.
    if (!el) return;

    editorInstance = createEditor({
      element: el.querySelector('#o-tp-editor-mount'),
      content: initialContent,
      editable: false,
      onOpenMapLink: openMapLinkModal
    });

    if (!isBuiltInText) {
      featureSync.setTextPanel(el.querySelector('.o-tp-body'));
      featureSync.attachTextClickHandlers(el.querySelector('.o-tp-body'));
      featureSync.startMapFeatureTracking();
    }

    refreshAdminUi();
    refreshNextButton();

    viewer.getMap().updateSize();
    if (!isBuiltInText) focusHeadingLink();
  }

  // Opening a submenu acts as a click on the map link in the text's first
  // heading, if it has one.
  function focusHeadingLink() {
    const heading = el.querySelector('.o-tiptap-content :is(h1, h2, h3, h4, h5, h6)');
    const link = heading && heading.querySelector('.o-map-link, .o-map-view-link');
    if (link) featureSync.activateLinkSpan(link);
  }

  // Escape while editing acts like "Avbryt" (with the unsaved-changes
  // warning), unless another dialog is open on top of the text panel.
  // (defaultPrevented is not checked: ProseMirror marks every Escape as
  // handled although it does nothing with it.)
  function handleKeydown(e) {
    if (e.key !== 'Escape' || !isEditing()) return;
    if (document.querySelector('.o-mlink-overlay, .o-cfg-overlay, #o-map-editor-modal')) return;
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) return;
    e.preventDefault();
    handleCancelEdit();
  }

  function unmount() {
    document.removeEventListener('keydown', handleKeydown);
    featureSync.exitPickMode();
    featureSync.stopMapFeatureTracking();
    if (editorInstance) { editorInstance.destroy(); editorInstance = null; }

    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (parentEl) {
      parentEl.classList.remove('o-has-text-panel');
      if (!parentEl.classList.contains('o-has-layer-panel')) {
        parentEl.classList.remove('o-plugin-layout');
      }
    }
    if (viewerEl && parentEl && !parentEl.classList.contains('o-plugin-layout')) {
      viewerEl.classList.remove('o-plugin-viewer');
    }

    el = null; viewerEl = null; parentEl = null;
    viewer.getMap().updateSize();
    if (onClose) onClose();
  }

  return { mount, unmount, refreshAdminUi, confirmDiscard };
};

export default TextPanel;
