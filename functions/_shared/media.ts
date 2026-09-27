import { badRequest, json } from "./http";
import type { Env } from "./types";

// 媒体类型白名单：只有这些可以以原始类型内联渲染，其余一律按二进制处理。
// 目的是防止上传 HTML / SVG 等可执行内容后通过 /media/ 在主域形成存储型 XSS。
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  zip: "application/zip",
};

export const DIRECT_MEDIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const MULTIPART_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const MULTIPART_UPLOAD_MAX_PART_BYTES = 16 * 1024 * 1024;

function normalizeContentType(value: string): string {
  return (value || "").split(";")[0].trim().toLowerCase();
}

// 优先用文件扩展名推断类型，避免信任客户端声明的 content-type。
// 无法识别为安全图片时统一存为 application/octet-stream。
export function resolveStoredContentType(path: string, requested: string): string {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  const byExt = EXT_CONTENT_TYPE[ext];
  if (byExt) return byExt;

  const normalized = normalizeContentType(requested);
  if (INLINE_IMAGE_TYPES.has(normalized)) return normalized;

  return "application/octet-stream";
}

export function isInlineImageType(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(normalizeContentType(contentType));
}

export function normalizeMediaPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  return decoded.replace(/^(avatars|hall-of-fame|posts|knowledge|site),/i, "$1/");
}

export function isSafeMediaPath(path: string): boolean {
  if (!path || path.length > 512 || path.startsWith("/") || path.endsWith("/")) return false;
  if (/[\0\r\n\\]/.test(path)) return false;
  return path.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

export function mediaKey(path: string): string {
  return `media/${path}`;
}

export function mediaUrl(path: string): string {
  return `/media/${path.split("/").map(encodeMediaSegment).join("/")}`;
}

// encodeURIComponent 会放过 ()!'*，其中括号会截断 Markdown 链接和孤儿检测的 URL 提取，
// 这里补齐编码，保证生成的 /media/ 链接不含裸括号等歧义字符。
function encodeMediaSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[()!'*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function isAllowedMediaMigrationPath(env: Env, path: string): boolean {
  const prefixes = mediaMigrationPrefixes(env);
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// 内容编辑入口（/api/content/*）只允许写固定页面编辑器使用的 pages/ 前缀，
// 文章、头像、站点资源等其余前缀只能走管理端上传。
export function isContentEditorMediaPath(path: string): boolean {
  return path.startsWith("pages/");
}

function mediaMigrationPrefixes(env: Env): string[] {
  const raw = (env.R2_MIGRATION_PREFIXES || "activates").trim();
  return raw
    .split(",")
    .map((prefix) => normalizeMediaPath(prefix).replace(/^\/+|\/+$/g, "").replace(/^media\//, ""))
    .filter((prefix) => prefix && isSafeMediaPath(`${prefix}/placeholder`));
}

// 直传 PUT 的公共主体：/api/admin/media/* 和 /api/content/media/* 只有身份和
// 允许前缀不同，体积校验和类型归一是安全相关逻辑，抄两份迟早会分叉。
// 调用方负责鉴权与路径前缀校验。
export async function putMediaObject(
  env: Env,
  request: Request,
  rawPath: string,
  uploadedBy: string,
): Promise<Response> {
  // content-length 仅作快速拒绝；真正的上限按实际字节计量，防止伪造头绕过。
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > DIRECT_MEDIA_UPLOAD_MAX_BYTES) {
    return badRequest("媒体文件不能超过 10MB");
  }

  if (!request.body) {
    return badRequest("缺少上传内容");
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > DIRECT_MEDIA_UPLOAD_MAX_BYTES) {
    return badRequest("媒体文件不能超过 10MB");
  }

  // 不信任客户端声明的 content-type，按扩展名/白名单归一，避免存储型 XSS。
  const contentType = resolveStoredContentType(rawPath, request.headers.get("content-type") || "");
  const key = mediaKey(rawPath);
  await env.BLOG_BUCKET.put(key, buffer, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy },
  });

  return json({ key, url: mediaUrl(rawPath), contentType });
}

// catch-all 路由的 params.path 是分段数组，先拼回完整路径再归一化。
export function mediaPathFromParams(segments: string | string[] | undefined): string {
  return normalizeMediaPath(Array.isArray(segments) ? segments.join("/") : String(segments || ""));
}
