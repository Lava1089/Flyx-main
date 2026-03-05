import { Env, RateLimitData, ErrorResponse } from '../types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  error?: string;
}

/**
 * Get rate limit configuration from environment
 */
export function getRateLimitConfig(env: Env): { windowMs: number; maxRequests: number } {
  return {
    windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  };
}

/**
 * Check rate limit for an API key
 * 
 * Property 15: Rate Limiting Enforcement
 * For any API key, requests exceeding the configured rate limit 
 * SHALL be rejected with 429 status and appropriate retry-after information.
 */
export async function checkRateLimit(
  apiKey: string,
  env: Env
): Promise<RateLimitResult> {
  const config = getRateLimitConfig(env);
  const key = `ratelimit:${apiKey}`;
  const now = Date.now();
  
  try {
    const data = await env.RATE_LIMIT_KV.get(key, 'json') as RateLimitData | null;
    
    // No existing data or window expired - start new window
    if (!data || now - data.windowStart > config.windowMs) {
      const newData: RateLimitData = {
        windowMs: config.windowMs,
        maxRequests: config.maxRequests,
        currentCount: 1,
        windowStart: now,
      };
      
      await env.RATE_LIMIT_KV.put(key, JSON.stringify(newData), {
        expirationTtl: Math.ceil(config.windowMs / 1000) + 60,
      });
      
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: now + config.windowMs,
      };
    }
    
    // Check if rate limit exceeded
    if (data.currentCount >= config.maxRequests) {
      const resetAt = data.windowStart + config.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        error: 'Rate limit exceeded',
      };
    }
    
    // Increment counter
    data.currentCount++;
    await env.RATE_LIMIT_KV.put(key, JSON.stringify(data), {
      expirationTtl: Math.ceil(config.windowMs / 1000) + 60,
    });
    
    return {
      allowed: true,
      remaining: config.maxRequests - data.currentCount,
      resetAt: data.windowStart + config.windowMs,
    };
  } catch (error) {
    // On KV error, allow the request but log the issue
    console.error('Rate limit KV error:', error);
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: now + config.windowMs,
    };
  }
}

/**
 * Create rate limit error response
 */
export function createRateLimitErrorResponse(result: RateLimitResult): Response {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  
  const errorResponse: ErrorResponse = {
    success: false,
    error: 'Rate limit exceeded',
    code: 'RATE_LIMITED',
    details: {
      retryAfter,
      resetAt: new Date(result.resetAt).toISOString(),
    },
  };
  
  return new Response(JSON.stringify(errorResponse), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': result.resetAt.toString(),
    },
  });
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(response: Response, result: RateLimitResult): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-RateLimit-Remaining', result.remaining.toString());
  newHeaders.set('X-RateLimit-Reset', result.resetAt.toString());
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
