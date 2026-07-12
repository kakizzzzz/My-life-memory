export type RichTextStyleSession = {
  root: HTMLElement;
  originalRange: Range;
  targets: HTMLSpanElement[];
};

export type RichTextStyleResult = {
  targets: HTMLSpanElement[];
  range: Range | null;
};

const SAFE_STYLE_PROPERTIES = ['color', 'font-size', 'text-decoration-line'] as const;

const rangeIsInsideRoot = (root: HTMLElement, range: Range) => (
  root === range.commonAncestorContainer || root.contains(range.commonAncestorContainer)
);

const isEditableTextNode = (node: Node, root: HTMLElement) => {
  if (node.nodeType !== Node.TEXT_NODE || !node.textContent) return false;
  const parent = node.parentElement;
  if (!parent || !root.contains(parent)) return false;
  return !parent.closest('[contenteditable="false"], [data-note-image="true"], button');
};

const getSelectedTextSegments = (root: HTMLElement, range: Range) => {
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!isEditableTextNode(node, root)) continue;

    let intersects = false;
    try {
      intersects = range.intersectsNode(node);
    } catch {
      intersects = false;
    }
    if (!intersects) continue;

    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    const safeStart = Math.max(0, Math.min(start, node.length));
    const safeEnd = Math.max(safeStart, Math.min(end, node.length));
    if (safeEnd > safeStart) segments.push({ node, start: safeStart, end: safeEnd });
  }

  return segments;
};

const isolateTextSegment = (node: Text, start: number, end: number) => {
  if (end < node.length) node.splitText(end);
  return start > 0 ? node.splitText(start) : node;
};

const getOrCreateTargetSpan = (textNode: Text) => {
  const parent = textNode.parentElement;
  if (
    parent instanceof HTMLSpanElement &&
    parent.childNodes.length === 1 &&
    parent.firstChild === textNode
  ) {
    return parent;
  }

  const span = document.createElement('span');
  textNode.replaceWith(span);
  span.appendChild(textNode);
  return span;
};

const createRangeAroundTargets = (targets: HTMLSpanElement[]) => {
  const first = targets[0];
  const last = targets[targets.length - 1];
  if (!first?.parentNode || !last?.parentNode) return null;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  return range;
};

const materializeSessionTargets = (session: RichTextStyleSession) => {
  if (session.targets.length > 0) return session.targets;
  if (!rangeIsInsideRoot(session.root, session.originalRange) || session.originalRange.collapsed) return [];

  const segments = getSelectedTextSegments(session.root, session.originalRange);
  session.targets = segments.map(({ node, start, end }) => (
    getOrCreateTargetSpan(isolateTextSegment(node, start, end))
  ));
  return session.targets;
};

const applyStyles = (targets: HTMLSpanElement[], styles: Record<string, string>) => {
  targets.forEach(span => {
    Object.entries(styles).forEach(([property, value]) => {
      span.style.setProperty(property, value);
    });
  });
};

export const createRichTextStyleSession = (
  root: HTMLElement | null,
  range: Range | null,
): RichTextStyleSession | null => {
  if (!root || !range || range.collapsed || !rangeIsInsideRoot(root, range)) return null;
  return {
    root,
    originalRange: range.cloneRange(),
    targets: [],
  };
};

export const applyRichTextStyleSession = (
  session: RichTextStyleSession | null,
  styles: Record<string, string>,
): RichTextStyleResult => {
  if (!session) return { targets: [], range: null };
  const targets = materializeSessionTargets(session).filter(target => (
    target.isConnected && session.root.contains(target)
  ));
  if (targets.length === 0) return { targets: [], range: null };
  session.targets = targets;
  applyStyles(targets, styles);
  return { targets, range: createRangeAroundTargets(targets) };
};

export const applyRichTextStyleToRange = (
  root: HTMLElement | null,
  range: Range | null,
  styles: Record<string, string>,
) => {
  const session = createRichTextStyleSession(root, range);
  return applyRichTextStyleSession(session, styles);
};

const safeStyleSignature = (span: HTMLSpanElement) => (
  SAFE_STYLE_PROPERTIES
    .map(property => `${property}:${span.style.getPropertyValue(property).trim().toLowerCase()}`)
    .filter(entry => !entry.endsWith(':'))
    .join(';')
);

const spanHasMeaningfulContent = (span: HTMLSpanElement) => (
  Array.from(span.childNodes).some(child => (
    child.nodeType === Node.ELEMENT_NODE || Boolean(child.textContent)
  ))
);

const unwrapElement = (element: Element) => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
};

const mergeAdjacentEquivalentSpans = (root: HTMLElement) => {
  const parents = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  parents.forEach(parent => {
    let current = parent.firstChild;
    while (current) {
      if (!(current instanceof HTMLSpanElement)) {
        current = current.nextSibling;
        continue;
      }
      const next = current.nextSibling;
      if (
        next instanceof HTMLSpanElement &&
        safeStyleSignature(current) === safeStyleSignature(next)
      ) {
        while (next.firstChild) current.appendChild(next.firstChild);
        next.remove();
        continue;
      }
      current = current.nextSibling;
    }
  });
};

export const normalizeRichTextSpans = (root: HTMLElement) => {
  const spans = Array.from(root.querySelectorAll<HTMLSpanElement>('span')).reverse();

  spans.forEach(span => {
    if (!root.contains(span)) return;
    if (!spanHasMeaningfulContent(span)) {
      span.remove();
      return;
    }

    const signature = safeStyleSignature(span);
    if (!signature) {
      unwrapElement(span);
      return;
    }

    const onlyChild = span.childNodes.length === 1 ? span.firstElementChild : null;
    if (
      onlyChild instanceof HTMLSpanElement &&
      safeStyleSignature(onlyChild) === signature
    ) {
      while (onlyChild.firstChild) span.insertBefore(onlyChild.firstChild, onlyChild);
      onlyChild.remove();
    }
  });

  mergeAdjacentEquivalentSpans(root);
  return root;
};
