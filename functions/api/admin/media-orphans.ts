import { json } from "../../_shared/http";
import { getAdminIdentity } from "../../_shared/session";
import type { Env, PostRecord, SiteRecord } from "../../_shared/types";

// R2 对账：列出桶里所有对象，和数据库里的全部引用做 diff，找出没人引用的孤儿。
// GET  /api/admin/media-orphans            → dry-run，只列清单，不删任何东西
// POST /api/admin/media-orphans?confirm=delete → 实际删除孤儿（media 孤儿 + 旧 db/posts/*.md）
//
// 分类规则（按用户确认的策略）：
// - db-snapshots/ 前缀：导入前快照，安全网，始终保留、绝不删除。
// - media/ 前缀：在 posts / site_records / site_record_backups（含历史备份，保守）
//   的内容里找不到引用即为孤儿。
// - db/posts/*.md：markdown 已迁移进 D1，这些是旧残留，列为可删候选。
// - 其它未知前缀：只展示、不自动删，避免误伤。

interface ObjectEntry {
  key: string;
  size: number;
}

interface Classification {
  orphanMedia: ObjectEntry[];
  legacyPostMd: ObjectEntry[];
  snapshots: ObjectEntry[];
  unknown: ObjectEntry[];
  referencedCount: number;
  totalCount: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) return json({ error: "需要管理员登录" }, { status: 401 });

  const classification = await classifyObjects(env);
  return json(buildReport(classification, false));
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) return json({ error: "需要管理员登录" }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== "delete") {
    return json(
      { error: "删除是不可逆操作，请在请求中显式声明 confirm=delete" },
      { status: 400 },
    );
  }

  const classification = await classifyObjects(env);
  const toDelete = [...classification.orphanMedia, ...classification.legacyPostMd];

  // R2 delete 单次最多 1000 个 key，分批删。
  const deletedKeys = toDelete.map((entry) => entry.key);
  for (let i = 0; i < deletedKeys.length; i += 1000) {
    await env.BLOG_BUCKET.delete(deletedKeys.slice(i, i + 1000));
  }

  return json({
    ...buildReport(classification, true),
    deletedBy: admin,
    deletedAt: new Date().toISOString(),
    deletedCount: deletedKeys.length,
  });
};

async function classifyObjects(env: Env): Promise<Classification> {
  const objects = await listAllObjects(env);
  const referencedMediaPaths = await collectReferencedMediaPaths(env);

  const result: Classification = {
    orphanMedia: [],
    legacyPostMd: [],
    snapshots: [],
    unknown: [],
    referencedCount: 0,
    totalCount: objects.length,
  };

  for (const object of objects) {
    if (object.key.startsWith("db-snapshots/")) {
      result.snapshots.push(object);
      continue;
    }

    if (object.key.startsWith("media/")) {
      const path = object.key.slice("media/".length);
      if (referencedMediaPaths.has(path)) {
        result.referencedCount += 1;
      } else {
        result.orphanMedia.push(object);
      }
      continue;
    }

    if (object.key.startsWith("db/posts/") && object.key.endsWith(".md")) {
      result.legacyPostMd.push(object);
      continue;
    }

    result.unknown.push(object);
  }

  return result;
}

async function listAllObjects(env: Env): Promise<ObjectEntry[]> {
  const entries: ObjectEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.BLOG_BUCKET.list({ limit: 1000, cursor });
    for (const object of page.objects) {
      entries.push({ key: object.key, size: object.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return entries;
}

// 从数据库所有可能含媒体链接的文本里，提取出被引用的媒体 path（去掉 /media/ 前缀、解码）。
async function collectReferencedMediaPaths(env: Env): Promise<Set<string>> {
  const [posts, siteRecords, backups] = await Promise.all([
    env.BLOG_DB.prepare("SELECT markdown_content, excerpt, cover_url FROM posts").all<
      Pick<PostRecord, "markdown_content" | "excerpt" | "cover_url">
    >(),
    env.BLOG_DB.prepare("SELECT content FROM site_records").all<Pick<SiteRecord, "content">>(),
    // 保守策略：历史备份里引用的媒体也算被引用，避免回滚备份时图片已被清掉。
    env.BLOG_DB.prepare("SELECT content FROM site_record_backups").all<{ content: string }>(),
  ]);

  const haystack: string[] = [];
  for (const post of posts.results ?? []) {
    haystack.push(post.markdown_content || "", post.excerpt || "", post.cover_url || "");
  }
  for (const record of siteRecords.results ?? []) haystack.push(record.content || "");
  for (const backup of backups.results ?? []) haystack.push(backup.content || "");

  const referenced = new Set<string>();
  const text = haystack.join("\n");

  // 匹配 /media/... 或 media/...，以及旧的 /avatars/...（前端会改写为 /media/avatars/...）。
  const mediaPattern = /\/?media\/[^\s"')\]]+/g;
  const avatarPattern = /\/avatars\/[^\s"')\]]+/g;

  for (const match of text.matchAll(mediaPattern)) {
    referenced.add(decodePath(match[0].replace(/^\/?media\//, "")));
  }
  for (const match of text.matchAll(avatarPattern)) {
    referenced.add(decodePath(`avatars/${match[0].slice("/avatars/".length)}`));
  }

  return referenced;
}

function decodePath(path: string): string {
  // 去掉可能的查询串/锚点，再 decode，使其与 R2 key（存的是解码后的 path）对齐。
  const clean = path.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(clean).replace(/^(avatars|hall-of-fame|posts|knowledge|site),/i, "$1/");
  } catch {
    return clean.replace(/^(avatars|hall-of-fame|posts|knowledge|site),/i, "$1/");
  }
}

function buildReport(classification: Classification, executed: boolean) {
  const sum = (entries: ObjectEntry[]) => entries.reduce((acc, entry) => acc + entry.size, 0);
  const reclaimable = sum(classification.orphanMedia) + sum(classification.legacyPostMd);

  return {
    executed,
    summary: {
      totalObjects: classification.totalCount,
      referenced: classification.referencedCount,
      orphanMedia: classification.orphanMedia.length,
      legacyPostMd: classification.legacyPostMd.length,
      snapshotsKept: classification.snapshots.length,
      unknownKept: classification.unknown.length,
      reclaimableBytes: reclaimable,
      reclaimableHuman: humanSize(reclaimable),
    },
    orphanMedia: classification.orphanMedia,
    legacyPostMd: classification.legacyPostMd,
    unknown: classification.unknown,
  };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
