/**
 * Channel Discovery Module
 * Exports all discovery-related functionality
 */

export * from './fetcher';
export * from './parser';

import { Channel, ChannelListResponse, TimingInfo } from '../types';
import { fetchChannelsPage, FetchOptions } from './fetcher';
import { parseChannelListHtml, ParseError } from './parser';

export { ParseError };

/**
 * Discover all available channels from DLHD
 * Fetches and parses the 24/7 channels page
 */
export async function discoverChannels(
  options?: FetchOptions
): Promise<{ channels: Channel[]; timing: TimingInfo }> {
  const startTime = Date.now();
  
  const result = await fetchChannelsPage(options);
  const channels = parseChannelListHtml(result.html);
  
  const timing: TimingInfo = {
    durationMs: Date.now() - startTime,
    startTime: new Date(startTime).toISOString(),
  };
  
  return { channels, timing };
}

/**
 * Build a ChannelListResponse from discovered channels
 */
export function buildChannelListResponse(
  channels: Channel[],
  timing: TimingInfo
): ChannelListResponse {
  return {
    success: true,
    channels,
    totalCount: channels.length,
    lastUpdated: new Date().toISOString(),
    timing,
  };
}
