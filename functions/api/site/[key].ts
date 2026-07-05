import { json, notFound } from "../../_shared/http";
import { toPublicSiteRecord } from "../../_shared/sanitize";
import { getSiteRecord } from "../../_shared/site-records";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env, "key"> = async ({ env, params }) => {
  const key = String(params.key);
  const record = await getSiteRecord(env, key);
  if (!record && key.startsWith("footer-")) {
    return json({
      record: {
        key,
        title: "页脚文案",
        kind: "json",
        content: "{}",
        updated_at: "",
      },
    });
  }
  if (!record) return notFound("内容不存在");
  return json({ record: toPublicSiteRecord(record) });
};
