'use client';

/**
 * Slice Contexts — Independent React contexts for SSE channel subscriptions
 *
 * Each slice is an independent context with its own SSE channel subscription,
 * delta merge logic, cleanup on unmount, and connection/error state.
 *
 * Slices:
 *   - RealtimeSlice: live user counts, activity breakdown, active content
 *   - UserSlice: DAU/WAU/MAU, new users, returning users, devices
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useSSE, DeltaUpdate } from '../hooks/useSSE';

// ---------------------------------------------------------------------------
// Pure utility (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Merge a delta into a base state. Keys in delta.changes overwrite base;
 * keys in base but not in delta are preserved.
 */
export function mergeDelta<T extends Record<string, unknown>>(
  base: T,
  delta: DeltaUpdate
): T {
  return { ...base, ...delta.changes } as T;
}

/**
 * Map a tab name to its SSE channel subscriptions.
 */
export const TAB_CHANNEL_MAP: Record<string, string[]> = {
  dashboard: ['realtime', 'users'],
  content: ['realtime'],
  users: ['users'],
  geographic: [],
  health: [],
  settings: [],
};

export function getChannelsForTab(tab: string): string[] {
  return Object.prototype.hasOwnProperty.call(TAB_CHANNEL_MAP, tab)
    ? TAB_CHANNEL_MAP[tab]
    : [];
}

// ---------------------------------------------------------------------------
// Slice data types
// ---------------------------------------------------------------------------

export interface RealtimeData {
  liveUsers: number;
  watching: number;
  browsing: number;
  livetv: number;
  peakToday: number;
  peakTime: number;
  topActiveContent: Array<{ title: string; viewers: number }>;
}

export interface UserData {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  newToday: number;
  returningUsers: number;
  deviceBreakdown: Array<{ device: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Slice context shape
// ---------------------------------------------------------------------------

export interface SliceState<T> {
  data: T;
  loading: boolean;
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const defaultRealtime: RealtimeData = {
  liveUsers: 0, watching: 0, browsing: 0, livetv: 0,
  peakToday: 0, peakTime: 0, topActiveContent: [],
};

const defaultUser: UserData = {
  totalUsers: 0, dau: 0, wau: 0, mau: 0,
  newToday: 0, returningUsers: 0, deviceBreakdown: [],
};

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const RealtimeContext = createContext<SliceState<RealtimeData>>({
  data: defaultRealtime, loading: true, connected: false, lastUpdate: 0, error: null,
});

const UserContext = createContext<SliceState<UserData>>({
  data: defaultUser, loading: true, connected: false, lastUpdate: 0, error: null,
});

// ---------------------------------------------------------------------------
// Consumer hooks
// ---------------------------------------------------------------------------

export function useRealtimeSlice(): SliceState<RealtimeData> {
  return useContext(RealtimeContext);
}

export function useUserSlice(): SliceState<UserData> {
  return useContext(UserContext);
}

// ---------------------------------------------------------------------------
// Generic slice provider factory
// ---------------------------------------------------------------------------

function useSliceSSE<T extends object>(
  channel: string,
  defaultData: T,
): SliceState<T> {
  const [state, setState] = useState<SliceState<T>>({
    data: defaultData,
    loading: true,
    connected: false,
    lastUpdate: 0,
    error: null,
  });

  const dataRef = useRef<T>(defaultData);

  const handleSnapshot = useCallback((ch: string, snapshot: Record<string, unknown>) => {
    if (ch !== channel) return;
    const newData = { ...defaultData, ...snapshot } as T;
    dataRef.current = newData;
    setState({
      data: newData,
      loading: false,
      connected: true,
      lastUpdate: Date.now(),
      error: null,
    });
  }, [channel, defaultData]);

  const handleDelta = useCallback((delta: DeltaUpdate) => {
    if (delta.channel !== channel) return;
    const merged = mergeDelta(dataRef.current as Record<string, unknown>, delta) as T;
    dataRef.current = merged;
    setState(prev => ({
      ...prev,
      data: merged,
      lastUpdate: Date.now(),
      error: null,
    }));
  }, [channel]);

  const handleError = useCallback((err: Error) => {
    setState(prev => ({ ...prev, error: err.message }));
  }, []);

  const { connected, usingFallback } = useSSE({
    channels: [channel],
    onSnapshot: handleSnapshot,
    onDelta: handleDelta,
    onError: handleError,
  });

  // Sync connection status
  useEffect(() => {
    setState(prev => ({
      ...prev,
      connected: connected || usingFallback,
      loading: prev.loading && !connected && !usingFallback,
    }));
  }, [connected, usingFallback]);

  return state;
}

// ---------------------------------------------------------------------------
// SSE Connection Status Context (layout-level)
// ---------------------------------------------------------------------------

export interface SSEConnectionStatus {
  connected: boolean;
  sseConnected: boolean;
  usingFallback: boolean;
  error: string | null;
  lastUpdate: number;
}

const SSEConnectionContext = createContext<SSEConnectionStatus>({
  connected: false,
  sseConnected: false,
  usingFallback: false,
  error: null,
  lastUpdate: 0,
});

export function useSSEConnection(): SSEConnectionStatus {
  return useContext(SSEConnectionContext);
}

/**
 * SSEConnectionProvider — wraps slice providers and exposes consolidated
 * connection status. Must be rendered *inside* the slice providers.
 */
export function SSEConnectionProvider({ children }: { children: ReactNode }) {
  const realtime = useRealtimeSlice();
  const users = useUserSlice();

  const connected = realtime.connected || users.connected;
  const error = realtime.error || users.error;
  const lastUpdate = Math.max(realtime.lastUpdate, users.lastUpdate);

  const status: SSEConnectionStatus = {
    connected,
    sseConnected: connected,
    usingFallback: connected && !realtime.connected,
    error,
    lastUpdate,
  };

  return (
    <SSEConnectionContext.Provider value={status}>
      {children}
    </SSEConnectionContext.Provider>
  );
}

export function RealtimeSliceProvider({ children }: { children: ReactNode }) {
  const state = useSliceSSE<RealtimeData>('realtime', defaultRealtime);
  return (
    <RealtimeContext.Provider value={state}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function UserSliceProvider({ children }: { children: ReactNode }) {
  const state = useSliceSSE<UserData>('users', defaultUser);
  return (
    <UserContext.Provider value={state}>
      {children}
    </UserContext.Provider>
  );
}
