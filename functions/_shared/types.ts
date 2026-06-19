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
  ADMIN_EMAIL_ALLOWLIST?: string;
}

export interface PostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: "draft" | "published";
  r2_key: string;
  author_email: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface UserSession {
  id: string;
  user_email: string;
  user_name: string;
  expires_at: number;
}
