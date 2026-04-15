/**
 * Anime Search API
 * GET /api/content/anime-search
 *
 * Backed by AniList (graphql.anilist.co). Replaces direct client-side calls
 * to api.jikan.moe which chronically 500s. Response shape matches the Jikan
 * /v4/anime response the SearchPageClient already consumes, so callers only
 * need to change the URL, not the parsing.
 *
 * Query params (mirror Jikan's):
 *   q, page, limit, order_by (score|start_date|members), genres (comma-separated
 *   MAL ids), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), min_score
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  anilistQuery,
  anilistMediaToMALAnime,
  JIKAN_GENRE_ID_TO_ANILIST,
  type AniListMedia,
} from '@/lib/services/anilist';

export const dynamic = 'force-dynamic';

type OrderBy = 'score' | 'start_date' | 'members';

const SORT_MAP: Record<OrderBy, string> = {
  score: 'SCORE_DESC',
  start_date: 'START_DATE_DESC',
  members: 'POPULARITY_DESC',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 50);
  const orderBy = (searchParams.get('order_by') || 'members') as OrderBy;
  const genresParam = searchParams.get('genres') || '';
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const minScoreParam = searchParams.get('min_score');

  const sort = SORT_MAP[orderBy] || 'POPULARITY_DESC';

  // Translate MAL genre IDs → AniList genre names. AniList only accepts a
  // single genre per query via the `genre` arg; use `genre_in` for multiple.
  const genreIds = genresParam
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n));
  const anilistGenres = genreIds
    .map(id => JIKAN_GENRE_ID_TO_ANILIST[id])
    .filter((g): g is string => !!g);

  const variables: Record<string, any> = {
    page,
    perPage: limit,
    sort: [sort],
  };
  if (q) variables.search = q;
  if (anilistGenres.length > 0) variables.genre_in = anilistGenres;
  if (startDate) variables.startDateGreater = parseDateToFuzzyInt(startDate);
  if (endDate) variables.startDateLesser = parseDateToFuzzyInt(endDate);
  if (minScoreParam) variables.averageScore_greater = Math.round(parseFloat(minScoreParam) * 10);

  const gql = `
    query (
      $page: Int
      $perPage: Int
      $sort: [MediaSort]
      $search: String
      $genre_in: [String]
      $startDateGreater: FuzzyDateInt
      $startDateLesser: FuzzyDateInt
      $averageScore_greater: Int
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage lastPage currentPage perPage total }
        media(
          type: ANIME
          sort: $sort
          search: $search
          genre_in: $genre_in
          startDate_greater: $startDateGreater
          startDate_lesser: $startDateLesser
          averageScore_greater: $averageScore_greater
        ) {
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
      pageInfo: { hasNextPage: boolean; lastPage: number; currentPage: number; perPage: number; total: number };
      media: AniListMedia[];
    };
  }>(gql, variables);

  if (!data?.Page) {
    return NextResponse.json({
      data: [],
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: page,
        items: { count: 0, total: 0, per_page: limit },
      },
    });
  }

  // Shape matches Jikan /v4/anime response; SearchPageClient reads `data` and
  // `pagination.has_next_page`.
  const mapped = data.Page.media
    .map(anilistMediaToMALAnime)
    .filter(a => a !== null);

  return NextResponse.json({
    data: mapped,
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
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
    },
  });
}

/** YYYY-MM-DD → AniList FuzzyDateInt (YYYYMMDD). */
function parseDateToFuzzyInt(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return parseInt(`${m[1]}${m[2]}${m[3]}`);
}
