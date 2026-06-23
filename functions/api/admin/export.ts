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

  const url = new URL(request.url);
  const includeHistory = url.searchParams.get("history") === "1";
  const [posts, siteRecords] = await Promise.all([
    env.BLOG_DB.prepare("SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC").all<PostRecord>(),
    env.BLOG_DB.prepare("SELECT * FROM site_records ORDER BY key ASC").all<SiteRecord>(),
  ]);
  const siteRecordBackups = includeHistory
    ? await env.BLOG_DB.prepare("SELECT * FROM site_record_backups ORDER BY changed_at DESC").all<SiteRecordBackup>()
    : { results: [] as SiteRecordBackup[] };

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: admin,
    backupHistory: includeHistory ? "included" : "omitted",
    posts: posts.results ?? [],
    siteRecords: siteRecords.results ?? [],
    siteRecordBackups: siteRecordBackups.results ?? [],
  };

  if (url.searchParams.get("download") === "1") {
    const filename = `yuna-blog-db-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-content-type-options": "nosniff",
      },
    });
  }

  return json(payload);
};
