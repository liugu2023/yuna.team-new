import { badRequest, json } from "../../_shared/http";
import { toPublicSiteRecord, type PublicSiteRecord } from "../../_shared/sanitize";
import type { Env, SiteRecord } from "../../_shared/types";

// 批量读取站点文案：GET /api/site?keys=a,b,c
// 页面上的可编辑块、页脚、公告等一次页面加载会请求十几个 key，
// 这里合并为一次 D1 查询。缺失的 key 返回 null，由前端回退到内置文案。
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const keys = [
    ...new Set(
      (url.searchParams.get("keys") || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];

  if (!keys.length) return badRequest("缺少 keys 参数");
  if (keys.length > 80) return badRequest("keys 数量过多");
  if (keys.some((key) => key.length > 120)) return badRequest("key 过长");

  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.BLOG_DB.prepare(
    `SELECT * FROM site_records WHERE key IN (${placeholders})`,
  )
    .bind(...keys)
    .all<SiteRecord>();

  const records: Record<string, PublicSiteRecord | null> = {};
  for (const key of keys) records[key] = null;
  for (const record of results || []) records[record.key] = toPublicSiteRecord(record);

  return json({ records });
};
