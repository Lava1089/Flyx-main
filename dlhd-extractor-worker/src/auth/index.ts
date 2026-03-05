/**
 * Authentication Module
 * 
 * Exports all authentication-related components for DLHD stream extraction.
 */

// Cookie management
export { CookieJar } from './cookie-jar';
export type { Cookie, CookieJarOptions } from './cookie-jar';

// Token generation
export {
  TokenGenerator,
  generateTimestamp,
  generateTimestampMs,
  generateSessionToken,
  generateStreamToken,
  generateEmbedToken,
  generateSignature,
  generateRandomString,
  isTokenExpired,
  parseToken,
  base64UrlEncode,
  base64UrlDecode,
} from './token-generator';
export type {
  TokenParams,
  GeneratedToken,
  TokenType,
} from './token-generator';

// Header building
export {
  HeaderBuilder,
  buildReferer,
  buildOrigin,
  buildSecFetchHeaders,
  buildAcceptHeader,
  buildDLHDHeaders,
  getRandomUserAgent,
} from './header-builder';
export type {
  HeaderBuilderOptions,
  NavigationContext,
} from './header-builder';

// Main auth handler
export {
  AuthHandler,
  AuthError,
  createDLHDAuthHandler,
} from './handler';
export type {
  AuthHandlerOptions,
  AuthErrorCode,
  SessionState,
} from './handler';
