export type ProfileRow = {
  account_id: string | null;
  name: string | null;
  avatar_url: string | null;
};

export type SettingsRow = {
  dataset_revision: number | null;
  data_model_version: number | null;
  migration_verified_at: string | null;
};

export type StarRow = {
  id: string;
  sort_order: number;
  lat: number;
  lng: number;
  created_at_ms: number | null;
  tag_order: number | null;
  tag_group_id: number | null;
  color: string | null;
};

export type NoteRow = {
  star_id: string;
  id: string;
  sort_order: number;
  title: string;
  title_html: string;
  content: string;
  content_html: string;
  image_url: string | null;
  image_urls: unknown[] | null;
  images: unknown[] | null;
  font_size: number | null;
  title_font_size: number | null;
  color: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
};

export type TrackRow = {
  id: string;
  sort_order: number;
  paths: unknown[];
  color: string | null;
  duration_seconds: number;
  distance_km: number;
  created_at_ms: number | null;
  updated_at_ms: number | null;
};

export type NormalizedMemoryRows = {
  userId: string;
  account: string;
  profile: ProfileRow | null;
  revision: number;
  stars: StarRow[];
  notes: NoteRow[];
  tracks: TrackRow[];
};
