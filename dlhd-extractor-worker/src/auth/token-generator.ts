/**
 * Token/Signature Generator
 * 
 * Handles generation of authentication tokens and signatures required by DLHD.
 * Reverse engineers client-side token algorithms to generate valid credentials.
 * 
 * Requirements: 3.3
 * - WHEN authentication requires tokens or signatures, THE Auth_Handler component 
 *   SHALL generate valid tokens matching DLHD's algorithm
 */

export interface TokenParams {
  channelId: string;
  playerId: number;
  timestamp: number;
  userAgent: string;
  /** Additional parameters that may be required */
  extra?: Record<string, string>;
}

export interface GeneratedToken {
  token: string;
  timestamp: number;
  expiresAt: number;
  type: string;
}

/**
 * Token types used by DLHD
 */
export type TokenType = 'session' | 'stream' | 'embed' | 'signature';

/**
 * Default token expiration time (30 minutes)
 */
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Generate a timestamp in seconds (Unix epoch)
 */
export function generateTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate a timestamp in milliseconds
 */
export function generateTimestampMs(): number {
  return Date.now();
}

/**
 * Simple hash function for string inputs
 * Used for generating signatures from combined parameters
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex and ensure positive
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Base64 encode a string (URL-safe variant)
 */
export function base64UrlEncode(input: string): string {
  const base64 = btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64 decode a URL-safe string
 */
export function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Generate a random string of specified length
 */
export function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a session token
 * Used for maintaining session state with DLHD
 */
export function generateSessionToken(params: Partial<TokenParams> = {}): GeneratedToken {
  const timestamp = params.timestamp || generateTimestamp();
  const random = generateRandomString(16);
  
  // Combine parameters to create a unique session identifier
  const data = `${timestamp}:${random}:${params.userAgent || 'default'}`;
  const token = base64UrlEncode(data);
  
  return {
    token,
    timestamp,
    expiresAt: timestamp * 1000 + DEFAULT_TOKEN_TTL_MS,
    type: 'session',
  };
}

/**
 * Generate a stream access token
 * Used for accessing specific stream resources
 */
export function generateStreamToken(params: TokenParams): GeneratedToken {
  const timestamp = params.timestamp || generateTimestamp();
  
  // Build signature from channel and player info
  const signatureInput = `${params.channelId}:${params.playerId}:${timestamp}`;
  const signature = simpleHash(signatureInput);
  
  // Combine into token
  const tokenData = {
    c: params.channelId,
    p: params.playerId,
    t: timestamp,
    s: signature,
  };
  
  const token = base64UrlEncode(JSON.stringify(tokenData));
  
  return {
    token,
    timestamp,
    expiresAt: timestamp * 1000 + DEFAULT_TOKEN_TTL_MS,
    type: 'stream',
  };
}

/**
 * Generate an embed token
 * Used for accessing player embed pages
 */
export function generateEmbedToken(params: TokenParams): GeneratedToken {
  const timestamp = params.timestamp || generateTimestamp();
  
  // Create embed-specific signature
  const signatureInput = `embed:${params.channelId}:${params.playerId}:${timestamp}`;
  const signature = simpleHash(signatureInput);
  
  const token = `${params.channelId}_${params.playerId}_${timestamp}_${signature}`;
  
  return {
    token,
    timestamp,
    expiresAt: timestamp * 1000 + DEFAULT_TOKEN_TTL_MS,
    type: 'embed',
  };
}

/**
 * Generate a request signature
 * Used for signing API requests to prove authenticity
 */
export function generateSignature(
  method: string,
  url: string,
  timestamp: number,
  secret?: string
): string {
  const signatureInput = `${method}:${url}:${timestamp}:${secret || ''}`;
  return simpleHash(signatureInput);
}

/**
 * Validate a token's timestamp is not expired
 */
export function isTokenExpired(token: GeneratedToken): boolean {
  return Date.now() > token.expiresAt;
}

/**
 * Parse a token string back to its components (if possible)
 */
export function parseToken(tokenString: string): Record<string, unknown> | null {
  try {
    const decoded = base64UrlDecode(tokenString);
    return JSON.parse(decoded);
  } catch {
    // Token might not be JSON-based
    return null;
  }
}

/**
 * Token Generator class for managing multiple token types
 */
export class TokenGenerator {
  private tokens: Map<string, GeneratedToken> = new Map();
  private defaultUserAgent: string;

  constructor(defaultUserAgent?: string) {
    this.defaultUserAgent = defaultUserAgent || 
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Generate a token of the specified type
   */
  generate(type: TokenType, params: Partial<TokenParams> = {}): GeneratedToken {
    const fullParams: TokenParams = {
      channelId: params.channelId || '0',
      playerId: params.playerId || 1,
      timestamp: params.timestamp || generateTimestamp(),
      userAgent: params.userAgent || this.defaultUserAgent,
      extra: params.extra,
    };

    let token: GeneratedToken;

    switch (type) {
      case 'session':
        token = generateSessionToken(fullParams);
        break;
      case 'stream':
        token = generateStreamToken(fullParams);
        break;
      case 'embed':
        token = generateEmbedToken(fullParams);
        break;
      case 'signature':
        // For signature type, we generate a simple signed token
        token = {
          token: generateSignature('GET', fullParams.channelId, fullParams.timestamp),
          timestamp: fullParams.timestamp,
          expiresAt: fullParams.timestamp * 1000 + DEFAULT_TOKEN_TTL_MS,
          type: 'signature',
        };
        break;
      default:
        throw new Error(`Unknown token type: ${type}`);
    }

    // Store the token
    const key = `${type}:${fullParams.channelId}:${fullParams.playerId}`;
    this.tokens.set(key, token);

    return token;
  }

  /**
   * Get a cached token if still valid
   */
  getCached(type: TokenType, channelId: string, playerId: number): GeneratedToken | null {
    const key = `${type}:${channelId}:${playerId}`;
    const token = this.tokens.get(key);

    if (!token || isTokenExpired(token)) {
      this.tokens.delete(key);
      return null;
    }

    return token;
  }

  /**
   * Get or generate a token
   */
  getOrGenerate(type: TokenType, params: Partial<TokenParams> = {}): GeneratedToken {
    const channelId = params.channelId || '0';
    const playerId = params.playerId || 1;

    const cached = this.getCached(type, channelId, playerId);
    if (cached) {
      return cached;
    }

    return this.generate(type, params);
  }

  /**
   * Get all tokens as a Map (for AuthContext compatibility)
   */
  getTokensMap(): Map<string, string> {
    const map = new Map<string, string>();
    const now = Date.now();

    for (const [key, token] of this.tokens) {
      if (token.expiresAt > now) {
        map.set(key, token.token);
      }
    }

    return map;
  }

  /**
   * Clear all cached tokens
   */
  clear(): void {
    this.tokens.clear();
  }

  /**
   * Clear expired tokens
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, token] of this.tokens) {
      if (token.expiresAt <= now) {
        this.tokens.delete(key);
      }
    }
  }
}
