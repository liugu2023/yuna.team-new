CREATE TABLE IF NOT EXISTS site_records (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('markdown', 'json')) DEFAULT 'markdown',
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_record_backups (
  id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_record_backups_key_time
  ON site_record_backups (record_key, changed_at DESC);
