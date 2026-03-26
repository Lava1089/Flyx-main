/**
 * Flyx Sync Worker
 *
 * Cloudflare Worker for anonymous cross-device sync + real-time admin panel.
 * All real-time analytics live in worker memory — zero D1 reads/writes on hot path.
 * D1 is only written once per day (midnight cron) for historical daily stats.
 *
 * Endpoints:
 *   GET  /sync        - Pull sync data (requires X-Sync-Code header)
 *   POST /sync        - Push sync data (requires X-Sync-Code header)
 *   DELETE /sync      - Delete sync account (requires X-Sync-Code header)
 *   GET  /health      - Health check
 *   POST /heartbeat   - Record user heartbeat (in-memory only, zero D1)
 *   GET  /admin/live  - Live activity stats (from memory)
 *   GET  /admin/stats - Stats (memory for today, D1 for historical)
 *   GET  /admin/sse   - SSE real-time data stream (JWT required)
 */

import { InMemoryAnalyticsState } from './in-memory-analytics';
import { DeltaEngine } from './delta-engine';
import { SSEManager, SSEChannel } from './sse-manager';
import { handleConsolidatedStats } from './stats-api';

// ============================================================================
// Types
// ============================================================================

export interface Env {
  SYNC_ENCRYPTION_KEY?: string;
  ALLOWED_ORIGINS?: string;
  LOG_LEVEL?: string;
  ADMIN_JWT_SECRET?: string;
  SYNC_DB?: D1Database;
  SYNC_CACHE?: KVNamespace;
}

interface SyncData {
  watchProgress: Record<string, WatchProgressItem>;
  watchlist: WatchlistItem[];
  providerSettings: ProviderSettings;
  subtitleSettings: SubtitleSettings;
  playerSettings: PlayerSettings;
  lastSyncedAt: number;
  schemaVersion: number;
}

interface WatchProgressItem {
  contentId: string;
  contentType: 'movie' | 'tv';
  progress: number;
  duration: number;
  lastWatched: number;
  season?: number;
  episode?: number;
  title?: string;
}

interface WatchlistItem {
  id: number | string;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  addedAt: number;
}

interface ProviderSettings {
  providerOrder: string[];
  disabledProviders: string[];
  lastSuccessfulProviders: Record<string, string>;
  animeAudioPreference: 'sub' | 'dub';
  preferredAnimeKaiServer: string | null;
}

interface SubtitleSettings {
  enabled: boolean;
  languageCode: string;
  languageName: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  verticalPosition: number;
}

interface PlayerSettings {
  autoPlayNextEpisode: boolean;
  autoPlayCountdown: number;
  showNextEpisodeBeforeEnd: number;
  volume: number;
  isMuted: boolean;
}

// ============================================================================
// Worker-level singletons (persist across requests within same isolate)
// ============================================================================

let analyticsState: InMemoryAnalyticsState | null = null;
let deltaEngine: DeltaEngine | null = null;
let sseManager: SSEManager | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

/** Flush interval in ms — triggers delta computation + SSE broadcast */
const FLUSH_INTERVAL_MS = 10_000;

function getAnalyticsState(): InMemoryAnalyticsState {
  if (!analyticsState) {
    analyticsState = new InMemoryAnalyticsState();
  }
  return analyticsState;
}

function getDeltaEngine(): DeltaEngine {
  if (!deltaEngine) {
    deltaEngine = new DeltaEngine();
  }
  return deltaEngine;
}

function getSSEManager(env: Env): SSEManager {
  if (!sseManager) {
    sseManager = new SSEManager(getDeltaEngine(), createJWTValidator(env));
  }
  return sseManager;
}

/**
 * Create a JWT validator function for SSE authentication.
 * Uses HMAC-SHA256 with the ADMIN_JWT_SECRET env var.
 */
function createJWTValidator(env: Env): (token: string) => Promise<{ sub: string; exp: number; iat: number; role?: string } | null> {
  return async (token: string) => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadStr);

      // Check expiry
      if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

      // If we have a secret, verify signature
      if (env.ADMIN_JWT_SECRET) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(env.ADMIN_JWT_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify']
        );

        const signatureInput = `${parts[0]}.${parts[1]}`;
        const signature = Uint8Array.from(
          atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
          (c) => c.charCodeAt(0)
        );

        const valid = await crypto.subtle.verify(
          'HMAC',
          key,
          signature,
          encoder.encode(signatureInput)
        );

        if (!valid) return null;
      }

      return {
        sub: payload.sub || '',
        exp: payload.exp,
        iat: payload.iat || 0,
        role: payload.role,
      };
    } catch {
      return null;
    }
  };
}

// ============================================================================
// Flush timer — computes deltas from in-memory state + broadcasts via SSE
// Zero D1 reads/writes
// ============================================================================

function ensureFlushTimer(env: Env): void {
  if (flushIntervalId !== null) return;

  flushIntervalId = setInterval(() => {
    try {
      flushAndBroadcast(env);
    } catch (err) {
      console.error('[Sync Worker] Flush timer error:', err);
    }
  }, FLUSH_INTERVAL_MS);
}

/**
 * Compute deltas from in-memory analytics state and broadcast via SSE.
 * Pure in-memory operation — zero D1 reads/writes.
 */
export function flushAndBroadcast(env: Env): void {
  const state = getAnalyticsState();
  const delta = getDeltaEngine();
  const sse = getSSEManager(env);

  // Only compute deltas if there are SSE subscribers
  if (sse.getConnectionCount() === 0) return;

  // Get real-time snapshot from memory
  const snapshot = state.getRealtimeSnapshot();

  // Compute and broadcast realtime delta
  const realtimeDelta = delta.computeDelta('realtime', snapshot);
  if (realtimeDelta) {
    sse.broadcastDelta('realtime' as SSEChannel, realtimeDelta);
  }

  // Compute and broadcast users delta
  const usersState = {
    dau: state.uniqueToday,
    wau: 0, // historical — only available from D1
    mau: 0, // historical — only available from D1
    totalUsers: state.uniqueToday,
    newToday: state.uniqueToday,
    returningUsers: 0,
    deviceBreakdown: [],
  };
  const usersDelta = delta.computeDelta('users', usersState);
  if (usersDelta) {
    sse.broadcastDelta('users' as SSEChannel, usersDelta);
  }
}

// ============================================================================
// CORS helpers
// ============================================================================

function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || ['*'];
  const isAllowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin || '*' : '',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Code, X-Sync-Passphrase',
    'Access-Control-Max-Age': '86400',
  };
}

// ============================================================================
// Sync code helpers
// ============================================================================

export async function hashSyncCode(code: string): Promise<string> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized + '_flyx_sync_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isValidSyncCode(code: string): boolean {
  if (!code) return false;
  const normalized = code.toUpperCase().replace(/\s/g, '');
  return /^FLYX-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(normalized);
}

function generateId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// ============================================================================
// IP hashing
// ============================================================================

export const VALID_ACTIVITY_TYPES = ['browsing', 'watching', 'livetv'] as const;

export async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + '_flyx_heartbeat_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const KNOWN_SCHEMA_VERSIONS = [1, 2];

// ============================================================================
// Main worker export
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      const state = analyticsState;
      const sse = sseManager;
      return Response.json({
        status: 'ok',
        service: 'flyx-sync',
        timestamp: Date.now(),
        hasD1: !!env.SYNC_DB,
        sseConnections: sse?.getConnectionCount() ?? 0,
        activeUsers: state?.activeCount ?? 0,
        uniqueToday: state?.uniqueToday ?? 0,
      }, { headers: corsHeaders });
    }

    // SSE endpoint
    if (url.pathname === '/admin/sse' && request.method === 'GET') {
      try {
        const sse = getSSEManager(env);
        ensureFlushTimer(env);
        const response = await sse.connect(request);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch (error) {
        console.error('[Sync Worker] SSE connect error:', error);
        return Response.json(
          { success: false, error: 'SSE connection failed' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Sync endpoints — support both /sync and /analytics/sync paths
    const syncPath = url.pathname.replace(/^\/analytics/, '');
    if (syncPath === '/sync') {
      try {
        const syncCode = request.headers.get('X-Sync-Code');

        if (!syncCode || !isValidSyncCode(syncCode)) {
          return Response.json(
            { success: false, error: 'Invalid or missing sync code' },
            { status: 400, headers: corsHeaders }
          );
        }

        const codeHash = await hashSyncCode(syncCode);

        switch (request.method) {
          case 'GET':
            return await handleGet(codeHash, env, corsHeaders);
          case 'POST':
            return await handlePost(request, codeHash, env, corsHeaders);
          case 'DELETE':
            return await handleDelete(codeHash, env, corsHeaders);
          default:
            return Response.json(
              { success: false, error: 'Method not allowed' },
              { status: 405, headers: corsHeaders }
            );
        }
      } catch (error) {
        console.error('[Sync Worker] Error:', error);
        return Response.json(
          { success: false, error: 'Internal server error' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Heartbeat endpoint — pure in-memory, zero D1
    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      try {
        return await handleHeartbeat(request, env, corsHeaders);
      } catch (error) {
        console.error('[Sync Worker] Heartbeat error:', error);
        return Response.json(
          { success: false, error: 'Internal server error' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Admin live endpoint — from memory
    if (url.pathname === '/admin/live' && request.method === 'GET') {
      return handleAdminLive(corsHeaders);
    }

    // Admin stats endpoint — memory for today, D1 for historical
    if (url.pathname === '/admin/stats' && request.method === 'GET') {
      try {
        return await handleAdminStats(request, env, corsHeaders);
      } catch (error) {
        console.error('[Sync Worker] Admin stats error:', error);
        return Response.json(
          { success: false, error: 'Internal server error' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return Response.json(
      { success: false, error: 'Not found' },
      { status: 404, headers: corsHeaders }
    );
  },

  // Scheduled handler — midnight only: persist daily summary to D1
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.SYNC_DB) {
      console.error('[Sync Worker] Cron: D1 database not configured');
      return;
    }

    const state = getAnalyticsState();

    // Persist today's summary to D1 (single write)
    try {
      const summary = state.getDailySummaryRow();
      const now = Date.now();

      await env.SYNC_DB.prepare(`
        INSERT INTO admin_daily_stats (date, peak_active, total_unique_sessions, watching_sessions, browsing_sessions, livetv_sessions, top_categories, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          peak_active = MAX(admin_daily_stats.peak_active, excluded.peak_active),
          total_unique_sessions = excluded.total_unique_sessions,
          watching_sessions = excluded.watching_sessions,
          browsing_sessions = excluded.browsing_sessions,
          livetv_sessions = excluded.livetv_sessions,
          top_categories = excluded.top_categories,
          updated_at = excluded.updated_at
      `).bind(
        summary.date,
        summary.peakActive,
        summary.totalUniqueSessions,
        summary.watchingSessions,
        summary.browsingSessions,
        summary.livetvSessions,
        summary.topCategories,
        now,
        now
      ).run();

      console.log(`[Sync Worker] Cron: persisted daily summary for ${summary.date} (${summary.totalUniqueSessions} unique users, peak ${summary.peakActive})`);
    } catch (err) {
      console.error('[Sync Worker] Cron: daily summary write failed:', err);
    }

    // Reset state for new day
    state.resetDay();

    // Cleanup old daily stats (keep 90 days)
    try {
      const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await env.SYNC_DB.prepare(
        'DELETE FROM admin_daily_stats WHERE date < ?'
      ).bind(cutoffDate).run();
    } catch (err) {
      console.error('[Sync Worker] Cron: daily stats cleanup failed:', err);
    }
  },
};

// ============================================================================
// Sync handlers (unchanged)
// ============================================================================

async function handleGet(
  codeHash: string,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  if (!env.SYNC_DB) {
    return Response.json(
      { success: false, error: 'D1 database not configured' },
      { status: 503, headers: corsHeaders }
    );
  }
  return await handleGetD1(codeHash, env.SYNC_DB, corsHeaders);
}

async function handleGetD1(
  codeHash: string,
  db: D1Database,
  corsHeaders: HeadersInit
): Promise<Response> {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_accounts (
        id TEXT PRIMARY KEY,
        code_hash TEXT UNIQUE NOT NULL,
        sync_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_sync_at INTEGER NOT NULL,
        device_count INTEGER DEFAULT 1
      )
    `).run();
  } catch (e) {
    console.log('[Sync] Table creation:', e);
  }

  const result = await db.prepare(
    'SELECT sync_data, last_sync_at FROM sync_accounts WHERE code_hash = ?'
  ).bind(codeHash).first();

  if (!result) {
    return Response.json({
      success: true,
      data: null,
      message: 'No synced data found for this code',
      isNew: true,
    }, { headers: corsHeaders });
  }

  const syncData = JSON.parse(result.sync_data as string);

  return Response.json({
    success: true,
    data: syncData,
    lastSyncedAt: result.last_sync_at,
    isNew: false,
  }, { headers: corsHeaders });
}

async function handlePost(
  request: Request,
  codeHash: string,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  const body = await request.json() as SyncData;

  if (!body || typeof body !== 'object') {
    return Response.json(
      { success: false, error: 'Invalid sync data' },
      { status: 400, headers: corsHeaders }
    );
  }

  if (body.schemaVersion !== undefined && !KNOWN_SCHEMA_VERSIONS.includes(body.schemaVersion)) {
    return Response.json(
      { success: false, error: `Unknown schema version: ${body.schemaVersion}. Supported versions: ${KNOWN_SCHEMA_VERSIONS.join(', ')}` },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!env.SYNC_DB) {
    return Response.json(
      { success: false, error: 'D1 database not configured' },
      { status: 503, headers: corsHeaders }
    );
  }
  return await handlePostD1(codeHash, body, env.SYNC_DB, corsHeaders);
}

async function handlePostD1(
  codeHash: string,
  body: SyncData,
  db: D1Database,
  corsHeaders: HeadersInit
): Promise<Response> {
  const now = Date.now();
  const syncDataStr = JSON.stringify(body);

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_accounts (
        id TEXT PRIMARY KEY,
        code_hash TEXT UNIQUE NOT NULL,
        sync_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_sync_at INTEGER NOT NULL,
        device_count INTEGER DEFAULT 1
      )
    `).run();
  } catch (e) {
    console.log('[Sync] Table creation:', e);
  }

  const existing = await db.prepare(
    'SELECT id FROM sync_accounts WHERE code_hash = ?'
  ).bind(codeHash).first();

  if (!existing) {
    const id = generateId();
    await db.prepare(`
      INSERT INTO sync_accounts (id, code_hash, sync_data, created_at, updated_at, last_sync_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, codeHash, syncDataStr, now, now, now).run();

    return Response.json({
      success: true,
      message: 'Sync account created',
      lastSyncedAt: now,
      isNew: true,
    }, { headers: corsHeaders });
  }

  await db.prepare(`
    UPDATE sync_accounts
    SET sync_data = ?, updated_at = ?, last_sync_at = ?
    WHERE code_hash = ?
  `).bind(syncDataStr, now, now, codeHash).run();

  return Response.json({
    success: true,
    message: 'Sync data updated',
    lastSyncedAt: now,
    isNew: false,
  }, { headers: corsHeaders });
}

async function handleDelete(
  codeHash: string,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  if (!env.SYNC_DB) {
    return Response.json(
      { success: false, error: 'D1 database not configured' },
      { status: 503, headers: corsHeaders }
    );
  }

  await env.SYNC_DB.prepare(
    'DELETE FROM sync_accounts WHERE code_hash = ?'
  ).bind(codeHash).run();

  return Response.json({
    success: true,
    message: 'Sync account deleted',
  }, { headers: corsHeaders });
}

// ============================================================================
// Heartbeat handler — pure in-memory, zero D1
// ============================================================================

async function handleHeartbeat(
  request: Request,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!body || typeof body !== 'object') {
    return Response.json(
      { success: false, error: 'Invalid payload' },
      { status: 400, headers: corsHeaders }
    );
  }

  const payload = body as Record<string, unknown>;

  const allowedFields = ['activityType', 'contentCategory', 'timestamp'];
  const extraFields = Object.keys(payload).filter(k => !allowedFields.includes(k));
  if (extraFields.length > 0) {
    return Response.json(
      { success: false, error: `Unexpected fields: ${extraFields.join(', ')}` },
      { status: 400, headers: corsHeaders }
    );
  }

  const { activityType, contentCategory, timestamp } = payload as {
    activityType: unknown;
    contentCategory: unknown;
    timestamp: unknown;
  };

  if (!activityType || typeof activityType !== 'string' || !VALID_ACTIVITY_TYPES.includes(activityType as any)) {
    return Response.json(
      { success: false, error: 'Invalid activityType. Must be one of: browsing, watching, livetv' },
      { status: 400, headers: corsHeaders }
    );
  }

  if (contentCategory !== undefined && contentCategory !== null && typeof contentCategory !== 'string') {
    return Response.json(
      { success: false, error: 'contentCategory must be a string or null' },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!timestamp || typeof timestamp !== 'number') {
    return Response.json(
      { success: false, error: 'timestamp must be a number' },
      { status: 400, headers: corsHeaders }
    );
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';
  const ipHash = await hashIP(ip);

  // Record heartbeat in memory — zero D1 writes
  const state = getAnalyticsState();
  state.recordHeartbeat(
    ipHash,
    activityType as 'browsing' | 'watching' | 'livetv',
    (contentCategory as string) || null
  );

  // Ensure SSE broadcast timer is running
  ensureFlushTimer(env);

  return Response.json({ success: true }, { headers: corsHeaders });
}

// ============================================================================
// Admin endpoints
// ============================================================================

/**
 * Admin live endpoint — returns real-time snapshot from memory.
 * Zero D1 reads.
 */
function handleAdminLive(corsHeaders: HeadersInit): Response {
  const state = getAnalyticsState();
  const snapshot = state.getRealtimeSnapshot();

  return Response.json({
    success: true,
    ...snapshot,
  }, { headers: corsHeaders });
}

/**
 * Admin stats endpoint — memory for today, D1 for historical.
 */
async function handleAdminStats(
  request: Request,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  const state = getAnalyticsState();
  const result = await handleConsolidatedStats(request, env.SYNC_DB || null, state);
  return Response.json(result, { headers: corsHeaders });
}
