import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import MapFeatureMark from './mapFeatureMark';
import MapViewMark from './mapViewMark';
import { uploadImage } from './contentApi';

const SelectableImage = Image.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'o-image-node';

      const img = document.createElement('img');
      img.src = node.attrs.src || '';
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      img.setAttribute('draggable', 'false');
      wrapper.appendChild(img);

      wrapper.addEventListener('click', () => {
        const pos = getPos();
        if (pos !== undefined) editor.commands.setNodeSelection(pos);
      });

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          img.src = updatedNode.attrs.src || '';
          img.alt = updatedNode.attrs.alt || '';
          img.title = updatedNode.attrs.title || '';
          return true;
        }
      };
    };
  }
});

function createToolbar(editor, { onOpenMapLink } = {}) {
  const toolbar = document.createElement('div');
  toolbar.className = 'o-editor-toolbar';
  toolbar.innerHTML = `
    <button data-cmd="bold" title="Fet"><b>B</b></button>
    <button data-cmd="italic" title="Kursiv"><i>I</i></button>
    <button data-cmd="heading1" title="Rubrik 1">H1</button>
    <button data-cmd="heading2" title="Rubrik 2">H2</button>
    <button data-cmd="bulletList" title="Punktlista">&#8226;</button>
    <button data-cmd="image" title="Infoga bild">&#128247;</button>
    <button data-cmd="mapLink" title="Koppla markerad text till kartan" class="o-link-map-btn">&#128279;</button>
  `;

  // Keep the editor focused while a toolbar button is pressed. Otherwise the
  // button takes focus and Tiptap's focus() only gives it back in the next
  // animation frame, so the first key typed right after the click is lost.
  toolbar.addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault();
  });

  toolbar.querySelector('[data-cmd="bold"]').addEventListener('click', () =>
    editor.chain().focus().toggleBold().run());
  toolbar.querySelector('[data-cmd="italic"]').addEventListener('click', () =>
    editor.chain().focus().toggleItalic().run());
  toolbar.querySelector('[data-cmd="heading1"]').addEventListener('click', () =>
    editor.chain().focus().toggleHeading({ level: 1 }).run());
  toolbar.querySelector('[data-cmd="heading2"]').addEventListener('click', () =>
    editor.chain().focus().toggleHeading({ level: 2 }).run());
  toolbar.querySelector('[data-cmd="bulletList"]').addEventListener('click', () =>
    editor.chain().focus().toggleBulletList().run());
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  toolbar.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const url = await uploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      alert(err.message);
    }
  });

  toolbar.querySelector('[data-cmd="image"]').addEventListener('click', () => {
    fileInput.click();
  });

  toolbar.querySelector('[data-cmd="mapLink"]').addEventListener('click', () =>
    onOpenMapLink());

  return toolbar;
}

function createEditor({ element, content, editable, onOpenMapLink }) {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      SelectableImage,
      MapFeatureMark,
      MapViewMark
    ],
    content: content || '<p>Ingen text än. Klicka Redigera texten för att börja.</p>',
    editable,
    editorProps: {
      attributes: { class: 'o-tiptap-content' }
    }
  });

  let toolbar = null;

  function setEditable(val) {
    editor.setEditable(val);
    if (val && !toolbar) {
      toolbar = createToolbar(editor, { onOpenMapLink });
      element.parentNode.insertBefore(toolbar, element);
    } else if (!val && toolbar) {
      toolbar.parentNode.removeChild(toolbar);
      toolbar = null;
    }
  }

  // The link modal and map pick mode take focus away from the editor, so the
  // text selection is captured when the modal opens and restored before a
  // link is applied.
  let savedSelection = null;

  function saveSelection() {
    const { from, to } = editor.state.selection;
    savedSelection = { from, to };
    return from !== to;
  }

  function withSavedSelection() {
    const chain = editor.chain().focus();
    return savedSelection ? chain.setTextSelection(savedSelection) : chain;
  }

  function applyFeatureLink(featureId, layerName, extent) {
    withSavedSelection().setMapFeatureLink({ featureId, layerName, extent: extent || null }).run();
  }

  function applyMapViewLink(mapState) {
    withSavedSelection().setMapViewLink({ mapState, center: null, zoom: null }).run();
  }

  function unsetMapLinks() {
    withSavedSelection().unsetMapFeatureLink().unsetMapViewLink().run();
  }

  function getJSON() {
    return editor.getJSON();
  }

  function setContent(doc) {
    editor.commands.setContent(doc || '');
  }

  function destroy() {
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    editor.destroy();
  }

  return {
    setEditable, saveSelection, applyFeatureLink, applyMapViewLink, unsetMapLinks, getJSON, setContent, destroy
  };
}

export { createEditor };
