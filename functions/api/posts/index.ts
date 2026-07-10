import { badRequest, json, readJson } from "../../_shared/http";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { toPublicPost } from "../../_shared/sanitize";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

// 署名与登录账号解绑：作者、最后编辑人都由后台手动维护，留空时统一落到协会名。
const DEFAULT_CREDIT_NAME = "网络信息协会";

interface CreatePostPayload {
  slug?: string;
  title?: string;
  tag?: string;
  excerpt?: string;
  cover_url?: string;
  author_name?: string;
  author_url?: string;
  author_avatar?: string;
  editor_name?: string;
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
  // 显式要草稿但没有权限时直接 401，而不是静默降级成已发布列表——
  // 否则后台会话过期后草稿会"凭空消失"，看起来像数据被删了。
  if (includeDrafts && !canSeeDrafts) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }
  const includeAll = includeDrafts && canSeeDrafts;
  // 列表不输出 author_email：公开接口不暴露成员登录邮箱，展示用 author_name。
  const columns = "id, slug, title, tag, excerpt, cover_url, status, kind, r2_key, author_name, author_url, author_avatar, editor_name, created_at, updated_at, published_at, view_count";

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
  let slug = await ensureUniqueSlug(env, base);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = payload.status ?? "draft";
  if (!isValidStatus(status)) return badRequest("文章状态无效");
  const kind = normalizeKind(payload.kind);
  const tag = normalizeTag(payload.tag);
  const coverUrl = normalizeOptionalText(payload.cover_url);
  const authorName = normalizeOptionalText(payload.author_name) || DEFAULT_CREDIT_NAME;
  const authorUrl = normalizeHttpUrl(payload.author_url);
  if (authorUrl === null) return badRequest("作者链接必须是有效的 HTTP 或 HTTPS 地址");
  const authorAvatar = normalizeAvatarUrl(payload.author_avatar);
  if (authorAvatar === null) return badRequest("作者头像必须是本站媒体地址或有效的 HTTP/HTTPS 图片地址");
  const editorName = normalizeOptionalText(payload.editor_name) || DEFAULT_CREDIT_NAME;

  const publishedAt = status === "published" ? now : null;

  const insertPost = (slugValue: string) =>
    env.BLOG_DB.prepare(
      `INSERT INTO posts
        (id, slug, title, tag, excerpt, cover_url, status, kind, r2_key, markdown_content, author_email, author_name, author_url, author_avatar, editor_name, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        slugValue,
        title,
        tag,
        payload.excerpt ?? "",
        coverUrl,
        status,
        kind,
        `db/${kind === "knowledge" ? "knowledge" : "posts"}/${slugValue}.md`,
        payload.markdown,
        session.user_email,
        authorName,
        authorUrl,
        authorAvatar,
        editorName,
        now,
        now,
        publishedAt,
      )
      .run();

  try {
    await insertPost(slug);
  } catch (error) {
    // 查重与写入非原子，并发创建同名文章可能撞唯一约束；换随机后缀重试一次。
    if (!isUniqueConstraintError(error)) throw error;
    slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    await insertPost(slug);
  }

  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE id = ?")
    .bind(id)
    .first<PostRecord>();

  queueMarkdownGithubSync(env, waitUntil, "post:create", session.user_email);

  return json({ post: post ? toPublicPost(post) : null }, { status: 201 });
};

function isValidStatus(value: string): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

function normalizeTag(value: unknown): string {
  const tag = typeof value === "string" ? value.trim() : "";
  return tag || "协会动态";
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHttpUrl(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function normalizeAvatarUrl(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  if (raw.length > 2048 || /[\0\r\n\\]/.test(raw)) return null;
  if (raw.startsWith("/media/") && !raw.startsWith("/media//")) return raw;
  return normalizeHttpUrl(raw);
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
