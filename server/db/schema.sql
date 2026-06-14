PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  game_nickname TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  is_friend INTEGER NOT NULL DEFAULT 0 CHECK (is_friend IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  local_dir TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'reviewing', 'partially_imported', 'imported')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  local_match_no TEXT NOT NULL,
  match_id TEXT,
  local_path TEXT NOT NULL,
  screenshot_type TEXT NOT NULL CHECK (screenshot_type IN ('overview', 'detail')),
  ocr_status TEXT NOT NULL CHECK (ocr_status IN ('pending', 'done', 'failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES import_batches (id),
  FOREIGN KEY (match_id) REFERENCES matches (id)
);

CREATE TABLE IF NOT EXISTS review_matches (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  local_match_no TEXT NOT NULL,
  overview_screenshot_id TEXT,
  detail_screenshot_id TEXT,
  raw_review_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending_pairing', 'pending_review', 'approved', 'rejected', 'imported')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES import_batches (id),
  FOREIGN KEY (overview_screenshot_id) REFERENCES screenshots (id),
  FOREIGN KEY (detail_screenshot_id) REFERENCES screenshots (id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  review_match_id TEXT,
  mode TEXT NOT NULL,
  played_at TEXT NOT NULL,
  duration_seconds INTEGER,
  blue_score INTEGER NOT NULL,
  red_score INTEGER NOT NULL,
  winner_side TEXT NOT NULL CHECK (winner_side IN ('blue', 'red')),
  friend_side TEXT NOT NULL CHECK (friend_side IN ('blue', 'red')),
  friend_result TEXT NOT NULL CHECK (friend_result IN ('win', 'loss')),
  friend_count INTEGER NOT NULL,
  include_in_personal_stats INTEGER NOT NULL DEFAULT 1 CHECK (include_in_personal_stats IN (0, 1)),
  include_in_pair_stats INTEGER NOT NULL DEFAULT 1 CHECK (include_in_pair_stats IN (0, 1)),
  include_in_lineup_stats INTEGER NOT NULL DEFAULT 1 CHECK (include_in_lineup_stats IN (0, 1)),
  include_in_for_fun_stats INTEGER NOT NULL DEFAULT 1 CHECK (include_in_for_fun_stats IN (0, 1)),
  exclude_reason TEXT,
  dedupe_key TEXT NOT NULL,
  dedupe_override_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES import_batches (id),
  FOREIGN KEY (review_match_id) REFERENCES review_matches (id)
);

CREATE TABLE IF NOT EXISTS match_players (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT,
  raw_name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('blue', 'red')),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  is_friend INTEGER NOT NULL DEFAULT 0 CHECK (is_friend IN (0, 1)),
  raw_hero TEXT,
  hero_id TEXT,
  hero_name TEXT,
  lane TEXT CHECK (lane IN ('对抗路', '中路', '打野', '发育路', '游走')),
  lane_source TEXT CHECK (lane_source IN ('medal', 'manual', 'hero_default', 'manual_guess')),
  lane_confidence TEXT CHECK (lane_confidence IN ('high', 'medium', 'low')),
  rating REAL,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  economy INTEGER,
  damage_dealt INTEGER,
  damage_dealt_pct REAL,
  damage_taken INTEGER,
  damage_taken_pct REAL,
  team_economy_pct REAL,
  participation_pct REAL,
  medals_json TEXT NOT NULL DEFAULT '[]',
  is_mvp INTEGER NOT NULL DEFAULT 0 CHECK (is_mvp IN (0, 1)),
  is_svp INTEGER NOT NULL DEFAULT 0 CHECK (is_svp IN (0, 1)),
  field_sources_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players (id),
  UNIQUE (match_id, side, slot)
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('review_match', 'match', 'match_player')),
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'edit', 'dedupe_override')),
  changed_fields_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  match_ids_json TEXT NOT NULL,
  source_filter_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_is_friend ON players (is_friend);
CREATE INDEX IF NOT EXISTS idx_screenshots_batch_match ON screenshots (batch_id, local_match_no);
CREATE INDEX IF NOT EXISTS idx_review_matches_status ON review_matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches (played_at);
CREATE INDEX IF NOT EXISTS idx_matches_dedupe_key ON matches (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON match_players (match_id);
CREATE INDEX IF NOT EXISTS idx_match_players_player_id ON match_players (player_id);
