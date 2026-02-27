/**
 * Analytics Endpoints Configuration
 * 
 * Routes analytics through Cloudflare Worker.
 * Supports two modes:
 *   1. Dedicated Analytics Worker (NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL) - Preferred
 *   2. Main CF Proxy with analytics route (NEXT_PUBLIC_CF_ANALYTICS_URL) - Legacy
 * 
 * Leverages CF's free tier (100k req/day).
 * 
 * Usage:
 *   import { getAnalyticsEndpoint } from '@/lib/utils/analytics-endpoints';
 *   const url = getAnalyticsEndpoint('presence');
 */

// Hardcoded fallback for CF analytics worker URL
const CF_ANALYTICS_WORKER_FALLBACK = 'https://flyx-analytics.vynx.workers.dev';

function getCfAnalyticsDedicatedWorkerUrl(): string | null {
  // NEXT_PUBLIC_ env vars are inlined at build time
  // Use hardcoded fallback if env var not set (ensures D1 is always used)
  return process.env.NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL || CF_ANALYTICS_WORKER_FALLBACK;
}

function getCfAnalyticsUrl(): string | null {
  // NEXT_PUBLIC_ env vars are inlined at build time
  return process.env.NEXT_PUBLIC_CF_ANALYTICS_URL || null;
}

/**
 * Get the appropriate analytics endpoint URL
 * Routes through Cloudflare Worker
 * 
 * Priority:
 *   1. Dedicated Analytics Worker (NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL)
 *   2. Main CF Proxy (NEXT_PUBLIC_CF_ANALYTICS_URL)
 *   3. Local API routes (fallback)
 * 
 * @param endpoint - The endpoint name (presence, pageview, event, watch-session, live-activity, page-view, stats)
 * @returns The full URL to use for the analytics request
 */
export function getAnalyticsEndpoint(endpoint: 'presence' | 'pageview' | 'page-view' | 'event' | 'watch-session' | 'live-activity' | 'livetv-session' | 'stats' | 'traffic-sources' | 'presence-stats' | 'users' | 'user-engagement' | 'unified-stats' | 'admin-analytics' | 'activity-history' | 'system-health'): string {
  const dedicatedWorkerUrl = getCfAnalyticsDedicatedWorkerUrl();
  const cfUrl = getCfAnalyticsUrl();
  
  // Priority 1: Dedicated Analytics Worker
  if (dedicatedWorkerUrl) {
    // Map endpoint names to dedicated worker routes
    const workerEndpoints: Record<string, string> = {
      'presence': '/presence',
      'pageview': '/page-view',
      'page-view': '/page-view',
      'event': '/events', // Generic events endpoint
      'watch-session': '/watch-session',
      'live-activity': '/live-activity',
      'livetv-session': '/livetv-session',
      'stats': '/stats',
      'traffic-sources': '/traffic-sources',
      'presence-stats': '/presence-stats',
      'users': '/users',
      'user-engagement': '/user-engagement',
      'unified-stats': '/unified-stats',
      'admin-analytics': '/stats',
      'activity-history': '/activity-history',
      'system-health': '/system-health',
    };
    return `${dedicatedWorkerUrl}${workerEndpoints[endpoint] || `/${endpoint}`}`;
  }
  
  // Priority 2: Main CF Proxy with analytics route
  if (cfUrl) {
    // Route through Cloudflare Worker
    // Map endpoint names to CF routes
    const cfEndpoints: Record<string, string> = {
      'presence': '/presence',
      'pageview': '/pageview',
      'page-view': '/pageview',
      'event': '/event',
      'watch-session': '/watch-session',
      'live-activity': '/live-activity',
      'livetv-session': '/livetv-session',
      'stats': '/stats',
      'traffic-sources': '/traffic-sources',
      'presence-stats': '/presence-stats',
      'users': '/users',
      'user-engagement': '/user-engagement',
      'unified-stats': '/unified-stats',
      'admin-analytics': '/stats',
      'activity-history': '/activity-history',
      'system-health': '/system-health',
    };
    return `${cfUrl}${cfEndpoints[endpoint] || `/${endpoint}`}`;
  }
  
  // Fallback to local API routes
  const localEndpoints: Record<string, string> = {
    'presence': '/api/analytics/presence',
    'pageview': '/api/analytics/page-view',
    'page-view': '/api/analytics/page-view',
    'event': '/api/analytics/track',
    'watch-session': '/api/analytics/watch-session',
    'live-activity': '/api/analytics/live-activity',
    'livetv-session': '/api/analytics/livetv-session',
    'stats': '/api/admin/analytics',
    'traffic-sources': '/api/admin/analytics/traffic-sources',
    'presence-stats': '/api/admin/analytics/presence-stats',
    'users': '/api/admin/users',
    'user-engagement': '/api/analytics/user-engagement',
    'unified-stats': '/api/admin/unified-stats',
    'admin-analytics': '/api/admin/analytics',
    'activity-history': '/api/admin/analytics/activity-history',
    'system-health': '/api/admin/system-health',
  };
  return localEndpoints[endpoint] || `/api/analytics/${endpoint}`;
}

/**
 * Check if analytics is routed through Cloudflare
 */
export function isUsingCloudflareAnalytics(): boolean {
  return getCfAnalyticsDedicatedWorkerUrl() !== null || getCfAnalyticsUrl() !== null;
}

/**
 * Get analytics configuration info (for debugging)
 */
export function getAnalyticsConfig(): {
  provider: 'cloudflare-dedicated' | 'cloudflare-proxy' | 'local';
  baseUrl: string | null;
} {
  const dedicatedUrl = getCfAnalyticsDedicatedWorkerUrl();
  const cfUrl = getCfAnalyticsUrl();
  
  if (dedicatedUrl) {
    return {
      provider: 'cloudflare-dedicated',
      baseUrl: dedicatedUrl,
    };
  }
  
  if (cfUrl) {
    return {
      provider: 'cloudflare-proxy',
      baseUrl: cfUrl,
    };
  }
  
  return {
    provider: 'local',
    baseUrl: null,
  };
}
