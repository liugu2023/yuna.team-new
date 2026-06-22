ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'article';

CREATE INDEX IF NOT EXISTS idx_posts_kind_status_published_at
  ON posts (kind, status, published_at DESC);
