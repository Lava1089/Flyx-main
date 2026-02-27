/**
 * Proxy server entry point.
 *
 * Route dispatch via Bun.serve — no business logic here,
 * only route matching and delegation to handler modules.
 */

import { CORS_HEADERS, jsonResponse, errorResponse } from "./lib/helpers";
import { handleStream } from "./routes/stream";
import { handleTMDB } from "./routes/tmdb";
import { handleFlixerExtract, isWasmLoaded } from "./routes/flixer";
import { handleVidSrcExtract, handleVidSrcStream } from "./routes/vidsrc";
import { handleHiAnimeExtract, handleHiAnimeStream } from "./routes/hianime";
import { handleNoop } from "./routes/noop";

const PORT = parseInt(process.env.PROXY_PORT || "8787", 10);
const startTime = Date.now();
let totalRequests = 0;
let totalErrors = 0;

/** Build the proxy base URL from the incoming request. */
function proxyBase(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

/** Stream-proxy route names that all share the same handleStream logic. */
const STREAM_ROUTES = new Set([
  "stream",
  "animekai",
  "cdn-live",
  "viprow",
  "tv",
  "dlhd",
]);

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    totalRequests++;
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // OPTIONS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Health endpoint
      if (path === "/health") {
        const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        return jsonResponse({
          status: "healthy",
          mode: "self-hosted",
          uptime: `${h}h ${m}m ${s}s`,
          metrics: { requests: totalRequests, errors: totalErrors },
          flixerWasm: isWasmLoaded(),
        });
      }

      // Parse first path segment: /segment/...
      const segments = path.split("/").filter(Boolean);
      const first = segments[0] || "";

      // Generic stream proxy routes
      // Matches both /route/stream?url=... and /route?url=... patterns
      if (STREAM_ROUTES.has(first)) {
        if (segments[1] === "stream" || (!segments[1] && url.searchParams.has("url"))) {
          return await handleStream(req, url, first);
        }
      }

      // TMDB proxy — /tmdb/*
      if (first === "tmdb") {
        return await handleTMDB(req, url);
      }

      // Flixer — /flixer/extract and /flixer/stream
      if (first === "flixer") {
        if (segments[1] === "extract") return await handleFlixerExtract(req, url);
        if (segments[1] === "stream") return await handleStream(req, url, "flixer");
      }

      // VidSrc — /vidsrc/extract and /vidsrc/stream
      if (first === "vidsrc") {
        if (segments[1] === "extract") return await handleVidSrcExtract(req, url);
        if (segments[1] === "stream") return await handleVidSrcStream(req, url, proxyBase(url));
      }

      // HiAnime — /hianime/extract and /hianime/stream
      if (first === "hianime") {
        if (segments[1] === "extract") return await handleHiAnimeExtract(req, url, proxyBase(url));
        if (segments[1] === "stream") return await handleHiAnimeStream(req, url, proxyBase(url));
      }

      // Analytics no-op
      if (first === "analytics") return handleNoop("analytics");

      // Sync no-op
      if (first === "sync") return handleNoop("sync");

      // Fallback
      return errorResponse("Not found", 404);
    } catch (err: unknown) {
      totalErrors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Server] Unhandled error:", message);
      return jsonResponse({ error: "Internal server error", message }, 500);
    }
  },
});

console.log(`[Proxy] Listening on port ${PORT}`);
