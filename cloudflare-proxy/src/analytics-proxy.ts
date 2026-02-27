/**
 * Analytics Proxy - Routes analytics through Cloudflare Worker
 * 
 * This proxy receives analytics events from the client and processes them.
 * Analytics data is persisted via the dedicated Analytics Worker (cf-analytics-worker)
 * which uses D1 for storage.
 * 
 * Routes:
 *   POST /analytics/presence      - User presence heartbeat
 *   POST /analytics/event         - Generic analytics event
 *   POST /analytics/pageview      - Page view tracking
 *   POST /analytics/watch-session - Video playback tracking
 *   GET  /analytics/health        - Health check
 */

import { createLogger, type LogLevel } from './logger';

export interface AnalyticsEnv {
  LOG_LEVEL?: string;
  // Allowed origins for CORS
  ALLOWED_ORIGINS?: string;
  // IP salt for hashing
  IP_SALT?: string;
  // Analytics Worker URL for forwarding
  ANALYTICS_WORKER_URL?: string;
}

// CORS headers
function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

// Check if origin is allowed
function isAllowedOrigin(origin: string | null, allowedOrigins?: string): boolean {
  if (!allowedOrigins) return true;
  
  const allowed = allowedOrigins.split(',').map(o => o.trim());
  if (allowed.includes('*')) return true;
  if (!origin) return false;
  
  return allowed.some(a => {
    if (a.includes('localhost')) return origin.includes('localhost');
    try {
      const allowedHost = new URL(a).hostname;
      const originHost = new URL(origin).hostname;
      return originHost === allowedHost || originHost.endsWith(`.${allowedHost}`);
    } catch {
      return false;
    }
  });
}

// Get client IP from request
function getClientIP(request: Request): string {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-real-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         '0.0.0.0';
}

// Get geo data from Cloudflare headers
function getGeoData(request: Request): {
  country: string | null;
  city: string | null;
  region: string | null;
  timezone: string | null;
} {
  return {
    country: request.headers.get('cf-ipcountry') || (request as any).cf?.country || null,
    city: (request as any).cf?.city || null,
    region: (request as any).cf?.region || null,
    timezone: (request as any).cf?.timezone || null,
  };
}

// JSON response helper
function jsonResponse(data: object, status: number, origin?: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

// Presence payload interface
interface PresencePayload {
  userId: string;
  sessionId: string;
  activityType: 'browsing' | 'watching' | 'livetv';
  contentId?: string;
  contentTitle?: string;
  contentType?: 'movie' | 'tv';
  seasonNumber?: number;
  episodeNumber?: number;
  isActive: boolean;
  isVisible: boolean;
  isLeaving?: boolean;
  referrer?: string;
  entryPage?: string;
  validation?: {
    isBot: boolean;
    botConfidence?: number;
    botReasons?: string[];
    fingerprint?: string;
    hasInteracted: boolean;
    interactionCount: number;
    timeSinceLastInteraction?: number | null;
    behaviorIsBot?: boolean;
    behaviorConfidence?: number;
    behaviorReasons?: string[];
    mouseEntropy?: number;
    mouseSamples?: number;
    scrollSamples?: number;
    screenResolution?: string;
    timezone?: string;
    language?: string;
  };
  timestamp: number;
}

// Deduplication cache (in-memory, resets on worker restart)
const recentHeartbeats = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5000; // 5 seconds

function shouldTrackHeartbeat(userId: string, sessionId: string, timestamp: number): boolean {
  const key = `${userId}:${sessionId}`;
  const lastTime = recentHeartbeats.get(key);
  
  if (lastTime && timestamp - lastTime < DEDUPE_WINDOW_MS) {
    return false;
  }
  
  recentHeartbeats.set(key, timestamp);
  
  // Cleanup old entries periodically
  if (recentHeartbeats.size > 10000) {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS * 2;
    const keysToDelete: string[] = [];
    recentHeartbeats.forEach((v, k) => {
      if (v < cutoff) keysToDelete.push(k);
    });
    keysToDelete.forEach(k => recentHeartbeats.delete(k));
  }
  
  return true;
}

// Calculate validation score
function calculateValidationScore(data: PresencePayload): number {
  let score = 20; // Base score
  
  const botConfidence = data.validation?.botConfidence || 0;
  if (botConfidence < 30) score += 20;
  else if (botConfidence < 50) score += 10;
  
  const behaviorConfidence = data.validation?.behaviorConfidence || 0;
  if (behaviorConfidence < 30) score += 15;
  
  if (data.validation?.hasInteracted) score += 10;
  if (data.isVisible) score += 5;
  
  if (data.validation?.timeSinceLastInteraction !== null && 
      data.validation?.timeSinceLastInteraction !== undefined &&
      data.validation.timeSinceLastInteraction < 30000) {
    score += 5;
  }
  
  const interactionCount = data.validation?.interactionCount || 0;
  if (interactionCount > 10) score += 5;
  else if (interactionCount > 5) score += 3;
  
  if (data.validation?.fingerprint) score += 5;
  
  const mouseEntropy = data.validation?.mouseEntropy || 0;
  const mouseSamples = data.validation?.mouseSamples || 0;
  
  if (mouseSamples >= 50) {
    if (mouseEntropy >= 0.5) score += 15;
    else if (mouseEntropy >= 0.3) score += 10;
    else if (mouseEntropy >= 0.1) score += 5;
    else if (mouseEntropy < 0.05 && mouseSamples > 100) score -= 10;
  }
  
  if ((data.validation?.scrollSamples || 0) >= 10) score += 5;
  if (data.validation?.behaviorIsBot) score -= 20;
  
  return Math.max(0, Math.min(100, score));
}

// Forward analytics data to the Analytics Worker
async function forwardToAnalyticsWorker(
  analyticsWorkerUrl: string,
  path: string,
  body: any,
  request: Request
): Promise<boolean> {
  try {
    const response = await fetch(`${analyticsWorkerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': request.headers.get('cf-connecting-ip') || '',
        'CF-IPCountry': request.headers.get('cf-ipcountry') || '',
      },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (error) {
    console.error('[Analytics] Failed to forward to Analytics Worker:', error);
    return false;
  }
}

// Handle presence heartbeat
async function handlePresence(
  request: Request,
  env: AnalyticsEnv,
  logger: any,
  origin: string | null
): Promise<Response> {
  try {
    const data: PresencePayload = await request.json();
    
    if (!data.userId || !data.sessionId) {
      return jsonResponse({ error: 'Missing required fields' }, 400, origin);
    }
    
    // Check for duplicate heartbeats
    if (!shouldTrackHeartbeat(data.userId, data.sessionId, data.timestamp)) {
      return jsonResponse({
        success: true,
        tracked: false,
        reason: 'rate-limited',
      }, 200, origin);
    }
    
    // Check bot confidence
    const clientBotConfidence = data.validation?.botConfidence || 0;
    const behaviorBotConfidence = data.validation?.behaviorConfidence || 0;
    const combinedConfidence = Math.max(clientBotConfidence, behaviorBotConfidence);
    
    if (combinedConfidence >= 70) {
      logger.info('Bot detected', { confidence: combinedConfidence });
      return jsonResponse({
        success: true,
        tracked: false,
        reason: 'bot-detected',
        confidence: combinedConfidence,
      }, 200, origin);
    }
    
    const validationScore = calculateValidationScore(data);
    const isTrulyActive = data.isActive && data.isVisible && !data.isLeaving &&
                          validationScore >= 50 && (data.validation?.hasInteracted || false);
    
    // Forward to Analytics Worker if configured
    if (env.ANALYTICS_WORKER_URL) {
      await forwardToAnalyticsWorker(env.ANALYTICS_WORKER_URL, '/presence', data, request);
    }
    
    logger.info('Presence tracked', {
      userId: data.userId.substring(0, 8),
      activityType: data.activityType,
      isTrulyActive,
      validationScore,
    });
    
    return jsonResponse({
      success: true,
      tracked: true,
      isTrulyActive,
      validationScore,
    }, 200, origin);
    
  } catch (error) {
    logger.error('Presence error', error as Error);
    return jsonResponse({ error: 'Failed to track presence' }, 500, origin);
  }
}

// Handle page view tracking
interface PageViewPayload {
  userId: string;
  sessionId: string;
  pagePath: string;
  pageTitle?: string;
  referrer?: string;
}

async function handlePageView(
  request: Request,
  env: AnalyticsEnv,
  logger: any,
  origin: string | null
): Promise<Response> {
  try {
    const data = await request.json() as PageViewPayload;
    
    if (!data.userId || !data.sessionId || !data.pagePath) {
      return jsonResponse({ error: 'Missing required fields' }, 400, origin);
    }
    
    const now = Date.now();
    const pageViewId = `pv_${data.userId}_${now}_${Math.random().toString(36).substring(2, 7)}`;
    
    // Forward to Analytics Worker if configured
    if (env.ANALYTICS_WORKER_URL) {
      await forwardToAnalyticsWorker(env.ANALYTICS_WORKER_URL, '/page-view', data, request);
    }
    
    logger.info('Page view tracked', {
      userId: data.userId.substring(0, 8),
      pagePath: data.pagePath,
    });
    
    return jsonResponse({ success: true, id: pageViewId }, 200, origin);
    
  } catch (error) {
    logger.error('Page view error', error as Error);
    return jsonResponse({ error: 'Failed to track page view' }, 500, origin);
  }
}

// Handle generic analytics event
interface EventPayload {
  sessionId: string;
  eventType: string;
  metadata?: Record<string, any>;
}

async function handleEvent(
  request: Request,
  env: AnalyticsEnv,
  logger: any,
  origin: string | null
): Promise<Response> {
  try {
    const data = await request.json() as EventPayload;
    
    if (!data.sessionId || !data.eventType) {
      return jsonResponse({ error: 'Missing required fields' }, 400, origin);
    }
    
    const now = Date.now();
    const eventId = `evt_${now}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Forward to Analytics Worker if configured
    if (env.ANALYTICS_WORKER_URL) {
      await forwardToAnalyticsWorker(env.ANALYTICS_WORKER_URL, '/events', {
        events: [{ ...data, timestamp: now }],
      }, request);
    }
    
    logger.info('Event tracked', { eventType: data.eventType });
    
    return jsonResponse({ success: true, id: eventId }, 200, origin);
    
  } catch (error) {
    logger.error('Event error', error as Error);
    return jsonResponse({ error: 'Failed to track event' }, 500, origin);
  }
}

// Handle watch session tracking (video playback)
interface WatchSessionPayload {
  id: string;
  sessionId: string;
  userId: string;
  contentId: string;
  contentType: 'movie' | 'tv';
  contentTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  startedAt: number;
  endedAt?: number;
  totalWatchTime: number;
  lastPosition: number;
  duration: number;
  completionPercentage: number;
  quality?: string;
  isCompleted: boolean;
  pauseCount?: number;
  seekCount?: number;
}

async function handleWatchSession(
  request: Request,
  env: AnalyticsEnv,
  logger: any,
  origin: string | null
): Promise<Response> {
  try {
    const data = await request.json() as WatchSessionPayload;
    
    if (!data.id || !data.sessionId || !data.userId || !data.contentId) {
      return jsonResponse({ error: 'Missing required fields' }, 400, origin);
    }
    
    // Forward to Analytics Worker if configured
    if (env.ANALYTICS_WORKER_URL) {
      await forwardToAnalyticsWorker(env.ANALYTICS_WORKER_URL, '/watch-session', data, request);
    }
    
    logger.info('Watch session tracked', {
      contentId: data.contentId,
      watchTime: data.totalWatchTime,
      completion: data.completionPercentage,
    });
    
    return jsonResponse({ success: true, id: data.id }, 200, origin);
    
  } catch (error) {
    logger.error('Watch session error', error as Error);
    return jsonResponse({ error: 'Failed to track watch session' }, 500, origin);
  }
}

// Main handler
export async function handleAnalyticsRequest(
  request: Request,
  env: AnalyticsEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/analytics/, '');
  const logLevel = (env.LOG_LEVEL || 'info') as LogLevel;
  const logger = createLogger(request, logLevel);
  const origin = request.headers.get('origin');
  
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }
  
  // Check origin
  if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
    logger.warn('Blocked origin', { origin });
    return jsonResponse({ error: 'Access denied' }, 403, origin);
  }
  
  // Health check
  if (path === '/health' || path === '/health/') {
    return jsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      analyticsWorker: !!env.ANALYTICS_WORKER_URL,
    }, 200, origin);
  }
  
  // Route handlers
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }
  
  switch (path) {
    case '/presence':
    case '/presence/':
      return handlePresence(request, env, logger, origin);
      
    case '/pageview':
    case '/pageview/':
      return handlePageView(request, env, logger, origin);
      
    case '/event':
    case '/event/':
      return handleEvent(request, env, logger, origin);
      
    case '/watch-session':
    case '/watch-session/':
      return handleWatchSession(request, env, logger, origin);
      
    default:
      return jsonResponse({ error: 'Not found' }, 404, origin);
  }
}

export default {
  fetch: handleAnalyticsRequest,
};
