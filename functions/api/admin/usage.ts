import { json } from "../../_shared/http";
import { getAdminIdentity } from "../../_shared/session";
import type { Env } from "../../_shared/types";

interface TableMetric {
  name: string;
  label: string;
  rows: number;
  estimatedBytes: number | null;
}

interface PrefixMetric {
  prefix: string;
  objects: number;
  bytes: number;
}

const TABLES = [
  {
    name: "posts",
    label: "文章与知识库",
    byteSql:
      "SELECT COALESCE(SUM(LENGTH(id) + LENGTH(slug) + LENGTH(title) + LENGTH(tag) + LENGTH(excerpt) + LENGTH(cover_url) + LENGTH(status) + LENGTH(kind) + LENGTH(r2_key) + LENGTH(markdown_content) + LENGTH(author_email) + LENGTH(created_at) + LENGTH(updated_at) + LENGTH(COALESCE(published_at, ''))), 0) AS bytes FROM posts",
  },
  {
    name: "site_records",
    label: "页面文案",
    byteSql:
      "SELECT COALESCE(SUM(LENGTH(key) + LENGTH(title) + LENGTH(kind) + LENGTH(content) + LENGTH(updated_by) + LENGTH(updated_at)), 0) AS bytes FROM site_records",
  },
  {
    name: "site_record_backups",
    label: "文案备份",
    byteSql:
      "SELECT COALESCE(SUM(LENGTH(id) + LENGTH(record_key) + LENGTH(title) + LENGTH(kind) + LENGTH(content) + LENGTH(changed_by) + LENGTH(changed_at)), 0) AS bytes FROM site_record_backups",
  },
  {
    name: "sessions",
    label: "登录会话",
    byteSql:
      "SELECT COALESCE(SUM(LENGTH(id) + LENGTH(user_email) + LENGTH(user_name) + LENGTH(user_groups) + LENGTH(created_at)), 0) AS bytes FROM sessions",
  },
] as const;

const R2_LIST_PAGE_LIMIT = 1000;
const R2_MAX_LIST_PAGES = 100;

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) return json({ error: "需要管理员登录" }, { status: 401 });

  const [database, bucket] = await Promise.all([collectDatabaseUsage(env), collectBucketUsage(env)]);

  return json({
    checkedAt: new Date().toISOString(),
    database,
    bucket,
  });
};

async function collectDatabaseUsage(env: Env) {
  const [pageCount, pageSize, tables] = await Promise.all([
    readPragmaNumber(env, "page_count"),
    readPragmaNumber(env, "page_size"),
    Promise.all(TABLES.map((table) => collectTableMetric(env, table))),
  ]);

  const estimatedContentBytes = tables.reduce((sum, table) => sum + (table.estimatedBytes || 0), 0);
  const sqliteBytes = pageCount && pageSize ? pageCount * pageSize : null;

  return {
    sqliteBytes,
    sqliteHuman: sqliteBytes === null ? null : humanSize(sqliteBytes),
    estimatedContentBytes,
    estimatedContentHuman: humanSize(estimatedContentBytes),
    pageCount,
    pageSize,
    tables,
    note:
      sqliteBytes === null
        ? "D1 未返回 SQLite 页信息，当前大小为按文本字段估算。"
        : "SQLite 页大小包含索引、空闲页和表结构，比文本内容估算更接近实际占用。",
  };
}

async function collectTableMetric(
  env: Env,
  table: (typeof TABLES)[number],
): Promise<TableMetric> {
  const rows = await env.BLOG_DB.prepare(`SELECT COUNT(*) AS rows FROM ${table.name}`)
    .first<{ rows: number }>()
    .then((result) => Number(result?.rows || 0))
    .catch(() => 0);

  const estimatedBytes = await env.BLOG_DB.prepare(table.byteSql)
    .first<{ bytes: number }>()
    .then((result) => Number(result?.bytes || 0))
    .catch(() => null);

  return {
    name: table.name,
    label: table.label,
    rows,
    estimatedBytes,
  };
}

async function readPragmaNumber(env: Env, name: "page_count" | "page_size"): Promise<number | null> {
  try {
    const row = await env.BLOG_DB.prepare(`PRAGMA ${name}`).first<Record<string, unknown>>();
    const value = Number(row?.[name] ?? Object.values(row || {})[0]);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function collectBucketUsage(env: Env) {
  const prefixes = new Map<string, PrefixMetric>();
  let cursor: string | undefined;
  let objects = 0;
  let bytes = 0;
  let pages = 0;
  let truncated = false;

  do {
    const page = await env.BLOG_BUCKET.list({ limit: R2_LIST_PAGE_LIMIT, cursor });
    pages += 1;
    for (const object of page.objects) {
      objects += 1;
      bytes += object.size;
      const prefix = topLevelPrefix(object.key);
      const metric = prefixes.get(prefix) || { prefix, objects: 0, bytes: 0 };
      metric.objects += 1;
      metric.bytes += object.size;
      prefixes.set(prefix, metric);
    }

    cursor = page.truncated ? page.cursor : undefined;
    truncated = Boolean(cursor);
  } while (cursor && pages < R2_MAX_LIST_PAGES);

  if (cursor) truncated = true;

  return {
    objects,
    bytes,
    human: humanSize(bytes),
    scannedPages: pages,
    truncated,
    prefixes: Array.from(prefixes.values()).sort((left, right) => right.bytes - left.bytes),
  };
}

function topLevelPrefix(key: string): string {
  const index = key.indexOf("/");
  return index > 0 ? `${key.slice(0, index)}/` : "(根目录)";
}

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}
