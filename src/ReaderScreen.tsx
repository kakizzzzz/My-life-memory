import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { Camera, ChevronUp, ChevronsLeft, Image as ImageIcon, MapPin, Menu, Palette, Save, Underline } from 'lucide-react';
import { READER_FONT_SIZES, READER_TEXT_COLORS } from './constants/theme';
import { HOME_COPY } from './copy/homeCopy';
import type { NoteData, StarData } from './types/app';

type HomeCopy = typeof HOME_COPY.en;

export type ReaderRecord = {
  star: StarData;
  note: NoteData;
  timestamp: number;
  titleHtml: string;
  contentHtml: string;
};

type ReaderScreenProps = {
  isOpen: boolean;
  isSignedIn: boolean;
  readerRecord: ReaderRecord | null;
  homeCopy: HomeCopy;
  screenTopPaddingClass: string;
  iconStrokeWidth: number;
  readerCameraInputRef: React.RefObject<HTMLInputElement | null>;
  readerImageInputRef: React.RefObject<HTMLInputElement | null>;
  readerTitleRef: React.RefObject<HTMLHeadingElement | null>;
  readerContentRef: React.RefObject<HTMLDivElement | null>;
  isReaderToolsOpen: boolean;
  readerActivePanel: 'font' | 'color' | null;
  readerSelectedFontSize: number;
  readerSelectedColor: string;
  readerSelectedUnderline: boolean;
  readerShowCustomPicker: boolean;
  onReaderImageInput: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onReaderEditorsReady: () => boolean;
  onBackToRecords: () => void;
  onReaderBeforeInput: (target: 'title' | 'content', event: React.FormEvent<HTMLElement>) => void;
  onReaderKeyDown: (target: 'title' | 'content', event: React.KeyboardEvent<HTMLElement>) => void;
  onReaderInput: () => void;
  onReaderPaste: (target: 'title' | 'content', event: React.ClipboardEvent<HTMLElement>) => void | Promise<void>;
  onSaveReaderSelection: () => void;
  onReaderContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSaveReaderDraft: () => boolean;
  onKeepReaderSelectionPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onReaderPanelToggle: (panel: 'font' | 'color') => void;
  onReaderFontSize: (size: number) => void;
  onReaderUnderline: () => void;
  onReaderTextColor: (color: string) => void;
  onToggleCustomPicker: () => void;
  onCollapseTools: () => void;
  onExpandTools: () => void;
  onLocateReaderRecord: () => void;
  formatRecordMonth: (timestamp: number) => string;
};

const readerToolButtonClass = "flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-md transition-transform active:scale-95";

export function ReaderScreen({
  isOpen,
  isSignedIn,
  readerRecord,
  homeCopy,
  screenTopPaddingClass,
  iconStrokeWidth,
  readerCameraInputRef,
  readerImageInputRef,
  readerTitleRef,
  readerContentRef,
  isReaderToolsOpen,
  readerActivePanel,
  readerSelectedFontSize,
  readerSelectedColor,
  readerSelectedUnderline,
  readerShowCustomPicker,
  onReaderImageInput,
  onReaderEditorsReady,
  onBackToRecords,
  onReaderBeforeInput,
  onReaderKeyDown,
  onReaderInput,
  onReaderPaste,
  onSaveReaderSelection,
  onReaderContentClick,
  onSaveReaderDraft,
  onKeepReaderSelectionPointerDown,
  onReaderPanelToggle,
  onReaderFontSize,
  onReaderUnderline,
  onReaderTextColor,
  onToggleCustomPicker,
  onCollapseTools,
  onExpandTools,
  onLocateReaderRecord,
  formatRecordMonth,
}: ReaderScreenProps) {
  const [isSaveFeedbackVisible, setIsSaveFeedbackVisible] = React.useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = React.useState(false);
  const saveFeedbackTimerRef = React.useRef<number | null>(null);
  const readerRecordKey = readerRecord ? `${readerRecord.star.id}-${readerRecord.note.id}` : '';
  const readerBaselineRef = React.useRef<{ key: string; titleHtml: string; contentHtml: string } | null>(null);

  const readerUiCopy = React.useMemo(() => {
    if (homeCopy.backToRecords === '返回记录') {
      return {
        saved: '正在保存…',
        exitTitle: '不保存并退出？',
        exitBody: '当前修改不会保存，你可以继续回来修改。',
        keepEditing: '继续修改',
        discardExit: '不保存',
      };
    }
    if (homeCopy.backToRecords === '기록으로 돌아가기') {
      return {
        saved: '저장 중…',
        exitTitle: '저장하지 않고 나갈까요?',
        exitBody: '현재 수정 내용은 저장되지 않습니다. 계속 편집할 수 있습니다.',
        keepEditing: '계속 수정',
        discardExit: '저장 안 함',
      };
    }
    return {
      saved: 'Saving…',
      exitTitle: 'Leave without saving?',
      exitBody: 'Your current edits will not be saved. You can keep editing instead.',
      keepEditing: 'Keep editing',
      discardExit: 'Don’t Save',
    };
  }, [homeCopy.backToRecords]);

  const fallbackTitleHtml = readerRecord?.titleHtml ?? '';
  const fallbackContentHtml = readerRecord?.contentHtml ?? '';
  const readCurrentReaderHtml = React.useCallback(() => ({
    titleHtml: readerTitleRef.current?.innerHTML ?? fallbackTitleHtml,
    contentHtml: readerContentRef.current?.innerHTML ?? fallbackContentHtml,
  }), [fallbackContentHtml, fallbackTitleHtml, readerContentRef, readerTitleRef]);

  const updateReaderBaselineFromDom = React.useCallback(() => {
    if (!readerRecordKey) {
      readerBaselineRef.current = null;
      return;
    }
    readerBaselineRef.current = {
      key: readerRecordKey,
      ...readCurrentReaderHtml(),
    };
  }, [readCurrentReaderHtml, readerRecordKey]);

  const hasReaderDraftChanges = React.useCallback(() => {
    if (!readerRecordKey) return false;
    const baseline = readerBaselineRef.current;
    if (!baseline || baseline.key !== readerRecordKey) return false;
    const current = readCurrentReaderHtml();
    return current.titleHtml !== baseline.titleHtml || current.contentHtml !== baseline.contentHtml;
  }, [readCurrentReaderHtml, readerRecordKey]);

  React.useLayoutEffect(() => {
    if (!isOpen || !readerRecordKey) return;
    onReaderEditorsReady();
  }, [isOpen, onReaderEditorsReady, readerRecordKey]);

  React.useEffect(() => () => {
    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (isOpen) return;
    setIsSaveFeedbackVisible(false);
    setIsExitConfirmOpen(false);
    readerBaselineRef.current = null;
    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current);
      saveFeedbackTimerRef.current = null;
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || !readerRecord) {
      readerBaselineRef.current = null;
      return;
    }
    const frameId = window.requestAnimationFrame(updateReaderBaselineFromDom);
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, readerRecordKey, updateReaderBaselineFromDom]);

  const showSaveFeedback = React.useCallback(() => {
    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current);
    }
    setIsSaveFeedbackVisible(true);
    saveFeedbackTimerRef.current = window.setTimeout(() => {
      setIsSaveFeedbackVisible(false);
      saveFeedbackTimerRef.current = null;
    }, 500);
  }, []);

  const handleSaveReaderDraft = React.useCallback(() => {
    const didSave = onSaveReaderDraft();
    if (!didSave) {
      setIsExitConfirmOpen(false);
      return;
    }
    updateReaderBaselineFromDom();
    setIsExitConfirmOpen(false);
    showSaveFeedback();
  }, [onSaveReaderDraft, showSaveFeedback, updateReaderBaselineFromDom]);

  const handleBackRequest = React.useCallback(() => {
    if (!readerRecord || !hasReaderDraftChanges()) {
      onBackToRecords();
      return;
    }
    onCollapseTools();
    setIsExitConfirmOpen(true);
  }, [hasReaderDraftChanges, onBackToRecords, onCollapseTools, readerRecord]);

  const resetReaderDomToSavedRecord = React.useCallback(() => {
    if (!readerRecord) return;
    const baseline = readerBaselineRef.current?.key === readerRecordKey ? readerBaselineRef.current : null;
    if (readerTitleRef.current) {
      readerTitleRef.current.innerHTML = baseline?.titleHtml ?? readerRecord.titleHtml;
    }
    if (readerContentRef.current) {
      readerContentRef.current.innerHTML = baseline?.contentHtml ?? readerRecord.contentHtml;
    }
  }, [readerContentRef, readerRecord, readerRecordKey, readerTitleRef]);

  const handleDiscardAndExit = React.useCallback(() => {
    resetReaderDomToSavedRecord();
    setIsExitConfirmOpen(false);
    onBackToRecords();
  }, [onBackToRecords, resetReaderDomToSavedRecord]);

  return (
    <AnimatePresence>
      {isSignedIn && isOpen && (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          transition={{ duration: 0 }}
          className="absolute inset-0 z-[950] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
        >
          <input
            ref={readerCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onReaderImageInput}
          />
          <input
            ref={readerImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onReaderImageInput}
          />
          <div className={`flex-1 overflow-y-auto px-8 pb-32 ${screenTopPaddingClass}`}>
            <div className="mx-auto w-full max-w-[430px]">
              <div className="mb-12 flex items-start justify-between">
                <button
                  onClick={handleBackRequest}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
                  aria-label={homeCopy.backToRecords}
                >
                  <ChevronsLeft size={30} strokeWidth={iconStrokeWidth} />
                </button>

                {readerRecord && (
                  <div className="flex items-baseline gap-4 pt-3 text-black">
                    <span className="text-[34px] font-extrabold leading-none">
                      {new Date(readerRecord.timestamp).getDate()}
                    </span>
                    <span className="text-[22px] font-semibold leading-none text-black/35">
                      {formatRecordMonth(readerRecord.timestamp)}
                    </span>
                  </div>
                )}
              </div>

              {readerRecord ? (
                <article className="pr-4">
                  <h1
                    ref={readerTitleRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="note-reader-title mb-7 text-[36px] font-medium leading-tight"
                    style={{ color: readerRecord.note.color || '#D2936D' }}
                    onBeforeInput={event => onReaderBeforeInput('title', event)}
                    onKeyDown={event => onReaderKeyDown('title', event)}
                    onInput={onReaderInput}
                    onPaste={event => onReaderPaste('title', event)}
                    onFocus={onSaveReaderSelection}
                    onKeyUp={onSaveReaderSelection}
                    onMouseUp={onSaveReaderSelection}
                    onPointerUp={onSaveReaderSelection}
                    onSelect={onSaveReaderSelection}
                  />
                  <div
                    ref={readerContentRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="note-reader-content pb-10 text-[#7E9FBA]"
                    style={{ fontSize: `${readerRecord.note.fontSize || 20}px` }}
                    onBeforeInput={event => onReaderBeforeInput('content', event)}
                    onKeyDown={event => onReaderKeyDown('content', event)}
                    onInput={onReaderInput}
                    onPaste={event => onReaderPaste('content', event)}
                    onFocus={onSaveReaderSelection}
                    onKeyUp={onSaveReaderSelection}
                    onMouseUp={onSaveReaderSelection}
                    onPointerUp={onSaveReaderSelection}
                    onSelect={onSaveReaderSelection}
                    onClick={onReaderContentClick}
                  />
                </article>
              ) : (
                <div className="pt-20 text-center text-[16px] font-medium text-black/40">
                  {homeCopy.readerMissing}
                </div>
              )}
            </div>
          </div>

          {readerRecord && (
            <div className="absolute bottom-20 right-5 z-[1020] flex flex-col items-center gap-3">
              <AnimatePresence>
                {isReaderToolsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <button className={readerToolButtonClass} onClick={handleSaveReaderDraft} aria-label={homeCopy.readerEdit}>
                      <Save size={24} strokeWidth={iconStrokeWidth} />
                    </button>
                    <div className="relative">
                      <button
                        className={readerToolButtonClass}
                        onPointerDown={event => {
                          onKeepReaderSelectionPointerDown(event);
                          onReaderPanelToggle('font');
                        }}
                        aria-label={homeCopy.readerReadingSize}
                      >
                        <span className="text-[28px] font-semibold leading-none">A</span>
                      </button>
                      {readerActivePanel === 'font' && (
                        <div className="absolute right-[calc(100%+10px)] top-1/2 z-[1030] flex w-[72px] -translate-y-1/2 flex-col gap-1 rounded-[14px] bg-[var(--app-dark)] p-1.5 shadow-xl">
                          {READER_FONT_SIZES.map(size => (
                            <button
                              key={size}
                              onPointerDown={event => {
                                onKeepReaderSelectionPointerDown(event);
                                onReaderFontSize(size);
                              }}
                              className={`h-7 rounded-full text-[12px] font-medium transition-colors ${readerSelectedFontSize === size ? 'bg-white text-black' : 'text-white hover:bg-white/15'}`}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className={`${readerToolButtonClass} ${readerSelectedUnderline ? 'bg-[var(--app-dark)] text-white' : ''}`}
                      onPointerDown={event => {
                        onKeepReaderSelectionPointerDown(event);
                        onReaderUnderline();
                      }}
                      aria-label={homeCopy.readerUnderline}
                    >
                      <Underline size={24} strokeWidth={iconStrokeWidth} />
                    </button>
                    <button className={readerToolButtonClass} onClick={() => readerCameraInputRef.current?.click()} aria-label={homeCopy.readerAddPhoto}>
                      <Camera size={24} strokeWidth={iconStrokeWidth} />
                    </button>
                    <button className={readerToolButtonClass} onClick={() => readerImageInputRef.current?.click()} aria-label={homeCopy.readerJumpImage}>
                      <ImageIcon size={24} strokeWidth={iconStrokeWidth} />
                    </button>
                    <div className="relative">
                      <button
                        className={readerToolButtonClass}
                        onPointerDown={event => {
                          onKeepReaderSelectionPointerDown(event);
                          onReaderPanelToggle('color');
                        }}
                        aria-label={homeCopy.readerEditColor}
                      >
                        <Palette size={24} strokeWidth={iconStrokeWidth} />
                      </button>
                      {readerActivePanel === 'color' && (
                        <div className="absolute right-[calc(100%+10px)] top-1/2 z-[1030] flex -translate-y-1/2 flex-col items-center">
                          <div className="relative box-border w-[124px] rounded-[20px] bg-[var(--app-dark)] p-2.5 shadow-lg">
                            <div className="grid grid-cols-4 gap-2">
                              {READER_TEXT_COLORS.map(color => (
                                <button
                                  key={color}
                                  onPointerDown={event => {
                                    onKeepReaderSelectionPointerDown(event);
                                    onReaderTextColor(color);
                                  }}
                                  className="h-[20px] w-[20px] rounded-full"
                                  style={{
                                    backgroundColor: color,
                                    boxShadow: readerSelectedColor === color ? '0 0 0 1.5px white' : 'none',
                                  }}
                                />
                              ))}
                              <button
                                onPointerDown={event => {
                                  onKeepReaderSelectionPointerDown(event);
                                  onToggleCustomPicker();
                                }}
                                className="relative h-[20px] w-[20px] overflow-hidden rounded-[6px]"
                                style={{ boxShadow: readerShowCustomPicker || !READER_TEXT_COLORS.includes(readerSelectedColor) ? '0 0 0 1.5px white' : 'none' }}
                              >
                                <div className="absolute inset-0 h-full w-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] pointer-events-none" />
                              </button>
                            </div>
                          </div>

                          {readerShowCustomPicker && (
                            <div className="picker-popup absolute left-1/2 top-full z-50 mt-2 flex w-[124px] -translate-x-1/2 flex-col gap-2 rounded-[16px] bg-[var(--app-dark)] p-2.5 shadow-xl">
                              <HexColorPicker color={readerSelectedColor} onChange={onReaderTextColor} />
                              <div className="flex w-full items-center">
                                <span className="mr-1 pt-[1px] font-mono text-[13px] leading-none text-white/70">#</span>
                                <HexColorInput
                                  color={readerSelectedColor}
                                  onChange={onReaderTextColor}
                                  className="h-[22px] min-w-0 flex-1 rounded-[6px] border border-white/20 bg-white/10 px-1.5 font-mono text-[12px] uppercase text-white focus:border-white/50 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button className={readerToolButtonClass} onClick={onCollapseTools} aria-label={homeCopy.readerCollapseTools}>
                      <ChevronUp size={30} strokeWidth={iconStrokeWidth} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {!isReaderToolsOpen && (
                <button className={readerToolButtonClass} onClick={onExpandTools} aria-label={homeCopy.readerExpandTools}>
                  <Menu size={24} strokeWidth={iconStrokeWidth} />
                </button>
              )}

              <button className={readerToolButtonClass} onClick={onLocateReaderRecord} aria-label={homeCopy.readerLocate}>
                <MapPin size={26} strokeWidth={iconStrokeWidth} />
              </button>
            </div>
          )}

          <AnimatePresence>
            {isSaveFeedbackVisible && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                className="app-feedback-toast pointer-events-none fixed left-1/2 bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] z-[1400] max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full px-4 text-center text-[13px] font-medium"
              >
                {readerUiCopy.saved}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isExitConfirmOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[1300] flex items-center justify-center bg-black/35 px-6 backdrop-blur-[2px]"
              >
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  className="w-full max-w-[300px] rounded-[24px] bg-[var(--app-card)] p-5 text-black shadow-xl"
                >
                  <h2 className="text-[20px] font-bold leading-tight">
                    {readerUiCopy.exitTitle}
                  </h2>
                  <p className="mt-2 text-[14px] font-medium leading-relaxed text-black/50">
                    {readerUiCopy.exitBody}
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                      className="h-11 rounded-full bg-[var(--app-dark)] px-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]"
                      onClick={() => setIsExitConfirmOpen(false)}
                    >
                      {readerUiCopy.keepEditing}
                    </button>
                    <button
                      className="h-11 rounded-full bg-[var(--app-soft-surface)] px-3 text-[14px] font-semibold text-black transition-transform active:scale-[0.98]"
                      onClick={handleDiscardAndExit}
                    >
                      {readerUiCopy.discardExit}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
