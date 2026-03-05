/**
 * Player Detection Module
 * Exports all player detection functionality
 */

export {
  fetchChannelPage,
  fetchEmbedPage,
  buildChannelPageHeaders,
  extractCookies,
} from './fetcher';
export type { ChannelFetchResult } from './fetcher';

export {
  detectPlayers,
  detectPlayerElements,
  extractEmbedUrl,
  buildEmbedUrl,
  getAvailablePlayers,
  getBestPlayer,
  PlayerDetectionError,
} from './detector';
