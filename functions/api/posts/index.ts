import { badRequest, json, readJson } from "../../_shared/http";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

interface CreatePostPayload {
  slug?: string;
  title?: string;
  excerpt?: string;
  status?: "draft" | "published";
  markdown?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const includeDrafts = url.searchParams.get("drafts") === "1";
  const session = await getSession(env, request);
  const canSeeDrafts = Boolean(session && isAllowedAdmin(env, session));
  const includeAll = includeDrafts && canSeeDrafts;
  const columns = "id, slug, title, excerpt, status, r2_key, author_email, created_at, updated_at, published_at";

  const query = includeAll
    ? `SELECT ${columns} FROM posts ORDER BY COALESCE(published_at, updated_at) DESC`
    : `SELECT ${columns} FROM posts WHERE status = 'published' ORDER BY published_at DESC`;

  const { results } = await env.BLOG_DB.prepare(query).all<PostRecord>();
  return json({ posts: results ?? [] });
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

  const publishedAt = status === "published" ? now : null;
  const r2Key = `db/posts/${slug}.md`;

  await env.BLOG_DB.prepare(
    `INSERT INTO posts
      (id, slug, title, excerpt, status, r2_key, markdown_content, author_email, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      slug,
      title,
      payload.excerpt ?? "",
      status,
      r2Key,
      payload.markdown,
      session.user_email,
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
