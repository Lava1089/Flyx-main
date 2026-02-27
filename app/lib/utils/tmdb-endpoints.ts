/**
 * TMDB API Endpoint Utility
 * 
 * Routes TMDB requests through Cloudflare Worker when configured,
 * otherwise falls back to local API routes.
 * 
 * Benefits of CF routing:
 * - 100k free requests/day
 * - Built-in edge caching
 * - Lower latency
 */

// Get the CF proxy URL from environment
const CF_TMDB_URL = typeof window !== 'undefined' 
  ? (process.env.NEXT_PUBLIC_CF_TMDB_URL || process.env.NEXT_PUBLIC_CF_ANALYTICS_URL?.replace('/analytics', ''))
  : null;

/**
 * Check if Cloudflare TMDB proxy is configured
 */
export function isCFTMDBEnabled(): boolean {
  return !!CF_TMDB_URL && !CF_TMDB_URL.includes('your-subdomain');
}

/**
 * Get the base URL for TMDB API requests
 */
export function getTMDBBaseUrl(): string {
  if (isCFTMDBEnabled()) {
    return `${CF_TMDB_URL}/tmdb`;
  }
  return '/api/content';
}

/**
 * Build a TMDB search URL
 */
export function getTMDBSearchUrl(query: string, type: 'movie' | 'tv' | 'multi' = 'multi', page = 1): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/search?query=${encodeURIComponent(query)}&type=${type}&page=${page}`;
  }
  return `${base}/search?q=${encodeURIComponent(query)}&type=${type}&page=${page}`;
}

/**
 * Build a TMDB trending URL
 */
export function getTMDBTrendingUrl(type: 'movie' | 'tv' | 'all' = 'all', time: 'day' | 'week' = 'week', page = 1): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/trending?type=${type}&time=${time}&page=${page}`;
  }
  return `${base}/trending?type=${type}&time_window=${time}&page=${page}`;
}

/**
 * Build a TMDB details URL
 */
export function getTMDBDetailsUrl(id: string | number, type: 'movie' | 'tv'): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/details?id=${id}&type=${type}`;
  }
  return `${base}/details?id=${id}&type=${type}`;
}

/**
 * Build a TMDB recommendations URL
 */
export function getTMDBRecommendationsUrl(id: string | number, type: 'movie' | 'tv'): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/recommendations?id=${id}&type=${type}`;
  }
  return `${base}/recommendations?id=${id}&type=${type}`;
}

/**
 * Build a TMDB season URL
 */
export function getTMDBSeasonUrl(id: string | number, season: number): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/season?id=${id}&season=${season}`;
  }
  return `${base}/season?id=${id}&season=${season}`;
}

/**
 * Build a TMDB movies list URL
 */
export function getTMDBMoviesUrl(
  category: 'popular' | 'top_rated' | 'upcoming' | 'now_playing' = 'popular',
  page = 1
): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/movies?category=${category}&page=${page}`;
  }
  return `${base}/movies?category=${category}&page=${page}`;
}

/**
 * Build a TMDB series list URL
 */
export function getTMDBSeriesUrl(
  category: 'popular' | 'top_rated' | 'on_the_air' | 'airing_today' = 'popular',
  page = 1
): string {
  const base = getTMDBBaseUrl();
  if (isCFTMDBEnabled()) {
    return `${base}/series?category=${category}&page=${page}`;
  }
  return `${base}/series?category=${category}&page=${page}`;
}

/**
 * Build a TMDB discover URL (for genre filtering)
 */
export function getTMDBDiscoverUrl(
  type: 'movie' | 'tv',
  options: {
    genres?: string;
    sortBy?: string;
    year?: string;
    page?: number;
  } = {}
): string {
  const base = getTMDBBaseUrl();
  const params = new URLSearchParams();
  params.set('type', type);
  if (options.genres) params.set('genres', options.genres);
  if (options.sortBy) params.set('sort_by', options.sortBy);
  if (options.year) params.set('year', options.year);
  if (options.page) params.set('page', options.page.toString());
  
  if (isCFTMDBEnabled()) {
    return `${base}/discover?${params.toString()}`;
  }
  // Local route uses the same param names
  return `${base}/discover?${params.toString()}`;
}

/**
 * Fetch wrapper that uses the appropriate endpoint
 */
export async function fetchTMDB<T = any>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const base = getTMDBBaseUrl();
  const url = new URL(`${base}${endpoint}`, window.location.origin);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`TMDB fetch failed: ${response.status}`);
  }
  
  return response.json();
}
