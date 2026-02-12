'use client';

/**
 * Unified Stats Context
 * Single source of truth for all admin analytics data
 * All admin pages should use this context instead of making their own API calls
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAdmin } from './AdminContext';

// Peak stats interface
interface PeakStats {
  date: string;
  peakTotal: number;
  peakWatching: number;
  peakLiveTV: number;
  peakBrowsing: number;
  peakTotalTime: number;
  peakWatchingTime: number;
  peakLiveTVTime: number;
  peakBrowsingTime: number;
}

// Bot detection metrics interface
interface BotDetectionMetrics {
  totalDetections: number;
  suspectedBots: number;
  confirmedBots: number;
  pendingReview: number;
  avgConfidenceScore: number;
  recentDetections: Array<{
    userId: string;
    ipAddress: string;
    confidenceScore: number;
    status: string;
    timestamp: number;
  }>;
}

// Bot filtering options interface
interface BotFilterOptions {
  includeBots: boolean;
  confidenceThreshold: number; // 0-100, bots above this threshold are filtered
  showBotMetrics: boolean;
}

// Traffic data interface
interface TrafficTotals {
  totalHits: number;
  uniqueVisitors: number;
  botHits: number;
  humanHits: number;
}

// Presence stats interface
interface PresenceStats {
  totalActive: number;
  trulyActive: number;
  totalSessions: number;
  activityBreakdown: Array<{ activityType: string; userCount: number; trulyActive: number }>;
  validationScores: Array<{ trustLevel: string; userCount: number; avgScore: number }>;
}

// Unified stats interface - SINGLE SOURCE OF TRUTH
// All counts use DISTINCT user_id to avoid duplicates
interface UnifiedStats {
  // Real-time (from live_activity table - HEARTBEAT BASED)
  // Same source as /api/analytics/live-activity for consistency
  liveUsers: number;          // Users with heartbeat in last 2 min
  trulyActiveUsers: number;   // Users with heartbeat in last 1 min (stricter)
  liveWatching: number;       // Users watching VOD content
  liveBrowsing: number;       // Users browsing (not watching)
  liveTVViewers: number;      // Users watching Live TV
  
  // Real-time geographic distribution (current active users by location)
  realtimeGeographic: Array<{ country: string; countryName: string; count: number }>;
  
  // Peak stats (persisted in DB, updated server-side)
  peakStats: PeakStats | null;
  
  // User metrics (user_activity table) - all counts are UNIQUE users
  totalUsers: number;
  activeToday: number;      // DAU - unique users active in last 24h
  activeThisWeek: number;   // WAU - unique users active in last 7 days
  activeThisMonth: number;  // MAU - unique users active in last 30 days
  newUsersToday: number;    // unique users first seen in last 24h
  returningUsers: number;   // unique users who returned today
  
  // Content metrics (watch_sessions table) - last 24h
  totalSessions: number;
  totalWatchTime: number;   // in minutes (last 24h)
  allTimeWatchTime: number; // in minutes (all time)
  avgSessionDuration: number;
  completionRate: number;
  completedSessions: number;
  totalPauses: number;
  totalSeeks: number;
  movieSessions: number;
  tvSessions: number;
  uniqueContentWatched: number;
  
  // Top content (last 7 days)
  topContent: Array<{ contentId: string; contentTitle: string; contentType: string; watchCount: number; totalWatchTime: number }>;
  
  // Page views (analytics_events table) - last 24h
  pageViews: number;
  uniqueVisitors: number;
  
  // Geographic - unique users per country (last 7 days)
  topCountries: Array<{ country: string; countryName: string; count: number }>;
  
  // Cities - unique users per city (last 7 days)
  topCities: Array<{ city: string; country: string; countryName: string; count: number }>;
  
  // Devices - unique users per device (last 7 days)
  deviceBreakdown: Array<{ device: string; count: number }>;
  
  // Bot detection metrics
  botDetection: BotDetectionMetrics;
  
  // Traffic data (consolidated from traffic-sources endpoint)
  trafficTotals: TrafficTotals;
  
  // Presence stats (consolidated from presence-stats endpoint)
  presenceStats: PresenceStats;
  
  // Time ranges for transparency
  timeRanges: {
    realtime: string;
    dau: string;
    wau: string;
    mau: string;
    content: string;
    geographic: string;
    devices: string;
    pageViews: string;
    botDetection: string;
  };
  
  // Timestamps
  lastUpdated: number;
  dataSource: string;
}

interface StatsContextType {
  stats: UnifiedStats;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastRefresh: Date | null;
  // Bot filtering options
  botFilterOptions: BotFilterOptions;
  setBotFilterOptions: (options: BotFilterOptions) => void;
  // Time range selection
  timeRange: string;
  setTimeRange: (range: string) => void;
}

const defaultStats: UnifiedStats = {
  liveUsers: 0,
  trulyActiveUsers: 0,
  liveWatching: 0,
  liveBrowsing: 0,
  liveTVViewers: 0,
  realtimeGeographic: [],
  peakStats: null,
  totalUsers: 0,
  activeToday: 0,
  activeThisWeek: 0,
  activeThisMonth: 0,
  newUsersToday: 0,
  returningUsers: 0,
  totalSessions: 0,
  totalWatchTime: 0,
  allTimeWatchTime: 0,
  avgSessionDuration: 0,
  completionRate: 0,
  completedSessions: 0,
  totalPauses: 0,
  totalSeeks: 0,
  movieSessions: 0,
  tvSessions: 0,
  uniqueContentWatched: 0,
  topContent: [],
  pageViews: 0,
  uniqueVisitors: 0,
  topCountries: [],
  topCities: [],
  deviceBreakdown: [],
  botDetection: {
    totalDetections: 0,
    suspectedBots: 0,
    confirmedBots: 0,
    pendingReview: 0,
    avgConfidenceScore: 0,
    recentDetections: [],
  },
  trafficTotals: {
    totalHits: 0,
    uniqueVisitors: 0,
    botHits: 0,
    humanHits: 0,
  },
  presenceStats: {
    totalActive: 0,
    trulyActive: 0,
    totalSessions: 0,
    activityBreakdown: [],
    validationScores: [],
  },
  timeRanges: {
    realtime: '5 minutes',
    dau: '24 hours',
    wau: '7 days',
    mau: '30 days',
    content: '24 hours',
    geographic: '7 days',
    devices: '7 days',
    pageViews: '24 hours',
    botDetection: '7 days',
  },
  lastUpdated: 0,
  dataSource: 'none',
};

const defaultBotFilterOptions: BotFilterOptions = {
  includeBots: false, // Exclude bots by default
  confidenceThreshold: 70, // Only filter bots with >70% confidence
  showBotMetrics: true, // Show bot detection metrics by default
};

const StatsContext = createContext<StatsContextType>({
  stats: defaultStats,
  loading: true,
  error: null,
  refresh: async () => {},
  lastRefresh: null,
  botFilterOptions: defaultBotFilterOptions,
  setBotFilterOptions: () => {},
  timeRange: '24h',
  setTimeRange: () => {},
});

export function useStats() {
  return useContext(StatsContext);
}

// Helper to load bot filter options from localStorage
const loadBotFilterOptions = (): BotFilterOptions => {
  if (typeof window === 'undefined') return defaultBotFilterOptions;
  try {
    const stored = localStorage.getItem('admin_bot_filter_options');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        includeBots: typeof parsed.includeBots === 'boolean' ? parsed.includeBots : defaultBotFilterOptions.includeBots,
        confidenceThreshold: typeof parsed.confidenceThreshold === 'number' ? parsed.confidenceThreshold : defaultBotFilterOptions.confidenceThreshold,
        showBotMetrics: typeof parsed.showBotMetrics === 'boolean' ? parsed.showBotMetrics : defaultBotFilterOptions.showBotMetrics,
      };
    }
  } catch (e) {
    console.error('Failed to load bot filter options from localStorage:', e);
  }
  return defaultBotFilterOptions;
};

// Helper to save bot filter options to localStorage
const saveBotFilterOptions = (options: BotFilterOptions) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('admin_bot_filter_options', JSON.stringify(options));
  } catch (e) {
    console.error('Failed to save bot filter options to localStorage:', e);
  }
};

export function StatsProvider({ children }: { children: ReactNode }) {
  const { dateRange } = useAdmin();
  const [stats, setStats] = useState<UnifiedStats>(defaultStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [botFilterOptions, setBotFilterOptionsState] = useState<BotFilterOptions>(defaultBotFilterOptions);
  const [timeRange, setTimeRange] = useState<string>('7d');
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync timeRange with AdminContext's dateRange
  useEffect(() => {
    const periodToRange: Record<string, string> = {
      'day': '24h',
      'week': '7d',
      'month': '30d',
      'year': '365d',
    };
    const newRange = periodToRange[dateRange.period] || '7d';
    if (newRange !== timeRange) {
      setTimeRange(newRange);
    }
  }, [dateRange.period]);  // Load bot filter options from localStorage on mount
  useEffect(() => {
    const savedOptions = loadBotFilterOptions();
    setBotFilterOptionsState(savedOptions);
    setIsInitialized(true);
  }, []);

  // Wrapper to persist bot filter options when they change
  const setBotFilterOptions = useCallback((options: BotFilterOptions) => {
    setBotFilterOptionsState(options);
    saveBotFilterOptions(options);
  }, []);

  const fetchAllStats = useCallback(async (isInitial = false) => {
    // Only show loading on initial fetch, not on refreshes
    if (isInitial) {
      setLoading(true);
    }
    setError(null);
    
    try {
      // Fetch from CF Worker's /admin/stats endpoint (source of truth)
      const CF_WORKER_URL = process.env.NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL || 'https://flyx-analytics.vynx.workers.dev';
      const url = `${CF_WORKER_URL}/admin/stats?range=${timeRange}`;
      console.log('[StatsContext] Fetching from CF Worker:', url, 'timeRange:', timeRange);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('[StatsContext] Response not OK:', response.status, response.statusText);
        throw new Error('Failed to fetch stats');
      }
      
      const data = await response.json();
      console.log('[StatsContext] Response data:', { 
        success: data.success, 
        liveUsers: data.stats?.liveUsers 
      });
      
      if (data.success && data.stats) {
        const s = data.stats;
        setStats({
          // Real-time from DO
          liveUsers: s.liveUsers || 0,
          trulyActiveUsers: s.liveUsers || 0, // DO doesn't track this separately
          liveWatching: s.watching || 0,
          liveBrowsing: s.browsing || 0,
          liveTVViewers: s.livetv || 0,
          
          // Real-time geographic from DO
          realtimeGeographic: (s.topCountries || []).map((c: any) => ({
            country: c.code || c.country,
            countryName: c.country,
            count: c.count || 0,
          })),
          
          // Peak stats
          peakStats: {
            date: new Date().toISOString().split('T')[0],
            peakTotal: s.peakToday || 0,
            peakWatching: 0,
            peakLiveTV: 0,
            peakBrowsing: 0,
            peakTotalTime: s.peakTime ? new Date(s.peakTime).getTime() : 0,
            peakWatchingTime: 0,
            peakLiveTVTime: 0,
            peakBrowsingTime: 0,
          },
          
          // User metrics from DO (D1 queries)
          totalUsers: s.totalUsers || 0,
          activeToday: s.dau || 0,
          activeThisWeek: s.wau || 0,
          activeThisMonth: s.mau || 0,
          newUsersToday: s.newToday || 0,
          returningUsers: s.returningUsers || 0,
          
          // Content metrics from DO
          totalSessions: s.totalSessions || 0,
          totalWatchTime: s.totalWatchTimeMinutes || 0,
          allTimeWatchTime: s.totalWatchTimeMinutes || 0,
          avgSessionDuration: s.avgSessionMinutes || 0,
          completionRate: s.completionRate || 0,
          completedSessions: 0,
          totalPauses: 0,
          totalSeeks: 0,
          movieSessions: 0,
          tvSessions: 0,
          uniqueContentWatched: 0,
          
          // Top content from DO
          topContent: (s.topContent || []).map((c: any) => ({
            contentId: c.id,
            contentTitle: c.title,
            contentType: c.type,
            watchCount: c.viewers || 0,
            totalWatchTime: 0,
          })),
          
          // Page views from DO
          pageViews: s.pageViews || 0,
          uniqueVisitors: s.uniqueVisitors || 0,
          
          // Geographic from DO
          topCountries: (s.topCountries || []).map((c: any) => ({
            country: c.code || c.country,
            countryName: c.country,
            count: c.count || 0,
          })),
          
          // Cities (not tracked by DO)
          topCities: [],
          
          // Devices (not tracked by DO)
          deviceBreakdown: [{ device: 'desktop', count: s.liveUsers || 0 }],
          
          // Bot detection (not tracked by DO)
          botDetection: {
            totalDetections: 0,
            suspectedBots: 0,
            confirmedBots: 0,
            pendingReview: 0,
            avgConfidenceScore: 0,
            recentDetections: [],
          },
          
          // Traffic totals (from CF Worker if available)
          trafficTotals: {
            totalHits: s.trafficTotals?.totalHits || s.pageViews || 0,
            uniqueVisitors: s.trafficTotals?.uniqueVisitors || s.uniqueVisitors || 0,
            botHits: s.trafficTotals?.botHits || 0,
            humanHits: s.trafficTotals?.humanHits || s.pageViews || 0,
          },
          
          // Presence stats (from CF Worker if available)
          presenceStats: {
            totalActive: s.liveUsers || 0,
            trulyActive: s.liveUsers || 0,
            totalSessions: s.totalSessions || 0,
            activityBreakdown: [
              { activityType: 'watching', userCount: s.watching || 0, trulyActive: s.watching || 0 },
              { activityType: 'browsing', userCount: s.browsing || 0, trulyActive: s.browsing || 0 },
              { activityType: 'livetv', userCount: s.livetv || 0, trulyActive: s.livetv || 0 },
            ].filter(a => a.userCount > 0),
            validationScores: [],
          },
          
          // Time ranges
          timeRanges: {
            realtime: '5 minutes',
            dau: '24 hours',
            wau: '7 days',
            mau: '30 days',
            content: '24 hours',
            geographic: 'real-time',
            devices: 'real-time',
            pageViews: '24 hours',
            botDetection: '7 days',
          },
          
          // Meta
          lastUpdated: Date.now(),
          dataSource: 'cf-worker-do',
        });
        
        setLastRefresh(new Date());
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      // DIAGNOSTIC: Enhanced error logging for analytics debugging
      console.error('[StatsContext] Failed to fetch unified stats:', err);
      console.error('[StatsContext] Error type:', err?.constructor?.name);
      console.error('[StatsContext] Error message:', err instanceof Error ? err.message : String(err));
      console.error('[StatsContext] Time range:', timeRange);
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, [botFilterOptions, timeRange]);

  // Initial fetch
  useEffect(() => {
    fetchAllStats(true);
  }, [fetchAllStats]);

  // Auto-refresh every 60 seconds (increased from 30s to reduce D1 reads)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAllStats(false);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchAllStats]);

  // Refetch when bot filter options change (only after initialization)
  useEffect(() => {
    if (isInitialized && lastRefresh) { // Only refetch if we've already loaded data initially
      fetchAllStats(false);
    }
  }, [botFilterOptions, timeRange, fetchAllStats, lastRefresh, isInitialized]);

  return (
    <StatsContext.Provider value={{ 
      stats, 
      loading, 
      error, 
      refresh: fetchAllStats, 
      lastRefresh,
      botFilterOptions,
      setBotFilterOptions,
      timeRange,
      setTimeRange,
    }}>
      {children}
    </StatsContext.Provider>
  );
}
