export interface Env {
  BLOG_DB: D1Database;
  BLOG_BUCKET: R2Bucket;
  SITE_NAME: string;
  PUBLIC_BASE_URL: string;
  AUTHENTIK_ISSUER: string;
  AUTHENTIK_CLIENT_ID: string;
  AUTHENTIK_CLIENT_SECRET: string;
  AUTHENTIK_REDIRECT_PATH: string;
  SESSION_SECRET: string;
  MIGRATION_TOKEN?: string;
  CONTROL_GROUP?: string;
  GITHUB_BACKUP_REPO?: string;
  GITHUB_BACKUP_BRANCH?: string;
  GITHUB_BACKUP_PATH?: string;
  GITHUB_BACKUP_TOKEN?: string;
  GITHUB_BACKUP_AUTHOR_NAME?: string;
  GITHUB_BACKUP_AUTHOR_EMAIL?: string;
}

export interface PostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: "draft" | "published";
  r2_key: string;
  markdown_content: string;
  author_email: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface UserSession {
  id: string;
  user_email: string;
  user_name: string;
  user_groups: string;
  expires_at: number;
}

export interface SiteRecord {
  key: string;
  title: string;
  kind: "markdown" | "json";
  content: string;
  updated_by: string;
  updated_at: string;
}
