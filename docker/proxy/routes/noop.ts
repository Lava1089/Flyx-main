/**
 * No-op handlers for analytics and sync endpoints.
 *
 * These endpoints accept requests silently so the frontend
 * doesn't encounter errors when calling them in self-hosted mode.
 */

import { jsonResponse } from "../lib/helpers";

export function handleNoop(type: "analytics" | "sync"): Response {
  if (type === "sync") {
    return jsonResponse({ success: true, data: {} });
  }
  return jsonResponse({ success: true, message: "Analytics received (local mode)" });
}
