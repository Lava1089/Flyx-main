/**
 * MAL Listings Service
 *
 * Backed by AniList (graphql.anilist.co) after Jikan's chronic outage. Keeps
 * the Jikan-shaped MALAnimeListItem + pagination response so callers (the
 * /anime page and browse page) don't need to change.
 */

import {
  fetchListing,
  anilistMediaToMALAnime,
  JIKAN_GENRE_ID_TO_ANILIST,
  type AniListMedia,
} from './anilist';

// Server-side cache for MAL listings (keyed separately from anilist's Media cache)
const listingsCache = new Map<string, { data: MALListingResponse; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

export interface MALAnimeListItem {
  mal_id: number;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string;
  episodes: number | null;
  status: string;
  airing: boolean;
  score: number | null;
  members: number | null;
  rank: number | null;
  popularity: number | null;
  synopsis: string | null;
  year: number | null;
  season: string | null;
  images: {
    jpg: { image_url: string; large_image_url: string };
    webp: { image_url: string; large_image_url: string };
  };
  genres: Array<{ mal_id: number; name: string }>;
  studios: Array<{ mal_id: number; name: string }>;
}

export interface MALListingResponse {
  items: MALAnimeListItem[];
  pagination: {
    last_visible_page: number;
    has_next_page: boolean;
    current_page: number;
    items: {
      count: number;
      total: number;
      per_page: number;
    };
  };
}

// ---------------------------------------------------------------------------

function getCached(key: string): MALListingResponse | null {
  const cached = listingsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCache(key: string, data: MALListingResponse): void {
  listingsCache.set(key, { data, timestamp: Date.now() });
}

function emptyListing(page: number, perPage: number): MALListingResponse {
  return {
    items: [],
    pagination: {
      last_visible_page: 1,
      has_next_page: false,
      current_page: page,
      items: { count: 0, total: 0, per_page: perPage },
    },
  };
}

function anilistMediaToMALListItem(m: AniListMedia): MALAnimeListItem | null {
  const anime = anilistMediaToMALAnime(m);
  if (!anime) return null;
  return {
    ...anime,
    airing: m.status === 'RELEASING',
    rank: null,
  };
}

async function fetchAndMap(
  cacheKey: string,
  opts: Parameters<typeof fetchListing>[0],
  page: number,
  limit: number,
): Promise<MALListingResponse> {
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const { items, pageInfo } = await fetchListing(opts, page, limit);
    const mapped = items
      .map(anilistMediaToMALListItem)
      .filter((i): i is MALAnimeListItem => i !== null);

    const result: MALListingResponse = {
      items: mapped,
      pagination: {
        last_visible_page: pageInfo.lastPage,
        has_next_page: pageInfo.hasNextPage,
        current_page: page,
        items: {
          count: mapped.length,
          total: pageInfo.total,
          per_page: limit,
        },
      },
    };
    if (mapped.length > 0) setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`[MAL-Listings] ${cacheKey} error:`, error);
    return emptyListing(page, limit);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get top anime by popularity. */
export async function getTopAnime(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(`top-anime-${page}-${limit}`, { sort: 'POPULARITY_DESC' }, page, limit);
}

/** Get currently airing anime. */
export async function getAiringAnime(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(
    `airing-anime-${page}-${limit}`,
    { sort: 'POPULARITY_DESC', status: 'RELEASING' },
    page,
    limit,
  );
}

/** Get upcoming anime (not yet aired). */
export async function getUpcomingAnime(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(
    `upcoming-anime-${page}-${limit}`,
    { sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED' },
    page,
    limit,
  );
}

/** Get popular anime (same as getTopAnime — popularity-sorted). */
export async function getPopularAnime(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(`popular-anime-${page}-${limit}`, { sort: 'POPULARITY_DESC' }, page, limit);
}

/** Get anime by Jikan-style genre ID. */
export async function getAnimeByGenre(genreId: number, page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  const genre = JIKAN_GENRE_ID_TO_ANILIST[genreId];
  if (!genre) {
    console.warn(`[MAL-Listings] Unknown genre id ${genreId}, returning empty`);
    return emptyListing(page, limit);
  }
  return fetchAndMap(
    `genre-anime-${genreId}-${page}-${limit}`,
    { sort: 'POPULARITY_DESC', genre },
    page,
    limit,
  );
}

/** Get anime movies (sorted by popularity). */
export async function getAnimeMovies(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(
    `movies-anime-${page}-${limit}`,
    { sort: 'POPULARITY_DESC', format: 'MOVIE' },
    page,
    limit,
  );
}

/** Search anime by query. */
export async function searchAnime(query: string, page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  const cacheKey = `search-anime-${query}-${page}-${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // Search uses the base anilistSearch (not fetchListing — search term takes a
    // different code path in AniList's query). We build a one-off query here.
    const { anilistQuery } = await import('./anilist');
    const gql = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage lastPage currentPage perPage total }
          media(search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
            id idMal
            title { romaji english native }
            type format status episodes duration
            averageScore meanScore popularity favourites
            description(asHtml: false)
            season seasonYear
            startDate { year month day }
            endDate { year month day }
            coverImage { extraLarge large medium }
            bannerImage
            genres
            studios(isMain: true) { nodes { id name } }
          }
        }
      }
    `;
    const data = await anilistQuery<{
      Page: {
        pageInfo: { hasNextPage: boolean; lastPage: number; total: number };
        media: AniListMedia[];
      };
    }>(gql, { search: query, page, perPage: limit });

    if (!data?.Page) return emptyListing(page, limit);

    const mapped = data.Page.media
      .map(anilistMediaToMALListItem)
      .filter((i): i is MALAnimeListItem => i !== null);

    const result: MALListingResponse = {
      items: mapped,
      pagination: {
        last_visible_page: data.Page.pageInfo.lastPage,
        has_next_page: data.Page.pageInfo.hasNextPage,
        current_page: page,
        items: {
          count: mapped.length,
          total: data.Page.pageInfo.total,
          per_page: limit,
        },
      },
    };
    if (mapped.length > 0) setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[MAL-Listings] Search error:', error);
    return emptyListing(page, limit);
  }
}

/** Get top rated anime by score. */
export async function getTopRatedAnime(page: number = 1, limit: number = 25): Promise<MALListingResponse> {
  return fetchAndMap(`toprated-anime-${page}-${limit}`, { sort: 'SCORE_DESC' }, page, limit);
}

// MAL Genre IDs (matches Jikan's taxonomy for backward compat). Translated
// internally via JIKAN_GENRE_ID_TO_ANILIST when hitting AniList.
export const MAL_GENRES = {
  ACTION: 1,
  ADVENTURE: 2,
  COMEDY: 4,
  DRAMA: 8,
  FANTASY: 10,
  HORROR: 14,
  MYSTERY: 7,
  ROMANCE: 22,
  SCI_FI: 24,
  SLICE_OF_LIFE: 36,
  SPORTS: 30,
  SUPERNATURAL: 37,
  THRILLER: 41,
};

export const malListingsService = {
  getTopAnime,
  getAiringAnime,
  getUpcomingAnime,
  getPopularAnime,
  getAnimeByGenre,
  getAnimeMovies,
  searchAnime,
  getTopRatedAnime,
  MAL_GENRES,
};
