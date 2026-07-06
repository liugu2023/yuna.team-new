import { badRequest, json, notFound, readJson } from "../../_shared/http";
import { getCookie, serializeCookie } from "../../_shared/cookies";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { toPublicPost } from "../../_shared/sanitize";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

// 署名与登录账号解绑：作者、最后编辑人都由后台手动维护，留空时统一落到协会名。
const DEFAULT_CREDIT_NAME = "网络信息协会";

interface UpdatePostPayload {
  title?: string;
  tag?: string;
  excerpt?: string;
  cover_url?: string;
  author_name?: string;
  editor_name?: string;
  status?: "draft" | "published";
  kind?: "article" | "knowledge";
  markdown?: string;
  // 乐观锁：客户端回传打开编辑器时的 updated_at，服务端不一致即拒绝，防止双开互相覆盖。
  expected_updated_at?: string;
}

export const onRequestGet: PagesFunction<Env, "slug"> = async ({ env, params, request, waitUntil }) => {
  const slug = routeSlug(params.slug);
  const session = await getSession(env, request);
  const canSeeDrafts = Boolean(session && isAllowedAdmin(env, session));
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();

  if (!post || (post.status !== "published" && !canSeeDrafts)) return notFound("文章不存在");

  const headers = new Headers();
  if (post.status === "published" && !canSeeDrafts) {
    // 同一浏览器 30 分钟内重复打开同一篇不再累计，Cookie 按接口路径隔离；
    // 计数写入放到响应之后异步执行，正常阅读只花一次 D1 读。
    const viewCookie = `yuna_v_${await slugHash(slug)}`;
    if (getCookie(request, viewCookie) !== "1") {
      post.view_count = Number(post.view_count || 0) + 1;
      waitUntil(
        env.BLOG_DB.prepare("UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE slug = ?")
          .bind(slug)
          .run(),
      );
      headers.set(
        "set-cookie",
        serializeCookie(viewCookie, "1", { maxAge: 1800, path: new URL(request.url).pathname }),
      );
    }
  }

  return json({ post: toPublicPost(post), markdown: post.markdown_content ?? "" }, { headers });
};

async function slugHash(slug: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(slug));
  return Array.from(new Uint8Array(digest).slice(0, 5))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const onRequestPut: PagesFunction<Env, "slug"> = async ({ env, params, request, waitUntil }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const slug = routeSlug(params.slug);
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();
  if (!post) return notFound("文章不存在");

  const payload = await readJson<UpdatePostPayload>(request);
  if (!payload) return badRequest("请求内容不是有效的 JSON");

  if (payload.title !== undefined && !payload.title.trim()) {
    return badRequest("标题不能为空");
  }

  if (payload.status !== undefined && !isValidStatus(payload.status)) {
    return badRequest("文章状态无效");
  }

  // 旧客户端不带 expected_updated_at 时跳过校验，保持兼容。
  if (payload.expected_updated_at !== undefined && payload.expected_updated_at !== post.updated_at) {
    return json(
      { error: "文章已被其他人修改过，为避免覆盖已拒绝保存。请先复制当前编辑内容，刷新后再合并保存。" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const nextStatus = payload.status ?? post.status;
  const nextTitle = payload.title?.trim() ?? post.title;
  const nextTag = payload.tag !== undefined ? normalizeTag(payload.tag) : post.tag;
  const nextCoverUrl = payload.cover_url !== undefined ? normalizeOptionalText(payload.cover_url) : post.cover_url ?? "";
  const nextAuthorName = payload.author_name !== undefined
    ? normalizeOptionalText(payload.author_name) || DEFAULT_CREDIT_NAME
    : post.author_name ?? "";
  const nextKind = payload.kind !== undefined ? normalizeKind(payload.kind) : post.kind ?? "article";
  const publishedAt =
    post.published_at ?? (post.status !== "published" && nextStatus === "published" ? now : null);

  const nextMarkdown = payload.markdown ?? post.markdown_content ?? "";
  // 最后编辑人不再取登录账号显示名，由后台填写；留空时用协会名兜底。
  const editorName = payload.editor_name !== undefined
    ? normalizeOptionalText(payload.editor_name) || DEFAULT_CREDIT_NAME
    : post.editor_name ?? "";

  await env.BLOG_DB.prepare(
    `UPDATE posts
     SET title = ?, tag = ?, excerpt = ?, cover_url = ?, author_name = ?, editor_name = ?, status = ?, kind = ?, markdown_content = ?, updated_at = ?, published_at = ?
     WHERE slug = ?`,
  )
    .bind(
      nextTitle,
      nextTag,
      payload.excerpt ?? post.excerpt,
      nextCoverUrl,
      nextAuthorName,
      editorName,
      nextStatus,
      nextKind,
      nextMarkdown,
      now,
      publishedAt,
      slug,
    )
    .run();

  const updated = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();

  queueMarkdownGithubSync(env, waitUntil, "post:update", session.user_email);

  return json({ post: updated ? toPublicPost(updated) : null });
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

export const onRequestDelete: PagesFunction<Env, "slug"> = async ({ env, params, request, waitUntil }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const slug = routeSlug(params.slug);
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();
  if (!post) return notFound("文章不存在");

  await env.BLOG_DB.prepare("DELETE FROM posts WHERE slug = ?").bind(slug).run();

  queueMarkdownGithubSync(env, waitUntil, "post:delete", session.user_email);

  return json({ ok: true });
};

function routeSlug(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value.join("/") : String(value || "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
