/**
 * Stream Extraction Orchestrator
 * Coordinates the extraction of streams from DLHD players
 * 
 * Requirements: 4.3, 4.4, 4.5, 7.2
 * - WHEN the stream requires additional parameters, THE Stream_Extractor component 
 *   SHALL include all required parameters
 * - WHEN extraction succeeds, THE Stream_Extractor component SHALL return the 
 *   complete playable M3U8 URL with all headers needed
 * - IF extraction fails for one player, THEN THE Stream_Extractor component 
 *   SHALL attempt the next available player source
 * - WHEN all player sources fail, THE Worker SHALL return a comprehensive error 
 *   listing each failure reason
 * 
 * Updated January 2026: Now uses direct backend access as primary method
 * for 100% channel coverage. Falls back to embed scraping if direct fails.
 */

import { AuthContext, Env, ExtractedStream, PlayerSource } from '../types';
import { fetchEmbedPage, EmbedFetchResult } from './embed-fetcher';
import { extractM3U8Url, extractAllM3U8Urls, extractRequiredHeaders, M3U8ExtractionResult } from './m3u8-extractor';
import { decodeUrl, extractEncodedUrls, DecodeResult } from './url-decoder';
import { extractDirectStream, extractFast } from '../direct';

const DLHD_BASE_URL = 'https://dlhd.link';

/**
 * Error codes for stream extraction
 */
export type ExtractionErrorCode = 
  | 'EMBED_FETCH_FAILED'
  | 'NO_M3U8_FOUND'
  | 'DECODE_FAILED'
  | 'ALL_PLAYERS_FAILED'
  | 'INVALID_PLAYER'
  | 'AUTH_REQUIRED'
  | 'DIRECT_BACKEND_FAILED';

/**
 * Stream extraction error
 */
export class StreamExtractionError extends Error {
  code: ExtractionErrorCode;
  playerId?: number;
  details?: Record<string, unknown>;

  constructor(
    message: string, 
    code: ExtractionErrorCode, 
    playerId?: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StreamExtractionError';
    this.code = code;
    this.playerId = playerId;
    this.details = details;
  }
}

/**
 * Result of a single player extraction attempt
 */
export interface PlayerExtractionAttempt {
  playerId: number;
  playerName?: string;
  success: boolean;
  stream?: ExtractedStream;
  error?: string;
  errorCode?: ExtractionErrorCode;
  durationMs: number;
  /** Additional error details */
  errorDetails?: Record<string, unknown>;
  /** Timestamp when the attempt started */
  startedAt?: string;
  /** Timestamp when the attempt ended */
  endedAt?: string;
}

/**
 * Aggregated error information for multi-player failures
 * Requirements: 7.2
 */
export interface AggregatedError {
  /** Total number of players attempted */
  totalAttempts: number;
  /** Number of failed attempts */
  failedAttempts: number;
  /** Summary message */
  summary: string;
  /** Detailed error for each player */
  playerErrors: PlayerErrorDetail[];
  /** Error codes and their counts */
  errorCodeCounts: Record<string, number>;
  /** Most common error code */
  mostCommonError?: ExtractionErrorCode;
  /** Total duration of all attempts */
  totalDurationMs: number;
  /** Average duration per attempt */
  averageDurationMs: number;
}

/**
 * Detailed error information for a single player
 */
export interface PlayerErrorDetail {
  playerId: number;
  playerName?: string;
  errorCode?: ExtractionErrorCode;
  errorMessage: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

/**
 * Result of extracting from all players
 */
export interface ExtractionResult {
  success: boolean;
  stream?: ExtractedStream;
  playerId?: number;
  attempts: PlayerExtractionAttempt[];
  totalDurationMs: number;
  /** Aggregated error information when all players fail */
  aggregatedError?: AggregatedError;
}

/**
 * Options for stream extraction
 */
export interface ExtractionOptions {
  /** Maximum number of players to try */
  maxPlayers?: number;
  /** Timeout per player in ms */
  timeoutPerPlayer?: number;
  /** Whether to try unavailable players as fallback */
  tryUnavailable?: boolean;
  /** Whether to try direct backend access first (default: true) */
  tryDirectBackend?: boolean;
  /** Environment bindings for proxy config */
  env?: Env;
}

const DEFAULT_OPTIONS: Required<Omit<ExtractionOptions, 'env'>> = {
  maxPlayers: 6,
  timeoutPerPlayer: 30000,
  tryUnavailable: true,
  tryDirectBackend: true,
};


/**
 * Build the referer URL for a channel
 */
function buildChannelReferer(channelId: string): string {
  return `${DLHD_BASE_URL}/watch.php?id=${channelId}`;
}

/**
 * Determine the origin from an embed URL
 */
function getOriginFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return DLHD_BASE_URL;
  }
}

/**
 * Build required headers for stream requests
 */
function buildStreamHeaders(
  embedUrl: string,
  embedPageUrl: string,
  extractedHeaders: Record<string, string>
): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': embedPageUrl,
    'Origin': getOriginFromUrl(embedUrl),
    ...extractedHeaders,
  };
}

/**
 * Check if a URL looks like an encrypted stream
 */
function isEncryptedStream(m3u8Url: string): boolean {
  // Encrypted streams often have specific patterns
  return m3u8Url.includes('key=') || 
         m3u8Url.includes('/enc/') ||
         m3u8Url.includes('encrypted');
}

/**
 * Extract stream from a single player
 * 
 * @param player - The player source to extract from
 * @param channelId - The channel ID
 * @param authContext - Authentication context
 */
export async function extractFromPlayer(
  player: PlayerSource,
  channelId: string,
  authContext?: AuthContext
): Promise<ExtractedStream> {
  const startTime = Date.now();
  const referer = buildChannelReferer(channelId);
  
  // Fetch the embed page
  let embedResult: EmbedFetchResult;
  try {
    embedResult = await fetchEmbedPage(player.embedUrl, referer, authContext);
  } catch (error) {
    throw new StreamExtractionError(
      `Failed to fetch embed page: ${error instanceof Error ? error.message : String(error)}`,
      'EMBED_FETCH_FAILED',
      player.id,
      { embedUrl: player.embedUrl }
    );
  }
  
  // Try to extract M3U8 URL
  let m3u8Result: M3U8ExtractionResult | null = null;
  
  // First try direct extraction
  m3u8Result = extractM3U8Url(embedResult.html, player.id);
  
  // If not found, try extracting encoded URLs
  if (!m3u8Result) {
    const encodedResults = extractEncodedUrls(embedResult.html);
    for (const encoded of encodedResults) {
      if (encoded.success && encoded.url.includes('.m3u8')) {
        m3u8Result = {
          url: encoded.url,
          wasEncoded: true,
          method: 'base64-decode',
        };
        break;
      }
    }
  }
  
  // If still not found, try all extraction methods
  if (!m3u8Result) {
    const allUrls = extractAllM3U8Urls(embedResult.html);
    if (allUrls.length > 0) {
      m3u8Result = allUrls[0];
    }
  }
  
  if (!m3u8Result) {
    throw new StreamExtractionError(
      'No M3U8 URL found in embed page',
      'NO_M3U8_FOUND',
      player.id,
      { htmlLength: embedResult.html.length }
    );
  }
  
  // If URL was encoded, try to decode it
  let finalUrl = m3u8Result.url;
  if (m3u8Result.wasEncoded) {
    const decodeResult = decodeUrl(m3u8Result.url);
    if (decodeResult.success) {
      finalUrl = decodeResult.url;
    }
  }
  
  // Extract any required headers from the page
  const extractedHeaders = extractRequiredHeaders(embedResult.html);
  
  // Build the complete stream headers
  const headers = buildStreamHeaders(
    player.embedUrl,
    embedResult.finalUrl,
    extractedHeaders
  );
  
  return {
    m3u8Url: finalUrl,
    headers,
    referer: embedResult.finalUrl,
    origin: getOriginFromUrl(player.embedUrl),
    quality: undefined, // Could be extracted from URL or page
    isEncrypted: isEncryptedStream(finalUrl),
  };
}

/**
 * Extract the best available stream from a channel
 * Tries direct backend access first, then falls back to player scraping
 * 
 * Requirements: 7.2
 * - WHEN all player sources fail, THE Worker SHALL return a comprehensive error 
 *   listing each failure reason
 * 
 * Updated January 2026: Now uses direct backend access as primary method
 * for 100% channel coverage. Falls back to embed scraping if direct fails.
 * 
 * @param channelId - The channel ID
 * @param players - Available player sources (sorted by priority)
 * @param authContext - Authentication context
 * @param options - Extraction options
 */
export async function extractBestStream(
  channelId: string,
  players: PlayerSource[],
  authContext?: AuthContext,
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const attempts: PlayerExtractionAttempt[] = [];
  
  // Try FAST extractor first (uses cached server mappings + JWT caching)
  if (opts.tryDirectBackend) {
    const fastStart = Date.now();
    const fastStartedAt = new Date(fastStart).toISOString();
    
    try {
      const fastStream = await extractFast(channelId);
      
      if (fastStream) {
        attempts.push({
          playerId: 0, // 0 = direct backend
          playerName: 'Fast Extractor',
          success: true,
          stream: fastStream,
          durationMs: Date.now() - fastStart,
          startedAt: fastStartedAt,
          endedAt: new Date().toISOString(),
        });
        
        return {
          success: true,
          stream: fastStream,
          playerId: 0,
          attempts,
          totalDurationMs: Date.now() - startTime,
        };
      }
      
      // Fast extractor returned null - try slow path
      attempts.push({
        playerId: 0,
        playerName: 'Fast Extractor',
        success: false,
        error: 'Fast extractor returned no stream (channel not in server map)',
        errorCode: 'DIRECT_BACKEND_FAILED',
        durationMs: Date.now() - fastStart,
        startedAt: fastStartedAt,
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      attempts.push({
        playerId: 0,
        playerName: 'Fast Extractor',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'DIRECT_BACKEND_FAILED',
        durationMs: Date.now() - fastStart,
        startedAt: fastStartedAt,
        endedAt: new Date().toISOString(),
      });
    }
    
    // Fall back to slow direct backend
    const directStart = Date.now();
    const directStartedAt = new Date(directStart).toISOString();
    
    try {
      const directStream = await extractDirectStream(channelId, opts.env);
      
      if (directStream) {
        attempts.push({
          playerId: -1, // -1 = slow direct backend
          playerName: 'Direct Backend (Slow)',
          success: true,
          stream: directStream,
          durationMs: Date.now() - directStart,
          startedAt: directStartedAt,
          endedAt: new Date().toISOString(),
        });
        
        return {
          success: true,
          stream: directStream,
          playerId: -1,
          attempts,
          totalDurationMs: Date.now() - startTime,
        };
      }
      
      attempts.push({
        playerId: -1,
        playerName: 'Direct Backend (Slow)',
        success: false,
        error: 'Direct backend returned no stream',
        errorCode: 'DIRECT_BACKEND_FAILED',
        durationMs: Date.now() - directStart,
        startedAt: directStartedAt,
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      attempts.push({
        playerId: -1,
        playerName: 'Direct Backend (Slow)',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'DIRECT_BACKEND_FAILED',
        durationMs: Date.now() - directStart,
        startedAt: directStartedAt,
        endedAt: new Date().toISOString(),
      });
    }
    
    console.log(`[Orchestrator] Direct backends failed, falling back to player scraping`);
  }
  
  // Fall back to player scraping
  // Filter and limit players
  let playersToTry = players
    .filter(p => opts.tryUnavailable || p.available)
    .slice(0, opts.maxPlayers);
  
  // Sort by priority (lower = better)
  playersToTry = playersToTry.sort((a, b) => a.priority - b.priority);
  
  for (const player of playersToTry) {
    const attemptStart = Date.now();
    const startedAt = new Date(attemptStart).toISOString();
    
    try {
      const stream = await extractFromPlayer(player, channelId, authContext);
      
      attempts.push({
        playerId: player.id,
        playerName: player.name,
        success: true,
        stream,
        durationMs: Date.now() - attemptStart,
        startedAt,
        endedAt: new Date().toISOString(),
      });
      
      return {
        success: true,
        stream,
        playerId: player.id,
        attempts,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof StreamExtractionError ? error : 
        new StreamExtractionError(
          error instanceof Error ? error.message : String(error),
          'EMBED_FETCH_FAILED',
          player.id
        );
      
      attempts.push({
        playerId: player.id,
        playerName: player.name,
        success: false,
        error: err.message,
        errorCode: err.code,
        errorDetails: err.details,
        durationMs: Date.now() - attemptStart,
        startedAt,
        endedAt: new Date().toISOString(),
      });
      
      // Continue to next player
    }
  }
  
  // All players failed - build aggregated error
  const aggregatedError = aggregateErrors(attempts);
  
  return {
    success: false,
    attempts,
    totalDurationMs: Date.now() - startTime,
    aggregatedError,
  };
}


/**
 * Extract stream from a specific player by ID
 * 
 * @param channelId - The channel ID
 * @param playerId - The player ID (1-6)
 * @param players - Available player sources
 * @param authContext - Authentication context
 */
export async function extractFromPlayerId(
  channelId: string,
  playerId: number,
  players: PlayerSource[],
  authContext?: AuthContext
): Promise<ExtractedStream> {
  const player = players.find(p => p.id === playerId);
  
  if (!player) {
    throw new StreamExtractionError(
      `Player ${playerId} not found`,
      'INVALID_PLAYER',
      playerId
    );
  }
  
  return extractFromPlayer(player, channelId, authContext);
}

/**
 * Build a comprehensive error message from extraction attempts
 */
export function buildErrorMessage(attempts: PlayerExtractionAttempt[]): string {
  if (attempts.length === 0) {
    return 'No players were attempted';
  }
  
  const failedAttempts = attempts.filter(a => !a.success);
  
  if (failedAttempts.length === 0) {
    return 'All attempts succeeded';
  }
  
  const messages = failedAttempts.map(a => 
    `Player ${a.playerId}${a.playerName ? ` (${a.playerName})` : ''}: ${a.error || 'Unknown error'}`
  );
  
  return `All ${failedAttempts.length} player(s) failed:\n${messages.join('\n')}`;
}

/**
 * Aggregate errors from multiple player extraction attempts
 * 
 * Requirements: 7.2
 * - WHEN all player sources fail, THE Worker SHALL return a comprehensive error 
 *   listing each failure reason
 * 
 * @param attempts - Array of player extraction attempts
 * @returns Aggregated error information
 */
export function aggregateErrors(attempts: PlayerExtractionAttempt[]): AggregatedError {
  const failedAttempts = attempts.filter(a => !a.success);
  const totalDuration = attempts.reduce((sum, a) => sum + a.durationMs, 0);
  
  // Count error codes
  const errorCodeCounts: Record<string, number> = {};
  for (const attempt of failedAttempts) {
    if (attempt.errorCode) {
      errorCodeCounts[attempt.errorCode] = (errorCodeCounts[attempt.errorCode] || 0) + 1;
    }
  }
  
  // Find most common error
  let mostCommonError: ExtractionErrorCode | undefined;
  let maxCount = 0;
  for (const [code, count] of Object.entries(errorCodeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonError = code as ExtractionErrorCode;
    }
  }
  
  // Build player error details
  const playerErrors: PlayerErrorDetail[] = failedAttempts.map(a => ({
    playerId: a.playerId,
    playerName: a.playerName,
    errorCode: a.errorCode,
    errorMessage: a.error || 'Unknown error',
    durationMs: a.durationMs,
    details: a.errorDetails,
  }));
  
  // Build summary message
  const summary = buildErrorSummary(failedAttempts, mostCommonError);
  
  return {
    totalAttempts: attempts.length,
    failedAttempts: failedAttempts.length,
    summary,
    playerErrors,
    errorCodeCounts,
    mostCommonError,
    totalDurationMs: totalDuration,
    averageDurationMs: attempts.length > 0 ? totalDuration / attempts.length : 0,
  };
}

/**
 * Build a human-readable error summary
 */
function buildErrorSummary(
  failedAttempts: PlayerExtractionAttempt[],
  mostCommonError?: ExtractionErrorCode
): string {
  if (failedAttempts.length === 0) {
    return 'No failures occurred';
  }
  
  const playerIds = failedAttempts.map(a => a.playerId).join(', ');
  let summary = `All ${failedAttempts.length} player(s) failed (Players: ${playerIds})`;
  
  if (mostCommonError) {
    const errorDescriptions: Record<ExtractionErrorCode, string> = {
      'EMBED_FETCH_FAILED': 'Failed to fetch embed pages',
      'NO_M3U8_FOUND': 'No stream URLs found in pages',
      'DECODE_FAILED': 'Failed to decode stream URLs',
      'ALL_PLAYERS_FAILED': 'All extraction methods failed',
      'INVALID_PLAYER': 'Invalid player configuration',
      'AUTH_REQUIRED': 'Authentication required',
      'DIRECT_BACKEND_FAILED': 'Direct backend access failed',
    };
    
    const description = errorDescriptions[mostCommonError] || mostCommonError;
    summary += `. Most common issue: ${description}`;
  }
  
  return summary;
}

/**
 * Get extraction statistics from attempts
 */
export function getExtractionStats(attempts: PlayerExtractionAttempt[]): {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  averageDurationMs: number;
  errorCodes: Record<string, number>;
} {
  const successful = attempts.filter(a => a.success);
  const failed = attempts.filter(a => !a.success);
  
  const errorCodes: Record<string, number> = {};
  for (const attempt of failed) {
    if (attempt.errorCode) {
      errorCodes[attempt.errorCode] = (errorCodes[attempt.errorCode] || 0) + 1;
    }
  }
  
  const totalDuration = attempts.reduce((sum, a) => sum + a.durationMs, 0);
  
  return {
    totalAttempts: attempts.length,
    successfulAttempts: successful.length,
    failedAttempts: failed.length,
    averageDurationMs: attempts.length > 0 ? totalDuration / attempts.length : 0,
    errorCodes,
  };
}
