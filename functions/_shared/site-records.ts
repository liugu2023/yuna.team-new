import type { Env, SiteRecord } from "./types";

export async function getSiteRecord(env: Env, key: string): Promise<SiteRecord | null> {
  return env.BLOG_DB.prepare("SELECT * FROM site_records WHERE key = ?")
    .bind(key)
    .first<SiteRecord>();
}

export async function upsertSiteRecord(
  env: Env,
  actor: string,
  record: { key: string; title: string; kind: "markdown" | "json"; content: string },
): Promise<SiteRecord | null> {
  const existing = await getSiteRecord(env, record.key);
  const now = new Date().toISOString();

  if (existing) {
    await env.BLOG_DB.prepare(
      `INSERT INTO site_record_backups
        (id, record_key, title, kind, content, changed_by, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        existing.key,
        existing.title,
        existing.kind,
        existing.content,
        actor,
        now,
      )
      .run();
  }

  await env.BLOG_DB.prepare(
    `INSERT INTO site_records (key, title, kind, content, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       title = excluded.title,
       kind = excluded.kind,
       content = excluded.content,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  )
    .bind(record.key, record.title, record.kind, record.content, actor, now)
    .run();

  return getSiteRecord(env, record.key);
}
