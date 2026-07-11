export const isReaderEditorReadyForSave = ({
  recordKey,
  readyKey,
  hasTitleEditor,
  hasContentEditor,
}: {
  recordKey: string | null;
  readyKey: string | null;
  hasTitleEditor: boolean;
  hasContentEditor: boolean;
}) => Boolean(
  recordKey
  && readyKey === recordKey
  && hasTitleEditor
  && hasContentEditor
);
