/**
 * Analytics Service
 * Enhanced analytics with anonymized user tracking
 */

import { userTrackingService, type UserSession } from './user-tracking';
import { getAnalyticsEndpoint } from '@/lib/utils/analytics-endpoints';

export interface AnalyticsEvent {
  id: string;
  type: string;
  userId: string;
  sessionId: string;
  deviceId: string;
  timestamp: number;
  data?: Record<string, any>;
  metadata: Record<string, any>;
}

export interface PageViewEvent {
  page: string;
  referrer?: string;
  loadTime?: number;
}

export interface WatchEvent {
  contentId: string;
  contentType: 'movie' | 'tv';
  contentTitle?: string;
  action: 'start' | 'pause' | 'resume' | 'complete' | 'progress';
  currentTime: number;
  duration: number;
  quality?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface SearchEvent {
  query: string;
  resultsCount: number;
  selectedResult?: string;
  filters?: Record<string, any>;
}

export interface InteractionEvent {
  element: string;
  action: 'click' | 'hover' | 'scroll' | 'focus';
  context?: Record<string, any>;
}

class AnalyticsService {
  private userSession: UserSession | null = null;
  private eventQueue: AnalyticsEvent[] = [];
  private isInitialized = false;
  // liveActivityInterval removed - PresenceProvider handles live activity now
  private watchTimeSyncInterval: NodeJS.Timeout | null = null;
  private liveTVSessionInterval: NodeJS.Timeout | null = null;
  private pageTrackingInterval: NodeJS.Timeout | null = null;
  private currentActivity: {
    type: string;
    contentId?: string;
    contentTitle?: string;
    contentType?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    currentPosition?: number;
    duration?: number;
    quality?: string;
    channelId?: string;
    channelName?: string;
    category?: string;
  } | null = null;
  
  // Page-level tracking
  private currentPageView: {
    id: string;
    path: string;
    title: string;
    entryTime: number;
    scrollDepth: number;
    maxScrollDepth: number;
    interactions: number;
    referrer: string;
    isFirstPage: boolean;
  } | null = null;
  
  private sessionPageCount: number = 0;
  
  // Watch time tracking
  private watchTimeAccumulator: Map<string, {
    contentId: string;
    contentType: string;
    contentTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    totalWatchTime: number;
    lastPosition: number;
    duration: number;
    startedAt: number;
    lastSyncedAt: number;
    pauseCount: number;
    seekCount: number;
    quality?: string;
  }> = new Map();
  
  // Live TV session tracking
  private liveTVSession: {
    channelId: string;
    channelName: string;
    category?: string;
    country?: string;
    startedAt: number;
    lastHeartbeat: number;
    totalWatchTime: number;
    bufferCount: number;
    quality?: string;
  } | null = null;

  /**
   * Check if current page should be tracked
   */
  private shouldTrackPage(): boolean {
    const path = window.location.pathname;
    // Exclude admin pages from live activity tracking
    return !path.startsWith('/admin');
  }

  /**
   * Track page view locally without sending network request
   * Network syncing is handled by UnifiedAnalyticsClient
   */
  private trackPageViewLocal(path: string): void {
    this.sessionPageCount++;
    this.currentPageView = {
      id: `pv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      path,
      title: document.title,
      entryTime: Date.now(),
      scrollDepth: 0,
      maxScrollDepth: 0,
      interactions: 0,
      referrer: document.referrer,
      isFirstPage: this.sessionPageCount === 1,
    };
    
    if (!this.currentActivity || this.currentActivity.type !== 'watching') {
      this.currentActivity = { type: 'browsing' };
    }
  }

  /**
   * Initialize analytics service
   */
  initialize(): void {
    if (this.isInitialized) return;
    
    this.userSession = userTrackingService.initialize();
    this.isInitialized = true;
    
    // Track page load locally (no network call - UnifiedAnalyticsClient handles page view syncing)
    this.trackPageViewLocal(window.location.pathname);
    this.trackSessionStart();
    
    // NOTE: Event flushing is now handled by UnifiedAnalyticsClient's 60s batch sync.
    // We still collect events locally for the AnalyticsProvider context API,
    // but don't flush them independently to avoid duplicate CF Worker requests.
    
    // NOTE: Live activity heartbeat is now handled by PresenceProvider/UnifiedAnalyticsClient
    if (this.shouldTrackPage()) {
      this.startWatchTimeSyncInterval();
      // Page tracking no longer sends periodic requests - only on exit
    } else {
      console.log('[Analytics] Skipping tracking for admin page');
    }
    
    // Track scroll depth (local only, no network)
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
      document.addEventListener('click', this.handleInteraction.bind(this));
      document.addEventListener('keydown', this.handleInteraction.bind(this));
    }
    
    // Track page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Sync watch time on hide (user leaving tab)
        this.syncAllWatchTime();
        this.stopPageTracking();
        this.endLiveTVSession();
      }
      // No periodic interval to restart on visible - UnifiedAnalyticsClient handles periodic sync
    });
    
    // Track before page unload - sync watch data only
    window.addEventListener('beforeunload', () => {
      this.syncAllWatchTime();
      this.endLiveTVSession();
    });
    
    // SPA page navigation tracking removed - UnifiedAnalyticsClient handles this via PresenceProvider
  }
  
  /**
   * Track session start for bounce rate calculation
   */
  private trackSessionStart(): void {
    if (!this.userSession) return;
    
    this.track('session_start', {
      entryPage: window.location.pathname,
      referrer: document.referrer,
      timestamp: Date.now(),
    });
    
    // Store session start time
    try {
      sessionStorage.setItem('flyx_session_start', Date.now().toString());
      sessionStorage.setItem('flyx_page_views', '1');
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Track a generic event
   * NOTE: Events are stored locally for context API consumers only.
   * Network syncing is handled by UnifiedAnalyticsClient's 60s batch.
   * The event queue is capped to prevent memory leaks.
   */
  track(eventType: string, data?: Record<string, any>): void {
    if (!this.isInitialized) {
      this.initialize();
    }

    const event: AnalyticsEvent = {
      id: this.generateEventId(),
      type: eventType,
      userId: this.userSession?.userId || 'anonymous',
      sessionId: this.userSession?.sessionId || 'unknown',
      deviceId: this.userSession?.deviceId || 'unknown',
      timestamp: Date.now(),
      data: data || {},
      metadata: userTrackingService.getAnalyticsMetadata(),
    };

    // Cap event queue to prevent memory leaks (events are local-only now)
    if (this.eventQueue.length >= 50) {
      this.eventQueue = this.eventQueue.slice(-25);
    }
    this.eventQueue.push(event);
    userTrackingService.updateLastActivity();
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Analytics Event:', event);
    }
    
    // NOTE: No longer calling scheduleFlush() - UnifiedAnalyticsClient handles network syncing
  }

  /**
   * Track page view
   */
  trackPageView(path: string, data?: PageViewEvent): void {
    // Previous page view sync handled by UnifiedAnalyticsClient's batch
    
    this.track('page_view', {
      page: path,
      referrer: document.referrer,
      loadTime: performance.now(),
      ...data,
    });
    
    // Increment page view count for bounce rate calculation
    try {
      const currentViews = parseInt(sessionStorage.getItem('flyx_page_views') || '0');
      sessionStorage.setItem('flyx_page_views', (currentViews + 1).toString());
    } catch (e) {
      // Ignore storage errors
    }
    
    // Start tracking this page
    this.sessionPageCount++;
    this.currentPageView = {
      id: `pv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      path,
      title: document.title,
      entryTime: Date.now(),
      scrollDepth: 0,
      maxScrollDepth: 0,
      interactions: 0,
      referrer: document.referrer,
      isFirstPage: this.sessionPageCount === 1,
    };
    
    // Update current activity to browsing when not watching
    if (!this.currentActivity || this.currentActivity.type !== 'watching') {
      this.currentActivity = { type: 'browsing' };
    }
  }
  
  /**
   * Handle scroll events for depth tracking
   */
  private handleScroll(): void {
    if (!this.currentPageView) return;
    
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercentage = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    
    this.currentPageView.scrollDepth = scrollPercentage;
    if (scrollPercentage > this.currentPageView.maxScrollDepth) {
      this.currentPageView.maxScrollDepth = scrollPercentage;
    }
  }
  
  /**
   * Handle user interactions
   */
  private handleInteraction(): void {
    if (!this.currentPageView) return;
    this.currentPageView.interactions++;
  }
  
  /**
   * Stop page tracking
   */
  private stopPageTracking(): void {
    if (this.pageTrackingInterval) {
      clearInterval(this.pageTrackingInterval);
      this.pageTrackingInterval = null;
    }
  }

  /**
   * Track watch events
   * OPTIMIZED: Only triggers network sync on meaningful events (start/pause/complete).
   * Progress events only update local state - UnifiedAnalyticsClient handles periodic sync.
   */
  trackWatchEvent(event: WatchEvent): void {
    // Only save to localStorage + trigger sync on meaningful events
    if (event.action === 'pause' || event.action === 'complete') {
      userTrackingService.updateWatchProgress({
        contentId: event.contentId,
        contentType: event.contentType,
        seasonNumber: event.seasonNumber,
        episodeNumber: event.episodeNumber,
        currentTime: event.currentTime,
        duration: event.duration,
        completionPercentage: Math.round((event.currentTime / event.duration) * 100),
        lastWatched: Date.now(),
        completed: event.action === 'complete',
      });
    }
    
    // Track detailed watch session (only syncs to CF Worker on start/pause/complete)
    this.updateWatchSession(event);
  }

  /**
   * Update watch session with detailed tracking
   */
  private updateWatchSession(event: WatchEvent): void {
    if (!this.userSession) return;

    const sessionKey = `watch_session_${event.contentId}_${event.seasonNumber || 0}_${event.episodeNumber || 0}`;
    
    // Get or create watch session data
    let sessionData = this.getSessionData(sessionKey);
    
    if (!sessionData) {
      sessionData = {
        id: `ws_${this.userSession.userId}_${event.contentId}_${Date.now()}`,
        startedAt: Date.now(),
        totalWatchTime: 0,
        pauseCount: 0,
        seekCount: 0,
        lastUpdateTime: Date.now(),
        lastPosition: 0,
        lastSyncTime: 0,
      };
    }

    // Update session data based on action
    const now = Date.now();
    const timeSinceLastUpdate = (now - sessionData.lastUpdateTime) / 1000;
    
    switch (event.action) {
      case 'start':
        sessionData.startedAt = now;
        sessionData.lastPosition = event.currentTime;
        // Sync immediately on start
        this.syncWatchSession(event, sessionData);
        break;
        
      case 'pause':
        sessionData.pauseCount++;
        if (timeSinceLastUpdate > 0 && timeSinceLastUpdate < 10) {
          sessionData.totalWatchTime += timeSinceLastUpdate;
        }
        sessionData.lastPosition = event.currentTime;
        // Sync on pause to capture accurate watch time
        this.syncWatchSession(event, sessionData);
        break;
        
      case 'resume':
        sessionData.lastPosition = event.currentTime;
        break;
        
      case 'progress':
        // Track seek events (position jumped significantly)
        const positionDelta = Math.abs(event.currentTime - sessionData.lastPosition);
        if (positionDelta > 10) {
          sessionData.seekCount++;
          // Sync on seek (user explicitly changed position)
          sessionData.lastPosition = event.currentTime;
          this.syncWatchSession(event, sessionData);
          sessionData.lastSyncTime = now;
        } else if (timeSinceLastUpdate > 0 && timeSinceLastUpdate < 10) {
          // Only add watch time if reasonable interval
          sessionData.totalWatchTime += timeSinceLastUpdate;
          sessionData.lastPosition = event.currentTime;
        }
        // No periodic sync on progress - UnifiedAnalyticsClient handles this
        break;
        
      case 'complete':
        if (timeSinceLastUpdate > 0 && timeSinceLastUpdate < 10) {
          sessionData.totalWatchTime += timeSinceLastUpdate;
        }
        sessionData.lastPosition = event.currentTime;
        sessionData.endedAt = now;
        // Always sync on complete
        this.syncWatchSession(event, sessionData);
        break;
    }

    sessionData.lastUpdateTime = now;
    this.setSessionData(sessionKey, sessionData);
  }

  /**
   * Sync watch session to server
   */
  private async syncWatchSession(event: WatchEvent, sessionData: any): Promise<void> {
    try {
      const completionPercentage = event.duration > 0 
        ? Math.round((event.currentTime / event.duration) * 100) 
        : 0;

      await fetch(getAnalyticsEndpoint('watch-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sessionData.id,
          sessionId: this.userSession?.sessionId,
          userId: this.userSession?.userId,
          contentId: event.contentId,
          contentType: event.contentType,
          contentTitle: event.contentTitle,
          seasonNumber: event.seasonNumber,
          episodeNumber: event.episodeNumber,
          startedAt: sessionData.startedAt,
          endedAt: sessionData.endedAt,
          totalWatchTime: Math.round(sessionData.totalWatchTime),
          lastPosition: Math.round(event.currentTime),
          duration: Math.round(event.duration),
          completionPercentage,
          quality: event.quality,
          isCompleted: event.action === 'complete' || completionPercentage >= 90,
          pauseCount: sessionData.pauseCount,
          seekCount: sessionData.seekCount,
        }),
      });
    } catch (error) {
      console.error('Failed to sync watch session:', error);
    }
  }

  /**
   * Get session storage data
   */
  private getSessionData(key: string): any {
    try {
      const data = sessionStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set session storage data
   */
  private setSessionData(key: string, data: any): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save session data:', error);
    }
  }

  /**
   * Track search events
   */
  trackSearchEvent(event: SearchEvent): void {
    this.track('search_event', event);
  }

  /**
   * Track user interactions
   */
  trackInteraction(event: InteractionEvent): void {
    this.track('interaction', event);
  }

  /**
   * Track content engagement
   */
  trackContentEngagement(contentId: string, contentType: 'movie' | 'tv', action: string, data?: Record<string, any>): void {
    this.track('content_engagement', {
      contentId,
      contentType,
      action,
      ...data,
    });
  }

  /**
   * Track error events
   */
  trackError(error: Error, context?: Record<string, any>): void {
    this.track('error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      context,
    });
  }

  /**
   * Track performance metrics
   */
  trackPerformance(metric: string, value: number, context?: Record<string, any>): void {
    this.track('performance', {
      metric,
      value,
      context,
    });
  }

  /**
   * Schedule event flush - DISABLED
   * Network syncing is now handled by UnifiedAnalyticsClient's 60s batch.
   * Events are kept locally for the AnalyticsProvider context API only.
   */
  private scheduleFlush(): void {
    // No-op: UnifiedAnalyticsClient handles all network syncing
  }

  /**
   * Flush events - DISABLED
   * Kept as no-op for any remaining callers (e.g. clearUserData).
   */
  private async flushEvents(): Promise<void> {
    // No-op: UnifiedAnalyticsClient handles all network syncing
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current user session
   */
  getUserSession(): UserSession | null {
    return this.userSession;
  }

  /**
   * Update user preferences
   */
  updateUserPreferences(preferences: Partial<any>): void {
    userTrackingService.updatePreferences(preferences);
    this.track('preferences_updated', preferences);
  }

  /**
   * Clear user data (for privacy)
   */
  clearUserData(): void {
    userTrackingService.clearUserData();
    this.track('user_data_cleared');
    this.flushEvents();
  }

  /**
   * Update current activity
   * NOTE: This no longer sends heartbeats - PresenceProvider handles live activity tracking
   * This method is kept for internal state tracking only
   */
  updateActivity(activity: {
    type: 'browsing' | 'watching' | 'livetv';
    contentId?: string;
    contentTitle?: string;
    contentType?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    currentPosition?: number;
    duration?: number;
    quality?: string;
    channelId?: string;
    channelName?: string;
    category?: string;
  }): void {
    this.currentActivity = activity;
    // Don't call sendLiveActivityHeartbeat() - PresenceProvider handles this
  }

  // NOTE: Live activity heartbeat functions removed - PresenceProvider handles this now

  /**
   * Start watch time sync interval - DISABLED
   * Watch time is now synced via UnifiedAnalyticsClient's 60s batch.
   * Direct syncs only happen on pause/seek/complete/exit.
   */
  private startWatchTimeSyncInterval(): void {
    // No-op: UnifiedAnalyticsClient handles periodic watch progress sync
  }

  /**
   * Stop watch time sync interval
   */
  stopWatchTimeSyncInterval(): void {
    if (this.watchTimeSyncInterval) {
      clearInterval(this.watchTimeSyncInterval);
      this.watchTimeSyncInterval = null;
    }
  }

  /**
   * Update watch time for content
   */
  updateWatchTime(data: {
    contentId: string;
    contentType: 'movie' | 'tv';
    contentTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    currentPosition: number;
    duration: number;
    quality?: string;
    isPlaying: boolean;
  }): void {
    const key = `${data.contentId}_${data.seasonNumber || 0}_${data.episodeNumber || 0}`;
    const now = Date.now();
    
    let session = this.watchTimeAccumulator.get(key);
    
    if (!session) {
      session = {
        contentId: data.contentId,
        contentType: data.contentType,
        contentTitle: data.contentTitle,
        seasonNumber: data.seasonNumber,
        episodeNumber: data.episodeNumber,
        totalWatchTime: 0,
        lastPosition: data.currentPosition,
        duration: data.duration,
        startedAt: now,
        lastSyncedAt: now,
        pauseCount: 0,
        seekCount: 0,
        quality: data.quality,
      };
      this.watchTimeAccumulator.set(key, session);
      
      // Track session start in user activity
      this.trackUserActivity('session_start', data.contentId);
    }
    
    // Calculate time delta (only if playing)
    if (data.isPlaying) {
      const timeDelta = (now - session.lastSyncedAt) / 1000;
      // Only add if reasonable (between 0.5 and 10 seconds to avoid counting pauses/seeks)
      if (timeDelta >= 0.5 && timeDelta <= 10) {
        session.totalWatchTime += timeDelta;
      }
    }
    
    // Detect seek (position jumped more than 10 seconds)
    const positionDelta = Math.abs(data.currentPosition - session.lastPosition);
    if (positionDelta > 10 && data.isPlaying) {
      session.seekCount++;
    }
    
    session.lastPosition = data.currentPosition;
    session.lastSyncedAt = now;
    session.duration = data.duration;
    if (data.quality) session.quality = data.quality;
    
    // Update live activity with current position
    if (data.isPlaying) {
      this.currentActivity = {
        type: 'watching',
        contentId: data.contentId,
        contentTitle: data.contentTitle,
        contentType: data.contentType,
        seasonNumber: data.seasonNumber,
        episodeNumber: data.episodeNumber,
        currentPosition: Math.round(data.currentPosition),
        duration: Math.round(data.duration),
        quality: data.quality,
      };
    }
  }
  
  /**
   * Track user activity locally
   * NOTE: No longer sends independent network requests - UnifiedAnalyticsClient handles this
   */
  private async trackUserActivity(action: string, contentId?: string): Promise<void> {
    // Local tracking only - no network call
    // UnifiedAnalyticsClient's 60s batch sync handles presence/activity reporting
    if (process.env.NODE_ENV === 'development') {
      console.log('[Analytics] User activity (local):', { action, contentId });
    }
  }

  /**
   * Record pause event
   */
  recordPause(contentId: string, seasonNumber?: number, episodeNumber?: number): void {
    const key = `${contentId}_${seasonNumber || 0}_${episodeNumber || 0}`;
    const session = this.watchTimeAccumulator.get(key);
    if (session) {
      session.pauseCount++;
    }
  }

  /**
   * Sync all accumulated watch time to server
   * Also cleans up stale entries older than 24 hours
   */
  private async syncAllWatchTime(): Promise<void> {
    if (this.watchTimeAccumulator.size === 0) return;
    
    const sessions = Array.from(this.watchTimeAccumulator.entries());
    const now = Date.now();
    const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, session] of sessions) {
      // Clean up stale entries (older than 24h with no updates)
      if (now - session.lastSyncedAt > STALE_THRESHOLD) {
        this.watchTimeAccumulator.delete(key);
        continue;
      }
      
      // Only sync if there's meaningful watch time (at least 3 seconds)
      if (session.totalWatchTime < 3) continue;
      
      try {
        const completionPercentage = session.duration > 0 
          ? Math.round((session.lastPosition / session.duration) * 100) 
          : 0;
        
        const isCompleted = completionPercentage >= 90;

        await fetch(getAnalyticsEndpoint('watch-session'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `ws_${this.userSession?.userId}_${key}_${session.startedAt}`,
            sessionId: this.userSession?.sessionId,
            userId: this.userSession?.userId,
            contentId: session.contentId,
            contentType: session.contentType,
            contentTitle: session.contentTitle,
            seasonNumber: session.seasonNumber,
            episodeNumber: session.episodeNumber,
            startedAt: session.startedAt,
            endedAt: isCompleted ? now : undefined,
            totalWatchTime: Math.round(session.totalWatchTime),
            lastPosition: Math.round(session.lastPosition),
            duration: Math.round(session.duration),
            completionPercentage,
            quality: session.quality,
            isCompleted,
            pauseCount: session.pauseCount,
            seekCount: session.seekCount,
          }),
          keepalive: true,
        });
        
        // NOTE: updateUserActivityWithWatchTime removed - UnifiedAnalyticsClient handles user metrics
        
        // Clean up completed sessions
        if (isCompleted) {
          this.watchTimeAccumulator.delete(key);
        }
      } catch (error) {
        console.error('[Analytics] Failed to sync watch time:', error);
      }
    }
  }
  
  // updateUserActivityWithWatchTime removed - UnifiedAnalyticsClient handles user metrics via batch sync

  /**
   * Clear watch time for content (on completion or navigation away)
   */
  clearWatchTime(contentId: string, seasonNumber?: number, episodeNumber?: number): void {
    const key = `${contentId}_${seasonNumber || 0}_${episodeNumber || 0}`;
    this.watchTimeAccumulator.delete(key);
  }

  /**
   * Start Live TV session
   */
  startLiveTVSession(data: {
    channelId: string;
    channelName: string;
    category?: string;
    country?: string;
    quality?: string;
  }): void {
    const now = Date.now();
    
    // End any existing session first
    if (this.liveTVSession) {
      this.endLiveTVSession();
    }
    
    this.liveTVSession = {
      channelId: data.channelId,
      channelName: data.channelName,
      category: data.category,
      country: data.country,
      startedAt: now,
      lastHeartbeat: now,
      totalWatchTime: 0,
      bufferCount: 0,
      quality: data.quality,
    };
    
    // Send start event
    this.sendLiveTVSessionUpdate('start');
    
    // Start heartbeat interval for Live TV
    if (this.liveTVSessionInterval) {
      clearInterval(this.liveTVSessionInterval);
    }
    this.liveTVSessionInterval = setInterval(() => {
      // Only send heartbeat when tab is visible
      if (document.visibilityState === 'visible') {
        this.updateLiveTVWatchTime();
        this.sendLiveTVSessionUpdate('heartbeat');
      }
    }, 60000); // Every 60 seconds (aligned with UnifiedAnalyticsClient sync interval)
    
    console.log('[Analytics] Started Live TV session:', data.channelName);
  }

  /**
   * Update Live TV watch time
   */
  private updateLiveTVWatchTime(): void {
    if (!this.liveTVSession) return;
    
    const now = Date.now();
    const timeDelta = (now - this.liveTVSession.lastHeartbeat) / 1000;
    
    // Only add if reasonable (less than 60 seconds to handle tab switches)
    if (timeDelta > 0 && timeDelta < 60) {
      this.liveTVSession.totalWatchTime += timeDelta;
    }
    
    this.liveTVSession.lastHeartbeat = now;
  }

  /**
   * Record Live TV buffer event
   */
  recordLiveTVBuffer(): void {
    if (this.liveTVSession) {
      this.liveTVSession.bufferCount++;
    }
  }

  /**
   * Update Live TV quality
   */
  updateLiveTVQuality(quality: string): void {
    if (this.liveTVSession) {
      this.liveTVSession.quality = quality;
    }
  }

  /**
   * End Live TV session
   */
  endLiveTVSession(): void {
    if (!this.liveTVSession) return;
    
    // Update final watch time
    this.updateLiveTVWatchTime();
    
    // Send stop event
    this.sendLiveTVSessionUpdate('stop');
    
    console.log('[Analytics] Ended Live TV session:', {
      channel: this.liveTVSession.channelName,
      watchTime: Math.round(this.liveTVSession.totalWatchTime),
      buffers: this.liveTVSession.bufferCount,
    });
    
    // Clear interval
    if (this.liveTVSessionInterval) {
      clearInterval(this.liveTVSessionInterval);
      this.liveTVSessionInterval = null;
    }
    
    this.liveTVSession = null;
  }

  /**
   * Send Live TV session update to server
   */
  private async sendLiveTVSessionUpdate(action: 'start' | 'stop' | 'heartbeat'): Promise<void> {
    if (!this.liveTVSession || !this.userSession) return;
    
    try {
      await fetch(getAnalyticsEndpoint('livetv-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.userSession.sessionId,
          userId: this.userSession.userId,
          channelId: this.liveTVSession.channelId,
          channelName: this.liveTVSession.channelName,
          category: this.liveTVSession.category,
          country: this.liveTVSession.country,
          action,
          watchDuration: Math.round(this.liveTVSession.totalWatchTime),
          quality: this.liveTVSession.quality,
          bufferCount: this.liveTVSession.bufferCount,
        }),
        keepalive: action === 'stop', // Use keepalive for stop to ensure it sends on page unload
      });
    } catch (error) {
      console.error('[Analytics] Failed to send Live TV session update:', error);
    }
  }

  /**
   * Get current Live TV session info
   */
  getLiveTVSession(): typeof this.liveTVSession {
    return this.liveTVSession;
  }
}

export const analyticsService = new AnalyticsService();

export class EventQueue {
  private queue: AnalyticsEvent[] = [];

  add(event: AnalyticsEvent): void {
    this.queue.push(event);
  }

  flush(): AnalyticsEvent[] {
    const events = [...this.queue];
    this.queue = [];
    return events;
  }

  size(): number {
    return this.queue.length;
  }
}

export const eventQueue = new EventQueue();