import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  asyncScopeTokenMatches,
  updateAsyncScopeToken,
  type AsyncScopeToken,
} from '../src/hooks/useAsyncScope';
import { clearMediaMaintenanceLocalState } from '../src/lib/mediaMaintenancePersistence';

const app = readFileSync('src/App.tsx', 'utf8');
const cloudAuth = readFileSync('src/hooks/useCloudAuthSync.ts', 'utf8');
const mediaMaintenance = readFileSync('src/hooks/useCloudMediaMaintenance.ts', 'utf8');
const galleryActions = readFileSync('src/hooks/useGalleryActions.ts', 'utf8');
const photoImport = readFileSync('src/hooks/usePhotoLocationImport.ts', 'utf8');
const readerController = readFileSync('src/hooks/useReaderController.ts', 'utf8');
const noteEditor = readFileSync('src/NoteEditorModal.tsx', 'utf8');
const serviceWorker = readFileSync('public/sw.js', 'utf8');

test('async scope tokens invalidate stale account work without invalidating the current account', () => {
  const first: AsyncScopeToken = { key: 'signed-in:alpha', generation: 0 };
  const unchanged = updateAsyncScopeToken(first, 'signed-in:alpha');
  const switched = updateAsyncScopeToken(unchanged, 'signed-in:beta');

  assert.equal(unchanged, first);
  assert.deepEqual(switched, { key: 'signed-in:beta', generation: 1 });
  assert.equal(asyncScopeTokenMatches(switched, first), false);
  assert.equal(asyncScopeTokenMatches(switched, { ...switched }), true);
});

test('cloud conflict and media maintenance await work under the captured account scope', () => {
  assert.match(cloudAuth, /const accountEpoch = cloudAccountEpochRef\.current/);
  assert.match(cloudAuth, /isCloudAccountScopeCurrent\(userId, accountEpoch\)/);
  assert.match(mediaMaintenance, /captureMediaAccountScope\(\)/);
  assert.match(mediaMaintenance, /createSessionScopedSupabaseClient\(accountScope\.accessToken\)/);
  assert.match(mediaMaintenance, /isScopeCurrent\(runScope\)/);
});

test('every interactive image upload path receives and enforces the account scope', () => {
  for (const source of [galleryActions, photoImport, readerController, noteEditor]) {
    assert.match(source, /captureMediaAccountScope\(\)/);
    assert.match(source, /discardUploadedImageForScope/);
  }
  assert.ok((app.match(/accountScopeKey:/g) || []).length >= 3);
  assert.match(app, /<NoteEditorModal[\s\S]*accountScopeKey=/);
});

test('account deletion clears only the deleted account maintenance markers', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>([
    ['my-life-memory-media-scan-v1:alpha', '1'],
    ['my-life-memory-trash-purge-v1:alpha', '2'],
    ['my-life-memory-media-scan-v1:beta', '3'],
  ]);
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  try {
    clearMediaMaintenanceLocalState('Alpha');
    assert.equal(values.has('my-life-memory-media-scan-v1:alpha'), false);
    assert.equal(values.has('my-life-memory-trash-purge-v1:alpha'), false);
    assert.equal(values.get('my-life-memory-media-scan-v1:beta'), '3');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('service worker serves the cached app shell when navigation receives an HTTP error', async () => {
  type MockFetchEvent = {
    request: {
      method: string;
      url: string;
      mode: string;
      headers: Headers;
      destination: string;
    };
    respondWith(response: Promise<Response | undefined>): void;
  };

  let fetchHandler: ((event: MockFetchEvent) => void) | undefined;
  const cachedResponse = new Response('cached app shell', { status: 200 });
  const networkResponse = new Response('temporary upstream failure', { status: 503 });
  const context = {
    self: {
      location: { origin: 'https://memory.example' },
      clients: { claim: () => undefined },
      skipWaiting: () => undefined,
      addEventListener: (type: string, handler: unknown) => {
        if (type === 'fetch') fetchHandler = handler as (event: MockFetchEvent) => void;
      },
    },
    caches: {
      open: async () => ({ addAll: async () => undefined, put: async () => undefined }),
      keys: async () => [],
      delete: async () => true,
      match: async (request: string) => (
        request === './index.html' ? cachedResponse : undefined
      ),
    },
    fetch: async () => networkResponse,
    URL,
    console,
  };

  vm.runInNewContext(serviceWorker, context);
  const handleFetch = fetchHandler;
  assert.ok(handleFetch);
  let responsePromise: Promise<Response | undefined> | undefined;
  handleFetch({
    request: {
      method: 'GET',
      url: 'https://memory.example/app',
      mode: 'navigate',
      headers: new Headers(),
      destination: 'document',
    },
    respondWith: response => {
      responsePromise = response;
    },
  });
  assert.ok(responsePromise);
  assert.equal(await responsePromise, cachedResponse);
});
