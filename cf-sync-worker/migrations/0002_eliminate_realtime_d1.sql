-- Migration: Eliminate real-time D1 tables
-- All real-time analytics now live in worker memory.
-- Only admin_daily_stats is retained for historical analytics.
-- Only sync_accounts is retained for cross-device sync.

-- Drop raw heartbeats table (was the #1 D1 cost — flushed every 10s)
DROP TABLE IF EXISTS admin_heartbeats;

-- Drop hourly/daily aggregation cache (no longer needed — daily stats suffice)
DROP TABLE IF EXISTS aggregation_cache;

-- Drop SSE state table (state lives in worker memory now)
DROP TABLE IF EXISTS sse_state;
