import type { NoteData } from '../types/app';
import { sanitizeRichHtml } from './htmlSanitizer';
import {
  dehydrateStorageMediaHtml,
  hydrateStorageMediaHtml,
  imageMetadataFromElement,
  storageImageAttrsHtml,
  storagePlaceholderSrc,
  type StoredImageMetadata,
} from './mediaStorage';

export const extractImagesFromHtml = (html?: string) => {
  if (!html || typeof document === 'undefined') return [];
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichHtml(html);
  return Array.from(container.querySelectorAll('img'))
    .map(image => image.getAttribute('src'))
    .filter((src): src is string => Boolean(src));
};

export const extractStoredImagesFromHtml = (html?: string) => {
  if (!html || typeof document === 'undefined') return [];
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichHtml(html);
  return Array.from(container.querySelectorAll('[data-note-image="true"]'))
    .map(figure => imageMetadataFromElement(figure))
    .filter((metadata): metadata is StoredImageMetadata => Boolean(metadata));
};

export const uniqueStoredImages = (metadataList: StoredImageMetadata[]) => (
  metadataList.filter((metadata, index, list) => (
    list.findIndex(item => item.bucket === metadata.bucket && item.path === metadata.path) === index
  ))
);

export const getRemovedStoredImages = (previousImages: StoredImageMetadata[], nextImages: StoredImageMetadata[]) => (
  uniqueStoredImages(previousImages).filter(previous => (
    !nextImages.some(next => next.bucket === previous.bucket && next.path === previous.path)
  ))
);

export const getStoredImagesFromNote = (note?: NoteData) => (
  uniqueStoredImages([
    ...(note?.images || []),
    ...extractStoredImagesFromHtml(note?.contentHtml),
  ])
);

export const htmlToText = (html?: string) => {
  if (!html || typeof document === 'undefined') return '';
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichHtml(html);
  return (container.textContent || '').replace(/\s+/g, ' ').trim();
};

export const escapeHtml = (value: string) => (
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
);

export const textToParagraphHtml = (content: string) => (
  content
    .split(/\n\s*\n/)
    .filter(block => block.trim().length > 0)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
);

export const getLegacyNoteImages = (note?: NoteData) => {
  const imageUrls = Array.isArray(note?.imageUrls) ? note.imageUrls : [];
  const legacyImageUrl = note?.imageUrl && !imageUrls.includes(note.imageUrl) ? [note.imageUrl] : [];
  return [...imageUrls, ...legacyImageUrl];
};

export const readerRemoveImageButtonHtml = (label = 'Remove image') => (
  `<button type="button" data-remove-image="true" aria-label="${escapeHtml(label)}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>` +
  `</button>`
);

export const imageToReaderHtml = (
  src: string,
  altText = 'Note attachment',
  removeImageText = 'Remove image',
  metadata?: StoredImageMetadata | null
) => {
  const mediaAttrs = metadata ? ` ${storageImageAttrsHtml(metadata)}` : '';
  const imageSrc = metadata ? (src || storagePlaceholderSrc(metadata)) : src;
  return (
  `<figure class="note-inline-image" contenteditable="false" data-note-image="true">` +
    `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(altText)}" referrerpolicy="no-referrer"${mediaAttrs} />` +
    readerRemoveImageButtonHtml(removeImageText) +
  `</figure>`
  );
};

export const readerEditableTailHtml = '<p data-note-tail="true"><br></p>';

export const getLastReaderContentChild = (element: HTMLElement) => {
  let node = element.lastChild;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
    node = node.previousSibling;
  }
  return node;
};

export const readerNodeHasMeaningfulContent = (node: Node) => {
  if (!(node instanceof HTMLElement)) return Boolean(node.textContent?.trim());
  return Boolean(node.textContent?.trim() || node.querySelector('img'));
};

const appendReaderEditableTail = (element: HTMLElement) => {
  const tail = document.createElement('p');
  tail.dataset.noteTail = 'true';
  tail.appendChild(document.createElement('br'));
  element.appendChild(tail);
  return tail;
};

const normalizeReaderEditableTailMarkers = (element: HTMLElement) => {
  element.querySelectorAll<HTMLElement>('[data-note-tail="true"]').forEach(tail => {
    if (readerNodeHasMeaningfulContent(tail)) {
      delete tail.dataset.noteTail;
    } else {
      tail.replaceChildren(document.createElement('br'));
    }
  });
};

export const ensureReaderEditableTailAfterMedia = (element: HTMLElement) => {
  normalizeReaderEditableTailMarkers(element);
  const lastChild = getLastReaderContentChild(element);
  if (!lastChild) return appendReaderEditableTail(element);

  if (
    lastChild instanceof HTMLElement &&
    lastChild.matches('p') &&
    !readerNodeHasMeaningfulContent(lastChild)
  ) {
    lastChild.dataset.noteTail = 'true';
    return lastChild;
  }

  if (
    lastChild instanceof HTMLElement &&
    (
      lastChild.matches('[data-note-image="true"]') ||
      lastChild.getAttribute('contenteditable') === 'false'
    )
  ) {
    return appendReaderEditableTail(element);
  }

  return null;
};

export const cleanReaderHtml = (html: string, imageAltText?: string, removeImageText?: string) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichHtml(html);
  container
    .querySelectorAll('[data-remove-image="true"], [data-preview-image="true"], button')
    .forEach(element => element.remove());
  container.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
  container.querySelectorAll<HTMLElement>('.note-inline-image, [data-note-image="true"]').forEach(figure => {
    figure.classList.add('note-inline-image');
    figure.setAttribute('contenteditable', 'false');
    figure.dataset.noteImage = 'true';
    figure.insertAdjacentHTML('beforeend', readerRemoveImageButtonHtml(removeImageText));
  });
  container.querySelectorAll('[data-note-tail="true"]').forEach(element => {
    if (!element.textContent?.trim() && !element.querySelector('img')) element.remove();
  });
  if (imageAltText) {
    container.querySelectorAll<HTMLImageElement>('img').forEach(image => {
      image.alt = imageAltText;
    });
  }
  return dehydrateStorageMediaHtml(container.innerHTML);
};

export const getReadableNoteHtml = (note?: NoteData, imageAltText = 'Note attachment', removeImageText = 'Remove image') => {
  if (!note) return '';
  const legacyImages = getLegacyNoteImages(note);
  const legacyImageHtml = legacyImages.map(src => imageToReaderHtml(src, imageAltText, removeImageText)).join('');
  const html = note.contentHtml ?? `${textToParagraphHtml(note.content || '')}${legacyImageHtml}`;
  return hydrateStorageMediaHtml(cleanReaderHtml(html, imageAltText, removeImageText));
};

export const getReadableTitleHtml = (note?: NoteData, fallbackTitle = 'Untitled note') => (
  cleanReaderHtml(note?.titleHtml || escapeHtml(note?.title || fallbackTitle))
);
