import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appChrome = readFileSync('src/AppChrome.tsx', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');

test('button icons receive shared press feedback without double-scaling existing controls', () => {
  assert.match(indexCss, /button:not\(:disabled\):not\(\[class\*="active:scale"\]\):active svg/);
  assert.match(indexCss, /transform: scale\(0\.92\)/);
  assert.doesNotMatch(appChrome, /group-active:scale-95/);
});

test('theme-gray icon surfaces deepen on press', () => {
  assert.match(indexCss, /bg-\[var\(--app-icon\)\]/);
  assert.match(indexCss, /bg-\[var\(--app-card\)\]/);
  assert.match(indexCss, /filter: brightness\(0\.9\)/);
});

test('permission actions do not auto-focus or draw a selection outline', () => {
  assert.doesNotMatch(appChrome, /autoFocus/);
  assert.doesNotMatch(appChrome, /focus-visible:outline/);
  assert.match(appChrome, /focus-visible:brightness-90/);
});
