import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_SUBTITLE_LANGUAGE_ORDER,
  SUBTITLE_LANGUAGES,
} from "@/lib/subtitle-languages";

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  isKids: boolean;
  maturityRating: string;
}

const DATA_DIRECTORY = join(process.cwd(), ".pezzy");
const DATABASE_PATH = join(DATA_DIRECTORY, "pezzy.db");

const globalForDatabase = globalThis as typeof globalThis & {
  pezzyDatabase?: DatabaseSync;
};

function migrate(database: DatabaseSync): void {
  const version = database.prepare("pragma user_version").get() as {
    user_version: number;
  };

  if (version.user_version < 1) {
    database.exec(`
      begin immediate;

      create table profiles (
      id text primary key,
      name text not null check (length(trim(name)) between 1 and 40),
      avatar_url text,
      is_kids integer not null default 0 check (is_kids in (0, 1)),
      maturity_rating text not null default 'all',
      created_at text not null,
      updated_at text not null
    );

    create table profile_settings (
      profile_id text primary key references profiles(id) on delete cascade,
      autoplay_next integer not null default 1,
      autoplay_previews integer not null default 1,
      reduce_motion integer not null default 0,
      data_saver integer not null default 0,
      video_quality text not null default 'auto',
      app_language text not null default 'en',
      subtitle_language text not null default 'en',
      ai_translation integer not null default 1,
      subtitle_size text not null default 'medium',
      personalized_rows integer not null default 1,
      ask_pezzy integer not null default 1,
      use_watch_history integer not null default 1,
      talk_to_homepage integer not null default 1,
      face_avatar_generation integer not null default 0,
      personalized_ads integer not null default 0,
      notify_new_episodes integer not null default 1,
      notify_recommendations integer not null default 1,
      notify_product_news integer not null default 0,
      email_notifications integer not null default 1,
      updated_at text not null
    );

    create table my_list (
      profile_id text not null references profiles(id) on delete cascade,
      title_id text not null,
      added_at text not null,
      primary key (profile_id, title_id)
    );

    create table watch_progress (
      profile_id text not null references profiles(id) on delete cascade,
      title_id text not null,
      season_number integer not null default 0,
      episode_number integer not null default 1,
      audio_language text not null default 'sub',
      position_seconds real not null default 0 check (position_seconds >= 0),
      duration_seconds real,
      completed integer not null default 0 check (completed in (0, 1)),
      last_watched_at text not null,
      primary key (
        profile_id,
        title_id,
        season_number,
        episode_number,
        audio_language
      )
    );

    create index watch_progress_recent_idx
      on watch_progress(profile_id, last_watched_at desc);

    create table subtitle_tracks (
      id text primary key,
      media_id text not null,
      episode_number integer not null,
      audio_language text not null,
      subtitle_language text not null,
      file_path text not null,
      cue_count integer,
      provider text,
      created_at text not null,
      unique (
        media_id,
        episode_number,
        audio_language,
        subtitle_language
      )
    );

      pragma user_version = 1;
      commit;
    `);
  }

  if (version.user_version < 2) {
    database.exec(`
      alter table profile_settings
        add column preferred_subtitle_languages text not null
        default '["en","he","es","fr","de","pt","ja","ar"]';
      pragma user_version = 2;
    `);
  }

  if (version.user_version < 3) {
    database.exec(`
      alter table profile_settings
        add column auto_skip_intro integer not null default 0;
      alter table profile_settings
        add column preferred_audio text not null default 'ask';
      alter table profile_settings
        add column always_generate_subtitles integer not null default 0;
      alter table profile_settings
        add column preferred_provider text;
      pragma user_version = 3;
    `);
  }

}

function openDatabase(): DatabaseSync {
  mkdirSync(DATA_DIRECTORY, { recursive: true });
  const database = new DatabaseSync(DATABASE_PATH);
  database.exec("pragma foreign_keys = on");
  database.exec("pragma journal_mode = wal");
  database.exec("pragma busy_timeout = 5000");
  migrate(database);
  return database;
}

export function getDatabase(): DatabaseSync {
  globalForDatabase.pezzyDatabase ??= openDatabase();
  return globalForDatabase.pezzyDatabase;
}

interface ProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
  is_kids: number;
  maturity_rating: string;
}

function mapProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    isKids: row.is_kids === 1,
    maturityRating: row.maturity_rating,
  };
}

export function listProfiles(): Profile[] {
  const rows = getDatabase()
    .prepare(`
      select id, name, avatar_url, is_kids, maturity_rating
      from profiles
      order by created_at, rowid
    `)
    .all() as ProfileRow[];

  return rows.map(mapProfileRow);
}

export function getProfile(id: string): Profile | null {
  const row = getDatabase()
    .prepare(`
      select id, name, avatar_url, is_kids, maturity_rating
      from profiles
      where id = ?
    `)
    .get(id) as ProfileRow | undefined;

  return row ? mapProfileRow(row) : null;
}

export function createProfile(input: {
  id: string;
  name: string;
  avatarUrl?: string;
}): Profile {
  const database = getDatabase();
  const now = new Date().toISOString();

  database.exec("begin immediate");
  try {
    database
      .prepare(`
        insert into profiles (
          id, name, avatar_url, is_kids, maturity_rating, created_at, updated_at
        ) values (?, ?, ?, 0, 'all', ?, ?)
      `)
      .run(input.id, input.name, input.avatarUrl ?? null, now, now);
    database
      .prepare(`
        insert into profile_settings (profile_id, updated_at)
        values (?, ?)
      `)
      .run(input.id, now);
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }

  return getProfile(input.id)!;
}

export function getPreferredSubtitleLanguages(profileId: string): string[] {
  const row = getDatabase()
    .prepare(`
      select preferred_subtitle_languages
      from profile_settings
      where profile_id = ?
    `)
    .get(profileId) as { preferred_subtitle_languages: string } | undefined;

  if (!row) return [...DEFAULT_SUBTITLE_LANGUAGE_ORDER];
  try {
    const saved = JSON.parse(row.preferred_subtitle_languages);
    const supported = new Set<string>(SUBTITLE_LANGUAGES.map(({ code }) => code));
    const valid = Array.isArray(saved)
      ? saved.filter(
          (code): code is string =>
            typeof code === "string" && supported.has(code)
        )
      : [];
    return valid.length === SUBTITLE_LANGUAGES.length
      ? valid
      : [...DEFAULT_SUBTITLE_LANGUAGE_ORDER];
  } catch {
    return [...DEFAULT_SUBTITLE_LANGUAGE_ORDER];
  }
}

export function setPreferredSubtitleLanguages(
  profileId: string,
  languages: string[]
): void {
  getDatabase()
    .prepare(`
      update profile_settings
      set preferred_subtitle_languages = ?, updated_at = ?
      where profile_id = ?
    `)
    .run(JSON.stringify(languages), new Date().toISOString(), profileId);
}

// Shared shape behind the plain boolean settings below (auto-skip-intro,
// always-generate-subtitles): a single "select/update one column" pattern.
function getBooleanSetting(profileId: string, column: string): boolean {
  const row = getDatabase()
    .prepare(`select ${column} from profile_settings where profile_id = ?`)
    .get(profileId) as Record<string, number> | undefined;

  return row ? row[column] === 1 : false;
}

function setBooleanSetting(profileId: string, column: string, value: boolean): void {
  getDatabase()
    .prepare(`update profile_settings set ${column} = ?, updated_at = ? where profile_id = ?`)
    .run(value ? 1 : 0, new Date().toISOString(), profileId);
}

export function getAutoSkipIntro(profileId: string): boolean {
  return getBooleanSetting(profileId, "auto_skip_intro");
}

export function setAutoSkipIntro(profileId: string, autoSkipIntro: boolean): void {
  setBooleanSetting(profileId, "auto_skip_intro", autoSkipIntro);
}

export type PreferredAudio = "ask" | "sub" | "dub";
const PREFERRED_AUDIO_VALUES = new Set<PreferredAudio>(["ask", "sub", "dub"]);

export function getPreferredAudio(profileId: string): PreferredAudio {
  const row = getDatabase()
    .prepare(`
      select preferred_audio
      from profile_settings
      where profile_id = ?
    `)
    .get(profileId) as { preferred_audio: string } | undefined;

  if (!row) return "ask";
  return PREFERRED_AUDIO_VALUES.has(row.preferred_audio as PreferredAudio)
    ? (row.preferred_audio as PreferredAudio)
    : "ask";
}

export function setPreferredAudio(profileId: string, preferredAudio: PreferredAudio): void {
  getDatabase()
    .prepare(`
      update profile_settings
      set preferred_audio = ?, updated_at = ?
      where profile_id = ?
    `)
    .run(preferredAudio, new Date().toISOString(), profileId);
}

export function getAlwaysGenerateSubtitles(profileId: string): boolean {
  return getBooleanSetting(profileId, "always_generate_subtitles");
}

export function setAlwaysGenerateSubtitles(
  profileId: string,
  alwaysGenerateSubtitles: boolean
): void {
  setBooleanSetting(profileId, "always_generate_subtitles", alwaysGenerateSubtitles);
}

export interface WatchProgress {
  seasonNumber: number;
  episodeNumber: number;
  audioLanguage: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  lastWatchedAt: string;
}

export interface ContinueWatchingItem extends WatchProgress {
  titleId: string;
}

// An episode counts as finished once playback passes 90% of its runtime -
// matches the common "mark watched near the end" convention (credits, etc).
// Without a known duration we can't judge that, so we trust the caller's
// explicit `completed` flag instead of guessing from position alone.
const COMPLETION_THRESHOLD = 0.9;

function resolveCompleted(
  positionSeconds: number,
  durationSeconds: number | null | undefined,
  explicitCompleted: boolean | undefined
): boolean {
  if (durationSeconds && durationSeconds > 0) {
    return positionSeconds >= durationSeconds * COMPLETION_THRESHOLD;
  }
  return explicitCompleted ?? false;
}

export function recordWatchProgress(input: {
  profileId: string;
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  audioLanguage: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  completed?: boolean;
}): void {
  const completed = resolveCompleted(
    input.positionSeconds,
    input.durationSeconds,
    input.completed
  );

  getDatabase()
    .prepare(`
      insert into watch_progress (
        profile_id, title_id, season_number, episode_number, audio_language,
        position_seconds, duration_seconds, completed, last_watched_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (profile_id, title_id, season_number, episode_number, audio_language)
      do update set
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        completed = excluded.completed,
        last_watched_at = excluded.last_watched_at
    `)
    .run(
      input.profileId,
      input.titleId,
      input.seasonNumber,
      input.episodeNumber,
      input.audioLanguage,
      input.positionSeconds,
      input.durationSeconds ?? null,
      completed ? 1 : 0,
      new Date().toISOString()
    );
}

export function getTitleProgress(profileId: string, titleId: string): WatchProgress[] {
  const rows = getDatabase()
    .prepare(`
      select season_number, episode_number, audio_language, position_seconds,
        duration_seconds, completed, last_watched_at
      from watch_progress
      where profile_id = ? and title_id = ?
      order by season_number, episode_number
    `)
    .all(profileId, titleId) as {
    season_number: number;
    episode_number: number;
    audio_language: string;
    position_seconds: number;
    duration_seconds: number | null;
    completed: number;
    last_watched_at: string;
  }[];

  return rows.map((row) => ({
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    audioLanguage: row.audio_language,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    completed: row.completed === 1,
    lastWatchedAt: row.last_watched_at,
  }));
}

export function getContinueWatching(profileId: string, limit: number): ContinueWatchingItem[] {
  // Same episode watched in sub and dub shares a primary key except for
  // audio_language, so first collapse those duplicates to whichever audio
  // track was watched most recently, then keep the most recently watched
  // unfinished episode per title (the "furthest along" one).
  const rows = getDatabase()
    .prepare(`
      with per_episode as (
        select *, row_number() over (
          partition by title_id, season_number, episode_number
          order by last_watched_at desc
        ) as audio_rank
        from watch_progress
        where profile_id = ?
      ),
      ranked as (
        select *, row_number() over (
          partition by title_id
          order by last_watched_at desc
        ) as title_rank
        from per_episode
        where audio_rank = 1 and completed = 0 and position_seconds > 0
      )
      select title_id, season_number, episode_number, audio_language,
        position_seconds, duration_seconds, completed, last_watched_at
      from ranked
      where title_rank = 1
      order by last_watched_at desc
      limit ?
    `)
    .all(profileId, limit) as {
    title_id: string;
    season_number: number;
    episode_number: number;
    audio_language: string;
    position_seconds: number;
    duration_seconds: number | null;
    completed: number;
    last_watched_at: string;
  }[];

  return rows.map((row) => ({
    titleId: row.title_id,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    audioLanguage: row.audio_language,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    completed: row.completed === 1,
    lastWatchedAt: row.last_watched_at,
  }));
}

/** Remembered stream provider id (see src/lib/anime.ts). Null = no preference yet. */
export function getPreferredProvider(profileId: string): string | null {
  const row = getDatabase()
    .prepare(`
      select preferred_provider
      from profile_settings
      where profile_id = ?
    `)
    .get(profileId) as { preferred_provider: string | null } | undefined;

  return row?.preferred_provider ?? null;
}

export function setPreferredProvider(
  profileId: string,
  preferredProvider: string | null
): void {
  getDatabase()
    .prepare(`
      update profile_settings
      set preferred_provider = ?, updated_at = ?
      where profile_id = ?
    `)
    .run(preferredProvider, new Date().toISOString(), profileId);
}
