import { uploadMultipartMediaPart } from "../../../_shared/multipart-upload";
import { adminUpload } from "../../../_shared/upload-auth";

export const onRequestPut = adminUpload((env, request, actor) =>
  uploadMultipartMediaPart(env, request, { allowPath: actor.allowPath }),
);
