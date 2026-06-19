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

  const payload = await readJson<SaveSiteRecordPayload>(request);
  if (!payload?.title || !payload.kind || payload.content === undefined) {
    return badRequest("标题、类型和内容不能为空");
  }

  const record = await upsertSiteRecord(env, admin, {
    key: String(params.key),
    title: payload.title,
    kind: payload.kind,
    content: payload.content,
  });

  return json({ record });
};
