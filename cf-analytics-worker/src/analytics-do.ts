/**
 * Analytics Durable Object
 * 
 * Single instance that handles ALL analytics for the site.
 * Memory persists across requests - no more distributed worker issues.
 * 
 * Architecture:
 * - All POST requests update in-memory state
 * - GET requests read from memory (instant)
 * - Periodic flush to D1 for persistence (every 60s)
 * - On startup, loads recent data from D1
 * 
 * This solves the distributed worker problem because Durable Objects
 * guarantee that all requests to the same ID go to the same instance.
 */

export interface Env {
  DB: D1Database;
  ANALYTICS: DurableObjectNamespace;
}

interface LiveUser {
  userId: string;
  sessionId: string;
  activity: 'browsing' | 'watching' | 'livetv';
  contentId?: string;
  contentTitle?: string;
  contentType?: string;
  country?: string;
  city?: string;
  lastHeartbeat: number;
  firstSeen: number;
}

interface PeakStats {
  date: string;
  total: number;
  watching: number;
  browsing: number;
  livetv: number;
  time: number;
}

export class AnalyticsDO {
  private state: DurableObjectState;
  private env: Env;
  
  // In-memory state
  private liveUsers: Map<string, LiveUser> = new Map();
  private peakToday: PeakStats;
  private lastFlush: number = 0;
  private initialized: boolean = false;
  
  // Cache for historical stats (prevents excessive D1 reads)
  private historicalStatsCache: { data: any; timestamp: number } | null = null;
  private readonly STATS_CACHE_TTL = 1800000; // 30 minutes - increased to reduce D1 costs
  
  // Constants
  private readonly USER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly FLUSH_INTERVAL = 120 * 1000; // 2 minutes - reduced frequency to lower D1 costs
  
  // Track dirty users (only flush users that changed)
  private dirtyUsers: Set<string> = new Set();
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    const today = new Date().toISOString().split('T')[0];
    this.peakToday = { date: today, total: 0, watching: 0, browsing: 0, livetv: 0, time: 0 };
    
    // Schedule periodic cleanup and flush
    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }
  
  private async initialize() {
    if (this.initialized) return;
    
    const today = new Date().toISOString().split('T')[0];
    
    // Load peak stats from DO storage first
    const storedPeak = await this.state.storage.get<PeakStats>('peakToday');
    if (storedPeak && storedPeak.date === today) {
      this.peakToday = storedPeak;
    }
    
    // Also check D1 for historical peak (in case DO was restarted)
    try {
      const peakResult = await this.env.DB.prepare(`
        SELECT peak_total, peak_watching, peak_browsing, peak_livetv, peak_total_time
        FROM peak_stats WHERE date = ?
      `).bind(today).first();
      
      if (peakResult && (peakResult.peak_total as number) > this.peakToday.total) {
        this.peakToday = {
          date: today,
          total: peakResult.peak_total as number,
          watching: peakResult.peak_watching as number || 0,
          browsing: peakResult.peak_browsing as number || 0,
          livetv: peakResult.peak_livetv as number || 0,
          time: peakResult.peak_total_time as number || 0,
        };
      }
      
      // If no peak for today, calculate from live_activity for today
      if (this.peakToday.total === 0) {
        const todayStart = new Date(today).getTime();
        const historicalPeak = await this.env.DB.prepare(`
          SELECT COUNT(DISTINCT user_id) as peak_count
          FROM live_activity 
          WHERE last_heartbeat >= ?
          GROUP BY strftime('%Y-%m-%d %H:%M', datetime(last_heartbeat/1000, 'unixepoch'))
          ORDER BY peak_count DESC
          LIMIT 1
        `).bind(todayStart).first();
        
        if (historicalPeak && (historicalPeak.peak_count as number) > this.peakToday.total) {
          this.peakToday.total = historicalPeak.peak_count as number;
          this.peakToday.time = Date.now();
        }
      }
      
      console.log(`[AnalyticsDO] Peak for ${today}: ${this.peakToday.total}`);
    } catch (e) {
      console.error('[AnalyticsDO] Failed to load peak from D1:', e);
    }
    
    // Load live users from D1 (users active in last 5 min)
    try {
      const fiveMinAgo = Date.now() - this.USER_TIMEOUT;
      const result = await this.env.DB.prepare(`
        SELECT user_id, session_id, activity_type, content_id, content_title, content_type, 
               country, city, last_heartbeat, started_at
        FROM live_activity 
        WHERE is_active = 1 AND last_heartbeat >= ?
      `).bind(fiveMinAgo).all();
      
      for (const row of (result.results || [])) {
        this.liveUsers.set(row.user_id as string, {
          userId: row.user_id as string,
          sessionId: row.session_id as string || '',
          activity: (row.activity_type as any) || 'browsing',
          contentId: row.content_id as string,
          contentTitle: row.content_title as string,
          contentType: row.content_type as string,
          country: row.country as string,
          city: row.city as string,
          lastHeartbeat: row.last_heartbeat as number,
          firstSeen: row.started_at as number,
        });
      }
      
      console.log(`[AnalyticsDO] Initialized with ${this.liveUsers.size} users from D1`);
    } catch (e) {
      console.error('[AnalyticsDO] Failed to load from D1:', e);
    }
    
    this.initialized = true;
    
    // Set up periodic alarm for cleanup/flush
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
    }
  }
  
  async alarm() {
    // Cleanup inactive users
    this.cleanupUsers();
    
    // Flush to D1
    await this.flushToD1();
    
    // Schedule next alarm
    await this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
  }
  
  private cleanupUsers() {
    const cutoff = Date.now() - this.USER_TIMEOUT;
    for (const [id, user] of this.liveUsers) {
      if (user.lastHeartbeat < cutoff) {
        this.liveUsers.delete(id);
      }
    }
  }
  
  private updatePeak() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.peakToday.date) {
      // New day, reset peak
      this.peakToday = { date: today, total: 0, watching: 0, browsing: 0, livetv: 0, time: 0 };
    }
    
    const stats = this.getStats();
    if (stats.total > this.peakToday.total) {
      this.peakToday = {
        date: today,
        total: stats.total,
        watching: stats.watching,
        browsing: stats.browsing,
        livetv: stats.livetv,
        time: Date.now(),
      };
      // Persist peak
      this.state.storage.put('peakToday', this.peakToday);
    }
  }
  
  private getStats() {
    const users = Array.from(this.liveUsers.values());
    return {
      total: users.length,
      watching: users.filter(u => u.activity === 'watching').length,
      browsing: users.filter(u => u.activity === 'browsing').length,
      livetv: users.filter(u => u.activity === 'livetv').length,
    };
  }
  
  private async flushToD1() {
    const now = Date.now();
    if (now - this.lastFlush < this.FLUSH_INTERVAL) return;
    this.lastFlush = now;
    
    // Only flush users that have changed (dirty tracking)
    const usersToFlush = Array.from(this.liveUsers.values())
      .filter(u => this.dirtyUsers.has(u.userId));
    
    console.log(`[AnalyticsDO] Flushing ${usersToFlush.length} dirty users (${this.liveUsers.size} total)`);
    
    // Clear dirty set
    this.dirtyUsers.clear();
    
    if (usersToFlush.length === 0) return;
    
    try {
      const batch: D1PreparedStatement[] = [];
      
      for (const user of usersToFlush) {
        batch.push(this.env.DB.prepare(`
          INSERT INTO live_activity (id, user_id, session_id, activity_type, content_id, content_title, content_type, country, city, started_at, last_heartbeat, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            activity_type = excluded.activity_type,
            content_id = excluded.content_id,
            content_title = excluded.content_title,
            last_heartbeat = excluded.last_heartbeat,
            is_active = 1,
            updated_at = excluded.updated_at
        `).bind(
          `la_${user.userId}`,
          user.userId,
          user.sessionId,
          user.activity,
          user.contentId || null,
          user.contentTitle || null,
          user.contentType || null,
          user.country || null,
          user.city || null,
          user.firstSeen,
          user.lastHeartbeat,
          now,
          now
        ));
      }
      
      // Also update user_activity for DAU/WAU/MAU (only dirty users)
      for (const user of usersToFlush) {
        batch.push(this.env.DB.prepare(`
          INSERT INTO user_activity (id, user_id, session_id, first_seen, last_seen, country, city, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at
        `).bind(
          `ua_${user.userId}`,
          user.userId,
          user.sessionId,
          user.firstSeen,
          user.lastHeartbeat,
          user.country || null,
          user.city || null,
          now,
          now
        ));
      }
      
      await this.env.DB.batch(batch);
      console.log(`[AnalyticsDO] Flushed ${usersToFlush.length} users to D1 (${batch.length} statements)`);
    } catch (e) {
      // DIAGNOSTIC: Enhanced error logging for D1 flush errors
      console.error('[AnalyticsDO] D1 Flush error:', e);
      console.error('[AnalyticsDO] Error details:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
      if (String(e).includes('no such column') || String(e).includes('table has no column')) {
        console.error('[AnalyticsDO] SCHEMA MISMATCH DETECTED - Check schema.sql vs index.ts table definitions!');
      }
    }
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS headers
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    
    try {
      // POST /heartbeat - Update user presence
      if (request.method === 'POST' && path === '/heartbeat') {
        return this.handleHeartbeat(request, headers);
      }
      
      // GET /stats - Get all stats for admin dashboard
      if (request.method === 'GET' && path === '/stats') {
        // Parse time range from query params (default: 7d)
        const range = url.searchParams.get('range') || '7d';
        return this.handleGetStats(headers, range);
      }
      
      // GET /live - Get live users list
      if (request.method === 'GET' && path === '/live') {
        return this.handleGetLive(headers);
      }
      
      return Response.json({ error: 'Not found' }, { status: 404, headers });
    } catch (e) {
      console.error('[AnalyticsDO] Error:', e);
      return Response.json({ error: String(e) }, { status: 500, headers });
    }
  }
  
  private async handleHeartbeat(request: Request, headers: HeadersInit): Promise<Response> {
    const data = await request.json() as any;
    const now = Date.now();
    
    // Extract geo from CF headers (passed through from main worker)
    const country = data.country || request.headers.get('CF-IPCountry') || undefined;
    const city = data.city || undefined;
    
    const userId = data.userId || data.oderId || data.user_id;
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400, headers });
    }
    
    const existing = this.liveUsers.get(userId);
    
    this.liveUsers.set(userId, {
      userId,
      sessionId: data.sessionId || existing?.sessionId || `s_${Date.now()}`,
      activity: data.activity || data.activityType || existing?.activity || 'browsing',
      contentId: data.contentId || existing?.contentId,
      contentTitle: data.contentTitle || existing?.contentTitle,
      contentType: data.contentType || existing?.contentType,
      country: country || existing?.country,
      city: city || existing?.city,
      lastHeartbeat: now,
      firstSeen: existing?.firstSeen || now,
    });
    
    // Mark user as dirty (needs D1 update on next flush)
    this.dirtyUsers.add(userId);
    
    // Update peak if needed
    this.updatePeak();
    
    return Response.json({ 
      success: true, 
      liveUsers: this.liveUsers.size,
    }, { headers });
  }
  
  private async handleGetStats(headers: HeadersInit, range: string = '7d'): Promise<Response> {
    this.cleanupUsers();
    
    const stats = this.getStats();
    const users = Array.from(this.liveUsers.values());
    const now = Date.now();
    
    // Build country stats from memory (no D1 needed)
    const countryMap = new Map<string, { country: string; code: string; count: number }>();
    for (const user of users) {
      if (user.country) {
        const existing = countryMap.get(user.country);
        if (existing) {
          existing.count++;
        } else {
          countryMap.set(user.country, { 
            country: user.country, 
            code: user.country, 
            count: 1 
          });
        }
      }
    }
    const topCountries = Array.from(countryMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Build content stats from memory (no D1 needed)
    const contentMap = new Map<string, { id: string; title: string; type: string; viewers: number }>();
    for (const user of users) {
      if (user.contentId && user.contentTitle && user.activity === 'watching') {
        const key = user.contentId;
        const existing = contentMap.get(key);
        if (existing) {
          existing.viewers++;
        } else {
          contentMap.set(key, {
            id: user.contentId,
            title: user.contentTitle,
            type: user.contentType || 'movie',
            viewers: 1,
          });
        }
      }
    }
    const topContent = Array.from(contentMap.values())
      .sort((a, b) => b.viewers - a.viewers)
      .slice(0, 10);
    
    // Check if we have cached historical stats
    const cacheKey = `stats_${range}`;
    if (this.historicalStatsCache && 
        this.historicalStatsCache.data.range === range &&
        now - this.historicalStatsCache.timestamp < this.STATS_CACHE_TTL) {
      // Return cached data with fresh real-time stats
      const cached = this.historicalStatsCache.data;
      return Response.json({
        success: true,
        stats: {
          // Real-time from memory (always fresh)
          liveUsers: stats.total,
          watching: stats.watching,
          browsing: stats.browsing,
          livetv: stats.livetv,
          peakToday: this.peakToday.total,
          peakTime: this.peakToday.time ? new Date(this.peakToday.time).toISOString() : null,
          topCountries,
          topContent,
          liveUsersList: users.slice(0, 100).map(u => ({
            oderId: u.userId.substring(0, 8) + '...',
            activity: u.activity,
            country: u.country || 'Unknown',
            contentTitle: u.contentTitle,
            lastSeen: u.lastHeartbeat,
          })),
          // Historical from cache
          ...cached.historical,
          timestamp: now,
          source: 'durable-object-cached',
        },
      }, { headers });
    }
    
    // Need to fetch historical stats from D1
    let dau = 0, wau = 0, mau = 0, totalUsers = 0, newToday = 0, returningUsers = 0;
    let totalSessions = 0, totalWatchTime = 0, avgSessionDuration = 0, completionRate = 0;
    let pageViews = 0, uniqueVisitors = 0;
    let dailyPeaks: Array<{ date: string; peak: number }> = [];
    
    // Historical peak
    const allTimePeak = 425;
    const allTimePeakDate = '2025-12-30';
    
    // Calculate time bounds
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    
    let rangeStart: number;
    switch (range) {
      case '24h': rangeStart = oneDayAgo; break;
      case '30d': rangeStart = thirtyDaysAgo; break;
      case '365d': rangeStart = yearAgo; break;
      default: rangeStart = sevenDaysAgo; break;
    }
    
    // Batch all D1 queries into a single Promise.all to minimize round trips
    try {
      const [
        userStatsResult,
        watchStatsResult,
        pageStatsResult,
        peaksResult
      ] = await Promise.all([
        // Combined user stats query (1 query instead of 6)
        this.env.DB.prepare(`
          SELECT 
            COUNT(DISTINCT user_id) as total,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as dau,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as wau,
            COUNT(DISTINCT CASE WHEN last_seen >= ? THEN user_id END) as mau,
            COUNT(DISTINCT CASE WHEN first_seen >= ? THEN user_id END) as new_today,
            COUNT(DISTINCT CASE WHEN first_seen < ? AND last_seen >= ? THEN user_id END) as returning
          FROM user_activity
        `).bind(oneDayAgo, sevenDaysAgo, thirtyDaysAgo, oneDayAgo, oneDayAgo, oneDayAgo).first(),
        
        // Combined watch stats query (1 query instead of 4)
        this.env.DB.prepare(`
          SELECT 
            COUNT(*) as sessions,
            COALESCE(SUM(CASE WHEN last_position > 0 AND last_position < 36000 THEN last_position ELSE 0 END), 0) as watch_time,
            COALESCE(AVG(CASE WHEN last_position > 0 AND last_position < 36000 THEN last_position END), 0) as avg_duration,
            COALESCE(AVG(CASE WHEN completion_percentage >= 0 AND completion_percentage <= 100 THEN completion_percentage END), 0) as avg_completion
          FROM watch_sessions WHERE started_at >= ?
        `).bind(rangeStart).first(),
        
        // Page views query
        this.env.DB.prepare(`
          SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_visitors
          FROM page_views WHERE entry_time >= ?
        `).bind(rangeStart).first(),
        
        // Daily peaks query
        this.env.DB.prepare(`
          SELECT date, peak_total as daily_peak
          FROM peak_stats
          ORDER BY date DESC
          LIMIT 14
        `).all()
      ]);
      
      // Parse user stats
      if (userStatsResult) {
        totalUsers = parseInt(String(userStatsResult.total)) || 0;
        dau = parseInt(String(userStatsResult.dau)) || 0;
        wau = parseInt(String(userStatsResult.wau)) || 0;
        mau = parseInt(String(userStatsResult.mau)) || 0;
        newToday = parseInt(String(userStatsResult.new_today)) || 0;
        returningUsers = parseInt(String(userStatsResult.returning)) || 0;
      }
      
      // Parse watch stats
      if (watchStatsResult) {
        totalSessions = parseInt(String(watchStatsResult.sessions)) || 0;
        totalWatchTime = parseInt(String(watchStatsResult.watch_time)) || 0;
        avgSessionDuration = parseInt(String(watchStatsResult.avg_duration)) || 0;
        completionRate = Math.round(parseFloat(String(watchStatsResult.avg_completion)) || 0);
      }
      
      // Parse page stats
      if (pageStatsResult) {
        pageViews = parseInt(String(pageStatsResult.total)) || 0;
        uniqueVisitors = parseInt(String(pageStatsResult.unique_visitors)) || 0;
      }
      
      // Parse daily peaks
      dailyPeaks = (peaksResult.results || []).map((row: any) => ({
        date: row.date as string,
        peak: parseInt(String(row.daily_peak)) || 0,
      }));
      
    } catch (e) {
      console.error('[AnalyticsDO] D1 query error:', e);
    }
    
    // Cache the historical data
    const historicalData = {
      allTimePeak,
      allTimePeakDate,
      dailyPeaks,
      dau,
      wau,
      mau,
      totalUsers,
      newToday,
      returningUsers,
      totalSessions,
      totalWatchTimeMinutes: Math.round(totalWatchTime / 60),
      avgSessionMinutes: Math.round(avgSessionDuration / 60),
      completionRate,
      pageViews,
      uniqueVisitors,
    };
    
    this.historicalStatsCache = {
      timestamp: now,
      data: { range, historical: historicalData }
    };
    
    return Response.json({
      success: true,
      stats: {
        // Real-time from memory
        liveUsers: stats.total,
        watching: stats.watching,
        browsing: stats.browsing,
        livetv: stats.livetv,
        peakToday: this.peakToday.total,
        peakTime: this.peakToday.time ? new Date(this.peakToday.time).toISOString() : null,
        topCountries,
        topContent,
        liveUsersList: users.slice(0, 100).map(u => ({
          oderId: u.userId.substring(0, 8) + '...',
          activity: u.activity,
          country: u.country || 'Unknown',
          contentTitle: u.contentTitle,
          lastSeen: u.lastHeartbeat,
        })),
        // Historical from D1
        ...historicalData,
        timestamp: now,
        source: 'durable-object',
      },
    }, { headers });
  }
  
  private handleGetLive(headers: HeadersInit): Response {
    this.cleanupUsers();
    const users = Array.from(this.liveUsers.values());
    
    return Response.json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        oderId: u.userId.substring(0, 8) + '...',
        activity: u.activity,
        country: u.country,
        city: u.city,
        contentTitle: u.contentTitle,
        lastSeen: u.lastHeartbeat,
      })),
    }, { headers });
  }
}
