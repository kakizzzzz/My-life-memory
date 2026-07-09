import React from 'react';
import { normalizeAccountId } from '../lib/accountUtils';
import {
  markAutoUserManualSeen,
  readAutoUserManualSeen,
} from '../lib/localPersistence';
import type {
  AppView,
  EditingNoteTarget,
  HomePanel,
  ReadingNoteTarget,
  SystemTheme,
} from '../types/app';

export const useAppViewLifecycle = ({
  isSignedIn,
  activeView,
  setActiveView,
  activeHomePanel,
  setActiveHomePanel,
  profileAccount,
  homeScrollRef,
  resetLocationSession,
  resetTrackDraftCheck,
  setActiveThemeColorKey,
  setShowThemeCustomPicker,
  setIsPasswordChangeOpen,
  setCurrentPasswordInput,
  setNewPasswordInput,
  setConfirmPasswordInput,
  setPasswordChangeStatus,
  setIsMenuOpen,
  setIsMapStyleMenuOpen,
  setTagMenuOpen,
  setIsSearchOpen,
  setIsRecordsMenuOpen,
  setIsRecordsCalendarOpen,
  setReadingNoteTarget,
  setEditingNoteTarget,
  setIsReaderToolsOpen,
  setReaderActivePanel,
  setReaderShowCustomPicker,
}: {
  isSignedIn: boolean;
  activeView: AppView;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  activeHomePanel: HomePanel;
  setActiveHomePanel: React.Dispatch<React.SetStateAction<HomePanel>>;
  profileAccount: string;
  homeScrollRef: React.RefObject<HTMLDivElement | null>;
  resetLocationSession: () => void;
  resetTrackDraftCheck: () => void;
  setActiveThemeColorKey: React.Dispatch<React.SetStateAction<keyof SystemTheme | null>>;
  setShowThemeCustomPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPasswordChangeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  setNewPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  setConfirmPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  setPasswordChangeStatus: React.Dispatch<React.SetStateAction<string>>;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMapStyleMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTagMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRecordsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRecordsCalendarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReadingNoteTarget: React.Dispatch<React.SetStateAction<ReadingNoteTarget | null>>;
  setEditingNoteTarget: React.Dispatch<React.SetStateAction<EditingNoteTarget | null>>;
  setIsReaderToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReaderActivePanel: React.Dispatch<React.SetStateAction<'font' | 'color' | null>>;
  setReaderShowCustomPicker: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const [isAutoUserManualOpen, setIsAutoUserManualOpen] = React.useState(false);
  const autoOpenedManualAccountRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isSignedIn) return;
    const account = normalizeAccountId(profileAccount);
    if (!account || autoOpenedManualAccountRef.current === account) return;

    autoOpenedManualAccountRef.current = account;
    if (readAutoUserManualSeen(account)) return;

    markAutoUserManualSeen(account);
    setIsAutoUserManualOpen(true);
  }, [isSignedIn, profileAccount]);

  React.useEffect(() => {
    if (activeHomePanel !== 'theme') {
      setActiveThemeColorKey(null);
      setShowThemeCustomPicker(false);
    }
    if (activeHomePanel !== 'profile') {
      setIsPasswordChangeOpen(false);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPasswordChangeStatus('');
    }
  }, [
    activeHomePanel,
    setActiveThemeColorKey,
    setConfirmPasswordInput,
    setCurrentPasswordInput,
    setIsPasswordChangeOpen,
    setNewPasswordInput,
    setPasswordChangeStatus,
    setShowThemeCustomPicker,
  ]);

  React.useEffect(() => {
    if (activeView !== 'records') {
      setIsRecordsMenuOpen(false);
      setIsRecordsCalendarOpen(false);
    }
    if (activeView === 'home' || activeView === 'stats' || activeView === 'searchResults') {
      setIsSearchOpen(false);
    }
    if (activeView !== 'reader') {
      setIsReaderToolsOpen(false);
      setReaderActivePanel(null);
      setReaderShowCustomPicker(false);
    }
  }, [
    activeView,
    setIsReaderToolsOpen,
    setIsRecordsCalendarOpen,
    setIsRecordsMenuOpen,
    setIsSearchOpen,
    setReaderActivePanel,
    setReaderShowCustomPicker,
  ]);

  React.useEffect(() => {
    if (isSignedIn) return;
    autoOpenedManualAccountRef.current = null;
    setIsAutoUserManualOpen(false);
    resetLocationSession();
    resetTrackDraftCheck();
    setActiveView('home');
    setActiveHomePanel(null);
    setIsMenuOpen(false);
    setIsMapStyleMenuOpen(false);
    setTagMenuOpen(false);
    setIsSearchOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setReadingNoteTarget(null);
    setEditingNoteTarget(null);
  }, [
    isSignedIn,
    resetLocationSession,
    resetTrackDraftCheck,
    setActiveHomePanel,
    setActiveView,
    setEditingNoteTarget,
    setIsMapStyleMenuOpen,
    setIsMenuOpen,
    setIsRecordsCalendarOpen,
    setIsRecordsMenuOpen,
    setIsSearchOpen,
    setReadingNoteTarget,
    setTagMenuOpen,
  ]);

  const closeHomePanel = React.useCallback(() => {
    if (homeScrollRef.current) {
      homeScrollRef.current.scrollTop = 0;
      homeScrollRef.current.scrollLeft = 0;
    }
    setActiveHomePanel(current => (
      current === 'language' ||
      current === 'permissions' ||
      current === 'manual' ||
      current === 'apiSecurity' ||
      current === 'mcp' ||
      current === 'export'
        ? 'settings'
        : null
    ));
  }, [homeScrollRef, setActiveHomePanel]);

  const closeAutoUserManual = React.useCallback(() => {
    setIsAutoUserManualOpen(false);
  }, []);

  return {
    closeHomePanel,
    closeAutoUserManual,
    isAutoUserManualOpen,
  };
};
