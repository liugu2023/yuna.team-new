import { uploadMultipartMediaPart } from "../../../_shared/multipart-upload";
import { contentUpload } from "../../../_shared/upload-auth";

export const onRequestPut = contentUpload((env, request, actor) =>
  uploadMultipartMediaPart(env, request, { allowPath: actor.allowPath }),
);
