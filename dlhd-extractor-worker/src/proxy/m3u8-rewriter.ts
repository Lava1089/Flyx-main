/**
 * M3U8 Playlist Rewriter
 * 
 * Requirements: 5.2
 * - THE Stream_Proxy component SHALL rewrite ALL URLs in M3U8 playlists 
 *   to route through our Worker proxy
 * - Handle relative and absolute URLs
 * - Preserve playlist structure and tags
 * 
 * DECRYPTION: Client-side decryption - we keep #EXT-X-KEY lines and proxy
 * the key URL through the worker. The client (HLS.js) handles decryption.
 * 
 * NOTE: dvalna.ru segments have a 32-byte header where bytes 16-31 contain
 * the real IV. The client must handle this custom format.
 */

import { encodeProxyUrl, resolveUrl, getResourceType, encodeBase64Url } from './url-encoder';

/**
 * Domains with custom encryption format (32-byte header with IV)
 * Client needs to handle the custom header format for these domains
 */
const CUSTOM_ENCRYPTION_DOMAINS = ['dvalna.ru', 'soyspace.cyou', 'adsfadfds.cfd'];

/**
 * M3U8 tag types that contain URLs
 */
const URL_TAGS = [
  '#EXT-X-KEY',
  '#EXT-X-MAP',
  '#EXT-X-MEDIA',
  '#EXT-X-I-FRAME-STREAM-INF',
  '#EXT-X-STREAM-INF',
  '#EXT-X-SESSION-DATA',
  '#EXT-X-SESSION-KEY',
  '#EXT-X-PRELOAD-HINT',
  '#EXT-X-RENDITION-REPORT',
  '#EXT-X-PART',
];

/**
 * Attributes that contain URLs
 */
const URL_ATTRIBUTES = ['URI', 'KEYFORMAT', 'KEYFORMATVERSIONS'];

/**
 * Result of M3U8 rewriting
 */
export interface M3U8RewriteResult {
  content: string;
  urlsRewritten: number;
  originalUrls: string[];
  rewrittenUrls: string[];
}

/**
 * Options for M3U8 rewriting
 */
export interface M3U8RewriteOptions {
  /** Base URL of the worker proxy */
  workerBaseUrl: string;
  /** Headers to include in proxied requests */
  headers: Record<string, string>;
  /** Base URL for resolving relative URLs */
  baseUrl: string;
  /** API key to include in URLs for VLC/media player compatibility */
  apiKey?: string;
}

/**
 * Parse an M3U8 attribute value that may be quoted
 */
function parseAttributeValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Quote an attribute value if needed
 */
function quoteAttributeValue(value: string): string {
  // Always quote URI values
  return `"${value}"`;
}

/**
 * Extract URI from a tag line
 */
function extractUri(line: string): string | null {
  const uriMatch = line.match(/URI="([^"]+)"/i);
  if (uriMatch) {
    return uriMatch[1];
  }
  return null;
}

/**
 * Replace URI in a tag line
 */
function replaceUri(line: string, newUri: string): string {
  return line.replace(/URI="[^"]+"/i, `URI="${newUri}"`);
}

/**
 * Check if a line is a URL (not a tag or comment)
 */
function isUrlLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return false;
  }
  // It's a URL if it's not empty and not a tag
  return true;
}

/**
 * Check if a line is a tag that has a URL on the next line
 */
function isTagWithNextLineUrl(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('#EXTINF') || 
         trimmed.startsWith('#EXT-X-STREAM-INF') ||
         trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF') ||
         trimmed.startsWith('#EXT-X-BYTERANGE');
}

/**
 * Determine the resource type for a URL in context
 */
function determineResourceType(
  url: string, 
  previousLine: string | null
): 'playlist' | 'segment' | 'key' {
  // Check the URL itself first
  const urlType = getResourceType(url);
  if (urlType !== 'unknown') {
    return urlType;
  }
  
  // Check context from previous line
  if (previousLine) {
    if (previousLine.includes('#EXTINF')) {
      return 'segment';
    }
    if (previousLine.includes('#EXT-X-STREAM-INF')) {
      return 'playlist';
    }
  }
  
  // Default to segment for unknown types
  return 'segment';
}

/**
 * Check if a URL is from a domain with custom encryption format
 * These domains have a 32-byte header where bytes 16-31 contain the real IV
 */
function hasCustomEncryption(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return CUSTOM_ENCRYPTION_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Rewrite all URLs in an M3U8 playlist
 * 
 * Client-side decryption: We keep #EXT-X-KEY lines and proxy the key URL.
 * For dvalna.ru streams with custom encryption, we add a header to indicate
 * the client needs to handle the 32-byte header format.
 * 
 * @param content - The M3U8 playlist content
 * @param options - Rewrite options
 */
export function rewriteM3U8(
  content: string,
  options: M3U8RewriteOptions
): M3U8RewriteResult {
  const { workerBaseUrl, headers, baseUrl, apiKey } = options;
  const lines = content.split('\n');
  const rewrittenLines: string[] = [];
  const originalUrls: string[] = [];
  const rewrittenUrls: string[] = [];
  let urlsRewritten = 0;
  let previousLine: string | null = null;
  
  // Check if this stream has custom encryption format (dvalna.ru)
  const customEncryption = hasCustomEncryption(baseUrl);
  
  console.log(`[M3U8 Rewriter] Processing ${lines.length} lines`);
  console.log(`[M3U8 Rewriter] Worker base: ${workerBaseUrl}`);
  console.log(`[M3U8 Rewriter] Base URL: ${baseUrl}`);
  console.log(`[M3U8 Rewriter] API Key: ${apiKey ? 'present' : 'none'}`);
  console.log(`[M3U8 Rewriter] Custom encryption (client-side): ${customEncryption}`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Handle empty lines
    if (!trimmedLine) {
      rewrittenLines.push(line);
      previousLine = line;
      continue;
    }
    
    // Handle tags with URI attributes
    if (trimmedLine.startsWith('#')) {
      let processedLine = line;
      
      // Check for URI attribute in the tag (including #EXT-X-KEY)
      const uri = extractUri(trimmedLine);
      if (uri) {
        const absoluteUrl = resolveUrl(uri, baseUrl);
        const resourceType = getResourceType(absoluteUrl);
        const proxyType = resourceType === 'key' ? 'key' : 
                         resourceType === 'playlist' ? 'playlist' : 'segment';
        
        const proxyUrl = encodeProxyUrl(absoluteUrl, headers, workerBaseUrl, proxyType, apiKey);
        processedLine = replaceUri(line, proxyUrl);
        
        if (trimmedLine.startsWith('#EXT-X-KEY')) {
          console.log(`[M3U8 Rewriter] Proxying key URL for client-side decryption: ${absoluteUrl.substring(0, 60)}...`);
        }
        
        originalUrls.push(absoluteUrl);
        rewrittenUrls.push(proxyUrl);
        urlsRewritten++;
      }
      
      rewrittenLines.push(processedLine);
      previousLine = trimmedLine;
      continue;
    }
    
    // Handle URL lines (not tags)
    if (isUrlLine(trimmedLine)) {
      console.log(`[M3U8 Rewriter] Found URL line: ${trimmedLine.substring(0, 50)}...`);
      const absoluteUrl = resolveUrl(trimmedLine, baseUrl);
      const resourceType = determineResourceType(absoluteUrl, previousLine);
      console.log(`[M3U8 Rewriter] Resource type: ${resourceType}`);
      
      // For segments from custom encryption domains, add strip flag so worker
      // strips the 32-byte header for native HLS.js decryption
      let proxyUrl = encodeProxyUrl(absoluteUrl, headers, workerBaseUrl, resourceType, apiKey);
      
      // Add strip flag for segments that need header removal
      if (customEncryption && resourceType === 'segment') {
        proxyUrl += '&strip=1';
        console.log(`[M3U8 Rewriter] Added strip flag to segment URL`);
      }
      
      console.log(`[M3U8 Rewriter] Proxy URL: ${proxyUrl.substring(0, 80)}...`);
      rewrittenLines.push(proxyUrl);
      
      originalUrls.push(absoluteUrl);
      rewrittenUrls.push(proxyUrl);
      urlsRewritten++;
      
      previousLine = trimmedLine;
      continue;
    }
    
    // Keep other lines as-is
    rewrittenLines.push(line);
    previousLine = trimmedLine;
  }
  
  return {
    content: rewrittenLines.join('\n'),
    urlsRewritten,
    originalUrls,
    rewrittenUrls,
  };
}

/**
 * Check if content is a master playlist (contains variant streams)
 */
export function isMasterPlaylist(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF') || 
         content.includes('#EXT-X-MEDIA');
}

/**
 * Check if content is a media playlist (contains segments)
 */
export function isMediaPlaylist(content: string): boolean {
  return content.includes('#EXTINF') || 
         content.includes('#EXT-X-TARGETDURATION');
}

/**
 * Validate M3U8 content
 */
export function isValidM3U8(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('#EXTM3U');
}

/**
 * Extract all URLs from M3U8 content without rewriting
 */
export function extractM3U8Urls(content: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Extract URI from tags
    const uri = extractUri(trimmed);
    if (uri) {
      urls.push(resolveUrl(uri, baseUrl));
    }
    
    // Extract URL lines
    if (isUrlLine(trimmed)) {
      urls.push(resolveUrl(trimmed, baseUrl));
    }
  }
  
  return urls;
}

/**
 * Get the base URL for a playlist URL
 * (directory containing the playlist)
 */
export function getPlaylistBaseUrl(playlistUrl: string): string {
  const url = new URL(playlistUrl);
  const pathParts = url.pathname.split('/');
  pathParts.pop(); // Remove filename
  url.pathname = pathParts.join('/') + '/';
  return url.href;
}
