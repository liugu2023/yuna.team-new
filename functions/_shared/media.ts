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
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function isAllowedMediaMigrationPath(env: Env, path: string): boolean {
  const prefixes = mediaMigrationPrefixes(env);
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function mediaMigrationPrefixes(env: Env): string[] {
  const raw = (env.R2_MIGRATION_PREFIXES || "activates").trim();
  return raw
    .split(",")
    .map((prefix) => normalizeMediaPath(prefix).replace(/^\/+|\/+$/g, "").replace(/^media\//, ""))
    .filter((prefix) => prefix && isSafeMediaPath(`${prefix}/placeholder`));
}
