import { getAllLayers, getLayerIdentifier } from './layerUtils';
import { isAdmin } from './adminMode';
import { SITE_STATUS, getStatusMenus } from './siteStatus';
import { getFallbackMenus, getOptions } from './config';

// The configured "Rubriktext", used as panel header and browser tab title.
export function getHeaderText(siteConfig) {
  const configured = siteConfig && typeof siteConfig.headerText === 'string' ? siteConfig.headerText.trim() : '';
  return configured || 'Rubriktext';
}

const LayerPanel = function LayerPanel({
  viewer, onLayerSelect, onClose, onDeactivate, onConfigEdit, canLeaveSelection, siteConfig: initialConfig,
  getSiteStatus, getCatalogLayers
}) {
  let siteConfig = initialConfig || {};
  let el = null;
  let viewerEl = null;
  let parentEl = null;
  let expandedSectionId = '';
  let activeItemKey = null;
  let statusMessage = '';

  function getStatus() {
    return typeof getSiteStatus === 'function' ? getSiteStatus() : SITE_STATUS.READY;
  }

  function getCatalogLayerNames() {
    return typeof getCatalogLayers === 'function' ? getCatalogLayers() : [];
  }

  // The configured menus; without any, the defaultMenus option or a menu
  // listing the catalog's layers (see config.js).
  function getMenus() {
    return getStatusMenus(getStatus())
      || (Array.isArray(siteConfig.menus) ? siteConfig.menus : getFallbackMenus(getCatalogLayerNames()));
  }

  // Empty database: the admin must reach the site config to import content.
  function canConfigure() {
    return isAdmin() && (getStatus() === SITE_STATUS.READY || getStatus() === SITE_STATUS.EMPTY);
  }

  function getHeaderImageStyle() {
    const url = (siteConfig.images && siteConfig.images.headerImage) || getOptions().assets.headerImage;
    return url ? ` style="background-image:url('${url}')"` : '';
  }

  function renderMenu() {
    const menus = getMenus();
    const sectionHtml = menus.map(menu => {
      const expanded = menu.id === expandedSectionId;
      const rows = menu.items.map(item => {
        const key = `${menu.id}__${item.id}`;
        const isActive = key === activeItemKey;
        return `
          <button class="o-lp-subitem${isActive ? ' is-active' : ''}" type="button"
            data-role="item" data-section="${menu.id}" data-item="${item.id}">
            ${item.label}
          </button>`;
      }).join('');

      return `
        <li class="o-lp-section${expanded ? ' is-expanded' : ''}">
          <button class="o-lp-section-btn" type="button" data-role="section" data-section="${menu.id}"
            aria-expanded="${expanded}">
            <span>${menu.label}</span>
            <span class="o-lp-chevron" aria-hidden="true">${expanded ? '−' : '+'}</span>
          </button>
          <div class="o-lp-submenu"${expanded ? '' : ' hidden'}>${rows}</div>
        </li>`;
    }).join('');

    return `
      <div class="o-lp-header">
        <div class="o-lp-header-hero" aria-hidden="true"${getHeaderImageStyle()}></div>
        <div class="o-lp-header-title">${getHeaderText(siteConfig)}</div>
        <button class="o-lp-close" id="o-lp-close-btn" type="button" aria-label="Stäng">&times;</button>
        ${canConfigure() ? '<button class="o-lp-settings-btn" id="o-lp-settings-btn" type="button" title="Sajtkonfiguration">&#9881;</button>' : ''}
      </div>
      <div class="o-lp-body">
        <ul class="o-lp-list">${sectionHtml}</ul>
      </div>
      <div class="o-lp-status">${getStatus() === SITE_STATUS.LOADING ? 'Hämtar kartinnehåll…' : statusMessage}</div>`;
  }

  // Asked before anything that would close the open submenu's text (e.g. with
  // unsaved edits); false keeps everything as it is.
  function mayLeaveSelection() {
    return !activeItemKey || typeof canLeaveSelection !== 'function' || canLeaveSelection();
  }

  function bindEvents() {
    el.querySelector('#o-lp-close-btn').addEventListener('click', () => {
      if (!mayLeaveSelection()) return;
      unmount();
    });

    const settingsBtn = el.querySelector('#o-lp-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        if (canConfigure() && typeof onConfigEdit === 'function') onConfigEdit();
      });
    }

    el.querySelectorAll('[data-role="section"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sectionId = btn.getAttribute('data-section');
        const collapsing = expandedSectionId === sectionId;
        const closesActive = collapsing && activeItemKey && activeItemKey.startsWith(`${sectionId}__`);
        if (closesActive && !mayLeaveSelection()) return;
        expandedSectionId = collapsing ? '' : sectionId;

        if (closesActive) {
          activeItemKey = null;
          statusMessage = '';
          if (typeof onDeactivate === 'function') onDeactivate();
        }

        refresh();
      });
    });

    el.querySelectorAll('[data-role="item"]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectItem(btn.getAttribute('data-section'), btn.getAttribute('data-item'));
      });
    });
  }

  // Clicking a submenu item: opens it, or closes it when it is already open.
  function selectItem(sectionId, itemId) {
    const menus = getMenus();
    const menu = menus.find(m => m.id === sectionId);
    const item = menu && menu.items.find(i => i.id === itemId);
    if (!menu || !item) return;
    if (!mayLeaveSelection()) return;

    const key = `${sectionId}__${itemId}`;
    if (activeItemKey === key) {
      activeItemKey = null;
      statusMessage = '';
      if (typeof onDeactivate === 'function') onDeactivate();
      refresh();
      return;
    }

    const layerTitle = `${menu.label} – ${item.label}`;
    // Built-in text: no layer, no content from the server.
    if (item.loadDoc) {
      activeItemKey = key;
      statusMessage = '';
      onLayerSelect({ contentKey: null, layerName: null, layer: null, layerTitle, loadDoc: item.loadDoc });
      refresh();
      return;
    }

    const layerName = item.layerName || null;
    const layer = layerName
      ? (getAllLayers(viewer).find(l => getLayerIdentifier(l) === layerName) || null)
      : null;
    activeItemKey = key;
    statusMessage = layer
      ? 'Valt lager visas i kartan.'
      : `Lagret "${layerName || key}" är inte laddat.`;
    onLayerSelect({ contentKey: layerName, layerName, layer, layerTitle });

    refresh();
  }

  // The submenu after the active one in reading order, continuing into the
  // next section; null when the active one is the last of the whole menu.
  function getNextItem() {
    if (!activeItemKey) return null;
    const flat = [];
    getMenus().forEach(menu => menu.items.forEach(item => flat.push({ menu, item })));
    const index = flat.findIndex(({ menu, item }) => `${menu.id}__${item.id}` === activeItemKey);
    const next = index >= 0 ? flat[index + 1] : null;
    if (!next) return null;
    return { sectionId: next.menu.id, itemId: next.item.id, label: next.item.label, sectionLabel: next.menu.label };
  }

  // Opens the next submenu as if it had been clicked, expanding its section
  // (only one section is expanded at a time, so the previous one collapses).
  function selectNext() {
    const next = getNextItem();
    if (!next) return;
    expandedSectionId = next.sectionId;
    selectItem(next.sectionId, next.itemId);
  }

  function refresh() {
    if (!el) return;
    el.setAttribute('aria-label', getHeaderText(siteConfig));
    el.innerHTML = renderMenu();
    bindEvents();
  }

  function updateConfig(newConfig) {
    siteConfig = newConfig || {};
    refresh();
  }

  function applyLayout() {
    if (!parentEl || !viewerEl) return;
    parentEl.classList.add('o-plugin-layout', 'o-has-layer-panel');
    viewerEl.classList.add('o-plugin-viewer');
    viewer.getMap().updateSize();
  }

  function clearLayout() {
    if (!parentEl || !viewerEl) return;
    parentEl.classList.remove('o-has-layer-panel');
    if (!parentEl.classList.contains('o-has-text-panel')) {
      parentEl.classList.remove('o-plugin-layout');
      viewerEl.classList.remove('o-plugin-viewer');
    }
    viewer.getMap().updateSize();
  }

  function mount() {
    viewerEl = document.getElementById(viewer.getId());
    parentEl = viewerEl ? viewerEl.parentNode : null;
    if (!viewerEl || !parentEl) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<aside id="o-layer-panel" aria-label="${getHeaderText(siteConfig)}"></aside>`;
    el = wrapper.firstElementChild;
    parentEl.insertBefore(el, viewerEl);

    applyLayout();
    refresh();
  }

  function deactivate() {
    if (!activeItemKey) return;
    activeItemKey = null;
    statusMessage = '';
    refresh();
  }

  function unmount() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    clearLayout();
    el = null;
    viewerEl = null;
    parentEl = null;
    if (typeof onClose === 'function') onClose();
  }

  return { mount, unmount, deactivate, updateConfig, refresh, getNextItem, selectNext };
};

export default LayerPanel;
