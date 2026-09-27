import { badRequest, forbidden, json } from "../../../_shared/http";
import {
  isContentEditorMediaPath,
  isSafeMediaPath,
  mediaPathFromParams,
  putMediaObject,
} from "../../../_shared/media";
import { getContentEditorIdentity } from "../../../_shared/session";
import type { Env } from "../../../_shared/types";

export const onRequestPut: PagesFunction<Env, "path"> = async ({ env, params, request }) => {
  const editor = await getContentEditorIdentity(env, request);
  if (!editor) {
    return json({ error: "需要页面编辑权限" }, { status: 401 });
  }

  const rawPath = mediaPathFromParams(params.path);
  if (!isSafeMediaPath(rawPath)) {
    return badRequest("媒体路径无效");
  }
  // 页面编辑器只能写 pages/ 前缀，其余前缀走管理端上传。
  if (!isContentEditorMediaPath(rawPath)) {
    return forbidden();
  }

  return putMediaObject(env, request, rawPath, editor);
};
