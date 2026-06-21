import { badRequest, json, notFound, readJson } from "../../_shared/http";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

interface UpdatePostPayload {
  title?: string;
  excerpt?: string;
  status?: "draft" | "published";
  markdown?: string;
}

export const onRequestGet: PagesFunction<Env, "slug"> = async ({ env, params, request }) => {
  const slug = String(params.slug);
  const session = await getSession(env, request);
  const canSeeDrafts = Boolean(session && isAllowedAdmin(env, session));
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();

  if (!post || (post.status !== "published" && !canSeeDrafts)) return notFound("文章不存在");

  if (post.status === "published" && !canSeeDrafts) {
    await env.BLOG_DB.prepare(
      "UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE slug = ?",
    )
      .bind(slug)
      .run();

    const updated = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
      .bind(slug)
      .first<PostRecord>();
    if (updated) return json({ post: updated, markdown: updated.markdown_content ?? "" });
  }

  return json({ post, markdown: post.markdown_content ?? "" });
};

export const onRequestPut: PagesFunction<Env, "slug"> = async ({ env, params, request, waitUntil }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const slug = String(params.slug);
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

  const now = new Date().toISOString();
  const nextStatus = payload.status ?? post.status;
  const nextTitle = payload.title?.trim() ?? post.title;
  const publishedAt =
    post.published_at ?? (post.status !== "published" && nextStatus === "published" ? now : null);

  const nextMarkdown = payload.markdown ?? post.markdown_content ?? "";

  await env.BLOG_DB.prepare(
    `UPDATE posts
     SET title = ?, excerpt = ?, status = ?, markdown_content = ?, updated_at = ?, published_at = ?
     WHERE slug = ?`,
  )
    .bind(
      nextTitle,
      payload.excerpt ?? post.excerpt,
      nextStatus,
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

  return json({ post: updated });
};

function isValidStatus(value: string): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

export const onRequestDelete: PagesFunction<Env, "slug"> = async ({ env, params, request, waitUntil }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const slug = String(params.slug);
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();
  if (!post) return notFound("文章不存在");

  await env.BLOG_DB.prepare("DELETE FROM posts WHERE slug = ?").bind(slug).run();

  queueMarkdownGithubSync(env, waitUntil, "post:delete", session.user_email);

  return json({ ok: true });
};
