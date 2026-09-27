import { abortMultipartMediaUpload } from "../../../_shared/multipart-upload";
import { adminUpload } from "../../../_shared/upload-auth";

export const onRequestPost = adminUpload((env, request, actor) =>
  abortMultipartMediaUpload(env, request, { allowPath: actor.allowPath }),
);
