import assert from 'node:assert/strict';
import test from 'node:test';
import { notesHaveMeaningfulChanges } from '../src/lib/noteChangeDetection';
import { isReaderEditorReadyForSave } from '../src/lib/readerDraftSafety';
import type { NoteData } from '../src/types/app';

const note: NoteData = {
  id: 'note-1',
  title: 'Title',
  titleHtml: 'Title',
  content: 'Body',
  contentHtml: '<p>Body</p>',
  createdAt: 100,
  updatedAt: 100,
  fontSize: 18,
  titleFontSize: 18,
  color: '#D2936D',
};

test('opening and closing a note does not count updatedAt alone as an edit', () => {
  assert.equal(notesHaveMeaningfulChanges([note], [{ ...note, updatedAt: 200 }]), false);
});

test('detects actual note text changes', () => {
  assert.equal(notesHaveMeaningfulChanges([note], [{ ...note, contentHtml: '<p>Changed</p>' }]), true);
});

test('does not save an empty reader DOM before the selected note is hydrated', () => {
  assert.equal(isReaderEditorReadyForSave({
    recordKey: 'star-1-note-1',
    readyKey: null,
    hasTitleEditor: true,
    hasContentEditor: true,
  }), false);
  assert.equal(isReaderEditorReadyForSave({
    recordKey: 'star-1-note-1',
    readyKey: 'star-1-note-1',
    hasTitleEditor: true,
    hasContentEditor: true,
  }), true);
});

test('reopening the same note stays blocked until its new editor DOM is ready', () => {
  assert.equal(isReaderEditorReadyForSave({
    recordKey: 'star-1-note-1',
    readyKey: null,
    hasTitleEditor: true,
    hasContentEditor: true,
  }), false);
});
