import { json, notFound } from "../../_shared/http";
import { toPublicSiteRecord } from "../../_shared/sanitize";
import { getSiteRecord } from "../../_shared/site-records";
import type { Env } from "../../_shared/types";

// 开发时就会读取、但后台尚未写入过的记录，先返回一个空壳而不是 404：
// 前端据此渲染兜底文案并挂上编辑入口，管理员保存一次之后就变成真实记录。
const PLACEHOLDER_RECORDS: Record<string, { title: string; kind: "markdown" | "json"; content: string }> = {
  "lesson-plan": { title: "授课计划", kind: "json", content: '{"terms":[]}' },
};

export const onRequestGet: PagesFunction<Env, "key"> = async ({ env, params }) => {
  const key = String(params.key);
  const record = await getSiteRecord(env, key);
  const placeholder = PLACEHOLDER_RECORDS[key];
  if (!record && placeholder) {
    return json({
      record: {
        key,
        ...placeholder,
        updated_at: "",
      },
    });
  }
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
