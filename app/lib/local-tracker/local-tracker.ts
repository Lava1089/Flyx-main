/**
 * Local_Tracker — singleton client-side service that captures user activity
 * and writes to Local_Store. Manages heartbeat beacons and offline queue.
 *
 * Requirements: 1.2, 2.1, 2.2, 4.3, 4.4
 */

import { LocalStore } from '../local-store/local-store';
import type { WatchProgressEntry } from '../local-store/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeartbeatPayload {
  activityType: 'browsing' | 'watching' | 'livetv';
  contentCategory?: string;
  timestamp: number;
}

export interface SyncResult {
  success: boolean;
  error?: string;
}

export interface ILocalTracker {
  init(): void;
  destroy(): void;

  startWatch(
    contentId: string,
    contentType: 'movie' | 'tv' | 'livetv',
    title: string,
    season?: number,
    episode?: number,
    duration?: number,
  ): void;
  updateProgress(position: number, duration?: number): void;
  pauseWatch(): void;
  stopWatch(): void;

  trackPageView(path: string): void;

  pushSync(): Promise<SyncResult>;
  pullSync(): Promise<SyncResult>;

  isHeartbeatEnabled(): boolean;
  setHeartbeatEnabled(enabled: boolean): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OFFLINE_QUEUE_KEY = 'flyx_v2_offline_queue';
const HEARTBEAT_ENABLED_KEY = 'flyx_v2_heartbeat_enabled';
const MAX_QUEUE_SIZE = 100;
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const QUEUE_DRAIN_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}


// ---------------------------------------------------------------------------
// LocalTracker implementation
// ---------------------------------------------------------------------------

export class LocalTracker implements ILocalTracker {
  private static instance: LocalTracker | null = null;

  private store: LocalStore;
  private initialized = false;

  // Current watch session state
  private currentWatch: {
    contentId: string;
    contentType: 'movie' | 'tv' | 'livetv';
    title: string;
    season?: number;
    episode?: number;
    position: number;
    duration: number;
  } | null = null;

  // Heartbeat state
  private heartbeatEnabled = true;
  private lastHeartbeatTime = 0;

  // Online/offline listener reference
  private onlineHandler: (() => void) | null = null;
  private beforeUnloadHandler: (() => void) | null = null;

  private constructor(store?: LocalStore) {
    this.store = store ?? new LocalStore();
  }

  /** Get or create the singleton instance. */
  static getInstance(store?: LocalStore): LocalTracker {
    if (!LocalTracker.instance) {
      LocalTracker.instance = new LocalTracker(store);
    }
    return LocalTracker.instance;
  }

  /** Reset singleton — for testing only. */
  static resetInstance(): void {
    if (LocalTracker.instance) {
      LocalTracker.instance.destroy();
    }
    LocalTracker.instance = null;
  }

  // ---- Lifecycle ----

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Load heartbeat preference
    this.heartbeatEnabled = safeJsonParse(
      localStorage.getItem(HEARTBEAT_ENABLED_KEY),
      true,
    );

    // Listen for online events to drain the offline queue
    this.onlineHandler = () => this.drainOfflineQueue();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);

      // Send a final heartbeat on page unload via sendBeacon (reliable delivery)
      this.beforeUnloadHandler = () => this.sendBeaconHeartbeat();
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
  }

  destroy(): void {
    if (!this.initialized) return;

    if (this.currentWatch) {
      this.stopWatch();
    }

    if (typeof window !== 'undefined') {
      if (this.onlineHandler) {
        window.removeEventListener('online', this.onlineHandler);
      }
      if (this.beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      }
    }
    this.onlineHandler = null;
    this.beforeUnloadHandler = null;
    this.initialized = false;
  }

  // ---- Watch tracking ----

  startWatch(
    contentId: string,
    contentType: 'movie' | 'tv' | 'livetv',
    title: string,
    season?: number,
    episode?: number,
    duration?: number,
  ): void {
    // Stop any existing watch session
    if (this.currentWatch) {
      this.stopWatch();
    }

    this.currentWatch = {
      contentId,
      contentType,
      title,
      season,
      episode,
      position: 0,
      duration: duration ?? 0,
    };

    this.writeCurrentProgress();
    // Send immediately on activity change (bypass rate limit)
    this.sendHeartbeatImmediate(
      contentType === 'livetv' ? 'livetv' : 'watching',
      contentType === 'livetv' ? 'livetv' : contentType,
    );
  }

  updateProgress(position: number, duration?: number): void {
    if (!this.currentWatch) return;

    this.currentWatch.position = position;
    if (duration != null) {
      this.currentWatch.duration = duration;
    }

    this.writeCurrentProgress();
  }

  pauseWatch(): void {
    if (!this.currentWatch) return;
    this.writeCurrentProgress();
    // Send immediately on activity change (bypass rate limit)
    this.sendHeartbeatImmediate('browsing');
  }

  stopWatch(): void {
    if (!this.currentWatch) return;
    this.writeCurrentProgress();
    this.currentWatch = null;
  }

  // ---- Page tracking ----

  trackPageView(_path: string): void {
    this.sendHeartbeat('browsing');
  }

  // ---- Sync ----

  async pushSync(): Promise<SyncResult> {
    // Delegated to SyncManager — this is a pass-through
    return { success: false, error: 'Use SyncManager.pushSync() directly' };
  }

  async pullSync(): Promise<SyncResult> {
    return { success: false, error: 'Use SyncManager.pullSync() directly' };
  }

  // ---- Heartbeat ----

  isHeartbeatEnabled(): boolean {
    return this.heartbeatEnabled;
  }

  setHeartbeatEnabled(enabled: boolean): void {
    this.heartbeatEnabled = enabled;
    localStorage.setItem(HEARTBEAT_ENABLED_KEY, JSON.stringify(enabled));
  }

  /**
   * Construct and send a heartbeat beacon.
   * Rate-limited to at most once per HEARTBEAT_INTERVAL_MS.
   * Queued offline if no connectivity.
   */
  sendHeartbeat(
    activityType: HeartbeatPayload['activityType'],
    contentCategory?: string,
  ): void {
    if (!this.heartbeatEnabled) return;

    const now = Date.now();
    if (now - this.lastHeartbeatTime < HEARTBEAT_INTERVAL_MS) return;

    this.sendHeartbeatImmediate(activityType, contentCategory);
  }

  /**
   * Send a heartbeat immediately, bypassing the rate limit.
   * Used for activity type changes (start watching, pause, etc.)
   */
  private sendHeartbeatImmediate(
    activityType: HeartbeatPayload['activityType'],
    contentCategory?: string,
  ): void {
    if (!this.heartbeatEnabled) return;

    const now = Date.now();
    const payload: HeartbeatPayload = {
      activityType,
      contentCategory,
      timestamp: now,
    };

    this.lastHeartbeatTime = now;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.enqueueOffline(payload);
      return;
    }

    // Fire-and-forget POST
    this.deliverHeartbeat(payload).catch(() => {
      this.enqueueOffline(payload);
    });
  }

  /**
   * Send a heartbeat via navigator.sendBeacon for reliable delivery on page unload.
   */
  private sendBeaconHeartbeat(): void {
    if (!this.heartbeatEnabled) return;

    const syncWorkerUrl = this.getSyncWorkerUrl();
    if (!syncWorkerUrl) return;
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;

    const payload: HeartbeatPayload = {
      activityType: this.currentWatch ? 'watching' : 'browsing',
      contentCategory: this.currentWatch?.contentType,
      timestamp: Date.now(),
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    navigator.sendBeacon(`${syncWorkerUrl}/heartbeat`, blob);
  }

  /** Reset the heartbeat timer — exposed for testing. */
  resetHeartbeatTimer(): void {
    this.lastHeartbeatTime = 0;
  }

  // ---- Offline queue ----

  enqueueOffline(payload: HeartbeatPayload): void {
    const queue = this.readOfflineQueue();
    queue.push(payload);

    // Drop oldest if over max size
    while (queue.length > MAX_QUEUE_SIZE) {
      queue.shift();
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }

  readOfflineQueue(): HeartbeatPayload[] {
    return safeJsonParse<HeartbeatPayload[]>(
      localStorage.getItem(OFFLINE_QUEUE_KEY),
      [],
    );
  }

  clearOfflineQueue(): void {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([]));
  }

  async drainOfflineQueue(): Promise<void> {
    const queue = this.readOfflineQueue();
    if (queue.length === 0) return;

    this.clearOfflineQueue();

    for (const payload of queue) {
      try {
        await this.deliverHeartbeat(payload);
      } catch {
        // Re-enqueue failed items
        this.enqueueOffline(payload);
      }
      // Delay between requests
      await new Promise((r) => setTimeout(r, QUEUE_DRAIN_DELAY_MS));
    }
  }

  // ---- Internal helpers ----

  private writeCurrentProgress(): void {
    if (!this.currentWatch) return;

    const entry: WatchProgressEntry = {
      contentId: this.currentWatch.contentId,
      contentType: this.currentWatch.contentType,
      title: this.currentWatch.title,
      seasonNumber: this.currentWatch.season,
      episodeNumber: this.currentWatch.episode,
      position: this.currentWatch.position,
      duration: this.currentWatch.duration,
      lastWatched: Date.now(),
    };

    this.store.setWatchProgress(entry);
  }

  private async deliverHeartbeat(payload: HeartbeatPayload): Promise<void> {
    const syncWorkerUrl = this.getSyncWorkerUrl();
    if (!syncWorkerUrl) return;

    await fetch(`${syncWorkerUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  private getSyncWorkerUrl(): string | null {
    // In production, this would come from env config
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SYNC_WORKER_URL) {
      return process.env.NEXT_PUBLIC_SYNC_WORKER_URL;
    }
    return null;
  }

  /** Expose the store for testing. */
  getStore(): LocalStore {
    return this.store;
  }
}

// ---------------------------------------------------------------------------
// Convenience: construct a heartbeat payload (pure function, for testing)
// ---------------------------------------------------------------------------

export function buildHeartbeatPayload(
  activityType: HeartbeatPayload['activityType'],
  contentCategory?: string,
): HeartbeatPayload {
  return {
    activityType,
    ...(contentCategory !== undefined ? { contentCategory } : {}),
    timestamp: Date.now(),
  };
}
