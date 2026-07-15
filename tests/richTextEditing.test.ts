import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { sanitizeRichHtml } from '../src/lib/htmlSanitizer';
import {
  getBoundaryInheritedTextStyles,
  insertStyledTextAtRange,
  removeAdjacentNoteImageForInput,
} from '../src/lib/richTextEditing';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  HTMLElement: dom.window.HTMLElement,
  HTMLSpanElement: dom.window.HTMLSpanElement,
  Text: dom.window.Text,
  Range: dom.window.Range,
  FileReader: dom.window.FileReader,
});

const makeRoot = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
};

test('backspace at the first character after a saved image removes the image', () => {
  const root = makeRoot(
    '<figure contenteditable="false" data-note-image="true"><img src="https://example.com/a.jpg"></figure>' +
    '<p>after</p>',
  );
  const textNode = root.querySelector('p')?.firstChild as Text;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);

  const nextRange = removeAdjacentNoteImageForInput(root, range, 'deleteContentBackward');

  assert.ok(nextRange);
  assert.equal(root.querySelector('[data-note-image="true"]'), null);
  assert.equal(root.textContent, 'after');
});

test('backspace within following text does not remove the previous image', () => {
  const root = makeRoot(
    '<figure contenteditable="false" data-note-image="true"><img src="https://example.com/a.jpg"></figure>' +
    '<p>after</p>',
  );
  const textNode = root.querySelector('p')?.firstChild as Text;
  const range = document.createRange();
  range.setStart(textNode, 1);
  range.collapse(true);

  assert.equal(removeAdjacentNoteImageForInput(root, range, 'deleteContentBackward'), null);
  assert.ok(root.querySelector('[data-note-image="true"]'));
});

test('backspace removes a saved image across an iOS zero-width caret marker', () => {
  const root = makeRoot(
    '<figure contenteditable="false" data-note-image="true"><img src="https://example.com/a.jpg"></figure>' +
    '<p>\u200Bafter</p>',
  );
  const textNode = root.querySelector('p')?.firstChild as Text;
  const range = document.createRange();
  range.setStart(textNode, 1);
  range.collapse(true);

  const nextRange = removeAdjacentNoteImageForInput(root, range, 'deleteContentBackward');

  assert.ok(nextRange);
  assert.equal(root.querySelector('[data-note-image="true"]'), null);
  assert.equal(root.textContent, '\u200Bafter');
});

test('typing at a colored span boundary materializes the inherited color before save', () => {
  const root = makeRoot(
    '<p style="color:#7e9fba"><span style="color:#000000">black</span>tail</p>',
  );
  const paragraph = root.querySelector('p') as HTMLParagraphElement;
  const range = document.createRange();
  range.setStart(paragraph, 1);
  range.collapse(true);

  const styles = getBoundaryInheritedTextStyles(root, range);
  assert.equal(styles.color, 'rgb(0, 0, 0)');
  assert.ok(insertStyledTextAtRange(root, range, 'X', styles));

  const savedHtml = sanitizeRichHtml(root.innerHTML);
  const reloaded = makeRoot(sanitizeRichHtml(savedHtml));
  const inserted = Array.from(reloaded.querySelectorAll<HTMLSpanElement>('span'))
    .find(span => span.textContent?.includes('X'));
  assert.ok(inserted);
  assert.equal(inserted.style.color, 'rgb(0, 0, 0)');
  assert.equal(reloaded.textContent, 'blackXtail');
});

test('Safari legacy font color is converted to a safe persistent span', () => {
  const sanitized = sanitizeRichHtml('<p><font color="#000000">typed</font></p>');
  const root = makeRoot(sanitized);
  const span = root.querySelector('span');

  assert.ok(span);
  assert.equal(span.textContent, 'typed');
  assert.equal(span.style.color, 'rgb(0, 0, 0)');
  assert.equal(root.querySelector('font'), null);
});
