export type MediaDeletionQueueItem = {
  queue_id: number;
  user_id: string;
  bucket: string;
  path: string;
  attempts: number;
};

export type MediaRetentionDependencies = {
  purgeExpiredTrash: () => Promise<unknown>;
  claimDue: (limit: number) => Promise<MediaDeletionQueueItem[]>;
  isProtected: (item: MediaDeletionQueueItem) => Promise<boolean>;
  removeObject: (item: MediaDeletionQueueItem) => Promise<void>;
  complete: (queueId: number) => Promise<void>;
  fail: (queueId: number, message: string, retryAfterSeconds: number) => Promise<void>;
};

export type MediaRetentionResult = {
  ok: true;
  purge: unknown;
  claimed: number;
  deleted: number;
  protected: number;
  failed: number;
};

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error || 'Unknown media deletion error')
);

const retryDelaySeconds = (attempts: number) => (
  Math.min(24 * 60 * 60, Math.max(15 * 60, 15 * 60 * (2 ** Math.min(attempts, 6))))
);

const mapWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
) => {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await operation(item);
      }
    },
  );
  await Promise.all(workers);
};

export const runMediaRetentionCycle = async (
  dependencies: MediaRetentionDependencies,
  options: {
    batchSize?: number;
    maxBatches?: number;
    concurrency?: number;
  } = {},
): Promise<MediaRetentionResult> => {
  const batchSize = Math.min(250, Math.max(1, options.batchSize ?? 100));
  const maxBatches = Math.min(20, Math.max(1, options.maxBatches ?? 10));
  const concurrency = Math.min(5, Math.max(1, options.concurrency ?? 3));
  const purge = await dependencies.purgeExpiredTrash();
  const result: MediaRetentionResult = {
    ok: true,
    purge,
    claimed: 0,
    deleted: 0,
    protected: 0,
    failed: 0,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const items = await dependencies.claimDue(batchSize);
    if (items.length === 0) break;
    result.claimed += items.length;

    await mapWithConcurrency(items, concurrency, async item => {
      try {
        const pathIsScoped = item.path.startsWith(`${item.user_id}/`);
        if (item.bucket !== 'life-media' || !pathIsScoped) {
          throw new Error('Rejected an invalid or cross-account Storage path.');
        }

        if (await dependencies.isProtected(item)) {
          await dependencies.complete(item.queue_id);
          result.protected += 1;
          return;
        }

        await dependencies.removeObject(item);
        await dependencies.complete(item.queue_id);
        result.deleted += 1;
      } catch (error) {
        result.failed += 1;
        await dependencies.fail(
          item.queue_id,
          errorMessage(error),
          retryDelaySeconds(item.attempts),
        );
      }
    });

    if (items.length < batchSize) break;
  }

  return result;
};
