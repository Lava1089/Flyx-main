/**
 * Consolidated Stats API — Slice-based queries
 *
 * Today's data comes from InMemoryAnalyticsState (zero D1 reads).
 * Historical data comes from admin_daily_stats (D1 reads only when admin
 * views past days/weeks/months).
 */

import { InMemoryAnalyticsState } from './in-memory-analytics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_SLICES = ['realtime', 'content', 'users', 'geographic'] as const;
export type StatsSlice = (typeof VALID_SLICES)[number];

export interface StatsAPIResponse {
  success: boolean;
  slices: Record<string, unknown>;
  source: 'memory' | 'memory+d1' | 'd1';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a range string like '24h', '7d', '30d' into a start timestamp.
 */
export function parseTimeRange(range: string, now?: number): [number, number] {
  const currentTime = now ?? Date.now();
  const rangeEnd = currentTime;

  const match = range.match(/^(\d+)([hdm])$/);
  if (!match) {
    return [currentTime - 24 * 60 * 60 * 1000, rangeEnd];
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let ms: number;
  switch (unit) {
    case 'h': ms = value * 60 * 60 * 1000; break;
    case 'd': ms = value * 24 * 60 * 60 * 1000; break;
    case 'm': ms = value * 30 * 24 * 60 * 60 * 1000; break;
    default: ms = 24 * 60 * 60 * 1000;
  }

  return [currentTime - ms, rangeEnd];
}

/**
 * Parse the `slices` query param into an array of valid slice names.
 */
export function parseSlices(slicesParam: string | null): StatsSlice[] {
  if (!slicesParam) return [...VALID_SLICES];

  const requested = slicesParam.split(',').map(s => s.trim()) as StatsSlice[];
  const valid = requested.filter(s => VALID_SLICES.includes(s));
  return valid.length > 0 ? valid : [...VALID_SLICES];
}

/**
 * Check if a range is "today only" (less than 24h).
 */
function isTodayOnly(range: string): boolean {
  return range === 'today' || range === '24h' || range === '1d';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleConsolidatedStats(
  request: Request,
  db: D1Database | null,
  analyticsState: InMemoryAnalyticsState
): Promise<StatsAPIResponse> {
  const url = new URL(request.url);
  const requestedSlices = parseSlices(url.searchParams.get('slices'));
  const range = url.searchParams.get('range') || '24h';
  const now = Date.now();

  const responseSlices: Record<string, unknown> = {};
  let source: StatsAPIResponse['source'] = 'memory';

  // Get real-time snapshot from memory (always free)
  const snapshot = analyticsState.getRealtimeSnapshot();

  for (const slice of requestedSlices) {
    switch (slice) {
      case 'realtime':
        // Always from memory, never D1
        responseSlices.realtime = snapshot;
        break;

      case 'content':
        if (isTodayOnly(range)) {
          responseSlices.content = {
            totalSessions: analyticsState.uniqueToday,
            topContent: snapshot.topActiveContent,
          };
        } else if (db) {
          const historical = await fetchDailyStats(db, range, now);
          responseSlices.content = {
            today: {
              totalSessions: analyticsState.uniqueToday,
              topContent: snapshot.topActiveContent,
            },
            historical,
          };
          source = 'memory+d1';
        } else {
          responseSlices.content = {
            totalSessions: analyticsState.uniqueToday,
            topContent: snapshot.topActiveContent,
          };
        }
        break;

      case 'users':
        if (isTodayOnly(range)) {
          responseSlices.users = {
            dau: analyticsState.uniqueToday,
            wau: 0,
            mau: 0,
            totalUsers: analyticsState.uniqueToday,
            newToday: analyticsState.uniqueToday,
            returningUsers: 0,
            deviceBreakdown: [],
          };
        } else if (db) {
          const historical = await fetchDailyStats(db, range, now);
          // Compute WAU/MAU from historical daily stats
          const wau = computeRollingUniques(historical, 7);
          const mau = computeRollingUniques(historical, 30);
          responseSlices.users = {
            dau: analyticsState.uniqueToday,
            wau,
            mau,
            totalUsers: analyticsState.uniqueToday,
            newToday: analyticsState.uniqueToday,
            returningUsers: 0,
            deviceBreakdown: [],
            historical,
          };
          source = 'memory+d1';
        } else {
          responseSlices.users = {
            dau: analyticsState.uniqueToday,
            wau: 0,
            mau: 0,
            totalUsers: analyticsState.uniqueToday,
            newToday: analyticsState.uniqueToday,
            returningUsers: 0,
            deviceBreakdown: [],
          };
        }
        break;

      case 'geographic':
        // No geographic data available from heartbeats
        responseSlices.geographic = { topCountries: [], topCities: [] };
        break;
    }
  }

  return {
    success: true,
    slices: responseSlices,
    source,
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// D1 queries — only used for historical data
// ---------------------------------------------------------------------------

interface DailyStatsRow {
  date: string;
  peak_active: number;
  total_unique_sessions: number;
  watching_sessions: number;
  browsing_sessions: number;
  livetv_sessions: number;
  top_categories: string | null;
}

async function fetchDailyStats(
  db: D1Database,
  range: string,
  now: number
): Promise<DailyStatsRow[]> {
  const [rangeStart] = parseTimeRange(range, now);
  const startDate = new Date(rangeStart).toISOString().slice(0, 10);
  const endDate = new Date(now).toISOString().slice(0, 10);

  const result = await db.prepare(`
    SELECT date, peak_active, total_unique_sessions, watching_sessions,
           browsing_sessions, livetv_sessions, top_categories
    FROM admin_daily_stats
    WHERE date >= ? AND date <= ?
    ORDER BY date DESC
    LIMIT 90
  `).bind(startDate, endDate).all();

  return (result.results || []) as unknown as DailyStatsRow[];
}

/**
 * Compute approximate rolling unique users from daily stats.
 * Since we only have daily unique counts (not actual IP sets),
 * this sums the daily uniques as an upper-bound approximation.
 */
function computeRollingUniques(rows: DailyStatsRow[], days: number): number {
  const recent = rows.slice(0, days);
  return recent.reduce((sum, r) => sum + (r.total_unique_sessions || 0), 0);
}
