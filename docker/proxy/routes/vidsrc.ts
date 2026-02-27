/**
 * VidSrc extraction via 2embed API and stream proxying.
 *
 * /vidsrc/extract — calls 2embed API, returns M3U8 URL
 * /vidsrc/stream  — proxies stream, rewrites M3U8 for VidSrc domains
 */

import { CORS_HEADERS, USER_AGENT, errorResponse, jsonResponse } from "../lib/helpers";
import { fetchJson } from "../lib/fetch";

const EMBED_API_BASE = "https://v1.2embed.stream";

/** Domains whose URLs get rewritten in VidSrc M3U8 manifests. */
const VIDSRC_DOMAIN_RE =
  /https:\/\/(?:v1\.2embed\.stream|[^\/\s]*cloudnestra\.[a-z]+|[^\/\s]*shadowlandschronicles\.[a-z]+|[^\/\s]*embedsito\.com)\/[^\s\n]+/g;

/**
 * Extract a stream URL from the 2embed API.
 */
export async function handleVidSrcExtract(
  _req: Request,
  url: URL,
): Promise<Response> {
  const tmdbId = url.searchParams.get("tmdbId");
  const type = url.searchParams.get("type") || "movie";
  const season = url.searchParams.get("season");
  const episode = url.searchParams.get("episode");

  if (!tmdbId) return errorResponse("Missing tmdbId", 400);
  if (type === "tv" && (!season || !episode))
    return errorResponse("Season and episode required for TV", 400);

  const startTime = Date.now();
  try {
    const apiPath =
      type === "tv"
        ? `/api/m3u8/tv/${tmdbId}/${season}/${episode}`
        : `/api/m3u8/movie/${tmdbId}`;

    const { data } = await fetchJson<Record<string, unknown>>(
      `${EMBED_API_BASE}${apiPath}`,
      { Referer: `${EMBED_API_BASE}/` },
    );

    if (data.success && data.m3u8_url && !data.fallback) {
      const proxiedUrl = `/vidsrc/stream?url=${encodeURIComponent(data.m3u8_url as string)}`;
      return jsonResponse({
        success: true,
        m3u8_url: data.m3u8_url,
        proxied_url: proxiedUrl,
        source: data.source,
        duration_ms: Date.now() - startTime,
      });
    }

    return jsonResponse(
      {
        success: false,
        error: (data.message as string) || (data.error as string) || "No m3u8_url",
        duration_ms: Date.now() - startTime,
      },
      404,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, error: message, duration_ms: Date.now() - startTime },
      500,
    );
  }
}


/**
 * Rewrite a VidSrc M3U8 manifest so all VidSrc-domain URLs and
 * relative paths route through the proxy.
 */
export function rewriteVidSrcM3U8(
  manifest: string,
  streamUrl: string,
  proxyBase: string,
): string {
  const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf("/") + 1);

  // 1. Rewrite absolute VidSrc-domain URLs
  let out = manifest.replace(
    VIDSRC_DOMAIN_RE,
    (m) => `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(m)}`,
  );

  // 2. Rewrite URI="..." values
  out = out.replace(/URI="(https?:\/\/[^"]+)"/g, (_, u: string) => {
    return `URI="${proxyBase}/vidsrc/stream?url=${encodeURIComponent(u)}"`;
  });

  // 3. Rewrite relative URLs on data lines
  out = out
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("/vidsrc/")) return line;
      if (t.startsWith("http://") || t.startsWith("https://")) {
        if (
          t.includes(".ts") ||
          t.includes(".m3u8") ||
          t.includes("/key") ||
          t.includes(".key")
        ) {
          return `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(t)}`;
        }
        return line;
      }
      // Relative path
      try {
        const abs = new URL(t, baseUrl).toString();
        return `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(abs)}`;
      } catch {
        return line;
      }
    })
    .join("\n");

  return out;
}

/**
 * Proxy a VidSrc stream, rewriting M3U8 manifests.
 */
export async function handleVidSrcStream(
  _req: Request,
  url: URL,
  proxyBase: string,
): Promise<Response> {
  const streamUrl = url.searchParams.get("url");
  if (!streamUrl) return errorResponse("Missing url parameter", 400);

  try {
    // Determine referer from the stream hostname
    let referer = `${EMBED_API_BASE}/`;
    try {
      const h = new URL(streamUrl).hostname;
      if (
        h.includes("cloudnestra") ||
        h.includes("shadowlandschronicles") ||
        h.includes("embedsito")
      ) {
        referer = `https://${h}/`;
      }
    } catch {
      // invalid URL — use default referer
    }

    const upstream = await fetch(streamUrl, {
      headers: { "User-Agent": USER_AGENT, Referer: referer, Accept: "*/*" },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("mpegurl") || streamUrl.includes(".m3u8")) {
      const text = await upstream.text();
      const rewritten = rewriteVidSrcM3U8(text, streamUrl, proxyBase);
      const body = new TextEncoder().encode(rewritten);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          ...CORS_HEADERS,
        },
      });
    }

    // Binary pass-through
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": ct || "application/octet-stream",
        ...CORS_HEADERS,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}
