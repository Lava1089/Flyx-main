/**
 * Unified Stats API - SINGLE SOURCE OF TRUTH
 * GET /api/admin/unified-stats
 * 
 * ALL admin pages MUST use this endpoint for key metrics.
 * This ensures consistent data across the entire admin panel.
 * 
 * MIGRATED: Uses D1 database adapter for Cloudflare compatibility
 * 
 * Data Sources:
 * - live_activity: Real-time user presence (last 5 min heartbeat)
 * - user_activity: User sessions and activity history (UNIQUE users only)
 * - watch_sessions: Content viewing data
 * - analytics_events: Page views and events
 * 
 * IMPORTANT: All user counts use COUNT(DISTINCT user_id) to avoid duplicates
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/utils/admin-auth';
import { getCountryName } from '@/app/lib/utils/geolocation';
import { getAdapter, type DatabaseAdapter } from '@/lib/db/adapter';

// Minimum valid timestamp (Jan 1, 2020)
const MIN_VALID_TIMESTAMP = 1577836800000;

// In-memory cache for stats
interface CachedStats {
  data: any;
  timestamp: number;
}

let statsCache: CachedStats | null = null;
const CACHE_TTL = 30000; // 30 seconds cache TTL - balances freshness with performance

export async function GET(request: NextRequest) {
  try {
    console.log('[Unified Stats] API called');
    
    const authResult = await verifyAdminAuth(request);
    if (!authResult.success) {
      console.log('[Unified Stats] Auth failed');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Unified Stats] Auth successful');
    const now = Date.now();
    
    // Get time range from query params (default: 24h)
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '24h';
    
    console.log('[Unified Stats] Time range:', timeRange);
    
    // Calculate time boundaries based on selected range
    const getTimeRangeMs = (range: string): number => {
      switch (range) {
        case '1h': return 60 * 60 * 1000;
        case '6h': return 6 * 60 * 60 * 1000;
        case '12h': return 12 * 60 * 60 * 1000;
        case '24h': return 24 * 60 * 60 * 1000;
        case '7d': return 7 * 24 * 60 * 60 * 1000;
        case '30d': return 30 * 24 * 60 * 60 * 1000;
        case 'all': return now - MIN_VALID_TIMESTAMP;
        default: return 24 * 60 * 60 * 1000;
      }
    };
    
    const selectedRangeMs = getTimeRangeMs(timeRange);
    const selectedRangeStart = now - selectedRangeMs;
    
    // Check cache first - include timeRange in cache key
    const cacheKey = `${timeRange}-${searchParams.get('excludeBots') || 'false'}`;
    if (statsCache && statsCache.data?.cacheKey === cacheKey && (now - statsCache.timestamp) < CACHE_TTL) {
      return NextResponse.json({
        ...statsCache.data,
        cached: true,
        cacheAge: now - statsCache.timestamp,
      });
    }

    // Get database adapter - uses D1 in Cloudflare, falls back to Neon
    const adapter = getAdapter();
    const dbType = adapter.getDatabaseType();
    const isD1 = dbType === 'd1';
    
    console.log('[Unified Stats] Database type:', dbType, 'isD1:', isD1);

    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // ============================================
    // 1. REAL-TIME DATA (from live_activity table - HEARTBEAT BASED)
    // ============================================
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const twoMinutesAgo = now - 2 * 60 * 1000;
    let realtime = { totalActive: 0, trulyActive: 0, watching: 0, browsing: 0, livetv: 0, unknown: 0 };
    
    console.log('[Unified Stats] Fetching realtime data, fiveMinutesAgo:', new Date(fiveMinutesAgo).toISOString());
    
    try {
      const liveResult = await adapter.query<any>(
        `SELECT 
           COALESCE(activity_type, 'unknown') as activity_type, 
           COUNT(DISTINCT user_id) as count,
           COUNT(DISTINCT CASE WHEN last_heartbeat >= ? THEN user_id END) as strict_count
         FROM live_activity 
         WHERE is_active = 1 AND last_heartbeat >= ? 
         GROUP BY COALESCE(activity_type, 'unknown')`,
        [twoMinutesAgo, fiveMinutesAgo]
      );
      
      console.log('[Unified Stats] Live activity query result:', liveResult.data);
      
      let total = 0;
      let strictTotal = 0;
      for (const row of liveResult.data || []) {
        const count = parseInt(row.count) || 0;
        const strictCount = parseInt(row.strict_count) || 0;
        total += count;
        strictTotal += strictCount;
        const activityType = row.activity_type || 'unknown';
        if (activityType === 'watching') realtime.watching = count;
        else if (activityType === 'browsing') realtime.browsing = count;
        else if (activityType === 'livetv') realtime.livetv = count;
        else realtime.unknown = (realtime.unknown || 0) + count;
      }
      realtime.totalActive = total;
      realtime.trulyActive = strictTotal;
      
      console.log('[Unified Stats] Realtime stats:', realtime);
      
    } catch (e) {
      console.error('Error fetching realtime stats:', e);
    }

    // ============================================
    // 1b. REAL-TIME GEOGRAPHIC DATA (from live_activity table)
    // ============================================
    let realtimeGeographic: Array<{ country: string; countryName: string; count: number }> = [];
    try {
      const realtimeGeoResult = await adapter.query<any>(
        `SELECT UPPER(country) as country, COUNT(DISTINCT user_id) as count 
         FROM live_activity 
         WHERE is_active = 1 AND last_heartbeat >= ?
           AND country IS NOT NULL AND country != '' AND LENGTH(country) = 2
         GROUP BY UPPER(country) 
         ORDER BY count DESC 
         LIMIT 20`,
        [fiveMinutesAgo]
      );
      
      realtimeGeographic = (realtimeGeoResult.data || []).map((row: any) => ({
        country: row.country,
        countryName: getCountryName(row.country) || row.country,
        count: parseInt(row.count) || 0,
      }));
    } catch (e) {
      console.error('Error fetching realtime geographic stats:', e);
    }

    // ============================================
    // 2. USER METRICS (from user_activity ONLY)
    // ============================================
    let users = { total: 0, dau: 0, wau: 0, mau: 0, newToday: 0, returning: 0 };
    try {
      console.log('[Unified Stats] Fetching user metrics...');
      console.log('[Unified Stats] Time boundaries:', { oneDayAgo, oneWeekAgo, oneMonthAgo, now });
      
      // Total UNIQUE users with valid timestamps
      const totalResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as total FROM user_activity 
         WHERE first_seen >= ? AND last_seen >= ? AND last_seen <= ?`,
        [MIN_VALID_TIMESTAMP, MIN_VALID_TIMESTAMP, now]
      );
      console.log('[Unified Stats] Total users result:', totalResult);
      users.total = parseInt(totalResult.data?.[0]?.total) || 0;
      
      // DAU - UNIQUE users active in last 24h
      const dauResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?`,
        [oneDayAgo, now]
      );
      console.log('[Unified Stats] DAU result:', dauResult);
      users.dau = parseInt(dauResult.data?.[0]?.count) || 0;
      
      // WAU - UNIQUE users active in last week
      const wauResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?`,
        [oneWeekAgo, now]
      );
      users.wau = parseInt(wauResult.data?.[0]?.count) || 0;
      
      // MAU - UNIQUE users active in last month
      const mauResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?`,
        [oneMonthAgo, now]
      );
      users.mau = parseInt(mauResult.data?.[0]?.count) || 0;
      
      // New users today
      const newResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_activity 
         WHERE first_seen >= ? AND first_seen <= ?`,
        [oneDayAgo, now]
      );
      users.newToday = parseInt(newResult.data?.[0]?.count) || 0;
      
      // Returning users
      const returningResult = await adapter.query<any>(
        `SELECT COUNT(DISTINCT user_id) as count FROM user_activity 
         WHERE first_seen < ? AND last_seen >= ? AND last_seen <= ?`,
        [oneDayAgo, oneDayAgo, now]
      );
      users.returning = parseInt(returningResult.data?.[0]?.count) || 0;
    } catch (e) {
      console.error('Error fetching user stats:', e);
    }


    // ============================================
    // 3. CONTENT METRICS (from watch_sessions)
    // ============================================
    let content = { 
      totalSessions: 0, 
      totalWatchTime: 0, 
      avgDuration: 0, 
      completionRate: 0, 
      allTimeWatchTime: 0,
      completedSessions: 0,
      totalPauses: 0,
      totalSeeks: 0,
      movieSessions: 0,
      tvSessions: 0,
      uniqueContentWatched: 0
    };
    
    console.log('[Unified Stats] Fetching content metrics, selectedRangeStart:', new Date(selectedRangeStart).toISOString());
    
    try {
      const contentResult = await adapter.query<any>(
        `SELECT 
           COUNT(*) as total_sessions,
           COALESCE(SUM(CASE WHEN total_watch_time > 0 AND total_watch_time < 86400 THEN total_watch_time ELSE 0 END), 0) as total_watch_time,
           COALESCE(AVG(CASE WHEN total_watch_time > 0 AND total_watch_time < 86400 THEN total_watch_time ELSE NULL END), 0) as avg_duration,
           COALESCE(AVG(CASE WHEN completion_percentage >= 0 AND completion_percentage <= 100 THEN completion_percentage ELSE NULL END), 0) as avg_completion,
           SUM(CASE WHEN is_completed = 1 OR completion_percentage >= 90 THEN 1 ELSE 0 END) as completed_sessions,
           COALESCE(SUM(pause_count), 0) as total_pauses,
           COALESCE(SUM(seek_count), 0) as total_seeks,
           SUM(CASE WHEN content_type = 'movie' THEN 1 ELSE 0 END) as movie_sessions,
           SUM(CASE WHEN content_type = 'tv' THEN 1 ELSE 0 END) as tv_sessions,
           COUNT(DISTINCT content_id) as unique_content
         FROM watch_sessions 
         WHERE started_at >= ? AND started_at <= ?`,
        [selectedRangeStart, now]
      );
      
      console.log('[Unified Stats] Content query result:', contentResult.data);
      
      if (contentResult.data?.[0]) {
        const row = contentResult.data[0];
        content.totalSessions = parseInt(row.total_sessions) || 0;
        content.totalWatchTime = Math.round(parseFloat(row.total_watch_time) / 60) || 0;
        content.avgDuration = Math.round(parseFloat(row.avg_duration) / 60) || 0;
        content.completionRate = Math.round(parseFloat(row.avg_completion)) || 0;
        content.completedSessions = parseInt(row.completed_sessions) || 0;
        content.totalPauses = parseInt(row.total_pauses) || 0;
        content.totalSeeks = parseInt(row.total_seeks) || 0;
        content.movieSessions = parseInt(row.movie_sessions) || 0;
        content.tvSessions = parseInt(row.tv_sessions) || 0;
        content.uniqueContentWatched = parseInt(row.unique_content) || 0;
      }
      
      console.log('[Unified Stats] Content metrics:', content);
      
      // Also get all-time watch time
      const allTimeResult = await adapter.query<any>(
        `SELECT COALESCE(SUM(CASE WHEN total_watch_time > 0 AND total_watch_time < 86400 THEN total_watch_time ELSE 0 END), 0) as total FROM watch_sessions`
      );
      content.allTimeWatchTime = Math.round(parseFloat(allTimeResult.data?.[0]?.total || 0) / 60) || 0;
    } catch (e) {
      // DIAGNOSTIC: Enhanced error logging for content stats
      console.error('[Unified Stats] Error fetching content stats:', e);
      console.error('[Unified Stats] Error details:', e instanceof Error ? e.message : String(e));
      if (String(e).includes('no such column')) {
        console.error('[Unified Stats] SCHEMA MISMATCH - total_watch_time column may be missing from watch_sessions!');
      }
    }

    // ============================================
    // 3b. TOP CONTENT (most watched)
    // ============================================
    let topContent: Array<{ contentId: string; contentTitle: string; contentType: string; watchCount: number; totalWatchTime: number }> = [];
    try {
      const topContentResult = await adapter.query<any>(
        `SELECT 
           content_id,
           content_title,
           content_type,
           COUNT(*) as watch_count,
           SUM(total_watch_time) as total_watch_time
         FROM watch_sessions 
         WHERE started_at >= ? AND started_at <= ? AND content_title IS NOT NULL
         GROUP BY content_id, content_title, content_type
         ORDER BY watch_count DESC
         LIMIT 10`,
        [oneWeekAgo, now]
      );
      
      topContent = (topContentResult.data || []).map((row: any) => ({
        contentId: row.content_id,
        contentTitle: row.content_title || 'Unknown',
        contentType: row.content_type || 'unknown',
        watchCount: parseInt(row.watch_count) || 0,
        totalWatchTime: Math.round(parseFloat(row.total_watch_time) / 60) || 0,
      }));
    } catch (e) {
      // DIAGNOSTIC: Enhanced error logging for top content
      console.error('[Unified Stats] Error fetching top content:', e);
      console.error('[Unified Stats] Error details:', e instanceof Error ? e.message : String(e));
      if (String(e).includes('no such column')) {
        console.error('[Unified Stats] SCHEMA MISMATCH - total_watch_time column may be missing from watch_sessions!');
      }
    }

    // ============================================
    // 4. GEOGRAPHIC DATA (from user_activity)
    // ============================================
    let geographic: Array<{ country: string; countryName: string; count: number }> = [];
    try {
      const geoResult = await adapter.query<any>(
        `SELECT UPPER(country) as country, COUNT(DISTINCT user_id) as count 
         FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?
           AND country IS NOT NULL AND country != '' AND LENGTH(country) = 2
         GROUP BY UPPER(country) 
         ORDER BY count DESC 
         LIMIT 20`,
        [selectedRangeStart, now]
      );
      
      geographic = (geoResult.data || []).map((row: any) => ({
        country: row.country,
        countryName: getCountryName(row.country) || row.country,
        count: parseInt(row.count) || 0,
      }));
    } catch (e) {
      console.error('Error fetching geographic stats:', e);
    }

    // ============================================
    // 4b. CITY-LEVEL DATA (from user_activity)
    // ============================================
    let cities: Array<{ city: string; country: string; countryName: string; count: number }> = [];
    try {
      const cityResult = await adapter.query<any>(
        `SELECT city, UPPER(country) as country, COUNT(DISTINCT user_id) as count 
         FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?
           AND city IS NOT NULL AND city != '' 
           AND country IS NOT NULL AND country != '' AND LENGTH(country) = 2
         GROUP BY city, UPPER(country) 
         ORDER BY count DESC 
         LIMIT 30`,
        [selectedRangeStart, now]
      );
      
      cities = (cityResult.data || []).map((row: any) => ({
        city: row.city,
        country: row.country,
        countryName: getCountryName(row.country) || row.country,
        count: parseInt(row.count) || 0,
      }));
    } catch (e) {
      console.error('Error fetching city stats:', e);
    }

    // ============================================
    // 5. DEVICE BREAKDOWN (from user_activity)
    // ============================================
    let devices: Array<{ device: string; count: number }> = [];
    try {
      const deviceResult = await adapter.query<any>(
        `SELECT COALESCE(device_type, 'unknown') as device, COUNT(DISTINCT user_id) as count 
         FROM user_activity 
         WHERE last_seen >= ? AND last_seen <= ?
         GROUP BY device_type 
         ORDER BY count DESC`,
        [oneWeekAgo, now]
      );
      
      devices = (deviceResult.data || []).map((row: any) => ({
        device: row.device || 'unknown',
        count: parseInt(row.count) || 0,
      }));
    } catch (e) {
      console.error('Error fetching device stats:', e);
    }

    // ============================================
    // 6. PAGE VIEWS (from analytics_events)
    // ============================================
    let pageViews = { total: 0, uniqueVisitors: 0 };
    try {
      const pageViewResult = await adapter.query<any>(
        `SELECT 
           COUNT(*) as total,
           COUNT(DISTINCT COALESCE(JSON_EXTRACT(metadata, '$.userId'), session_id)) as unique_visitors
         FROM analytics_events 
         WHERE event_type = 'page_view' 
           AND timestamp >= ? AND timestamp <= ?`,
        [selectedRangeStart, now]
      );
      
      if (pageViewResult.data?.[0]) {
        pageViews.total = parseInt(pageViewResult.data[0].total) || 0;
        pageViews.uniqueVisitors = parseInt(pageViewResult.data[0].unique_visitors) || 0;
      }
    } catch (e) {
      console.error('Error fetching page view stats:', e);
    }


    // ============================================
    // 8. BOT DETECTION METRICS
    // ============================================
    let botDetection = {
      totalDetections: 0,
      suspectedBots: 0,
      confirmedBots: 0,
      pendingReview: 0,
      avgConfidenceScore: 0,
      recentDetections: [] as any[],
    };
    
    try {
      const botMetricsResult = await adapter.query<any>(
        `SELECT 
           COUNT(*) as total_detections,
           COUNT(CASE WHEN status = 'suspected' THEN 1 END) as suspected_bots,
           COUNT(CASE WHEN status = 'confirmed_bot' THEN 1 END) as confirmed_bots,
           COUNT(CASE WHEN status = 'pending_review' THEN 1 END) as pending_review,
           AVG(confidence_score) as avg_confidence_score
         FROM bot_detections 
         WHERE created_at >= ?`,
        [oneWeekAgo]
      );
      
      if (botMetricsResult.data?.[0]) {
        const row = botMetricsResult.data[0];
        botDetection.totalDetections = parseInt(row.total_detections) || 0;
        botDetection.suspectedBots = parseInt(row.suspected_bots) || 0;
        botDetection.confirmedBots = parseInt(row.confirmed_bots) || 0;
        botDetection.pendingReview = parseInt(row.pending_review) || 0;
        botDetection.avgConfidenceScore = Math.round(parseFloat(row.avg_confidence_score) || 0);
      }

      // Get recent high-confidence detections
      const recentBotsResult = await adapter.query<any>(
        `SELECT user_id, ip_address, confidence_score, status, created_at
         FROM bot_detections 
         WHERE created_at >= ? AND confidence_score >= 70
         ORDER BY confidence_score DESC, created_at DESC 
         LIMIT 10`,
        [oneDayAgo]
      );
      
      botDetection.recentDetections = (recentBotsResult.data || []).map((row: any) => ({
        userId: row.user_id,
        ipAddress: row.ip_address,
        confidenceScore: parseInt(row.confidence_score) || 0,
        status: row.status,
        timestamp: parseInt(row.created_at) || 0,
      }));
    } catch (e) {
      // Bot detection table might not exist yet
      console.log('Bot detection table not available:', e);
    }

    // ============================================
    // 9. UPDATE PEAK STATS (server-side tracking)
    // ============================================
    let peakStats = null;
    try {
      if (realtime.totalActive > 0) {
        peakStats = await updatePeakStats(adapter, now, {
          total: realtime.totalActive,
          watching: realtime.watching,
          livetv: realtime.livetv,
          browsing: realtime.browsing,
        });
      } else {
        // Just fetch current peaks without updating
        peakStats = await getPeakStats(adapter);
      }
    } catch (e) {
      console.error('Error updating peak stats:', e);
    }

    const responseData = {
      success: true,
      realtime,
      realtimeGeographic,
      users,
      content,
      topContent,
      geographic,
      cities,
      devices,
      pageViews,
      botDetection,
      peakStats,
      // Include time ranges for transparency
      timeRanges: {
        realtime: '5 minutes (from live_activity heartbeat, 2 min for truly active)',
        realtimeGeographic: '5 minutes (current active users)',
        dau: '24 hours',
        wau: '7 days',
        mau: '30 days',
        content: timeRange,
        geographic: timeRange,
        cities: timeRange,
        devices: '7 days',
        pageViews: timeRange,
        botDetection: '7 days (recent detections: 24 hours)',
      },
      selectedTimeRange: timeRange,
      cacheKey,
      timestamp: now,
      timestampISO: new Date(now).toISOString(),
      source: isD1 ? 'd1' : 'neon',
    };
    
    // Cache the results
    statsCache = {
      data: responseData,
      timestamp: now,
    };

    console.log('[Unified Stats] Response data summary:', {
      success: responseData.success,
      realtime: responseData.realtime,
      users: responseData.users,
      content: responseData.content,
      topContentCount: responseData.topContent?.length || 0,
      devicesCount: responseData.devices?.length || 0,
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Unified stats API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch unified stats' },
      { status: 500 }
    );
  }
}


// ============================================
// PEAK STATS HELPER FUNCTIONS
// ============================================

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

async function getPeakStats(adapter: DatabaseAdapter) {
  const today = getTodayDate();
  
  try {
    const result = await adapter.query<any>(
      `SELECT * FROM peak_stats WHERE date = ?`,
      [today]
    );
    
    if (result.data && result.data.length > 0) {
      const row = result.data[0];
      return {
        date: row.date,
        peakTotal: parseInt(row.peak_total) || 0,
        peakWatching: parseInt(row.peak_watching) || 0,
        peakLiveTV: parseInt(row.peak_livetv) || 0,
        peakBrowsing: parseInt(row.peak_browsing) || 0,
        peakTotalTime: parseInt(row.peak_total_time) || 0,
        peakWatchingTime: parseInt(row.peak_watching_time) || 0,
        peakLiveTVTime: parseInt(row.peak_livetv_time) || 0,
        peakBrowsingTime: parseInt(row.peak_browsing_time) || 0,
      };
    }
  } catch (e) {
    // Table might not exist
  }
  return null;
}

async function updatePeakStats(
  adapter: DatabaseAdapter, 
  now: number,
  current: { total: number; watching: number; livetv: number; browsing: number }
) {
  const today = getTodayDate();
  
  // Ensure table exists
  await adapter.execute(
    `CREATE TABLE IF NOT EXISTS peak_stats (
      date TEXT PRIMARY KEY,
      peak_total INTEGER DEFAULT 0,
      peak_watching INTEGER DEFAULT 0,
      peak_livetv INTEGER DEFAULT 0,
      peak_browsing INTEGER DEFAULT 0,
      peak_total_time INTEGER,
      peak_watching_time INTEGER,
      peak_livetv_time INTEGER,
      peak_browsing_time INTEGER,
      last_updated INTEGER,
      created_at INTEGER DEFAULT(strftime('%s', 'now'))
    )`
  );
  
  // Get existing peaks
  const existing = await adapter.query<any>(
    `SELECT * FROM peak_stats WHERE date = ?`,
    [today]
  );
  
  if (!existing.data || existing.data.length === 0) {
    // Insert new record
    await adapter.execute(
      `INSERT INTO peak_stats (date, peak_total, peak_watching, peak_livetv, peak_browsing,
        peak_total_time, peak_watching_time, peak_livetv_time, peak_browsing_time, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [today, current.total, current.watching, current.livetv, current.browsing, now, now, now, now, now]
    );
    
    return {
      date: today,
      peakTotal: current.total,
      peakWatching: current.watching,
      peakLiveTV: current.livetv,
      peakBrowsing: current.browsing,
      peakTotalTime: now,
      peakWatchingTime: now,
      peakLiveTVTime: now,
      peakBrowsingTime: now,
    };
  }
  
  // Update only if higher
  const row = existing.data[0];
  const currentPeakTotal = parseInt(row.peak_total) || 0;
  const currentPeakWatching = parseInt(row.peak_watching) || 0;
  const currentPeakLiveTV = parseInt(row.peak_livetv) || 0;
  const currentPeakBrowsing = parseInt(row.peak_browsing) || 0;
  
  const newPeakTotal = current.total > currentPeakTotal ? current.total : currentPeakTotal;
  const newPeakWatching = current.watching > currentPeakWatching ? current.watching : currentPeakWatching;
  const newPeakLiveTV = current.livetv > currentPeakLiveTV ? current.livetv : currentPeakLiveTV;
  const newPeakBrowsing = current.browsing > currentPeakBrowsing ? current.browsing : currentPeakBrowsing;
  
  const newPeakTotalTime = current.total > currentPeakTotal ? now : (parseInt(row.peak_total_time) || now);
  const newPeakWatchingTime = current.watching > currentPeakWatching ? now : (parseInt(row.peak_watching_time) || now);
  const newPeakLiveTVTime = current.livetv > currentPeakLiveTV ? now : (parseInt(row.peak_livetv_time) || now);
  const newPeakBrowsingTime = current.browsing > currentPeakBrowsing ? now : (parseInt(row.peak_browsing_time) || now);
  
  const hasChanges = 
    newPeakTotal > currentPeakTotal ||
    newPeakWatching > currentPeakWatching ||
    newPeakLiveTV > currentPeakLiveTV ||
    newPeakBrowsing > currentPeakBrowsing;
  
  if (hasChanges) {
    await adapter.execute(
      `UPDATE peak_stats SET 
        peak_total = ?, peak_watching = ?, peak_livetv = ?, peak_browsing = ?,
        peak_total_time = ?, peak_watching_time = ?, peak_livetv_time = ?, peak_browsing_time = ?,
        last_updated = ?
       WHERE date = ?`,
      [
        newPeakTotal, newPeakWatching, newPeakLiveTV, newPeakBrowsing,
        newPeakTotalTime, newPeakWatchingTime, newPeakLiveTVTime, newPeakBrowsingTime,
        now, today
      ]
    );
  }
  
  return {
    date: today,
    peakTotal: newPeakTotal,
    peakWatching: newPeakWatching,
    peakLiveTV: newPeakLiveTV,
    peakBrowsing: newPeakBrowsing,
    peakTotalTime: newPeakTotalTime,
    peakWatchingTime: newPeakWatchingTime,
    peakLiveTVTime: newPeakLiveTVTime,
    peakBrowsingTime: newPeakBrowsingTime,
  };
}
