const NOTE_IMAGE_SELECTOR = '[data-note-image="true"]';
const INVISIBLE_CARET_TEXT = /[\u200B-\u200D\u2060\uFEFF]/g;

const hasCaretText = (value: string) => value.replace(INVISIBLE_CARET_TEXT, '').length > 0;

const rangeIsInsideRoot = (root: HTMLElement, range: Range) => (
  root === range.commonAncestorContainer || root.contains(range.commonAncestorContainer)
);

const closestElement = (node: Node) => (
  node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement
);

const getTopLevelChild = (root: HTMLElement, node: Node) => {
  let current: Node | null = node;
  while (current?.parentNode && current.parentNode !== root) current = current.parentNode;
  return current?.parentNode === root ? current : null;
};

const previousMeaningfulSibling = (node: Node | null) => {
  let current = node?.previousSibling || null;
  while (current?.nodeType === Node.TEXT_NODE && !current.textContent?.trim()) {
    current = current.previousSibling;
  }
  return current;
};

const nextMeaningfulSibling = (node: Node | null) => {
  let current = node?.nextSibling || null;
  while (current?.nodeType === Node.TEXT_NODE && !current.textContent?.trim()) {
    current = current.nextSibling;
  }
  return current;
};

const rangeTextBeforeCaret = (container: Node, range: Range) => {
  const prefix = document.createRange();
  prefix.selectNodeContents(container);
  try {
    prefix.setEnd(range.startContainer, range.startOffset);
  } catch {
    return '';
  }
  return prefix.toString();
};

const rangeTextAfterCaret = (container: Node, range: Range) => {
  const suffix = document.createRange();
  suffix.selectNodeContents(container);
  try {
    suffix.setStart(range.startContainer, range.startOffset);
  } catch {
    return '';
  }
  return suffix.toString();
};

const getAdjacentNode = (root: HTMLElement, range: Range, direction: 'backward' | 'forward') => {
  if (range.startContainer === root) {
    const offset = range.startOffset;
    return direction === 'backward'
      ? root.childNodes[offset - 1] || null
      : root.childNodes[offset] || null;
  }

  const topLevel = getTopLevelChild(root, range.startContainer);
  if (!topLevel) return null;

  if (direction === 'backward') {
    if (hasCaretText(rangeTextBeforeCaret(topLevel, range))) return null;
    return previousMeaningfulSibling(topLevel);
  }

  if (hasCaretText(rangeTextAfterCaret(topLevel, range))) return null;
  return nextMeaningfulSibling(topLevel);
};

export const removeAdjacentNoteImageForInput = (
  root: HTMLElement | null,
  range: Range | null,
  inputType: string,
) => {
  if (!root || !range || !range.collapsed || !rangeIsInsideRoot(root, range)) return null;
  const direction = inputType.endsWith('Backward')
    ? 'backward'
    : inputType.endsWith('Forward')
      ? 'forward'
      : null;
  if (!direction) return null;

  const candidate = getAdjacentNode(root, range, direction);
  if (!(candidate instanceof HTMLElement) || !candidate.matches(NOTE_IMAGE_SELECTOR)) return null;

  const nextRange = range.cloneRange();
  candidate.remove();
  return nextRange;
};

const lastEditableTextNode = (node: Node | null): Text | null => {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  if (!(node instanceof HTMLElement) || node.matches(`${NOTE_IMAGE_SELECTOR}, [contenteditable="false"], button`)) {
    return null;
  }
  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const textNode = lastEditableTextNode(node.childNodes[index]);
    if (textNode) return textNode;
  }
  return null;
};

const previousTextAtBoundary = (root: HTMLElement, range: Range) => {
  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE && range.startOffset > 0) return container as Text;

  if (container.nodeType === Node.TEXT_NODE) {
    let current: Node | null = container;
    while (current && current !== root) {
      const previous = previousMeaningfulSibling(current);
      const textNode = lastEditableTextNode(previous);
      if (textNode) return textNode;
      current = current.parentNode;
    }
    return null;
  }

  const element = container as Element;
  const childBefore = element.childNodes[range.startOffset - 1] || null;
  return lastEditableTextNode(childBefore);
};

const computedUnderline = (element: HTMLElement) => {
  const decorationLine = window.getComputedStyle(element).textDecorationLine;
  return decorationLine.includes('underline') || Boolean(element.closest('u'));
};

export const getBoundaryInheritedTextStyles = (
  root: HTMLElement | null,
  range: Range | null,
) => {
  if (!root || !range || !range.collapsed || !rangeIsInsideRoot(root, range)) return {};
  const caretElement = closestElement(range.startContainer);
  const previousText = previousTextAtBoundary(root, range);
  const contextElement = previousText?.parentElement;
  if (
    !caretElement ||
    !contextElement ||
    contextElement.matches(`${NOTE_IMAGE_SELECTOR}, [contenteditable="false"], button`) ||
    contextElement === caretElement ||
    contextElement.contains(range.startContainer)
  ) {
    return {};
  }

  const caretStyle = window.getComputedStyle(caretElement);
  const contextStyle = window.getComputedStyle(contextElement);
  const styles: Record<string, string> = {};
  if (contextStyle.color && contextStyle.color !== caretStyle.color) styles.color = contextStyle.color;
  if (contextStyle.fontSize && contextStyle.fontSize !== caretStyle.fontSize) {
    styles['font-size'] = contextStyle.fontSize;
  }
  if (computedUnderline(contextElement) && !computedUnderline(caretElement)) {
    styles['text-decoration-line'] = 'underline';
  }
  return styles;
};

export const insertStyledTextAtRange = (
  root: HTMLElement | null,
  range: Range | null,
  text: string,
  styles: Record<string, string>,
) => {
  if (!root || !range || !range.collapsed || !rangeIsInsideRoot(root, range)) return null;

  const textNode = document.createTextNode(text);
  let insertedNode: Node = textNode;
  if (Object.keys(styles).length > 0) {
    const span = document.createElement('span');
    Object.entries(styles).forEach(([property, value]) => span.style.setProperty(property, value));
    span.appendChild(textNode);
    insertedNode = span;
  }

  range.deleteContents();
  range.insertNode(insertedNode);
  const nextRange = document.createRange();
  nextRange.setStart(textNode, textNode.length);
  nextRange.collapse(true);
  return nextRange;
};
