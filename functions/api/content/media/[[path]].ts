import { badRequest, json } from "../../../_shared/http";
import { resolveStoredContentType } from "../../../_shared/media";
import { getContentEditorIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const editor = await getContentEditorIdentity(env, request);
  if (!editor) {
    return json({ error: "需要页面编辑权限" }, { status: 401 });
  }

  const segments = params.path as string | string[] | undefined;
  const rawPath = normalizeMediaPath(Array.isArray(segments) ? segments.join("/") : String(segments || ""));
  if (!isSafeMediaPath(rawPath)) {
    return badRequest("媒体路径无效");
  }

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_MEDIA_BYTES) {
    return badRequest("媒体文件不能超过 10MB");
  }

  if (!request.body) {
    return badRequest("缺少上传内容");
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    return badRequest("媒体文件不能超过 10MB");
  }

  const contentType = resolveStoredContentType(
    rawPath,
    request.headers.get("content-type") || "",
  );
  const key = `media/${rawPath}`;
  await env.BLOG_BUCKET.put(key, buffer, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: editor },
  });

  return json({ key, url: `/media/${rawPath}`, contentType });
};

function isSafeMediaPath(path: string): boolean {
  return Boolean(path) && !path.includes("..") && /^[\w. /()\-\u4e00-\u9fa5\uff00-\uffef]+$/.test(path);
}

function normalizeMediaPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
