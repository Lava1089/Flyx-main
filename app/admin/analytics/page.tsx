'use client';

/**
 * Unified Analytics Page - Complete Refactor
 * Merges analytics and analytics-v2 pages into single comprehensive page
 * Implements tabbed interface for different analytics views (sessions, trends, engagement)
 * Uses unified stats context for consistent data across all tabs
 * Includes advanced filtering and search capabilities
 * Requirements: 4.2, 4.3, 4.4, 4.5
 */

import { useState, useEffect, useMemo } from 'react';
import { useAdmin } from '../context/AdminContext';
import { useStats } from '../context/StatsContext';
import { getAdminAnalyticsUrl } from '../hooks/useAnalyticsApi';
import BotFilterControls from '../components/BotFilterControls';
import DataExportPanel from '../components/DataExportPanel';

// Custom hook for debounced value
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Data interfaces
interface WatchSession {
  id: string;
  user_id: string;
  content_id: string;
  content_type: string;
  content_title: string;
  season_number?: number;
  episode_number?: number;
  started_at: number;
  ended_at?: number;
  total_watch_time: number;
  last_position: number;
  duration: number;
  completion_percentage: number;
  quality?: string;
  device_type?: string;
  is_completed: boolean;
  pause_count: number;
  seek_count: number;
}

interface LiveTVAnalytics {
  currentViewers: number;
  stats: {
    totalCurrentWatchTime: number;
    totalBufferEvents: number;
    recentSessions: number;
    avgSessionDuration: number;
    totalHistoricalWatchTime: number;
  };
  channels: Array<{
    channelId: string;
    channelName: string;
    category?: string;
    viewerCount: number;
  }>;
  categories: Array<{
    category: string;
    viewerCount: number;
  }>;
  recentHistory?: Array<{
    channelName: string;
    totalWatchDuration: number;
    startedAt: number;
    endedAt: number;
  }>;
}

interface TrendData {
  label: string;
  current: number;
  previous: number;
  change: number;
}

interface TrafficSources {
  totals?: {
    total_hits: number;
    human_hits: number;
    bot_hits: number;
    unique_visitors: number;
  };
  mediumStats?: Array<{
    referrer_medium: string;
    hit_count: string;
  }>;
  topReferrers?: Array<{
    referrer_domain: string;
    hit_count: string;
  }>;
  botStats?: Array<{
    source_name: string;
    hit_count: string;
  }>;
  geoStats?: Array<{
    country: string;
    hit_count: string;
  }>;
}

type AnalyticsTab = 'overview' | 'sessions' | 'livetv' | 'trends' | 'engagement' | 'traffic' | 'geographic' | 'export';

// Pagination state interface
interface PaginationState {
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function UnifiedAnalyticsPage() {
  useAdmin(); // Context for admin state
  const { stats: unifiedStats, botFilterOptions } = useStats(); // Use unified stats as primary source
  
  const [sessions, setSessions] = useState<WatchSession[]>([]);
  const [liveTVAnalytics, setLiveTVAnalytics] = useState<LiveTVAnalytics | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSources | null>(null);
  const [previousAnalytics, setPreviousAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  
  // Advanced filtering and search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDevice, setFilterDevice] = useState<string>('all');
  const [filterQuality, setFilterQuality] = useState<string>('all');
  const [filterContentType, setFilterContentType] = useState<string>('all');
  const [sortField, setSortField] = useState<'started_at' | 'total_watch_time' | 'completion_percentage'>('started_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Pagination state
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 50,
    totalPages: 1
  });
  
  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // Debounce search query for better performance (300ms delay)
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  useEffect(() => {
    fetchAnalytics();
    fetchLiveTVAnalytics();
    fetchTrafficSources();
    fetchPreviousPeriodData();
    setLastRefreshTime(new Date());
  }, [timeRange, botFilterOptions]);

  // Auto-refresh every 30 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchAnalytics();
      fetchLiveTVAnalytics();
      fetchTrafficSources();
      setLastRefreshTime(new Date());
    }, 30000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, timeRange, botFilterOptions]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // Fetch both unified stats (for real-time data) and watch sessions (for detailed session data)
      const params: any = { 
        timeRange: timeRange,
        limit: '200' 
      };
      
      // Apply bot filtering
      if (!botFilterOptions.includeBots) {
        params.excludeBots = 'true';
        params.confidenceThreshold = botFilterOptions.confidenceThreshold.toString();
      }

      // Fetch detailed session data for the sessions tab
      const now = Date.now();
      const ranges: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        'all': 0,
      };

      const startDate = ranges[timeRange] ? now - ranges[timeRange] : 0;
      const sessionParams: any = { limit: '200' };
      if (startDate) sessionParams.startDate = startDate.toString();
      
      // Apply bot filtering to session data too
      if (!botFilterOptions.includeBots) {
        sessionParams.excludeBots = 'true';
        sessionParams.confidenceThreshold = botFilterOptions.confidenceThreshold.toString();
      }

      const sessionResponse = await fetch(getAdminAnalyticsUrl('watch-session', sessionParams));
      const sessionData = await sessionResponse.json();

      // DIAGNOSTIC: Log session data for debugging
      console.log('[Analytics Page] Session response:', {
        success: sessionData.success,
        sessionCount: sessionData.sessions?.length || 0,
        error: sessionData.error
      });

      if (sessionData.success) {
        setSessions(sessionData.sessions || []);
      } else {
        console.error('[Analytics Page] Session fetch failed:', sessionData.error);
      }
    } catch (error) {
      // DIAGNOSTIC: Enhanced error logging
      console.error('[Analytics Page] Failed to fetch analytics:', error);
      console.error('[Analytics Page] Error type:', error?.constructor?.name);
      console.error('[Analytics Page] Error message:', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveTVAnalytics = async () => {
    try {
      const response = await fetch(getAdminAnalyticsUrl('livetv-session', { history: 'true' }));
      const data = await response.json();
      if (data.success !== false) {
        setLiveTVAnalytics(data);
      }
    } catch (error) {
      console.error('Failed to fetch Live TV analytics:', error);
    }
  };

  const fetchTrafficSources = async () => {
    try {
      const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 365;
      const response = await fetch(getAdminAnalyticsUrl('traffic-sources', { days }));
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setTrafficSources(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch traffic sources:', error);
    }
  };

  const fetchPreviousPeriodData = async () => {
    try {
      const now = Date.now();
      const ranges: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        'all': 0,
      };

      const periodLength = ranges[timeRange] || ranges['7d'];
      if (periodLength === 0) {
        setPreviousAnalytics(null);
        return;
      }

      const prevEndDate = now - periodLength;
      const prevStartDate = now - (2 * periodLength);

      const response = await fetch(getAdminAnalyticsUrl('watch-session', { 
        limit: '200', 
        startDate: prevStartDate.toString(), 
        endDate: prevEndDate.toString() 
      }));
      const data = await response.json();

      if (data.success && data.analytics) {
        setPreviousAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Failed to fetch previous period analytics:', error);
      setPreviousAnalytics(null);
    }
  };

  // Computed filtered and sorted sessions with advanced filtering
  const filteredSessions = useMemo(() => {
    let result = [...sessions];
    
    // Apply search filter with debounced query
    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter(s => 
        s.content_title?.toLowerCase().includes(query) ||
        s.content_id?.toLowerCase().includes(query) ||
        s.user_id?.toLowerCase().includes(query)
      );
    }
    
    // Apply device filter
    if (filterDevice !== 'all') {
      result = result.filter(s => s.device_type === filterDevice);
    }
    
    // Apply quality filter
    if (filterQuality !== 'all') {
      result = result.filter(s => s.quality === filterQuality);
    }

    // Apply content type filter
    if (filterContentType !== 'all') {
      result = result.filter(s => s.content_type === filterContentType);
    }
    
    // Apply sorting
    result.sort((a, b) => {
      const aVal = a[sortField] || 0;
      const bVal = b[sortField] || 0;
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });
    
    return result;
  }, [sessions, debouncedSearchQuery, filterDevice, filterQuality, filterContentType, sortField, sortOrder]);

  // Update pagination when filtered sessions change
  useEffect(() => {
    setPagination(prev => ({
      ...prev,
      page: 1,
      totalPages: Math.ceil(filteredSessions.length / prev.pageSize)
    }));
  }, [filteredSessions.length]);

  // Paginated sessions
  const paginatedSessions = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredSessions.slice(start, end);
  }, [filteredSessions, pagination.page, pagination.pageSize]);

  // Calculate trends using real previous period data
  const trends = useMemo((): TrendData[] => {
    const calculateChange = (current: number, previous: number | undefined): number => {
      if (previous === undefined || previous === 0) return 0;
      return Math.round(((current - previous) / previous) * 100);
    };
    
    return [
      {
        label: 'Total Sessions',
        current: unifiedStats.totalSessions,
        previous: previousAnalytics?.totalSessions ?? 0,
        change: calculateChange(unifiedStats.totalSessions, previousAnalytics?.totalSessions),
      },
      {
        label: 'Watch Time',
        current: unifiedStats.totalWatchTime,
        previous: previousAnalytics?.totalWatchTime ?? 0,
        change: calculateChange(unifiedStats.totalWatchTime, previousAnalytics?.totalWatchTime),
      },
      {
        label: 'Completion Rate',
        current: unifiedStats.completionRate,
        previous: previousAnalytics?.completionRate ?? 0,
        change: calculateChange(unifiedStats.completionRate, previousAnalytics?.completionRate),
      },
      {
        label: 'Avg Session Duration',
        current: unifiedStats.avgSessionDuration,
        previous: previousAnalytics?.averageWatchTime ?? 0,
        change: calculateChange(unifiedStats.avgSessionDuration, previousAnalytics?.averageWatchTime),
      },
    ];
  }, [unifiedStats, previousAnalytics]);

  // Engagement metrics
  const engagementMetrics = useMemo(() => {
    if (sessions.length === 0) return null;
    
    const avgPausesPerSession = (unifiedStats.totalPauses || 0) / Math.max(unifiedStats.totalSessions, 1);
    const avgSeeksPerSession = (unifiedStats.totalSeeks || 0) / Math.max(unifiedStats.totalSessions, 1);
    
    const completionDistribution = {
      '0-25%': sessions.filter(s => s.completion_percentage < 25).length,
      '25-50%': sessions.filter(s => s.completion_percentage >= 25 && s.completion_percentage < 50).length,
      '50-75%': sessions.filter(s => s.completion_percentage >= 50 && s.completion_percentage < 75).length,
      '75-100%': sessions.filter(s => s.completion_percentage >= 75).length,
    };
    
    // Calculate peak hours
    const hourCounts: Record<number, number> = {};
    sessions.forEach(s => {
      const hour = new Date(s.started_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    
    return {
      avgPausesPerSession: Math.round(avgPausesPerSession * 10) / 10,
      avgSeeksPerSession: Math.round(avgSeeksPerSession * 10) / 10,
      completionDistribution,
      peakHour: peakHour ? parseInt(peakHour[0]) : 0,
      peakHourCount: peakHour ? peakHour[1] : 0,
      hourCounts,
    };
  }, [sessions, unifiedStats]);

  // Content type segmentation
  const contentSegmentation = useMemo(() => {
    const movies = sessions.filter(s => s.content_type === 'movie');
    const tvShows = sessions.filter(s => s.content_type === 'tv_show');
    
    const calculateMetrics = (sessionList: WatchSession[]) => {
      if (sessionList.length === 0) return { sessions: 0, watchTime: 0, avgCompletion: 0 };
      
      const totalWatchTime = sessionList.reduce((sum, s) => sum + s.total_watch_time, 0);
      const totalCompletion = sessionList.reduce((sum, s) => sum + s.completion_percentage, 0);
      
      return {
        sessions: sessionList.length,
        watchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        avgCompletion: Math.round(totalCompletion / sessionList.length),
      };
    };
    
    return {
      movies: calculateMetrics(movies),
      tvShows: calculateMetrics(tvShows),
      total: calculateMetrics(sessions),
    };
  }, [sessions]);

  // Utility functions
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'N/A';
    }
  };

  const getCompletionColor = (percentage: number) => {
    if (percentage >= 90) return '#10b981';
    if (percentage >= 50) return '#f59e0b';
    return '#ef4444';
  };

  // Tab configuration
  const tabs = [
    { id: 'overview', label: '📊 Overview', count: null },
    { id: 'sessions', label: '🎬 Sessions', count: filteredSessions.length },
    { id: 'livetv', label: '📺 Live TV', count: liveTVAnalytics?.currentViewers || 0 },
    { id: 'trends', label: '📈 Trends', count: null },
    { id: 'engagement', label: '💡 Engagement', count: null },
    { id: 'traffic', label: '🌐 Traffic', count: trafficSources?.totals?.total_hits || null },
    { id: 'geographic', label: '🗺️ Geographic', count: unifiedStats.topCountries?.length || null },
    { id: 'export', label: '📥 Export', count: null },
  ];

  if (loading && !unifiedStats.totalSessions) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '400px', 
        color: '#94a3b8' 
      }}>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          border: '3px solid rgba(120, 119, 198, 0.3)', 
          borderTopColor: '#7877c6', 
          borderRadius: '50%', 
          animation: 'spin 1s linear infinite', 
          marginBottom: '16px' 
        }} />
        Loading unified analytics...
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', paddingBottom: '20px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '32px' }}>📊</span>
              Unified Analytics Dashboard
            </h1>
            <p style={{ margin: '8px 0 0 0', color: '#94a3b8', fontSize: '16px' }}>
              Comprehensive analytics with real-time insights and advanced filtering
            </p>
            {lastRefreshTime && (
              <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '12px' }}>
                Last updated: {lastRefreshTime.toLocaleTimeString()}
                {autoRefresh && <span style={{ marginLeft: '8px', color: '#22c55e' }}>• Auto-refresh ON</span>}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['24h', '7d', '30d', 'all'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  style={{
                    padding: '8px 16px',
                    background: timeRange === range ? '#7877c6' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid',
                    borderColor: timeRange === range ? '#7877c6' : 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: timeRange === range ? 'white' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  {range === '24h' ? '24 Hours' : range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : 'All Time'}
                </button>
              ))}
              <button
                onClick={() => {
                  fetchAnalytics();
                  fetchLiveTVAnalytics();
                  fetchTrafficSources();
                  fetchPreviousPeriodData();
                  setLastRefreshTime(new Date());
                }}
                disabled={loading}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid #3b82f6',
                  borderRadius: '8px',
                  color: '#3b82f6',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  opacity: loading ? 0.5 : 1
                }}
              >
                🔄 Refresh
              </button>
            </div>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                padding: '6px 12px',
                background: autoRefresh ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: '1px solid',
                borderColor: autoRefresh ? '#22c55e' : 'rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                color: autoRefresh ? '#22c55e' : '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: autoRefresh ? '#22c55e' : '#64748b',
                animation: autoRefresh ? 'pulse 2s infinite' : 'none'
              }} />
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Bot Filter Controls */}
      <div style={{ marginBottom: '24px' }}>
        <BotFilterControls />
      </div>

      {/* Key Stats from Unified Source - Single Source of Truth */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <StatCard title="Live Users" value={unifiedStats.liveUsers} icon="🟢" color="#22c55e" pulse />
        <StatCard title="Sessions (24h)" value={unifiedStats.totalSessions} icon="📊" color="#7877c6" />
        <StatCard title="Watch Time (24h)" value={`${unifiedStats.totalWatchTime}m`} icon="⏱️" color="#10b981" />
        <StatCard title="Avg Duration" value={`${unifiedStats.avgSessionDuration}m`} icon="📈" color="#f59e0b" />
        <StatCard title="Completion Rate" value={`${unifiedStats.completionRate}%`} icon="✅" color="#ec4899" />
        <StatCard title="Active Today (DAU)" value={unifiedStats.activeToday} icon="👥" color="#3b82f6" />
        <StatCard title="Active Week (WAU)" value={unifiedStats.activeThisWeek} icon="📅" color="#8b5cf6" />
        <StatCard title="Unique Content" value={unifiedStats.uniqueContentWatched} icon="🎬" color="#06b6d4" />
      </div>

      {/* Tab Selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as AnalyticsTab)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.id ? '#7877c6' : 'rgba(255, 255, 255, 0.05)',
              border: '1px solid',
              borderColor: activeTab === tab.id ? '#7877c6' : 'rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: activeTab === tab.id ? 'white' : '#94a3b8',
              cursor: 'pointer',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {tab.label}
            {tab.count !== null && tab.count !== undefined && (
              <span style={{ 
                background: 'rgba(255,255,255,0.2)', 
                padding: '2px 8px', 
                borderRadius: '10px', 
                fontSize: '12px' 
              }}>
                {typeof tab.count === 'number' ? tab.count.toLocaleString() : tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab 
          unifiedStats={unifiedStats} 
          contentSegmentation={contentSegmentation}
        />
      )}

      {activeTab === 'sessions' && (
        <SessionsTab 
          sessions={paginatedSessions}
          totalSessions={filteredSessions.length}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterDevice={filterDevice}
          setFilterDevice={setFilterDevice}
          filterQuality={filterQuality}
          setFilterQuality={setFilterQuality}
          filterContentType={filterContentType}
          setFilterContentType={setFilterContentType}
          sortField={sortField}
          setSortField={setSortField}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          pagination={pagination}
          setPagination={setPagination}
          formatDate={formatDate}
          formatDuration={formatDuration}
          getCompletionColor={getCompletionColor}
          allSessions={sessions}
        />
      )}

      {activeTab === 'livetv' && (
        <LiveTVTab 
          liveTVAnalytics={liveTVAnalytics}
          formatDuration={formatDuration}
        />
      )}

      {activeTab === 'trends' && (
        <TrendsTab 
          trends={trends}
          timeRange={timeRange}
          formatDuration={formatDuration}
        />
      )}

      {activeTab === 'engagement' && engagementMetrics && (
        <EngagementTab 
          engagementMetrics={engagementMetrics}
        />
      )}

      {activeTab === 'traffic' && (
        <TrafficTab 
          trafficSources={trafficSources}
        />
      )}

      {activeTab === 'geographic' && (
        <GeographicTab 
          topCountries={unifiedStats.topCountries}
          topCities={unifiedStats.topCities}
          realtimeGeographic={unifiedStats.realtimeGeographic}
          deviceBreakdown={unifiedStats.deviceBreakdown}
        />
      )}

      {activeTab === 'export' && (
        <ExportTab />
      )}
    </div>
  );
}

// Tab Components
function OverviewTab({ unifiedStats, contentSegmentation }: any) {
  return (
    <div>
      <h2 style={{ margin: '0 0 24px 0', color: '#f8fafc', fontSize: '20px' }}>Analytics Overview</h2>
      
      {/* Real-time Activity - ALWAYS SHOWS CURRENT USERS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🟢 Real-time Activity (Right Now)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <span style={{ color: '#f8fafc', fontWeight: '600' }}>🔴 Total Active Users</span>
              <span style={{ color: '#10b981', fontSize: '24px', fontWeight: '700' }}>{unifiedStats.liveUsers}</span>
            </div>
            <ActivityBar 
              label="Watching VOD" 
              icon="▶️" 
              value={unifiedStats.liveWatching} 
              total={unifiedStats.liveUsers} 
            />
            <ActivityBar 
              label="Live TV" 
              icon="📺" 
              value={unifiedStats.liveTVViewers} 
              total={unifiedStats.liveUsers} 
            />
            <ActivityBar 
              label="Browsing" 
              icon="🔍" 
              value={unifiedStats.liveBrowsing} 
              total={unifiedStats.liveUsers} 
            />
          </div>
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', fontSize: '12px', color: '#64748b' }}>
            💡 This shows users active in the last 5 minutes (real-time heartbeat data)
          </div>
        </div>
        
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>📊 Historical Sessions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Total Sessions</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#7877c6', fontWeight: '600' }}>{unifiedStats.totalSessions}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>completed</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Watch Time</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981', fontWeight: '600' }}>{unifiedStats.totalWatchTime}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>minutes</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Completion Rate</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#f59e0b', fontWeight: '600' }}>{unifiedStats.completionRate}%</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', fontSize: '12px', color: '#64748b' }}>
            📈 This shows completed watch sessions (historical data)
          </div>
        </div>
      </div>

      {/* Content Type Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🎬 Content Type Breakdown</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Movies</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981', fontWeight: '600' }}>{contentSegmentation.movies.sessions}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>sessions</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>TV Shows</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#f59e0b', fontWeight: '600' }}>{contentSegmentation.tvShows.sessions}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>sessions</span>
              </div>
            </div>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc', fontWeight: '600' }}>Total</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#7877c6', fontWeight: '700' }}>{contentSegmentation.total.sessions}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>sessions</span>
              </div>
            </div>
          </div>
        </div>
        
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>👥 User Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Active Today</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981', fontWeight: '600' }}>{unifiedStats.activeToday}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>users</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Active This Week</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#f59e0b', fontWeight: '600' }}>{unifiedStats.activeThisWeek}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>users</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc' }}>Total Users</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#7877c6', fontWeight: '600' }}>{unifiedStats.totalUsers}</span>
                <span style={{ color: '#64748b', fontSize: '12px' }}>all time</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Content */}
      {unifiedStats.topContent && unifiedStats.topContent.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🔥 Top Content (Last 7 Days)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>#</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>Title</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>Type</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>Views</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>Watch Time</th>
                </tr>
              </thead>
              <tbody>
                {unifiedStats.topContent.slice(0, 10).map((content: any, index: number) => (
                  <tr key={content.contentId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '12px', color: '#64748b', fontSize: '14px' }}>{index + 1}</td>
                    <td style={{ padding: '12px', color: '#f8fafc', fontSize: '14px', fontWeight: '500' }}>{content.contentTitle}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        background: content.contentType === 'movie' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: content.contentType === 'movie' ? '#10b981' : '#f59e0b'
                      }}>
                        {content.contentType}
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#7877c6', fontWeight: '600' }}>{content.watchCount}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#94a3b8' }}>{content.totalWatchTime}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Device Breakdown */}
      {unifiedStats.deviceBreakdown && unifiedStats.deviceBreakdown.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>📱 Device Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            {unifiedStats.deviceBreakdown.map((device: any) => {
              const total = unifiedStats.deviceBreakdown.reduce((sum: number, d: any) => sum + d.count, 0);
              const percentage = total > 0 ? Math.round((device.count / total) * 100) : 0;
              const deviceIcons: Record<string, string> = {
                desktop: '🖥️',
                mobile: '📱',
                tablet: '📲',
                tv: '📺',
                unknown: '❓'
              };
              return (
                <div key={device.device} style={{
                  padding: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '12px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>{deviceIcons[device.device] || '📱'}</div>
                  <div style={{ color: '#f8fafc', fontWeight: '600', textTransform: 'capitalize' }}>{device.device}</div>
                  <div style={{ color: '#7877c6', fontSize: '24px', fontWeight: '700', margin: '8px 0' }}>{device.count}</div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>{percentage}% of users</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Countries */}
      {unifiedStats.topCountries && unifiedStats.topCountries.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🌍 Top Countries</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {unifiedStats.topCountries.slice(0, 6).map((country: any) => {
              const total = unifiedStats.topCountries.reduce((sum: number, c: any) => sum + c.count, 0);
              const percentage = total > 0 ? Math.round((country.count / total) * 100) : 0;
              return (
                <div key={country.country} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px'
                }}>
                  <span style={{ color: '#f8fafc' }}>{country.countryName || country.country}</span>
                  <span style={{ color: '#7877c6', fontWeight: '600' }}>
                    {country.count} ({percentage}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* User Metrics Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <StatCard title="Total Users" value={unifiedStats.totalUsers} icon="👥" color="#7877c6" />
        <StatCard title="New Today" value={unifiedStats.newUsersToday} icon="🆕" color="#10b981" />
        <StatCard title="Returning" value={unifiedStats.returningUsers} icon="🔄" color="#f59e0b" />
        <StatCard title="Page Views" value={unifiedStats.pageViews} icon="👁️" color="#ec4899" />
      </div>
    </div>
  );
}

function ActivityBar({ label, icon, value, total }: { label: string; icon: string; value: number; total: number }) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{ fontSize: '16px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: '#f8fafc', fontSize: '14px' }}>{label}</span>
          <span style={{ color: '#94a3b8', fontSize: '14px' }}>{value}</span>
        </div>
        <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ 
            height: '100%', 
            width: `${percentage}%`, 
            background: 'linear-gradient(90deg, #7877c6, #a855f7)', 
            borderRadius: '3px' 
          }} />
        </div>
      </div>
    </div>
  );
}

function SessionsTab({ 
  sessions, 
  totalSessions,
  searchQuery, 
  setSearchQuery, 
  filterDevice, 
  setFilterDevice,
  filterQuality,
  setFilterQuality,
  filterContentType,
  setFilterContentType,
  sortField,
  setSortField,
  sortOrder,
  setSortOrder,
  pagination,
  setPagination,
  formatDate,
  formatDuration,
  getCompletionColor,
  allSessions
}: any) {
  // Get unified stats from context to show warning
  const { stats: unifiedStats } = useStats();
  
  // Get unique values for filter options from all sessions
  const deviceOptions = [...new Set(allSessions.map((s: WatchSession) => s.device_type).filter(Boolean))] as string[];
  const qualityOptions = [...new Set(allSessions.map((s: WatchSession) => s.quality).filter(Boolean))] as string[];

  return (
    <div>
      <h2 style={{ margin: '0 0 24px 0', color: '#f8fafc', fontSize: '20px' }}>
        Watch Sessions ({totalSessions.toLocaleString()})
      </h2>

      {/* Warning when no sessions but active users */}
      {totalSessions === 0 && unifiedStats.liveUsers > 0 && (
        <div style={{
          padding: '16px',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '12px',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <span style={{ color: '#f59e0b', fontWeight: '600' }}>No Completed Sessions Found</span>
          </div>
          <p style={{ color: '#f8fafc', margin: '0 0 8px 0', fontSize: '14px' }}>
            There are currently <strong>{unifiedStats.liveUsers} active users</strong> but no completed watch sessions in the selected time range.
          </p>
          <p style={{ color: '#94a3b8', margin: '0 0 12px 0', fontSize: '13px' }}>
            💡 Sessions appear here only after users stop watching. Check the "Live Activity" page to see users currently watching content.
          </p>
          <a 
            href="/admin/live" 
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px 16px', 
              background: 'rgba(245, 158, 11, 0.2)', 
              color: '#f59e0b', 
              textDecoration: 'none', 
              borderRadius: '8px', 
              fontSize: '13px', 
              fontWeight: '500',
              border: '1px solid rgba(245, 158, 11, 0.3)'
            }}
          >
            🔴 View Live Activity
          </a>
        </div>
      )}

      {/* Advanced Filters */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '12px', 
        marginBottom: '24px',
        padding: '20px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <input
          type="text"
          placeholder="Search content, user ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '10px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#f8fafc',
            fontSize: '14px'
          }}
        />
        <select
          value={filterDevice}
          onChange={(e) => setFilterDevice(e.target.value)}
          style={{
            padding: '10px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#f8fafc',
            fontSize: '14px'
          }}
        >
          <option value="all">All Devices</option>
          {deviceOptions.map((device) => (
            <option key={device} value={device}>{device}</option>
          ))}
        </select>
        <select
          value={filterQuality}
          onChange={(e) => setFilterQuality(e.target.value)}
          style={{
            padding: '10px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#f8fafc',
            fontSize: '14px'
          }}
        >
          <option value="all">All Quality</option>
          {qualityOptions.map((quality) => (
            <option key={quality} value={quality}>{quality}</option>
          ))}
        </select>
        <select
          value={filterContentType}
          onChange={(e) => setFilterContentType(e.target.value)}
          style={{
            padding: '10px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#f8fafc',
            fontSize: '14px'
          }}
        >
          <option value="all">All Types</option>
          <option value="movie">Movies</option>
          <option value="tv_show">TV Shows</option>
        </select>
        <select 
          value={`${sortField}-${sortOrder}`} 
          onChange={(e) => {
            const [field, order] = e.target.value.split('-');
            setSortField(field as any);
            setSortOrder(order as any);
          }}
          style={{
            padding: '10px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#f8fafc',
            fontSize: '14px'
          }}
        >
          <option value="started_at-desc">Newest First</option>
          <option value="started_at-asc">Oldest First</option>
          <option value="total_watch_time-desc">Longest Watch</option>
          <option value="completion_percentage-desc">Highest Completion</option>
        </select>
      </div>

      {/* Sessions Table */}
      <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                <th style={thStyle}>Content</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Started</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Watch Time</th>
                <th style={thStyle}>Completion</th>
                <th style={thStyle}>Device</th>
                <th style={thStyle}>Quality</th>
                <th style={thStyle}>Pauses</th>
                <th style={thStyle}>Seeks</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session: WatchSession) => (
                <tr key={session.id} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <td style={tdStyle}>
                    <div>
                      <strong style={{ color: '#f8fafc' }}>{session.content_title || session.content_id}</strong>
                      {session.season_number && session.episode_number && (
                        <div style={{ color: '#64748b', fontSize: '12px' }}>
                          S{session.season_number}E{session.episode_number}
                        </div>
                      )}
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        background: session.content_type === 'movie' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: session.content_type === 'movie' ? '#10b981' : '#f59e0b',
                        marginTop: '4px',
                        display: 'inline-block'
                      }}>
                        {session.content_type}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' }}>
                      {session.user_id.slice(0, 8)}...
                    </span>
                  </td>
                  <td style={tdStyle}>{formatDate(session.started_at)}</td>
                  <td style={tdStyle}>{formatDuration(session.duration)}</td>
                  <td style={tdStyle}>{formatDuration(session.total_watch_time)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '60px', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(session.completion_percentage, 100)}%`,
                          background: getCompletionColor(session.completion_percentage),
                          borderRadius: '3px'
                        }} />
                      </div>
                      <span style={{ color: getCompletionColor(session.completion_percentage), fontWeight: '600', fontSize: '13px' }}>
                        {Math.round(session.completion_percentage)}%
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>{session.device_type || 'unknown'}</td>
                  <td style={tdStyle}>{session.quality || 'auto'}</td>
                  <td style={tdStyle}>{session.pause_count}</td>
                  <td style={tdStyle}>{session.seek_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination Controls */}
        <div style={{ 
          padding: '16px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)'
        }}>
          <div style={{ color: '#64748b', fontSize: '14px' }}>
            Showing {((pagination.page - 1) * pagination.pageSize) + 1} - {Math.min(pagination.page * pagination.pageSize, totalSessions)} of {totalSessions.toLocaleString()} sessions
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination((prev: any) => ({ ...prev, pageSize: parseInt(e.target.value), page: 1 }))}
              style={{
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '13px'
              }}
            >
              <option value="25">25 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
            <button
              onClick={() => setPagination((prev: any) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={pagination.page === 1}
              style={{
                padding: '6px 12px',
                background: pagination.page === 1 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                color: pagination.page === 1 ? '#64748b' : '#f8fafc',
                cursor: pagination.page === 1 ? 'not-allowed' : 'pointer',
                fontSize: '13px'
              }}
            >
              ← Previous
            </button>
            <span style={{ color: '#94a3b8', fontSize: '13px', padding: '0 8px' }}>
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <button
              onClick={() => setPagination((prev: any) => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
              disabled={pagination.page >= pagination.totalPages}
              style={{
                padding: '6px 12px',
                background: pagination.page >= pagination.totalPages ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                color: pagination.page >= pagination.totalPages ? '#64748b' : '#f8fafc',
                cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                fontSize: '13px'
              }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveTVTab({ liveTVAnalytics, formatDuration }: any) {
  if (!liveTVAnalytics) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📺</div>
        <h3 style={{ color: '#f8fafc', margin: '0 0 8px 0' }}>Live TV Analytics</h3>
        <p>Loading Live TV data...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 24px 0', color: '#f8fafc', fontSize: '20px' }}>Live TV Analytics</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        <StatCard title="Current Viewers" value={liveTVAnalytics.currentViewers || 0} icon="👥" color="#10b981" pulse />
        <StatCard title="Total Watch Time" value={formatDuration(liveTVAnalytics.stats?.totalCurrentWatchTime || 0)} icon="⏱️" color="#7877c6" />
        <StatCard title="Avg Session" value={formatDuration(liveTVAnalytics.stats?.avgSessionDuration || 0)} icon="📊" color="#f59e0b" />
        <StatCard title="Recent Sessions" value={liveTVAnalytics.stats?.recentSessions || 0} icon="📺" color="#ec4899" />
        <StatCard title="Buffer Events" value={liveTVAnalytics.stats?.totalBufferEvents || 0} icon="⚠️" color="#ef4444" />
        <StatCard title="Historical Watch" value={formatDuration(liveTVAnalytics.stats?.totalHistoricalWatchTime || 0)} icon="📈" color="#3b82f6" />
      </div>

      {/* Active Channels */}
      {liveTVAnalytics.channels && liveTVAnalytics.channels.length > 0 ? (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🔴 Active Channels</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
            {liveTVAnalytics.channels.map((channel: any) => (
              <div key={channel.channelId || channel.channelName} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px'
              }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f8fafc', fontWeight: '500' }}>{channel.channelName}</div>
                  {channel.category && <div style={{ color: '#64748b', fontSize: '12px' }}>{channel.category}</div>}
                </div>
                <div style={{ color: '#10b981', fontWeight: '700' }}>
                  {channel.viewerCount} <span style={{ fontSize: '12px', fontWeight: '400' }}>viewers</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          background: 'rgba(255, 255, 255, 0.03)', 
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📺</div>
          <p style={{ color: '#64748b', margin: 0 }}>No active Live TV channels at the moment</p>
        </div>
      )}

      {/* Categories */}
      {liveTVAnalytics.categories && liveTVAnalytics.categories.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginTop: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>📁 Categories</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {liveTVAnalytics.categories.map((cat: any) => (
              <div key={cat.category} style={{
                padding: '8px 16px',
                background: 'rgba(120, 119, 198, 0.2)',
                borderRadius: '20px',
                color: '#f8fafc',
                fontSize: '14px'
              }}>
                {cat.category}: <span style={{ fontWeight: '600', color: '#7877c6' }}>{cat.viewerCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendsTab({ trends, timeRange, formatDuration }: any) {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '20px' }}>Performance Trends</h2>
      <p style={{ color: '#94a3b8', marginBottom: '24px' }}>
        {timeRange === 'all' 
          ? 'Trend comparison not available for "All Time" - select a specific time range'
          : 'Compare current period vs previous period'}
      </p>
      
      {timeRange === 'all' ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '60px 40px', 
          background: 'rgba(255, 255, 255, 0.03)', 
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <h3 style={{ color: '#f8fafc', margin: '0 0 8px 0' }}>Select a Time Range</h3>
          <p style={{ color: '#64748b', margin: 0 }}>
            Choose 24h, 7d, or 30d to see trend comparisons with the previous period
          </p>
        </div>
      ) : (
        <>
          {/* Trend Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            {trends.map((trend: TrendData) => {
              const hasPreviousData = trend.previous > 0;
              const changeColor = trend.change >= 0 ? '#10b981' : '#ef4444';
              const changeIcon = trend.change >= 0 ? '📈' : '📉';
              return (
                <div key={trend.label} style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '16px',
                  padding: '24px',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  {/* Background indicator */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '80px',
                    height: '80px',
                    background: `${changeColor}10`,
                    borderRadius: '0 0 0 100%'
                  }} />
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <span style={{ color: '#f8fafc', fontWeight: '600', fontSize: '15px' }}>{trend.label}</span>
                    {hasPreviousData ? (
                      <span style={{
                        color: changeColor,
                        fontSize: '14px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: `${changeColor}20`,
                        padding: '4px 10px',
                        borderRadius: '20px'
                      }}>
                        {changeIcon} {trend.change >= 0 ? '+' : ''}{trend.change}%
                      </span>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: '12px' }}>No prior data</span>
                    )}
                  </div>
                  
                  {/* Visual comparison bar */}
                  {hasPreviousData && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '60px' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{
                            width: '100%',
                            height: `${Math.min(100, (trend.previous / Math.max(trend.current, trend.previous)) * 50)}px`,
                            background: 'rgba(148, 163, 184, 0.3)',
                            borderRadius: '4px 4px 0 0'
                          }} />
                          <span style={{ color: '#64748b', fontSize: '10px', marginTop: '4px' }}>Previous</span>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{
                            width: '100%',
                            height: `${Math.min(100, (trend.current / Math.max(trend.current, trend.previous)) * 50)}px`,
                            background: `linear-gradient(180deg, ${changeColor}, ${changeColor}80)`,
                            borderRadius: '4px 4px 0 0'
                          }} />
                          <span style={{ color: '#94a3b8', fontSize: '10px', marginTop: '4px' }}>Current</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>Current</div>
                      <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '700' }}>
                        {typeof trend.current === 'number' && trend.label.includes('Time') 
                          ? formatDuration(trend.current) 
                          : typeof trend.current === 'number' ? trend.current.toLocaleString() : trend.current}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>Previous</div>
                      <div style={{ color: '#64748b', fontSize: '20px', fontWeight: '700' }}>
                        {hasPreviousData 
                          ? (typeof trend.previous === 'number' && trend.label.includes('Time') 
                              ? formatDuration(trend.previous) 
                              : typeof trend.previous === 'number' ? trend.previous.toLocaleString() : trend.previous)
                          : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Summary Section */}
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.03)', 
            borderRadius: '16px', 
            border: '1px solid rgba(255, 255, 255, 0.1)', 
            padding: '24px' 
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>📊 Period Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              {trends.map((trend: TrendData) => {
                const isPositive = trend.change >= 0;
                return (
                  <div key={`summary-${trend.label}`} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      background: isPositive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px'
                    }}>
                      {isPositive ? '📈' : '📉'}
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '12px' }}>{trend.label}</div>
                      <div style={{ 
                        color: isPositive ? '#10b981' : '#ef4444', 
                        fontWeight: '600',
                        fontSize: '14px'
                      }}>
                        {isPositive ? '+' : ''}{trend.change}% vs previous
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EngagementTab({ engagementMetrics }: any) {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '20px' }}>User Engagement Analysis</h2>
      <p style={{ color: '#94a3b8', marginBottom: '24px' }}>Understand how users interact with content</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <StatCard title="Avg Pauses/Session" value={engagementMetrics.avgPausesPerSession} icon="⏸️" color="#f59e0b" />
        <StatCard title="Avg Seeks/Session" value={engagementMetrics.avgSeeksPerSession} icon="⏩" color="#3b82f6" />
        <StatCard title="Peak Hour" value={`${engagementMetrics.peakHour}:00`} icon="🕐" color="#ec4899" />
        <StatCard title="Peak Hour Views" value={engagementMetrics.peakHourCount} icon="📈" color="#10b981" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Completion Distribution */}
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>Completion Distribution</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(engagementMetrics.completionDistribution).map(([range, count]: [string, any]) => {
              const total = Object.values(engagementMetrics.completionDistribution).reduce((a: number, b: unknown) => a + (b as number), 0);
              const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
              const colors: Record<string, string> = {
                '0-25%': '#ef4444',
                '25-50%': '#f59e0b',
                '50-75%': '#3b82f6',
                '75-100%': '#10b981',
              };
              return (
                <div key={range}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ color: '#f8fafc' }}>{range}</span>
                    <span style={{ color: '#94a3b8' }}>{count} ({percentage}%)</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${percentage}%`, background: colors[range], borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hourly Activity */}
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>Hourly Activity</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '120px' }}>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = engagementMetrics.hourCounts[hour] || 0;
              const maxCount = Math.max(...Object.values(engagementMetrics.hourCounts) as number[], 1);
              const heightPx = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 4 : 0) : 0;
              return (
                <div key={hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div
                    style={{
                      width: '100%',
                      height: `${heightPx}px`,
                      background: hour === engagementMetrics.peakHour ? '#ec4899' : 'linear-gradient(180deg, #7877c6, #a855f7)',
                      borderRadius: '2px 2px 0 0',
                    }}
                    title={`${hour}:00 - ${count} sessions`}
                  />
                  {hour % 4 === 0 && <span style={{ fontSize: '9px', color: '#64748b', marginTop: '4px' }}>{hour}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrafficTab({ trafficSources }: any) {
  if (!trafficSources) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌐</div>
        <h3 style={{ color: '#f8fafc', margin: '0 0 8px 0' }}>Traffic Sources</h3>
        <p>Loading traffic source data...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '20px' }}>Traffic Source Analytics</h2>
      <p style={{ color: '#94a3b8', marginBottom: '24px' }}>Server-side traffic tracking including bots, referrers, and source types</p>
      
      {/* Traffic Overview Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <StatCard title="Total Hits" value={trafficSources.totals?.total_hits || 0} icon="📊" color="#7877c6" />
        <StatCard title="Human Hits" value={trafficSources.totals?.human_hits || 0} icon="👤" color="#10b981" />
        <StatCard title="Bot Hits" value={trafficSources.totals?.bot_hits || 0} icon="🤖" color="#ef4444" />
        <StatCard title="Unique Visitors" value={trafficSources.totals?.unique_visitors || 0} icon="👥" color="#3b82f6" />
      </div>

      {/* Top Referrers */}
      {trafficSources.topReferrers && trafficSources.topReferrers.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🔗 Top Referring Domains</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            {trafficSources.topReferrers.slice(0, 8).map((ref: any, idx: number) => (
              <div key={ref.referrer_domain || idx} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>#{idx + 1}</span>
                  <span style={{ color: '#f8fafc' }}>{ref.referrer_domain || 'Direct'}</span>
                </div>
                <span style={{ color: '#7877c6', fontWeight: '600' }}>{parseInt(ref.hit_count).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Geographic Tab Component
function GeographicTab({ topCountries, topCities, realtimeGeographic, deviceBreakdown }: any) {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '20px' }}>Geographic Analytics</h2>
      <p style={{ color: '#94a3b8', marginBottom: '24px' }}>User distribution by location and device</p>

      {/* Real-time Geographic */}
      {realtimeGeographic && realtimeGeographic.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🟢 Currently Active Users by Country</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {realtimeGeographic.slice(0, 12).map((country: any) => {
              const total = realtimeGeographic.reduce((sum: number, c: any) => sum + c.count, 0);
              const percentage = total > 0 ? Math.round((country.count / total) * 100) : 0;
              return (
                <div key={country.country} style={{
                  padding: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: '500' }}>{country.countryName || country.country}</div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>{percentage}% of active</div>
                  </div>
                  <div style={{ 
                    color: '#22c55e', 
                    fontWeight: '700', 
                    fontSize: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span style={{ 
                      width: '8px', 
                      height: '8px', 
                      borderRadius: '50%', 
                      background: '#22c55e',
                      animation: 'pulse 2s infinite'
                    }} />
                    {country.count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Countries (Historical) */}
      {topCountries && topCountries.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🌍 Top Countries (Last 7 Days)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {topCountries.slice(0, 10).map((country: any, index: number) => {
              const maxCount = topCountries[0]?.count || 1;
              const percentage = Math.round((country.count / maxCount) * 100);
              return (
                <div key={country.country} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: '#64748b', fontSize: '14px', width: '24px' }}>#{index + 1}</span>
                  <span style={{ color: '#f8fafc', width: '150px' }}>{country.countryName || country.country}</span>
                  <div style={{ flex: 1, height: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${percentage}%`,
                      background: 'linear-gradient(90deg, #7877c6, #a855f7)',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: '8px'
                    }}>
                      {percentage > 20 && <span style={{ color: 'white', fontSize: '12px', fontWeight: '600' }}>{country.count}</span>}
                    </div>
                  </div>
                  {percentage <= 20 && <span style={{ color: '#7877c6', fontWeight: '600', width: '60px', textAlign: 'right' }}>{country.count}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Cities */}
      {topCities && topCities.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>🏙️ Top Cities</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {topCities.slice(0, 15).map((city: any) => (
              <div key={`${city.city}-${city.country}`} style={{
                padding: '12px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ color: '#f8fafc', fontWeight: '500' }}>{city.city}</div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>{city.countryName || city.country}</div>
                </div>
                <span style={{ color: '#7877c6', fontWeight: '600' }}>{city.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device Breakdown */}
      {deviceBreakdown && deviceBreakdown.length > 0 && (
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '24px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>📱 Device Distribution</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            {deviceBreakdown.map((device: any) => {
              const total = deviceBreakdown.reduce((sum: number, d: any) => sum + d.count, 0);
              const percentage = total > 0 ? Math.round((device.count / total) * 100) : 0;
              const deviceIcons: Record<string, string> = {
                desktop: '🖥️',
                mobile: '📱',
                tablet: '📲',
                tv: '📺',
                unknown: '❓'
              };
              const deviceColors: Record<string, string> = {
                desktop: '#3b82f6',
                mobile: '#10b981',
                tablet: '#f59e0b',
                tv: '#ec4899',
                unknown: '#64748b'
              };
              return (
                <div key={device.device} style={{
                  padding: '20px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '12px',
                  textAlign: 'center',
                  borderTop: `3px solid ${deviceColors[device.device] || '#7877c6'}`
                }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>{deviceIcons[device.device] || '📱'}</div>
                  <div style={{ color: '#f8fafc', fontWeight: '600', textTransform: 'capitalize', marginBottom: '4px' }}>{device.device}</div>
                  <div style={{ color: '#7877c6', fontSize: '28px', fontWeight: '700' }}>{device.count}</div>
                  <div style={{ color: '#64748b', fontSize: '13px' }}>{percentage}% of users</div>
                  <div style={{ 
                    marginTop: '12px', 
                    height: '6px', 
                    background: 'rgba(255,255,255,0.1)', 
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${percentage}%`,
                      background: deviceColors[device.device] || '#7877c6',
                      borderRadius: '3px'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Export Tab Component
function ExportTab() {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '20px' }}>Data Export</h2>
      <p style={{ color: '#94a3b8', marginBottom: '24px' }}>Export analytics data in various formats for reporting and analysis</p>
      
      <DataExportPanel />
    </div>
  );
}

function StatCard({ title, value, icon, color, pulse = false }: {
  title: string;
  value: string | number;
  icon: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderTop: `3px solid ${color}`,
      borderRadius: '16px',
      padding: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }}>
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '12px',
        background: `${color}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '20px',
        position: 'relative'
      }}>
        {icon}
        {pulse && (
          <div style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            animation: 'pulse 2s infinite'
          }} />
        )}
      </div>
      <div>
        <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '14px', fontWeight: '500' }}>{title}</h3>
        <p style={{ margin: '4px 0 0 0', color: '#f8fafc', fontSize: '24px', fontWeight: '700' }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

const thStyle = {
  padding: '12px 16px',
  textAlign: 'left' as const,
  color: '#94a3b8',
  fontSize: '13px',
  fontWeight: '600',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
};

const tdStyle = {
  padding: '12px 16px',
  color: '#f8fafc',
  fontSize: '14px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
};