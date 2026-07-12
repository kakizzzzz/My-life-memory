import React from 'react';
import {
  dehydrateStorageMediaHtml,
  deleteImageFromStorageReliably,
  imageMetadataFromElement,
  isSupabaseMediaEnabled,
  requestCloudMediaMaintenance,
  scheduleImageDeletion,
  uploadImageToStorage,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import { sanitizeRichHtml } from '../lib/htmlSanitizer';
import {
  compressImageFileToDataUrl,
  dataUrlToFile,
} from '../lib/photoUtils';
import {
  ensureReaderEditableTailAfterMedia,
  extractStoredImagesFromHtml,
  getReadableNoteHtml,
  getReadableTitleHtml,
  getRemovedStoredImages,
  getStoredImagesFromNote,
  htmlToText,
  imageToReaderHtml,
  readerEditableTailHtml,
  uniqueStoredImages,
} from '../lib/noteHtmlUtils';
import { getNoteTimestamp } from '../lib/noteDataUtils';
import {
  applyReaderStyleToSelection as applyReaderDomStyleToSelection,
  getReaderElementForTarget as getReaderDomElementForTarget,
  getReaderSelectionRange as getReaderDomSelectionRange,
  insertStyledReaderText as insertStyledReaderDomText,
  moveReaderCaretToContentEnd as moveReaderDomCaretToContentEnd,
  moveReaderCaretToPoint as moveReaderDomCaretToPoint,
  readerRangeIsInsideElement,
  readerRangeStartsInsideNonEditable,
  saveReaderSelectionRange,
  type ReaderTextTarget,
} from '../lib/readerDomUtils';
import { HOME_COPY } from '../copy/homeCopy';
import { isReaderEditorReadyForSave } from '../lib/readerDraftSafety';
import {
  applyRichTextStyleSession,
  createRichTextStyleSession,
  type RichTextStyleSession,
} from '../lib/richTextStyleSession';
import type { AppView, HomePanel, NoteData, ReadingNoteTarget, StarData } from '../types/app';

type HomeCopy = typeof HOME_COPY.en;
type ActiveTag = { order: number; groupId: number } | null;

const deleteStoredImages = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void deleteImageFromStorageReliably(metadata);
  });
};

const scheduleStoredImageDeletions = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void scheduleImageDeletion(metadata);
  });
};

export const useReaderController = ({
  activeView,
  stars,
  setStars,
  setActiveView,
  setActiveHomePanel,
  setIsRecordsMenuOpen,
  setIsRecordsCalendarOpen,
  setIsSearchOpen,
  setSubmittedTextSearch,
  setFlyTarget,
  setSelectedStarId,
  setActiveTag,
  homeCopy,
  mediaRefreshKey,
}: {
  activeView: AppView;
  stars: StarData[];
  setStars: React.Dispatch<React.SetStateAction<StarData[]>>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setActiveHomePanel: React.Dispatch<React.SetStateAction<HomePanel>>;
  setIsRecordsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRecordsCalendarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSubmittedTextSearch: React.Dispatch<React.SetStateAction<string>>;
  setFlyTarget: React.Dispatch<React.SetStateAction<[number, number] | null>>;
  setSelectedStarId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveTag: React.Dispatch<React.SetStateAction<ActiveTag>>;
  homeCopy: HomeCopy;
  mediaRefreshKey: number;
}) => {
  const [readingNoteTarget, setReadingNoteTarget] = React.useState<ReadingNoteTarget | null>(null);
  const [isReaderToolsOpen, setIsReaderToolsOpen] = React.useState(false);
  const [readerActivePanel, setReaderActivePanel] = React.useState<'font' | 'color' | null>(null);
  const [readerActiveTextTarget, setReaderActiveTextTarget] = React.useState<ReaderTextTarget>('content');
  const [readerSelectedFontSize, setReaderSelectedFontSize] = React.useState(18);
  const [readerSelectedColor, setReaderSelectedColor] = React.useState('#D2936D');
  const [readerSelectedUnderline, setReaderSelectedUnderline] = React.useState(false);
  const [readerShowCustomPicker, setReaderShowCustomPicker] = React.useState(false);
  const readerTitleRef = React.useRef<HTMLHeadingElement>(null);
  const readerContentRef = React.useRef<HTMLDivElement>(null);
  const readerCameraInputRef = React.useRef<HTMLInputElement>(null);
  const readerImageInputRef = React.useRef<HTMLInputElement>(null);
  const readerSavedRangeRef = React.useRef<Range | null>(null);
  const readerColorStyleSessionRef = React.useRef<RichTextStyleSession | null>(null);
  const readerPendingTitleStylesRef = React.useRef<Record<string, string>>({});
  const readerPendingContentStylesRef = React.useRef<Record<string, string>>({});
  const readerUploadedImagesRef = React.useRef<StoredImageMetadata[]>([]);
  const readerTransactionKeyRef = React.useRef<string | null>(null);
  const readerEditorReadyKeyRef = React.useRef<string | null>(null);

  const readerRecord = React.useMemo(() => {
    if (!readingNoteTarget) return null;
    const star = stars.find(item => item.id === readingNoteTarget.starId);
    const note = star?.notes?.find(item => item.id === readingNoteTarget.noteId);
    if (!star || !note) return null;
    return {
      star,
      note,
      timestamp: getNoteTimestamp(note),
      titleHtml: getReadableTitleHtml(note, homeCopy.untitledNote),
      contentHtml: getReadableNoteHtml(note, homeCopy.noteImageAlt, homeCopy.removeImage),
    };
  }, [homeCopy.noteImageAlt, homeCopy.removeImage, homeCopy.untitledNote, mediaRefreshKey, readingNoteTarget, stars]);
  const readerRecordKey = readerRecord ? `${readerRecord.star.id}-${readerRecord.note.id}` : null;

  const discardUploadedReaderImages = React.useCallback(() => {
    const uploadedImages = readerUploadedImagesRef.current;
    readerUploadedImagesRef.current = [];
    if (uploadedImages.length > 0) deleteStoredImages(uploadedImages);
  }, []);

  React.useEffect(() => {
    const previousKey = readerTransactionKeyRef.current;
    if (previousKey && previousKey !== readerRecordKey) {
      discardUploadedReaderImages();
    }
    readerTransactionKeyRef.current = readerRecordKey;
  }, [discardUploadedReaderImages, readerRecordKey]);

  React.useEffect(() => () => {
    discardUploadedReaderImages();
  }, [discardUploadedReaderImages]);

  const hydrateReaderEditors = React.useCallback(() => {
    readerEditorReadyKeyRef.current = null;
    if (activeView !== 'reader' || !readerRecord || !readerRecordKey) return false;
    const titleEditor = readerTitleRef.current;
    const contentEditor = readerContentRef.current;
    if (!titleEditor || !contentEditor) return false;

    if (titleEditor.innerHTML !== readerRecord.titleHtml) {
      titleEditor.innerHTML = sanitizeRichHtml(readerRecord.titleHtml);
    }

    if (contentEditor.innerHTML !== readerRecord.contentHtml) {
      contentEditor.innerHTML = sanitizeRichHtml(readerRecord.contentHtml);
    }

    ensureReaderEditableTailAfterMedia(contentEditor);
    readerSavedRangeRef.current = null;
    readerColorStyleSessionRef.current = null;
    readerPendingTitleStylesRef.current = {};
    readerPendingContentStylesRef.current = {};
    readerEditorReadyKeyRef.current = readerRecordKey;
    setReaderSelectedUnderline(false);
    return true;
  }, [activeView, readerRecordKey, readerRecord?.titleHtml, readerRecord?.contentHtml]);

  React.useLayoutEffect(() => {
    hydrateReaderEditors();
    return () => {
      if (readerEditorReadyKeyRef.current === readerRecordKey) {
        readerEditorReadyKeyRef.current = null;
      }
    };
  }, [hydrateReaderEditors, readerRecordKey]);

  const saveReaderDraft = React.useCallback((updates: Partial<NoteData> = {}) => {
    if (!readerRecord || !isReaderEditorReadyForSave({
      recordKey: readerRecordKey,
      readyKey: readerEditorReadyKeyRef.current,
      hasTitleEditor: Boolean(readerTitleRef.current),
      hasContentEditor: Boolean(readerContentRef.current),
    })) return false;
    if (readerContentRef.current) ensureReaderEditableTailAfterMedia(readerContentRef.current);
    const titleHtml = sanitizeRichHtml(readerTitleRef.current?.innerHTML ?? readerRecord.titleHtml);
    const rawContentHtml = readerContentRef.current?.innerHTML ?? readerRecord.contentHtml;
    const contentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(rawContentHtml));
    const baselineTitleHtml = sanitizeRichHtml(readerRecord.titleHtml);
    const baselineContentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(readerRecord.contentHtml));
    const hasDraftChanges = titleHtml !== baselineTitleHtml || contentHtml !== baselineContentHtml;
    const hasExplicitUpdates = Object.keys(updates).length > 0;
    const images = extractStoredImagesFromHtml(contentHtml);
    const uploadedImages = uniqueStoredImages(readerUploadedImagesRef.current);

    if (!hasDraftChanges && !hasExplicitUpdates) {
      readerUploadedImagesRef.current = [];
      if (uploadedImages.length > 0) deleteStoredImages(uploadedImages);
      return false;
    }

    const previousImages = getStoredImagesFromNote(readerRecord.note);
    const removedExistingImages = getRemovedStoredImages(previousImages, images);
    const unusedUploadedImages = getRemovedStoredImages(uploadedImages, images);
    scheduleStoredImageDeletions(removedExistingImages);
    deleteStoredImages(unusedUploadedImages);
    readerUploadedImagesRef.current = [];

    const title = htmlToText(titleHtml);
    const content = htmlToText(contentHtml);
    const timestamp = Date.now();

    setStars(prev => prev.map(star => {
      if (star.id !== readerRecord.star.id) return star;
      return {
        ...star,
        notes: (star.notes || []).map(note => (
          note.id === readerRecord.note.id
            ? {
                ...note,
                title,
                titleHtml,
                content,
                contentHtml,
                images,
                imageUrl: undefined,
                imageUrls: undefined,
                updatedAt: timestamp,
                ...updates,
              }
            : note
        )),
      };
    }));
    return true;
  }, [readerRecord, setStars]);

  const moveReaderCaretToContentEnd = React.useCallback(() => {
    return moveReaderDomCaretToContentEnd(readerContentRef.current, readerSavedRangeRef);
  }, []);

  const moveReaderCaretToPoint = React.useCallback((clientX: number, clientY: number) => {
    return moveReaderDomCaretToPoint(readerContentRef.current, clientX, clientY, readerSavedRangeRef);
  }, []);

  const getReaderElementForTarget = React.useCallback((target: ReaderTextTarget) => (
    getReaderDomElementForTarget(target, readerTitleRef.current, readerContentRef.current)
  ), []);

  const saveReaderSelection = React.useCallback(() => {
    const toolbarState = saveReaderSelectionRange(
      readerSavedRangeRef,
      readerTitleRef.current,
      readerContentRef.current,
      readerRecord?.note.color || '#D2936D'
    );
    if (!toolbarState) return;
    setReaderActiveTextTarget(toolbarState.target);
    setReaderSelectedFontSize(toolbarState.fontSize);
    setReaderSelectedColor(toolbarState.color);
    setReaderSelectedUnderline(toolbarState.underline);
  }, [readerRecord?.note.color]);

  const getReaderSelectionRange = React.useCallback((target = readerActiveTextTarget) => {
    return getReaderDomSelectionRange(target, readerTitleRef.current, readerContentRef.current, readerSavedRangeRef);
  }, [readerActiveTextTarget]);

  const beginReaderColorStyleSession = React.useCallback(() => {
    const range = readerSavedRangeRef.current;
    const root = range && readerRangeIsInsideElement(range, readerTitleRef.current)
      ? readerTitleRef.current
      : range && readerRangeIsInsideElement(range, readerContentRef.current)
        ? readerContentRef.current
        : null;
    readerColorStyleSessionRef.current = createRichTextStyleSession(root, range);
  }, []);

  React.useEffect(() => {
    if (readerActivePanel !== 'color') readerColorStyleSessionRef.current = null;
  }, [readerActivePanel]);

  const applyReaderStyleToSelection = React.useCallback((styles: Record<string, string>) => {
    return applyReaderDomStyleToSelection({
      target: readerActiveTextTarget,
      titleEditor: readerTitleRef.current,
      contentEditor: readerContentRef.current,
      savedRangeRef: readerSavedRangeRef,
      pendingTitleStylesRef: readerPendingTitleStylesRef,
      pendingContentStylesRef: readerPendingContentStylesRef,
      styles,
    });
  }, [readerActiveTextTarget]);

  const openReaderFromRecord = React.useCallback((starId: string, noteId: string) => {
    readerEditorReadyKeyRef.current = null;
    setReadingNoteTarget({ starId, noteId });
    setActiveView('reader');
    setActiveHomePanel(null);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setIsSearchOpen(false);
    setSubmittedTextSearch('');
    setIsReaderToolsOpen(false);
    setReaderActivePanel(null);
    setReaderShowCustomPicker(false);
  }, [setActiveHomePanel, setActiveView, setIsRecordsCalendarOpen, setIsRecordsMenuOpen, setIsSearchOpen, setSubmittedTextSearch]);

  const locateReaderRecord = React.useCallback(() => {
    if (!readerRecord) return;
    saveReaderDraft();
    setFlyTarget([readerRecord.star.lat, readerRecord.star.lng]);
    setSelectedStarId(readerRecord.star.id);
    setActiveTag(null);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsReaderToolsOpen(false);
    setReadingNoteTarget(null);
  }, [readerRecord, saveReaderDraft, setActiveHomePanel, setActiveTag, setActiveView, setFlyTarget, setSelectedStarId]);

  const keepReaderSelectionPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    saveReaderSelection();
  }, [saveReaderSelection]);

  const handleReaderFontSize = React.useCallback((size: number) => {
    readerColorStyleSessionRef.current = null;
    setReaderSelectedFontSize(size);
    applyReaderStyleToSelection({ 'font-size': `${size}px` });
    setReaderActivePanel(null);
  }, [applyReaderStyleToSelection]);

  const handleReaderTextColor = React.useCallback((color: string) => {
    setReaderSelectedColor(color);
    if (!readerColorStyleSessionRef.current) beginReaderColorStyleSession();
    const sessionResult = applyRichTextStyleSession(readerColorStyleSessionRef.current, { color });
    if (sessionResult.range && readerColorStyleSessionRef.current) {
      const selection = window.getSelection();
      readerColorStyleSessionRef.current.root.focus();
      selection?.removeAllRanges();
      selection?.addRange(sessionResult.range);
      readerSavedRangeRef.current = sessionResult.range.cloneRange();
      return;
    }
    applyReaderStyleToSelection({ color });
  }, [applyReaderStyleToSelection, beginReaderColorStyleSession]);

  const handleReaderUnderline = React.useCallback(() => {
    readerColorStyleSessionRef.current = null;
    const nextUnderline = !readerSelectedUnderline;
    setReaderSelectedUnderline(nextUnderline);
    setReaderActivePanel(null);
    applyReaderStyleToSelection({ 'text-decoration-line': nextUnderline ? 'underline' : 'none' });
  }, [applyReaderStyleToSelection, readerSelectedUnderline]);

  const insertStyledReaderText = React.useCallback((
    element: HTMLElement | null,
    range: Range | null,
    text: string,
    styles: Record<string, string>
  ) => {
    return insertStyledReaderDomText(element, range, text, styles, readerSavedRangeRef);
  }, []);

  const handleReaderBeforeInput = React.useCallback((target: ReaderTextTarget, event: React.FormEvent<HTMLElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType !== 'insertText' || !inputEvent.data) return;
    const pendingRef = target === 'title' ? readerPendingTitleStylesRef : readerPendingContentStylesRef;
    const pendingStyles = pendingRef.current;
    if (Object.keys(pendingStyles).length === 0) return;
    const element = getReaderElementForTarget(target);
    if (element && insertStyledReaderText(element, getReaderSelectionRange(target), inputEvent.data, pendingStyles)) {
      event.preventDefault();
    }
  }, [getReaderElementForTarget, getReaderSelectionRange, insertStyledReaderText]);

  const handleReaderInput = React.useCallback(() => {
    readerColorStyleSessionRef.current = null;
    const editor = readerContentRef.current;
    if (editor) ensureReaderEditableTailAfterMedia(editor);
    requestAnimationFrame(saveReaderSelection);
  }, [saveReaderSelection]);

  const handleReaderContentClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const editor = readerContentRef.current;
    if (editor) ensureReaderEditableTailAfterMedia(editor);

    const removeButton = target.closest('[data-remove-image="true"]');
    if (removeButton) {
      event.preventDefault();
      const figure = removeButton.closest('[data-note-image="true"]');
      figure?.remove();
      if (editor) ensureReaderEditableTailAfterMedia(editor);
      return;
    }

    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (
      target === editor ||
      target.closest('[data-note-image="true"]') ||
      !range ||
      !editor ||
      !readerRangeIsInsideElement(range, editor) ||
      readerRangeStartsInsideNonEditable(range, editor) ||
      range.startContainer === editor
    ) {
      if (!moveReaderCaretToPoint(event.clientX, event.clientY)) {
        moveReaderCaretToContentEnd();
      }
      return;
    }

    saveReaderSelection();
  }, [moveReaderCaretToContentEnd, moveReaderCaretToPoint, saveReaderSelection]);

  const insertReaderImage = React.useCallback(async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const imageUrl = await compressImageFileToDataUrl(file);
    const editor = readerContentRef.current;
    if (!editor) return;
    let imageHtml = imageToReaderHtml(imageUrl, homeCopy.noteImageAlt, homeCopy.removeImage);

    if (isSupabaseMediaEnabled) {
      try {
        const compressedFile = await dataUrlToFile(imageUrl, `${Date.now()}.jpg`);
        const uploaded = await uploadImageToStorage(compressedFile, {
          noteId: readerRecord?.note.id,
          folder: 'notes',
          fileName: compressedFile.name,
        });
        if (uploaded.metadata) {
          readerUploadedImagesRef.current = uniqueStoredImages([
            ...readerUploadedImagesRef.current,
            uploaded.metadata,
          ]);
        }
        imageHtml = imageToReaderHtml(uploaded.src, homeCopy.noteImageAlt, homeCopy.removeImage, uploaded.metadata);
      } catch (error) {
        console.warn('Supabase Storage upload failed, using data URL fallback:', error);
        requestCloudMediaMaintenance();
      }
    }

    editor.insertAdjacentHTML('beforeend', `${imageHtml}${readerEditableTailHtml}`);
    ensureReaderEditableTailAfterMedia(editor);
    moveReaderCaretToContentEnd();
  }, [homeCopy.noteImageAlt, homeCopy.removeImage, moveReaderCaretToContentEnd, readerRecord?.note.id]);

  const handleReaderPaste = React.useCallback(async (
    target: 'title' | 'content',
    event: React.ClipboardEvent<HTMLElement>
  ) => {
    event.preventDefault();

    if (target === 'content') {
      const imageFiles = Array.from(event.clipboardData.files).filter((file): file is File => (
        file instanceof File && file.type.startsWith('image/')
      ));
      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          await insertReaderImage(file);
        }
        return;
      }
    }

    const rawText = event.clipboardData.getData('text/plain');
    const text = target === 'title' ? rawText.replace(/\s+/g, ' ').trim() : rawText;
    if (!text) return;

    const element = getReaderElementForTarget(target);
    if (!element) return;
    insertStyledReaderText(element, getReaderSelectionRange(target), text, {});
    handleReaderInput();
  }, [getReaderElementForTarget, getReaderSelectionRange, handleReaderInput, insertReaderImage, insertStyledReaderText]);

  const handleReaderImageInput = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    await insertReaderImage(file);
    event.target.value = '';
  }, [insertReaderImage]);

  const handleReaderPanelToggle = React.useCallback((panel: 'font' | 'color') => {
    saveReaderSelection();
    const isOpening = readerActivePanel !== panel;
    if (panel === 'color' && isOpening) beginReaderColorStyleSession();
    else readerColorStyleSessionRef.current = null;
    setReaderShowCustomPicker(false);
    setReaderActivePanel(currentPanel => currentPanel === panel ? null : panel);
  }, [beginReaderColorStyleSession, readerActivePanel, saveReaderSelection]);

  return {
    readingNoteTarget,
    setReadingNoteTarget,
    readerCameraInputRef,
    readerImageInputRef,
    readerTitleRef,
    readerContentRef,
    isReaderToolsOpen,
    setIsReaderToolsOpen,
    readerActivePanel,
    setReaderActivePanel,
    readerSelectedFontSize,
    readerSelectedColor,
    readerSelectedUnderline,
    readerShowCustomPicker,
    setReaderShowCustomPicker,
    readerRecord,
    hydrateReaderEditors,
    saveReaderDraft,
    saveReaderSelection,
    openReaderFromRecord,
    locateReaderRecord,
    keepReaderSelectionPointerDown,
    handleReaderFontSize,
    handleReaderTextColor,
    handleReaderUnderline,
    handleReaderBeforeInput,
    handleReaderInput,
    handleReaderContentClick,
    handleReaderPaste,
    handleReaderImageInput,
    handleReaderPanelToggle,
  };
};
