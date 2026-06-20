import { badRequest, json } from "../../../_shared/http";
import { getAdminIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const rawPath = String(params.path || "");
  if (!isSafeMediaPath(rawPath)) {
    return badRequest("媒体路径无效");
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_MEDIA_BYTES) {
    return badRequest("媒体文件不能超过 10MB");
  }

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const key = `media/${rawPath}`;
  await env.BLOG_BUCKET.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: admin },
  });

  return json({ key, url: `/media/${rawPath}` });
};

function isSafeMediaPath(path: string): boolean {
  return Boolean(path) && !path.includes("..") && /^[\w./\-\u4e00-\u9fa5]+$/.test(path);
}
