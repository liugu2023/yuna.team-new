export interface Env {
  BLOG_DB: D1Database;
  BLOG_BUCKET: R2Bucket;
  SITE_NAME: string;
  PUBLIC_BASE_URL: string;
  ZITADEL_ISSUER: string;
  ZITADEL_CLIENT_ID: string;
  ZITADEL_CLIENT_SECRET: string;
  ZITADEL_REDIRECT_PATH: string;
  SSO_ALLOWED_HOSTS?: string;
  SESSION_SECRET: string;
  FALLBACK_ADMIN_USER?: string;
  FALLBACK_ADMIN_PASSWORD?: string;
  CONTROL_GROUP?: string;
  R2_MIGRATION_TOKEN?: string;
  R2_MIGRATION_PREFIXES?: string;
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
  tag: string;
  excerpt: string;
  cover_url: string;
  status: "draft" | "published";
  kind: "article" | "knowledge";
  r2_key: string;
  markdown_content: string;
  author_email: string;
  author_name: string;
  author_url: string;
  author_avatar: string;
  editor_name: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  view_count: number;
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
