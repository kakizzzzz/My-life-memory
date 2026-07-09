export const DEFAULT_NAME_PREFIX: Record<'en' | 'zh' | 'ko', string> = {
  en: 'User ',
  zh: '用户',
  ko: '사용자 ',
};

export const LANGUAGE_OPTIONS = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '한국어', value: 'ko' },
];

export const LOGIN_LANGUAGE_LABELS: Record<string, string> = {
  zh: '中',
  en: 'EN',
  ko: '한',
};

export const MULTILINGUAL_FONT_FAMILY = '"Afacad", "Noto Serif SC", "Noto Serif KR", "Songti SC", "Apple SD Gothic Neo", ui-sans-serif, system-ui, sans-serif';

export const LANGUAGE_FONT_FAMILIES: Record<string, string> = {
  en: MULTILINGUAL_FONT_FAMILY,
  zh: MULTILINGUAL_FONT_FAMILY,
  ko: MULTILINGUAL_FONT_FAMILY,
};

export const LANGUAGE_FONT_SCALE: Record<string, number> = {
  en: 1,
  zh: 0.9,
  ko: 0.9,
};

export const LANGUAGE_LOCALES: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
};
