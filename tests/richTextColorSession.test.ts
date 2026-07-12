import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { sanitizeRichHtml } from '../src/lib/htmlSanitizer';
import {
  applyRichTextStyleSession,
  createRichTextStyleSession,
  normalizeRichTextSpans,
} from '../src/lib/richTextStyleSession';

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

const textNodes = (root: HTMLElement) => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
};

const makeRange = (start: Text, startOffset: number, end: Text, endOffset: number) => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
};

const maxSpanDepth = (root: HTMLElement) => {
  let maxDepth = 0;
  root.querySelectorAll('span').forEach(span => {
    let depth = 1;
    let parent = span.parentElement;
    while (parent && parent !== root) {
      if (parent.tagName === 'SPAN') depth += 1;
      parent = parent.parentElement;
    }
    maxDepth = Math.max(maxDepth, depth);
  });
  return maxDepth;
};

test('applies a local color to one selected text segment', () => {
  const root = makeRoot('<p>hello world</p>');
  const node = textNodes(root)[0];
  const session = createRichTextStyleSession(root, makeRange(node, 0, node, 5));
  const result = applyRichTextStyleSession(session, { color: '#123456' });

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].textContent, 'hello');
  assert.equal(result.targets[0].style.color, 'rgb(18, 52, 86)');
  assert.equal(root.textContent, 'hello world');
});

test('colors a selection across three text nodes and two paragraphs', () => {
  const root = makeRoot(
    '<p>alpha <span style="color:#111111">beta</span></p>' +
    '<p><u>gamma</u></p>',
  );
  const nodes = textNodes(root);
  const session = createRichTextStyleSession(root, makeRange(nodes[0], 2, nodes[2], 3));
  const result = applyRichTextStyleSession(session, { color: '#556677' });

  assert.deepEqual(result.targets.map(target => target.textContent), ['pha ', 'beta', 'gam']);
  result.targets.forEach(target => assert.equal(target.style.color, 'rgb(85, 102, 119)'));
  assert.equal(root.textContent, 'alpha betagamma');
});

test('keeps font size and underline while replacing mixed local colors', () => {
  const root = makeRoot(
    '<p><span style="color:#aa0000">one</span>' +
    '<span style="font-size:24px">two</span>' +
    '<u><span style="text-decoration-line:underline;color:#00aa00">three</span></u></p>',
  );
  const nodes = textNodes(root);
  const session = createRichTextStyleSession(root, makeRange(nodes[0], 0, nodes[2], nodes[2].length));
  const result = applyRichTextStyleSession(session, { color: '#334455' });

  assert.equal(result.targets.length, 3);
  assert.equal(result.targets[1].style.fontSize, '24px');
  assert.equal(result.targets[2].style.textDecorationLine, 'underline');
  assert.ok(result.targets[2].closest('u'));
  result.targets.forEach(target => assert.equal(target.style.color, 'rgb(51, 68, 85)'));
});

test('ten picker updates reuse stable spans and persist the final color after sanitize', () => {
  const root = makeRoot('<p>first <span style="font-size:22px">second</span></p><p><u>third</u></p>');
  const nodes = textNodes(root);
  const session = createRichTextStyleSession(root, makeRange(nodes[0], 0, nodes[2], nodes[2].length));
  const colors = [
    '#111111', '#222222', '#333333', '#444444', '#555555',
    '#666666', '#777777', '#888888', '#999999', '#abcdef',
  ];

  const firstResult = applyRichTextStyleSession(session, { color: colors[0] });
  const initialTargets = [...firstResult.targets];
  colors.slice(1).forEach(color => applyRichTextStyleSession(session, { color }));

  assert.deepEqual(session?.targets, initialTargets);
  assert.ok(maxSpanDepth(root) <= 2);
  session?.targets.forEach(target => assert.equal(target.style.color, 'rgb(171, 205, 239)'));

  root.insertAdjacentHTML('beforeend', '<span></span><span>plain</span>');
  normalizeRichTextSpans(root);
  assert.equal(root.querySelectorAll('span:empty').length, 0);
  assert.equal(root.textContent, 'first secondthirdplain');

  const savedHtml = sanitizeRichHtml(root.innerHTML);
  const reloadedHtml = sanitizeRichHtml(savedHtml);
  assert.equal(reloadedHtml, savedHtml);
  const reloaded = makeRoot(reloadedHtml);
  const coloredText = Array.from(reloaded.querySelectorAll<HTMLSpanElement>('span'))
    .filter(span => span.style.color === 'rgb(171, 205, 239)')
    .map(span => span.textContent)
    .join('');
  assert.equal(coloredText, 'first secondthird');
  assert.equal(reloaded.querySelector('span[style*="font-size"]')?.textContent, 'second');
  assert.equal(reloaded.querySelector('u')?.textContent, 'third');
});

test('span normalization preserves paragraph breaks, underline, and image nodes', () => {
  const html = (
    '<p><span style="color:#123456">one</span><span style="color:#123456">two</span><br></p>' +
    '<p><u><span style="color:#123456">three</span></u></p>' +
    '<figure data-note-image="true"><img src="storage://life-media/user/note/image.jpg" ' +
    'data-media-provider="supabase" data-media-path="user/note/image.jpg"></figure>'
  );
  const sanitized = sanitizeRichHtml(html);
  const root = makeRoot(sanitized);

  assert.equal(root.querySelectorAll('p').length, 2);
  assert.equal(root.querySelectorAll('br').length, 1);
  assert.equal(root.querySelectorAll('figure[data-note-image="true"] img').length, 1);
  assert.equal(root.querySelector('p')?.querySelectorAll('span').length, 1);
  assert.equal(root.querySelector('p')?.querySelector('span')?.textContent, 'onetwo');
  assert.equal(root.querySelector('u')?.textContent, 'three');
});
