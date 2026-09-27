import { badRequest, forbidden, json } from "../../../_shared/http";
import {
  isAllowedMediaMigrationPath,
  isSafeMediaPath,
  mediaPathFromParams,
  putMediaObject,
} from "../../../_shared/media";
import { getAdminIdentity, getR2MigrationIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const admin = await getAdminIdentity(env, request);
  const migration = admin ? null : getR2MigrationIdentity(env, request);
  const actor = admin || migration;
  if (!actor) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const rawPath = mediaPathFromParams(params.path);
  if (!isSafeMediaPath(rawPath)) {
    return badRequest("媒体路径无效");
  }
  // 管理员可写任意前缀；迁移 token 只能写 R2_MIGRATION_PREFIXES 允许的前缀。
  if (migration && !isAllowedMediaMigrationPath(env, rawPath)) {
    return forbidden();
  }

  return putMediaObject(env, request, rawPath, actor);
};
