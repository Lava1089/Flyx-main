/**
 * Flyx Sync Worker
 * 
 * Cloudflare Worker for anonymous cross-device sync.
 * Handles: watch progress, watchlist, provider settings, subtitle/player preferences
 * Storage: Cloudflare D1 (SQLite)
 * 
 * Endpoints:
 *   GET  /sync     - Pull sync data (requires X-Sync-Code header)
 *   POST /sync     - Push sync data (requires X-Sync-Code header)
 *   DELETE /sync   - Delete sync account (requires X-Sync-Code header)
 *   GET  /health   - Health check
 */

export interface Env {
  SYNC_ENCRYPTION_KEY?: string;
  ALLOWED_ORIGINS?: string;
  LOG_LEVEL?: string;
  // D1 Database
  SYNC_DB?: D1Database;
  // KV for caching
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

// CORS headers
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

// Hash sync code for storage (don't store raw codes)
async function hashSyncCode(code: string): Promise<string> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized + '_flyx_sync_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Validate sync code format: FLYX-XXXXXX-XXXXXX
function isValidSyncCode(code: string): boolean {
  if (!code) return false;
  const normalized = code.toUpperCase().replace(/\s/g, '');
  return /^FLYX-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(normalized);
}

// Generate unique ID
function generateId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

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
      return Response.json({ 
        status: 'ok', 
        service: 'flyx-sync',
        timestamp: Date.now(),
        hasD1: !!env.SYNC_DB,
      }, { headers: corsHeaders });
    }

    // Sync endpoints - support both /sync and /analytics/sync paths
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

    return Response.json(
      { success: false, error: 'Not found' },
      { status: 404, headers: corsHeaders }
    );
  },
};

// GET /sync - Pull data from server (D1 only)
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
  // Ensure table exists
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
    // Table might already exist, ignore error
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

// POST /sync - Push data to server (D1 only)
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

  // Ensure table exists
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
    // Table might already exist, ignore error
    console.log('[Sync] Table creation:', e);
  }

  // Check if exists
  const existing = await db.prepare(
    'SELECT id FROM sync_accounts WHERE code_hash = ?'
  ).bind(codeHash).first();

  if (!existing) {
    // Create new
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

  // Update existing
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

// DELETE /sync - Delete sync account (D1 only)
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
