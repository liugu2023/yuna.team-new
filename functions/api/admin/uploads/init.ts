import { initMultipartMediaUpload } from "../../../_shared/multipart-upload";
import { adminUpload } from "../../../_shared/upload-auth";

export const onRequestPost = adminUpload((env, request, actor) =>
  initMultipartMediaUpload(env, request, actor.identity, { allowPath: actor.allowPath }),
);
