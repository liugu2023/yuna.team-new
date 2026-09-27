// 文章写入接口（POST /api/posts 与 PUT /api/posts/:slug）共用的入参规范化。
// 这些规则原先在两个路由文件里各抄了一份，校验口径一旦分叉就会出现
// "新建能过、编辑过不了"这类只在一条路径上复现的 bug，因此收敛到一处。

// 署名与登录账号解绑：作者、最后编辑人都由后台手动维护，留空时统一落到协会名。
export const DEFAULT_CREDIT_NAME = "网络信息协会";

const DEFAULT_TAG = "协会动态";

export function isValidStatus(value: string): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

export function normalizeKind(value: unknown): "article" | "knowledge" {
  return value === "knowledge" ? "knowledge" : "article";
}

export function normalizeTag(value: unknown): string {
  const tag = typeof value === "string" ? value.trim() : "";
  return tag || DEFAULT_TAG;
}

export function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// 返回 ""（没填）、规范化后的 URL，或 null（填了但不合法）。调用方按 null 报错。
export function normalizeHttpUrl(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

// 站内 /media/ 路径直接放行（不走 http/https 校验），其余按普通外链处理。
export function normalizeAvatarUrl(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  if (raw.length > 2048 || /[\0\r\n\\]/.test(raw)) return null;
  if (raw.startsWith("/media/") && !raw.startsWith("/media//")) return raw;
  return normalizeHttpUrl(raw);
}
