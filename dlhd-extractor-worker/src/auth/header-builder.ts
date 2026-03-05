/**
 * Header Builder
 * 
 * Builds proper HTTP headers for authenticated requests to DLHD.
 * Handles Referer, Origin, User-Agent, and other required headers.
 * 
 * Requirements: 3.4
 * - WHEN authentication requires referrer validation, THE Auth_Handler component 
 *   SHALL include proper referrer headers
 */

import { CookieJar } from './cookie-jar';
import { TokenGenerator, GeneratedToken } from './token-generator';

const DLHD_BASE_URL = 'https://dlhd.link';
const DLHD_ORIGIN = 'https://dlhd.link';

/**
 * User-Agent pool for rotation
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

/**
 * Navigation context for building proper Referer chains
 */
export interface NavigationContext {
  /** The page we're navigating from */
  fromUrl?: string;
  /** The page we're navigating to */
  toUrl: string;
  /** Type of navigation */
  navigationType: 'document' | 'xhr' | 'fetch' | 'embed' | 'media';
}

/**
 * Header builder options
 */
export interface HeaderBuilderOptions {
  /** Custom User-Agent to use */
  userAgent?: string;
  /** Whether to rotate User-Agent */
  rotateUserAgent?: boolean;
  /** Cookie jar for including cookies */
  cookieJar?: CookieJar;
  /** Token generator for including auth tokens */
  tokenGenerator?: TokenGenerator;
  /** Additional custom headers */
  customHeaders?: Record<string, string>;
}

/**
 * Get a random User-Agent from the pool
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Determine the appropriate Referer based on navigation context
 */
export function buildReferer(context: NavigationContext): string {
  // If we have a fromUrl, use it as referer
  if (context.fromUrl) {
    return context.fromUrl;
  }

  // Default referers based on navigation type
  switch (context.navigationType) {
    case 'document':
      return DLHD_BASE_URL;
    case 'embed':
      // Embeds typically come from channel pages
      return `${DLHD_BASE_URL}/watch.php`;
    case 'media':
      // Media requests come from player pages
      return context.toUrl.includes('player') ? context.toUrl : DLHD_BASE_URL;
    case 'xhr':
    case 'fetch':
      return DLHD_BASE_URL;
    default:
      return DLHD_BASE_URL;
  }
}

/**
 * Determine the appropriate Origin header
 */
export function buildOrigin(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    // For DLHD resources, use DLHD origin
    if (url.hostname.includes('dlhd')) {
      return DLHD_ORIGIN;
    }
    // For external resources (CDN, etc.), use the target's origin
    return `${url.protocol}//${url.host}`;
  } catch {
    return DLHD_ORIGIN;
  }
}

/**
 * Build Sec-Fetch headers based on navigation type
 */
export function buildSecFetchHeaders(
  navigationType: NavigationContext['navigationType']
): Record<string, string> {
  switch (navigationType) {
    case 'document':
      return {
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
      };
    case 'embed':
      return {
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      };
    case 'media':
      return {
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      };
    case 'xhr':
    case 'fetch':
      return {
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      };
    default:
      return {};
  }
}

/**
 * Build Accept header based on content type expected
 */
export function buildAcceptHeader(
  navigationType: NavigationContext['navigationType']
): string {
  switch (navigationType) {
    case 'document':
    case 'embed':
      return 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
    case 'media':
      return '*/*';
    case 'xhr':
    case 'fetch':
      return 'application/json, text/plain, */*';
    default:
      return '*/*';
  }
}

/**
 * Header Builder class
 * 
 * Property 3: Auth Context Completeness
 * - Required headers (Referer, Origin, User-Agent) SHALL be included when the target requires them
 */
export class HeaderBuilder {
  private userAgent: string;
  private rotateUserAgent: boolean;
  private cookieJar?: CookieJar;
  private tokenGenerator?: TokenGenerator;
  private customHeaders: Record<string, string>;

  constructor(options: HeaderBuilderOptions = {}) {
    this.userAgent = options.userAgent || getRandomUserAgent();
    this.rotateUserAgent = options.rotateUserAgent ?? false;
    this.cookieJar = options.cookieJar;
    this.tokenGenerator = options.tokenGenerator;
    this.customHeaders = options.customHeaders || {};
  }

  /**
   * Get the current User-Agent (may rotate if configured)
   */
  getUserAgent(): string {
    if (this.rotateUserAgent) {
      return getRandomUserAgent();
    }
    return this.userAgent;
  }

  /**
   * Set a custom User-Agent
   */
  setUserAgent(userAgent: string): void {
    this.userAgent = userAgent;
  }

  /**
   * Set the cookie jar
   */
  setCookieJar(cookieJar: CookieJar): void {
    this.cookieJar = cookieJar;
  }

  /**
   * Set the token generator
   */
  setTokenGenerator(tokenGenerator: TokenGenerator): void {
    this.tokenGenerator = tokenGenerator;
  }

  /**
   * Add custom headers
   */
  addCustomHeaders(headers: Record<string, string>): void {
    Object.assign(this.customHeaders, headers);
  }

  /**
   * Build headers for a navigation request
   */
  build(context: NavigationContext): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.getUserAgent(),
      'Accept': buildAcceptHeader(context.navigationType),
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': buildReferer(context),
      'Origin': buildOrigin(context.toUrl),
      'DNT': '1',
      'Connection': 'keep-alive',
      ...buildSecFetchHeaders(context.navigationType),
    };

    // Add document-specific headers
    if (context.navigationType === 'document' || context.navigationType === 'embed') {
      headers['Upgrade-Insecure-Requests'] = '1';
      headers['Cache-Control'] = 'max-age=0';
    }

    // Add cookies if available
    if (this.cookieJar) {
      const cookieHeader = this.cookieJar.getCookieHeader();
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }
    }

    // Add custom headers (can override defaults)
    Object.assign(headers, this.customHeaders);

    return headers;
  }

  /**
   * Build headers for a channel page request
   */
  buildForChannelPage(channelId: string): Record<string, string> {
    return this.build({
      toUrl: `${DLHD_BASE_URL}/watch.php?id=${channelId}`,
      fromUrl: `${DLHD_BASE_URL}/24-7-channels.php`,
      navigationType: 'document',
    });
  }

  /**
   * Build headers for an embed page request
   */
  buildForEmbedPage(embedUrl: string, channelPageUrl: string): Record<string, string> {
    return this.build({
      toUrl: embedUrl,
      fromUrl: channelPageUrl,
      navigationType: 'embed',
    });
  }

  /**
   * Build headers for a stream/media request
   */
  buildForStream(streamUrl: string, embedPageUrl: string): Record<string, string> {
    const headers = this.build({
      toUrl: streamUrl,
      fromUrl: embedPageUrl,
      navigationType: 'media',
    });

    // Stream requests often need specific headers
    delete headers['Upgrade-Insecure-Requests'];
    delete headers['Cache-Control'];

    return headers;
  }

  /**
   * Build headers for an API/XHR request
   */
  buildForApi(apiUrl: string, pageUrl?: string): Record<string, string> {
    return this.build({
      toUrl: apiUrl,
      fromUrl: pageUrl,
      navigationType: 'fetch',
    });
  }

  /**
   * Clone the header builder with the same configuration
   */
  clone(): HeaderBuilder {
    return new HeaderBuilder({
      userAgent: this.userAgent,
      rotateUserAgent: this.rotateUserAgent,
      cookieJar: this.cookieJar,
      tokenGenerator: this.tokenGenerator,
      customHeaders: { ...this.customHeaders },
    });
  }
}

/**
 * Build headers for DLHD requests (convenience function)
 */
export function buildDLHDHeaders(
  targetUrl: string,
  referer?: string,
  options: HeaderBuilderOptions = {}
): Record<string, string> {
  const builder = new HeaderBuilder(options);
  return builder.build({
    toUrl: targetUrl,
    fromUrl: referer,
    navigationType: 'document',
  });
}
