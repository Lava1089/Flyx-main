/**
 * Flyx Analytics Worker - DURABLE OBJECT ARCHITECTURE
 * 
 * ARCHITECTURE:
 * - All real-time tracking goes through a Durable Object (single instance)
 * - Durable Object maintains in-memory state shared across ALL requests
 * - Periodic flush to D1 every 60 seconds (batched writes)
 * - GET requests served from DO memory (instant, accurate)
 * - D1 only used for persistence and historical queries
 * 
 * This solves the distributed worker problem:
 * - Regular workers are stateless - each request can hit different instance
 * - Durable Objects guarantee all requests to same ID go to same instance
 * - Memory persists across requests = accurate live user count
 * 
 * Endpoints:
 *   POST /presence      - Heartbeat (routed to DO)
 *   POST /sync          - Batch sync (routed to DO)
 *   POST /page-view     - Track page views
 *   POST /watch-session - Track watch sessions
 *   GET  /live-activity - Get current activity (from DO)
 *   GET  /unified-stats - Get stats (DO + D1 for historical)
 *   GET  /admin/stats   - Admin dashboard stats (from DO)
 *   GET  /health        - Health check
 *   POST /init-db       - Initialize database tables
 */

// Re-export the Durable Object class
export { AnalyticsDO } from './analytics-do';

// Import cron handler
import { handleScheduled } from './cron';

export interface Env {
  DB: D1Database;
  ANALYTICS_DO: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

// =============================================================================
// IN-MEMORY STATE - Source of truth for real-time data
// =============================================================================

interface LiveUser {
  userId: string;
  sessionId: string;
  activityType: 'browsing' | 'watching' | 'livetv';
  contentId?: string;
  contentTitle?: string;
  contentType?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  country?: string;
  city?: string;
  lastHeartbeat: number;
  firstSeen: number;
}

interface PendingPageView {
  id: string;
  userId: string;
  sessionId?: string;
  pagePath: string;
  pageTitle?: string;
  referrer?: string;
  entryTime: number;
  country?: string;
  deviceType?: string;
}

interface PendingWatchSession {
  id: string;
  userId: string;
  sessionId?: string;
  contentId: string;
  contentType: string;
  contentTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  startedAt: number;
  lastUpdate: number;
  watchTime: number;
  lastPosition: number;
  duration: number;
  completionPercentage: number;
  isCompleted: boolean;
}

interface BotDetection {
  userId: string;
  ipAddress: string;
  userAgent: string;
  confidenceScore: number;
  reasons: string[];
  fingerprint?: string;
  timestamp: number;
}

// Live users map - keyed by userId
const liveUsers = new Map<string, LiveUser>();

// Pending writes queue
const pendingPageViews: PendingPageView[] = [];
const pendingWatchSessions = new Map<string, PendingWatchSession>();
const pendingBotDetections = new Map<string, BotDetection>(); // Keyed by userId to avoid duplicates

// Timing
let lastFlushTime = 0;
const FLUSH_INTERVAL = 120000; // 2 minutes - reduced frequency to lower D1 write costs
const USER_TIMEOUT = 180000; // 3 minutes inactive = gone (allows for 2 missed syncs)

// Track which users have changed since last flush (dirty tracking)
const dirtyUsers = new Set<string>();

// Stats cache for historical data
let historicalStatsCache: { data: any; timestamp: number } | null = null;
const HISTORICAL_CACHE_TTL = 1800000; // 30 minutes - increased to reduce D1 reads

// Cache for real-time D1 queries (unified-stats endpoint)
let realtimeD1Cache: { data: any; timestamp: number } | null = null;
const REALTIME_D1_CACHE_TTL = 30000; // 30 seconds - real-time queries are expensive

// Peak tracking
let currentDate = new Date().toISOString().split('T')[0];
let peakStats = { date: currentDate, total: 0, watching: 0, browsing: 0, livetv: 0, time: 0 };

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getGeo(request: Request): { country?: string; city?: string } {
  return {
    country: request.headers.get('CF-IPCountry') || undefined,
    city: (request as any).cf?.city || undefined,
  };
}

function cors(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Clean inactive users
function cleanupUsers(): void {
  const cutoff = Date.now() - USER_TIMEOUT;
  for (const [id, user] of liveUsers) {
    if (user.lastHeartbeat < cutoff) liveUsers.delete(id);
  }
}

// Reset peak stats if date changed
function checkDateReset(): void {
  const today = new Date().toISOString().split('T')[0];
  if (today !== currentDate) {
    currentDate = today;
    peakStats = { date: today, total: 0, watching: 0, browsing: 0, livetv: 0, time: 0 };
  }
}

// Get real-time stats from memory (NO D1!)
function getRealtimeStats() {
  cleanupUsers();
  checkDateReset();
  
  const users = Array.from(liveUsers.values());
  const stats = {
    total: users.length,
    watching: users.filter(u => u.activityType === 'watching').length,
    browsing: users.filter(u => u.activityType === 'browsing').length,
    livetv: users.filter(u => u.activityType === 'livetv').length,
  };
  
  // Update peak
  if (stats.total > peakStats.total) {
    peakStats = { date: currentDate, ...stats, time: Date.now() };
  }
  
  return { stats, users, peak: peakStats };
}


// =============================================================================
// D1 FLUSH - Batch write every 30 seconds
// =============================================================================

async function flushToD1(db: D1Database, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastFlushTime < FLUSH_INTERVAL) return;
  lastFlushTime = now;
  
  // Only flush users that have changed (dirty tracking)
  const usersToFlush = force 
    ? Array.from(liveUsers.values())
    : Array.from(liveUsers.values()).filter(u => dirtyUsers.has(u.userId));
  
  console.log(`[Flush] Starting flush: ${usersToFlush.length} dirty users (${liveUsers.size} total in memory)`);
  
  // Clear dirty set after getting users to flush
  dirtyUsers.clear();
  
  const batch: D1PreparedStatement[] = [];
  
  // 1. Upsert only DIRTY live users to live_activity (not all users!)
  for (const user of usersToFlush) {
    batch.push(db.prepare(`
      INSERT INTO live_activity (id, user_id, session_id, activity_type, content_id, content_title, content_type, season_number, episode_number, country, city, started_at, last_heartbeat, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        activity_type = excluded.activity_type, content_id = excluded.content_id, content_title = excluded.content_title,
        last_heartbeat = excluded.last_heartbeat, is_active = 1, updated_at = excluded.updated_at
    `).bind(
      `la_${user.userId}`, user.userId, user.sessionId, user.activityType,
      user.contentId || null, user.contentTitle || null, user.contentType || null,
      user.seasonNumber || null, user.episodeNumber || null,
      user.country || null, user.city || null, user.firstSeen, user.lastHeartbeat, now, now
    ));
  }
  
  // 2. Insert page views
  for (const pv of pendingPageViews) {
    batch.push(db.prepare(`
      INSERT INTO page_views (id, user_id, session_id, page_path, page_title, referrer, entry_time, device_type, country, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(pv.id, pv.userId, pv.sessionId || null, pv.pagePath, pv.pageTitle || null, pv.referrer || null, pv.entryTime, pv.deviceType || null, pv.country || null, now));
  }
  pendingPageViews.length = 0;
  
  // 3. Upsert watch sessions
  for (const ws of pendingWatchSessions.values()) {
    batch.push(db.prepare(`
      INSERT INTO watch_sessions (id, session_id, user_id, content_id, content_type, content_title, season_number, episode_number, started_at, total_watch_time, last_position, duration, completion_percentage, is_completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_watch_time = excluded.total_watch_time, last_position = excluded.last_position,
        completion_percentage = excluded.completion_percentage, is_completed = excluded.is_completed, updated_at = excluded.updated_at
    `).bind(
      ws.id, ws.sessionId || null, ws.userId, ws.contentId, ws.contentType, ws.contentTitle || null,
      ws.seasonNumber || null, ws.episodeNumber || null, ws.startedAt,
      Math.round(ws.watchTime), Math.round(ws.lastPosition), Math.round(ws.duration),
      Math.round(ws.completionPercentage), ws.isCompleted ? 1 : 0, now, now
    ));
  }
  pendingWatchSessions.clear();
  
  // 4. Update user_activity only for DIRTY users (not all!)
  for (const user of usersToFlush) {
    batch.push(db.prepare(`
      INSERT INTO user_activity (id, user_id, session_id, first_seen, last_seen, country, city, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen, updated_at = excluded.updated_at
    `).bind(`ua_${user.userId}`, user.userId, user.sessionId, user.firstSeen, user.lastHeartbeat, user.country || null, user.city || null, now, now));
  }
  
  // 5. Update peak stats
  if (peakStats.total > 0) {
    batch.push(db.prepare(`
      INSERT INTO peak_stats (date, peak_total, peak_total_time, peak_watching, peak_watching_time, peak_livetv, peak_livetv_time, peak_browsing, peak_browsing_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        peak_total = MAX(peak_stats.peak_total, excluded.peak_total),
        peak_total_time = CASE WHEN excluded.peak_total > peak_stats.peak_total THEN excluded.peak_total_time ELSE peak_stats.peak_total_time END,
        peak_watching = MAX(peak_stats.peak_watching, excluded.peak_watching),
        peak_livetv = MAX(peak_stats.peak_livetv, excluded.peak_livetv),
        peak_browsing = MAX(peak_stats.peak_browsing, excluded.peak_browsing),
        updated_at = excluded.updated_at
    `).bind(peakStats.date, peakStats.total, peakStats.time, peakStats.watching, peakStats.time, peakStats.livetv, peakStats.time, peakStats.browsing, peakStats.time, now, now));
  }
  
  // 6. Insert bot detections (upsert to update if higher confidence)
  for (const detection of pendingBotDetections.values()) {
    // Determine status based on confidence score
    let status = 'confirmed_human';
    if (detection.confidenceScore >= 80) status = 'confirmed_bot';
    else if (detection.confidenceScore >= 50) status = 'suspected';
    else if (detection.confidenceScore >= 30) status = 'pending_review';
    
    batch.push(db.prepare(`
      INSERT INTO bot_detections (user_id, ip_address, user_agent, confidence_score, detection_reasons, fingerprint, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        confidence_score = CASE WHEN excluded.confidence_score > bot_detections.confidence_score THEN excluded.confidence_score ELSE bot_detections.confidence_score END,
        detection_reasons = CASE WHEN excluded.confidence_score > bot_detections.confidence_score THEN excluded.detection_reasons ELSE bot_detections.detection_reasons END,
        status = CASE WHEN excluded.confidence_score > bot_detections.confidence_score THEN excluded.status ELSE bot_detections.status END,
        updated_at = excluded.updated_at
    `).bind(
      detection.userId, detection.ipAddress, detection.userAgent,
      detection.confidenceScore, JSON.stringify(detection.reasons),
      detection.fingerprint || null, status, detection.timestamp, now
    ));
  }
  pendingBotDetections.clear();
  
  if (batch.length > 0) {
    try {
      await db.batch(batch);
      console.log(`[Flush] Wrote ${batch.length} statements to D1`);
    } catch (e) {
      // DIAGNOSTIC: Log detailed error for schema mismatch debugging
      console.error('[Flush] D1 Batch Error:', e);
      console.error('[Flush] Error details:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
      // Check if it's a schema error
      if (String(e).includes('no such column') || String(e).includes('table has no column')) {
        console.error('[Flush] SCHEMA MISMATCH DETECTED - Missing column in watch_sessions table!');
        console.error('[Flush] Expected columns: total_watch_time may be missing from schema.sql');
      }
    }
  }
}

// =============================================================================
// HANDLERS - POST handlers update memory, GET handlers read from memory
// =============================================================================

// POST /presence - Update user presence (MEMORY ONLY - instant)
async function handlePresence(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  const data = await request.json() as any;
  if (!data.userId) return Response.json({ error: 'Missing userId' }, { status: 400, headers });
  
  const geo = getGeo(request);
  const now = Date.now();
  
  // Update or create user in memory
  const existing = liveUsers.get(data.userId);
  liveUsers.set(data.userId, {
    userId: data.userId,
    sessionId: data.sessionId || existing?.sessionId || generateId(),
    activityType: data.activityType || 'browsing',
    contentId: data.contentId,
    contentTitle: data.contentTitle,
    contentType: data.contentType,
    seasonNumber: data.seasonNumber,
    episodeNumber: data.episodeNumber,
    country: geo.country || existing?.country,
    city: geo.city || existing?.city,
    lastHeartbeat: now,
    firstSeen: existing?.firstSeen || now,
  });
  
  // Mark user as dirty (needs D1 update on next flush)
  dirtyUsers.add(data.userId);
  
  // If user is leaving, remove them
  if (data.isLeaving) {
    liveUsers.delete(data.userId);
  }
  
  // Store bot detection data if present and confidence is notable (>= 30%)
  // This captures both suspected bots AND suspicious activity for review
  if (data.validation && typeof data.validation.botConfidence === 'number' && data.validation.botConfidence >= 30) {
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    
    // Only update if this detection has higher confidence than existing
    const existingDetection = pendingBotDetections.get(data.userId);
    if (!existingDetection || data.validation.botConfidence > existingDetection.confidenceScore) {
      pendingBotDetections.set(data.userId, {
        userId: data.userId,
        ipAddress,
        userAgent,
        confidenceScore: data.validation.botConfidence,
        reasons: data.validation.botReasons || [],
        fingerprint: data.validation.fingerprint,
        timestamp: now,
      });
    }
  }
  
  // Trigger flush in background (non-blocking)
  flushToD1(env.DB).catch(() => {});
  
  return Response.json({ success: true, tracked: true }, { headers });
}

// POST /page-view - Track page view (queued for batch write)
async function handlePageView(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  const data = await request.json() as any;
  if (!data.userId || !data.pagePath) return Response.json({ error: 'Missing fields' }, { status: 400, headers });
  
  const geo = getGeo(request);
  
  pendingPageViews.push({
    id: `pv_${generateId()}`,
    userId: data.userId,
    sessionId: data.sessionId,
    pagePath: data.pagePath,
    pageTitle: data.pageTitle,
    referrer: data.referrer,
    entryTime: data.entryTime || Date.now(),
    country: geo.country,
    deviceType: data.deviceType,
  });
  
  // Trigger flush in background
  flushToD1(env.DB).catch(() => {});
  
  return Response.json({ success: true }, { headers });
}

// POST /watch-session - Track watch session (memory + queued)
async function handleWatchSession(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  const data = await request.json() as any;
  if (!data.userId || !data.contentId) return Response.json({ error: 'Missing fields' }, { status: 400, headers });
  
  const key = `${data.userId}_${data.contentId}_${data.seasonNumber || 0}_${data.episodeNumber || 0}`;
  const existing = pendingWatchSessions.get(key);
  const now = Date.now();
  
  pendingWatchSessions.set(key, {
    id: data.id || existing?.id || `ws_${generateId()}`,
    userId: data.userId,
    sessionId: data.sessionId,
    contentId: data.contentId,
    contentType: data.contentType || 'movie',
    contentTitle: data.contentTitle,
    seasonNumber: data.seasonNumber,
    episodeNumber: data.episodeNumber,
    startedAt: existing?.startedAt || data.startedAt || now,
    lastUpdate: now,
    watchTime: data.totalWatchTime || existing?.watchTime || 0,
    lastPosition: data.lastPosition || existing?.lastPosition || 0,
    duration: data.duration || existing?.duration || 0,
    completionPercentage: data.completionPercentage || existing?.completionPercentage || 0,
    isCompleted: data.isCompleted || existing?.isCompleted || false,
  });
  
  // Trigger flush in background
  flushToD1(env.DB).catch(() => {});
  
  return Response.json({ success: true }, { headers });
}

// POST /livetv-session - Track LiveTV
async function handleLiveTVSession(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  const data = await request.json() as any;
  if (!data.userId || !data.channelId) return Response.json({ error: 'Missing fields' }, { status: 400, headers });
  
  const geo = getGeo(request);
  const now = Date.now();
  
  // Update live user with activityType: 'livetv' - THIS IS THE KEY FIX
  const existingUser = liveUsers.get(data.userId);
  if (data.action !== 'stop') {
    liveUsers.set(data.userId, {
      userId: data.userId,
      sessionId: data.sessionId || existingUser?.sessionId || generateId(),
      activityType: 'livetv',
      contentId: data.channelId,
      contentTitle: data.channelName,
      contentType: 'livetv',
      country: geo.country || existingUser?.country,
      city: geo.city || existingUser?.city,
      lastHeartbeat: now,
      firstSeen: existingUser?.firstSeen || now,
    });
  } else {
    // On stop, set back to browsing
    if (existingUser) {
      existingUser.activityType = 'browsing';
      existingUser.contentId = undefined;
      existingUser.contentTitle = undefined;
      existingUser.lastHeartbeat = now;
    }
  }
  
  // Also track as watch session for historical data
  const key = `${data.userId}_livetv_${data.channelId}`;
  const existing = pendingWatchSessions.get(key);
  
  pendingWatchSessions.set(key, {
    id: `ltv_${generateId()}`,
    userId: data.userId,
    sessionId: data.sessionId,
    contentId: data.channelId,
    contentType: 'livetv',
    contentTitle: data.channelName,
    startedAt: existing?.startedAt || now,
    lastUpdate: now,
    watchTime: data.watchDuration || existing?.watchTime || 0,
    lastPosition: 0,
    duration: 0,
    completionPercentage: 0,
    isCompleted: false,
  });
  
  // IMPORTANT: Also send heartbeat to Durable Object for accurate live user count
  try {
    const doStub = getAnalyticsDO(env);
    const doRequest = new Request(new URL('/heartbeat', request.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: data.userId,
        sessionId: data.sessionId,
        activity: data.action === 'stop' ? 'browsing' : 'livetv',
        activityType: data.action === 'stop' ? 'browsing' : 'livetv',
        contentId: data.channelId,
        contentTitle: data.channelName,
        contentType: 'livetv',
        country: geo.country,
        city: geo.city,
      }),
    });
    await doStub.fetch(doRequest);
  } catch (e) {
    console.error('[LiveTV] Failed to update DO:', e);
  }
  
  flushToD1(env.DB).catch(() => {});
  return Response.json({ success: true }, { headers });
}

// POST /events - Handle generic analytics events (batch)
// Supports both old format { events: [...] } and new sync format
async function handleEvents(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  try {
    const data = await request.json() as any;
    const geo = getGeo(request);
    const now = Date.now();
    
    // Handle old format: { events: [...] }
    if (data.events && Array.isArray(data.events)) {
      for (const event of data.events) {
        const userId = event.userId || event.user_id || 'anonymous';
        const sessionId = event.sessionId || event.session_id || generateId();
        
        // ALWAYS update live user presence (fix: was only updating if >60s old)
        const existing = liveUsers.get(userId);
        liveUsers.set(userId, {
          userId,
          sessionId,
          activityType: existing?.activityType || 'browsing',
          contentId: existing?.contentId,
          contentTitle: existing?.contentTitle,
          contentType: existing?.contentType,
          country: geo.country || existing?.country,
          city: geo.city || existing?.city,
          lastHeartbeat: now,
          firstSeen: existing?.firstSeen || now,
        });
        
        // Handle specific event types
        if (event.type === 'page_view' || event.data?.page) {
          pendingPageViews.push({
            id: `pv_${generateId()}`,
            userId,
            sessionId,
            pagePath: event.data?.page || event.data?.path || '/',
            pageTitle: event.data?.title,
            referrer: event.data?.referrer,
            entryTime: event.timestamp || now,
            country: geo.country,
            deviceType: event.metadata?.deviceType,
          });
        }
      }
      
      flushToD1(env.DB).catch(() => {});
      return Response.json({ success: true, processed: data.events.length }, { headers });
    }
    
    // Handle new sync format (redirect to sync handler)
    if (data.userId) {
      return handleSync(request, env, headers);
    }
    
    // Unknown format - just acknowledge
    return Response.json({ success: true, processed: 0 }, { headers });
    
  } catch (e) {
    console.error('[Events] Error:', e);
    return Response.json({ success: true, processed: 0 }, { headers });
  }
}

// POST /sync - UNIFIED BATCH SYNC (called every 60s from client)
// This is the main endpoint - receives all analytics data in one request
async function handleSync(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  try {
    const data = await request.json() as any;
    if (!data.userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400, headers });
    }

    const geo = getGeo(request);
    const now = Date.now();
    const userId = data.userId;
    const sessionId = data.sessionId || generateId();

    // 1. Update live user presence in memory
    const existing = liveUsers.get(userId);
    liveUsers.set(userId, {
      userId,
      sessionId,
      activityType: data.activityType || 'browsing',
      contentId: data.currentContent?.contentId,
      contentTitle: data.currentContent?.contentTitle,
      contentType: data.currentContent?.contentType,
      seasonNumber: data.currentContent?.seasonNumber,
      episodeNumber: data.currentContent?.episodeNumber,
      country: geo.country || existing?.country,
      city: geo.city || existing?.city,
      lastHeartbeat: now,
      firstSeen: existing?.firstSeen || now,
    });

    // Remove user if they're leaving
    if (!data.isActive && !data.isVisible) {
      liveUsers.delete(userId);
    }

    // 2. Queue page views
    if (data.pageViews && Array.isArray(data.pageViews)) {
      for (const pv of data.pageViews) {
        pendingPageViews.push({
          id: `pv_${generateId()}`,
          userId,
          sessionId,
          pagePath: pv.path || '/',
          pageTitle: pv.title,
          referrer: pv.referrer,
          entryTime: pv.timestamp || now,
          country: geo.country,
          deviceType: data.device?.type,
        });
      }
    }

    // 3. Queue watch progress
    if (data.watchProgress && Array.isArray(data.watchProgress)) {
      for (const wp of data.watchProgress) {
        if (!wp.contentId) continue;
        
        const key = `${userId}_${wp.contentId}_${wp.seasonNumber || 0}_${wp.episodeNumber || 0}`;
        const existingSession = pendingWatchSessions.get(key);
        
        // Calculate watch time from position changes
        const watchTime = wp.position || 0;
        const completion = wp.duration > 0 ? Math.round((wp.position / wp.duration) * 100) : 0;
        
        pendingWatchSessions.set(key, {
          id: existingSession?.id || `ws_${generateId()}`,
          userId,
          sessionId,
          contentId: wp.contentId,
          contentType: wp.contentType || 'movie',
          contentTitle: wp.contentTitle,
          seasonNumber: wp.seasonNumber,
          episodeNumber: wp.episodeNumber,
          startedAt: existingSession?.startedAt || wp.startedAt || now,
          lastUpdate: now,
          watchTime: Math.max(watchTime, existingSession?.watchTime || 0),
          lastPosition: wp.position || 0,
          duration: wp.duration || existingSession?.duration || 0,
          completionPercentage: Math.max(completion, existingSession?.completionPercentage || 0),
          isCompleted: completion >= 90 || existingSession?.isCompleted || false,
        });
      }
    }

    // 4. Store bot detection if suspicious
    if (data.botDetection && data.botDetection.confidence >= 30) {
      const userAgent = request.headers.get('User-Agent') || 'unknown';
      const ipAddress = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      const existingDetection = pendingBotDetections.get(userId);
      if (!existingDetection || data.botDetection.confidence > existingDetection.confidenceScore) {
        pendingBotDetections.set(userId, {
          userId,
          ipAddress,
          userAgent,
          confidenceScore: data.botDetection.confidence,
          reasons: data.botDetection.reasons || [],
          fingerprint: data.botDetection.fingerprint,
          timestamp: now,
        });
      }
    }

    // 5. Trigger D1 flush in background (non-blocking)
    flushToD1(env.DB).catch(() => {});

    return Response.json({ 
      success: true, 
      synced: {
        presence: true,
        pageViews: data.pageViews?.length || 0,
        watchProgress: data.watchProgress?.length || 0,
      },
      timestamp: now,
    }, { headers });

  } catch (e) {
    console.error('[Sync] Error:', e);
    return Response.json({ success: false, error: String(e) }, { status: 500, headers });
  }
}


// POST /live-activity - Handle live activity updates (combines presence + watch session)
// This endpoint is called by the client's LiveActivityManager
async function handleLiveActivityPost(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  try {
    const data = await request.json() as any;
    if (!data.userId && !data.contentId) {
      return Response.json({ error: 'Missing userId or contentId' }, { status: 400, headers });
    }

    const geo = getGeo(request);
    const now = Date.now();
    const userId = data.userId || `anon_${generateId()}`;

    // Map action to activity type
    const activityType = (data.action === 'started' || data.action === 'watching') 
      ? 'watching' 
      : (data.action === 'paused' ? 'browsing' : 'browsing');

    // Update live user presence in memory
    const existing = liveUsers.get(userId);
    liveUsers.set(userId, {
      userId,
      sessionId: data.sessionId || existing?.sessionId || generateId(),
      activityType,
      contentId: data.contentId,
      contentTitle: data.contentTitle,
      contentType: data.contentType,
      seasonNumber: data.season,
      episodeNumber: data.episode,
      country: geo.country || existing?.country,
      city: geo.city || existing?.city,
      lastHeartbeat: now,
      firstSeen: existing?.firstSeen || now,
    });

    // If we have progress/duration, also track as watch session
    if (data.contentId && (data.progress !== undefined || data.duration !== undefined)) {
      const key = `${userId}_${data.contentId}_${data.season || 0}_${data.episode || 0}`;
      const existingSession = pendingWatchSessions.get(key);
      
      const duration = data.duration || existingSession?.duration || 0;
      const progress = data.progress || 0;
      const lastPosition = duration > 0 ? Math.round(duration * (progress / 100)) : 0;
      
      pendingWatchSessions.set(key, {
        id: existingSession?.id || `ws_${generateId()}`,
        userId,
        sessionId: data.sessionId,
        contentId: data.contentId,
        contentType: data.contentType || 'movie',
        contentTitle: data.contentTitle,
        seasonNumber: data.season,
        episodeNumber: data.episode,
        startedAt: existingSession?.startedAt || now,
        lastUpdate: now,
        watchTime: Math.max(lastPosition, existingSession?.watchTime || 0),
        lastPosition,
        duration,
        completionPercentage: Math.max(progress, existingSession?.completionPercentage || 0),
        isCompleted: data.action === 'completed' || progress >= 90 || existingSession?.isCompleted || false,
      });
    }

    // Trigger D1 flush in background (non-blocking)
    flushToD1(env.DB).catch(() => {});

    return Response.json({ 
      success: true, 
      tracked: true,
      userId,
      activityType,
      timestamp: now,
    }, { headers });

  } catch (e) {
    console.error('[LiveActivity POST] Error:', e);
    return Response.json({ success: false, error: String(e) }, { status: 500, headers });
  }
}


// GET /live-activity - Get current live users (FROM D1 + MEMORY)
async function handleGetLiveActivity(env: Env, headers: HeadersInit): Promise<Response> {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  
  // Get memory stats first
  const { stats: memoryStats, users: memoryUsers } = getRealtimeStats();
  
  // If memory is empty (cold start), query D1
  let stats = memoryStats;
  let users = memoryUsers;
  
  if (memoryUsers.length === 0) {
    try {
      // Get live users from D1
      const result = await env.DB.prepare(`
        SELECT user_id, activity_type, content_id, content_title, content_type, country, city, last_heartbeat
        FROM live_activity 
        WHERE is_active = 1 AND last_heartbeat >= ?
        ORDER BY last_heartbeat DESC
        LIMIT 500
      `).bind(fiveMinutesAgo).all();
      
      const d1Users = (result.results || []).map((u: any) => ({
        userId: u.user_id,
        activityType: u.activity_type,
        contentId: u.content_id,
        contentTitle: u.content_title,
        contentType: u.content_type,
        country: u.country,
        city: u.city,
        lastHeartbeat: u.last_heartbeat,
      }));
      
      // Recalculate stats from D1 users
      stats = {
        total: d1Users.length,
        watching: d1Users.filter((u: any) => u.activityType === 'watching').length,
        browsing: d1Users.filter((u: any) => u.activityType === 'browsing').length,
        livetv: d1Users.filter((u: any) => u.activityType === 'livetv').length,
      };
      
      // Return D1 data directly
      return Response.json({
        success: true,
        summary: stats,
        activities: d1Users.map((u: any) => ({
          user_id: u.userId,
          activity_type: u.activityType,
          content_id: u.contentId,
          content_title: u.contentTitle,
          content_type: u.contentType,
          country: u.country,
          city: u.city,
          last_heartbeat: u.lastHeartbeat,
        })),
        timestamp: now,
        source: 'd1',
      }, { headers });
    } catch (e) {
      console.error('[LiveActivity] D1 query error:', e);
    }
  }
  
  return Response.json({
    success: true,
    summary: stats,
    activities: users.map((u) => ({
      user_id: u.userId,
      activity_type: u.activityType,
      content_id: u.contentId,
      content_title: u.contentTitle,
      content_type: u.contentType,
      country: u.country,
      city: u.city,
      last_heartbeat: u.lastHeartbeat,
    })),
    timestamp: now,
    source: 'memory',
  }, { headers });
}

// GET /unified-stats - Get all stats (D1 for realtime + historical)
async function handleGetUnifiedStats(env: Env, headers: HeadersInit): Promise<Response> {
  const now = Date.now();
  
  // Get memory stats (may be partial due to worker distribution)
  const { stats: memoryStats, peak } = getRealtimeStats();
  
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  
  // Check real-time D1 cache first (reduces D1 reads significantly)
  let realtimeFromD1 = { total: 0, watching: 0, browsing: 0, livetv: 0 };
  let realtimeUsers: any[] = [];
  
  if (realtimeD1Cache && now - realtimeD1Cache.timestamp < REALTIME_D1_CACHE_TTL) {
    // Use cached real-time data
    realtimeFromD1 = realtimeD1Cache.data.stats;
    realtimeUsers = realtimeD1Cache.data.users;
    console.log('[UnifiedStats] Using cached D1 realtime:', realtimeFromD1.total, 'users');
  } else {
    // Query D1 for real-time stats (workers are distributed, memory is partial)
    try {
      // Get live users from D1 (users with heartbeat in last 5 minutes)
      const liveResult = await env.DB.prepare(`
        SELECT activity_type, COUNT(DISTINCT user_id) as count
        FROM live_activity 
        WHERE is_active = 1 AND last_heartbeat >= ?
        GROUP BY activity_type
      `).bind(fiveMinutesAgo).all();
      
      for (const row of (liveResult.results || [])) {
        const count = parseInt(String(row.count)) || 0;
        realtimeFromD1.total += count;
        if (row.activity_type === 'watching') realtimeFromD1.watching = count;
        else if (row.activity_type === 'browsing') realtimeFromD1.browsing = count;
        else if (row.activity_type === 'livetv') realtimeFromD1.livetv = count;
      }
      
      // Get user details for geographic breakdown
      const usersResult = await env.DB.prepare(`
        SELECT user_id, activity_type, content_id, content_title, content_type, country, city, last_heartbeat
        FROM live_activity 
        WHERE is_active = 1 AND last_heartbeat >= ?
        ORDER BY last_heartbeat DESC
        LIMIT 500
      `).bind(fiveMinutesAgo).all();
      realtimeUsers = usersResult.results || [];
      
      // Cache the real-time D1 results
      realtimeD1Cache = {
        timestamp: now,
        data: { stats: realtimeFromD1, users: realtimeUsers }
      };
      
      console.log('[UnifiedStats] Fresh D1 realtime:', realtimeFromD1.total, 'users, memory:', memoryStats.total);
    } catch (e) {
      console.error('[UnifiedStats] D1 realtime query error:', e);
    }
  }
  
  // Use D1 data (authoritative) - memory is only partial due to worker distribution
  const stats = realtimeFromD1;
  const users = realtimeUsers.map(u => ({
    userId: u.user_id,
    activityType: u.activity_type,
    contentId: u.content_id,
    contentTitle: u.content_title,
    contentType: u.content_type,
    country: u.country,
    city: u.city,
    lastHeartbeat: u.last_heartbeat,
  }));
  
  // Get historical data from cache or D1
  let historical = historicalStatsCache;
  if (!historical || now - historical.timestamp > HISTORICAL_CACHE_TTL) {
    try {
      const [userStats, contentStats, pageStats, geoStats, cityStats, deviceStats, topContentStats, botStats] = await Promise.all([
        // User activity stats
        env.DB.prepare(`
          SELECT COUNT(DISTINCT user_id) as total,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as dau,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as wau,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as mau,
            COUNT(DISTINCT CASE WHEN first_seen >= ? THEN user_id END) as new_today,
            COUNT(DISTINCT CASE WHEN first_seen < ? AND last_seen >= ? THEN user_id END) as returning
          FROM user_activity
        `).bind(oneDayAgo, sevenDaysAgo, thirtyDaysAgo, oneDayAgo, oneDayAgo, oneDayAgo).first(),
        
        // Content/watch session stats
        env.DB.prepare(`
          SELECT 
            COUNT(*) as sessions, 
            COALESCE(SUM(total_watch_time), 0) as watch_time,
            COALESCE(AVG(total_watch_time), 0) as avg_duration,
            COALESCE(AVG(completion_percentage), 0) as avg_completion,
            SUM(CASE WHEN is_completed = 1 OR completion_percentage >= 90 THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN content_type = 'movie' THEN 1 ELSE 0 END) as movie_sessions,
            SUM(CASE WHEN content_type = 'tv' THEN 1 ELSE 0 END) as tv_sessions,
            COUNT(DISTINCT content_id) as unique_content
          FROM watch_sessions WHERE started_at >= ?
        `).bind(oneDayAgo).first(),
        
        // Page view stats
        env.DB.prepare(`
          SELECT COUNT(*) as views, COUNT(DISTINCT user_id) as visitors
          FROM page_views WHERE entry_time >= ?
        `).bind(oneDayAgo).first(),
        
        // Geographic stats (countries)
        env.DB.prepare(`
          SELECT country, COUNT(DISTINCT user_id) as count
          FROM user_activity WHERE last_seen >= ? AND country IS NOT NULL AND country != ''
          GROUP BY country ORDER BY count DESC LIMIT 20
        `).bind(sevenDaysAgo).all(),
        
        // City stats
        env.DB.prepare(`
          SELECT city, country, COUNT(DISTINCT user_id) as count
          FROM user_activity WHERE last_seen >= ? AND city IS NOT NULL AND city != '' AND country IS NOT NULL
          GROUP BY city, country ORDER BY count DESC LIMIT 30
        `).bind(sevenDaysAgo).all(),
        
        // Device stats (from live_activity since user_activity may not have device_type)
        env.DB.prepare(`
          SELECT 
            CASE 
              WHEN content_type LIKE '%mobile%' THEN 'mobile'
              WHEN content_type LIKE '%tablet%' THEN 'tablet'
              ELSE 'desktop'
            END as device,
            COUNT(DISTINCT user_id) as count
          FROM user_activity WHERE last_seen >= ?
          GROUP BY device ORDER BY count DESC
        `).bind(sevenDaysAgo).all(),
        
        // Top content
        env.DB.prepare(`
          SELECT content_id, content_title, content_type, COUNT(*) as watch_count, SUM(total_watch_time) as total_watch_time
          FROM watch_sessions WHERE started_at >= ? AND content_title IS NOT NULL
          GROUP BY content_id, content_title, content_type
          ORDER BY watch_count DESC LIMIT 10
        `).bind(sevenDaysAgo).all(),
        
        // Bot detection stats
        env.DB.prepare(`
          SELECT 
            COUNT(*) as total_detections,
            COUNT(CASE WHEN status = 'suspected' THEN 1 END) as suspected,
            COUNT(CASE WHEN status = 'confirmed_bot' THEN 1 END) as confirmed,
            COUNT(CASE WHEN status = 'pending_review' THEN 1 END) as pending,
            AVG(confidence_score) as avg_confidence
          FROM bot_detections WHERE created_at >= ?
        `).bind(sevenDaysAgo).first(),
      ]);
      
      historical = {
        timestamp: now,
        data: { 
          userStats, 
          contentStats, 
          pageStats, 
          geoStats: geoStats.results || [],
          cityStats: cityStats.results || [],
          deviceStats: deviceStats.results || [],
          topContentStats: topContentStats.results || [],
          botStats,
        }
      };
      historicalStatsCache = historical;
    } catch (e) {
      console.error('[Stats] D1 error:', e);
      historical = { 
        timestamp: now, 
        data: { 
          userStats: {}, 
          contentStats: {}, 
          pageStats: {}, 
          geoStats: [],
          cityStats: [],
          deviceStats: [],
          topContentStats: [],
          botStats: {},
        } 
      };
    }
  }
  
  const h = historical.data;
  
  // Build realtime geographic from live users
  const realtimeGeoMap = new Map<string, number>();
  for (const user of users) {
    if (user.country) {
      realtimeGeoMap.set(user.country, (realtimeGeoMap.get(user.country) || 0) + 1);
    }
  }
  const realtimeGeographic = Array.from(realtimeGeoMap.entries())
    .map(([country, count]) => ({ country, countryName: country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  
  return Response.json({
    success: true,
    // Real-time data from memory
    realtime: { 
      totalActive: stats.total, 
      trulyActive: stats.total, // Same as totalActive for now
      watching: stats.watching, 
      browsing: stats.browsing, 
      livetv: stats.livetv 
    },
    realtimeGeographic,
    // Peak stats
    peakStats: { 
      date: peak.date, 
      peakTotal: peak.total, 
      peakWatching: peak.watching, 
      peakLiveTV: peak.livetv, 
      peakBrowsing: peak.browsing,
      peakTotalTime: peak.time,
      peakWatchingTime: peak.time,
      peakLiveTVTime: peak.time,
      peakBrowsingTime: peak.time,
    },
    // User metrics
    users: { 
      total: parseInt(String(h.userStats?.total)) || 0, 
      dau: parseInt(String(h.userStats?.dau)) || 0, 
      wau: parseInt(String(h.userStats?.wau)) || 0, 
      mau: parseInt(String(h.userStats?.mau)) || 0,
      newToday: parseInt(String(h.userStats?.new_today)) || 0,
      returning: parseInt(String(h.userStats?.returning)) || 0,
    },
    // Content metrics
    content: { 
      totalSessions: parseInt(h.contentStats?.sessions) || 0, 
      totalWatchTime: Math.round((parseFloat(h.contentStats?.watch_time) || 0) / 60),
      avgDuration: Math.round((parseFloat(h.contentStats?.avg_duration) || 0) / 60),
      completionRate: Math.round(parseFloat(h.contentStats?.avg_completion) || 0),
      completedSessions: parseInt(h.contentStats?.completed) || 0,
      movieSessions: parseInt(h.contentStats?.movie_sessions) || 0,
      tvSessions: parseInt(h.contentStats?.tv_sessions) || 0,
      uniqueContentWatched: parseInt(h.contentStats?.unique_content) || 0,
      allTimeWatchTime: Math.round((parseFloat(h.contentStats?.watch_time) || 0) / 60),
      totalPauses: 0,
      totalSeeks: 0,
    },
    // Top content
    topContent: (h.topContentStats || []).map((c: any) => ({
      contentId: c.content_id,
      contentTitle: c.content_title || 'Unknown',
      contentType: c.content_type || 'unknown',
      watchCount: parseInt(c.watch_count) || 0,
      totalWatchTime: Math.round((parseFloat(c.total_watch_time) || 0) / 60),
    })),
    // Page views
    pageViews: { 
      total: parseInt(h.pageStats?.views) || 0, 
      uniqueVisitors: parseInt(h.pageStats?.visitors) || 0 
    },
    // Geographic data
    geographic: (h.geoStats || []).map((g: any) => ({ 
      country: g.country, 
      countryName: g.country, // Could add country name lookup
      count: parseInt(g.count) || 0 
    })),
    // Cities
    cities: (h.cityStats || []).map((c: any) => ({
      city: c.city,
      country: c.country,
      countryName: c.country,
      count: parseInt(c.count) || 0,
    })),
    // Devices
    devices: (h.deviceStats || []).length > 0 
      ? (h.deviceStats || []).map((d: any) => ({
          device: d.device || 'desktop',
          count: parseInt(d.count) || 0,
        }))
      : [{ device: 'desktop', count: stats.total }], // Fallback
    // Bot detection
    botDetection: {
      totalDetections: parseInt(h.botStats?.total_detections) || 0,
      suspectedBots: parseInt(h.botStats?.suspected) || 0,
      confirmedBots: parseInt(h.botStats?.confirmed) || 0,
      pendingReview: parseInt(h.botStats?.pending) || 0,
      avgConfidenceScore: Math.round(parseFloat(h.botStats?.avg_confidence) || 0),
      recentDetections: [],
    },
    // Time ranges for transparency
    timeRanges: {
      realtime: '2 minutes',
      realtimeGeographic: '2 minutes',
      dau: '24 hours',
      wau: '7 days',
      mau: '30 days',
      content: '24 hours',
      geographic: '7 days',
      cities: '7 days',
      devices: '7 days',
      pageViews: '24 hours',
      botDetection: '7 days',
    },
    selectedTimeRange: '24h',
    timestamp: now,
  }, { headers });
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

async function handleInitDb(env: Env, headers: HeadersInit): Promise<Response> {
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS live_activity (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          session_id TEXT,
          activity_type TEXT DEFAULT 'browsing',
          content_id TEXT,
          content_title TEXT,
          content_type TEXT,
          season_number INTEGER,
          episode_number INTEGER,
          country TEXT,
          city TEXT,
          started_at INTEGER,
          last_heartbeat INTEGER,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER,
          updated_at INTEGER
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_live_activity_user ON live_activity(user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_live_activity_active ON live_activity(is_active, last_heartbeat)`),
      
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS page_views (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_id TEXT,
          page_path TEXT NOT NULL,
          page_title TEXT,
          referrer TEXT,
          entry_time INTEGER,
          device_type TEXT,
          country TEXT,
          created_at INTEGER
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_page_views_user ON page_views(user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_page_views_time ON page_views(entry_time)`),
      
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS watch_sessions (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          user_id TEXT NOT NULL,
          content_id TEXT NOT NULL,
          content_type TEXT,
          content_title TEXT,
          season_number INTEGER,
          episode_number INTEGER,
          started_at INTEGER,
          total_watch_time INTEGER DEFAULT 0,
          last_position INTEGER DEFAULT 0,
          duration INTEGER DEFAULT 0,
          completion_percentage INTEGER DEFAULT 0,
          is_completed INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_user ON watch_sessions(user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_content ON watch_sessions(content_id)`),
      
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS user_activity (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          session_id TEXT,
          first_seen INTEGER,
          last_seen INTEGER,
          country TEXT,
          city TEXT,
          created_at INTEGER,
          updated_at INTEGER
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_activity_seen ON user_activity(last_seen)`),
      
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS peak_stats (
          date TEXT PRIMARY KEY,
          peak_total INTEGER DEFAULT 0,
          peak_total_time INTEGER,
          peak_watching INTEGER DEFAULT 0,
          peak_watching_time INTEGER,
          peak_livetv INTEGER DEFAULT 0,
          peak_livetv_time INTEGER,
          peak_browsing INTEGER DEFAULT 0,
          peak_browsing_time INTEGER,
          created_at INTEGER,
          updated_at INTEGER
        )
      `),
      
      // Bot detection table
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS bot_detections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL UNIQUE,
          ip_address TEXT NOT NULL,
          user_agent TEXT,
          confidence_score INTEGER NOT NULL,
          detection_reasons TEXT,
          fingerprint TEXT,
          status TEXT DEFAULT 'suspected',
          reviewed_by TEXT,
          reviewed_at INTEGER,
          created_at INTEGER,
          updated_at INTEGER
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bot_detections_user ON bot_detections(user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bot_detections_confidence ON bot_detections(confidence_score)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bot_detections_status ON bot_detections(status)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bot_detections_created ON bot_detections(created_at)`),
    ]);
    
    return Response.json({ success: true, message: 'Database initialized' }, { headers });
  } catch (error) {
    console.error('[InitDB] Error:', error);
    return Response.json({ success: false, error: String(error) }, { status: 500, headers });
  }
}

// =============================================================================
// MAIN HANDLER - Route requests to appropriate handlers
// =============================================================================

// Helper to get the Durable Object stub
function getAnalyticsDO(env: Env): DurableObjectStub {
  const id = env.ANALYTICS_DO.idFromName('global-analytics');
  return env.ANALYTICS_DO.get(id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const headers = cors(request);
    
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    
    // Health check
    if (path === '/health' || path === '/') {
      const { stats } = getRealtimeStats();
      return Response.json({
        status: 'ok',
        architecture: 'durable-object',
        memoryUsers: stats.total,
        dirtyUsers: dirtyUsers.size,
        pendingPageViews: pendingPageViews.length,
        pendingWatchSessions: pendingWatchSessions.size,
        pendingBotDetections: pendingBotDetections.size,
        lastFlush: lastFlushTime,
        flushIntervalMs: FLUSH_INTERVAL,
        historicalCacheTTLMs: HISTORICAL_CACHE_TTL,
        realtimeCacheTTLMs: REALTIME_D1_CACHE_TTL,
        costOptimizations: {
          dirtyTracking: true,
          flushInterval: '2 minutes',
          historicalCache: '30 minutes',
          realtimeCache: '30 seconds',
        },
        timestamp: Date.now(),
      }, { headers });
    }
    
    // Force flush (admin endpoint)
    if (path === '/flush' && method === 'POST') {
      await flushToD1(env.DB, true);
      return Response.json({ success: true, flushed: true }, { headers });
    }
    
    // Initialize database tables
    if (path === '/init-db' && method === 'POST') {
      return handleInitDb(env, headers);
    }
    
    // Route handlers
    try {
      // =========================================================================
      // DURABLE OBJECT ROUTES - Real-time tracking goes through DO
      // =========================================================================
      
      // Admin stats endpoint - routed to DO
      if (method === 'GET' && (path === '/admin/stats' || path === '/api/admin/stats')) {
        const doStub = getAnalyticsDO(env);
        const doRequest = new Request(new URL('/stats', request.url).toString(), {
          method: 'GET',
          headers: request.headers,
        });
        return doStub.fetch(doRequest);
      }
      
      // POST endpoints - write to memory (instant)
      if (method === 'POST') {
        switch (path) {
          case '/presence':
          case '/api/presence': {
            // Route presence to Durable Object for accurate counting
            const doStub = getAnalyticsDO(env);
            const body = await request.text();
            const geo = getGeo(request);
            const doRequest = new Request(new URL('/heartbeat', request.url).toString(), {
              method: 'POST',
              headers: request.headers,
              body: JSON.stringify({
                ...JSON.parse(body),
                country: geo.country,
                city: geo.city,
              }),
            });
            return doStub.fetch(doRequest);
          }
          case '/page-view':
          case '/api/page-view':
            return handlePageView(request, env, headers);
          case '/watch-session':
          case '/api/watch-session':
            return handleWatchSession(request, env, headers);
          case '/livetv-session':
          case '/api/livetv-session':
            return handleLiveTVSession(request, env, headers);
          case '/live-activity':
          case '/api/live-activity':
            // POST to /live-activity is treated as a presence update with watch data
            return handleLiveActivityPost(request, env, headers);
          case '/events':
          case '/api/events':
            return handleEvents(request, env, headers);
          case '/sync':
          case '/api/sync': {
            // Route sync to Durable Object for accurate counting
            const body = await request.text();
            const geo = getGeo(request);
            let parsed: any;
            
            try {
              parsed = JSON.parse(body);
            } catch (e) {
              return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
            }
            
            // Handle page views and watch sessions locally
            if (parsed.pageViews?.length || parsed.watchProgress?.length) {
              const now = Date.now();
              const userId = parsed.userId;
              const sessionId = parsed.sessionId;
              
              // Queue page views
              if (parsed.pageViews && Array.isArray(parsed.pageViews)) {
                for (const pv of parsed.pageViews) {
                  pendingPageViews.push({
                    id: `pv_${generateId()}`,
                    userId,
                    sessionId,
                    pagePath: pv.path || '/',
                    pageTitle: pv.title,
                    referrer: pv.referrer,
                    entryTime: pv.timestamp || now,
                    country: geo.country,
                    deviceType: parsed.device?.type,
                  });
                }
              }
              
              // Queue watch progress
              if (parsed.watchProgress && Array.isArray(parsed.watchProgress)) {
                for (const wp of parsed.watchProgress) {
                  if (!wp.contentId) continue;
                  const key = `${userId}_${wp.contentId}_${wp.seasonNumber || 0}_${wp.episodeNumber || 0}`;
                  const existingSession = pendingWatchSessions.get(key);
                  const watchTime = wp.position || 0;
                  const completion = wp.duration > 0 ? Math.round((wp.position / wp.duration) * 100) : 0;
                  
                  pendingWatchSessions.set(key, {
                    id: existingSession?.id || `ws_${generateId()}`,
                    userId,
                    sessionId,
                    contentId: wp.contentId,
                    contentType: wp.contentType || 'movie',
                    contentTitle: wp.contentTitle,
                    seasonNumber: wp.seasonNumber,
                    episodeNumber: wp.episodeNumber,
                    startedAt: existingSession?.startedAt || wp.startedAt || now,
                    lastUpdate: now,
                    watchTime: Math.max(watchTime, existingSession?.watchTime || 0),
                    lastPosition: wp.position || 0,
                    duration: wp.duration || existingSession?.duration || 0,
                    completionPercentage: Math.max(completion, existingSession?.completionPercentage || 0),
                    isCompleted: completion >= 90 || existingSession?.isCompleted || false,
                  });
                }
              }
              
              // Trigger flush
              flushToD1(env.DB).catch(() => {});
            }
            
            // Route presence to Durable Object
            const doStub = getAnalyticsDO(env);
            const doRequest = new Request(new URL('/heartbeat', request.url).toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: parsed.userId,
                sessionId: parsed.sessionId,
                activity: parsed.activityType,
                activityType: parsed.activityType,
                contentId: parsed.currentContent?.contentId,
                contentTitle: parsed.currentContent?.contentTitle,
                contentType: parsed.currentContent?.contentType,
                country: geo.country,
                city: geo.city,
              }),
            });
            const doResponse = await doStub.fetch(doRequest);
            const doData = await doResponse.json() as any;
            
            return Response.json({
              success: true,
              synced: {
                presence: true,
                pageViews: parsed.pageViews?.length || 0,
                watchProgress: parsed.watchProgress?.length || 0,
              },
              liveUsers: doData.liveUsers,
              timestamp: Date.now(),
            }, { headers });
          }
        }
      }
      
      // GET endpoints - read from memory (instant for realtime)
      if (method === 'GET') {
        switch (path) {
          case '/live-activity':
          case '/api/live-activity': {
            // Route to Durable Object for accurate count
            const doStub = getAnalyticsDO(env);
            const doRequest = new Request(new URL('/live', request.url).toString(), {
              method: 'GET',
              headers: request.headers,
            });
            return doStub.fetch(doRequest);
          }
          case '/unified-stats':
          case '/api/unified-stats':
            return handleGetUnifiedStats(env, headers);
          case '/activity-history':
          case '/api/activity-history': {
            // Return hourly activity history for the last N hours
            const url = new URL(request.url);
            const hours = parseInt(url.searchParams.get('hours') || '12');
            const hoursAgo = Date.now() - (hours * 60 * 60 * 1000);
            
            try {
              const result = await env.DB.prepare(`
                SELECT 
                  strftime('%Y-%m-%d %H:00', datetime(last_heartbeat/1000, 'unixepoch')) as hour,
                  COUNT(DISTINCT user_id) as users,
                  SUM(CASE WHEN activity_type = 'watching' THEN 1 ELSE 0 END) as watching,
                  SUM(CASE WHEN activity_type = 'browsing' THEN 1 ELSE 0 END) as browsing,
                  SUM(CASE WHEN activity_type = 'livetv' THEN 1 ELSE 0 END) as livetv
                FROM live_activity
                WHERE last_heartbeat >= ?
                GROUP BY hour
                ORDER BY hour DESC
                LIMIT ?
              `).bind(hoursAgo, hours).all();
              
              const history = (result.results || []).map((row: any) => ({
                hour: row.hour,
                users: parseInt(row.users) || 0,
                watching: parseInt(row.watching) || 0,
                browsing: parseInt(row.browsing) || 0,
                livetv: parseInt(row.livetv) || 0,
              }));
              
              return Response.json({ success: true, history }, { headers });
            } catch (e) {
              console.error('[ActivityHistory] Error:', e);
              return Response.json({ success: true, history: [] }, { headers });
            }
          }
          case '/debug':
            return Response.json({
              liveUsers: Array.from(liveUsers.entries()),
              pendingPageViews: pendingPageViews.length,
              pendingWatchSessions: Array.from(pendingWatchSessions.keys()),
              pendingBotDetections: Array.from(pendingBotDetections.entries()).map(([k, v]) => ({
                userId: k,
                confidence: v.confidenceScore,
                reasons: v.reasons,
              })),
              lastFlush: lastFlushTime,
              peak: peakStats,
            }, { headers });
        }
      }
      
      return Response.json({ error: 'Not found', path }, { status: 404, headers });
    } catch (error) {
      console.error('[Worker] Error:', error);
      return Response.json({ error: 'Internal error' }, { status: 500, headers });
    }
  },

  // Scheduled handler for cron jobs (daily metrics aggregation)
  // Runs at midnight UTC daily - configured in wrangler.toml
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
