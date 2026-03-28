/**
 * LiveTV Data Hook - Refactored
 * Clean separation between Live Events and TV Channels
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export type Provider = 'dlhd' | 'cdnlive' | 'ppv';
export type ContentType = 'events' | 'channels';

export interface LiveEvent {
  id: string;
  title: string;
  sport?: string;
  league?: string;
  teams?: { home: string; away: string };
  time: string;
  isoTime?: string;
  isLive: boolean;
  source: Provider;
  poster?: string;
  viewers?: string;
  channels: Array<{
    name: string;
    channelId: string;
    href: string;
  }>;
  startsAt?: number;
  endsAt?: number;
  startsIn?: string; // Human-readable time until start
  viprowUrl?: string; // Legacy — unused
  ppvSlug?: string; // PPV.to poocloud stream slug
  ppvId?: number; // PPV.to stream ID
  alwaysLive?: boolean; // 24/7 streams
}

export interface TVChannel {
  id: string;
  name: string;
  category: string;
  country: string;
  countryName?: string;
  logo?: string;
  viewers?: number;
  source: Provider;
  channelId: string; // For playback
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface ProviderStats {
  dlhd: { events: number; channels: number; live: number };
  cdnlive: { channels: number };
  ppv: { events: number; live: number };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SPORT_ICONS: Record<string, string> = {
  'soccer': '⚽', 'football': '⚽', 'basketball': '🏀', 'tennis': '🎾',
  'cricket': '🏏', 'hockey': '🏒', 'baseball': '⚾', 'golf': '⛳',
  'rugby': '🏉', 'motorsport': '🏎️', 'f1': '🏎️', 'boxing': '🥊',
  'mma': '🥊', 'ufc': '🥊', 'wwe': '🤼', 'volleyball': '🏐',
  'am. football': '🏈', 'american-football': '🏈', 'nfl': '🏈', 
  'nba': '🏀', 'nhl': '🏒', 'ice-hockey': '🏒',
  'formula-1': '🏎️', 'moto-gp': '🏍️', 'nascar': '🏎️',
  'darts': '🎯', 'snooker': '🎱', 'cycling': '🚴', 'handball': '🤾',
  'aussie-rules': '🏉', 'other': '📺', 'others': '📺',
};

const CATEGORY_ICONS: Record<string, string> = {
  sports: '⚽',
  entertainment: '🎬',
  news: '📰',
  movies: '🎥',
  kids: '🧸',
  documentary: '🌍',
  music: '🎵',
  general: '📺',
};

// ============================================================================
// HELPERS
// ============================================================================

function getSportIcon(sport: string): string {
  const lower = sport.toLowerCase();
  for (const [key, icon] of Object.entries(SPORT_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📺';
}

function getCategoryIcon(category: string): string {
  return CATEGORY_ICONS[category.toLowerCase()] || '📺';
}

function formatLocalTime(isoTime?: string, fallbackTime?: string): string {
  if (isoTime) {
    try {
      const date = new Date(isoTime);
      if (!isNaN(date.getTime())) {
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }
    } catch {}
  }
  return fallbackTime || '';
}

function categorizeChannel(channelName: string): string {
  const nameLower = channelName.toLowerCase();
  const sportKeywords = [
    'sport', 'espn', 'fox sport', 'bein', 'dazn', 'arena', 'sky sport', 
    'canal sport', 'eleven', 'polsat sport', 'cosmote', 'nova sport', 
    'match', 'premier', 'football', 'soccer', 'nba', 'nfl', 'nhl', 
    'mlb', 'tennis', 'golf', 'f1', 'motorsport', 'cricket', 'astro'
  ];
  
  for (const keyword of sportKeywords) {
    if (nameLower.includes(keyword)) return 'sports';
  }
  if (nameLower.includes('news') || nameLower.includes('cnn') || nameLower.includes('bbc news')) {
    return 'news';
  }
  if (nameLower.includes('movie') || nameLower.includes('hbo') || nameLower.includes('cinema')) {
    return 'movies';
  }
  return 'entertainment';
}

// ============================================================================
// HOOK
// ============================================================================

export function useLiveTVData() {
  const [contentType, setContentType] = useState<ContentType>('events');
  const [selectedProvider, setSelectedProvider] = useState<Provider>('dlhd');
  const [searchQuery, setSearchQuery] = useState('');
  
  // DLHD State
  const [dlhdEvents, setDlhdEvents] = useState<LiveEvent[]>([]);
  const [dlhdChannels, setDlhdChannels] = useState<TVChannel[]>([]);
  const [dlhdLoading, setDlhdLoading] = useState(true);
  const [dlhdError, setDlhdError] = useState<string | null>(null);

  // CDN Live State - These are TV Channels, NOT events
  const [cdnChannels, setCdnChannels] = useState<TVChannel[]>([]);
  const [cdnLoading, setCdnLoading] = useState(true);
  const [cdnError, setCdnError] = useState<string | null>(null);

  // PPV.to State - Live Events
  const [ppvEvents, setPpvEvents] = useState<LiveEvent[]>([]);
  const [ppvLoading, setPpvLoading] = useState(true);
  const [ppvError, setPpvError] = useState<string | null>(null);

  // DLHD Fetcher
  const fetchDLHD = useCallback(async () => {
    setDlhdLoading(true);
    setDlhdError(null);
    
    try {
      // Fetch events and channels independently so one failure doesn't kill the other
      const [eventsResult, channelsResult] = await Promise.allSettled([
        fetch('/api/livetv/schedule').then(r => r.json()),
        fetch('/api/livetv/dlhd-channels').then(r => r.json()),
      ]);

      // Parse events
      const events: LiveEvent[] = [];
      if (eventsResult.status === 'fulfilled') {
        const eventsJson = eventsResult.value;
        if (eventsJson.success && eventsJson.schedule?.categories) {
          for (const category of eventsJson.schedule.categories) {
            for (const event of category.events || []) {
              events.push({
                id: `dlhd-${event.id}`,
                title: event.title,
                sport: event.sport,
                league: event.league,
                teams: event.teams,
                time: formatLocalTime(event.isoTime, event.time),
                isoTime: event.isoTime,
                isLive: event.isLive,
                source: 'dlhd',
                channels: event.channels || [],
              });
            }
          }
        }
      } else {
        console.error('[LiveTV] Schedule fetch failed:', eventsResult.reason);
      }

      // Parse channels
      const channels: TVChannel[] = [];
      if (channelsResult.status === 'fulfilled') {
        const channelsJson = channelsResult.value;
        if (channelsJson.success && channelsJson.channels) {
          for (const ch of channelsJson.channels) {
            channels.push({
              id: ch.id,
              name: ch.name,
              category: ch.category || 'general',
              country: ch.country || '',
              countryName: ch.countryInfo?.name,
              source: 'dlhd',
              channelId: ch.id,
            });
          }
        }
      } else {
        console.error('[LiveTV] Channels fetch failed:', channelsResult.reason);
      }
      
      setDlhdEvents(events);
      setDlhdChannels(channels);
      
      // Only set error if both failed
      if (eventsResult.status === 'rejected' && channelsResult.status === 'rejected') {
        setDlhdError('Failed to load DLHD data');
      }
    } catch (error) {
      setDlhdError(error instanceof Error ? error.message : 'Failed to load DLHD');
    } finally {
      setDlhdLoading(false);
    }
  }, []);

  // CDN Live Fetcher - These are TV CHANNELS, not events!
  const fetchCDNLive = useCallback(async () => {
    setCdnLoading(true);
    setCdnError(null);
    
    try {
      const response = await fetch('/api/livetv/cdn-live-channels');
      if (!response.ok) {
        console.warn('[LiveTV] CDN Live returned', response.status);
        setCdnChannels([]);
        return;
      }
      const data = await response.json();

      if (data.error) {
        console.warn('[LiveTV] CDN Live error:', data.error);
        setCdnChannels([]);
        return;
      }

      const rawChannels = data.channels || [];
      const onlineChannels = rawChannels.filter((c: any) => c.status === 'online');

      // These are TV CHANNELS - NOT live events!
      const channels: TVChannel[] = onlineChannels.map((channel: any) => ({
        id: `cdn-${channel.id || channel.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: channel.name,
        category: categorizeChannel(channel.name),
        country: channel.country || 'us',
        countryName: channel.country_name,
        logo: channel.logo,
        viewers: channel.viewers,
        source: 'cdnlive' as const,
        channelId: `${channel.name}|${channel.country}`,
      }));

      setCdnChannels(channels);
    } catch (error) {
      console.error('[LiveTV] CDN Live fetch error:', error);
      setCdnChannels([]);
      setCdnError(error instanceof Error ? error.message : 'Failed to load CDN Live');
    } finally {
      setCdnLoading(false);
    }
  }, []);

  // PPV.to Fetcher - Live Events from api.ppv.to
  const fetchPPV = useCallback(async () => {
    setPpvLoading(true);
    setPpvError(null);

    try {
      const response = await fetch('/api/livetv/ppv-streams');
      if (!response.ok) {
        console.warn('[LiveTV] PPV returned', response.status);
        setPpvEvents([]);
        return;
      }
      const data = await response.json();

      if (!data.success) {
        console.warn('[LiveTV] PPV not successful:', data.error);
        setPpvEvents([]);
        return;
      }

      const events: LiveEvent[] = (data.events || []).map((event: any) => ({
        id: event.id,
        title: event.title,
        sport: event.sport,
        league: event.league,
        time: event.time,
        isoTime: event.isoTime,
        isLive: event.isLive,
        source: 'ppv' as const,
        poster: event.poster,
        viewers: event.viewers,
        channels: [],
        startsIn: event.startsIn,
        ppvSlug: event.ppvSlug,
        ppvId: event.ppvId,
        alwaysLive: event.alwaysLive,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      }));

      setPpvEvents(events);
    } catch (error) {
      console.error('[LiveTV] PPV fetch error:', error);
      setPpvEvents([]);
      setPpvError(error instanceof Error ? error.message : 'Failed to load PPV');
    } finally {
      setPpvLoading(false);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    fetchDLHD();
    fetchCDNLive();
    fetchPPV();
  }, [fetchDLHD, fetchCDNLive, fetchPPV]);

  // All Events (DLHD + VIPRow)
  const allEvents = useMemo(() => {
    return [...dlhdEvents, ...ppvEvents];
  }, [dlhdEvents, ppvEvents]);

  // All Channels (DLHD + CDN Live)
  const allChannels = useMemo(() => {
    return [...dlhdChannels, ...cdnChannels];
  }, [dlhdChannels, cdnChannels]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    let events = allEvents;
    
    // Filter by provider
    if (selectedProvider === 'ppv') {
      events = ppvEvents;
    } else if (selectedProvider === 'dlhd') {
      events = dlhdEvents;
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      events = events.filter(event =>
        event.title.toLowerCase().includes(query) ||
        event.sport?.toLowerCase().includes(query) ||
        event.league?.toLowerCase().includes(query) ||
        event.teams?.home.toLowerCase().includes(query) ||
        event.teams?.away.toLowerCase().includes(query)
      );
    }
    
    return events;
  }, [allEvents, ppvEvents, dlhdEvents, selectedProvider, searchQuery]);

  // Filtered Channels
  const filteredChannels = useMemo(() => {
    let channels = allChannels;
    
    // Filter by provider
    if (selectedProvider === 'cdnlive') {
      channels = cdnChannels;
    } else if (selectedProvider === 'dlhd') {
      channels = dlhdChannels;
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      channels = channels.filter(channel =>
        channel.name.toLowerCase().includes(query) ||
        channel.category.toLowerCase().includes(query) ||
        channel.country.toLowerCase().includes(query) ||
        channel.countryName?.toLowerCase().includes(query)
      );
    }
    
    return channels;
  }, [allChannels, cdnChannels, dlhdChannels, selectedProvider, searchQuery]);

  // Event Categories
  const eventCategories = useMemo(() => {
    const sportMap = new Map<string, number>();
    filteredEvents.forEach(event => {
      if (event.sport) {
        const sport = event.sport.toLowerCase();
        sportMap.set(sport, (sportMap.get(sport) || 0) + 1);
      }
    });

    return Array.from(sportMap.entries())
      .map(([sport, count]) => ({
        id: sport,
        name: sport.charAt(0).toUpperCase() + sport.slice(1).replace(/-/g, ' '),
        icon: getSportIcon(sport),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredEvents]);

  // Channel Categories
  const channelCategories = useMemo(() => {
    const categoryMap = new Map<string, number>();
    filteredChannels.forEach(channel => {
      categoryMap.set(channel.category, (categoryMap.get(channel.category) || 0) + 1);
    });

    return Array.from(categoryMap.entries())
      .map(([category, count]) => ({
        id: category,
        name: category.charAt(0).toUpperCase() + category.slice(1),
        icon: getCategoryIcon(category),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredChannels]);

  // Stats
  const stats: ProviderStats = useMemo(() => ({
    dlhd: {
      events: dlhdEvents.length,
      channels: dlhdChannels.length,
      live: dlhdEvents.filter(e => e.isLive).length,
    },
    cdnlive: {
      channels: cdnChannels.length,
    },
    ppv: {
      events: ppvEvents.length,
      live: ppvEvents.filter(e => e.isLive).length,
    },
  }), [dlhdEvents, dlhdChannels, cdnChannels, ppvEvents]);

  // Loading state
  const loading = useMemo(() => {
    if (contentType === 'events') {
      if (selectedProvider === 'ppv') return ppvLoading;
      return dlhdLoading;
    }
    return selectedProvider === 'cdnlive' ? cdnLoading : dlhdLoading;
  }, [contentType, selectedProvider, dlhdLoading, cdnLoading, ppvLoading]);

  // Error state
  const error = useMemo(() => {
    if (contentType === 'events') {
      if (selectedProvider === 'ppv') return ppvError;
      return dlhdError;
    }
    return selectedProvider === 'cdnlive' ? cdnError : dlhdError;
  }, [contentType, selectedProvider, dlhdError, cdnError, ppvError]);

  // Refresh
  const refresh = useCallback(() => {
    fetchDLHD();
    fetchCDNLive();
    fetchPPV();
  }, [fetchDLHD, fetchCDNLive, fetchPPV]);

  return {
    // Content type toggle
    contentType,
    setContentType,
    
    // Provider selection
    selectedProvider,
    setSelectedProvider,
    
    // Data
    events: filteredEvents,
    channels: filteredChannels,
    eventCategories,
    channelCategories,
    
    // State
    loading,
    error,
    
    // Search
    searchQuery,
    setSearchQuery,
    
    // Stats
    stats,
    
    // Actions
    refresh,
  };
}

// Re-export for backwards compatibility
export type DLHDChannel = TVChannel;
