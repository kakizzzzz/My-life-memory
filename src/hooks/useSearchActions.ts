import React from 'react';
import { parseCoordinateSearch } from '../lib/searchUtils';
import type { AppView, HomePanel, SearchField } from '../types/app';

export const useSearchActions = ({
  coordinateSearch,
  textSearch,
  activeView,
  searchReturnView,
  setFlyTarget,
  setActiveView,
  setActiveHomePanel,
  setIsSearchOpen,
  setIsRecordsMenuOpen,
  setIsRecordsCalendarOpen,
  setSelectedRecordsDateKey,
  setActiveSearchField,
  setSearchReturnView,
  setSubmittedTextSearch,
  setIsMenuOpen,
  setIsMapStyleMenuOpen,
  setTagMenuOpen,
}: {
  coordinateSearch: string;
  textSearch: string;
  activeView: AppView;
  searchReturnView: AppView;
  setFlyTarget: React.Dispatch<React.SetStateAction<[number, number] | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setActiveHomePanel: React.Dispatch<React.SetStateAction<HomePanel>>;
  setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRecordsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRecordsCalendarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedRecordsDateKey: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveSearchField: React.Dispatch<React.SetStateAction<SearchField>>;
  setSearchReturnView: React.Dispatch<React.SetStateAction<AppView>>;
  setSubmittedTextSearch: React.Dispatch<React.SetStateAction<string>>;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMapStyleMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTagMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const handleCoordinateSearch = React.useCallback(() => {
    const coordinates = parseCoordinateSearch(coordinateSearch);
    if (!coordinates) return;
    setFlyTarget(coordinates);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsSearchOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
  }, [coordinateSearch, setActiveHomePanel, setActiveView, setFlyTarget, setIsRecordsCalendarOpen, setIsRecordsMenuOpen, setIsSearchOpen]);

  const closeSearchModal = React.useCallback(() => {
    setIsSearchOpen(false);
    setSubmittedTextSearch('');
  }, [setIsSearchOpen, setSubmittedTextSearch]);

  const handleTextSearch = React.useCallback(() => {
    const query = textSearch.trim();
    if (!query) {
      setSubmittedTextSearch('');
      closeSearchModal();
      return;
    }

    if (activeView === 'records') {
      setSelectedRecordsDateKey(null);
    }

    setActiveSearchField('text');
    setSearchReturnView(activeView === 'map' ? 'map' : 'records');
    setSubmittedTextSearch(query);
    setIsSearchOpen(false);
    setActiveHomePanel(null);
    setIsMenuOpen(false);
    setIsMapStyleMenuOpen(false);
    setTagMenuOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setActiveView('searchResults');
  }, [
    activeView,
    closeSearchModal,
    setActiveHomePanel,
    setActiveSearchField,
    setActiveView,
    setIsMapStyleMenuOpen,
    setIsMenuOpen,
    setIsRecordsCalendarOpen,
    setIsRecordsMenuOpen,
    setIsSearchOpen,
    setSearchReturnView,
    setSelectedRecordsDateKey,
    setSubmittedTextSearch,
    setTagMenuOpen,
    textSearch,
  ]);

  const openSearchModal = React.useCallback((field: SearchField = 'text') => {
    setActiveSearchField(field);
    setSubmittedTextSearch('');
    setIsSearchOpen(true);
  }, [setActiveSearchField, setIsSearchOpen, setSubmittedTextSearch]);

  const closeSearchResults = React.useCallback(() => {
    setSubmittedTextSearch('');
    setActiveView(searchReturnView);
  }, [searchReturnView, setActiveView, setSubmittedTextSearch]);

  return {
    handleCoordinateSearch,
    handleTextSearch,
    openSearchModal,
    closeSearchModal,
    closeSearchResults,
  };
};
