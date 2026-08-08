import "server-only";

import { getContinueWatching, getDatabase, getProfile, type Profile } from "@/lib/db";

/**
 * Everything the chatbot and homepage rows need about a profile, read
 * straight from the local SQLite tables (see src/lib/db.ts). Query/row
 * mapping style mirrors db.ts: raw snake_case rows, mapped once here.
 */
export interface ProfileContext {
  profile: Profile | null;
  /** Title ids in My List, most recently added first. */
  myListIds: string[];
  /** Title ids with unfinished progress, most recently watched first. */
  continueWatchingIds: string[];
  /** Distinct title ids ever watched, most recent first. */
  watchedTitleIds: string[];
}

export function getProfileContext(profileId: string): ProfileContext {
  const database = getDatabase();

  const myListRows = database
    .prepare(`
      select title_id
      from my_list
      where profile_id = ?
      order by added_at desc
    `)
    .all(profileId) as { title_id: string }[];

  const continueWatching = getContinueWatching(profileId, 20);

  const watchedRows = database
    .prepare(`
      select title_id, max(last_watched_at) as last_watched_at
      from watch_progress
      where profile_id = ?
      group by title_id
      order by last_watched_at desc
      limit 50
    `)
    .all(profileId) as { title_id: string; last_watched_at: string }[];

  return {
    profile: getProfile(profileId),
    myListIds: myListRows.map((row) => row.title_id),
    continueWatchingIds: continueWatching.map((row) => row.titleId),
    watchedTitleIds: watchedRows.map((row) => row.title_id),
  };
}
