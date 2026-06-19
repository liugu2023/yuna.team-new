import { badRequest, json, notFound, readJson } from "../../_shared/http";
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
  const canSeeDrafts = Boolean(session && isAllowedAdmin(env, session.user_email));
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();

  if (!post || (post.status !== "published" && !canSeeDrafts)) return notFound("Post not found");

  const object = await env.BLOG_BUCKET.get(post.r2_key);
  if (!object) return notFound("Post markdown not found");

  return json({ post, markdown: await object.text() });
};

export const onRequestPut: PagesFunction<Env, "slug"> = async ({ env, params, request }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session.user_email)) {
    return json({ error: "Admin authentication required" }, { status: 401 });
  }

  const slug = String(params.slug);
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();
  if (!post) return notFound("Post not found");

  const payload = await readJson<UpdatePostPayload>(request);
  if (!payload) return badRequest("Invalid JSON body");

  const now = new Date().toISOString();
  const nextStatus = payload.status ?? post.status;
  const publishedAt =
    post.published_at ?? (post.status !== "published" && nextStatus === "published" ? now : null);

  if (payload.markdown !== undefined) {
    await env.BLOG_BUCKET.put(post.r2_key, payload.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { slug, title: payload.title ?? post.title },
    });
  }

  await env.BLOG_DB.prepare(
    `UPDATE posts
     SET title = ?, excerpt = ?, status = ?, updated_at = ?, published_at = ?
     WHERE slug = ?`,
  )
    .bind(
      payload.title ?? post.title,
      payload.excerpt ?? post.excerpt,
      nextStatus,
      now,
      publishedAt,
      slug,
    )
    .run();

  const updated = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();

  return json({ post: updated });
};

export const onRequestDelete: PagesFunction<Env, "slug"> = async ({ env, params, request }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session.user_email)) {
    return json({ error: "Admin authentication required" }, { status: 401 });
  }

  const slug = String(params.slug);
  const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE slug = ?")
    .bind(slug)
    .first<PostRecord>();
  if (!post) return notFound("Post not found");

  await env.BLOG_BUCKET.delete(post.r2_key);
  await env.BLOG_DB.prepare("DELETE FROM posts WHERE slug = ?").bind(slug).run();

  return json({ ok: true });
};
