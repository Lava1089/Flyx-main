/**
 * Admin Analytics API Hook
 * Routes admin analytics requests through Cloudflare Worker when configured
 */

import { getAnalyticsEndpoint, isUsingCloudflareAnalytics } from '@/lib/utils/analytics-endpoints';

type AdminEndpoint = 
  | 'live-activity'
  | 'watch-session'
  | 'page-view'
  | 'livetv-session'
  | 'traffic-sources'
  | 'presence-stats'
  | 'users'
  | 'user-engagement'
  | 'unified-stats'
  | 'admin-analytics'
  | 'activity-history'
  | 'stats'
  | 'system-health';

/**
 * Get the URL for an admin analytics endpoint
 * Uses CF Worker if configured, otherwise falls back to local API
 */
export function getAdminAnalyticsUrl(endpoint: AdminEndpoint, params?: Record<string, string | number>): string {
  const baseUrl = getAnalyticsEndpoint(endpoint);
  
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    return `${baseUrl}?${searchParams.toString()}`;
  }
  
  return baseUrl;
}

/**
 * Fetch from admin analytics endpoint
 */
export async function fetchAdminAnalytics<T = any>(
  endpoint: AdminEndpoint,
  params?: Record<string, string | number>,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const url = getAdminAnalyticsUrl(endpoint, params);
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error(`[AdminAnalytics] Error fetching ${endpoint}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if using Cloudflare for analytics
 */
export function useCloudflareAnalytics(): boolean {
  if (typeof window === 'undefined') return false;
  return isUsingCloudflareAnalytics();
}

export { isUsingCloudflareAnalytics };
