import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeRichHtml } from '../supabase/functions/_shared/security';

test('cloud sanitizer preserves Safari contenteditable paragraph breaks', () => {
  assert.equal(
    sanitizeRichHtml('first line<div>second line</div><div><br></div>'),
    'first line<p>second line</p><p><br></p>',
  );
});
