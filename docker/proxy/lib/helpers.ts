/**
 * Shared response helpers and constants for the proxy server.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Range, Content-Type, X-Request-ID, Authorization",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  "Access-Control-Max-Age": "86400",
};

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

export function corsResponse(
  body: BodyInit,
  headers: Record<string, string>,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, ...headers },
  });
}
