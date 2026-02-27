/**
 * Live TV Session Analytics API
 * Tracks live TV viewing sessions for analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLocationFromHeaders } from '@/app/lib/utils/geolocation';

export const dynamic = 'force-dynamic';

interface LiveTVSession {
  sessionId: string;
  userId: string;
  channelId: string;
  channelName: string;
  category?: string;
  country?: string;
  action: 'start' | 'stop' | 'heartbeat' | 'error' | 'buffer';
  watchDuration: number;
  bufferCount: number;
  errorMessage?: string;
  quality?: string;
  startedAt: number;
  lastUpdated: number;
}

// In-memory store for live TV sessions (in production, use Redis or database)
const liveTVSessions = new Map<string, LiveTVSession>();

// Store historical session data for analytics
const sessionHistory: Array<{
  sessionId: string;
  userId: string;
  channelId: string;
  channelName: string;
  category?: string;
  country?: string;
  totalWatchDuration: number;
  bufferCount: number;
  quality?: string;
  startedAt: number;
  endedAt: number;
}> = [];

// Keep only last 1000 sessions in memory
const MAX_HISTORY = 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      sessionId,
      userId,
      channelId,
      channelName,
      category,
      action,
      watchDuration = 0,
      bufferCount = 0,
      errorMessage,
      quality,
    } = body;

    // Get geo data from Cloudflare headers using utility
    const locationData = getLocationFromHeaders(request);
    const country = locationData.countryCode;
    const city = locationData.city;
    const region = locationData.region;

    if (!channelId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: channelId, action' },
        { status: 400 }
      );
    }

    const key = `${userId || 'anonymous'}_${channelId}`;
    const now = Date.now();
    
    if (action === 'start') {
      // Create new session
      const session: LiveTVSession = {
        sessionId: sessionId || `ltv_${now}_${Math.random().toString(36).substr(2, 9)}`,
        userId: userId || 'anonymous',
        channelId,
        channelName: channelName || 'Unknown Channel',
        category,
        country: country !== 'XX' ? country : 'Unknown',
        action,
        watchDuration: 0,
        bufferCount: 0,
        quality,
        startedAt: now,
        lastUpdated: now,
      };
      liveTVSessions.set(key, session);
      
      console.log('[LiveTV Analytics] Session started:', {
        channelName,
        category,
        country,
        city,
        region,
        userId: userId?.substring(0, 8),
      });
    } else if (action === 'heartbeat') {
      // Update existing session
      const existing = liveTVSessions.get(key);
      if (existing) {
        existing.watchDuration = watchDuration;
        existing.bufferCount = bufferCount;
        existing.lastUpdated = now;
        if (quality) existing.quality = quality;
        liveTVSessions.set(key, existing);
      }
    } else if (action === 'stop') {
      // End session and move to history
      const existing = liveTVSessions.get(key);
      if (existing) {
        // Add to history
        sessionHistory.push({
          sessionId: existing.sessionId,
          userId: existing.userId,
          channelId: existing.channelId,
          channelName: existing.channelName,
          category: existing.category,
          country: existing.country,
          totalWatchDuration: watchDuration || existing.watchDuration,
          bufferCount: bufferCount || existing.bufferCount,
          quality: quality || existing.quality,
          startedAt: existing.startedAt,
          endedAt: now,
        });
        
        // Trim history if needed
        if (sessionHistory.length > MAX_HISTORY) {
          sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);
        }
        
        console.log('[LiveTV Analytics] Session ended:', {
          channelName: existing.channelName,
          watchDuration: `${watchDuration || existing.watchDuration}s`,
          bufferCount: bufferCount || existing.bufferCount,
          userId: userId?.substring(0, 8),
        });
      }
      liveTVSessions.delete(key);
    } else if (action === 'error') {
      console.log('[LiveTV Analytics] Error:', {
        channelId,
        channelName,
        errorMessage,
        userId: userId?.substring(0, 8),
      });
    }

    return NextResponse.json({
      success: true,
      sessionId: liveTVSessions.get(key)?.sessionId,
    });
  } catch (error) {
    console.error('[LiveTV Analytics] Error:', error);
    return NextResponse.json(
      { error: 'Failed to track live TV session' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get('history') === 'true';
    const timeRange = parseInt(searchParams.get('range') || '3600') * 1000; // Default 1 hour
    
    // Get current active sessions
    const sessions = Array.from(liveTVSessions.values());
    const now = Date.now();
    
    // Filter out stale sessions (no update in last 2 minutes)
    const activeSessions = sessions.filter(s => now - s.lastUpdated < 120000);
    
    // Group by channel
    const channelStats = activeSessions.reduce((acc, session) => {
      const key = session.channelId;
      if (!acc[key]) {
        acc[key] = {
          channelId: session.channelId,
          channelName: session.channelName,
          category: session.category,
          viewerCount: 0,
          totalWatchTime: 0,
        };
      }
      acc[key].viewerCount++;
      acc[key].totalWatchTime += session.watchDuration;
      return acc;
    }, {} as Record<string, any>);

    // Group by category
    const categoryStats = activeSessions.reduce((acc, session) => {
      const key = session.category || 'Unknown';
      if (!acc[key]) {
        acc[key] = { category: key, viewerCount: 0 };
      }
      acc[key].viewerCount++;
      return acc;
    }, {} as Record<string, any>);

    // Calculate total watch time from history (within time range)
    const recentHistory = sessionHistory.filter(s => now - s.endedAt < timeRange);
    const totalHistoricalWatchTime = recentHistory.reduce((sum, s) => sum + s.totalWatchDuration, 0);
    const avgSessionDuration = recentHistory.length > 0 
      ? Math.round(totalHistoricalWatchTime / recentHistory.length) 
      : 0;

    const response: any = {
      success: true,
      currentViewers: activeSessions.length,
      channels: Object.values(channelStats).sort((a: any, b: any) => b.viewerCount - a.viewerCount),
      categories: Object.values(categoryStats).sort((a: any, b: any) => b.viewerCount - a.viewerCount),
      stats: {
        totalCurrentWatchTime: activeSessions.reduce((sum, s) => sum + s.watchDuration, 0),
        totalBufferEvents: activeSessions.reduce((sum, s) => sum + s.bufferCount, 0),
        recentSessions: recentHistory.length,
        avgSessionDuration,
        totalHistoricalWatchTime,
      },
      timestamp: now,
    };

    if (includeHistory) {
      response.recentHistory = recentHistory.slice(-50).reverse();
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[LiveTV Analytics] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get live TV stats' },
      { status: 500 }
    );
  }
}
