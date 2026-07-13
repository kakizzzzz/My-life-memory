import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStoredExportImageTask,
  exportImageTasks,
  exportStoredImage,
  type ExportedImageData,
} from '../src/lib/exportReport';
import {
  downloadStoredImageBlob,
  StoredImageDownloadError,
  type StoredImageMetadata,
} from '../src/lib/mediaStorage';
import { getUserDataExportProgressPercent } from '../src/lib/userDataExport';

const metadata = (path: string): StoredImageMetadata => ({
  provider: 'supabase',
  bucket: 'life-media',
  key: path,
  path,
  mimeType: 'image/jpeg',
  size: 4,
  createdAt: 1,
});

test('maps real export stages and completed image counts to monotonic progress', () => {
  assert.equal(getUserDataExportProgressPercent({ stage: 'preparing' }), 8);
  assert.equal(getUserDataExportProgressPercent({ stage: 'images', completed: 0, total: 4 }), 10);
  assert.equal(getUserDataExportProgressPercent({ stage: 'images', completed: 1, total: 4 }), 30);
  assert.equal(getUserDataExportProgressPercent({ stage: 'images', completed: 2, total: 4 }), 50);
  assert.equal(getUserDataExportProgressPercent({ stage: 'images', completed: 4, total: 4 }), 90);
  assert.equal(getUserDataExportProgressPercent({ stage: 'images', completed: 6, total: 4 }), 90);
  assert.equal(getUserDataExportProgressPercent({ stage: 'generating' }), 96);
});

test('authenticated Storage download succeeds without generating a signed URL', async () => {
  let signedUrlCalls = 0;
  const result = await downloadStoredImageBlob(metadata('user/note/image.jpg'), {
    download: async () => ({
      data: new Blob(['image'], { type: 'image/jpeg' }),
      error: null,
    }),
    createSignedUrl: async () => {
      signedUrlCalls += 1;
      return 'https://private.example/image';
    },
  });

  assert.equal(result.method, 'download');
  assert.equal(result.blob.size, 5);
  assert.equal(signedUrlCalls, 0);
});

test('a transient first failure retries and embeds the second download', async () => {
  let attempts = 0;
  let signedUrlCalls = 0;
  const image = await exportStoredImage(metadata('user/note/retry.jpg'), 'note.image', {
    retryDelayMs: 0,
    download: async () => {
      attempts += 1;
      if (attempts === 1) return { data: null, error: new TypeError('Failed to fetch') };
      return { data: new Blob(['ok'], { type: 'image/jpeg' }), error: null };
    },
    createSignedUrl: async () => {
      signedUrlCalls += 1;
      return 'https://private.example/retry';
    },
  });

  assert.equal(attempts, 2);
  assert.equal(signedUrlCalls, 0);
  assert.match(image.dataUrl || '', /^data:image\/jpeg;base64,/);
  assert.equal(image.exportError, undefined);
});

test('signed URL download remains available only as a compatibility fallback', async () => {
  let signedUrlCalls = 0;
  const result = await downloadStoredImageBlob(metadata('user/note/legacy.jpg'), {
    retryDelayMs: 0,
    download: async () => ({ data: null, error: new Error('Legacy download adapter unavailable') }),
    createSignedUrl: async () => {
      signedUrlCalls += 1;
      return 'https://private.example/legacy';
    },
    fetch: async () => new Response(new Blob(['legacy'], { type: 'image/jpeg' }), { status: 200 }),
  });

  assert.equal(result.method, 'signed-url');
  assert.equal(signedUrlCalls, 1);
  assert.equal(result.blob.size, 6);
});

test('deduplicates paths, limits concurrency to three, and reports exact failures and progress', async () => {
  const duplicate = metadata('user/note/same.jpg');
  const tasks = [
    createStoredExportImageTask(duplicate, 'one'),
    createStoredExportImageTask(duplicate, 'two'),
    createStoredExportImageTask(duplicate, 'three'),
    createStoredExportImageTask(metadata('user/note/two.jpg'), 'four'),
    createStoredExportImageTask(metadata('user/note/fail.jpg'), 'five'),
    createStoredExportImageTask(metadata('user/note/four.jpg'), 'six'),
  ];
  const calls = new Map<string, number>();
  const progress: number[] = [];
  let active = 0;
  let maxActive = 0;

  const result = await exportImageTasks(tasks, {
    concurrency: 3,
    onProgress: value => progress.push(value.completed),
    resolveTask: async task => {
      const path = task.metadata?.path || '';
      calls.set(path, (calls.get(path) || 0) + 1);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 8));
      active -= 1;
      if (path.endsWith('/fail.jpg')) {
        return {
          source: task.source,
          provider: 'supabase',
          path,
          exportError: 'HTTP 404',
          exportErrorType: 'not-found',
        } satisfies ExportedImageData;
      }
      return {
        source: task.source,
        provider: 'supabase',
        path,
        dataUrl: 'data:image/jpeg;base64,b2s=',
      } satisfies ExportedImageData;
    },
  });

  assert.equal(result.total, 4);
  assert.equal(calls.get(duplicate.path), 1);
  assert.ok(maxActive <= 3);
  assert.deepEqual(progress, [0, 1, 2, 3, 4]);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {
    key: 'storage:life-media/user/note/fail.jpg',
    path: 'user/note/fail.jpg',
    type: 'not-found',
    message: 'HTTP 404',
  });
  assert.equal(
    Array.from(result.results.values()).filter(image => Boolean(image?.dataUrl)).length,
    3,
  );
});

test('an invalid or stalled path times out instead of blocking export forever', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    downloadStoredImageBlob(metadata('user/note/stalled.jpg'), {
      timeoutMs: 20,
      maxRetries: 0,
      allowSignedUrlFallback: false,
      download: async () => new Promise(() => {}),
    }),
    (error: unknown) => (
      error instanceof StoredImageDownloadError && error.failureType === 'timeout'
    ),
  );
  assert.ok(Date.now() - startedAt < 250);
});

test('a missing image is not retried or sent through the signed URL fallback', async () => {
  let downloadCalls = 0;
  let signedUrlCalls = 0;
  await assert.rejects(
    downloadStoredImageBlob(metadata('user/note/missing.jpg'), {
      retryDelayMs: 0,
      download: async () => {
        downloadCalls += 1;
        return { data: null, error: { statusCode: 404, message: 'Object not found' } };
      },
      createSignedUrl: async () => {
        signedUrlCalls += 1;
        return 'https://private.example/missing';
      },
    }),
    (error: unknown) => (
      error instanceof StoredImageDownloadError && error.failureType === 'not-found'
    ),
  );
  assert.equal(downloadCalls, 1);
  assert.equal(signedUrlCalls, 0);
});
