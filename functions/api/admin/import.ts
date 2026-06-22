import { badRequest, json, readJson } from "../../_shared/http";
import { queueMarkdownGithubSync } from "../../_shared/github-markdown-sync";
import { getAdminIdentity } from "../../_shared/session";
import type { Env, PostRecord, SiteRecord } from "../../_shared/types";

interface DatabaseImportPayload {
  posts?: Partial<PostRecord>[];
  siteRecords?: Partial<SiteRecord>[];
  siteRecordBackups?: Partial<SiteRecordBackup>[];
}

interface SiteRecordBackup {
  id: string;
  record_key: string;
  title: string;
  kind: "markdown" | "json";
  content: string;
  changed_by: string;
  changed_at: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  // 导入会清空并覆盖全部数据，属于不可逆操作，要求显式声明意图，避免误调用。
  const url = new URL(request.url);
  if (url.searchParams.get("mode") !== "replace-all") {
    return badRequest("导入会清空现有数据，请在请求中显式声明 mode=replace-all");
  }

  const payload = await readJson<DatabaseImportPayload>(request);
  if (!payload) return badRequest("导入文件不是有效的 JSON");
  if (!Array.isArray(payload.posts) || !Array.isArray(payload.siteRecords)) {
    return badRequest("导入文件缺少 posts 或 siteRecords");
  }

  let posts: PostRecord[];
  let siteRecords: SiteRecord[];
  let backups: SiteRecordBackup[];
  try {
    posts = payload.posts.map(normalizePost);
    siteRecords = payload.siteRecords.map(normalizeSiteRecord);
    backups = Array.isArray(payload.siteRecordBackups)
      ? payload.siteRecordBackups.map(normalizeSiteRecordBackup)
      : [];
    ensureUnique(posts.map((post) => post.id), "文章 id 重复");
    ensureUnique(posts.map((post) => post.slug), "文章 slug 重复");
    ensureUnique(siteRecords.map((record) => record.key), "页面记录 key 重复");
    ensureUnique(backups.map((backup) => backup.id), "备份记录 id 重复");
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "导入数据格式有误");
  }

  // 删除前先把当前库快照到 R2，导入出错或选错文件时可据此还原。
  const snapshotKey = await snapshotCurrentDatabase(env, admin);

  const statements: D1PreparedStatement[] = [
    env.BLOG_DB.prepare("DELETE FROM site_record_backups"),
    env.BLOG_DB.prepare("DELETE FROM site_records"),
    env.BLOG_DB.prepare("DELETE FROM posts"),
  ];

  for (const post of posts) {
    statements.push(
      env.BLOG_DB.prepare(
        `INSERT INTO posts
          (id, slug, title, tag, excerpt, status, kind, r2_key, markdown_content, author_email, created_at, updated_at, published_at, view_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        post.id,
        post.slug,
        post.title,
        post.tag,
        post.excerpt,
        post.status,
        post.kind,
        post.r2_key,
        post.markdown_content,
        post.author_email,
        post.created_at,
        post.updated_at,
        post.published_at,
        post.view_count,
      ),
    );
  }

  for (const record of siteRecords) {
    statements.push(
      env.BLOG_DB.prepare(
        `INSERT INTO site_records (key, title, kind, content, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(record.key, record.title, record.kind, record.content, record.updated_by, record.updated_at),
    );
  }

  for (const backup of backups) {
    statements.push(
      env.BLOG_DB.prepare(
        `INSERT INTO site_record_backups
          (id, record_key, title, kind, content, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        backup.id,
        backup.record_key,
        backup.title,
        backup.kind,
        backup.content,
        backup.changed_by,
        backup.changed_at,
      ),
    );
  }

  await env.BLOG_DB.batch(statements);

  queueMarkdownGithubSync(env, waitUntil, "database:import", admin);

  return json({
    ok: true,
    importedBy: admin,
    importedAt: new Date().toISOString(),
    snapshotKey,
    counts: {
      posts: posts.length,
      siteRecords: siteRecords.length,
      siteRecordBackups: backups.length,
    },
  });
};

// 把导入前的全库内容写入 R2，作为一次性还原点。命名带时间戳便于排序。
async function snapshotCurrentDatabase(env: Env, admin: string): Promise<string> {
  const [posts, siteRecords, backups] = await Promise.all([
    env.BLOG_DB.prepare("SELECT * FROM posts").all<PostRecord>(),
    env.BLOG_DB.prepare("SELECT * FROM site_records").all<SiteRecord>(),
    env.BLOG_DB.prepare("SELECT * FROM site_record_backups").all<SiteRecordBackup>(),
  ]);

  const snapshot = {
    version: 1,
    snapshotAt: new Date().toISOString(),
    snapshotBy: admin,
    reason: "pre-import",
    posts: posts.results ?? [],
    siteRecords: siteRecords.results ?? [],
    siteRecordBackups: backups.results ?? [],
  };

  const key = `db-snapshots/pre-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await env.BLOG_BUCKET.put(key, JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { snapshotBy: admin, reason: "pre-import" },
  });

  return key;
}

function normalizePost(input: Partial<PostRecord>): PostRecord {
  const slug = requireText(input.slug, "文章 slug 不能为空");
  const status = input.status === "published" ? "published" : "draft";
  const kind = input.kind === "knowledge" ? "knowledge" : "article";
  const now = new Date().toISOString();
  return {
    id: text(input.id) || crypto.randomUUID(),
    slug,
    title: requireText(input.title, `文章 ${slug} 缺少标题`),
    tag: text(input.tag).trim() || "协会动态",
    excerpt: text(input.excerpt),
    status,
    kind,
    r2_key: text(input.r2_key) || `db/${kind === "knowledge" ? "knowledge" : "posts"}/${slug}.md`,
    markdown_content: text(input.markdown_content),
    author_email: text(input.author_email),
    created_at: text(input.created_at) || now,
    updated_at: text(input.updated_at) || now,
    published_at: input.published_at ? text(input.published_at) : null,
    view_count: integer(input.view_count),
  };
}

function normalizeSiteRecord(input: Partial<SiteRecord>): SiteRecord {
  const key = requireText(input.key, "页面记录 key 不能为空");
  const kind = input.kind === "json" ? "json" : "markdown";
  return {
    key,
    title: requireText(input.title, `页面记录 ${key} 缺少标题`),
    kind,
    content: text(input.content),
    updated_by: text(input.updated_by),
    updated_at: text(input.updated_at) || new Date().toISOString(),
  };
}

function normalizeSiteRecordBackup(input: Partial<SiteRecordBackup>): SiteRecordBackup {
  const recordKey = requireText(input.record_key, "备份记录缺少 record_key");
  const kind = input.kind === "json" ? "json" : "markdown";
  return {
    id: text(input.id) || crypto.randomUUID(),
    record_key: recordKey,
    title: requireText(input.title, `备份记录 ${recordKey} 缺少标题`),
    kind,
    content: text(input.content),
    changed_by: text(input.changed_by),
    changed_at: text(input.changed_at) || new Date().toISOString(),
  };
}

function requireText(value: unknown, message: string): string {
  const result = text(value).trim();
  if (!result) throw new Error(message);
  return result;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function integer(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function ensureUnique(values: string[], message: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(message);
    seen.add(value);
  }
}
