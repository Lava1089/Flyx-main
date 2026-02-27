/**
 * M3U8 manifest URL rewriting.
 *
 * Rewrites segment URLs, key URIs, and relative paths in HLS manifests
 * so they route through the proxy server.
 */

/**
 * Resolve a URL that may be absolute or relative against a base URL.
 */
function resolveUrl(raw: string, baseUrl: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return new URL(raw, baseUrl).toString();
}

/**
 * Build a proxy URL for a given target URL.
 */
function proxyUrl(target: string, proxyBase: string, route: string, referer?: string, noReferer?: boolean): string {
  let url = `${proxyBase}/${route}/stream?url=${encodeURIComponent(target)}`;
  if (referer) {
    url += `&referer=${encodeURIComponent(referer)}`;
  }
  if (noReferer) {
    url += '&noreferer=true';
  }
  return url;
}

/**
 * Rewrite all segment URLs, key URIs (`URI="..."`), and relative paths
 * in an M3U8 manifest to route through the proxy.
 *
 * @param content   - Raw M3U8 manifest text
 * @param baseUrl   - Base URL for resolving relative paths (typically the directory of the manifest URL)
 * @param proxyBase - Origin of the proxy server (e.g. "http://localhost:8787")
 * @param route     - Route prefix for the proxy (e.g. "stream", "animekai", "cdn-live")
 * @param referer   - Optional referer to include in proxied URLs
 * @param noReferer - Optional flag to skip sending referer/origin to upstream
 */
export function rewriteM3U8(
  content: string,
  baseUrl: string,
  proxyBase: string,
  route: string,
  referer?: string,
  noReferer?: boolean,
): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      // Empty lines pass through
      if (!trimmed) return line;

      // Comment/tag lines — rewrite any URI="..." values
      if (trimmed.startsWith("#")) {
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri: string) => {
            const abs = resolveUrl(uri, baseUrl);
            return `URI="${proxyUrl(abs, proxyBase, route, referer, noReferer)}"`;
          });
        }
        return line;
      }

      // Data lines (segment URLs) — resolve and rewrite
      const abs = resolveUrl(trimmed, baseUrl);
      return proxyUrl(abs, proxyBase, route, referer, noReferer);
    })
    .join("\n");
}
