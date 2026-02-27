/**
 * API Key Authentication Middleware
 * Uses timing-safe comparison to prevent timing attacks.
 * Requirement: 3.6
 */
import type { Middleware } from '../types';
/** Timing-safe API key comparison */
export declare function timingSafeApiKeyCheck(provided: string | null | undefined, expected: string): boolean;
/**
 * Creates auth middleware that validates API key and origin.
 * Skips auth for /health endpoint.
 */
export declare function createAuthMiddleware(apiKey: string): Middleware;
//# sourceMappingURL=auth.d.ts.map