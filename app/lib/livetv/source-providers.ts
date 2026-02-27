/**
 * Live TV Source Providers
 * 
 * Unified interface for multiple live TV sources with automatic fallback.
 * Sources: DLHD (primary), cdn-live.tv, VIPRow (events)
 * 
 * Each provider implements the same interface for consistent handling.
 */

import { getTvPlaylistUrl } from '@/app/lib/proxy-config';

export type LiveTVSourceType = 'dlhd' | 'cdnlive' | 'viprow';

export interface StreamSource {
  type: LiveTVSourceType;
  name: string;
  priority: number;
  enabled: boolean;
}

export interface StreamResult {
  success: boolean;
  streamUrl?: string;
  source: LiveTVSourceType;
  headers?: Record<string, string>;
  error?: string;
  isLive?: boolean;
}

export interface ChannelMapping {
  dlhdId?: string;
  cdnliveId?: string;
  viprowUrl?: string;
}

// Source configuration - order determines fallback priority
export const LIVE_TV_SOURCES: StreamSource[] = [
  { type: 'dlhd', name: 'DLHD', priority: 1, enabled: true },
  { type: 'cdnlive', name: 'CDN Live', priority: 2, enabled: true },
  { type: 'viprow', name: 'VIPRow', priority: 3, enabled: true },
];

/**
 * Get stream URL from DLHD
 * Uses getTvPlaylistUrl helper which respects NEXT_PUBLIC_USE_DLHD_PROXY setting
 */
export async function getDLHDStream(channelId: string, _cfProxyUrl?: string): Promise<StreamResult> {
  try {
    // Use getTvPlaylistUrl helper for consistent proxy routing
    // Route is determined by NEXT_PUBLIC_USE_DLHD_PROXY: /tv or /dlhd
    const streamUrl = getTvPlaylistUrl(channelId);
    
    return {
      success: true,
      streamUrl,
      source: 'dlhd',
    };
  } catch (error: any) {
    return {
      success: false,
      source: 'dlhd',
      error: error.message || 'Failed to get DLHD stream',
    };
  }
}

/**
 * Get stream URL from cdn-live.tv
 * 
 * CDN Live now uses a channel-based API. The cdnliveId can be either:
 * - A channel name (e.g., "espn", "abc")
 * - A channel name with country code (e.g., "espn:us", "abc:us")
 * - Legacy eventId format (will be tried as channel name)
 */
export async function getCDNLiveStream(cdnliveId: string): Promise<StreamResult> {
  try {
    // Parse channel name and country code if provided
    let channel = cdnliveId;
    let code = '';
    
    if (cdnliveId.includes(':')) {
      const parts = cdnliveId.split(':');
      channel = parts[0];
      code = parts[1] || '';
    }
    
    // Build the API URL
    let apiUrl = `/api/livetv/cdnlive-stream?channel=${encodeURIComponent(channel)}`;
    if (code) {
      apiUrl += `&code=${encodeURIComponent(code)}`;
    }
    
    // Call our API to get the stream
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    if (!data.success) {
      // If we have a playerUrl, we can still use it for iframe embedding
      if (data.playerUrl) {
        return {
          success: true,
          streamUrl: data.playerUrl,
          source: 'cdnlive',
          headers: data.headers,
          isLive: data.isLive,
        };
      }
      
      return {
        success: false,
        source: 'cdnlive',
        error: data.error || 'Failed to extract CDN Live stream',
      };
    }
    
    // Prefer streamUrl if available, otherwise use playerUrl
    return {
      success: true,
      streamUrl: data.streamUrl || data.playerUrl,
      source: 'cdnlive',
      headers: data.headers,
      isLive: data.isLive,
    };
  } catch (error: any) {
    return {
      success: false,
      source: 'cdnlive',
      error: error.message || 'Failed to get CDN Live stream',
    };
  }
}

/**
 * Get stream URL from VIPRow
 * 
 * VIPRow streams are now handled directly by the Cloudflare Worker.
 * The /viprow/stream endpoint extracts and proxies the m3u8 with all URLs rewritten.
 */
export async function getVIPRowStream(viprowUrl: string, linkNum: number = 1): Promise<StreamResult> {
  try {
    // Check if Cloudflare proxy is configured
    const cfProxyUrl = process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL;
    
    if (!cfProxyUrl) {
      // Fallback to local API route which returns embed URL
      const apiUrl = `/api/livetv/viprow-stream?url=${encodeURIComponent(viprowUrl)}&link=${linkNum}`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      
      if (!data.success) {
        return {
          success: false,
          source: 'viprow',
          error: data.error || 'Failed to get VIPRow stream',
        };
      }
      
      // Return embed URL for iframe playback (fallback)
      return {
        success: true,
        streamUrl: data.playerUrl || data.embedUrl,
        source: 'viprow',
        headers: data.headers,
        isLive: true,
      };
    }
    
    // Use Cloudflare proxy directly - returns playable m3u8
    const baseUrl = cfProxyUrl.replace(/\/stream\/?$/, '');
    const streamUrl = `${baseUrl}/viprow/stream?url=${encodeURIComponent(viprowUrl)}&link=${linkNum}`;
    
    return {
      success: true,
      streamUrl,
      source: 'viprow',
      isLive: true,
    };
  } catch (error: any) {
    return {
      success: false,
      source: 'viprow',
      error: error.message || 'Failed to get VIPRow stream',
    };
  }
}

/**
 * Try multiple sources with automatic fallback
 */
export async function getStreamWithFallback(
  channelMapping: ChannelMapping,
  options?: {
    preferredSource?: LiveTVSourceType;
    cfProxyUrl?: string;
    excludeSources?: LiveTVSourceType[];
  }
): Promise<StreamResult> {
  const { preferredSource, cfProxyUrl, excludeSources = [] } = options || {};
  
  // Sort sources by priority, with preferred source first
  const sortedSources = [...LIVE_TV_SOURCES]
    .filter(s => s.enabled && !excludeSources.includes(s.type))
    .sort((a, b) => {
      if (preferredSource) {
        if (a.type === preferredSource) return -1;
        if (b.type === preferredSource) return 1;
      }
      return a.priority - b.priority;
    });
  
  const errors: string[] = [];
  
  for (const source of sortedSources) {
    let result: StreamResult;
    
    switch (source.type) {
      case 'dlhd':
        if (channelMapping.dlhdId) {
          result = await getDLHDStream(channelMapping.dlhdId, cfProxyUrl);
          if (result.success) return result;
          errors.push(`DLHD: ${result.error}`);
        }
        break;
        
      case 'cdnlive':
        if (channelMapping.cdnliveId) {
          result = await getCDNLiveStream(channelMapping.cdnliveId);
          if (result.success) return result;
          errors.push(`CDN Live: ${result.error}`);
        }
        break;
        
      case 'viprow':
        if (channelMapping.viprowUrl) {
          result = await getVIPRowStream(channelMapping.viprowUrl);
          if (result.success) return result;
          errors.push(`VIPRow: ${result.error}`);
        }
        break;
    }
  }
  
  return {
    success: false,
    source: 'dlhd',
    error: errors.length > 0 
      ? `All sources failed: ${errors.join('; ')}` 
      : 'No valid source mapping found',
  };
}
