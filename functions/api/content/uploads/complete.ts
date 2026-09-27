import { completeMultipartMediaUpload } from "../../../_shared/multipart-upload";
import { contentUpload } from "../../../_shared/upload-auth";

export const onRequestPost = contentUpload((env, request, actor) =>
  completeMultipartMediaUpload(env, request, { allowPath: actor.allowPath }),
);
