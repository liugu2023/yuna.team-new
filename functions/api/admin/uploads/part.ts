import { uploadMultipartMediaPart } from "../../../_shared/multipart-upload";
import { json } from "../../../_shared/http";
import { isAllowedMediaMigrationPath } from "../../../_shared/media";
import { getAdminIdentity, getR2MigrationIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  const migration = admin ? null : getR2MigrationIdentity(env, request);
  if (!admin && !migration) return json({ error: "需要管理员登录" }, { status: 401 });
  return uploadMultipartMediaPart(env, request, {
    allowPath: (path) => Boolean(admin) || isAllowedMediaMigrationPath(env, path),
  });
};
