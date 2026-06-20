import { isInlineImageType } from "../_shared/media";
import type { Env } from "../_shared/types";

export const onRequestGet: PagesFunction<Env, "path"> = async ({ env, params }) => {
  // [[path]] 是 catch-all，params.path 是分段数组，用 / 拼回完整路径。
  const segments = params.path as string | string[] | undefined;
  const rawPath = Array.isArray(segments) ? segments.join("/") : String(segments || "");
  if (!rawPath || rawPath.includes("..")) {
    return new Response("资源不存在", { status: 404 });
  }

  const key = `media/${rawPath}`;
  const object = await env.BLOG_BUCKET.get(key);
  if (!object) return new Response("资源不存在", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  // 禁止浏览器按内容嗅探类型，配合上传侧的类型归一阻断存储型 XSS。
  headers.set("x-content-type-options", "nosniff");

  // 只有白名单图片允许内联展示，其余一律强制下载，避免在主域执行。
  const contentType = headers.get("content-type") || "";
  if (!isInlineImageType(contentType)) {
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
  }

  return new Response(object.body, { headers });
};
