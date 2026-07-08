import type { StoredImageMetadata } from '../lib/mediaStorage';

export type NoteData = {
  id: string;
  title: string;
  titleHtml?: string;
  content: string;
  contentHtml?: string;
  imageUrl?: string;
  imageUrls?: string[];
  images?: StoredImageMetadata[];
  fontSize?: number;
  titleFontSize?: number;
  createdAt?: number;
  updatedAt?: number;
  color?: string;
};

export type StarData = {
  id: string;
  lat: number;
  lng: number;
  createdAt?: number;
  tagOrder?: number;
  tagGroupId?: number;
  color?: string;
  notes?: NoteData[];
};

export type TrackData = {
  id: string;
  paths: [number, number][][];
  color?: string;
  time?: number;
  distance?: number;
};

export type TrackDraftData = {
  paths: [number, number][][];
  time: number;
  savedAt: number;
};

export type MapStyle = 'light' | 'dark' | 'aerial';
export type AppView = 'map' | 'stats' | 'records' | 'home' | 'reader' | 'searchResults';
export type HomePanel = 'profile' | 'theme' | 'gallery' | 'settings' | 'language' | 'permissions' | 'manual' | 'apiSecurity' | 'mcp' | 'export' | null;

export type SystemTheme = {
  page: string;
  card: string;
  icon: string;
  dark: string;
};

export type UserProfile = {
  name: string;
  account: string;
  password: string;
  avatarUrl: string;
  avatarImage?: StoredImageMetadata;
};

export type UploadedImage = {
  id: string;
  src: string;
  title: string;
};

export type PersistedAppState = {
  mapStyle?: MapStyle;
  systemTheme?: Partial<SystemTheme>;
  profile?: Partial<UserProfile>;
  isSignedIn?: boolean;
  language?: string;
  stars?: StarData[];
  savedTracks?: TrackData[];
};
