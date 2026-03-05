/**
 * M3U8 URL Extractor
 * Parses embed page source to extract M3U8 stream URLs
 * 
 * Requirements: 4.1
 * - WHEN a player embed page is loaded, THE Stream_Extractor component 
 *   SHALL parse the page to find the M3U8 URL
 */

/**
 * Extraction result containing the M3U8 URL and metadata
 */
export interface M3U8ExtractionResult {
  /** The extracted M3U8 URL */
  url: string;
  /** Whether the URL was encoded/obfuscated */
  wasEncoded: boolean;
  /** The extraction method used */
  method: ExtractionMethod;
  /** Additional metadata from extraction */
  metadata?: Record<string, string>;
}

/**
 * Methods used to extract M3U8 URLs
 */
export type ExtractionMethod = 
  | 'direct-regex'
  | 'source-tag'
  | 'javascript-variable'
  | 'json-config'
  | 'hls-source'
  | 'base64-decode'
  | 'custom-decode';

/**
 * Player-specific extraction configuration
 */
export interface PlayerExtractionConfig {
  /** Player ID (1-6) */
  playerId: number;
  /** Regex patterns to try for this player */
  patterns: RegExp[];
  /** Whether this player typically uses encoding */
  usesEncoding: boolean;
  /** Custom extraction function if needed */
  customExtractor?: (html: string) => string | null;
}

/**
 * Common M3U8 URL patterns found in embed pages
 */
const M3U8_PATTERNS: RegExp[] = [
  // Direct .m3u8 URLs in source tags or variables
  /(?:src|source|file|url|stream)\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/gi,
  
  // HLS.js source configuration
  /hls\.loadSource\s*\(\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // Video.js or similar player source
  /sources?\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // JWPlayer source
  /jwplayer\s*\([^)]*\)\.setup\s*\(\s*\{[^}]*file\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // Generic URL assignment
  /(?:var|let|const)\s+\w*(?:url|source|stream|file)\w*\s*=\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // Atob/base64 decoded URLs (capture the encoded part)
  /atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/gi,
  
  // Data attribute with m3u8
  /data-(?:src|source|stream|url)\s*=\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // Iframe src with m3u8
  /iframe[^>]*src\s*=\s*["']([^"']+\.m3u8[^"']*)/gi,
  
  // JSON embedded in script
  /"(?:url|src|file|source)"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
  
  // Simple URL pattern (fallback)
  /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi,
];


/**
 * Player-specific extraction configurations
 */
const PLAYER_CONFIGS: PlayerExtractionConfig[] = [
  {
    playerId: 1,
    patterns: [
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
    ],
    usesEncoding: false,
  },
  {
    playerId: 2,
    patterns: [
      /hls\.loadSource\s*\(\s*["']([^"']+)/gi,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
    ],
    usesEncoding: true,
  },
  {
    playerId: 3,
    patterns: [
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
      /sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)/gi,
    ],
    usesEncoding: false,
  },
  {
    playerId: 4,
    patterns: [
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
      /stream_url\s*=\s*["']([^"']+)/gi,
    ],
    usesEncoding: true,
  },
  {
    playerId: 5,
    patterns: [
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
    ],
    usesEncoding: false,
  },
  {
    playerId: 6,
    patterns: [
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)/gi,
      /hls\.loadSource\s*\(\s*["']([^"']+)/gi,
    ],
    usesEncoding: true,
  },
];

/**
 * Check if a string looks like a valid M3U8 URL
 */
export function isValidM3U8Url(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  // Must be a valid URL
  try {
    new URL(url);
  } catch {
    return false;
  }
  
  // Should contain .m3u8 or be an HLS endpoint
  return url.includes('.m3u8') || 
         url.includes('/hls/') || 
         url.includes('/live/') ||
         url.includes('/stream/');
}

/**
 * Clean and normalize an extracted URL
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  
  // Remove any surrounding whitespace
  let cleaned = url.trim();
  
  // Remove any escape sequences
  cleaned = cleaned.replace(/\\(.)/g, '$1');
  
  // Decode HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  return cleaned;
}

/**
 * Extract M3U8 URL using regex patterns
 */
export function extractWithRegex(html: string, patterns: RegExp[]): M3U8ExtractionResult | null {
  for (const pattern of patterns) {
    // Reset regex state
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = normalizeUrl(match[1]);
      
      if (isValidM3U8Url(url)) {
        return {
          url,
          wasEncoded: false,
          method: 'direct-regex',
        };
      }
    }
  }
  
  return null;
}

/**
 * Extract M3U8 URL from source/video tags
 */
export function extractFromSourceTags(html: string): M3U8ExtractionResult | null {
  // Look for <source> tags
  const sourcePattern = /<source[^>]*src\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']application\/x-mpegURL["']/gi;
  
  let match;
  while ((match = sourcePattern.exec(html)) !== null) {
    const url = normalizeUrl(match[1]);
    if (isValidM3U8Url(url)) {
      return {
        url,
        wasEncoded: false,
        method: 'source-tag',
      };
    }
  }
  
  // Also check for type before src
  const sourcePattern2 = /<source[^>]*type\s*=\s*["']application\/x-mpegURL["'][^>]*src\s*=\s*["']([^"']+)["']/gi;
  
  while ((match = sourcePattern2.exec(html)) !== null) {
    const url = normalizeUrl(match[1]);
    if (isValidM3U8Url(url)) {
      return {
        url,
        wasEncoded: false,
        method: 'source-tag',
      };
    }
  }
  
  return null;
}

/**
 * Extract M3U8 URL from JavaScript variables
 */
export function extractFromJsVariables(html: string): M3U8ExtractionResult | null {
  const patterns = [
    /(?:var|let|const)\s+(?:source|src|file|url|stream|m3u8|hls)(?:Url|URL|Source|File)?\s*=\s*["']([^"']+)/gi,
    /(?:source|src|file|url|stream|m3u8|hls)(?:Url|URL|Source|File)?\s*:\s*["']([^"']+)/gi,
  ];
  
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    
    while ((match = pattern.exec(html)) !== null) {
      const url = normalizeUrl(match[1]);
      if (isValidM3U8Url(url)) {
        return {
          url,
          wasEncoded: false,
          method: 'javascript-variable',
        };
      }
    }
  }
  
  return null;
}

/**
 * Extract M3U8 URL from JSON configuration blocks
 */
export function extractFromJsonConfig(html: string): M3U8ExtractionResult | null {
  // Look for JSON-like structures
  const jsonPattern = /\{[^{}]*"(?:source|src|file|url|stream)"[^{}]*\}/gi;
  
  let match;
  while ((match = jsonPattern.exec(html)) !== null) {
    try {
      const jsonStr = match[0];
      const parsed = JSON.parse(jsonStr);
      
      const url = parsed.source || parsed.src || parsed.file || parsed.url || parsed.stream;
      if (url && isValidM3U8Url(normalizeUrl(url))) {
        return {
          url: normalizeUrl(url),
          wasEncoded: false,
          method: 'json-config',
        };
      }
    } catch {
      // Not valid JSON, continue
    }
  }
  
  return null;
}

/**
 * Extract M3U8 URL from HLS.js loadSource calls
 */
export function extractFromHlsSource(html: string): M3U8ExtractionResult | null {
  const patterns = [
    /hls\.loadSource\s*\(\s*["']([^"']+)["']\s*\)/gi,
    /Hls\s*\(\s*\)\.loadSource\s*\(\s*["']([^"']+)["']\s*\)/gi,
    /\.loadSource\s*\(\s*["']([^"']+\.m3u8[^"']*)["']\s*\)/gi,
  ];
  
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    
    while ((match = pattern.exec(html)) !== null) {
      const url = normalizeUrl(match[1]);
      if (isValidM3U8Url(url)) {
        return {
          url,
          wasEncoded: false,
          method: 'hls-source',
        };
      }
    }
  }
  
  return null;
}


/**
 * Get player-specific extraction configuration
 */
export function getPlayerConfig(playerId: number): PlayerExtractionConfig | null {
  return PLAYER_CONFIGS.find(c => c.playerId === playerId) || null;
}

/**
 * Extract M3U8 URL from embed page HTML
 * Tries multiple extraction methods in order of reliability
 * 
 * @param html - The HTML content of the embed page
 * @param playerId - Optional player ID for player-specific extraction
 */
export function extractM3U8Url(html: string, playerId?: number): M3U8ExtractionResult | null {
  // If we have a player ID, try player-specific patterns first
  if (playerId !== undefined) {
    const config = getPlayerConfig(playerId);
    if (config) {
      const result = extractWithRegex(html, config.patterns);
      if (result) {
        return result;
      }
      
      // Try custom extractor if available
      if (config.customExtractor) {
        const url = config.customExtractor(html);
        if (url && isValidM3U8Url(url)) {
          return {
            url,
            wasEncoded: config.usesEncoding,
            method: 'custom-decode',
          };
        }
      }
    }
  }
  
  // Try HLS.js source extraction (most reliable for modern players)
  let result = extractFromHlsSource(html);
  if (result) return result;
  
  // Try source tag extraction
  result = extractFromSourceTags(html);
  if (result) return result;
  
  // Try JavaScript variable extraction
  result = extractFromJsVariables(html);
  if (result) return result;
  
  // Try JSON config extraction
  result = extractFromJsonConfig(html);
  if (result) return result;
  
  // Try generic regex patterns
  result = extractWithRegex(html, M3U8_PATTERNS);
  if (result) return result;
  
  return null;
}

/**
 * Extract all M3U8 URLs from embed page HTML
 * Returns all found URLs for debugging/fallback purposes
 */
export function extractAllM3U8Urls(html: string): M3U8ExtractionResult[] {
  const results: M3U8ExtractionResult[] = [];
  const seenUrls = new Set<string>();
  
  // Try all extraction methods
  const methods = [
    () => extractFromHlsSource(html),
    () => extractFromSourceTags(html),
    () => extractFromJsVariables(html),
    () => extractFromJsonConfig(html),
    () => extractWithRegex(html, M3U8_PATTERNS),
  ];
  
  for (const method of methods) {
    const result = method();
    if (result && !seenUrls.has(result.url)) {
      seenUrls.add(result.url);
      results.push(result);
    }
  }
  
  // Also do a comprehensive regex scan
  const urlPattern = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
  let match;
  
  while ((match = urlPattern.exec(html)) !== null) {
    const url = normalizeUrl(match[1]);
    if (isValidM3U8Url(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({
        url,
        wasEncoded: false,
        method: 'direct-regex',
      });
    }
  }
  
  return results;
}

/**
 * Extract required headers from embed page
 * Some streams require specific headers that are embedded in the page
 */
export function extractRequiredHeaders(html: string): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // Look for header configurations in JavaScript
  const headerPatterns = [
    /headers?\s*:\s*\{([^}]+)\}/gi,
    /setRequestHeader\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/gi,
  ];
  
  // Extract from header object
  const headerObjPattern = headerPatterns[0];
  headerObjPattern.lastIndex = 0;
  let match = headerObjPattern.exec(html);
  
  if (match) {
    const headerStr = match[1];
    const keyValuePattern = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
    let kvMatch;
    
    while ((kvMatch = keyValuePattern.exec(headerStr)) !== null) {
      headers[kvMatch[1]] = kvMatch[2];
    }
  }
  
  // Extract from setRequestHeader calls
  const setHeaderPattern = headerPatterns[1];
  setHeaderPattern.lastIndex = 0;
  
  while ((match = setHeaderPattern.exec(html)) !== null) {
    headers[match[1]] = match[2];
  }
  
  return headers;
}
