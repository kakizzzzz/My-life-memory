import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStorageImageSrc,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from '../src/lib/mediaStorage';

const metadata = (path: string): StoredImageMetadata => ({
  provider: 'supabase',
  bucket: 'life-media',
  key: path,
  path,
  mimeType: 'image/jpeg',
  size: 100,
  createdAt: 1,
});

test('hundreds of private images warm in bounded batches and become available progressively', async () => {
  const images = Array.from({ length: 205 }, (_, index) => metadata(`warmup-user/notes/${index}.jpg`));
  let activeBatches = 0;
  let maximumActiveBatches = 0;
  let batchCalls = 0;
  const progress: number[] = [];

  const result = await warmStorageImageUrls(images, {
    batchSize: 32,
    maxConcurrentBatches: 2,
    createSignedUrls: async (_bucket, paths) => {
      batchCalls += 1;
      activeBatches += 1;
      maximumActiveBatches = Math.max(maximumActiveBatches, activeBatches);
      await new Promise(resolve => setTimeout(resolve, 2));
      activeBatches -= 1;
      return {
        data: paths.map(path => ({
          error: null,
          path,
          signedUrl: `https://images.example.test/${path}`,
        })),
        error: null,
      };
    },
    onBatchReady: value => progress.push(value.completed),
  });

  assert.equal(batchCalls, 7);
  assert.equal(maximumActiveBatches <= 2, true);
  assert.equal(result.total, 205);
  assert.equal(result.ready, 205);
  assert.equal(result.failed, 0);
  assert.equal(progress.length, 7);
  assert.equal(progress.at(-1), 205);
  assert.equal(images.every(image => buildStorageImageSrc(image).startsWith('https://')), true);
});

test('duplicate and overlapping warm requests do not request the same path twice', async () => {
  const image = metadata('warmup-overlap-user/notes/shared.jpg');
  let releaseBatch = () => {};
  const gate = new Promise<void>(resolve => {
    releaseBatch = resolve;
  });
  let batchCalls = 0;
  const createSignedUrls = async (_bucket: string, paths: string[]) => {
    batchCalls += 1;
    await gate;
    return {
      data: paths.map(path => ({
        error: null,
        path,
        signedUrl: `https://images.example.test/${path}`,
      })),
      error: null,
    };
  };

  const first = warmStorageImageUrls([image, image, image], { createSignedUrls });
  const second = warmStorageImageUrls([image], { createSignedUrls });
  releaseBatch();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(batchCalls, 1);
  assert.equal(firstResult.ready, 1);
  assert.equal(secondResult.ready, 1);
  assert.equal(buildStorageImageSrc(image).startsWith('https://'), true);
});
