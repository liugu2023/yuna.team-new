import { json } from "../../_shared/http";
import { getAdminIdentity } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const { results } = await env.BLOG_DB.prepare(
    "SELECT * FROM posts WHERE markdown_content = '' ORDER BY created_at ASC",
  ).all<PostRecord>();

  let migrated = 0;
  const missing: string[] = [];

  for (const post of results ?? []) {
    const object = await env.BLOG_BUCKET.get(post.r2_key);
    if (!object) {
      missing.push(post.slug);
      continue;
    }

    await env.BLOG_DB.prepare(
      "UPDATE posts SET markdown_content = ?, updated_at = ? WHERE slug = ?",
    )
      .bind(await object.text(), new Date().toISOString(), post.slug)
      .run();
    migrated += 1;
  }

  return json({ migrated, missing });
};
