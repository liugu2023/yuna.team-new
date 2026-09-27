import { json } from "./http";
import { isAllowedMediaMigrationPath, isContentEditorMediaPath } from "./media";
import { getAdminIdentity, getContentEditorIdentity, getR2MigrationIdentity } from "./session";
import type { Env } from "./types";

// 上传入口的两套身份策略集中在这里：/api/admin/uploads/* 与 /api/content/uploads/*
// 各有 4 个路由文件（init/part/complete/abort），Pages 的文件路由要求它们各自存在，
// 但"谁能上传"和"能写哪些前缀"的判断只应有一处。原先这份判断在 8 个文件里各抄了一遍，
// 改策略必然漏改。

export interface UploadActor {
  identity: string;
  allowPath: (path: string) => boolean;
}

type UploadHandler = (
  env: Env,
  request: Request,
  actor: UploadActor,
) => Promise<Response>;

// 管理员走 CONTROL_GROUP；迁移脚本用 R2_MIGRATION_TOKEN，只允许写
// R2_MIGRATION_PREFIXES 指定的前缀。
async function adminActor(env: Env, request: Request): Promise<UploadActor | null> {
  const admin = await getAdminIdentity(env, request);
  const migration = admin ? null : getR2MigrationIdentity(env, request);
  const identity = admin || migration;
  if (!identity) return null;
  return {
    identity,
    allowPath: (path) => Boolean(admin) || isAllowedMediaMigrationPath(env, path),
  };
}

// 内容编辑入口只允许写 pages/ 前缀，文章、头像、站点资源只能走管理端上传。
async function contentActor(env: Env, request: Request): Promise<UploadActor | null> {
  const editor = await getContentEditorIdentity(env, request);
  if (!editor) return null;
  return { identity: editor, allowPath: isContentEditorMediaPath };
}

function wrap(
  resolve: (env: Env, request: Request) => Promise<UploadActor | null>,
  message: string,
  handler: UploadHandler,
): PagesFunction<Env> {
  return async ({ env, request }) => {
    const actor = await resolve(env, request);
    if (!actor) return json({ error: message }, { status: 401 });
    return handler(env, request, actor);
  };
}

export function adminUpload(handler: UploadHandler): PagesFunction<Env> {
  return wrap(adminActor, "需要管理员登录", handler);
}

export function contentUpload(handler: UploadHandler): PagesFunction<Env> {
  return wrap(contentActor, "需要页面编辑权限", handler);
}
