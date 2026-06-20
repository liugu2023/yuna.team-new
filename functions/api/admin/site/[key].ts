import { badRequest, json, readJson } from "../../../_shared/http";
import { getAdminIdentity } from "../../../_shared/session";
import { upsertSiteRecord } from "../../../_shared/site-records";
import type { Env } from "../../../_shared/types";

interface SaveSiteRecordPayload {
  title?: string;
  kind?: "markdown" | "json";
  content?: string;
}

export const onRequestPut: PagesFunction<Env, "key"> = async ({ env, params, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const key = String(params.key);
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    return badRequest("内容标识无效");
  }

  const payload = await readJson<SaveSiteRecordPayload>(request);
  if (!payload?.title || !payload.kind || payload.content === undefined) {
    return badRequest("标题、类型和内容不能为空");
  }

  const title = payload.title.trim();
  if (!title) return badRequest("标题不能为空");
  if (payload.kind !== "markdown" && payload.kind !== "json") {
    return badRequest("内容类型无效");
  }

  const record = await upsertSiteRecord(env, admin, {
    key,
    title,
    kind: payload.kind,
    content: payload.content,
  });

  return json({ record });
};
