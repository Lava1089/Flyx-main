/**
 * InMemoryAnalyticsState — All real-time analytics live in worker memory.
 *
 * Replaces HeartbeatBuffer + D1 writes. Zero D1 reads/writes for real-time data.
 * Only the daily summary is persisted to D1 once per day at midnight.
 */

export type ActivityType = 'browsing' | 'watching' | 'livetv';

export interface ActiveUser {
  ipHash: string;
  activityType: ActivityType;
  contentCategory: string | null;
  lastSeen: number;
}

export interface TopContentItem {
  title: string;
  viewers: number;
}

export interface RealtimeSnapshot {
  liveUsers: number;
  watching: number;
  browsing: number;
  livetv: number;
  peakToday: number;
  peakTime: number;
  topActiveContent: TopContentItem[];
}

export interface DailySummaryRow {
  date: string;
  peakActive: number;
  totalUniqueSessions: number;
  watchingSessions: number;
  browsingSessions: number;
  livetvSessions: number;
  topCategories: string; // JSON
}

/** Users with no heartbeat for this long are considered inactive */
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export class InMemoryAnalyticsState {
  private activeUsers: Map<string, ActiveUser> = new Map();
  private uniqueIpHashes: Set<string> = new Set();
  private peakActive = 0;
  private peakTime = 0;
  private activityCounts = { watching: 0, browsing: 0, livetv: 0 };
  private contentCounts: Map<string, number> = new Map();
  private currentDate: string;

  constructor(now?: number) {
    this.currentDate = new Date(now ?? Date.now()).toISOString().slice(0, 10);
  }

  /**
   * Record a heartbeat from a user. Upserts into active users map
   * and updates the daily summary counters.
   */
  recordHeartbeat(ipHash: string, activityType: ActivityType, contentCategory: string | null): void {
    const now = Date.now();

    // Track unique visitors for DAU
    const isNewToday = !this.uniqueIpHashes.has(ipHash);
    this.uniqueIpHashes.add(ipHash);

    // Count activity types for unique sessions (only on first appearance)
    if (isNewToday) {
      this.activityCounts[activityType]++;
    }

    // Track content categories
    if (contentCategory) {
      this.contentCounts.set(
        contentCategory,
        (this.contentCounts.get(contentCategory) || 0) + 1
      );
    }

    // Upsert active user
    this.activeUsers.set(ipHash, {
      ipHash,
      activityType,
      contentCategory,
      lastSeen: now,
    });

    // Update peak if current active count exceeds it
    const currentActive = this.activeUsers.size;
    if (currentActive > this.peakActive) {
      this.peakActive = currentActive;
      this.peakTime = now;
    }
  }

  /**
   * Get a snapshot of the current real-time state.
   * Prunes stale users before computing counts.
   */
  getRealtimeSnapshot(now?: number): RealtimeSnapshot {
    this.pruneStaleUsers(now);

    let watching = 0, browsing = 0, livetv = 0;
    const contentViewers = new Map<string, number>();

    for (const user of this.activeUsers.values()) {
      switch (user.activityType) {
        case 'watching': watching++; break;
        case 'browsing': browsing++; break;
        case 'livetv': livetv++; break;
      }
      if (user.contentCategory) {
        contentViewers.set(
          user.contentCategory,
          (contentViewers.get(user.contentCategory) || 0) + 1
        );
      }
    }

    // Sort content by viewer count, take top 10
    const topActiveContent: TopContentItem[] = Array.from(contentViewers.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, viewers]) => ({ title, viewers }));

    return {
      liveUsers: watching + browsing + livetv,
      watching,
      browsing,
      livetv,
      peakToday: this.peakActive,
      peakTime: this.peakTime,
      topActiveContent,
    };
  }

  /**
   * Get the daily summary row formatted for D1 insert.
   */
  getDailySummaryRow(): DailySummaryRow {
    const topCategories = Array.from(this.contentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([category, count]) => ({ category, count }));

    return {
      date: this.currentDate,
      peakActive: this.peakActive,
      totalUniqueSessions: this.uniqueIpHashes.size,
      watchingSessions: this.activityCounts.watching,
      browsingSessions: this.activityCounts.browsing,
      livetvSessions: this.activityCounts.livetv,
      topCategories: JSON.stringify(topCategories),
    };
  }

  /**
   * Reset all state for a new day. Called at midnight cron.
   */
  resetDay(now?: number): void {
    this.activeUsers.clear();
    this.uniqueIpHashes.clear();
    this.peakActive = 0;
    this.peakTime = 0;
    this.activityCounts = { watching: 0, browsing: 0, livetv: 0 };
    this.contentCounts.clear();
    this.currentDate = new Date(now ?? Date.now()).toISOString().slice(0, 10);
  }

  /**
   * Remove users who haven't sent a heartbeat within the stale threshold.
   */
  pruneStaleUsers(now?: number): number {
    const cutoff = (now ?? Date.now()) - STALE_THRESHOLD_MS;
    let pruned = 0;

    for (const [ipHash, user] of this.activeUsers) {
      if (user.lastSeen < cutoff) {
        this.activeUsers.delete(ipHash);
        pruned++;
      }
    }

    return pruned;
  }

  /** Current number of active (non-stale) users in the map */
  get activeCount(): number {
    return this.activeUsers.size;
  }

  /** Total unique visitors today */
  get uniqueToday(): number {
    return this.uniqueIpHashes.size;
  }
}
