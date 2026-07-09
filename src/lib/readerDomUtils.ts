import { READER_FONT_SIZES } from '../constants/theme';
import {
  ensureReaderEditableTailAfterMedia,
  getLastReaderContentChild,
  readerNodeHasMeaningfulContent,
} from './noteHtmlUtils';
import { cssColorToHex } from './generalUtils';

export type ReaderTextTarget = 'title' | 'content';

type MutableRef<T> = {
  current: T;
};

export type ReaderToolbarState = {
  target: ReaderTextTarget;
  fontSize: number;
  color: string;
  underline: boolean;
};

export const readerRangeIsInsideElement = (range: Range, element: HTMLElement | null) => (
  Boolean(element && element.contains(range.commonAncestorContainer))
);

export const getReaderCaretRangeFromPoint = (clientX: number, clientY: number) => {
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

export const readerRangeStartsInsideNonEditable = (range: Range, element: HTMLElement | null) => {
  const parentElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const nonEditable = parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button');
  return Boolean(element && nonEditable && element.contains(nonEditable));
};

export const moveReaderCaretToContentEnd = (
  editor: HTMLElement | null,
  savedRangeRef: MutableRef<Range | null>
) => {
  const selection = window.getSelection();
  if (!editor || !selection) return false;

  ensureReaderEditableTailAfterMedia(editor);
  const lastChild = getLastReaderContentChild(editor);
  const range = document.createRange();
  editor.focus();

  if (
    lastChild instanceof HTMLElement &&
    ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(lastChild.tagName)
  ) {
    if (!readerNodeHasMeaningfulContent(lastChild)) {
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
  return true;
};

export const moveReaderCaretToPoint = (
  editor: HTMLElement | null,
  clientX: number,
  clientY: number,
  savedRangeRef: MutableRef<Range | null>
) => {
  const selection = window.getSelection();
  if (!editor || !selection) return false;

  ensureReaderEditableTailAfterMedia(editor);
  const range = getReaderCaretRangeFromPoint(clientX, clientY);
  if (
    !range ||
    !readerRangeIsInsideElement(range, editor) ||
    readerRangeStartsInsideNonEditable(range, editor) ||
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

export const getReaderElementForTarget = (
  target: ReaderTextTarget,
  titleEditor: HTMLElement | null,
  contentEditor: HTMLElement | null
) => (
  target === 'title' ? titleEditor : contentEditor
);

export const getReaderTargetFromRange = (
  range: Range,
  titleEditor: HTMLElement | null,
  contentEditor: HTMLElement | null
): ReaderTextTarget | null => {
  if (readerRangeIsInsideElement(range, titleEditor)) return 'title';
  if (readerRangeIsInsideElement(range, contentEditor)) return 'content';
  return null;
};

export const normalizeReaderFontSize = (fontSize: number) => {
  const roundedSize = Math.round(fontSize);
  return READER_FONT_SIZES.find(size => Math.abs(size - roundedSize) <= 1) || roundedSize;
};

export const getReaderTextNodeInRange = (range: Range, element: HTMLElement) => {
  const walker = document.createTreeWalker(
    element,
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
      },
    }
  );
  return walker.nextNode();
};

export const getReaderComputedElement = (node: Node | null, element: HTMLElement) => {
  if (!node) return element;
  const candidate = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return candidate instanceof HTMLElement && element.contains(candidate) ? candidate : element;
};

export const getReaderUnderlineFromElement = (element: HTMLElement) => {
  const decorationLine = window.getComputedStyle(element).textDecorationLine;
  return decorationLine.includes('underline') || Boolean(element.closest('u'));
};

export const getReaderToolbarStateFromRange = (
  range: Range,
  titleEditor: HTMLElement | null,
  contentEditor: HTMLElement | null,
  fallbackColor = '#D2936D'
): ReaderToolbarState | null => {
  const target = getReaderTargetFromRange(range, titleEditor, contentEditor);
  if (!target) return null;
  const element = getReaderElementForTarget(target, titleEditor, contentEditor);
  if (!element) return null;
  const textNode = range.collapsed ? range.startContainer : getReaderTextNodeInRange(range, element);
  const computedElement = getReaderComputedElement(textNode, element);
  const computedStyle = window.getComputedStyle(computedElement);
  const fontSize = Number.parseFloat(computedStyle.fontSize);
  return {
    target,
    fontSize: Number.isFinite(fontSize) ? normalizeReaderFontSize(fontSize) : 18,
    color: cssColorToHex(computedStyle.color, fallbackColor),
    underline: getReaderUnderlineFromElement(computedElement),
  };
};

export const saveReaderSelectionRange = (
  savedRangeRef: MutableRef<Range | null>,
  titleEditor: HTMLElement | null,
  contentEditor: HTMLElement | null,
  fallbackColor = '#D2936D'
) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!getReaderTargetFromRange(range, titleEditor, contentEditor)) return null;
  savedRangeRef.current = range.cloneRange();
  return getReaderToolbarStateFromRange(range, titleEditor, contentEditor, fallbackColor);
};

export const restoreReaderRange = (
  element: HTMLElement | null,
  range: Range | null,
  savedRangeRef: MutableRef<Range | null>
) => {
  const selection = window.getSelection();
  if (!element || !range || !selection || !readerRangeIsInsideElement(range, element)) return false;
  element.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  savedRangeRef.current = range.cloneRange();
  return true;
};

export const getReaderSelectionRange = (
  target: ReaderTextTarget,
  titleEditor: HTMLElement | null,
  contentEditor: HTMLElement | null,
  savedRangeRef: MutableRef<Range | null>
) => {
  const element = getReaderElementForTarget(target, titleEditor, contentEditor);
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (readerRangeIsInsideElement(range, element)) return range.cloneRange();
  }
  const savedRange = savedRangeRef.current;
  if (savedRange && readerRangeIsInsideElement(savedRange, element)) return savedRange.cloneRange();
  return null;
};

export const splitReaderRangeTextBoundaries = (range: Range) => {
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

export const applyReaderStyleToSelection = ({
  target,
  titleEditor,
  contentEditor,
  savedRangeRef,
  pendingTitleStylesRef,
  pendingContentStylesRef,
  styles,
}: {
  target: ReaderTextTarget;
  titleEditor: HTMLElement | null;
  contentEditor: HTMLElement | null;
  savedRangeRef: MutableRef<Range | null>;
  pendingTitleStylesRef: MutableRef<Record<string, string>>;
  pendingContentStylesRef: MutableRef<Record<string, string>>;
  styles: Record<string, string>;
}) => {
  const element = getReaderElementForTarget(target, titleEditor, contentEditor);
  const range = getReaderSelectionRange(target, titleEditor, contentEditor, savedRangeRef);
  const selection = window.getSelection();
  if (!element || !range || !selection || !readerRangeIsInsideElement(range, element)) return false;

  if (range.collapsed) {
    const pendingRef = target === 'title' ? pendingTitleStylesRef : pendingContentStylesRef;
    pendingRef.current = { ...pendingRef.current, ...styles };
    restoreReaderRange(element, range, savedRangeRef);
    return true;
  }

  const workingRange = range.cloneRange();
  splitReaderRangeTextBoundaries(workingRange);

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
      },
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
  return true;
};

export const insertStyledReaderText = (
  element: HTMLElement | null,
  range: Range | null,
  text: string,
  styles: Record<string, string>,
  savedRangeRef: MutableRef<Range | null>
) => {
  if (!element || !range || !range.collapsed || !readerRangeIsInsideElement(range, element)) return false;
  const span = document.createElement('span');
  Object.entries(styles).forEach(([property, value]) => {
    span.style.setProperty(property, value);
  });
  span.textContent = text;
  range.deleteContents();
  range.insertNode(span);
  const selection = window.getSelection();
  if (selection) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(span);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedRangeRef.current = nextRange.cloneRange();
  }
  return true;
};
