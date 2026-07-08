import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Palette, ImageIcon, Camera, Check, ChevronsLeft, ChevronsRight, Plus, Trash2, Underline } from 'lucide-react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { StarData } from './App';
import {
  dehydrateStorageMediaHtml,
  deleteImageFromStorage,
  hydrateStorageMediaHtml,
  imageMetadataFromElement,
  isSupabaseMediaEnabled,
  storageImageAttrsHtml,
  storagePlaceholderSrc,
  uploadImageToStorage,
  type StoredImageMetadata,
} from './lib/mediaStorage';

type NoteData = NonNullable<StarData['notes']>[number] & {
  titleHtml?: string;
  contentHtml?: string;
  imageUrls?: string[];
  images?: StoredImageMetadata[];
  titleFontSize?: number;
};

interface NoteEditorModalProps {
  star: StarData;
  initialNoteId?: string;
  language?: string;
  mediaRefreshKey?: number;
  onClose: () => void;
  onSave: (notes: NoteData[]) => void;
}

const DEFAULT_COLORS = [
  '#D2936D', '#B6A5B9', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#CBE0E8', '#80AACD', '#D3CCE3', '#F0EBE1', '#28292B'
];

const FONT_SIZES = [12, 14, 16, 18, 22, 26];
const IMAGE_MAX_BYTES = 100 * 1024;
const OLD_DEFAULT_NOTE_TITLE = 'The "Campus" Entry';
const OLD_DEFAULT_NOTE_START = 'Finally standing in front of the White Horse statue';
const SAMPLE_NOTE_IMAGE_URL = `${import.meta.env.BASE_URL}note-sample.jpg`;
const DEFAULT_NOTE_CONTENT = 'Today was simple and quiet. I walked for a while, took one photo, and saved this small note.';
const EDITABLE_TAIL_HTML = '<p data-note-tail="true"></p>';
const DEFAULT_RECORD_STAR_ID = 'default-record-star';

const NOTE_EDITOR_COPY = {
  en: {
    closeEditor: 'Close note editor',
    fontSize: 'Font size',
    underline: 'Underline',
    noteColor: 'Note color',
    insertImage: 'Insert image below text',
    takePhoto: 'Take photo below text',
    saveNote: 'Save note',
    title: 'Title',
    titlePlaceholder: 'Title...',
    bodyPlaceholder: 'Write your note here...',
    cancel: 'Cancel',
    capture: 'Capture',
    previousNote: 'Previous note',
    createNote: 'Create a new note',
    deleteNote: 'Delete this note',
    nextNote: 'Next note',
    closeImagePreview: 'Close image preview',
    largeAttachmentAlt: 'Large note attachment',
    noteAttachmentAlt: 'Note attachment',
    removeImage: 'Remove image',
    viewLargerImage: 'View larger image',
  },
  zh: {
    closeEditor: '关闭笔记编辑器',
    fontSize: '字号',
    underline: '下划线',
    noteColor: '笔记颜色',
    insertImage: '在文字下方插入图片',
    takePhoto: '在文字下方拍照',
    saveNote: '保存笔记',
    title: '标题',
    titlePlaceholder: '标题...',
    bodyPlaceholder: '在这里写笔记...',
    cancel: '取消',
    capture: '拍摄',
    previousNote: '上一条笔记',
    createNote: '新建笔记',
    deleteNote: '删除这条笔记',
    nextNote: '下一条笔记',
    closeImagePreview: '关闭图片预览',
    largeAttachmentAlt: '笔记大图',
    noteAttachmentAlt: '笔记图片',
    removeImage: '移除图片',
    viewLargerImage: '查看大图',
  },
  ko: {
    closeEditor: '노트 편집기 닫기',
    fontSize: '글자 크기',
    underline: '밑줄',
    noteColor: '노트 색상',
    insertImage: '텍스트 아래에 이미지 삽입',
    takePhoto: '텍스트 아래에 사진 촬영',
    saveNote: '노트 저장',
    title: '제목',
    titlePlaceholder: '제목...',
    bodyPlaceholder: '여기에 노트를 작성...',
    cancel: '취소',
    capture: '촬영',
    previousNote: '이전 노트',
    createNote: '새 노트 만들기',
    deleteNote: '이 노트 삭제',
    nextNote: '다음 노트',
    closeImagePreview: '이미지 미리보기 닫기',
    largeAttachmentAlt: '큰 노트 이미지',
    noteAttachmentAlt: '노트 이미지',
    removeImage: '이미지 제거',
    viewLargerImage: '큰 이미지 보기',
  },
};

type NoteEditorCopy = typeof NOTE_EDITOR_COPY.en;

const defaultNote: NoteData = {
  id: Date.now().toString(),
  title: 'Today Note',
  titleHtml: 'Today Note',
  content: DEFAULT_NOTE_CONTENT,
  imageUrl: SAMPLE_NOTE_IMAGE_URL,
  fontSize: 18,
  titleFontSize: 18,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  color: '#D2936D'
};

const createBlankNote = (): NoteData => {
  const timestamp = Date.now();
  return {
    id: timestamp.toString(),
    title: '',
    titleHtml: '',
    content: '',
    contentHtml: '',
    fontSize: 18,
    titleFontSize: 18,
    createdAt: timestamp,
    updatedAt: timestamp,
    color: '#D2936D'
  };
};

const escapeHtml = (value: string) => (
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
);

const textToHtml = (content: string) => (
  content
    .split(/\n\s*\n/)
    .filter(block => block.trim().length > 0)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
);

const getNoteImages = (note: NoteData | undefined) => {
  const imageUrls = Array.isArray(note?.imageUrls) ? note.imageUrls : [];
  const legacyImageUrl = note?.imageUrl && !imageUrls.includes(note.imageUrl) ? [note.imageUrl] : [];
  return [...imageUrls, ...legacyImageUrl];
};

const imageToHtml = (imageUrl: string, copy: NoteEditorCopy = NOTE_EDITOR_COPY.en, metadata?: StoredImageMetadata | null) => {
  const mediaAttrs = metadata ? ` ${storageImageAttrsHtml(metadata)}` : '';
  const src = metadata ? (imageUrl || storagePlaceholderSrc(metadata)) : imageUrl;
  return (
  `<figure class="note-inline-image" contenteditable="false" data-note-image="true">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(copy.noteAttachmentAlt)}"${mediaAttrs} />` +
    `<button type="button" data-remove-image="true" aria-label="${escapeHtml(copy.removeImage)}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>` +
    `</button>` +
    `<button type="button" data-preview-image="true" aria-label="${escapeHtml(copy.viewLargerImage)}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>` +
    `</button>` +
  `</figure>`
  );
};

const localizeNoteImageControls = (html: string, copy: NoteEditorCopy) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('.note-inline-image, [data-note-image="true"]').forEach(figure => {
    figure.classList.add('note-inline-image');
    figure.setAttribute('contenteditable', 'false');
    figure.dataset.noteImage = 'true';

    if (!figure.querySelector('[data-remove-image="true"]')) {
      figure.insertAdjacentHTML('beforeend',
        `<button type="button" data-remove-image="true" aria-label="${escapeHtml(copy.removeImage)}">` +
          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>` +
        `</button>`
      );
    }

    if (!figure.querySelector('[data-preview-image="true"]')) {
      figure.insertAdjacentHTML('beforeend',
        `<button type="button" data-preview-image="true" aria-label="${escapeHtml(copy.viewLargerImage)}">` +
          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>` +
        `</button>`
      );
    }
  });
  container.querySelectorAll<HTMLImageElement>('[data-note-image="true"] img').forEach(image => {
    image.alt = copy.noteAttachmentAlt;
  });
  container.querySelectorAll<HTMLElement>('[data-remove-image="true"]').forEach(button => {
    button.setAttribute('aria-label', copy.removeImage);
  });
  container.querySelectorAll<HTMLElement>('[data-preview-image="true"]').forEach(button => {
    button.setAttribute('aria-label', copy.viewLargerImage);
  });
  return hydrateStorageMediaHtml(container.innerHTML);
};

const isOldDefaultNote = (note: NoteData) => (
  (
    note.title === OLD_DEFAULT_NOTE_TITLE &&
    (
      note.content?.startsWith(OLD_DEFAULT_NOTE_START) ||
      note.contentHtml?.includes(OLD_DEFAULT_NOTE_START)
    )
  ) ||
  (
    note.title === defaultNote.title &&
    note.content === DEFAULT_NOTE_CONTENT &&
    !note.contentHtml?.includes(SAMPLE_NOTE_IMAGE_URL)
  )
);

const splitContentForLegacyImages = (content: string) => {
  const splitMatch = content.match(/\n\s*\n/);
  if (!splitMatch || splitMatch.index === undefined) {
    return { beforeImages: content, afterImages: '' };
  }

  const splitStart = splitMatch.index;
  const splitEnd = splitStart + splitMatch[0].length;
  return {
    beforeImages: content.slice(0, splitStart),
    afterImages: content.slice(splitEnd),
  };
};

const noteToHtml = (note: NoteData, copy: NoteEditorCopy = NOTE_EDITOR_COPY.en) => {
  if (note.contentHtml !== undefined) return localizeNoteImageControls(note.contentHtml, copy);

  const images = getNoteImages(note);
  if (images.length === 0) return textToHtml(note.content || '');

  const { beforeImages, afterImages } = splitContentForLegacyImages(note.content || '');
  return [
    textToHtml(beforeImages),
    ...images.map(imageUrl => imageToHtml(imageUrl, copy)),
    textToHtml(afterImages),
    afterImages.trim() ? '' : EDITABLE_TAIL_HTML,
  ].join('');
};

const normalizeNote = (note: NoteData, copy: NoteEditorCopy = NOTE_EDITOR_COPY.en): NoteData => {
  const sourceNote = isOldDefaultNote(note)
    ? { ...defaultNote, id: note.id || defaultNote.id }
    : note;

  return {
  ...sourceNote,
  titleHtml: sourceNote.titleHtml ?? escapeHtml(sourceNote.title || ''),
  contentHtml: noteToHtml(sourceNote, copy),
  imageUrl: undefined,
  imageUrls: undefined,
  };
};

const getInitialNotes = (star: StarData, copy: NoteEditorCopy = NOTE_EDITOR_COPY.en) => (
  (
    star.notes && star.notes.length > 0
      ? star.notes
      : [star.id === DEFAULT_RECORD_STAR_ID ? defaultNote : createBlankNote()]
  ).map(note => normalizeNote(note, copy))
);

const getInitialNoteIndex = (notes: NoteData[], initialNoteId?: string) => {
  if (!initialNoteId) return 0;
  const index = notes.findIndex(note => note.id === initialNoteId);
  return index >= 0 ? index : 0;
};

const getLastContentChild = (element: HTMLElement) => {
  let node = element.lastChild;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
    node = node.previousSibling;
  }
  return node;
};

const hasMeaningfulContent = (node: Node) => {
  if (!(node instanceof HTMLElement)) return Boolean(node.textContent?.trim());
  return Boolean(node.textContent?.trim() || node.querySelector('img'));
};

const appendEditableTail = (element: HTMLElement) => {
  const tail = document.createElement('p');
  tail.dataset.noteTail = 'true';
  tail.appendChild(document.createElement('br'));
  element.appendChild(tail);
  return tail;
};

const normalizeEditableTailMarkers = (element: HTMLElement) => {
  element.querySelectorAll<HTMLElement>('[data-note-tail="true"]').forEach(tail => {
    if (hasMeaningfulContent(tail)) {
      delete tail.dataset.noteTail;
    } else {
      tail.replaceChildren(document.createElement('br'));
    }
  });
};

const ensureEditableTailAfterMedia = (element: HTMLElement) => {
  normalizeEditableTailMarkers(element);
  const lastChild = getLastContentChild(element);
  if (!lastChild) {
    return;
  }

  if (
    lastChild instanceof HTMLElement &&
    lastChild.matches('p') &&
    !hasMeaningfulContent(lastChild)
  ) {
    lastChild.dataset.noteTail = 'true';
    return;
  }

  if (
    lastChild instanceof HTMLElement &&
    (
      lastChild.matches('[data-note-image="true"]') ||
      lastChild.getAttribute('contenteditable') === 'false'
    )
  ) {
    appendEditableTail(element);
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number) => (
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not compress image.'));
    }, mimeType, quality);
  })
);

const blobToDataUrl = (blob: Blob) => (
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  })
);

const loadImage = (file: File) => (
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image.'));
    };
    img.src = objectUrl;
  })
);

const compressImageToDataUrl = async (file: File) => {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  const maxDimension = 1400;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const initialScale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));

  let quality = 0.82;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    lastBlob = blob;
    if (blob.size <= IMAGE_MAX_BYTES) return blobToDataUrl(blob);

    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.12);
    } else {
      width = Math.max(240, Math.round(width * 0.84));
      height = Math.max(240, Math.round(height * 0.84));
      quality = 0.72;
    }
  }

  if (!lastBlob) throw new Error('Could not compress image.');
  return blobToDataUrl(lastBlob);
};

const dataUrlToFile = async (dataUrl: string, fileName: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
};

const extractStoredImagesFromHtml = (html: string) => {
  if (!html || typeof document === 'undefined') return [];
  const container = document.createElement('div');
  container.innerHTML = html;
  return Array.from(container.querySelectorAll('[data-note-image="true"]'))
    .map(figure => imageMetadataFromElement(figure))
    .filter((metadata): metadata is StoredImageMetadata => Boolean(metadata));
};

const uniqueStoredImages = (metadataList: StoredImageMetadata[]) => (
  metadataList.filter((metadata, index, list) => (
    list.findIndex(item => item.bucket === metadata.bucket && item.path === metadata.path) === index
  ))
);

const getStoredImagesFromNote = (note?: NoteData) => (
  uniqueStoredImages([
    ...(note?.images || []),
    ...extractStoredImagesFromHtml(note?.contentHtml || ''),
  ])
);

const deleteStoredImages = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void deleteImageFromStorage(metadata);
  });
};

export function NoteEditorModal({ star, initialNoteId, language = 'en', mediaRefreshKey = 0, onClose, onSave }: NoteEditorModalProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const titleEditorRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const pendingEditorStylesRef = useRef<Record<string, string>>({});
  const pendingTitleStylesRef = useRef<Record<string, string>>({});
  const copy = NOTE_EDITOR_COPY[language as keyof typeof NOTE_EDITOR_COPY] || NOTE_EDITOR_COPY.en;
  const initialNotes = React.useMemo(() => getInitialNotes(star, copy), [copy, star]);
  const [notes, setNotes] = useState<NoteData[]>(initialNotes);
  const [currentIndex, setCurrentIndex] = useState(() => getInitialNoteIndex(initialNotes, initialNoteId));
  const [activePanel, setActivePanel] = useState<'font' | 'color' | null>(null);
  const [activeTextTarget, setActiveTextTarget] = useState<'editor' | 'title'>('editor');
  const [selectedFontSize, setSelectedFontSize] = useState(18);
  const [selectedUnderline, setSelectedUnderline] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#D2936D');
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [editorEmpty, setEditorEmpty] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const currentNote = notes[currentIndex];
  const toolbarEdgeButtonClass = 'w-[26px] h-[26px] rounded-full bg-[var(--app-icon)] inline-flex items-center justify-center text-black hover:brightness-95 transition-all leading-none shrink-0';
  const toolbarButtonSlotClass = 'relative h-[26px] min-w-[27px] flex-1 basis-0';
  const toolbarButtonClass = 'w-full h-[26px] rounded-full bg-[var(--app-icon)] inline-flex items-center justify-center text-black hover:brightness-95 transition-all leading-none';
  const fontButtonSlotClass = 'relative h-8 min-w-[4rem] flex-[1.9] basis-0';
  const fontButtonClass = 'w-full h-8 px-2 rounded-full bg-[var(--app-icon)] inline-flex items-center justify-center text-black hover:brightness-95 transition-all font-medium font-sans gap-1.5 leading-none';
  const bottomButtonClass = 'w-12 h-12 rounded-full bg-[var(--app-card)] inline-flex items-center justify-center text-black transition-all hover:brightness-95 leading-none shrink-0 shadow-sm';
  const disabledBottomButtonClass = `${bottomButtonClass} disabled:text-black/45 disabled:hover:brightness-100`;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < notes.length - 1;

  const getEditorPlainText = () => {
    const editor = editorRef.current;
    if (!editor) return '';
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-remove-image="true"]').forEach(button => button.remove());
    return clone.innerText.trim();
  };

  const getTitlePlainText = (element = titleEditorRef.current) => (
    (element?.innerText || '').replace(/\s+/g, ' ').trim()
  );

  const syncTitleContent = () => {
    const titleEditor = titleEditorRef.current;
    if (!titleEditor || !currentNote) return;
    const title = getTitlePlainText(titleEditor);
    setNotes(prev => {
      const next = [...prev];
      next[currentIndex] = {
        ...next[currentIndex],
        title,
        titleHtml: titleEditor.innerHTML,
      };
      return next;
    });
  };

  const syncEditorContent = () => {
    const editor = editorRef.current;
    if (!editor || !currentNote) return;
    ensureEditableTailAfterMedia(editor);
    const hasImages = Boolean(editor.querySelector('img'));
    const plainText = getEditorPlainText();
    setEditorEmpty(plainText.length === 0 && !hasImages);
    setNotes(prev => {
      const next = [...prev];
      const contentHtml = dehydrateStorageMediaHtml(editor.innerHTML);
      next[currentIndex] = {
        ...next[currentIndex],
        content: plainText,
        contentHtml,
        images: extractStoredImagesFromHtml(contentHtml),
        imageUrl: undefined,
        imageUrls: undefined,
      };
      return next;
    });
  };

  useEffect(() => {
    const editor = editorRef.current;
    const titleEditor = titleEditorRef.current;
    if (!editor || !titleEditor || !currentNote) return;
    titleEditor.innerHTML = currentNote.titleHtml ?? escapeHtml(currentNote.title || '');
    editor.innerHTML = hydrateStorageMediaHtml(currentNote.contentHtml || '');
    ensureEditableTailAfterMedia(editor);
    setEditorEmpty(getEditorPlainText().length === 0 && !editor.querySelector('img'));
    setActivePanel(null);
    setShowCustomPicker(false);
    setActiveTextTarget('editor');
    setSelectedFontSize(currentNote.fontSize || 18);
    setSelectedUnderline(false);
    setSelectedColor(currentNote.color || '#D2936D');
  }, [currentIndex, currentNote?.id, mediaRefreshKey]);

  useEffect(() => {
    if (!isCameraOpen || !videoRef.current || !cameraStreamRef.current) return;
    videoRef.current.srcObject = cameraStreamRef.current;
    videoRef.current.play().catch(() => {});
  }, [isCameraOpen]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
  }, []);

  useEffect(() => {
    if (!activePanel) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setActivePanel(null);
      setShowCustomPicker(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [activePanel]);

  const clearPendingEditorStyles = () => {
    pendingEditorStylesRef.current = {};
  };

  const clearPendingTitleStyles = () => {
    pendingTitleStylesRef.current = {};
  };

  const rangeIsInsideElement = (range: Range, element: HTMLElement | null) => (
    Boolean(element && element.contains(range.commonAncestorContainer))
  );

  const rangeIsInsideTitle = (range: Range) => rangeIsInsideElement(range, titleEditorRef.current);

  const syncToolbarFontSizeFromTitle = () => {
    clearPendingEditorStyles();
    clearPendingTitleStyles();
    const titleEditor = titleEditorRef.current;
    const selection = window.getSelection();
    if (titleEditor && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (rangeIsInsideTitle(range)) {
        savedRangeRef.current = range.cloneRange();
        setActiveTextTarget('title');
        setSelectedFontSize(getFontSizeFromRange(range, titleEditor, currentNote?.titleFontSize || 18));
        setSelectedUnderline(getUnderlineFromRange(range, titleEditor));
        return;
      }
    }

    savedRangeRef.current = null;
    setActiveTextTarget('title');
    setSelectedFontSize(currentNote?.titleFontSize || 18);
    setSelectedUnderline(false);
  };

  const rangeIsInsideEditor = (range: Range) => {
    return rangeIsInsideElement(range, editorRef.current);
  };

  const normalizeFontSize = (fontSize: number) => {
    const roundedSize = Math.round(fontSize);
    return FONT_SIZES.find(size => Math.abs(size - roundedSize) <= 1) || roundedSize;
  };

  const getFontSizeFromNode = (
    node: Node | null,
    container = editorRef.current,
    fallbackSize = currentNote?.fontSize || 18
  ) => {
    if (!container || !node) return fallbackSize;

    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
    const target = element instanceof HTMLElement && container.contains(element)
      ? element
      : container;
    const fontSize = parseFloat(window.getComputedStyle(target).fontSize);
    return Number.isFinite(fontSize)
      ? normalizeFontSize(fontSize)
      : fallbackSize;
  };

  const getFirstTextNodeInRange = (range: Range, container = editorRef.current) => {
    if (!container) return null;

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          const parentElement = node.parentElement;
          if (parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button')) {
            return NodeFilter.FILTER_REJECT;
          }
          return range.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    return walker.nextNode();
  };

  const getFontSizeFromRange = (
    range: Range,
    container = editorRef.current,
    fallbackSize = currentNote?.fontSize || 18
  ) => {
    if (!range.collapsed) {
      const selectedTextNode = getFirstTextNodeInRange(range, container);
      if (selectedTextNode) return getFontSizeFromNode(selectedTextNode, container, fallbackSize);
    }

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const rangeContainer = range.startContainer;
      const childAtCaret = rangeContainer.childNodes[range.startOffset] || rangeContainer.childNodes[range.startOffset - 1];
      if (childAtCaret) return getFontSizeFromNode(childAtCaret, container, fallbackSize);
    }

    return getFontSizeFromNode(range.startContainer, container, fallbackSize);
  };

  const getUnderlineFromNode = (node: Node | null, container = editorRef.current) => {
    if (!container || !node) return false;

    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
    const target = element instanceof HTMLElement && container.contains(element)
      ? element
      : container;
    const decorationLine = window.getComputedStyle(target).textDecorationLine;
    return decorationLine.includes('underline') || Boolean(target.closest('u'));
  };

  const getUnderlineFromRange = (range: Range, container = editorRef.current) => {
    if (!range.collapsed) {
      const selectedTextNode = getFirstTextNodeInRange(range, container);
      if (selectedTextNode) return getUnderlineFromNode(selectedTextNode, container);
    }

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const rangeContainer = range.startContainer;
      const childAtCaret = rangeContainer.childNodes[range.startOffset] || rangeContainer.childNodes[range.startOffset - 1];
      if (childAtCaret) return getUnderlineFromNode(childAtCaret, container);
    }

    return getUnderlineFromNode(range.startContainer, container);
  };

  const syncToolbarFontSizeFromRange = (range: Range) => {
    if (!rangeIsInsideEditor(range)) return;
    setSelectedFontSize(getFontSizeFromRange(range));
    setSelectedUnderline(getUnderlineFromRange(range));
  };

  const saveEditorSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!rangeIsInsideEditor(range)) return;
    setActiveTextTarget('editor');
    savedRangeRef.current = range.cloneRange();
    syncToolbarFontSizeFromRange(range);
  };

  const restoreEditorRange = (range: Range) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !rangeIsInsideEditor(range)) return;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const restoreRangeInElement = (element: HTMLElement, range: Range) => {
    const selection = window.getSelection();
    if (!selection || !rangeIsInsideElement(range, element)) return;
    element.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const keepEditorSelectionMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    if (activeTextTarget === 'title' || document.activeElement === titleEditorRef.current) return;
    saveEditorSelection();
  };

  const getEditorSelectionRange = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (rangeIsInsideEditor(range)) return range.cloneRange();
    }

    const savedRange = savedRangeRef.current;
    if (savedRange && rangeIsInsideEditor(savedRange)) return savedRange.cloneRange();
    return null;
  };

  const getTitleSelectionRange = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (rangeIsInsideTitle(range)) return range.cloneRange();
    }

    const savedRange = savedRangeRef.current;
    if (savedRange && rangeIsInsideTitle(savedRange)) return savedRange.cloneRange();
    return null;
  };

  const splitRangeTextBoundaries = (range: Range) => {
    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const textNode = range.startContainer as Text;
      const startOffset = range.startOffset;
      const endOffset = range.endOffset;
      textNode.splitText(endOffset);
      const selectedText = textNode.splitText(startOffset);
      range.setStart(selectedText, 0);
      range.setEnd(selectedText, selectedText.length);
      return;
    }

    if (
      range.endContainer.nodeType === Node.TEXT_NODE &&
      range.endOffset > 0 &&
      range.endOffset < (range.endContainer.textContent?.length || 0)
    ) {
      (range.endContainer as Text).splitText(range.endOffset);
    }

    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset > 0 &&
      range.startOffset < (range.startContainer.textContent?.length || 0)
    ) {
      const selectedStart = (range.startContainer as Text).splitText(range.startOffset);
      range.setStart(selectedStart, 0);
    }
  };

  const applyStyleToRangeInElement = (
    element: HTMLElement,
    range: Range,
    styles: Record<string, string>,
    syncAfterChange: () => void
  ) => {
    const selection = window.getSelection();
    if (!selection) return false;

    if (range.collapsed || !rangeIsInsideElement(range, element)) return false;

    const workingRange = range.cloneRange();
    splitRangeTextBoundaries(workingRange);

    const selectedTextNodes: Text[] = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent) return NodeFilter.FILTER_REJECT;
          const parentElement = node.parentElement;
          if (parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button')) {
            return NodeFilter.FILTER_REJECT;
          }
          return workingRange.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      selectedTextNodes.push(walker.currentNode as Text);
    }

    if (selectedTextNodes.length === 0) return false;

    const styledNodes = selectedTextNodes.map(textNode => {
      const span = document.createElement('span');
      Object.entries(styles).forEach(([property, value]) => {
        span.style.setProperty(property, value);
      });
      textNode.replaceWith(span);
      span.appendChild(textNode);
      return span;
    });

    element.focus();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartBefore(styledNodes[0]);
    newRange.setEndAfter(styledNodes[styledNodes.length - 1]);
    selection.addRange(newRange);
    savedRangeRef.current = newRange.cloneRange();
    syncAfterChange();
    return true;
  };

  const applyStyleToSelection = (styles: Record<string, string>) => {
    const editor = editorRef.current;
    const range = getEditorSelectionRange();
    if (!editor || !range) return false;
    return applyStyleToRangeInElement(editor, range, styles, syncEditorContent);
  };

  const handleFontSize = (size: number) => {
    setSelectedFontSize(size);
    if (activeTextTarget === 'title' || document.activeElement === titleEditorRef.current) {
      clearPendingEditorStyles();
      const titleEditor = titleEditorRef.current;
      const titleRange = getTitleSelectionRange();
      if (titleEditor && titleRange && !titleRange.collapsed) {
        clearPendingTitleStyles();
        applyStyleToRangeInElement(titleEditor, titleRange, { 'font-size': `${size}px` }, syncTitleContent);
      } else if (titleEditor && titleRange && hasMeaningfulContent(titleEditor)) {
        pendingTitleStylesRef.current = {
          ...pendingTitleStylesRef.current,
          'font-size': `${size}px`,
        };
        restoreRangeInElement(titleEditor, titleRange);
      } else if (!titleEditor || !hasMeaningfulContent(titleEditor)) {
        clearPendingTitleStyles();
        setNotes(prev => {
          const next = [...prev];
          next[currentIndex] = { ...next[currentIndex], titleFontSize: size };
          return next;
        });
      }
      setActivePanel(null);
      return;
    }

    const editor = editorRef.current;
    const range = getEditorSelectionRange();
    const editorHasContent = Boolean(editor && hasMeaningfulContent(editor));

    if (range && !range.collapsed && rangeIsInsideEditor(range)) {
      clearPendingEditorStyles();
      applyStyleToSelection({ 'font-size': `${size}px` });
    } else if (range && editorHasContent) {
      pendingEditorStylesRef.current = {
        ...pendingEditorStylesRef.current,
        'font-size': `${size}px`,
      };
      setActiveTextTarget('editor');
      restoreEditorRange(range);
    } else if (!editorHasContent) {
      clearPendingEditorStyles();
      setNotes(prev => {
        const next = [...prev];
        next[currentIndex] = { ...next[currentIndex], fontSize: size };
        return next;
      });
    }
    setActivePanel(null);
  };

  const executeUnderlineInElement = (
    element: HTMLElement,
    range: Range,
    syncAfterChange: () => void
  ) => {
    if (!rangeIsInsideElement(range, element)) return false;
    restoreRangeInElement(element, range);
    document.execCommand('underline');
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      setSelectedUnderline(document.queryCommandState('underline'));
    }
    syncAfterChange();
    return true;
  };

  const handleUnderline = () => {
    const nextUnderline = !selectedUnderline;
    setSelectedUnderline(nextUnderline);
    setActivePanel(null);

    if (activeTextTarget === 'title' || document.activeElement === titleEditorRef.current) {
      clearPendingEditorStyles();
      const titleEditor = titleEditorRef.current;
      const titleRange = getTitleSelectionRange();

      if (titleEditor && titleRange && !titleRange.collapsed) {
        clearPendingTitleStyles();
        executeUnderlineInElement(titleEditor, titleRange, syncTitleContent);
      } else if (titleEditor && titleRange && hasMeaningfulContent(titleEditor)) {
        pendingTitleStylesRef.current = {
          ...pendingTitleStylesRef.current,
          'text-decoration-line': nextUnderline ? 'underline' : 'none',
        };
        restoreRangeInElement(titleEditor, titleRange);
      } else if (titleEditor) {
        pendingTitleStylesRef.current = {
          ...pendingTitleStylesRef.current,
          'text-decoration-line': nextUnderline ? 'underline' : 'none',
        };
        titleEditor.focus();
      }
      return;
    }

    const editor = editorRef.current;
    const range = getEditorSelectionRange();
    const editorHasContent = Boolean(editor && hasMeaningfulContent(editor));

    if (editor && range && !range.collapsed && rangeIsInsideEditor(range)) {
      clearPendingEditorStyles();
      executeUnderlineInElement(editor, range, syncEditorContent);
    } else if (range && editorHasContent) {
      pendingEditorStylesRef.current = {
        ...pendingEditorStylesRef.current,
        'text-decoration-line': nextUnderline ? 'underline' : 'none',
      };
      setActiveTextTarget('editor');
      restoreEditorRange(range);
    } else if (editor) {
      pendingEditorStylesRef.current = {
        ...pendingEditorStylesRef.current,
        'text-decoration-line': nextUnderline ? 'underline' : 'none',
      };
      moveCaretToEditorEnd();
    }
  };

  const handleTextColor = (color: string) => {
    setSelectedColor(color);
    applyStyleToSelection({ color });
  };

  const getContainingEditorBlock = (node: Node) => {
    const editor = editorRef.current;
    let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;

    while (current && current !== editor) {
      if (
        current instanceof HTMLElement &&
        ['P', 'DIV', 'FIGURE', 'LI', 'BLOCKQUOTE'].includes(current.tagName)
      ) {
        return current;
      }
      current = current.parentNode;
    }

    return null;
  };

  const moveCaretAfterNode = (node: Node) => {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    if (node instanceof HTMLElement && node.matches('p') && !hasMeaningfulContent(node)) {
      range.setStart(node, 0);
    } else if (node instanceof HTMLElement && node.matches('p')) {
      range.selectNodeContents(node);
    } else {
      range.setStartAfter(node);
    }
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const moveCaretToStartOfNode = (node: Node) => {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    if (node instanceof HTMLElement && !hasMeaningfulContent(node)) {
      range.setStart(node, 0);
    } else {
      range.selectNodeContents(node);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const getCaretRangeFromPoint = (clientX: number, clientY: number) => {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    if (documentWithCaret.caretPositionFromPoint) {
      const position = documentWithCaret.caretPositionFromPoint(clientX, clientY);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }

    return documentWithCaret.caretRangeFromPoint?.(clientX, clientY) || null;
  };

  const rangeStartsInsideNonEditable = (range: Range) => {
    const editor = editorRef.current;
    const parentElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const nonEditable = parentElement?.closest('[contenteditable="false"], [data-note-image="true"]');
    return Boolean(editor && nonEditable && editor.contains(nonEditable));
  };

  const moveCaretToPoint = (clientX: number, clientY: number) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return false;

    const range = getCaretRangeFromPoint(clientX, clientY);
    if (
      !range ||
      !rangeIsInsideEditor(range) ||
      rangeStartsInsideNonEditable(range) ||
      (range.startContainer === editor && editor.childNodes.length > 0)
    ) {
      return false;
    }

    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
    return true;
  };

  const moveCaretToEditorEnd = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;

    ensureEditableTailAfterMedia(editor);
    const lastChild = getLastContentChild(editor);
    const range = document.createRange();
    editor.focus();

    if (
      lastChild instanceof HTMLElement &&
      ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(lastChild.tagName)
    ) {
      if (!hasMeaningfulContent(lastChild)) {
        range.setStart(lastChild, 0);
      } else {
        range.selectNodeContents(lastChild);
      }
    } else {
      range.selectNodeContents(editor);
    }

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const insertStyledTextInElement = (
    element: HTMLElement,
    range: Range | null,
    text: string,
    styles: Record<string, string>,
    syncAfterChange: () => void
  ) => {
    if (!range || !range.collapsed || !rangeIsInsideElement(range, element)) return false;

    const span = document.createElement('span');
    Object.entries(styles).forEach(([property, value]) => {
      span.style.setProperty(property, value);
    });
    span.textContent = text;

    range.deleteContents();
    range.insertNode(span);
    moveCaretAfterNode(span);
    syncAfterChange();
    return true;
  };

  const insertStyledTextAtCaret = (text: string, styles: Record<string, string>) => {
    const editor = editorRef.current;
    if (!editor) return false;
    return insertStyledTextInElement(editor, getEditorSelectionRange(), text, styles, syncEditorContent);
  };

  const handleEditorBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;
    const pendingStyles = pendingEditorStylesRef.current;
    if (
      inputEvent.inputType !== 'insertText' ||
      !inputEvent.data ||
      Object.keys(pendingStyles).length === 0
    ) {
      return;
    }

    if (insertStyledTextAtCaret(inputEvent.data, pendingStyles)) {
      e.preventDefault();
    }
  };

  const handleTitleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const titleEditor = titleEditorRef.current;
    const inputEvent = e.nativeEvent as InputEvent;
    const pendingStyles = pendingTitleStylesRef.current;
    if (
      !titleEditor ||
      inputEvent.inputType !== 'insertText' ||
      !inputEvent.data ||
      Object.keys(pendingStyles).length === 0
    ) {
      return;
    }

    if (insertStyledTextInElement(titleEditor, getTitleSelectionRange(), inputEvent.data, pendingStyles, syncTitleContent)) {
      e.preventDefault();
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key.startsWith('Arrow') ||
      ['Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(e.key)
    ) {
      clearPendingEditorStyles();
    }
  };

  const appendBlankLineIfEmpty = (element: HTMLElement) => {
    if (hasMeaningfulContent(element)) return;
    element.dataset.noteTail = 'true';
  };

  const insertImageIntoEditor = (imageUrl: string, metadata?: StoredImageMetadata | null) => {
    const editor = editorRef.current;
    if (!editor) return;

    const template = document.createElement('template');
    template.innerHTML = `${imageToHtml(imageUrl, copy, metadata)}<p><br></p>`;
    const nodes = Array.from(template.content.childNodes);
    const savedRange = savedRangeRef.current;

    if (savedRange && rangeIsInsideEditor(savedRange)) {
      const insertionRange = savedRange.cloneRange();
      insertionRange.collapse(false);
      const containingBlock = getContainingEditorBlock(insertionRange.endContainer);

      if (containingBlock && containingBlock instanceof HTMLElement && !containingBlock.matches('[data-note-image="true"]')) {
        const figure = template.content.querySelector('[data-note-image="true"]');
        const afterBlock = containingBlock.cloneNode(false) as HTMLElement;
        const afterRange = document.createRange();
        afterRange.selectNodeContents(containingBlock);
        afterRange.setStart(insertionRange.endContainer, insertionRange.endOffset);
        afterBlock.appendChild(afterRange.extractContents());
        appendBlankLineIfEmpty(afterBlock);

        if (figure) {
          if (hasMeaningfulContent(containingBlock)) {
            containingBlock.after(figure, afterBlock);
          } else {
            containingBlock.replaceWith(figure, afterBlock);
          }
          moveCaretToStartOfNode(afterBlock);
        } else {
          insertionRange.insertNode(template.content);
        }
      } else {
        insertionRange.deleteContents();
        insertionRange.insertNode(template.content);
        const lastInsertedNode = nodes[nodes.length - 1];
        if (lastInsertedNode) moveCaretAfterNode(lastInsertedNode);
      }
    } else {
      editor.appendChild(template.content);
      const lastInsertedNode = nodes[nodes.length - 1];
      if (lastInsertedNode) moveCaretAfterNode(lastInsertedNode);
    }

    syncEditorContent();
  };

  const appendImages = async (files: FileList | null) => {
    const imageFiles = Array.from(files || []).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setIsProcessingImage(true);
    try {
      for (const file of imageFiles) {
        const imageUrl = await compressImageToDataUrl(file);
        if (isSupabaseMediaEnabled) {
          try {
            const compressedFile = await dataUrlToFile(imageUrl, `${Date.now()}.jpg`);
            const uploaded = await uploadImageToStorage(compressedFile, {
              noteId: currentNote?.id,
              folder: 'notes',
              fileName: compressedFile.name,
            });
            insertImageIntoEditor(uploaded.src, uploaded.metadata);
            continue;
          } catch (error) {
            console.warn('Supabase Storage upload failed, using data URL fallback:', error);
          }
        }
        insertImageIntoEditor(imageUrl);
      }
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleImageInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await appendImages(e.target.files);
    e.target.value = '';
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
    setIsCameraOpen(false);
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;

    saveEditorSelection();
    setIsProcessingImage(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setIsCameraOpen(true);
      setActivePanel(null);
      setShowCustomPicker(false);
    } finally {
      setIsProcessingImage(false);
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setIsProcessingImage(true);
    try {
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const imageUrl = await compressImageToDataUrl(file);
      if (isSupabaseMediaEnabled) {
        try {
          const compressedFile = await dataUrlToFile(imageUrl, file.name);
          const uploaded = await uploadImageToStorage(compressedFile, {
            noteId: currentNote?.id,
            folder: 'notes',
            fileName: compressedFile.name,
          });
          insertImageIntoEditor(uploaded.src, uploaded.metadata);
          stopCamera();
          return;
        } catch (error) {
          console.warn('Supabase Storage upload failed, using data URL fallback:', error);
        }
      }
      insertImageIntoEditor(imageUrl);
      stopCamera();
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleEditorMouseDown = () => {
    const editor = editorRef.current;
    if (!editor) return;

    clearPendingEditorStyles();
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const removeButton = target.closest('[data-remove-image="true"]');
    if (removeButton) {
      e.preventDefault();
      const figure = removeButton.closest('[data-note-image="true"]');
      const metadata = imageMetadataFromElement(figure);
      if (metadata) void deleteImageFromStorage(metadata);
      figure?.remove();
      syncEditorContent();
      return;
    }

    const previewButton = target.closest('[data-preview-image="true"]');
    if (!previewButton) {
      if (target === editorRef.current) {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (
          !range ||
          !rangeIsInsideEditor(range) ||
          rangeStartsInsideNonEditable(range) ||
          range.startContainer === editorRef.current
        ) {
          if (!moveCaretToPoint(e.clientX, e.clientY)) moveCaretToEditorEnd();
          return;
        }
      }
      saveEditorSelection();
      return;
    }

    e.preventDefault();
    const image = previewButton.closest('[data-note-image="true"]')?.querySelector('img');
    const imageUrl = image?.getAttribute('src');
    if (imageUrl) setPreviewImageUrl(imageUrl);
  };

  const handleAddNote = () => {
    const newNote: NoteData = {
      id: Date.now().toString(),
      title: '',
      titleHtml: '',
      content: '',
      contentHtml: '',
      fontSize: 18,
      titleFontSize: 18,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      color: '#D2936D'
    };
    setNotes([newNote, ...notes]);
    setCurrentIndex(0);
  };

  const handleDeleteNote = () => {
    deleteStoredImages(getStoredImagesFromNote(notes[currentIndex]));

    if (notes.length === 1) {
      setNotes([{
        id: Date.now().toString(),
        title: '',
        titleHtml: '',
        content: '',
        contentHtml: '',
        fontSize: 18,
        titleFontSize: 18,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: '#D2936D'
      }]);
    } else {
      const newNotes = notes.filter((_, idx) => idx !== currentIndex);
      setNotes(newNotes);
      if (currentIndex >= newNotes.length) {
        setCurrentIndex(newNotes.length - 1);
      }
    }
  };

  const handleSave = () => {
    stopCamera();
    const editor = editorRef.current;
    const titleEditor = titleEditorRef.current;
    const savedAt = Date.now();
    if (editor) ensureEditableTailAfterMedia(editor);
    const savedNotes = editor ? notes.map((note, idx) => {
      if (idx !== currentIndex) {
        const contentHtml = dehydrateStorageMediaHtml(note.contentHtml || '');
        return {
          ...note,
          contentHtml,
          images: extractStoredImagesFromHtml(contentHtml),
        };
      }
      const clone = editor.cloneNode(true) as HTMLElement;
      const noteIdTimestamp = Number(note.id);
      const createdAt = note.createdAt || (Number.isFinite(noteIdTimestamp) && noteIdTimestamp > 0 ? noteIdTimestamp : savedAt);
      clone.querySelectorAll('[data-remove-image="true"]').forEach(button => button.remove());
      clone.querySelectorAll('[data-preview-image="true"]').forEach(button => button.remove());
      const contentHtml = dehydrateStorageMediaHtml(clone.innerHTML);
      return {
        ...note,
        title: titleEditor ? getTitlePlainText(titleEditor) : note.title,
        titleHtml: titleEditor ? titleEditor.innerHTML : note.titleHtml,
        content: clone.innerText.trim(),
        contentHtml,
        images: extractStoredImagesFromHtml(contentHtml),
        createdAt,
        updatedAt: savedAt,
        imageUrl: undefined,
        imageUrls: undefined,
      };
    }) : notes;

    onSave(savedNotes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center pointer-events-auto p-4">
      <div className="absolute inset-0 bg-black/50" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative z-10 w-full max-w-[18rem] max-h-[calc(100dvh-2rem)] flex flex-col items-center gap-3"
      >
        <div className="bg-[var(--app-active-surface)] rounded-[20px] shadow-xl w-full flex h-[32rem] max-h-[calc(100dvh-9rem)] flex-col overflow-hidden">
          <div className="flex items-center justify-center px-4 py-2.5 border-b border-[var(--app-card)]">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageInputChange}
            />

            <div ref={toolbarRef} className="flex w-full max-w-full items-center gap-0.5 overflow-visible">
              <button onClick={handleSave} className={toolbarEdgeButtonClass} aria-label={copy.closeEditor}>
                <X size={15} strokeWidth={2.3} />
              </button>

              <div className={fontButtonSlotClass}>
                <button
                  onMouseDown={keepEditorSelectionMouseDown}
                  onClick={() => setActivePanel(activePanel === 'font' ? null : 'font')}
                  className={fontButtonClass}
                  aria-label={copy.fontSize}
                >
                  <span className="text-[16px] font-semibold leading-none">A</span>
                  <span className="text-[11px] bg-black/10 rounded-full px-1.5 py-1 leading-none">{selectedFontSize}</span>
                </button>

                {activePanel === 'font' && (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-[70] w-[72px] rounded-[14px] bg-[var(--app-dark)] p-1.5 shadow-xl flex flex-col gap-1">
                    {FONT_SIZES.map(size => (
                      <button
                        key={size}
                        onMouseDown={keepEditorSelectionMouseDown}
                        onClick={() => handleFontSize(size)}
                        className={`h-7 rounded-full text-[12px] font-medium transition-colors ${selectedFontSize === size ? 'bg-white text-black' : 'text-white hover:bg-white/15'}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={toolbarButtonSlotClass}>
                <button
                  onMouseDown={keepEditorSelectionMouseDown}
                  onClick={handleUnderline}
                  className={`${toolbarButtonClass} ${selectedUnderline ? 'bg-[var(--app-dark)] text-white hover:brightness-100' : ''}`}
                  aria-label={copy.underline}
                >
                  <Underline size={14} strokeWidth={2.3} />
                </button>
              </div>

              <div className={toolbarButtonSlotClass}>
                <button
                  onMouseDown={keepEditorSelectionMouseDown}
                  onClick={() => setActivePanel(activePanel === 'color' ? null : 'color')}
                  className={toolbarButtonClass}
                  aria-label={copy.noteColor}
                >
                  <Palette size={14} strokeWidth={2.3} />
                </button>

                {activePanel === 'color' && (
                  <div className="absolute left-1/2 top-[calc(100%+8px)] z-[70] -translate-x-1/2 flex flex-col items-center">
                    <div className="bg-[var(--app-dark)] w-[124px] rounded-[20px] p-2.5 shadow-lg relative box-border">
                      <div className="grid grid-cols-4 gap-2">
                        {DEFAULT_COLORS.map(color => (
                          <button
                            key={color}
                            onMouseDown={keepEditorSelectionMouseDown}
                            onClick={() => handleTextColor(color)}
                            className="w-[20px] h-[20px] rounded-full"
                            style={{
                              backgroundColor: color,
                              boxShadow: selectedColor === color ? '0 0 0 1.5px white' : 'none'
                            }}
                          />
                        ))}
                        <button
                          onMouseDown={keepEditorSelectionMouseDown}
                          onClick={() => setShowCustomPicker(!showCustomPicker)}
                          className="w-[20px] h-[20px] rounded-[6px] relative overflow-hidden"
                          style={{ boxShadow: showCustomPicker || !DEFAULT_COLORS.includes(selectedColor) ? '0 0 0 1.5px white' : 'none' }}
                        >
                          <div className="w-full h-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] absolute inset-0 pointer-events-none" />
                        </button>
                      </div>
                    </div>

                    {showCustomPicker && (
                      <div className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
                        <HexColorPicker color={selectedColor} onChange={handleTextColor} />
                        <div className="flex items-center w-full">
                          <span className="text-white/70 font-mono text-[13px] leading-none pt-[1px] mr-1">#</span>
                          <HexColorInput
                            color={selectedColor}
                            onChange={handleTextColor}
                            className="flex-1 min-w-0 h-[22px] bg-white/10 border border-white/20 text-white rounded-[6px] px-1.5 text-[12px] font-mono uppercase focus:outline-none focus:border-white/50"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={toolbarButtonSlotClass}>
                <button
                  onMouseDown={keepEditorSelectionMouseDown}
                  onClick={() => {
                    saveEditorSelection();
                    setActivePanel(null);
                    setShowCustomPicker(false);
                    imageInputRef.current?.click();
                  }}
                  className={toolbarButtonClass}
                  aria-label={copy.insertImage}
                  disabled={isProcessingImage}
                >
                  <ImageIcon size={14} strokeWidth={2.3} />
                </button>
              </div>

              <div className={toolbarButtonSlotClass}>
                <button
                  onMouseDown={keepEditorSelectionMouseDown}
                  onClick={openCamera}
                  className={toolbarButtonClass}
                  aria-label={copy.takePhoto}
                  disabled={isProcessingImage || isCameraOpen}
                >
                  <Camera size={14} strokeWidth={2.3} />
                </button>
              </div>

              <button onClick={handleSave} className={toolbarEdgeButtonClass} aria-label={copy.saveNote}>
                <Check size={15} strokeWidth={2.3} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <div className="flex h-[2.75rem] items-end gap-3 border-b border-[var(--app-card)] pb-1.5">
              <div
                ref={titleEditorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label={copy.title}
                data-empty={currentNote?.title?.trim() ? 'false' : 'true'}
                data-placeholder={copy.titlePlaceholder}
                onBeforeInput={handleTitleBeforeInput}
                onInput={syncTitleContent}
                onFocus={syncToolbarFontSizeFromTitle}
                onClick={syncToolbarFontSizeFromTitle}
                onKeyUp={syncToolbarFontSizeFromTitle}
                onMouseDown={() => clearPendingTitleStyles()}
                onMouseUp={syncToolbarFontSizeFromTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                style={{
                  color: currentNote?.color || '#D2936D',
                  fontSize: `${currentNote?.titleFontSize || 18}px`,
                }}
                className="note-title-editor min-w-0 flex-1 font-sans font-medium bg-transparent border-none outline-none"
              />
              <div className="self-start pt-1 text-[12px] font-medium leading-none text-black/40 shrink-0">
                {currentIndex + 1}/{notes.length}
              </div>
            </div>

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              data-empty={editorEmpty ? 'true' : 'false'}
              data-placeholder={copy.bodyPlaceholder}
              onBeforeInput={handleEditorBeforeInput}
              onInput={syncEditorContent}
              onFocus={saveEditorSelection}
              onKeyDown={handleEditorKeyDown}
              onKeyUp={saveEditorSelection}
              onMouseUp={saveEditorSelection}
              onMouseDown={handleEditorMouseDown}
              onClick={handleEditorClick}
              style={{ fontSize: `${currentNote?.fontSize || 18}px` }}
              className="note-rich-editor min-h-[20rem] bg-transparent border-none outline-none font-sans text-[#7E9FBA] leading-relaxed"
            />
          </div>
        </div>

        {isCameraOpen && (
          <div className="fixed inset-0 z-[2200] flex flex-col bg-[#1f1f1f] p-4">
            <video
              ref={videoRef}
              playsInline
              muted
              className="min-h-0 flex-1 rounded-[18px] bg-black object-cover"
            />
            <div className="flex shrink-0 items-center justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              <button
                onClick={stopCamera}
                className="h-11 px-5 rounded-full bg-white/15 text-white text-[14px] font-medium hover:bg-white/20"
              >
                {copy.cancel}
              </button>
              <button
                onClick={capturePhoto}
                disabled={isProcessingImage}
                className="h-11 px-6 rounded-full bg-white text-black text-[14px] font-semibold disabled:opacity-50"
              >
                {copy.capture}
              </button>
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-center gap-3 pb-1">
          <button
            onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
            disabled={!canGoPrev}
            className={disabledBottomButtonClass}
            aria-label={copy.previousNote}
          >
            <ChevronsLeft size={24} strokeWidth={2.3} />
          </button>
          <button
            onClick={handleAddNote}
            className={bottomButtonClass}
            aria-label={copy.createNote}
          >
            <Plus size={28} strokeWidth={2.3} />
          </button>
          <button
            onClick={handleDeleteNote}
            className={bottomButtonClass}
            aria-label={copy.deleteNote}
          >
            <Trash2 size={24} strokeWidth={2.3} />
          </button>
          <button
            onClick={() => setCurrentIndex(i => Math.min(notes.length - 1, i + 1))}
            disabled={!canGoNext}
            className={disabledBottomButtonClass}
            aria-label={copy.nextNote}
          >
            <ChevronsRight size={24} strokeWidth={2.3} />
          </button>
        </div>
      </motion.div>

      {previewImageUrl && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/80 p-4">
          <button
            onClick={() => setPreviewImageUrl(null)}
            className="absolute right-5 top-5 w-10 h-10 rounded-full bg-white/15 text-white inline-flex items-center justify-center hover:bg-white/25"
            aria-label={copy.closeImagePreview}
          >
            <X size={22} strokeWidth={2.3} />
          </button>
          <img
            src={previewImageUrl}
            alt={copy.largeAttachmentAlt}
            className="max-h-full max-w-full rounded-[18px] object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
