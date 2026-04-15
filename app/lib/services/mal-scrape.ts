/**
 * MAL Episode Page Scraper
 *
 * AniList replaces Jikan for structured anime metadata but doesn't expose
 * per-episode titles, air dates, or filler/recap flags. MAL's public episode
 * page (`myanimelist.net/anime/{id}/_/episode`) renders all of that in plain
 * HTML — no auth, no Cloudflare challenge — so we scrape it directly instead
 * of going back through Jikan.
 *
 * This is the same page Jikan itself was scraping; we just skip the broken
 * middleman.
 */

import type { MALEpisode } from './mal';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// Episodes don't change often; cache aggressively.
const episodeCache = new Map<string, { episodes: MALEpisode[]; total: number; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Throttle MAL requests so we don't look abusive. MAL pages are heavy (~80-200KB).
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Decode HTML entities (the ones MAL actually emits — not a full decoder).
 */
function decodeHtml(s: string): string {
  return s
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&hellip;/g, '\u2026');
}

/**
 * Parse a MAL episode page's HTML into MALEpisode objects.
 *
 * Each row looks roughly like:
 *   <td class="episode-number nowrap" data-raw="50">50</td>
 *   <td class="episode-video nowrap">...</td>
 *   <td class="episode-title fs12">
 *     <span class="fl-r di-ib pr4 icon-episode-type-bg">Filler</span>
 *     <a href=".../episode/50" class="fl-l fw-b ">English Title</a>
 *     <br><span class="di-ib">Romanized&nbsp;(日本語)</span>
 *   </td>
 *   <td class="episode-aired nowrap">Jan 7, 2024</td>
 *   <td class="episode-poll ..." data-raw="4.14">...</td>
 */
function parseEpisodeHtml(html: string): MALEpisode[] {
  const episodes: MALEpisode[] = [];

  // Split on episode-number cells so we get one chunk per row.
  const rowRegex = /<td class="episode-number nowrap" data-raw="(\d+)">[\s\S]*?(?=<td class="episode-number nowrap" data-raw=|<\/tbody>|<\/table>|$)/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const number = parseInt(rowMatch[1]);
    const chunk = rowMatch[0];

    // Title (English / main). The `<a>` inside `<td class="episode-title">`.
    const titleMatch = chunk.match(/<td class="episode-title[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;
    const titleCell = titleMatch[1];

    // Filler/Recap flags live as <span class="... icon-episode-type-bg">Filler</span>
    // before the <a>. "Recap" uses the same markup with text "Recap".
    const flagMatch = titleCell.match(/icon-episode-type-bg[^>]*>([^<]+)</);
    const flagText = flagMatch ? flagMatch[1].trim().toLowerCase() : '';
    const filler = flagText.includes('filler');
    const recap = flagText.includes('recap');

    const aMatch = titleCell.match(/<a[^>]*class="fl-l fw-b[^"]*"[^>]*>([^<]*)<\/a>/);
    const title = aMatch ? decodeHtml(aMatch[1]).trim() : `Episode ${number}`;

    // Japanese / romaji title in `<span class="di-ib">...(kanji)</span>`.
    // Format: "Romaji Title (日本語)". The `(` may be `&nbsp;(`.
    const jpMatch = titleCell.match(/<span class="di-ib">([\s\S]*?)<\/span>/);
    let romaji: string | null = null;
    let japanese: string | null = null;
    if (jpMatch) {
      const raw = decodeHtml(jpMatch[1]).trim();
      if (raw) {
        const parenMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (parenMatch) {
          romaji = parenMatch[1].trim() || null;
          japanese = parenMatch[2].trim() || null;
        } else {
          romaji = raw;
        }
      }
    }

    // Aired date. MAL emits "Jan 7, 2024" or "?" if unknown.
    const airedMatch = chunk.match(/<td class="episode-aired nowrap">([^<]*)<\/td>/);
    const aired = airedMatch ? decodeHtml(airedMatch[1]).trim() : null;
    const airedValue = aired && aired !== '?' && aired !== '-' ? aired : null;

    // Score. `<td class="episode-poll ... scored" data-raw="4.14">`. Skip if unscored.
    const scoreMatch = chunk.match(/<td\s+class="episode-poll[^"]*scored"[^>]*data-raw="([\d.]+)"/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

    episodes.push({
      mal_id: number,
      title,
      title_japanese: japanese,
      title_romanji: romaji,
      aired: airedValue,
      score,
      filler,
      recap,
    });
  }

  return episodes;
}

/**
 * Fetch a page (100 episodes) of MAL episodes for an anime.
 * Offsets: 0 (eps 1-100), 100 (eps 101-200), etc.
 */
async function fetchMalEpisodePage(malId: number, offset: number): Promise<MALEpisode[] | null> {
  await throttle();
  try {
    const url = `https://myanimelist.net/anime/${malId}/_/episode${offset > 0 ? `?offset=${offset}` : ''}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
      // Next.js server-side cache — layered on top of our in-memory map so
      // that the ISR layer can serve stale while we revalidate.
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      console.warn(`[mal-scrape] HTTP ${res.status} for anime/${malId} offset=${offset}`);
      return null;
    }
    const html = await res.text();
    return parseEpisodeHtml(html);
  } catch (e) {
    console.warn(`[mal-scrape] fetch failed for anime/${malId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Fetch all episodes for an anime from MAL, scraping as many pages as needed.
 * Returns null if MAL is unreachable so callers can fall back.
 *
 * @param malId - MAL anime ID
 * @param maxEpisodes - Hint for how many episodes exist. We stop scraping
 *                     when we've got enough, which avoids wasted requests
 *                     for long-running series like One Piece.
 */
export async function scrapeMALEpisodes(
  malId: number,
  maxEpisodes?: number,
): Promise<MALEpisode[] | null> {
  const cacheKey = `${malId}`;
  const cached = episodeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.episodes;
  }

  const all: MALEpisode[] = [];
  let offset = 0;
  // Hard cap at 20 pages (2000 episodes) — One Piece is ~1100 episodes so
  // this leaves plenty of headroom while preventing runaway scrapes on bad
  // input.
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchMalEpisodePage(malId, offset);
    if (batch === null) {
      // Network failure on first page → return null so caller falls back.
      // On subsequent pages, return what we've collected.
      return all.length > 0 ? all : null;
    }
    if (batch.length === 0) break;
    all.push(...batch);

    if (maxEpisodes && all.length >= maxEpisodes) break;
    if (batch.length < 100) break;

    offset += 100;
  }

  if (all.length > 0) {
    episodeCache.set(cacheKey, { episodes: all, total: all.length, ts: Date.now() });
  }
  return all;
}

/**
 * Get a slice of episodes (100 per page) for an anime.
 * Shapes the response to match what the old Jikan `/anime/{id}/episodes?page=N`
 * endpoint returned.
 */
export async function scrapeMALEpisodePage(
  malId: number,
  page: number,
  maxEpisodes?: number,
): Promise<{ episodes: MALEpisode[]; hasNextPage: boolean; lastPage: number } | null> {
  const all = await scrapeMALEpisodes(malId, maxEpisodes);
  if (all === null) return null;

  const perPage = 100;
  const lastPage = Math.max(1, Math.ceil(all.length / perPage));
  const start = (page - 1) * perPage;
  const slice = all.slice(start, start + perPage);
  return {
    episodes: slice,
    hasNextPage: page < lastPage,
    lastPage,
  };
}
