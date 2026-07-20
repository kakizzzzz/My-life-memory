import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = 'supabase/migrations/20260722_allow_no_referrer_note_images.sql';

test('database HTML validation accepts only the exact no-referrer image policy', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const database = new PGlite();
  try {
    await database.exec('create role anon; create role authenticated;');
    await database.exec(migration);
    await database.exec(migration);

    const check = async (html: string) => {
      const result = await database.query<{ safe: boolean }>(
        'select public.memory_html_is_safe($1) as safe',
        [html]
      );
      return result.rows[0]?.safe;
    };

    assert.equal(await check('<p>plain note</p>'), true);
    assert.equal(await check(
      '<figure class="note-inline-image" contenteditable="false" data-note-image="true"><img src="storage://life-media/user/note/image.jpg" alt="memory" referrerpolicy="no-referrer" data-media-path="user/note/image.jpg"></figure>'
    ), true);
    assert.equal(await check('<img src="https://example.test/image.jpg" referrerpolicy="origin">'), false);
    assert.equal(await check('<img src="https://example.test/image.jpg" referrerpolicy="unsafe-url">'), false);
    assert.equal(await check('<img src="https://example.test/image.jpg" loading="lazy">'), false);
    assert.equal(await check('<img src="javascript:alert(1)" referrerpolicy="no-referrer">'), false);
  } finally {
    await database.close();
  }
});
