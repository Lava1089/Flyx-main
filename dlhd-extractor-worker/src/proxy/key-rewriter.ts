/**
 * Encryption Key Rewriter
 * 
 * Requirements: 5.5, 5.6
 * - THE Stream_Proxy component SHALL proxy encryption keys (.key files) if the stream is encrypted
 * - THE Stream_Proxy component SHALL handle AES-128 encrypted streams by proxying key requests
 */

import { encodeProxyUrl, resolveUrl } from './url-encoder';

/**
 * Key tag information extracted from M3U8
 */
export interface KeyTagInfo {
  method: string;
  uri: string;
  iv?: string;
  keyformat?: string;
  keyformatversions?: string;
}

/**
 * Result of key tag rewriting
 */
export interface KeyRewriteResult {
  originalTag: string;
  rewrittenTag: string;
  keyInfo: KeyTagInfo;
  proxyUrl: string;
}

/**
 * Parse #EXT-X-KEY tag attributes
 */
export function parseKeyTag(tagLine: string): KeyTagInfo | null {
  if (!tagLine.includes('#EXT-X-KEY')) {
    return null;
  }
  
  // Extract the attributes part
  const attrMatch = tagLine.match(/#EXT-X-KEY:(.+)/);
  if (!attrMatch) {
    return null;
  }
  
  const attrString = attrMatch[1];
  const result: Partial<KeyTagInfo> = {};
  
  // Parse METHOD
  const methodMatch = attrString.match(/METHOD=([^,]+)/);
  if (methodMatch) {
    result.method = methodMatch[1];
  }
  
  // Parse URI (quoted)
  const uriMatch = attrString.match(/URI="([^"]+)"/);
  if (uriMatch) {
    result.uri = uriMatch[1];
  }
  
  // Parse IV (optional)
  const ivMatch = attrString.match(/IV=([^,]+)/);
  if (ivMatch) {
    result.iv = ivMatch[1];
  }
  
  // Parse KEYFORMAT (optional)
  const keyformatMatch = attrString.match(/KEYFORMAT="([^"]+)"/);
  if (keyformatMatch) {
    result.keyformat = keyformatMatch[1];
  }
  
  // Parse KEYFORMATVERSIONS (optional)
  const keyformatVersionsMatch = attrString.match(/KEYFORMATVERSIONS="([^"]+)"/);
  if (keyformatVersionsMatch) {
    result.keyformatversions = keyformatVersionsMatch[1];
  }
  
  // Validate required fields
  if (!result.method || !result.uri) {
    return null;
  }
  
  return result as KeyTagInfo;
}

/**
 * Build #EXT-X-KEY tag from KeyTagInfo
 */
export function buildKeyTag(keyInfo: KeyTagInfo): string {
  const parts: string[] = [];
  
  parts.push(`METHOD=${keyInfo.method}`);
  parts.push(`URI="${keyInfo.uri}"`);
  
  if (keyInfo.iv) {
    parts.push(`IV=${keyInfo.iv}`);
  }
  
  if (keyInfo.keyformat) {
    parts.push(`KEYFORMAT="${keyInfo.keyformat}"`);
  }
  
  if (keyInfo.keyformatversions) {
    parts.push(`KEYFORMATVERSIONS="${keyInfo.keyformatversions}"`);
  }
  
  return `#EXT-X-KEY:${parts.join(',')}`;
}

/**
 * Rewrite a single #EXT-X-KEY tag to use proxy URL
 * 
 * @param tagLine - The original #EXT-X-KEY tag line
 * @param baseUrl - Base URL for resolving relative key URIs
 * @param workerBaseUrl - Base URL of the worker proxy
 * @param headers - Headers to include in proxied key requests
 */
export function rewriteKeyTag(
  tagLine: string,
  baseUrl: string,
  workerBaseUrl: string,
  headers: Record<string, string>
): KeyRewriteResult | null {
  const keyInfo = parseKeyTag(tagLine);
  if (!keyInfo) {
    return null;
  }
  
  // Skip NONE method (no encryption)
  if (keyInfo.method === 'NONE') {
    return null;
  }
  
  // Resolve the key URI to absolute
  const absoluteKeyUrl = resolveUrl(keyInfo.uri, baseUrl);
  
  // Create proxy URL for the key
  const proxyUrl = encodeProxyUrl(absoluteKeyUrl, headers, workerBaseUrl, 'key');
  
  // Build new key info with proxy URL
  const newKeyInfo: KeyTagInfo = {
    ...keyInfo,
    uri: proxyUrl,
  };
  
  return {
    originalTag: tagLine,
    rewrittenTag: buildKeyTag(newKeyInfo),
    keyInfo,
    proxyUrl,
  };
}

/**
 * Find all #EXT-X-KEY tags in M3U8 content
 */
export function findKeyTags(content: string): string[] {
  const lines = content.split('\n');
  return lines.filter(line => line.trim().startsWith('#EXT-X-KEY'));
}

/**
 * Check if M3U8 content contains encryption keys
 */
export function hasEncryptionKeys(content: string): boolean {
  const keyTags = findKeyTags(content);
  return keyTags.some(tag => {
    const keyInfo = parseKeyTag(tag);
    return keyInfo && keyInfo.method !== 'NONE';
  });
}

/**
 * Get encryption method from M3U8 content
 */
export function getEncryptionMethod(content: string): string | null {
  const keyTags = findKeyTags(content);
  for (const tag of keyTags) {
    const keyInfo = parseKeyTag(tag);
    if (keyInfo && keyInfo.method !== 'NONE') {
      return keyInfo.method;
    }
  }
  return null;
}

/**
 * Rewrite all #EXT-X-KEY tags in M3U8 content
 * 
 * @param content - The M3U8 playlist content
 * @param baseUrl - Base URL for resolving relative key URIs
 * @param workerBaseUrl - Base URL of the worker proxy
 * @param headers - Headers to include in proxied key requests
 */
export function rewriteAllKeyTags(
  content: string,
  baseUrl: string,
  workerBaseUrl: string,
  headers: Record<string, string>
): { content: string; keysRewritten: number; results: KeyRewriteResult[] } {
  const lines = content.split('\n');
  const results: KeyRewriteResult[] = [];
  let keysRewritten = 0;
  
  const rewrittenLines = lines.map(line => {
    if (!line.trim().startsWith('#EXT-X-KEY')) {
      return line;
    }
    
    const result = rewriteKeyTag(line, baseUrl, workerBaseUrl, headers);
    if (result) {
      results.push(result);
      keysRewritten++;
      return result.rewrittenTag;
    }
    
    return line;
  });
  
  return {
    content: rewrittenLines.join('\n'),
    keysRewritten,
    results,
  };
}

/**
 * Extract all key URIs from M3U8 content
 */
export function extractKeyUris(content: string, baseUrl: string): string[] {
  const keyTags = findKeyTags(content);
  const uris: string[] = [];
  
  for (const tag of keyTags) {
    const keyInfo = parseKeyTag(tag);
    if (keyInfo && keyInfo.method !== 'NONE') {
      uris.push(resolveUrl(keyInfo.uri, baseUrl));
    }
  }
  
  return uris;
}
