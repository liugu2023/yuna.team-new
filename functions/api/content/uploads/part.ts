import { uploadMultipartMediaPart } from "../../../_shared/multipart-upload";
import { json } from "../../../_shared/http";
import { getContentEditorIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  const editor = await getContentEditorIdentity(env, request);
  if (!editor) return json({ error: "需要页面编辑权限" }, { status: 401 });
  return uploadMultipartMediaPart(env, request);
};
