/**
 * Stream Extraction Module
 * 
 * Exports all stream extraction functionality
 */

// Embed page fetcher
export {
  fetchEmbedPage,
  buildEmbedHeaders,
  getPlayerDomain,
  isKnownPlayerDomain,
  PLAYER_DOMAINS,
  type EmbedFetchOptions,
  type EmbedFetchResult,
} from './embed-fetcher';

// M3U8 URL extractor
export {
  extractM3U8Url,
  extractAllM3U8Urls,
  extractRequiredHeaders,
  extractFromHlsSource,
  extractFromSourceTags,
  extractFromJsVariables,
  extractFromJsonConfig,
  extractWithRegex,
  isValidM3U8Url,
  normalizeUrl,
  getPlayerConfig,
  type M3U8ExtractionResult,
  type ExtractionMethod,
  type PlayerExtractionConfig,
} from './m3u8-extractor';

// URL decoder
export {
  decodeUrl,
  encodeUrl,
  decodeBase64,
  encodeBase64,
  decodeUrlEncoded,
  encodeUrlEncoded,
  decodeHex,
  encodeHex,
  rot13,
  reverseString,
  xorDecode,
  xorEncode,
  isBase64,
  isUrlEncoded,
  isHexEncoded,
  detectEncodingType,
  tryAllDecodings,
  extractEncodedUrls,
  type EncodingType,
  type DecodeResult,
} from './url-decoder';

// Stream extraction orchestrator
export {
  extractFromPlayer,
  extractBestStream,
  extractFromPlayerId,
  buildErrorMessage,
  aggregateErrors,
  getExtractionStats,
  StreamExtractionError,
  type ExtractionErrorCode,
  type PlayerExtractionAttempt,
  type ExtractionResult,
  type ExtractionOptions,
  type AggregatedError,
  type PlayerErrorDetail,
} from './orchestrator';
