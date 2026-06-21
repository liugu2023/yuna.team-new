import { uploadMultipartMediaPart } from "../../../_shared/multipart-upload";
import { json } from "../../../_shared/http";
import { getAdminIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) return json({ error: "需要管理员登录" }, { status: 401 });
  return uploadMultipartMediaPart(env, request);
};
