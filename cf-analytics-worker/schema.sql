-- Flyx Analytics Worker D1 Schema
-- Run: npx wrangler d1 execute flyx-analytics-db --file=schema.sql

-- Live activity tracking (real-time presence)
CREATE TABLE IF NOT EXISTS live_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  session_id TEXT,
  activity_type TEXT DEFAULT 'browsing',
  content_id TEXT,
  content_title TEXT,
  content_type TEXT,
  season_number INTEGER,
  episode_number INTEGER,
  country TEXT,
  city TEXT,
  region TEXT,
  started_at INTEGER,
  last_heartbeat INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_live_activity_user ON live_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_live_activity_heartbeat ON live_activity(last_heartbeat);

-- User activity tracking (DAU/WAU/MAU)
CREATE TABLE IF NOT EXISTS user_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  session_id TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  total_sessions INTEGER DEFAULT 1,
  country TEXT,
  city TEXT,
  region TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id);

-- Page views
CREATE TABLE IF NOT EXISTS page_views (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  page_path TEXT,
  page_title TEXT,
  referrer TEXT,
  entry_time INTEGER,
  time_on_page INTEGER DEFAULT 0,
  scroll_depth INTEGER DEFAULT 0,
  interactions INTEGER DEFAULT 0,
  device_type TEXT,
  country TEXT,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_page_views_time ON page_views(entry_time);

-- Watch sessions (movies/TV)
CREATE TABLE IF NOT EXISTS watch_sessions (
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

CREATE INDEX IF NOT EXISTS idx_watch_sessions_user ON watch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_content ON watch_sessions(content_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_started ON watch_sessions(started_at);

-- Live TV sessions
CREATE TABLE IF NOT EXISTS livetv_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  category TEXT,
  country TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  watch_duration INTEGER DEFAULT 0,
  quality TEXT,
  buffer_count INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_livetv_sessions_user ON livetv_sessions(user_id);

-- Bot/Player hits tracking
CREATE TABLE IF NOT EXISTS bot_hits (
  id TEXT PRIMARY KEY,
  hit_type TEXT DEFAULT 'bot',
  bot_name TEXT,
  bot_category TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  country TEXT,
  city TEXT,
  page_path TEXT,
  referrer TEXT,
  confidence INTEGER,
  hit_time INTEGER,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bot_hits_time ON bot_hits(hit_time);
CREATE INDEX IF NOT EXISTS idx_bot_hits_name ON bot_hits(bot_name);
CREATE INDEX IF NOT EXISTS idx_bot_hits_category ON bot_hits(bot_category);
CREATE INDEX IF NOT EXISTS idx_bot_hits_type ON bot_hits(hit_type);

-- Peak stats (one row per day)
CREATE TABLE IF NOT EXISTS peak_stats (
  date TEXT PRIMARY KEY,
  peak_total INTEGER DEFAULT 0,
  peak_total_time INTEGER,
  peak_watching INTEGER DEFAULT 0,
  peak_watching_time INTEGER,
  peak_livetv INTEGER DEFAULT 0,
  peak_livetv_time INTEGER,
  peak_browsing INTEGER DEFAULT 0,
  peak_browsing_time INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

-- Activity snapshots (for trend charts)
CREATE TABLE IF NOT EXISTS activity_snapshots (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  total_active INTEGER DEFAULT 0,
  watching INTEGER DEFAULT 0,
  browsing INTEGER DEFAULT 0,
  livetv INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_activity_snapshots_time ON activity_snapshots(timestamp);

-- Bot detections (for bot detection and filtering)
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

-- Metrics daily (for cron job aggregation)
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
