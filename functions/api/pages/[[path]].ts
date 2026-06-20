import { badRequest, json, notFound, readJson } from "../../_shared/http";
import { getContentEditorIdentity } from "../../_shared/session";
import { getSiteRecord, upsertSiteRecord } from "../../_shared/site-records";
import type { Env } from "../../_shared/types";

interface SavePagePayload {
  title?: string;
  content?: string;
}

export const onRequestGet: PagesFunction<Env, "path"> = async ({ env, params }) => {
  const page = pagePath(params.path);
  if (!isSafePagePath(page)) return badRequest("页面路径无效");

  const record = await getSiteRecord(env, recordKey(page));
  if (!record || record.kind !== "markdown") return notFound("页面编辑记录不存在");

  return json({ page: record });
};

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const editor = await getContentEditorIdentity(env, request);
  if (!editor) {
    return json({ error: "需要页面编辑权限" }, { status: 401 });
  }

  const page = pagePath(params.path);
  if (!isSafePagePath(page)) return badRequest("页面路径无效");

  const payload = await readJson<SavePagePayload>(request);
  if (!payload || payload.content === undefined) {
    return badRequest("Markdown 内容不能为空");
  }

  const title = (payload.title || firstHeading(payload.content) || page).trim();
  if (!title) return badRequest("标题不能为空");

  const record = await upsertSiteRecord(env, editor, {
    key: recordKey(page),
    title,
    kind: "markdown",
    content: payload.content,
  });

  return json({ page: record });
};

function pagePath(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value.join("/") : String(value || "");
  return raw.replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
}

function recordKey(page: string): string {
  return `page:${page}`;
}

function isSafePagePath(page: string): boolean {
  return Boolean(page) && !page.includes("..") && /^[\w/\-\u4e00-\u9fa5\uff00-\uffef]+$/.test(page);
}

function firstHeading(markdown: string): string {
  const match = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}
