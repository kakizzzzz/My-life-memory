import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, useMap, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { Menu, Search, Map as MapIcon, PieChart, BookOpen, Home, ChevronDown, ChevronRight, ChevronLeft, ChevronUp, ChevronsLeft, MapPin, Tag, Route, Star, X, Plus, Minus, Pause, Play, Save, Copy, Share, Edit2, Trash2, Eye, Database, Palette, Image as ImageIcon, Settings, UserRound, Lock, AtSign, Languages, Download, CalendarDays, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { StarActionOverlay } from './StarActionOverlay';
import { TrackActionOverlay } from './TrackActionOverlay';
import { NoteEditorModal } from './NoteEditorModal';
import { TripStatisticsView, type MapActivityPoint, type TextRankingItem } from './TripStatisticsView';

const starSvgString = `<svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="overflow: visible; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.15)) drop-shadow(0px 2px 4px rgba(0,0,0,0.12));">
  <defs>
    <linearGradient id="starGradDrag" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
      <stop offset="15%" stop-color="#EDC727" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>
  </defs>
  <polygon points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76" fill="#EDC727" stroke="#EDC727" stroke-width="5.5" stroke-linejoin="round"/>
  <polygon points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76" fill="url(#starGradDrag)" stroke="url(#starGradDrag)" stroke-width="4.5" stroke-linejoin="round"/>
</svg>`;

const starDragImg = new Image();
starDragImg.src = `data:image/svg+xml;utf8,${encodeURIComponent(starSvgString)}`;

function createLocationIcon(mapStyle: string, iconColor = '#c3c3c3', heading = 0) {
  const isAerial = mapStyle === 'aerial';
  const color = isAerial ? '#ffffff' : iconColor;
  const coneRotation = Number.isFinite(heading) ? heading + 90 : 90;
  
  return new L.DivIcon({
    className: '',
    html: `
      <div style="position: relative; width: 80px; height: 80px; pointer-events: none;">
          <svg width="80" height="80" viewBox="0 0 80 80" style="position: absolute; left: 0; top: 0; z-index: 1; transform: rotate(${coneRotation}deg); transform-origin: 40px 40px; transition: transform 160ms linear;">
              <defs>
                  <linearGradient id="coneGrad" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="8" y2="40">
                      <stop offset="0%" stop-color="${color}" stop-opacity="0.85" />
                      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
                  </linearGradient>
              </defs>
              <path d="M 8 27 L 40 40 L 8 53 Z" fill="url(#coneGrad)" />
          </svg>
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: black; border: 5px solid ${color}; border-radius: 50%; z-index: 2; box-sizing: content-box; box-shadow: 0 2px 6px rgba(0,0,0,0.3); pointer-events: none;"></div>
      </div>
    `,
    iconSize: [80, 80],
    iconAnchor: [40, 40]
  });
}

type NoteData = {
  id: string;
  title: string;
  titleHtml?: string;
  content: string;
  contentHtml?: string;
  imageUrl?: string;
  imageUrls?: string[];
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
  tagOrder?: number;
  tagGroupId?: number;
  color?: string;
  notes?: NoteData[];
};

type TrackData = {
  id: string;
  paths: [number, number][][];
  color?: string;
  time?: number;
  distance?: number;
};

type MapStyle = 'light' | 'dark' | 'aerial';
type AppView = 'map' | 'stats' | 'records' | 'home' | 'reader';
type HomePanel = 'profile' | 'theme' | 'gallery' | 'settings' | null;
type RecordsFilter = 'all' | 'monthly' | 'annual';
type SearchField = 'coordinate' | 'text';
type RecordsCalendarMode = 'month' | 'year';

type SystemTheme = {
  page: string;
  card: string;
  icon: string;
  dark: string;
};

type UserProfile = {
  name: string;
  account: string;
  password: string;
  avatarUrl: string;
};

type UploadedImage = {
  id: string;
  src: string;
  title: string;
};

type PersistedAppState = {
  mapStyle?: MapStyle;
  systemTheme?: Partial<SystemTheme>;
  profile?: Partial<UserProfile>;
  isSignedIn?: boolean;
  language?: string;
  stars?: StarData[];
  savedTracks?: TrackData[];
};

type EditingNoteTarget = {
  starId: string;
  noteId?: string;
};

type ReadingNoteTarget = {
  starId: string;
  noteId: string;
};

type DeviceOrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

const DEFAULT_SYSTEM_THEME: SystemTheme = {
  page: '#F3F3F3',
  card: '#D9D9D9',
  icon: '#C3C3C3',
  dark: '#5C5C5C',
};

const DEFAULT_PROFILE: UserProfile = {
  name: 'yujun',
  account: '15466',
  password: '',
  avatarUrl: '',
};

const THEME_PRESETS: { label: Record<string, string>; theme: SystemTheme }[] = [
  { label: { en: 'Original', zh: '初始', ko: '기본' }, theme: DEFAULT_SYSTEM_THEME },
  { label: { en: 'Terracotta', zh: '陶土', ko: '테라코타' }, theme: { page: '#FAF4F0', card: '#E8D7CD', icon: '#C97C64', dark: '#6A5048' } },
  { label: { en: 'Blue', zh: '清蓝', ko: '블루' }, theme: { page: '#F4F8FA', card: '#D7E7EE', icon: '#74A3B7', dark: '#405D6B' } },
  { label: { en: 'Mauve', zh: '雾紫', ko: '모브' }, theme: { page: '#F8F5F8', card: '#E8DAE8', icon: '#B990B5', dark: '#5D4D62' } },
];

const THEME_PICKER_COLORS = [
  '#C97C64', '#B990B5', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#D7E7EE', '#74A3B7', '#E8DAE8', '#FAF4F0', '#28292B'
];

const UPLOAD_IMAGE_MAX_BYTES = 100 * 1024;
const SAMPLE_NOTE_IMAGE_URL = `${import.meta.env.BASE_URL}note-sample.jpg`;
const SAMPLE_NOTE_TEXT = 'Today was simple and quiet. I walked for a while, took one photo, and saved this small note.';

const LANGUAGE_OPTIONS = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '한국어', value: 'ko' },
];

const LANGUAGE_FONT_FAMILIES: Record<string, string> = {
  en: '"Afacad", ui-sans-serif, system-ui, sans-serif',
  zh: '"Noto Serif SC", "Songti SC", serif',
  ko: '"Noto Serif KR", serif',
};

const LANGUAGE_FONT_SCALE: Record<string, number> = {
  en: 1,
  zh: 0.9,
  ko: 0.9,
};

const LANGUAGE_LOCALES: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
};

const HOME_SETTINGS_ICON_SIZE = 24;
const HOME_SETTINGS_ICON_STROKE = 2;
const DEFAULT_RECORD_STAR_ID = 'default-record-star';
const DEFAULT_USER_LOCATION: [number, number] = [31.2304, 121.4737];
const DEFAULT_RECORD_STAR_LOCATION: [number, number] = [31.2312, 121.4744];
const LEGACY_RECORD_STAR_LOCATION: [number, number] = [36.36705, 127.34425];
const APP_STORAGE_KEY = 'campus-map-app-state-v1';
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 15000,
};

const createDefaultRecordStar = (): StarData => {
  const timestamp = Date.now();
  return {
    id: DEFAULT_RECORD_STAR_ID,
    lat: DEFAULT_RECORD_STAR_LOCATION[0],
    lng: DEFAULT_RECORD_STAR_LOCATION[1],
    color: '#EDC727',
    notes: [{
      id: 'default-record-note',
      title: 'Today Note',
      titleHtml: 'Today Note',
      content: SAMPLE_NOTE_TEXT,
      contentHtml: [
        `<p>${SAMPLE_NOTE_TEXT}</p>`,
        '<figure class="note-inline-image" contenteditable="false" data-note-image="true">',
        `<img src="${SAMPLE_NOTE_IMAGE_URL}" alt="Note attachment" />`,
        '<button type="button" data-remove-image="true" aria-label="Remove image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>',
        '<button type="button" data-preview-image="true" aria-label="View larger image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></button>',
        '</figure>',
        '<p data-note-tail="true"></p>',
      ].join(''),
      imageUrl: undefined,
      imageUrls: undefined,
      fontSize: 18,
      titleFontSize: 18,
      createdAt: timestamp,
      updatedAt: timestamp,
      color: '#D2936D',
    }],
  };
};

const isMapStyle = (value: unknown): value is MapStyle => (
  value === 'light' || value === 'dark' || value === 'aerial'
);

const isLanguage = (value: unknown): value is string => (
  typeof value === 'string' && LANGUAGE_OPTIONS.some(option => option.value === value)
);

const hasLoginAccount = (profile: UserProfile) => (
  profile.account.trim().length > 0
);

const readPersistedAppState = (): PersistedAppState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as PersistedAppState : null;
  } catch {
    return null;
  }
};

const writePersistedAppState = (state: PersistedAppState) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can fail when image-heavy notes exceed the browser quota.
  }
};

const canUseBrowserGeolocation = () => (
  typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
);

const getCompassHeading = (event: DeviceOrientationEventWithCompass) => {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return (event.webkitCompassHeading + 360) % 360;
  }

  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return (360 - event.alpha + 360) % 360;
  }

  return null;
};

const getBearingBetweenPoints = (from: [number, number], to: [number, number]) => {
  const fromLat = from[0] * Math.PI / 180;
  const toLat = to[0] * Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const getNearbyDefaultStarLocation = (point: [number, number]): [number, number] => {
  const northMeters = 80;
  const eastMeters = 80;
  const latDelta = northMeters / 111320;
  const lngDelta = eastMeters / (111320 * Math.max(0.01, Math.cos(point[0] * Math.PI / 180)));
  return [point[0] + latDelta, point[1] + lngDelta];
};

const isNearCoordinate = (lat: number, lng: number, target: [number, number], tolerance = 0.002) => (
  Math.abs(lat - target[0]) <= tolerance && Math.abs(lng - target[1]) <= tolerance
);

const normalizeInitialStars = (stars?: StarData[]) => {
  if (!Array.isArray(stars) || stars.length === 0) return null;

  return stars.map(star => (
    star.id === DEFAULT_RECORD_STAR_ID && isNearCoordinate(star.lat, star.lng, LEGACY_RECORD_STAR_LOCATION)
      ? { ...star, lat: DEFAULT_RECORD_STAR_LOCATION[0], lng: DEFAULT_RECORD_STAR_LOCATION[1] }
      : star
  ));
};

const HOME_COPY = {
  en: {
    modify: 'Modify information',
    theme: 'change theme',
    gallery: 'image gallery',
    settings: 'Settings',
    uploadAvatar: 'Upload avatar',
    back: 'Back',
    userName: 'User name',
    account: 'Account',
    loginPassword: 'Login password',
    accountAccess: 'Account access',
    loginTitle: 'Account login',
    loginHint: 'Sign in to enter',
    login: 'Log in',
    loginError: 'Account or password is incorrect',
    noImages: 'No uploaded images yet',
    language: 'Language',
    exit: 'Exit Account',
    base: 'Page background',
    card: 'Cards & panels',
    icon: 'Buttons & icons',
    dark: 'Selected accent',
    recordsTitle: 'My records',
    recordsMenu: 'Records menu',
    allRecords: 'All',
    monthlyRecords: 'Monthly',
    annualRecords: 'Annual',
    noRecords: 'No note records yet',
    calendar: 'Calendar',
    closeCalendar: 'Close calendar',
    previousCalendarPage: 'Previous calendar page',
    nextCalendarPage: 'Next calendar page',
    weekdays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    search: 'Search',
    searchRecords: 'Search records',
    searchPlaceholder: 'Quickly search for places and text...',
    runSearch: 'Run search',
    backToRecords: 'Back to records',
    readerMissing: 'This record is no longer available',
    readerEdit: 'Edit record',
    readerReadingSize: 'Change reading size',
    readerAddPhoto: 'Add photo',
    readerJumpImage: 'Jump to image',
    readerEditColor: 'Edit color',
    readerCollapseTools: 'Collapse reading tools',
    readerExpandTools: 'Expand reading tools',
    readerLocate: 'Locate record on map',
    bottomMap: 'Map',
    bottomStats: 'Stats',
    bottomNotes: 'Notes',
    bottomHome: 'Home',
    untitledNote: 'Untitled note',
    noteLabel: 'Note',
    starLabel: 'Star',
    noteImageAlt: 'Note attachment',
    userFallback: 'User',
    userAvatarAlt: 'User avatar',
    currentMapStyleAlt: 'Current map style',
    aerialMapAlt: 'Aerial',
    darkMapAlt: 'Dark',
    lightMapAlt: 'Light',
    closeImagePreview: 'Close image preview',
    downloadImage: 'Download image',
  },
  zh: {
    modify: '修改信息',
    theme: '更换主题',
    gallery: '图片仓库',
    settings: '设置',
    uploadAvatar: '上传头像',
    back: '返回',
    userName: '用户姓名',
    account: '账号',
    loginPassword: '登录密码',
    accountAccess: '账号访问',
    loginTitle: '账号登录',
    loginHint: '登录后进入',
    login: '登录',
    loginError: '账号或密码不正确',
    noImages: '还没有上传过图片',
    language: '语言',
    exit: '退出账号',
    base: '页面背景',
    card: '内容卡片',
    icon: '按钮图标',
    dark: '选中强调',
    recordsTitle: '我的记录',
    recordsMenu: '记录菜单',
    allRecords: '全部',
    monthlyRecords: '本月',
    annualRecords: '本年',
    noRecords: '还没有笔记记录',
    calendar: '日历',
    closeCalendar: '关闭日历',
    previousCalendarPage: '上一页日历',
    nextCalendarPage: '下一页日历',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    search: '搜索',
    searchRecords: '搜索记录',
    searchPlaceholder: '快速搜索地点和文本...',
    runSearch: '执行搜索',
    backToRecords: '返回记录',
    readerMissing: '这条记录已不可用',
    readerEdit: '编辑记录',
    readerReadingSize: '调整阅读字号',
    readerAddPhoto: '添加照片',
    readerJumpImage: '跳转到图片',
    readerEditColor: '编辑颜色',
    readerCollapseTools: '收起阅读工具',
    readerExpandTools: '展开阅读工具',
    readerLocate: '定位到地图记录',
    bottomMap: '地图',
    bottomStats: '统计',
    bottomNotes: '记录',
    bottomHome: '主页',
    untitledNote: '未命名笔记',
    noteLabel: '笔记',
    starLabel: '星标',
    noteImageAlt: '笔记图片',
    userFallback: '用户',
    userAvatarAlt: '用户头像',
    currentMapStyleAlt: '当前地图样式',
    aerialMapAlt: '卫星地图',
    darkMapAlt: '深色地图',
    lightMapAlt: '浅色地图',
    closeImagePreview: '关闭图片预览',
    downloadImage: '下载图片',
  },
  ko: {
    modify: '정보 수정',
    theme: '테마 변경',
    gallery: '이미지 갤러리',
    settings: '설정',
    uploadAvatar: '아바타 업로드',
    back: '뒤로',
    userName: '사용자 이름',
    account: '계정',
    loginPassword: '로그인 비밀번호',
    accountAccess: '계정 접근',
    loginTitle: '계정 로그인',
    loginHint: '로그인 후 입장',
    login: '로그인',
    loginError: '계정 또는 비밀번호가 올바르지 않습니다',
    noImages: '업로드한 이미지가 없습니다',
    language: '언어',
    exit: '로그아웃',
    base: '화면 배경',
    card: '카드/패널',
    icon: '버튼/아이콘',
    dark: '선택 강조',
    recordsTitle: '내 기록',
    recordsMenu: '기록 메뉴',
    allRecords: '전체',
    monthlyRecords: '이번 달',
    annualRecords: '올해',
    noRecords: '아직 노트 기록이 없습니다',
    calendar: '캘린더',
    closeCalendar: '캘린더 닫기',
    previousCalendarPage: '이전 캘린더 페이지',
    nextCalendarPage: '다음 캘린더 페이지',
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
    search: '검색',
    searchRecords: '기록 검색',
    searchPlaceholder: '장소와 텍스트를 빠르게 검색...',
    runSearch: '검색 실행',
    backToRecords: '기록으로 돌아가기',
    readerMissing: '이 기록은 더 이상 사용할 수 없습니다',
    readerEdit: '기록 편집',
    readerReadingSize: '읽기 글자 크기 변경',
    readerAddPhoto: '사진 추가',
    readerJumpImage: '이미지로 이동',
    readerEditColor: '색상 편집',
    readerCollapseTools: '읽기 도구 접기',
    readerExpandTools: '읽기 도구 펼치기',
    readerLocate: '지도에서 기록 위치 찾기',
    bottomMap: '지도',
    bottomStats: '통계',
    bottomNotes: '기록',
    bottomHome: '홈',
    untitledNote: '제목 없는 노트',
    noteLabel: '노트',
    starLabel: '별표',
    noteImageAlt: '노트 이미지',
    userFallback: '사용자',
    userAvatarAlt: '사용자 아바타',
    currentMapStyleAlt: '현재 지도 스타일',
    aerialMapAlt: '위성 지도',
    darkMapAlt: '어두운 지도',
    lightMapAlt: '밝은 지도',
    closeImagePreview: '이미지 미리보기 닫기',
    downloadImage: '이미지 다운로드',
  },
};

const canvasToImageBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number) => (
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not compress image.'));
    }, mimeType, quality);
  })
);

const imageBlobToDataUrl = (blob: Blob) => (
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  })
);

const loadImageFile = (file: File) => (
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image.'));
    };
    image.src = objectUrl;
  })
);

const compressImageFileToDataUrl = async (file: File) => {
  const image = await loadImageFile(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  const maxDimension = 900;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  let quality = 0.8;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToImageBlob(canvas, 'image/jpeg', quality);
    lastBlob = blob;
    if (blob.size <= UPLOAD_IMAGE_MAX_BYTES) return imageBlobToDataUrl(blob);

    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.12);
    } else {
      width = Math.max(220, Math.round(width * 0.84));
      height = Math.max(220, Math.round(height * 0.84));
      quality = 0.72;
    }
  }

  if (!lastBlob) throw new Error('Could not compress image.');
  return imageBlobToDataUrl(lastBlob);
};

const extractImagesFromHtml = (html?: string) => {
  if (!html || typeof document === 'undefined') return [];
  const container = document.createElement('div');
  container.innerHTML = html;
  return Array.from(container.querySelectorAll('img'))
    .map(image => image.getAttribute('src'))
    .filter((src): src is string => Boolean(src));
};

const htmlToText = (html?: string) => {
  if (!html || typeof document === 'undefined') return '';
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent || '').replace(/\s+/g, ' ').trim();
};

const escapeHtml = (value: string) => (
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
);

const textToParagraphHtml = (content: string) => (
  content
    .split(/\n\s*\n/)
    .filter(block => block.trim().length > 0)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
);

const getLegacyNoteImages = (note?: NoteData) => {
  const imageUrls = Array.isArray(note?.imageUrls) ? note.imageUrls : [];
  const legacyImageUrl = note?.imageUrl && !imageUrls.includes(note.imageUrl) ? [note.imageUrl] : [];
  return [...imageUrls, ...legacyImageUrl];
};

const imageToReaderHtml = (src: string, altText = 'Note attachment') => (
  `<figure class="note-inline-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}" /></figure>`
);

const cleanReaderHtml = (html: string, imageAltText?: string) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container
    .querySelectorAll('[data-remove-image="true"], [data-preview-image="true"], button')
    .forEach(element => element.remove());
  container.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
  container.querySelectorAll('[data-note-tail="true"]').forEach(element => {
    if (!element.textContent?.trim() && !element.querySelector('img')) element.remove();
  });
  if (imageAltText) {
    container.querySelectorAll<HTMLImageElement>('img').forEach(image => {
      image.alt = imageAltText;
    });
  }
  return container.innerHTML;
};

const getReadableNoteHtml = (note?: NoteData, imageAltText = 'Note attachment') => {
  if (!note) return '';
  const legacyImages = getLegacyNoteImages(note);
  const legacyImageHtml = legacyImages.map(src => imageToReaderHtml(src, imageAltText)).join('');
  const html = note.contentHtml ?? `${textToParagraphHtml(note.content || '')}${legacyImageHtml}`;
  return cleanReaderHtml(html, imageAltText);
};

const getReadableTitleHtml = (note?: NoteData, fallbackTitle = 'Untitled note') => (
  cleanReaderHtml(note?.titleHtml || escapeHtml(note?.title || fallbackTitle))
);

const parseCoordinateSearch = (value: string): [number, number] | null => {
  const match = value.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
};

const getNoteTimestamp = (note: NoteData) => {
  const candidate = note.updatedAt || note.createdAt || Number(note.id);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : Date.now();
};

const formatRecordTime = (timestamp: number, locale = 'en-US') => (
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
);

const formatRecordMonth = (timestamp: number) => (
  `${new Date(timestamp).getFullYear()}/${String(new Date(timestamp).getMonth() + 1).padStart(2, '0')}`
);

const getCalendarDateKey = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const dateFromCalendarDateKey = (dateKey: string | null) => {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  return getCalendarDateKey(date) === dateKey ? date : null;
};

const getMonthTitle = (date: Date, locale = 'en-US') => (
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
);

const addMonths = (date: Date, amount: number) => (
  new Date(date.getFullYear(), date.getMonth() + amount, 1)
);

function getPointsEveryXMeters(path: [number, number][], intervalMeters: number) {
  const points: [number, number][] = [];
  if (path.length === 0) return points;
  
  points.push(path[0]);
  
  let currentDistance = 0;
  let nextDistance = intervalMeters;
  for (let i = 1; i < path.length; i++) {
    const p1 = L.latLng(path[i-1]);
    const p2 = L.latLng(path[i]);
    const dist = p1.distanceTo(p2);
    
    while (currentDistance + dist >= nextDistance) {
      const fraction = (nextDistance - currentDistance) / dist;
      const lat = p1.lat + (p2.lat - p1.lat) * fraction;
      const lng = p1.lng + (p2.lng - p1.lng) * fraction;
      points.push([lat, lng] as [number, number]);
      nextDistance += intervalMeters;
    }
    currentDistance += dist;
  }
  
  if (path.length > 1 && points.length > 0 && 
      (points[points.length-1][0] !== path[path.length-1][0] || 
       points[points.length-1][1] !== path[path.length-1][1])) {
    points.push(path[path.length-1]);
  }
  
  return points;
}

const hasMeaningfulNoteContent = (note: NoteData) => {
  const title = (htmlToText(note.titleHtml) || note.title || '').trim();
  const content = (htmlToText(note.contentHtml) || note.content || '').trim();
  const images = [
    ...extractImagesFromHtml(note.contentHtml),
    ...(Array.isArray(note.imageUrls) ? note.imageUrls : []),
    ...(note.imageUrl ? [note.imageUrl] : []),
  ];

  return Boolean(
    content ||
    images.length > 0 ||
    (title && title !== 'New Note' && title !== 'Untitled note')
  );
};

function FlyToTarget({ target }: { target: [number, number] | null }) {
  const map = useMap();
  
  useEffect(() => {
    if (target) {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      const currentCenter = map.getCenter();
      const targetLatLng = L.latLng(target);
      const distance = currentCenter.distanceTo(targetLatLng);
      
      // If we are already close, just pan smoothly to avoid zoom bouncing
      if (distance < 200 && map.getZoom() === 16) {
        map.panTo(target, { animate: true, duration: 0.5 });
      } else {
        map.flyTo(target, 16, { animate: true, duration: 1.2 });
      }
    }
  }, [target, map]);
  
  return null;
}

function FollowUserLocation({ location, enabled }: { location: [number, number]; enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    map.invalidateSize({ pan: false, debounceMoveend: true });
    const target = L.latLng(location);
    const distance = map.getCenter().distanceTo(target);
    if (distance < 2) return;
    map.panTo(location, { animate: true, duration: 0.45 });
  }, [enabled, location, map]);

  return null;
}

function MapViewportSync({ location, shouldFollow }: { location: [number, number]; shouldFollow: boolean }) {
  const map = useMap();
  const locationRef = React.useRef(location);
  const shouldFollowRef = React.useRef(shouldFollow);

  useEffect(() => {
    locationRef.current = location;
    shouldFollowRef.current = shouldFollow;
  }, [location, shouldFollow]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const recenterIfNeeded = () => {
      if (!shouldFollowRef.current) return;
      map.panTo(locationRef.current, { animate: false });
    };

    const syncMapSize = () => {
      const run = () => {
        map.invalidateSize({ pan: false, debounceMoveend: true });
        recenterIfNeeded();
      };

      frameIds.push(window.requestAnimationFrame(run));
    };

    const scheduleViewportSync = () => {
      syncMapSize();
      [120, 360, 900].forEach(delay => {
        timeoutIds.push(window.setTimeout(syncMapSize, delay));
      });
    };

    scheduleViewportSync();

    window.addEventListener('resize', scheduleViewportSync);
    window.addEventListener('orientationchange', scheduleViewportSync);
    window.addEventListener('pageshow', scheduleViewportSync);
    window.visualViewport?.addEventListener('resize', scheduleViewportSync);
    window.visualViewport?.addEventListener('scroll', scheduleViewportSync);

    return () => {
      frameIds.forEach(frameId => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId));
      window.removeEventListener('resize', scheduleViewportSync);
      window.removeEventListener('orientationchange', scheduleViewportSync);
      window.removeEventListener('pageshow', scheduleViewportSync);
      window.visualViewport?.removeEventListener('resize', scheduleViewportSync);
      window.visualViewport?.removeEventListener('scroll', scheduleViewportSync);
    };
  }, [map]);

  useEffect(() => {
    map.invalidateSize({ pan: false, debounceMoveend: true });
    if (shouldFollow) {
      map.panTo(location, { animate: true, duration: 0.35 });
    }
  }, [location, map, shouldFollow]);

  return null;
}

function StarNavigationOverlay({ activeTag, stars, onPrev, onNext }: { activeTag: { order: number, groupId: number } | null, stars: StarData[], onPrev: () => void, onNext: () => void }) {
  const map = useMap();
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  }, [activeTag]);

  useEffect(() => {
    if (!activeTag) return;
    const star = stars.find(s => s.tagOrder === activeTag.order && s.tagGroupId === activeTag.groupId);
    if (!star) return;

    const updatePos = () => {
      const pt = map.latLngToLayerPoint([star.lat, star.lng]);
      setPos({ x: pt.x, y: pt.y });
    };

    updatePos();
    map.on('zoom', updatePos);
    map.on('viewreset', updatePos);
    return () => {
      map.off('zoom', updatePos);
      map.off('viewreset', updatePos);
    };
  }, [map, activeTag, stars]);

  if (!activeTag || !stars.find(s => s.tagOrder === activeTag.order && s.tagGroupId === activeTag.groupId)) return null;

  return createPortal(
    <div ref={containerRef} style={{ position: 'absolute', top: pos.y - 45, left: pos.x, transform: 'translate(-50%, -50%)', zIndex: 1000, display: 'flex', gap: '8px', pointerEvents: 'auto' }}>
      <button 
        onClick={(e) => { e.stopPropagation(); onPrev(); }} 
        className="w-10 h-10 rounded-full bg-[var(--app-active-surface)] border-2 border-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 shadow-md transition-transform active:scale-95"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="11 17 6 12 11 7"></polyline>
          <polyline points="18 17 13 12 18 7"></polyline>
        </svg>
      </button>
      <button 
        onClick={(e) => { e.stopPropagation(); onNext(); }} 
        className="w-10 h-10 rounded-full bg-[var(--app-active-surface)] border-2 border-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 shadow-md transition-transform active:scale-95"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="13 17 18 12 13 7"></polyline>
          <polyline points="6 17 11 12 6 7"></polyline>
        </svg>
      </button>
    </div>,
    map.getPanes().popupPane
  );
}

function createStarIcon(tagNumber?: number, isSelected?: boolean, colorHex?: string, isAerial?: boolean, badgeColor = '#c3c3c3') {
  const color = colorHex || '#EDC727';
  const badgeBg = isAerial ? '#ffffff' : badgeColor;

  const badgeHtml = tagNumber ? `
    <div style="position:absolute; bottom:-2px; right:-2px; background:${badgeBg}; color:black; font-weight:700; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px; font-family:Afacad, sans-serif; z-index:9999; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
      ${tagNumber}
    </div>
  ` : '';

  const strokeColor = isSelected ? '#000000' : color;
  const gradientId = `starGrad_${color.replace('#','')}${isSelected ? 'Selected' : ''}`;

  return new L.DivIcon({
    className: '',
    html: `
      <div style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.15)) drop-shadow(0px 2px 4px rgba(0,0,0,0.12)); position: relative;">
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="overflow: visible; ${isSelected ? 'z-index: 10;' : ''}">
          <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="15%" stop-color="${color}" />
              <stop offset="100%" stop-color="#ffffff" />
            </linearGradient>
          </defs>
          <polygon 
            points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76" 
            fill="${strokeColor}" 
            stroke="${strokeColor}" 
            stroke-width="5.5" 
            stroke-linejoin="round"
          />
          <polygon 
            points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76" 
            fill="url(#${gradientId})" 
            stroke="url(#${gradientId})" 
            stroke-width="4.5" 
            stroke-linejoin="round"
          />
        </svg>
        ${badgeHtml}
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function MapEventHandlers({ onDrop, onMapClick }: { onDrop: (e: DragEvent, map: L.Map) => void, onMapClick: () => void }) {
  const map = useMap();
  
  const clickRef = React.useRef(onMapClick);
  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    const container = map.getContainer();
    
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault(); // allow drop
    };
    
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      onDrop(e, map);
    };
    
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    
    const handleClick = () => {
      if (clickRef.current) clickRef.current();
    };
    map.on('click', handleClick);

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      map.off('click', handleClick);
    };
  }, [map, onDrop]);
  return null;
}

export default function App() {
  const [persistedAppState] = useState<PersistedAppState | null>(() => readPersistedAppState());
  const initialProfile: UserProfile = {
    ...DEFAULT_PROFILE,
    ...(persistedAppState?.profile || {}),
  };
  const initialSignedIn = persistedAppState?.isSignedIn === true && hasLoginAccount(initialProfile);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => (
    isMapStyle(persistedAppState?.mapStyle) ? persistedAppState.mapStyle : 'light'
  ));
  const [isMapStyleMenuOpen, setIsMapStyleMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => initialSignedIn ? 'map' : 'home');
  const [activeHomePanel, setActiveHomePanel] = useState<HomePanel>(null);
  const [recordsFilter, setRecordsFilter] = useState<RecordsFilter>('all');
  const [selectedRecordsDateKey, setSelectedRecordsDateKey] = useState<string | null>(null);
  const [isRecordsMenuOpen, setIsRecordsMenuOpen] = useState(false);
  const [isRecordsCalendarOpen, setIsRecordsCalendarOpen] = useState(false);
  const [recordsCalendarDate, setRecordsCalendarDate] = useState(new Date());
  const [recordsCalendarMode, setRecordsCalendarMode] = useState<RecordsCalendarMode>('month');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<SearchField>('text');
  const [coordinateSearch, setCoordinateSearch] = useState('');
  const [textSearch, setTextSearch] = useState('');
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() => ({
    ...DEFAULT_SYSTEM_THEME,
    ...(persistedAppState?.systemTheme || {}),
  }));
  const [activeThemeColorKey, setActiveThemeColorKey] = useState<keyof SystemTheme | null>(null);
  const [showThemeCustomPicker, setShowThemeCustomPicker] = useState(false);
  const [galleryPreviewImage, setGalleryPreviewImage] = useState<UploadedImage | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => initialProfile);
  const [isSignedIn, setIsSignedIn] = useState(initialSignedIn);
  const [loginAccount, setLoginAccount] = useState(() => initialProfile.account);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [language, setLanguage] = useState(() => (
    isLanguage(persistedAppState?.language) ? persistedAppState.language : 'en'
  ));
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  const position: [number, number] = DEFAULT_USER_LOCATION;
  
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_USER_LOCATION);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [isFollowingUserLocation, setIsFollowingUserLocation] = useState(false);
  const [stars, setStars] = useState<StarData[]>(() => (
    normalizeInitialStars(persistedAppState?.stars) || [createDefaultRecordStar()]
  ));
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [editingNoteTarget, setEditingNoteTarget] = useState<EditingNoteTarget | null>(null);
  const [readingNoteTarget, setReadingNoteTarget] = useState<ReadingNoteTarget | null>(null);
  const [isReaderToolsOpen, setIsReaderToolsOpen] = useState(false);
  const [readerFontScaleIndex, setReaderFontScaleIndex] = useState(1);
  const readerContentRef = React.useRef<HTMLDivElement>(null);
  
  // Tag Mode State
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagMode, setTagMode] = useState<'none' | 'add' | 'remove'>('none');
  const [activeTag, setActiveTag] = useState<{ order: number, groupId: number } | null>(null);
  const [currentTagGroupId, setCurrentTagGroupId] = useState<number>(0);

  // Tracking Mode State
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trackPaths, setTrackPaths] = useState<[number, number][][]>([]);
  const [trackTime, setTrackTime] = useState(0);
  const [savedTracks, setSavedTracks] = useState<TrackData[]>(() => (
    Array.isArray(persistedAppState?.savedTracks) ? persistedAppState.savedTracks : []
  ));
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedTrackLatLng, setSelectedTrackLatLng] = useState<[number, number] | null>(null);

  const isLocating = React.useRef(false);
  const gpsWatchIdRef = React.useRef<number | null>(null);
  const headingWatchCleanupRef = React.useRef<(() => void) | null>(null);
  const lastGpsLocationRef = React.useRef<[number, number] | null>(null);
  const lastCompassHeadingAtRef = React.useRef(0);
  const isRequestingHeadingPermissionRef = React.useRef(false);
  const hasRequestedInitialLocationRef = React.useRef(false);
  const hasRequestedFirstInteractionLocationRef = React.useRef(false);
  const hasRequestedFirstInteractionHeadingRef = React.useRef(false);
  const hasSyncedDefaultStarToGpsRef = React.useRef(false);

  const trackingStateRef = React.useRef({ isTracking, isPaused });
  useEffect(() => {
    trackingStateRef.current = { isTracking, isPaused };
  }, [isTracking, isPaused]);

  const appendTrackPoint = React.useCallback((newLoc: [number, number]) => {
    setTrackPaths(prev => {
      if (prev.length === 0) return [[newLoc]];

      const newPaths = [...prev];
      const lastIndex = newPaths.length - 1;
      const currentSegment = [...newPaths[lastIndex]];
      const lastPoint = currentSegment[currentSegment.length - 1];

      if (lastPoint && L.latLng(lastPoint).distanceTo(L.latLng(newLoc)) < 1) {
        return prev;
      }

      currentSegment.push(newLoc);
      newPaths[lastIndex] = currentSegment;
      return newPaths;
    });
  }, []);

  const syncDefaultStarNearUser = React.useCallback((newLoc: [number, number]) => {
    if (hasSyncedDefaultStarToGpsRef.current) return;
    hasSyncedDefaultStarToGpsRef.current = true;

    setStars(prev => {
      let changed = false;
      const next = prev.map(star => {
        if (star.id !== DEFAULT_RECORD_STAR_ID) return star;

        const isUntouchedDefault =
          isNearCoordinate(star.lat, star.lng, DEFAULT_RECORD_STAR_LOCATION) ||
          isNearCoordinate(star.lat, star.lng, LEGACY_RECORD_STAR_LOCATION);

        if (!isUntouchedDefault) return star;

        changed = true;
        const [lat, lng] = getNearbyDefaultStarLocation(newLoc);
        return { ...star, lat, lng };
      });

      return changed ? next : prev;
    });
  }, []);

  const applyLocationPoint = React.useCallback((newLoc: [number, number], shouldFly = false, heading?: number | null) => {
    const previousLoc = lastGpsLocationRef.current;
    const hasRecentCompassHeading = Date.now() - lastCompassHeadingAtRef.current < 2500;
    setUserLocation(newLoc);
    if (!hasRecentCompassHeading && typeof heading === 'number' && Number.isFinite(heading)) {
      setDeviceHeading((heading + 360) % 360);
    } else if (!hasRecentCompassHeading && previousLoc && L.latLng(previousLoc).distanceTo(L.latLng(newLoc)) >= 1) {
      setDeviceHeading(getBearingBetweenPoints(previousLoc, newLoc));
    }
    lastGpsLocationRef.current = newLoc;
    if (shouldFly) setFlyTarget(newLoc);

    if (trackingStateRef.current.isTracking && !trackingStateRef.current.isPaused) {
      appendTrackPoint(newLoc);
    }
  }, [appendTrackPoint]);

  const applyGpsPosition = React.useCallback((position: GeolocationPosition, shouldFly = false) => {
    const newLoc: [number, number] = [position.coords.latitude, position.coords.longitude];
    const gpsHeading = (
      typeof position.coords.heading === 'number' &&
      Number.isFinite(position.coords.heading) &&
      typeof position.coords.speed === 'number' &&
      position.coords.speed > 0.5
    ) ? position.coords.heading : null;
    syncDefaultStarNearUser(newLoc);
    applyLocationPoint(
      newLoc,
      shouldFly,
      gpsHeading
    );
  }, [applyLocationPoint, syncDefaultStarNearUser]);

  const stopGpsWatch = React.useCallback(() => {
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = null;
  }, []);

  const stopHeadingWatch = React.useCallback(() => {
    headingWatchCleanupRef.current?.();
    headingWatchCleanupRef.current = null;
  }, []);

  const startHeadingWatch = React.useCallback(async (requestPermission = true) => {
    if (headingWatchCleanupRef.current || typeof window === 'undefined') return;
    if (isRequestingHeadingPermissionRef.current) return;

    const orientationEvent = window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission | undefined;
    if (!orientationEvent) return;

    isRequestingHeadingPermissionRef.current = true;
    try {
      if (typeof orientationEvent.requestPermission === 'function') {
        if (!requestPermission) return;
        const permission = await orientationEvent.requestPermission(true);
        if (permission !== 'granted') return;
      }
    } catch {
      return;
    } finally {
      isRequestingHeadingPermissionRef.current = false;
    }

    const handleOrientation = (event: Event) => {
      const heading = getCompassHeading(event as DeviceOrientationEventWithCompass);
      if (heading !== null) {
        lastCompassHeadingAtRef.current = Date.now();
        setDeviceHeading(heading);
      }
    };

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    headingWatchCleanupRef.current = () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  const requestUserLocation = React.useCallback((shouldFly = false) => {
    if (!canUseBrowserGeolocation()) {
      if (shouldFly) setFlyTarget([userLocation[0], userLocation[1]]);
      return false;
    }

    setIsFollowingUserLocation(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        applyGpsPosition(position, shouldFly);
        isLocating.current = false;
      },
      error => {
        if (shouldFly) setFlyTarget([userLocation[0], userLocation[1]]);
        if (error.code === error.PERMISSION_DENIED && !trackingStateRef.current.isTracking) {
          setIsFollowingUserLocation(false);
        }
        isLocating.current = false;
      },
      GEOLOCATION_OPTIONS
    );
    return true;
  }, [applyGpsPosition, userLocation]);

  useEffect(() => {
    if (activeHomePanel !== 'theme') {
      setActiveThemeColorKey(null);
      setShowThemeCustomPicker(false);
    }
  }, [activeHomePanel]);

  useEffect(() => {
    if (activeView !== 'records') {
      setIsRecordsMenuOpen(false);
      setIsRecordsCalendarOpen(false);
    }
    if (activeView === 'home' || activeView === 'stats') {
      setIsSearchOpen(false);
    }
    if (activeView !== 'reader') {
      setIsReaderToolsOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (isSignedIn) return;
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
  }, [isSignedIn]);

  useEffect(() => {
    void startHeadingWatch(false);
  }, [startHeadingWatch]);

  useEffect(() => {
    if (hasRequestedInitialLocationRef.current) return;
    hasRequestedInitialLocationRef.current = true;
    requestUserLocation(true);
  }, [requestUserLocation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasRequestedFirstInteractionHeadingRef.current && hasRequestedFirstInteractionLocationRef.current) return;

    const requestLiveSensors = () => {
      if (!hasRequestedFirstInteractionHeadingRef.current) {
        hasRequestedFirstInteractionHeadingRef.current = true;
        void startHeadingWatch(true);
      }

      if (!hasRequestedFirstInteractionLocationRef.current) {
        hasRequestedFirstInteractionLocationRef.current = true;
        requestUserLocation(true);
      }
    };

    window.addEventListener('pointerdown', requestLiveSensors, { once: true, passive: true });
    window.addEventListener('touchstart', requestLiveSensors, { once: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', requestLiveSensors);
      window.removeEventListener('touchstart', requestLiveSensors);
    };
  }, [requestUserLocation, startHeadingWatch]);

  useEffect(() => {
    writePersistedAppState({
      mapStyle,
      systemTheme,
      profile,
      isSignedIn,
      language,
      stars,
      savedTracks,
    });
  }, [isSignedIn, language, mapStyle, profile, savedTracks, stars, systemTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as typeof window & {
      __MAP_APP_SENSOR_DEBUG__?: Record<string, unknown>;
    }).__MAP_APP_SENSOR_DEBUG__ = {
      userLocation,
      deviceHeading,
      isFollowingUserLocation,
      isTracking,
      hasGpsWatch: gpsWatchIdRef.current !== null,
      isSecureContext: window.isSecureContext,
      hasGeolocation: canUseBrowserGeolocation(),
      hasDeviceOrientation: Boolean(window.DeviceOrientationEvent),
      hasDeviceOrientationPermission: Boolean(
        (window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission | undefined)?.requestPermission
      ),
      lastCompassHeadingAgeMs: lastCompassHeadingAtRef.current
        ? Date.now() - lastCompassHeadingAtRef.current
        : null,
    };
  }, [deviceHeading, isFollowingUserLocation, isTracking, userLocation]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTracking && !isPaused) {
      interval = setInterval(() => {
        setTrackTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTracking, isPaused]);

  useEffect(() => {
    const shouldWatchLocation = isFollowingUserLocation || isTracking;

    if (!shouldWatchLocation || !canUseBrowserGeolocation()) {
      stopGpsWatch();
      return;
    }

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      position => applyGpsPosition(position),
      error => {
        if (error.code !== error.PERMISSION_DENIED) return;
        stopGpsWatch();
        if (!trackingStateRef.current.isTracking) {
          setIsFollowingUserLocation(false);
        }
      },
      GEOLOCATION_OPTIONS
    );

    return stopGpsWatch;
  }, [applyGpsPosition, isFollowingUserLocation, isTracking, stopGpsWatch]);

  useEffect(() => () => {
    stopGpsWatch();
    stopHeadingWatch();
  }, [stopGpsWatch, stopHeadingWatch]);

  // Remove the useEffect that depends on userLocation, we will update trackPaths directly in drag handlers
  const trackDistanceKm = React.useMemo(() => {
    let dist = 0;
    trackPaths.forEach(path => {
      for (let i = 1; i < path.length; i++) {
        dist += L.latLng(path[i-1]).distanceTo(L.latLng(path[i]));
      }
    });
    return dist / 1000;
  }, [trackPaths]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const onMapClick = React.useCallback(() => {
    setSelectedStarId(null);
    setActiveTag(null);
    setSelectedTrackId(null);
    setSelectedTrackLatLng(null);
  }, []);

  const handleLocateMe = () => {
    if (isLocating.current) return;
    isLocating.current = true;
    void startHeadingWatch();
    if (!requestUserLocation(true)) isLocating.current = false;
  };

  const handleMapDrop = (e: DragEvent, map: L.Map) => {
    const type = e.dataTransfer?.getData('text/plain');
    if (type === 'star') {
      const latlng = map.mouseEventToLatLng(e as unknown as MouseEvent);
      setStars(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), lat: latlng.lat, lng: latlng.lng }]);
    }
  };

  const onStarClick = (id: string, e: any) => {
    if (tagMode === 'add') {
      setStars(prev => {
        const star = prev.find(s => s.id === id);
        if (star?.tagOrder) return prev; // already tagged
        const groupStars = prev.filter(s => s.tagGroupId === currentTagGroupId);
        const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
        return prev.map(s => s.id === id ? { ...s, tagOrder: maxTag + 1, tagGroupId: currentTagGroupId } : s);
      });
      setSelectedStarId(id);
    } else if (tagMode === 'remove') {
      setStars(prev => {
        const star = prev.find(s => s.id === id);
        if (!star?.tagOrder) return prev;
        const removedTag = star.tagOrder;
        const groupId = star.tagGroupId;
        return prev.map(s => {
          if (s.id === id) return { ...s, tagOrder: undefined, tagGroupId: undefined };
          if (s.tagGroupId === groupId && s.tagOrder && s.tagOrder > removedTag) return { ...s, tagOrder: s.tagOrder - 1 };
          return s;
        });
      });
    } else {
      const star = stars.find(s => s.id === id);
      if (star) {
        setSelectedStarId(id);
        if (star.tagOrder && star.tagGroupId !== undefined) {
          setActiveTag({ order: star.tagOrder, groupId: star.tagGroupId });
        } else {
          setActiveTag(null);
        }
      }
    }
  };

  const onUpdateStar = (id: string, updates: Partial<StarData>) => {
    setStars(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const onDeleteStar = (id: string) => {
    setStars(prev => {
      const star = prev.find(s => s.id === id);
      if (star && star.tagOrder) {
        const groupId = star.tagGroupId;
        // reorder remaining tags
        return prev.filter(s => s.id !== id).map(s => {
          if (s.tagGroupId === groupId && s.tagOrder && s.tagOrder > star.tagOrder!) return { ...s, tagOrder: s.tagOrder - 1 };
          return s;
        });
      }
      return prev.filter(s => s.id !== id);
    });
    if (selectedStarId === id) setSelectedStarId(null);
  };

  const toggleTagMenu = () => {
    if (tagMenuOpen) {
      setTagMenuOpen(false);
      setTagMode('none');
    } else {
      setTagMenuOpen(true);
      setTagMode('add');
      setCurrentTagGroupId(Date.now());
    }
  };

  const handlePrevTag = () => {
    if (!activeTag) return;
    const groupStars = stars.filter(s => s.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
    const nextOrder = activeTag.order > 1 ? activeTag.order - 1 : maxTag;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const s = groupStars.find(s => s.tagOrder === nextOrder);
    if (s) {
      setFlyTarget([s.lat, s.lng]);
      setSelectedStarId(s.id);
    }
  };

  const handleNextTag = () => {
    if (!activeTag) return;
    const groupStars = stars.filter(s => s.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
    const nextOrder = activeTag.order < maxTag ? activeTag.order + 1 : 1;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const s = groupStars.find(s => s.tagOrder === nextOrder);
    if (s) {
      setFlyTarget([s.lat, s.lng]);
      setSelectedStarId(s.id);
    }
  };

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enteredAccount = loginAccount.trim();
    const storedAccount = profile.account.trim();
    const accountMatches = storedAccount ? enteredAccount === storedAccount : enteredAccount.length > 0;
    const passwordMatches = profile.password ? loginPassword === profile.password : true;

    if (!accountMatches || !passwordMatches) {
      setLoginError(homeCopy.loginError);
      return;
    }

    if (!storedAccount) {
      setProfile(prev => ({
        ...prev,
        name: prev.name || DEFAULT_PROFILE.name,
        account: enteredAccount,
        password: loginPassword,
      }));
    }

    setIsSignedIn(true);
    setLoginError('');
    setLoginPassword('');
    setActiveView('map');
  };

  const handleSignOut = () => {
    setIsSignedIn(false);
    setLoginAccount(profile.account);
    setLoginPassword('');
    setLoginError('');
  };

  const openRecordsCalendarPanel = () => {
    setRecordsCalendarDate(dateFromCalendarDateKey(selectedRecordsDateKey) || new Date());
    setRecordsCalendarMode('month');
    setIsRecordsCalendarOpen(true);
    setIsRecordsMenuOpen(false);
    setIsSearchOpen(false);
  };

  const tagPolylines = React.useMemo(() => {
    const groups = new Map<number, StarData[]>();
    stars.filter(s => s.tagOrder !== undefined && s.tagGroupId !== undefined).forEach(s => {
      if (!groups.has(s.tagGroupId!)) groups.set(s.tagGroupId!, []);
      groups.get(s.tagGroupId!)!.push(s);
    });

    const result: { groupId: number, color: string, positions: [number, number][] }[] = [];
    groups.forEach((groupStars, groupId) => {
      groupStars.sort((a, b) => a.tagOrder! - b.tagOrder!);
      result.push({
        groupId,
        color: mapStyle === 'aerial' ? '#ffffff' : systemTheme.icon,
        positions: groupStars.map(s => [s.lat, s.lng] as [number, number])
      });
    });
    return result;
  }, [stars, mapStyle, systemTheme.icon]);

  const mapTiles = {
    light: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      thumb: "https://a.basemaps.cartocdn.com/light_all/8/61/105.png"
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      thumb: "https://a.basemaps.cartocdn.com/dark_all/8/61/105.png"
    },
    aerial: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri',
      thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/8/105/61"
    }
  };


  const onUpdateTrack = (id: string, updates: Partial<TrackData>) => {
    setSavedTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const onDeleteTrack = (id: string) => {
    setSavedTracks(prev => prev.filter(t => t.id !== id));
    if (selectedTrackId === id) {
      setSelectedTrackId(null);
      setSelectedTrackLatLng(null);
    }
  };

  const homeCopy = HOME_COPY[language as keyof typeof HOME_COPY] || HOME_COPY.en;
  const languageLocale = LANGUAGE_LOCALES[language] || LANGUAGE_LOCALES.en;
  const selectedFontFamily = LANGUAGE_FONT_FAMILIES[language] || LANGUAGE_FONT_FAMILIES.en;
  const selectedFontScale = LANGUAGE_FONT_SCALE[language] || LANGUAGE_FONT_SCALE.en;
  const isOriginalSystemTheme = (Object.keys(DEFAULT_SYSTEM_THEME) as (keyof SystemTheme)[]).every(
    key => systemTheme[key].toLowerCase() === DEFAULT_SYSTEM_THEME[key].toLowerCase()
  );
  const appThemeVars = {
    '--app-page': systemTheme.page,
    '--app-card': systemTheme.card,
    '--app-icon': systemTheme.icon,
    '--app-dark': systemTheme.dark,
    '--app-active-surface': isOriginalSystemTheme ? '#ffffff' : `color-mix(in srgb, ${systemTheme.page} 58%, white)`,
    '--app-card-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.8)' : `color-mix(in srgb, ${systemTheme.card} 68%, white)`,
    '--app-nav-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.95)' : `color-mix(in srgb, ${systemTheme.page} 76%, white)`,
    '--app-soft-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.55)' : `color-mix(in srgb, ${systemTheme.page} 62%, white)`,
    '--app-soft-card': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.6)' : `color-mix(in srgb, ${systemTheme.card} 56%, white)`,
    '--font-sans': selectedFontFamily,
    '--font-mono': selectedFontFamily,
    '--app-font-scale': selectedFontScale,
  } as React.CSSProperties;

  const uploadedImages = React.useMemo<UploadedImage[]>(() => {
    const images: UploadedImage[] = [];
    stars.forEach((star, starIndex) => {
      (star.notes || []).forEach((note, noteIndex) => {
        const sources = [
          ...extractImagesFromHtml(note.contentHtml),
          ...(Array.isArray(note.imageUrls) ? note.imageUrls : []),
          ...(note.imageUrl ? [note.imageUrl] : []),
        ];
        Array.from(new Set(sources)).forEach((src, imageIndex) => {
          images.push({
            id: `${star.id}-${note.id}-${imageIndex}`,
            src,
            title: note.title || `${homeCopy.noteLabel} ${noteIndex + 1} / ${homeCopy.starLabel} ${starIndex + 1}`,
          });
        });
      });
    });
    return images;
  }, [homeCopy.noteLabel, homeCopy.starLabel, stars]);

  const noteRecords = React.useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = now.getFullYear();
    const query = textSearch.trim().toLowerCase();

    return stars
      .flatMap((star, starIndex) => (
        (star.notes || []).map((note, noteIndex) => {
          const timestamp = getNoteTimestamp(note);
          const date = new Date(timestamp);
          const text = htmlToText(note.contentHtml) || note.content || note.title || homeCopy.untitledNote;
          const title = htmlToText(note.titleHtml) || note.title || `${homeCopy.noteLabel} ${noteIndex + 1}`;
          return {
            id: `${star.id}-${note.id}`,
            starId: star.id,
            noteId: note.id,
            starIndex,
            noteIndex,
            lat: star.lat,
            lng: star.lng,
            color: star.color || '#EDC727',
            title,
            text,
            timestamp,
            day: date.getDate(),
            year: date.getFullYear(),
            monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
            dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
            hasContent: hasMeaningfulNoteContent(note),
          };
        })
      ))
      .filter(record => {
        if (!record.hasContent) return false;
        if (selectedRecordsDateKey && record.dateKey !== selectedRecordsDateKey) return false;
        if (recordsFilter === 'monthly' && record.monthKey !== currentMonthKey) return false;
        if (recordsFilter === 'annual' && record.year !== currentYear) return false;
        if (!query) return true;
        return `${record.title} ${record.text} ${record.lat.toFixed(4)} ${record.lng.toFixed(4)}`.toLowerCase().includes(query);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [homeCopy.noteLabel, homeCopy.untitledNote, recordsFilter, selectedRecordsDateKey, stars, textSearch]);

  const recordsByDate = React.useMemo(() => {
    const groups = new Map<string, typeof noteRecords>();
    noteRecords.forEach(record => {
      if (!groups.has(record.dateKey)) groups.set(record.dateKey, []);
      groups.get(record.dateKey)!.push(record);
    });
    return Array.from(groups.entries()).map(([dateKey, records]) => ({ dateKey, records }));
  }, [noteRecords]);

  const recordDateSummaries = React.useMemo(() => {
    const counts = new Map<string, { dateKey: string; day: number; month: string; timestamp: number; count: number }>();
    stars.forEach(star => {
      (star.notes || []).forEach(note => {
        if (!hasMeaningfulNoteContent(note)) return;
        const timestamp = getNoteTimestamp(note);
        const date = new Date(timestamp);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const existing = counts.get(dateKey);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(dateKey, {
            dateKey,
            day: date.getDate(),
            month: formatRecordMonth(timestamp),
            timestamp,
            count: 1,
          });
        }
      });
    });
    return Array.from(counts.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [stars]);

  const recordDateKeys = React.useMemo(() => (
    new Set(recordDateSummaries.map(date => date.dateKey))
  ), [recordDateSummaries]);

  const mapActivity = React.useMemo(() => {
    const points: MapActivityPoint[] = [];

    const addPoint = (lat: number, lng: number, weight: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || weight <= 0) return;
      points.push({ lat, lng, weight });
    };

    stars.forEach(star => {
      addPoint(star.lat, star.lng, 1);
      const meaningfulNoteCount = (star.notes || []).filter(hasMeaningfulNoteContent).length;
      if (meaningfulNoteCount > 0) addPoint(star.lat, star.lng, meaningfulNoteCount);
    });

    const taggedGroups = new Map<number, StarData[]>();
    stars
      .filter(star => star.tagOrder !== undefined && star.tagGroupId !== undefined)
      .forEach(star => {
        if (!taggedGroups.has(star.tagGroupId!)) taggedGroups.set(star.tagGroupId!, []);
        taggedGroups.get(star.tagGroupId!)!.push(star);
      });

    taggedGroups.forEach(groupStars => {
      const orderedStars = [...groupStars].sort((a, b) => (a.tagOrder || 0) - (b.tagOrder || 0));
      for (let index = 1; index < orderedStars.length; index += 1) {
        const prev = orderedStars[index - 1];
        const next = orderedStars[index];
        addPoint((prev.lat + next.lat) / 2, (prev.lng + next.lng) / 2, 0.75);
      }
    });

    const addTrackPath = (path: [number, number][], weight: number) => {
      if (path.length < 2) return;
      const sampledPoints = getPointsEveryXMeters(path, 500);
      sampledPoints.forEach(([lat, lng]) => addPoint(lat, lng, weight));
    };

    savedTracks.forEach(track => {
      track.paths.forEach(path => addTrackPath(path, 0.35));
    });

    if (isTracking) {
      trackPaths.forEach(path => addTrackPath(path, 0.25));
    }

    return { points };
  }, [stars, savedTracks, isTracking, trackPaths]);

  const markedLocationCount = React.useMemo(() => stars.length, [stars]);

  const starRecordRankings = React.useMemo<TextRankingItem[]>(() => (
    stars
      .map((star, index) => ({
        name: String(index + 1),
        value: (star.notes || []).filter(hasMeaningfulNoteContent).length,
        fill: star.color,
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 11)
      .map((item, index) => ({ ...item, name: String(index + 1) }))
  ), [stars]);

  const recordsCalendarDays = React.useMemo(() => {
    const year = recordsCalendarDate.getFullYear();
    const month = recordsCalendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1));
  }, [recordsCalendarDate]);

  const recordsCalendarEmptyDays = React.useMemo(() => (
    Array.from({ length: new Date(recordsCalendarDate.getFullYear(), recordsCalendarDate.getMonth(), 1).getDay() })
  ), [recordsCalendarDate]);

  const recordsCalendarMonths = React.useMemo(() => (
    Array.from({ length: 12 }, (_, month) => new Date(recordsCalendarDate.getFullYear(), month, 1))
  ), [recordsCalendarDate]);

  const handleCoordinateSearch = () => {
    const coordinates = parseCoordinateSearch(coordinateSearch);
    if (!coordinates) return;
    setFlyTarget(coordinates);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsSearchOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
  };

  const handleTextSearch = () => {
    const query = textSearch.trim().toLowerCase();
    if (!query) {
      closeSearchModal();
      return;
    }

    if (activeView === 'records') {
      setSelectedRecordsDateKey(null);
      closeSearchModal();
      return;
    }

    const matchingRecord = stars
      .flatMap(star => (
        (star.notes || []).map(note => {
          const timestamp = getNoteTimestamp(note);
          const title = htmlToText(note.titleHtml) || note.title || homeCopy.untitledNote;
          const text = htmlToText(note.contentHtml) || note.content || title;
          return {
            starId: star.id,
            noteId: note.id,
            lat: star.lat,
            lng: star.lng,
            timestamp,
            searchableText: `${title} ${text} ${star.lat.toFixed(4)} ${star.lng.toFixed(4)}`.toLowerCase(),
            hasContent: hasMeaningfulNoteContent(note),
          };
        })
      ))
      .filter(record => record.hasContent && record.searchableText.includes(query))
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (matchingRecord) {
      setActiveView('map');
      setActiveHomePanel(null);
      setSelectedRecordsDateKey(null);
      setFlyTarget([matchingRecord.lat, matchingRecord.lng]);
      setSelectedStarId(matchingRecord.starId);
      setEditingNoteTarget({ starId: matchingRecord.starId, noteId: matchingRecord.noteId });
    }

    closeSearchModal();
  };

  const openSearchModal = (field: SearchField = 'text') => {
    setActiveSearchField(field);
    setIsSearchOpen(true);
  };

  const closeSearchModal = () => {
    setIsSearchOpen(false);
  };

  const handleAvatarInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const imageUrl = await compressImageFileToDataUrl(file);
    setProfile(prev => ({ ...prev, avatarUrl: imageUrl }));
    event.target.value = '';
  };

  const updateThemeColor = (key: keyof SystemTheme, value: string) => {
    setSystemTheme(prev => ({ ...prev, [key]: value }));
  };

  const getDarkSliderValue = () => {
    const value = systemTheme.dark.replace('#', '');
    const parsed = Number.parseInt(value.slice(0, 2), 16);
    return Number.isFinite(parsed) ? parsed : 92;
  };

  const updateDarkSliderColor = (value: number) => {
    const channel = Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase();
    updateThemeColor('dark', `#${channel}${channel}${channel}`);
  };

  const downloadGalleryImage = (image: UploadedImage) => {
    const link = document.createElement('a');
    link.href = image.src;
    link.download = `${image.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'image'}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const homeMenuItems: { panel: Exclude<HomePanel, null>; label: string; icon: React.ReactNode }[] = [
    { panel: 'profile', label: homeCopy.modify, icon: <Database size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'theme', label: homeCopy.theme, icon: <Palette size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'gallery', label: homeCopy.gallery, icon: <ImageIcon size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'settings', label: homeCopy.settings, icon: <Settings size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
  ];
  const activeHomeTitle = homeMenuItems.find(item => item.panel === activeHomePanel)?.label || homeCopy.settings;
  const themeColorControls: { key: keyof SystemTheme; label: string }[] = [
    { key: 'page', label: homeCopy.base },
    { key: 'card', label: homeCopy.card },
    { key: 'icon', label: homeCopy.icon },
    { key: 'dark', label: homeCopy.dark },
  ];

  const getBottomNavClass = (view: AppView) => (
    activeView === view
      ? 'bg-[var(--app-dark)] text-white rounded-full px-6 py-3 flex items-center justify-center transition-all duration-300 ease-out'
      : 'text-gray-800 rounded-full px-4 py-3 flex items-center justify-center hover:bg-[var(--app-card)] transition-all duration-300 ease-out'
  );
  const bottomNavTransition = { type: 'spring', stiffness: 420, damping: 34 };

  const btnClass = "w-12 h-12 rounded-full bg-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 transition-all shadow-sm";
  const readerToolButtonClass = "flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-md transition-transform active:scale-95";
  const searchInputClass = (field: SearchField) => (
    `h-12 rounded-full px-5 text-[15px] font-medium text-black outline-none transition-colors placeholder:text-black/25 ${
      activeSearchField === field ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
    }`
  );

  const locationIcon = React.useMemo(
    () => createLocationIcon(mapStyle, systemTheme.icon, deviceHeading),
    [deviceHeading, mapStyle, systemTheme.icon]
  );
  const locationMarkerKey = `user-location-${mapStyle}-${systemTheme.icon}-${Math.round(deviceHeading)}`;
  const editingStar = editingNoteTarget
    ? stars.find(star => star.id === editingNoteTarget.starId)
    : null;
  const readerRecord = React.useMemo(() => {
    if (!readingNoteTarget) return null;
    const star = stars.find(item => item.id === readingNoteTarget.starId);
    const note = star?.notes?.find(item => item.id === readingNoteTarget.noteId);
    if (!star || !note) return null;
    return {
      star,
      note,
      timestamp: getNoteTimestamp(note),
      titleHtml: getReadableTitleHtml(note, homeCopy.untitledNote),
      contentHtml: getReadableNoteHtml(note, homeCopy.noteImageAlt),
    };
  }, [homeCopy.noteImageAlt, homeCopy.untitledNote, readingNoteTarget, stars]);
  const readerFontScale = [0.94, 1, 1.08][readerFontScaleIndex] || 1;

  const openReaderFromRecord = React.useCallback((starId: string, noteId: string) => {
    setReadingNoteTarget({ starId, noteId });
    setActiveView('reader');
    setActiveHomePanel(null);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setIsSearchOpen(false);
    setIsReaderToolsOpen(false);
  }, []);

  const locateReaderRecord = React.useCallback(() => {
    if (!readerRecord) return;
    setFlyTarget([readerRecord.star.lat, readerRecord.star.lng]);
    setSelectedStarId(readerRecord.star.id);
    setActiveTag(null);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsReaderToolsOpen(false);
  }, [readerRecord]);

  const openReaderEditor = React.useCallback(() => {
    if (!readingNoteTarget) return;
    setEditingNoteTarget(readingNoteTarget);
    setIsReaderToolsOpen(false);
  }, [readingNoteTarget]);

  const cycleReaderFontScale = React.useCallback(() => {
    setReaderFontScaleIndex(index => (index + 1) % 3);
  }, []);

  const scrollReaderToImage = React.useCallback(() => {
    const image = readerContentRef.current?.querySelector('img');
    image?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setIsReaderToolsOpen(false);
  }, []);

  return (
    <div className="relative w-[100dvw] h-[100dvh] overflow-hidden bg-[#e5e5e5] font-sans" style={appThemeVars}>
      
      {/* Background Map */}
      <div className={`absolute inset-0 z-0 bg-[#e5e5e5] ${mapStyle === 'dark' ? 'theme-dark' : ''} ${mapStyle === 'light' ? 'theme-light' : ''}`}>
        <MapContainer 
          center={position} 
          zoom={16} 
          scrollWheelZoom={true} 
          className="w-full h-full absolute inset-0 z-0"
          zoomControl={false} // Disable default zoom control to match UI
        >
          <TileLayer
            attribution={mapTiles[mapStyle].attribution}
            url={mapTiles[mapStyle].url}
          />
          <Marker 
            key={locationMarkerKey}
            position={userLocation} 
            icon={locationIcon}
            draggable={false}
            keyboard={false}
            interactive={false}
          />
          <FlyToTarget target={flyTarget} />
          <MapViewportSync location={userLocation} shouldFollow={isFollowingUserLocation || isTracking} />
          <FollowUserLocation location={userLocation} enabled={isFollowingUserLocation || isTracking} />
          
          <MapEventHandlers onDrop={handleMapDrop} onMapClick={onMapClick} />
          
          <StarNavigationOverlay activeTag={activeTag} stars={stars} onPrev={handlePrevTag} onNext={handleNextTag} />
          <StarActionOverlay
            selectedStarId={selectedStarId}
            stars={stars}
            onUpdateStar={onUpdateStar}
            onDeleteStar={onDeleteStar}
            onEditNote={starId => setEditingNoteTarget({ starId })}
            language={language}
          />
          <TrackActionOverlay selectedTrackId={selectedTrackId} savedTracks={savedTracks} onUpdateTrack={onUpdateTrack} onDeleteTrack={onDeleteTrack} selectedLatLng={selectedTrackLatLng} language={language} />
          
          {tagPolylines.map((line) => line.positions.length > 1 && (
            <Polyline 
              key={`tagline-${line.groupId}`}
              positions={line.positions} 
              pathOptions={{ color: line.color, dashArray: '1, 10', weight: 2.5, lineCap: 'round', lineJoin: 'round' }} 
            />
          ))}

          {isTracking && trackPaths.map((path, idx) => {
            if (path.length < 2) return null;
            const dots = getPointsEveryXMeters(path, 100);
            return (
              <React.Fragment key={`track-group-${idx}`}>
                <Polyline 
                  positions={path} 
                  pathOptions={{ color: '#EDC727', weight: 2.5, lineCap: 'round', lineJoin: 'round' }} 
                />
                {dots.map((dot, dIdx) => (
                  <CircleMarker
                    key={`track-dot-${idx}-${dIdx}`}
                    center={dot}
                    radius={4}
                    pathOptions={{ color: 'transparent', fillColor: '#EDC727', fillOpacity: 1, weight: 0 }}
                    interactive={false}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {savedTracks.map(track => 
            track.paths.map((path, idx) => {
              if (path.length < 2) return null;
              const dots = getPointsEveryXMeters(path, 100);
              return (
                <React.Fragment key={`saved-track-group-${track.id}-${idx}`}>
                  {/* Invisible wider polyline to catch clicks easily */}
                  <Polyline 
                    positions={path} 
                    pathOptions={{ color: 'transparent', weight: 25 }} 
                    eventHandlers={{
                      click: (e) => {
                        L.DomEvent.stopPropagation(e as any);
                        setSelectedTrackId(track.id);
                        if ((e as any).latlng) setSelectedTrackLatLng([(e as any).latlng.lat, (e as any).latlng.lng]);
                      }
                    }}
                  />
                  {/* Visible path */}
                  <Polyline 
                    positions={path} 
                    pathOptions={{ color: track.color || '#EDC727', weight: 2.5, lineCap: 'round', lineJoin: 'round' }} 
                    eventHandlers={{
                      click: (e) => {
                        L.DomEvent.stopPropagation(e as any);
                        setSelectedTrackId(track.id);
                        if ((e as any).latlng) setSelectedTrackLatLng([(e as any).latlng.lat, (e as any).latlng.lng]);
                      }
                    }}
                  />
                  {/* Interactive dots every 100 meters */}
                  {dots.map((dot, dIdx) => (
                    <CircleMarker
                      key={`saved-track-dot-${track.id}-${idx}-${dIdx}`}
                      center={dot}
                      radius={4}
                      pathOptions={{ color: 'transparent', fillColor: track.color || '#EDC727', fillOpacity: 1, weight: 0 }}
                      eventHandlers={{
                        click: (e) => {
                          L.DomEvent.stopPropagation(e as any);
                          setSelectedTrackId(track.id);
                          setSelectedTrackLatLng(dot);
                        }
                      }}
                    />
                  ))}
                </React.Fragment>
              );
            })
          )}

          {stars.map((star) => (
            <Marker 
              key={star.id} 
              position={[star.lat, star.lng]} 
              icon={createStarIcon(star.tagOrder, selectedStarId === star.id, star.color, mapStyle === 'aerial', systemTheme.icon)} 
              draggable={true}
              eventHandlers={{
                click: (e) => onStarClick(star.id, e),
                dragend: (e) => {
                  const marker = e.target;
                  const newPos = marker.getLatLng();
                  setStars(prev => prev.map(s => s.id === star.id ? { ...s, lat: newPos.lat, lng: newPos.lng } : s));
                }
              }}
            />
          ))}
        </MapContainer>
      </div>

      {/* Top Right Menu */}
      {activeView === 'map' && !isTracking && (
        <div className="absolute top-6 right-4 z-[1000] flex flex-col items-end gap-3">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={btnClass}
          >
            {isMenuOpen ? <ChevronDown size={28} strokeWidth={2.5} /> : <Menu size={24} strokeWidth={2.5} />}
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.8, transition: { duration: 0.2 } }}
                className="flex flex-col items-end gap-3"
              >
                {/* Map Style Selector */}
                <div className="relative flex justify-end items-center h-[48px]">
                  <AnimatePresence mode="wait">
                    {isMapStyleMenuOpen ? (
                      <motion.div
                        key="open"
                        initial={{ opacity: 0, scale: 0.8, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.8, x: 20 }}
                        transition={{ duration: 0.15 }}
                        className="h-[48px] bg-[var(--app-icon)] px-[4px] rounded-[24px] flex items-center gap-[4px] shadow-lg relative"
                      >
                        <div className="relative z-10 flex items-center gap-[4px]">
                          {/* Dark Mode Option */}
                          <button 
                            onClick={() => { setMapStyle('dark'); setIsMapStyleMenuOpen(false); }}
                            className={`flex items-center justify-center rounded-full transition-all focus:outline-none ${mapStyle === 'dark' ? 'w-[40px] h-[40px] border-[3px] border-black scale-100' : 'w-[40px] h-[40px] hover:opacity-80 scale-[0.85]'}`}
                          >
                            <div className="w-full h-full rounded-full overflow-hidden relative">
                              <img src={mapTiles.dark.thumb} className="w-full h-full object-cover custom-dark-thumb" alt={homeCopy.darkMapAlt} />
                            </div>
                          </button>
                          
                          {/* Aerial Mode Option */}
                          <button 
                            onClick={() => { setMapStyle('aerial'); setIsMapStyleMenuOpen(false); }}
                            className={`flex items-center justify-center rounded-full transition-all focus:outline-none ${mapStyle === 'aerial' ? 'w-[40px] h-[40px] border-[3px] border-black scale-100' : 'w-[40px] h-[40px] hover:opacity-80 scale-[0.85]'}`}
                          >
                            <div className="w-full h-full rounded-full overflow-hidden relative">
                              <img src={mapTiles.aerial.thumb} className="w-full h-full object-cover" alt={homeCopy.aerialMapAlt} />
                            </div>
                          </button>

                          {/* Light Mode Option */}
                          <button 
                            onClick={() => { setMapStyle('light'); setIsMapStyleMenuOpen(false); }}
                            className={`flex items-center justify-center rounded-full transition-all focus:outline-none ${mapStyle === 'light' ? 'w-[40px] h-[40px] border-[3px] border-black scale-100' : 'w-[40px] h-[40px] hover:opacity-80 scale-[0.85]'}`}
                          >
                            <div className="w-full h-full rounded-full overflow-hidden relative">
                              <img src={mapTiles.light.thumb} className="w-full h-full object-cover custom-light-thumb" alt={homeCopy.lightMapAlt} />
                            </div>
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.button 
                        key="closed"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => setIsMapStyleMenuOpen(true)}
                        className="w-[48px] h-[48px] rounded-full bg-[var(--app-icon)] p-[6px] shadow-sm hover:opacity-90 transition-opacity focus:outline-none block"
                      >
                        <div className="w-full h-full rounded-full border-[3px] border-black overflow-hidden relative">
                          <img 
                            src={mapTiles[mapStyle].thumb} 
                            className={`w-full h-full object-cover ${mapStyle === 'dark' ? 'custom-dark-thumb' : ''} ${mapStyle === 'light' ? 'custom-light-thumb' : ''}`}
                            alt={homeCopy.currentMapStyleAlt} 
                          />
                        </div>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Map Pin */}
                <button className={btnClass} onClick={handleLocateMe}>
                  <MapPin size={24} strokeWidth={2} />
                </button>
                
                {/* Tag */}
                <div className="relative flex flex-col items-start h-[48px]">
                  <AnimatePresence mode="popLayout">
                    {tagMenuOpen ? (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.8, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.8, x: 20 }}
                        transition={{ duration: 0.15 }}
                        className="h-[48px] bg-[var(--app-icon)] px-[4px] rounded-[24px] flex items-center gap-[4px] shadow-md relative"
                      >
                        <button 
                          className={`w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all ${tagMode === 'add' ? 'bg-[var(--app-dark)] text-white shadow-md' : 'text-black hover:bg-black/10'}`}
                          onClick={() => setTagMode('add')}
                        >
                          <Plus size={22} strokeWidth={3} />
                        </button>
                        <button 
                          className={`w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all ${tagMode === 'remove' ? 'bg-[var(--app-dark)] text-white shadow-md' : 'text-black hover:bg-black/10'}`}
                          onClick={() => setTagMode('remove')}
                        >
                          <Minus size={22} strokeWidth={3} />
                        </button>
                        <button 
                          className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-colors text-black hover:bg-black/10"
                          onClick={toggleTagMenu}
                        >
                          <ChevronRight size={26} strokeWidth={2.5} />
                        </button>
                      </motion.div>
                    ) : (
                      <motion.button 
                        key="closed"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        className="w-[48px] h-[48px] rounded-full bg-[var(--app-icon)] shadow-sm hover:brightness-95 transition-all flex items-center justify-center text-black"
                        onClick={toggleTagMenu}
                      >
                        <Tag size={22} strokeWidth={2.5} fill="none" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Route */}
                <button className={btnClass} onClick={() => {
                  void startHeadingWatch();
                  const didRequestGps = requestUserLocation(true);
                  setIsTracking(true);
                  setIsPaused(false);
                  setTrackPaths(didRequestGps ? [] : [[userLocation]]);
                  setTrackTime(0);
                  setIsMenuOpen(false);
                }}>
                  <Route size={24} strokeWidth={2} />
                </button>
                
                {/* Star */}
                <button 
                  className={btnClass}
                  onClick={() => setStars(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), lat: userLocation[0], lng: userLocation[1] }])}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', 'star');
                    e.dataTransfer.setDragImage(starDragImg, 18, 18);
                  }}
                >
                  <Star size={24} strokeWidth={2} fill="none" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {isTracking && (
        <>
          {/* Tracking Top Left Card */}
          <div className="absolute top-6 left-4 z-[1000] bg-[var(--app-active-surface)] rounded-[24px] shadow-md px-6 py-4 border border-[var(--app-card)] min-w-[160px]">
            <div className="absolute top-3 left-3 w-2 h-2 bg-black rounded-full"></div>
            <div className="absolute top-3 right-3 w-2 h-2 bg-black rounded-full"></div>
            <div className="absolute bottom-3 left-3 w-2 h-2 bg-black rounded-full"></div>
            <div className="absolute bottom-3 right-3 w-2 h-2 bg-black rounded-full"></div>
            
            <div className="w-full h-[3px] bg-gray-200 mt-2 mb-3 rounded-full"></div>
            <div className="text-[40px] leading-none font-bold text-black tracking-tight text-left">
              {trackDistanceKm.toFixed(1)}<span className="text-[28px] font-bold ml-1.5">km</span>
            </div>
            <div className="w-full h-[3px] bg-gray-200 my-3 rounded-full"></div>
            <div className="text-[24px] leading-none font-semibold text-black text-left mb-1">
              {formatTime(trackTime)}
            </div>
            <div className="w-full h-[3px] bg-gray-200 mt-3 mb-2 rounded-full"></div>
          </div>

          {/* Tracking Top Right */}
          <div className="absolute top-6 right-4 z-[1000]">
            <button 
              className={btnClass}
              onClick={() => {
                setIsPaused(!isPaused);
                if (isPaused) {
                  // Resuming: start a new path segment
                  setTrackPaths(prev => [...prev, []]);
                }
              }}
            >
              {isPaused ? <Play size={24} strokeWidth={2.5} /> : <Pause size={24} strokeWidth={2.5} />}
            </button>
          </div>

          {/* Tracking Bottom Right (above Bottom Nav) */}
          <div className="absolute bottom-28 right-4 z-[1000] flex flex-col gap-3">
            <button 
              className={btnClass}
              onClick={() => {
                setIsTracking(false);
                setTrackPaths([]);
                setTrackTime(0);
                setIsPaused(false);
              }}
            >
              <X size={28} strokeWidth={2.5} />
            </button>
            <button 
              className={btnClass}
              onClick={() => {
                if (trackPaths.some(p => p.length > 1)) {
                  setSavedTracks(prev => [...prev, {
                    id: Math.random().toString(36).substr(2, 9),
                    paths: trackPaths.filter(p => p.length > 1),
                    color: '#EDC727',
                    time: trackTime,
                    distance: trackDistanceKm
                  }]);
                }
                setIsTracking(false);
                setTrackPaths([]);
                setTrackTime(0);
                setIsPaused(false);
              }}
            >
              <Save size={24} strokeWidth={2.5} />
            </button>
          </div>
        </>
      )}

      {/* Bottom Right Search Button */}
      {activeView === 'map' && !isTracking && (
        <div className="absolute bottom-28 right-4 z-[1000]">
          <button
            className={btnClass}
            onClick={() => {
              if (isSearchOpen) {
                closeSearchModal();
              } else {
                openSearchModal('text');
              }
            }}
            aria-label={homeCopy.search}
          >
            <Search size={24} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <AnimatePresence>
        {isSignedIn && activeView === 'records' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="absolute inset-0 z-[900] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
          >
            <div className="flex-1 overflow-y-auto px-6 pb-32 pt-16">
              <div className="mb-4 flex items-start justify-between">
                <h1 className="mt-1 text-4xl font-bold tracking-tight text-black">{homeCopy.recordsTitle}</h1>
                <div className="relative flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setIsRecordsMenuOpen(open => !open);
                    }}
                    className="relative z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black transition-colors"
                    aria-label={homeCopy.recordsMenu}
                  >
                    {isRecordsMenuOpen ? <ChevronDown size={28} strokeWidth={2.5} /> : <Menu size={24} strokeWidth={2.5} />}
                  </button>

                  <AnimatePresence>
                    {isRecordsMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.8, transition: { duration: 0.2 } }}
                        className="absolute left-0 top-[56px] z-10 flex flex-col gap-2"
                      >
                        <button
                          onClick={openRecordsCalendarPanel}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm"
                          aria-label={homeCopy.calendar}
                        >
                          <CalendarDays size={24} strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => {
                            setIsRecordsMenuOpen(false);
                            openSearchModal('text');
                          }}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm"
                          aria-label={homeCopy.searchRecords}
                        >
                          <Search size={28} strokeWidth={2} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="mb-6 flex items-center gap-3">
                {([
                  ['all', homeCopy.allRecords],
                  ['monthly', homeCopy.monthlyRecords],
                  ['annual', homeCopy.annualRecords],
                ] as [RecordsFilter, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => {
                      setRecordsFilter(value);
                      setSelectedRecordsDateKey(null);
                    }}
                    className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${recordsFilter === value ? 'bg-[var(--app-dark)] text-white' : 'bg-[var(--app-card)] text-black'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative mt-2">
                {recordsByDate.length > 0 && (
                  <div className="absolute bottom-[-20px] left-[11px] top-6 w-[2px] rounded-full bg-[var(--app-card)]" />
                )}

                {recordsByDate.length > 0 ? recordsByDate.map(group => {
                  const [firstRecord] = group.records;
                  return (
                    <div key={group.dateKey} className="mb-10">
                      <div className="mb-4 flex items-baseline gap-2 pl-8">
                        <span className="text-3xl font-extrabold leading-none tracking-tight text-gray-900">{firstRecord.day}</span>
                        <span className="text-sm font-medium text-gray-400">{formatRecordMonth(firstRecord.timestamp)}</span>
                      </div>

                      <div className="flex flex-col gap-4">
                        {group.records.map(record => (
                          <button
                            key={record.id}
                            onClick={() => openReaderFromRecord(record.starId, record.noteId)}
                            className="relative block w-full pl-8 text-left"
                          >
                            <span className="absolute left-[12px] top-[calc(50%-24px)] h-[2px] w-[20px] bg-[var(--app-card)]" />
                            <span className="absolute left-[12px] top-[calc(50%+22px)] h-[2px] w-[20px] bg-[var(--app-card)]" />
                            <span
                              className="absolute left-[6px] top-1/2 z-10 box-content h-[12px] w-[12px] -translate-y-1/2 rounded-full border-2 border-[var(--app-page)] ring-[3px] ring-[var(--app-page)]"
                              style={{ backgroundColor: record.color }}
                            />
                            <span className="block rounded-[20px] bg-[var(--app-card-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
                              <span className="line-clamp-3 block text-[15px] font-medium leading-relaxed text-black/80">
                                {record.text || record.title}
                              </span>
                              <span className="mt-4 flex justify-end text-xs font-medium text-gray-400">
                                {formatRecordTime(record.timestamp, languageLocale)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="pt-20 text-center text-[16px] font-medium text-black/35">
                    {homeCopy.noRecords}
                  </div>
                )}
              </div>
            </div>

            <AnimatePresence>
              {isRecordsCalendarOpen && (
                <motion.div
                  initial={{ opacity: 0, y: '100%' }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="absolute inset-0 z-[1000] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
                >
                  <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-32 pt-16">
                    <div className="w-full max-w-[360px]">
                      <div className="mb-6 flex items-start justify-between">
                        <h1 className="mt-1 text-[32px] font-bold tracking-tight text-black">{homeCopy.calendar}</h1>
                        <button
                          onClick={() => setIsRecordsCalendarOpen(false)}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
                          aria-label={homeCopy.closeCalendar}
                        >
                          <X size={24} strokeWidth={2.5} />
                        </button>
                      </div>

                      <div className="rounded-[20px] bg-[var(--app-card-surface)] p-5 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                          <button
                            onClick={() => setRecordsCalendarMode(mode => mode === 'month' ? 'year' : 'month')}
                            className="group flex items-center gap-1 transition-opacity hover:opacity-70"
                          >
                            <h2 className="text-[20px] font-bold tracking-tight text-gray-900">
                              {recordsCalendarMode === 'month' ? getMonthTitle(recordsCalendarDate, languageLocale) : recordsCalendarDate.getFullYear()}
                            </h2>
                            <ChevronDown size={18} className="text-gray-400 transition-colors group-hover:text-gray-600" />
                          </button>

                          <div className="flex gap-2">
                            <button
                              onClick={() => setRecordsCalendarDate(date => addMonths(date, recordsCalendarMode === 'month' ? -1 : -12))}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-card)] text-black/65 transition-colors hover:bg-[var(--app-page)]"
                              aria-label={homeCopy.previousCalendarPage}
                            >
                              <ChevronLeft size={18} />
                            </button>
                            <button
                              onClick={() => setRecordsCalendarDate(date => addMonths(date, recordsCalendarMode === 'month' ? 1 : 12))}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-card)] text-black/65 transition-colors hover:bg-[var(--app-page)]"
                              aria-label={homeCopy.nextCalendarPage}
                            >
                              <ChevronRight size={18} />
                            </button>
                          </div>
                        </div>

                        <AnimatePresence mode="wait">
                          {recordsCalendarMode === 'month' ? (
                            <motion.div
                              key="month"
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                            >
                              <div className="mb-3 grid grid-cols-7">
                                {homeCopy.weekdays.map(day => (
                                  <div key={day} className="text-center text-[10px] font-bold tracking-wider text-gray-400">
                                    {day}
                                  </div>
                                ))}
                              </div>
                              <div className="mb-4 h-[1px] w-full bg-gray-100" />
                              <div className="grid grid-cols-7 gap-x-1 gap-y-2">
                                {recordsCalendarEmptyDays.map((_, index) => (
                                  <div key={`empty-${index}`} className="h-10" />
                                ))}
                                {recordsCalendarDays.map(day => {
                                  const dateKey = getCalendarDateKey(day);
                                  const hasRecord = recordDateKeys.has(dateKey);
                                  const isToday = getCalendarDateKey(new Date()) === dateKey;

                                  return (
                                    <button
                                      key={dateKey}
                                      type="button"
                                      disabled={!hasRecord}
                                      onClick={() => {
                                        if (!hasRecord) return;
                                        setSelectedRecordsDateKey(dateKey);
                                        setRecordsFilter('all');
                                        setIsRecordsCalendarOpen(false);
                                      }}
                                      className="relative flex h-10 flex-col items-center justify-center"
                                    >
                                      <div className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[14px] font-semibold tracking-tight transition-colors ${isToday ? 'bg-[var(--app-dark)] text-white' : 'text-gray-800 hover:bg-[var(--app-card)]'}`}>
                                        {day.getDate()}
                                      </div>
                                      {hasRecord && (
                                        <div className={`absolute bottom-0 h-[4px] w-[4px] rounded-full ${isToday ? 'bg-white' : 'bg-[var(--app-icon)]'}`} />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="year"
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="grid grid-cols-3 gap-x-2 gap-y-4 pt-2"
                            >
                              {recordsCalendarMonths.map(month => {
                                const isCurrentMonth = month.getMonth() === recordsCalendarDate.getMonth();
                                return (
                                  <button
                                    key={month.getMonth()}
                                    onClick={() => {
                                      setRecordsCalendarDate(month);
                                      setRecordsCalendarMode('month');
                                    }}
                                    className={`flex flex-col items-center rounded-2xl p-3 transition-colors ${isCurrentMonth ? 'bg-[var(--app-dark)] text-white' : 'text-gray-800 hover:bg-[var(--app-card)]'}`}
                                  >
                                    <span className="text-[14px] font-semibold">
                                      {new Intl.DateTimeFormat(languageLocale, { month: 'short' }).format(month)}
                                    </span>
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeView === 'home' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            transition={{ duration: 0.18 }}
            className="home-screen absolute inset-0 z-[900] flex justify-center overflow-hidden bg-[var(--app-page)] pointer-events-auto"
          >
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarInput}
            />

            <div className="relative h-full w-full max-w-[430px] overflow-y-auto px-10 pb-28 pt-[clamp(3.5rem,8dvh,5.75rem)]">
              {!isSignedIn ? (
                <form
                  onSubmit={handleLogin}
                  className="flex min-h-full flex-col justify-center"
                >
                  <div className="rounded-[18px] bg-[var(--app-card)] p-4">
                    <div className="mb-4 flex items-center gap-2 text-[18px] font-medium text-black">
                      <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                      {homeCopy.loginTitle}
                    </div>
                    <div className="mb-4 text-[15px] font-medium leading-tight text-black/45">
                      {homeCopy.loginHint}
                    </div>
                    <div className="space-y-3">
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <AtSign size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={loginAccount}
                          onChange={event => {
                            setLoginAccount(event.target.value);
                            setLoginError('');
                          }}
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.account}
                        />
                      </label>
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={loginPassword}
                          onChange={event => {
                            setLoginPassword(event.target.value);
                            setLoginError('');
                          }}
                          type="password"
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.loginPassword}
                        />
                      </label>
                    </div>
                    {loginError && (
                      <div className="mt-3 text-[13px] font-medium text-black/45">
                        {loginError}
                      </div>
                    )}
                    <button
                      type="submit"
                      className="mt-5 h-[48px] w-full rounded-full bg-[var(--app-dark)] text-[16px] font-medium text-white transition-transform active:scale-[0.98]"
                    >
                      {homeCopy.login}
                    </button>
                  </div>
                </form>
              ) : !activeHomePanel && (
                <>
              <div className="flex items-center gap-8">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] bg-[var(--app-card)] text-black"
                  aria-label={homeCopy.uploadAvatar}
                >
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={homeCopy.userAvatarAlt} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--app-card)]">
                      <UserRound size={42} strokeWidth={2} />
                    </div>
                  )}
                </button>

                <div className="min-w-0">
                  <div className="truncate text-[26px] font-semibold leading-tight text-black">{profile.name || homeCopy.userFallback}</div>
                  <div className="mt-1.5 text-[14px] font-medium leading-tight text-black">ID:{profile.account || '----'}</div>
                </div>
              </div>

              <div className="mt-14 space-y-2.5">
                {homeMenuItems.map(item => (
                  <button
                    key={item.panel}
                    onClick={() => setActiveHomePanel(item.panel)}
                    className="flex h-[58px] w-full items-center rounded-[14px] bg-[var(--app-card)] px-4 text-left text-black transition-transform active:scale-[0.99]"
                  >
                    <span className="mr-4 flex shrink-0 items-center justify-center text-black">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[18px] font-medium leading-tight">{item.label}</span>
                    <ChevronRight
                      size={28}
                      strokeWidth={2}
                      className="ml-3 text-black/15"
                    />
                  </button>
                ))}
              </div>
                </>
              )}

              {isSignedIn && activeHomePanel && (
                <button
                  onClick={() => setActiveHomePanel(null)}
                  className="mb-5 flex h-11 items-center gap-2 rounded-full bg-[var(--app-card)] px-4 text-[18px] font-medium text-black"
                  aria-label={homeCopy.back}
                >
                  <ChevronLeft size={24} strokeWidth={2} />
                  <span className="leading-tight">{activeHomeTitle}</span>
                </button>
              )}

              <AnimatePresence mode="wait">
                {activeHomePanel === 'profile' && (
                  <motion.div
                    key="profile-panel"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4 rounded-[18px] bg-[var(--app-card)] p-4"
                  >
                    <div className="mb-3 flex items-center gap-2 text-[18px] font-medium text-black">
                      <UserRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                      {homeCopy.modify}
                    </div>
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      className="mb-4 h-24 w-24 overflow-hidden rounded-[18px] bg-[var(--app-soft-surface)] text-black"
                      aria-label={homeCopy.uploadAvatar}
                    >
                      {profile.avatarUrl ? (
                        <img src={profile.avatarUrl} alt={homeCopy.userAvatarAlt} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <UserRound size={42} strokeWidth={2} />
                        </div>
                      )}
                    </button>
                    <div className="space-y-3">
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <UserRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={profile.name}
                          onChange={event => setProfile(prev => ({ ...prev, name: event.target.value }))}
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.userName}
                        />
                      </label>
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <AtSign size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={profile.account}
                          onChange={event => setProfile(prev => ({ ...prev, account: event.target.value }))}
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.account}
                        />
                      </label>
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={profile.password}
                          onChange={event => setProfile(prev => ({ ...prev, password: event.target.value }))}
                          type="password"
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.loginPassword}
                        />
                      </label>
                    </div>
                  </motion.div>
                )}

                {activeHomePanel === 'theme' && (
                  <motion.div
                    key="theme-panel"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4 rounded-[18px] bg-[var(--app-card)] p-4"
                  >
                    <div className="mb-3 flex items-center gap-2 text-[18px] font-medium text-black">
                      <Palette size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                      {homeCopy.theme}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {THEME_PRESETS.map(preset => (
                        <button
                          key={preset.label.en}
                          onClick={() => {
                            setSystemTheme(preset.theme);
                            setActiveThemeColorKey(null);
                            setShowThemeCustomPicker(false);
                          }}
                          className="rounded-[14px] bg-[var(--app-soft-surface)] p-2 text-left"
                        >
                          <div className="flex gap-1">
                            {Object.values(preset.theme).map(color => (
                              <span key={color} className="h-6 flex-1 rounded-[7px]" style={{ backgroundColor: color }} />
                            ))}
                          </div>
                          <div className="mt-2 text-[14px] font-medium leading-tight text-black">{preset.label[language] || preset.label.en}</div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 space-y-2">
                      {themeColorControls.map(control => (
                        <div key={control.key} className="relative">
                          <button
                            onClick={() => {
                              const isOpen = activeThemeColorKey === control.key;
                              setActiveThemeColorKey(isOpen ? null : control.key);
                              setShowThemeCustomPicker(false);
                            }}
                            className="flex h-10 w-full items-center justify-between rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-[15px] font-medium text-black"
                          >
                            <span className="min-w-0 truncate">{control.label}</span>
                            <span className="ml-3 flex shrink-0 items-center gap-2">
                              <span className="text-[12px] font-semibold leading-none text-black/45">
                                {systemTheme[control.key].replace('#', '').toUpperCase()}
                              </span>
                              <span
                                className="h-6 w-10 rounded-[8px] border border-black/10"
                                style={{ backgroundColor: systemTheme[control.key] }}
                              />
                            </span>
                          </button>

                          {activeThemeColorKey === control.key && (
                            <div className="absolute right-0 top-[calc(100%+8px)] z-[40] flex flex-col items-center">
                              <div className="bg-[var(--app-dark)] w-[124px] rounded-[20px] p-2.5 shadow-lg relative box-border">
                                {control.key === 'dark' ? (
                                  <div className="flex flex-col gap-2">
                                    <input
                                      type="range"
                                      min="24"
                                      max="126"
                                      value={getDarkSliderValue()}
                                      onChange={event => updateDarkSliderColor(Number(event.target.value))}
                                      className="w-full accent-white"
                                      aria-label={control.label}
                                    />
                                    <div className="flex items-center justify-between">
                                      <span className="text-[11px] font-medium text-white/70">{control.label}</span>
                                      <span className="h-5 w-8 rounded-full border border-white/25" style={{ backgroundColor: systemTheme.dark }} />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-4 gap-2">
                                    {THEME_PICKER_COLORS.map(color => (
                                      <button
                                        key={color}
                                        onClick={() => updateThemeColor(control.key, color)}
                                        className="w-[20px] h-[20px] rounded-full"
                                        style={{
                                          backgroundColor: color,
                                          boxShadow: systemTheme[control.key] === color ? '0 0 0 1.5px white' : 'none'
                                        }}
                                      />
                                    ))}
                                    <button
                                      onClick={() => setShowThemeCustomPicker(!showThemeCustomPicker)}
                                      className="w-[20px] h-[20px] rounded-[6px] relative overflow-hidden"
                                      style={{ boxShadow: showThemeCustomPicker || !THEME_PICKER_COLORS.includes(systemTheme[control.key]) ? '0 0 0 1.5px white' : 'none' }}
                                    >
                                      <div className="w-full h-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] absolute inset-0 pointer-events-none" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {control.key !== 'dark' && showThemeCustomPicker && (
                                <div className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
                                  <HexColorPicker color={systemTheme[control.key]} onChange={color => updateThemeColor(control.key, color)} />
                                  <div className="flex items-center w-full">
                                    <span className="text-white/70 font-mono text-[13px] leading-none pt-[1px] mr-1">#</span>
                                    <HexColorInput
                                      color={systemTheme[control.key]}
                                      onChange={color => updateThemeColor(control.key, color)}
                                      className="flex-1 min-w-0 h-[22px] bg-white/10 border border-white/20 text-white rounded-[6px] px-1.5 text-[12px] font-mono uppercase focus:outline-none focus:border-white/50"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {activeHomePanel === 'gallery' && (
                  <motion.div
                    key="gallery-panel"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4"
                  >
                    {uploadedImages.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {uploadedImages.map(image => (
                          <button
                            key={image.id}
                            onClick={() => setGalleryPreviewImage(image)}
                            className="aspect-square overflow-hidden rounded-[12px]"
                            title={image.title}
                          >
                            <img src={image.src} alt={image.title} className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-2 py-8 text-center text-[15px] font-medium text-black/45">
                        {homeCopy.noImages}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeHomePanel === 'settings' && (
                  <motion.div
                    key="settings-panel"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4"
                  >
                    <div className="rounded-[14px] bg-[var(--app-card)] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
                        <Languages size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                        {homeCopy.language}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {LANGUAGE_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => setLanguage(option.value)}
                            className={`h-9 rounded-full text-[14px] font-medium transition-colors ${language === option.value ? 'bg-[var(--app-dark)] text-white' : 'bg-[var(--app-soft-card)] text-black'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 rounded-[14px] bg-[var(--app-card)] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
                        <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                        {homeCopy.accountAccess}
                      </div>
                      <button
                        onClick={handleSignOut}
                        className="h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98]"
                      >
                        {homeCopy.exit}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSignedIn && activeView === 'reader' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="absolute inset-0 z-[950] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
          >
            <div className="flex-1 overflow-y-auto px-8 pb-32 pt-16">
              <div className="mx-auto w-full max-w-[430px]">
                <div className="mb-12 flex items-start justify-between">
                  <button
                    onClick={() => {
                      setActiveView('records');
                      setReadingNoteTarget(null);
                      setIsReaderToolsOpen(false);
                    }}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
                    aria-label={homeCopy.backToRecords}
                  >
                    <ChevronsLeft size={30} strokeWidth={2.5} />
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
                      className="note-reader-title mb-7 text-[36px] font-medium leading-tight"
                      style={{ color: readerRecord.note.color || '#D2936D' }}
                      dangerouslySetInnerHTML={{ __html: readerRecord.titleHtml }}
                    />
                    <div
                      ref={readerContentRef}
                      className="note-reader-content pb-10 text-[#7E9FBA]"
                      style={{ fontSize: `${20 * readerFontScale}px` }}
                      dangerouslySetInnerHTML={{ __html: readerRecord.contentHtml }}
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
                      <button className={readerToolButtonClass} onClick={openReaderEditor} aria-label={homeCopy.readerEdit}>
                        <Save size={24} strokeWidth={2.4} />
                      </button>
                      <button className={readerToolButtonClass} onClick={cycleReaderFontScale} aria-label={homeCopy.readerReadingSize}>
                        <span className="text-[28px] font-semibold leading-none">A</span>
                      </button>
                      <button className={readerToolButtonClass} onClick={openReaderEditor} aria-label={homeCopy.readerAddPhoto}>
                        <Camera size={24} strokeWidth={2.4} />
                      </button>
                      <button className={readerToolButtonClass} onClick={scrollReaderToImage} aria-label={homeCopy.readerJumpImage}>
                        <ImageIcon size={24} strokeWidth={2.4} />
                      </button>
                      <button className={readerToolButtonClass} onClick={openReaderEditor} aria-label={homeCopy.readerEditColor}>
                        <Palette size={24} strokeWidth={2.4} />
                      </button>
                      <button className={readerToolButtonClass} onClick={() => setIsReaderToolsOpen(false)} aria-label={homeCopy.readerCollapseTools}>
                        <ChevronUp size={30} strokeWidth={2.5} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!isReaderToolsOpen && (
                  <button className={readerToolButtonClass} onClick={() => setIsReaderToolsOpen(true)} aria-label={homeCopy.readerExpandTools}>
                    <Menu size={24} strokeWidth={2.5} />
                  </button>
                )}

                <button className={readerToolButtonClass} onClick={locateReaderRecord} aria-label={homeCopy.readerLocate}>
                  <MapPin size={26} strokeWidth={2.4} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSignedIn && activeView === 'stats' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="absolute inset-0 z-[900]"
          >
            <TripStatisticsView
              activityPoints={mapActivity.points}
              activityCount={markedLocationCount}
              textRankings={starRecordRankings}
              language={language}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSearchOpen && activeView !== 'home' && activeView !== 'stats' && activeView !== 'reader' && !isTracking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1800] flex items-center justify-center bg-black/[0.35] p-6 pointer-events-auto"
            onPointerDown={closeSearchModal}
          >
            <motion.form
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[360px] rounded-[28px] bg-white/15 p-2 backdrop-blur-[2px]"
              onPointerDown={event => event.stopPropagation()}
              onSubmit={event => {
                event.preventDefault();
                if (activeSearchField === 'coordinate') {
                  handleCoordinateSearch();
                } else {
                  handleTextSearch();
                }
              }}
            >
              <div className="relative flex flex-col gap-2">
                <input
                  value={coordinateSearch}
                  onFocus={() => setActiveSearchField('coordinate')}
                  onPointerDown={() => setActiveSearchField('coordinate')}
                  onChange={event => setCoordinateSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleCoordinateSearch();
                  }}
                  placeholder="(35.8626, 129.1945)"
                  className={`${searchInputClass('coordinate')} pr-14`}
                />
                <label className={`flex h-12 items-center rounded-full px-5 text-black transition-colors ${
                  activeSearchField === 'text' ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
                }`}>
                  <input
                    value={textSearch}
                    onFocus={() => setActiveSearchField('text')}
                    onPointerDown={() => setActiveSearchField('text')}
                    onChange={event => setTextSearch(event.target.value)}
                    placeholder={homeCopy.searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent pr-10 text-[15px] font-medium outline-none placeholder:text-black/25"
                  />
                </label>
                <button
                  type="submit"
                  className="absolute right-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black transition-colors hover:bg-black/5"
                  style={{ top: activeSearchField === 'coordinate' ? 6 : 62 }}
                  aria-label={homeCopy.runSearch}
                >
                  <Search size={28} strokeWidth={2.5} />
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      {isSignedIn && activeView !== 'reader' && (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="bg-[var(--app-nav-surface)] backdrop-blur-lg rounded-[2rem] px-2.5 py-2 flex items-center gap-2.5 shadow-sm border border-[var(--app-icon)] transition-all duration-300 ease-out">
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('map');
              setActiveHomePanel(null);
              setIsRecordsMenuOpen(false);
            }}
            className={getBottomNavClass('map')}
            aria-label={homeCopy.bottomMap}
          >
            <MapIcon size={24} strokeWidth={2} />
          </motion.button>

          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('stats');
              setActiveHomePanel(null);
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
              setIsRecordsMenuOpen(false);
              setIsRecordsCalendarOpen(false);
            }}
            className={getBottomNavClass('stats')}
            aria-label={homeCopy.bottomStats}
          >
            <PieChart size={24} strokeWidth={2} />
          </motion.button>
          
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('records');
              setActiveHomePanel(null);
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
            }}
            className={getBottomNavClass('records')}
            aria-label={homeCopy.bottomNotes}
          >
            <BookOpen size={24} strokeWidth={2} />
          </motion.button>
          
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('home');
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
              setIsRecordsMenuOpen(false);
            }}
            className={getBottomNavClass('home')}
            aria-label={homeCopy.bottomHome}
          >
            <Home size={24} strokeWidth={2} />
          </motion.button>
        </div>
      </div>
      )}

      <AnimatePresence>
        {editingNoteTarget && editingStar && (
          <NoteEditorModal
             star={editingStar}
             initialNoteId={editingNoteTarget.noteId}
             language={language}
             onClose={() => setEditingNoteTarget(null)}
             onSave={(notes) => {
               setStars(prev => prev.map(s => s.id === editingNoteTarget.starId ? { ...s, notes } : s));
             }}
          />
        )}
      </AnimatePresence>

      {galleryPreviewImage && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/80 p-4">
          <button
            onClick={() => setGalleryPreviewImage(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label={homeCopy.closeImagePreview}
          >
            <X size={22} strokeWidth={2.4} />
          </button>
          <button
            onClick={() => downloadGalleryImage(galleryPreviewImage)}
            className="absolute right-[4.25rem] top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label={homeCopy.downloadImage}
          >
            <Download size={21} strokeWidth={2.4} />
          </button>
          <img
            src={galleryPreviewImage.src}
            alt={galleryPreviewImage.title}
            className="max-h-full max-w-full rounded-[18px] object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
