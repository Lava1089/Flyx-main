-- Flyx Sync Worker D1 Schema
-- Run: npx wrangler d1 execute flyx-sync-db --file=schema.sql
--
-- Only 2 tables remain after the in-memory analytics refactor:
--   1. sync_accounts — cross-device sync data
--   2. admin_daily_stats — one row per day, written at midnight cron

-- Table 1: Sync accounts
CREATE TABLE IF NOT EXISTS sync_accounts (
  id TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE NOT NULL,
  sync_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER NOT NULL,
  device_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sync_accounts_hash ON sync_accounts(code_hash);
CREATE INDEX IF NOT EXISTS idx_sync_accounts_updated ON sync_accounts(updated_at);

-- Table 2: Admin daily stats (one write per day at midnight)
CREATE TABLE IF NOT EXISTS admin_daily_stats (
  date TEXT PRIMARY KEY,
  peak_active INTEGER DEFAULT 0,
  total_unique_sessions INTEGER DEFAULT 0,
  watching_sessions INTEGER DEFAULT 0,
  browsing_sessions INTEGER DEFAULT 0,
  livetv_sessions INTEGER DEFAULT 0,
  top_categories TEXT,  -- JSON array of {category, count}
  hourly_breakdown TEXT, -- JSON array of per-hour activity breakdowns
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
