import { json } from "../../../_shared/http";
import { getAdminIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const rawPath = String(params.path || "");
  if (!rawPath || rawPath.includes("..")) {
    return json({ error: "媒体路径无效" }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const key = `media/${rawPath}`;
  await env.BLOG_BUCKET.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: admin },
  });

  return json({ key, url: `/media/${rawPath}` });
};
