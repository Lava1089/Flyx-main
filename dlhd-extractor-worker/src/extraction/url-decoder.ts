/**
 * URL Decoder for Obfuscated Streams
 * Handles various encoding/obfuscation methods used by DLHD players
 * 
 * Requirements: 4.2
 * - WHEN the M3U8 URL is obfuscated or encoded, THE Stream_Extractor component 
 *   SHALL decode it to obtain the plain URL
 */

/**
 * Encoding types that can be detected and decoded
 */
export type EncodingType = 
  | 'base64'
  | 'url-encoded'
  | 'hex'
  | 'rot13'
  | 'reverse'
  | 'custom-xor'
  | 'double-base64'
  | 'none';

/**
 * Result of URL decoding
 */
export interface DecodeResult {
  /** The decoded URL */
  url: string;
  /** The encoding type that was detected */
  encodingType: EncodingType;
  /** Whether decoding was successful */
  success: boolean;
  /** Original encoded string */
  original: string;
}

/**
 * Check if a string is valid base64
 */
export function isBase64(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  // Base64 pattern: alphanumeric, +, /, and = for padding
  const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
  
  // Must be at least 4 characters and length divisible by 4 (with padding)
  if (str.length < 4) {
    return false;
  }
  
  return base64Pattern.test(str);
}

/**
 * Decode base64 string
 */
export function decodeBase64(encoded: string): string {
  try {
    // Handle URL-safe base64
    const normalized = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    
    return atob(padded);
  } catch {
    return '';
  }
}

/**
 * Encode string to base64
 */
export function encodeBase64(str: string): string {
  try {
    return btoa(str);
  } catch {
    return '';
  }
}

/**
 * Check if a string is URL encoded
 */
export function isUrlEncoded(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  // Check for percent-encoded characters
  return /%[0-9A-Fa-f]{2}/.test(str);
}

/**
 * Decode URL-encoded string
 */
export function decodeUrlEncoded(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Encode string as URL-encoded
 */
export function encodeUrlEncoded(str: string): string {
  try {
    return encodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Check if a string is hex encoded
 */
export function isHexEncoded(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  // Hex string should be even length and only hex chars
  return str.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(str);
}

/**
 * Decode hex-encoded string
 */
export function decodeHex(encoded: string): string {
  try {
    let result = '';
    for (let i = 0; i < encoded.length; i += 2) {
      result += String.fromCharCode(parseInt(encoded.substr(i, 2), 16));
    }
    return result;
  } catch {
    return '';
  }
}

/**
 * Encode string as hex
 */
export function encodeHex(str: string): string {
  try {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return result;
  } catch {
    return '';
  }
}


/**
 * ROT13 decode/encode (symmetric)
 */
export function rot13(str: string): string {
  return str.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * Reverse a string
 */
export function reverseString(str: string): string {
  return str.split('').reverse().join('');
}

/**
 * XOR decode with a key
 */
export function xorDecode(encoded: string, key: string): string {
  if (!key) return encoded;
  
  let result = '';
  for (let i = 0; i < encoded.length; i++) {
    result += String.fromCharCode(
      encoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)
    );
  }
  return result;
}

/**
 * XOR encode with a key (same as decode - symmetric)
 */
export function xorEncode(str: string, key: string): string {
  return xorDecode(str, key);
}

/**
 * Detect the encoding type of a string
 */
export function detectEncodingType(str: string): EncodingType {
  if (!str || typeof str !== 'string') {
    return 'none';
  }
  
  // Check for URL encoding first (most common)
  if (isUrlEncoded(str)) {
    return 'url-encoded';
  }
  
  // Check for base64
  if (isBase64(str)) {
    // Try to decode and see if result looks like a URL
    const decoded = decodeBase64(str);
    if (decoded.startsWith('http') || decoded.includes('.m3u8')) {
      return 'base64';
    }
    
    // Check for double base64
    if (isBase64(decoded)) {
      const doubleDecoded = decodeBase64(decoded);
      if (doubleDecoded.startsWith('http') || doubleDecoded.includes('.m3u8')) {
        return 'double-base64';
      }
    }
  }
  
  // Check for hex encoding
  if (isHexEncoded(str) && str.length > 20) {
    const decoded = decodeHex(str);
    if (decoded.startsWith('http') || decoded.includes('.m3u8')) {
      return 'hex';
    }
  }
  
  // Check for reversed URL
  const reversed = reverseString(str);
  if (reversed.startsWith('http') || reversed.includes('.m3u8')) {
    return 'reverse';
  }
  
  // Check for ROT13
  const rot13Decoded = rot13(str);
  if (rot13Decoded.startsWith('http') || rot13Decoded.includes('.m3u8')) {
    return 'rot13';
  }
  
  return 'none';
}

/**
 * Decode a URL using the detected encoding type
 */
export function decodeUrl(encoded: string, key?: string): DecodeResult {
  if (!encoded || typeof encoded !== 'string') {
    return {
      url: '',
      encodingType: 'none',
      success: false,
      original: encoded || '',
    };
  }
  
  const encodingType = detectEncodingType(encoded);
  let decoded = encoded;
  let success = true;
  
  switch (encodingType) {
    case 'base64':
      decoded = decodeBase64(encoded);
      break;
      
    case 'double-base64':
      decoded = decodeBase64(decodeBase64(encoded));
      break;
      
    case 'url-encoded':
      decoded = decodeUrlEncoded(encoded);
      break;
      
    case 'hex':
      decoded = decodeHex(encoded);
      break;
      
    case 'rot13':
      decoded = rot13(encoded);
      break;
      
    case 'reverse':
      decoded = reverseString(encoded);
      break;
      
    case 'custom-xor':
      if (key) {
        decoded = xorDecode(encoded, key);
      } else {
        success = false;
      }
      break;
      
    case 'none':
      // No encoding detected, return as-is
      break;
  }
  
  // Validate the decoded URL
  if (decoded && !decoded.startsWith('http')) {
    // Try to fix common issues
    if (decoded.startsWith('//')) {
      decoded = 'https:' + decoded;
    } else if (decoded.startsWith('/')) {
      // Relative URL - can't fully decode without base URL
      success = false;
    }
  }
  
  return {
    url: decoded,
    encodingType,
    success: success && decoded.length > 0,
    original: encoded,
  };
}

/**
 * Encode a URL using the specified encoding type
 */
export function encodeUrl(url: string, encodingType: EncodingType, key?: string): string {
  switch (encodingType) {
    case 'base64':
      return encodeBase64(url);
      
    case 'double-base64':
      return encodeBase64(encodeBase64(url));
      
    case 'url-encoded':
      return encodeUrlEncoded(url);
      
    case 'hex':
      return encodeHex(url);
      
    case 'rot13':
      return rot13(url);
      
    case 'reverse':
      return reverseString(url);
      
    case 'custom-xor':
      return key ? xorEncode(url, key) : url;
      
    case 'none':
    default:
      return url;
  }
}

/**
 * Try multiple decoding methods and return the first valid URL
 */
export function tryAllDecodings(encoded: string, keys?: string[]): DecodeResult | null {
  // First try automatic detection
  const autoResult = decodeUrl(encoded);
  if (autoResult.success && autoResult.url.startsWith('http')) {
    return autoResult;
  }
  
  // Try each encoding type explicitly
  const encodingTypes: EncodingType[] = [
    'base64',
    'double-base64',
    'url-encoded',
    'hex',
    'rot13',
    'reverse',
  ];
  
  for (const type of encodingTypes) {
    let decoded = '';
    
    switch (type) {
      case 'base64':
        decoded = decodeBase64(encoded);
        break;
      case 'double-base64':
        decoded = decodeBase64(decodeBase64(encoded));
        break;
      case 'url-encoded':
        decoded = decodeUrlEncoded(encoded);
        break;
      case 'hex':
        decoded = decodeHex(encoded);
        break;
      case 'rot13':
        decoded = rot13(encoded);
        break;
      case 'reverse':
        decoded = reverseString(encoded);
        break;
    }
    
    if (decoded && (decoded.startsWith('http') || decoded.includes('.m3u8'))) {
      return {
        url: decoded,
        encodingType: type,
        success: true,
        original: encoded,
      };
    }
  }
  
  // Try XOR with provided keys
  if (keys && keys.length > 0) {
    for (const key of keys) {
      const decoded = xorDecode(encoded, key);
      if (decoded && (decoded.startsWith('http') || decoded.includes('.m3u8'))) {
        return {
          url: decoded,
          encodingType: 'custom-xor',
          success: true,
          original: encoded,
        };
      }
    }
  }
  
  return null;
}

/**
 * Extract and decode encoded URLs from HTML
 */
export function extractEncodedUrls(html: string): DecodeResult[] {
  const results: DecodeResult[] = [];
  const seenUrls = new Set<string>();
  
  // Look for atob() calls
  const atobPattern = /atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/gi;
  let match;
  
  while ((match = atobPattern.exec(html)) !== null) {
    const result = decodeUrl(match[1]);
    if (result.success && !seenUrls.has(result.url)) {
      seenUrls.add(result.url);
      results.push(result);
    }
  }
  
  // Look for base64-like strings in variable assignments
  const varPattern = /(?:var|let|const)\s+\w+\s*=\s*["']([A-Za-z0-9+/=]{20,})["']/gi;
  
  while ((match = varPattern.exec(html)) !== null) {
    const result = decodeUrl(match[1]);
    if (result.success && result.url.includes('.m3u8') && !seenUrls.has(result.url)) {
      seenUrls.add(result.url);
      results.push(result);
    }
  }
  
  return results;
}
