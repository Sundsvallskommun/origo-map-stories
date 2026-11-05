import { DEFAULT_HELP_URL, getOptions, pluginFileUrl } from './config';

// What the plugin shows when there is no real content to show: the menu and
// texts for a database outage and for an empty database. Nothing here may
// depend on the content server, which is what is missing in an outage.

const SITE_STATUS = {
  LOADING: 'loading', // config and catalog not fetched yet
  READY: 'ready',
  OUTAGE: 'outage', // fetching config or catalog failed, in any way
  EMPTY: 'empty' // server reachable, no configured menus and an empty catalog
};

const OUTAGE_TEXT_FILE = 'gor-sa-har.json';
const OUTAGE_TEXT_TIMEOUT_MS = 10000;

function text(value) {
  return { type: 'text', text: value };
}

function code(value) {
  return { type: 'text', marks: [{ type: 'code' }], text: value };
}

function heading(level, value) {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

function paragraph(...content) {
  return { type: 'paragraph', content };
}

// Shown when plugins/gor-sa-har.json (public/gor-sa-har.json) can't be fetched.
// The link goes to the helpUrl option.
function buildOutageFallbackDoc() {
  const helpUrl = getOptions().helpUrl;
  return {
    type: 'doc',
    content: [
      heading(1, 'Gör så här'),
      paragraph(text('Kartans menyer, texter och kartlager lagras i en databas som inte går att nå just nu. Kartan i övrigt fungerar som vanligt. Är du besökare behöver du inte göra något.')),
      paragraph(
        text('Driver du kartan: instruktioner finns i '),
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: helpUrl, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }],
          text: 'README-filen på GitHub'
        },
        text('.')
      )
    ]
  };
}

// gor-sa-har.json links to the product README; a configured helpUrl
// replaces those links.
function applyHelpUrl(node, helpUrl) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(child => applyHelpUrl(child, helpUrl));
  const copy = {};
  Object.keys(node).forEach(key => { copy[key] = applyHelpUrl(node[key], helpUrl); });
  if (copy.type === 'link' && copy.attrs && copy.attrs.href === DEFAULT_HELP_URL) {
    copy.attrs = { ...copy.attrs, href: helpUrl };
  }
  return copy;
}

const EMPTY_DOC = {
  type: 'doc',
  content: [
    heading(1, 'Gör så här'),
    paragraph(text('Databasen är uppkopplad men innehåller inga menyer eller kartlager än. Är du besökare behöver du inte göra något.')),
    paragraph(text('Driver du kartan: logga in som administratör och importera en exporterad zip-fil under Sajtkonfiguration → Versionshistorik, eller bygg menyer under Sajtkonfiguration. Innehåll från en äldre innehållsmapp läggs in på servern med:')),
    { type: 'codeBlock', attrs: { language: 'bash' }, content: [text('node scripts/import-content-folder.js <innehållsmapp>')] },
    paragraph(text('Ladda sedan om kartan. Skriptet finns i '), code('scripts/import-content-folder.js'), text('.'))
  ]
};

// Empty only when no menu list was ever configured: an explicitly emptied
// list (menus: []) is an admin's choice, and any layer means real content.
function classifySiteStatus(config, layerNames) {
  const hasMenuList = Array.isArray(config.menus);
  return !hasMenuList && layerNames.length === 0 ? SITE_STATUS.EMPTY : SITE_STATUS.READY;
}

// The plugin's folder differs per environment, so the file is found relative
// to the script itself.
function getOutageTextUrl() {
  return pluginFileUrl(OUTAGE_TEXT_FILE);
}

async function loadOutageDoc() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTAGE_TEXT_TIMEOUT_MS);
  try {
    const res = await fetch(getOutageTextUrl(), { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) return buildOutageFallbackDoc();
    const doc = await res.json();
    return doc && doc.type === 'doc' && Array.isArray(doc.content)
      ? applyHelpUrl(doc, getOptions().helpUrl)
      : buildOutageFallbackDoc();
  } catch {
    return buildOutageFallbackDoc();
  } finally {
    clearTimeout(timer);
  }
}

// The menus replacing the configured ones; null means the configured ones apply.
function getStatusMenus(status) {
  if (status === SITE_STATUS.LOADING) return [];
  if (status === SITE_STATUS.OUTAGE) {
    return [{
      id: 'databasen-inte-uppkopplad',
      label: 'Databasen inte uppkopplad',
      items: [{ id: 'gor-sa-har', label: 'Gör så här', loadDoc: loadOutageDoc }]
    }];
  }
  if (status === SITE_STATUS.EMPTY) {
    return [{
      id: 'databasen-saknar-innehall',
      label: 'Databasen saknar innehåll',
      items: [{ id: 'gor-sa-har', label: 'Gör så här', loadDoc: async () => EMPTY_DOC }]
    }];
  }
  return null;
}

export { SITE_STATUS, classifySiteStatus, getStatusMenus };
