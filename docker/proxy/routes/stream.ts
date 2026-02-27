/**
 * Generic HLS stream proxy.
 *
 * Handles /stream, /animekai, /cdn-live, /viprow, /tv, /dlhd routes.
 * Fetches remote resources, detects M3U8 vs binary content, applies
 * M3U8 rewriting, forwards Range headers, and detects content-type
 * from magic bytes.
 */

import { CORS_HEADERS, USER_AGENT, errorResponse, jsonResponse } from "../lib/helpers";
import { rewriteM3U8 } from "../lib/m3u8";

/**
 * Detect content-type from the first bytes of a binary buffer.
 *  - 0x47 → MPEG-TS
 *  - 0x00 0x00 0x00 → MP4
 *  - Otherwise fall back to upstream Content-Type or application/octet-stream
 */
export function detectContentType(
  buf: ArrayBuffer,
  upstreamCt: string,
): string {
  const view = new Uint8Array(buf);
  if (view.length > 0 && view[0] === 0x47) return "video/mp2t";
  if (
    view.length >= 3 &&
    view[0] === 0x00 &&
    view[1] === 0x00 &&
    view[2] === 0x00
  )
    return "video/mp4";
  return upstreamCt || "application/octet-stream";
}

/**
 * Check whether a response looks like an M3U8 manifest based on
 * Content-Type header or the target URL extension.
 */
function isM3U8(contentType: string, targetUrl: string): boolean {
  return (
    contentType.includes("mpegurl") ||
    contentType.includes("m3u8") ||
    targetUrl.includes(".m3u8")
  );
}

/**
 * Handle a stream proxy request.
 *
 * Expects `?url=<target>` in the query string. Optionally accepts
 * `?referer=<url>` and `?noreferer=true`.
 */
export async function handleStream(
  req: Request,
  url: URL,
  route: string,
): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) return errorResponse("Missing url parameter", 400);

  const referer = url.searchParams.get("referer") || "";
  const noReferer = url.searchParams.get("noreferer") === "true";

  try {
    // Build upstream request headers
    const hdrs: Record<string, string> = { "User-Agent": USER_AGENT };
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) hdrs["Range"] = rangeHeader;
    if (referer && !noReferer) {
      hdrs["Referer"] = referer;
      try {
        hdrs["Origin"] = new URL(referer).origin;
      } catch {
        // invalid referer URL — skip Origin
      }
    }

    const upstream = await fetch(targetUrl, {
      headers: hdrs,
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });

    const ct = upstream.headers.get("content-type") || "";

    // Build response headers — start with CORS
    const rh: Record<string, string> = { ...CORS_HEADERS };

    // Forward range-related headers from upstream
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (contentRange) rh["Content-Range"] = contentRange;
    if (acceptRanges) rh["Accept-Ranges"] = acceptRanges;

    // M3U8 manifest — rewrite URLs
    if (isM3U8(ct, targetUrl)) {
      const text = await upstream.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const proxyBase = `${url.protocol}//${url.host}`;
      const rewritten = rewriteM3U8(text, baseUrl, proxyBase, route, referer || undefined, noReferer || undefined);
      const body = new TextEncoder().encode(rewritten);
      rh["Content-Type"] = "application/vnd.apple.mpegurl";
      rh["Content-Length"] = String(body.length);
      return new Response(body, { status: upstream.status, headers: rh });
    }

    // Binary content — detect type from magic bytes
    const body = await upstream.arrayBuffer();
    const detectedCt = detectContentType(body, ct);
    rh["Content-Type"] = detectedCt;
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) rh["Content-Length"] = contentLength;

    return new Response(body, { status: upstream.status, headers: rh });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: `${route} proxy error`, message },
      502,
    );
  }
}
