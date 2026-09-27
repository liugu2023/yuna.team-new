import { initMultipartMediaUpload } from "../../../_shared/multipart-upload";
import { contentUpload } from "../../../_shared/upload-auth";

export const onRequestPost = contentUpload((env, request, actor) =>
  initMultipartMediaUpload(env, request, actor.identity, { allowPath: actor.allowPath }),
);
