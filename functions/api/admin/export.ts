import { json } from "../../_shared/http";
import { getAdminIdentity } from "../../_shared/session";
import type { Env, PostRecord, SiteRecord } from "../../_shared/types";

interface SiteRecordBackup {
  id: string;
  record_key: string;
  title: string;
  kind: "markdown" | "json";
  content: string;
  changed_by: string;
  changed_at: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const [posts, siteRecords, siteRecordBackups] = await Promise.all([
    env.BLOG_DB.prepare("SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC").all<PostRecord>(),
    env.BLOG_DB.prepare("SELECT * FROM site_records ORDER BY key ASC").all<SiteRecord>(),
    env.BLOG_DB.prepare("SELECT * FROM site_record_backups ORDER BY changed_at DESC").all<SiteRecordBackup>(),
  ]);

  return json({
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: admin,
    posts: posts.results ?? [],
    siteRecords: siteRecords.results ?? [],
    siteRecordBackups: siteRecordBackups.results ?? [],
  });
};
