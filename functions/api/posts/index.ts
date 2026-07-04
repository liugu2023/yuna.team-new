import { badRequest, json, readJson } from "../../_shared/http";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

interface CreatePostPayload {
  slug?: string;
  title?: string;
  tag?: string;
  excerpt?: string;
  cover_url?: string;
  author_name?: string;
  status?: "draft" | "published";
  kind?: "article" | "knowledge";
  markdown?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const includeDrafts = url.searchParams.get("drafts") === "1";
  const kind = normalizeKind(url.searchParams.get("kind"));
  const usePagination = url.searchParams.has("page") || url.searchParams.has("perPage") || url.searchParams.has("limit");
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const perPage = clamp(positiveInteger(url.searchParams.get("perPage") || url.searchParams.get("limit"), 10), 1, 50);
  const offset = (page - 1) * perPage;
  const session = await getSession(env, request);
  const canSeeDrafts = Boolean(session && isAllowedAdmin(env, session));
  const includeAll = includeDrafts && canSeeDrafts;
  const columns = "id, slug, title, tag, excerpt, cover_url, status, kind, r2_key, author_email, author_name, editor_name, created_at, updated_at, published_at, view_count";

  const query = includeAll
    ? `SELECT ${columns} FROM posts WHERE kind = ? ORDER BY COALESCE(published_at, updated_at) DESC${usePagination ? " LIMIT ? OFFSET ?" : ""}`
    : `SELECT ${columns} FROM posts WHERE kind = ? AND status = 'published' ORDER BY published_at DESC${usePagination ? " LIMIT ? OFFSET ?" : ""}`;
  const countQuery = includeAll
    ? "SELECT COUNT(*) AS total FROM posts WHERE kind = ?"
    : "SELECT COUNT(*) AS total FROM posts WHERE kind = ? AND status = 'published'";

  const [posts, count] = await Promise.all([
    usePagination
      ? env.BLOG_DB.prepare(query).bind(kind, perPage, offset).all<PostRecord>()
      : env.BLOG_DB.prepare(query).bind(kind).all<PostRecord>(),
    env.BLOG_DB.prepare(countQuery).bind(kind).first<{ total: number }>(),
  ]);
  const total = Number(count?.total || 0);
  return json({
    posts: posts.results ?? [],
    pagination: {
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const payload = await readJson<CreatePostPayload>(request);
  if (!payload?.title || payload.markdown === undefined) {
    return badRequest("标题和 Markdown 内容不能为空");
  }

  const title = payload.title.trim();
  if (!title) return badRequest("标题不能为空");

  // 链接标识由后台自动分配：优先用传入值（兼容旧调用），否则从标题生成，并保证唯一。
  const base = normalizeSlug(payload.slug || title) || "post";
  const slug = await ensureUniqueSlug(env, base);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = payload.status ?? "draft";
  if (!isValidStatus(status)) return badRequest("文章状态无效");
  const kind = normalizeKind(payload.kind);
  const tag = normalizeTag(payload.tag);
  const coverUrl = normalizeOptionalText(payload.cover_url);
  // 作者名默认取当前登录用户的显示名，后台填写时可覆盖。
  const authorName = normalizeOptionalText(payload.author_name) || session.user_name || "";

  const publishedAt = status === "published" ? now : null;
  const r2Key = `db/${kind === "knowledge" ? "knowledge" : "posts"}/${slug}.md`;

  await env.BLOG_DB.prepare(
    `INSERT INTO posts
      (id, slug, title, tag, excerpt, cover_url, status, kind, r2_key, markdown_content, author_email, author_name, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      slug,
      title,
      tag,
      payload.excerpt ?? "",
      coverUrl,
      status,
      kind,
      r2Key,
      payload.markdown,
      session.user_email,
      authorName,
      now,
      now,
      publishedAt,
    )
    .run();

  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE id = ?")
    .bind(id)
    .first<PostRecord>();

  queueMarkdownGithubSync(env, waitUntil, "post:create", session.user_email);

  return json({ post }, { status: 201 });
};

function isValidStatus(value: string): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

function normalizeTag(value: unknown): string {
  const tag = typeof value === "string" ? value.trim() : "";
  return tag || "协会动态";
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKind(value: unknown): "article" | "knowledge" {
  return value === "knowledge" ? "knowledge" : "article";
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function ensureUniqueSlug(env: Env, base: string): Promise<string> {
  let candidate = base;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const existing = await env.BLOG_DB.prepare("SELECT slug FROM posts WHERE slug = ?")
      .bind(candidate)
      .first<{ slug: string }>();
    if (!existing) return candidate;
    candidate = `${base}-${crypto.randomUUID().slice(0, 4)}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
