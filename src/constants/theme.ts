import type { SystemTheme } from '../types/app';

export const DEFAULT_SYSTEM_THEME: SystemTheme = {
  page: '#F3F3F3',
  card: '#D9D9D9',
  icon: '#C3C3C3',
  dark: '#5C5C5C',
};

export const THEME_PRESETS: { label: Record<string, string>; theme: SystemTheme }[] = [
  { label: { en: 'Original', zh: '初始', ko: '기본' }, theme: DEFAULT_SYSTEM_THEME },
  { label: { en: 'Terracotta', zh: '陶土', ko: '테라코타' }, theme: { page: '#FAF4F0', card: '#E8D7CD', icon: '#B98A78', dark: '#6A5048' } },
  { label: { en: 'Blue', zh: '清蓝', ko: '블루' }, theme: { page: '#F4F8FA', card: '#D7E7EE', icon: '#8AAEBC', dark: '#405D6B' } },
  { label: { en: 'Mauve', zh: '雾紫', ko: '모브' }, theme: { page: '#F8F5F8', card: '#E8DAE8', icon: '#A994AA', dark: '#5D4D62' } },
];

export const THEME_PICKER_COLORS = [
  '#D2936D', '#B6A5B9', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#CBE0E8', '#80AACD', '#D3CCE3', '#F0EBE1', '#28292B'
];

export const READER_TEXT_COLORS = [
  '#D2936D', '#B6A5B9', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#CBE0E8', '#80AACD', '#D3CCE3', '#F0EBE1', '#28292B'
];

export const READER_FONT_SIZES = [12, 14, 16, 18, 22, 26];
