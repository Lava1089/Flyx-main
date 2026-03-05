/**
 * Authentication Handler
 * 
 * Main authentication handler that manages the complete auth flow for DLHD.
 * Combines cookie management, token generation, and header building.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { AuthContext } from '../types';
import { CookieJar, Cookie } from './cookie-jar';
import { TokenGenerator, TokenType, GeneratedToken, generateTimestamp } from './token-generator';
import { HeaderBuilder } from './header-builder';

const DLHD_BASE_URL = 'https://dlhd.link';

/**
 * Authentication error codes
 */
export type AuthErrorCode = 
  | 'AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'INVALID_TOKEN'
  | 'COOKIE_REQUIRED'
  | 'CHALLENGE_FAILED'
  | 'RATE_LIMITED';

/**
 * Authentication error
 */
export class AuthError extends Error {
  code: AuthErrorCode;
  details?: Record<string, unknown>;

  constructor(message: string, code: AuthErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Session state
 */
export interface SessionState {
  initialized: boolean;
  createdAt: number;
  lastActivity: number;
  expiresAt: number;
}

/**
 * Auth handler options
 */
export interface AuthHandlerOptions {
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** Whether to auto-refresh session */
  autoRefresh?: boolean;
  /** Custom User-Agent */
  userAgent?: string;
}

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Authentication Handler
 * 
 * Property 3: Auth Context Completeness
 * - All required cookies SHALL be preserved across subsequent requests
 * - Generated tokens SHALL match the expected format and contain valid timestamps
 * - Required headers (Referer, Origin, User-Agent) SHALL be included when the target requires them
 */
export class AuthHandler {
  private cookieJar: CookieJar;
  private tokenGenerator: TokenGenerator;
  private headerBuilder: HeaderBuilder;
  private sessionState: SessionState;
  private options: Required<AuthHandlerOptions>;

  constructor(options: AuthHandlerOptions = {}) {
    this.options = {
      sessionTimeoutMs: options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
      autoRefresh: options.autoRefresh ?? true,
      userAgent: options.userAgent ?? '',
    };

    this.cookieJar = new CookieJar();
    this.tokenGenerator = new TokenGenerator(this.options.userAgent || undefined);
    this.headerBuilder = new HeaderBuilder({
      userAgent: this.options.userAgent || undefined,
      cookieJar: this.cookieJar,
      tokenGenerator: this.tokenGenerator,
    });

    this.sessionState = {
      initialized: false,
      createdAt: 0,
      lastActivity: 0,
      expiresAt: 0,
    };
  }

  /**
   * Initialize a new session
   * Performs initial page load to collect cookies and establish session
   */
  async initSession(): Promise<AuthContext> {
    const now = Date.now();
    
    // Generate session token
    const sessionToken = this.tokenGenerator.generate('session', {
      timestamp: generateTimestamp(),
      userAgent: this.headerBuilder.getUserAgent(),
    });

    // Update session state
    this.sessionState = {
      initialized: true,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + this.options.sessionTimeoutMs,
    };

    return this.buildAuthContext();
  }

  /**
   * Build the current AuthContext
   */
  buildAuthContext(): AuthContext {
    return {
      cookies: this.cookieJar.getCookiesMap(),
      tokens: this.tokenGenerator.getTokensMap(),
      headers: this.headerBuilder.build({
        toUrl: DLHD_BASE_URL,
        navigationType: 'document',
      }),
      timestamp: Date.now(),
    };
  }

  /**
   * Update session activity timestamp
   */
  private updateActivity(): void {
    const now = Date.now();
    this.sessionState.lastActivity = now;
    
    if (this.options.autoRefresh) {
      this.sessionState.expiresAt = now + this.options.sessionTimeoutMs;
    }
  }

  /**
   * Check if session is valid
   */
  isSessionValid(): boolean {
    if (!this.sessionState.initialized) {
      return false;
    }
    return Date.now() < this.sessionState.expiresAt;
  }

  /**
   * Get or initialize session
   */
  async getOrInitSession(): Promise<AuthContext> {
    if (!this.isSessionValid()) {
      return this.initSession();
    }
    this.updateActivity();
    return this.buildAuthContext();
  }

  /**
   * Generate a token for a specific purpose
   */
  generateToken(type: TokenType, channelId?: string, playerId?: number): GeneratedToken {
    return this.tokenGenerator.generate(type, {
      channelId,
      playerId,
      timestamp: generateTimestamp(),
      userAgent: this.headerBuilder.getUserAgent(),
    });
  }

  /**
   * Build headers for authenticated requests
   */
  buildAuthHeaders(targetUrl: string, referer?: string): Record<string, string> {
    this.updateActivity();
    
    return this.headerBuilder.build({
      toUrl: targetUrl,
      fromUrl: referer,
      navigationType: 'document',
    });
  }

  /**
   * Build headers for channel page requests
   */
  buildChannelPageHeaders(channelId: string): Record<string, string> {
    this.updateActivity();
    return this.headerBuilder.buildForChannelPage(channelId);
  }

  /**
   * Build headers for embed page requests
   */
  buildEmbedPageHeaders(embedUrl: string, channelPageUrl: string): Record<string, string> {
    this.updateActivity();
    return this.headerBuilder.buildForEmbedPage(embedUrl, channelPageUrl);
  }

  /**
   * Build headers for stream requests
   */
  buildStreamHeaders(streamUrl: string, embedPageUrl: string): Record<string, string> {
    this.updateActivity();
    return this.headerBuilder.buildForStream(streamUrl, embedPageUrl);
  }

  /**
   * Process response and extract cookies
   */
  processResponse(response: Response): void {
    this.cookieJar.setFromResponse(response);
    this.updateActivity();
  }

  /**
   * Add a cookie manually
   */
  addCookie(cookie: Cookie): void {
    this.cookieJar.setCookie(cookie);
  }

  /**
   * Add cookies from Set-Cookie header
   */
  addCookieFromHeader(setCookieHeader: string): void {
    this.cookieJar.setFromHeader(setCookieHeader);
  }

  /**
   * Get all current cookies
   */
  getCookies(): Map<string, string> {
    return this.cookieJar.getCookiesMap();
  }

  /**
   * Get cookie header string
   */
  getCookieHeader(): string {
    return this.cookieJar.getCookieHeader();
  }

  /**
   * Get all current tokens
   */
  getTokens(): Map<string, string> {
    return this.tokenGenerator.getTokensMap();
  }

  /**
   * Get session state
   */
  getSessionState(): SessionState {
    return { ...this.sessionState };
  }

  /**
   * Clear session and all auth data
   */
  clearSession(): void {
    this.cookieJar.clear();
    this.tokenGenerator.clear();
    this.sessionState = {
      initialized: false,
      createdAt: 0,
      lastActivity: 0,
      expiresAt: 0,
    };
  }

  /**
   * Handle anti-bot challenges (placeholder for future implementation)
   * 
   * Requirements: 3.6
   * - WHEN authentication involves anti-bot measures, THE Auth_Handler component 
   *   SHALL implement appropriate bypass techniques
   */
  async solveChallenge(challengeData: unknown): Promise<string> {
    // This is a placeholder for challenge solving logic
    // Actual implementation would depend on the type of challenge encountered
    
    if (!challengeData) {
      throw new AuthError('No challenge data provided', 'CHALLENGE_FAILED');
    }

    // For now, return empty string indicating no solution
    // Real implementation would handle Turnstile, JS challenges, etc.
    console.warn('Challenge solving not implemented:', challengeData);
    throw new AuthError('Challenge solving not implemented', 'CHALLENGE_FAILED', {
      challengeType: typeof challengeData,
    });
  }

  /**
   * Create a new AuthHandler with the same configuration
   */
  clone(): AuthHandler {
    const handler = new AuthHandler(this.options);
    
    // Copy cookies
    for (const cookie of this.cookieJar.getAllCookies()) {
      handler.addCookie(cookie);
    }
    
    return handler;
  }
}

/**
 * Create a pre-configured AuthHandler for DLHD
 */
export function createDLHDAuthHandler(options?: AuthHandlerOptions): AuthHandler {
  return new AuthHandler({
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    autoRefresh: true,
    ...options,
  });
}
