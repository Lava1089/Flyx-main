/**
 * TMDB API proxy — translates custom routes to TMDB API v3 paths.
 *
 * Supports: search, trending, details, recommendations, season,
 * movies, series, discover. Handles bearer vs api_key auth and
 * sets Cache-Control headers with per-endpoint TTLs.
 */

import { CORS_HEADERS, errorResponse, jsonResponse } from "../lib/helpers";
import { fetchJson } from "../lib/fetch";

const TMDB_BASE = "https://api.themoviedb.org/3";

/** Cache TTLs (seconds) per endpoint type. */
export const CACHE_TTLS: Record<string, number> = {
  search: 300,
  trending: 600,
  details: 3600,
  recommendations: 3600,
  season: 3600,
  movies: 600,
  series: 600,
  discover: 600,
};

/** Build a TMDB JSON response with CORS + Cache-Control. */
function tmdbJson(
  data: unknown,
  status: number,
  cacheSec: number,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSec}`,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Fetch from the TMDB API, handling bearer vs api_key auth.
 */
export async function tmdbFetch(
  apiKey: string,
  endpoint: string,
  extraParams: Record<string, string> = {},
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set("language", "en-US");

  const headers: Record<string, string> = {};
  if (apiKey.startsWith("ey")) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set("api_key", apiKey);
  }

  for (const [k, v] of Object.entries(extraParams)) {
    if (v) url.searchParams.set(k, v);
  }

  const r = await fetchJson<Record<string, unknown>>(url.toString(), headers);
  return {
    ok: r.status >= 200 && r.status < 300,
    data: r.data,
    status: r.status,
  };
}

/** Stamp media_type / mediaType onto each result item. */
function tagResults(
  items: Record<string, unknown>[],
  type: string,
): Record<string, unknown>[] {
  return items.map((i) => ({
    ...i,
    media_type: (i.media_type as string) || type,
    mediaType: (i.media_type as string) || type,
  }));
}

/**
 * Main TMDB proxy handler.
 */
export async function handleTMDB(
  req: Request,
  url: URL,
): Promise<Response> {
  const apiKey = process.env.TMDB_API_KEY || "";
  if (!apiKey) return errorResponse("TMDB API key not configured", 500);

  const route =
    url.pathname.replace(/^\/tmdb\/?/, "").replace(/\/$/, "") || "";

  try {
    // Health / root
    if (route === "health" || route === "") {
      return tmdbJson({ status: "healthy", hasApiKey: true }, 200, 60);
    }

    // Search
    if (route === "search") {
      const q = url.searchParams.get("query");
      const type = url.searchParams.get("type") || "multi";
      const page = url.searchParams.get("page") || "1";
      if (!q) return errorResponse("Missing query parameter", 400);
      const ep = type === "multi" ? "/search/multi" : `/search/${type}`;
      const r = await tmdbFetch(apiKey, ep, { query: q, page });
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}`, results: [] },
          r.status,
          CACHE_TTLS.search,
        );
      const results = tagResults(
        (r.data.results as Record<string, unknown>[]) || [],
        type,
      );
      return tmdbJson(
        { ...r.data, results },
        200,
        CACHE_TTLS.search,
      );
    }

    // Trending
    if (route === "trending") {
      const type = url.searchParams.get("type") || "all";
      const time = url.searchParams.get("time") || "week";
      const page = url.searchParams.get("page") || "1";
      const r = await tmdbFetch(apiKey, `/trending/${type}/${time}`, { page });
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}`, results: [] },
          r.status,
          CACHE_TTLS.trending,
        );
      return tmdbJson(r.data, 200, CACHE_TTLS.trending);
    }

    // Details
    if (route === "details") {
      const id = url.searchParams.get("id");
      const type = url.searchParams.get("type") || "movie";
      if (!id) return errorResponse("Missing id parameter", 400);
      const r = await tmdbFetch(apiKey, `/${type}/${id}`, {
        append_to_response:
          "credits,videos,external_ids,content_ratings,release_dates",
      });
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}` },
          r.status,
          CACHE_TTLS.details,
        );
      return tmdbJson(
        { ...r.data, media_type: type, mediaType: type },
        200,
        CACHE_TTLS.details,
      );
    }

    // Recommendations (falls back to similar)
    if (route === "recommendations") {
      const id = url.searchParams.get("id");
      const type = url.searchParams.get("type") || "movie";
      if (!id) return errorResponse("Missing id parameter", 400);
      let r = await tmdbFetch(apiKey, `/${type}/${id}/recommendations`);
      if (
        !r.ok ||
        !((r.data.results as unknown[]) || []).length
      ) {
        r = await tmdbFetch(apiKey, `/${type}/${id}/similar`);
      }
      const results = tagResults(
        (r.data?.results as Record<string, unknown>[]) || [],
        type,
      );
      return tmdbJson(
        { results },
        200,
        CACHE_TTLS.recommendations,
      );
    }

    // Season
    if (route === "season") {
      const id = url.searchParams.get("id");
      const season = url.searchParams.get("season");
      if (!id || !season)
        return errorResponse("Missing id or season parameter", 400);
      const r = await tmdbFetch(apiKey, `/tv/${id}/season/${season}`);
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}` },
          r.status,
          CACHE_TTLS.season,
        );
      return tmdbJson(r.data, 200, CACHE_TTLS.season);
    }

    // Movies
    if (route === "movies") {
      const cat = url.searchParams.get("category") || "popular";
      const page = url.searchParams.get("page") || "1";
      const r = await tmdbFetch(apiKey, `/movie/${cat}`, { page });
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}`, results: [] },
          r.status,
          CACHE_TTLS.movies,
        );
      const results = tagResults(
        (r.data.results as Record<string, unknown>[]) || [],
        "movie",
      );
      return tmdbJson(
        { ...r.data, results },
        200,
        CACHE_TTLS.movies,
      );
    }

    // Series
    if (route === "series") {
      const cat = url.searchParams.get("category") || "popular";
      const page = url.searchParams.get("page") || "1";
      const r = await tmdbFetch(apiKey, `/tv/${cat}`, { page });
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}`, results: [] },
          r.status,
          CACHE_TTLS.series,
        );
      const results = tagResults(
        (r.data.results as Record<string, unknown>[]) || [],
        "tv",
      );
      return tmdbJson(
        { ...r.data, results },
        200,
        CACHE_TTLS.series,
      );
    }

    // Discover
    if (route === "discover") {
      const type = url.searchParams.get("type") || "movie";
      const page = url.searchParams.get("page") || "1";
      const sortBy =
        url.searchParams.get("sort_by") || "popularity.desc";
      const genres = url.searchParams.get("genres") || "";
      const year = url.searchParams.get("year") || "";
      const params: Record<string, string> = {
        page,
        sort_by: sortBy,
      };
      if (genres) params.with_genres = genres;
      if (year)
        params[
          type === "movie"
            ? "primary_release_year"
            : "first_air_date_year"
        ] = year;
      const r = await tmdbFetch(apiKey, `/discover/${type}`, params);
      if (!r.ok)
        return tmdbJson(
          { error: `TMDB error: ${r.status}`, results: [] },
          r.status,
          CACHE_TTLS.discover,
        );
      const results = tagResults(
        (r.data.results as Record<string, unknown>[]) || [],
        type,
      );
      return tmdbJson(
        { ...r.data, results },
        200,
        CACHE_TTLS.discover,
      );
    }

    return errorResponse("Unknown TMDB route", 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: "TMDB proxy error", message },
      502,
    );
  }
}
