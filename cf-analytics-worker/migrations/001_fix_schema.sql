-- Migration: Add missing columns and tables to fix analytics issues
-- Run: npx wrangler d1 execute flyx-analytics-db --file=migrations/001_fix_schema.sql

-- Add total_watch_time column to watch_sessions (if not exists)
-- Note: D1 doesn't support IF NOT EXISTS for columns, so we use a workaround
-- This will fail silently if column already exists, which is fine

-- First, create a new table with the correct schema
CREATE TABLE IF NOT EXISTS watch_sessions_new (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  user_id TEXT,
  content_id TEXT,
  content_type TEXT,
  content_title TEXT,
  season_number INTEGER,
  episode_number INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  total_watch_time INTEGER DEFAULT 0,
  last_position INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,
  completion_percentage INTEGER DEFAULT 0,
  quality TEXT,
  is_completed INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

-- Copy data from old table to new table
INSERT OR IGNORE INTO watch_sessions_new 
  (id, session_id, user_id, content_id, content_type, content_title, 
   season_number, episode_number, started_at, ended_at, 
   total_watch_time, last_position, duration, completion_percentage, 
   quality, is_completed, created_at, updated_at)
SELECT 
  id, session_id, user_id, content_id, content_type, content_title, 
  season_number, episode_number, started_at, ended_at,
  0 as total_watch_time,  -- Default to 0 for existing records
  last_position, duration, completion_percentage, 
  quality, is_completed, created_at, updated_at
FROM watch_sessions;

-- Drop old table and rename new table
DROP TABLE IF EXISTS watch_sessions;
ALTER TABLE watch_sessions_new RENAME TO watch_sessions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_watch_sessions_user ON watch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_content ON watch_sessions(content_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_started ON watch_sessions(started_at);

-- Create bot_detections table if not exists
CREATE TABLE IF NOT EXISTS bot_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  confidence_score INTEGER NOT NULL,
  detection_reasons TEXT,
  fingerprint TEXT,
  status TEXT DEFAULT 'suspected',
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bot_detections_user ON bot_detections(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_detections_confidence ON bot_detections(confidence_score);
CREATE INDEX IF NOT EXISTS idx_bot_detections_status ON bot_detections(status);
CREATE INDEX IF NOT EXISTS idx_bot_detections_created ON bot_detections(created_at);

-- Create metrics_daily table if not exists (for cron aggregation)
CREATE TABLE IF NOT EXISTS metrics_daily (
  date TEXT PRIMARY KEY,
  total_sessions INTEGER DEFAULT 0,
  total_watch_time INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  avg_completion_rate REAL DEFAULT 0,
  movie_sessions INTEGER DEFAULT 0,
  tv_sessions INTEGER DEFAULT 0,
  livetv_sessions INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  peak_concurrent INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

-- Verify the migration
SELECT 'Migration complete. watch_sessions columns:' as status;
PRAGMA table_info(watch_sessions);
