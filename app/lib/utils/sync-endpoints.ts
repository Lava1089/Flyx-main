/**
 * Sync Endpoints Configuration
 * 
 * Routes sync requests through Cloudflare Worker when available,
 * falls back to local API routes.
 */

// Cloudflare Sync Worker URL (set in environment)
const CF_SYNC_URL = process.env.NEXT_PUBLIC_CF_SYNC_URL || '';

/**
 * Check if Cloudflare sync worker is configured
 */
export function isUsingCloudflareSyncWorker(): boolean {
  return !!CF_SYNC_URL && CF_SYNC_URL.length > 0;
}

/**
 * Get the sync endpoint URL
 * Returns CF Worker URL if configured, otherwise falls back to local API
 */
export function getSyncEndpoint(): string {
  if (isUsingCloudflareSyncWorker()) {
    return `${CF_SYNC_URL}/sync`;
  }
  return '/api/sync';
}

/**
 * Get sync worker info for debugging
 */
export function getSyncWorkerInfo(): { 
  isCloudflare: boolean; 
  endpoint: string;
  workerUrl: string | null;
} {
  return {
    isCloudflare: isUsingCloudflareSyncWorker(),
    endpoint: getSyncEndpoint(),
    workerUrl: CF_SYNC_URL || null,
  };
}
