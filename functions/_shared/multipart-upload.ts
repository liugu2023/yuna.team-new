import { badRequest, forbidden, json, readJson } from "./http";
import {
  MULTIPART_UPLOAD_MAX_PART_BYTES,
  MULTIPART_UPLOAD_PART_BYTES,
  isSafeMediaPath,
  mediaKey,
  mediaUrl,
  normalizeMediaPath,
  resolveStoredContentType,
} from "./media";
import type { Env } from "./types";

interface InitUploadPayload {
  path?: string;
  contentType?: string;
  size?: number;
}

interface CompleteUploadPayload {
  path?: string;
  uploadId?: string;
  parts?: R2UploadedPart[];
}

interface AbortUploadPayload {
  path?: string;
  uploadId?: string;
}

interface MultipartMediaUploadOptions {
  allowPath?: (path: string) => boolean;
}

export async function initMultipartMediaUpload(
  env: Env,
  request: Request,
  uploadedBy: string,
  options: MultipartMediaUploadOptions = {},
): Promise<Response> {
  const payload = await readJson<InitUploadPayload>(request);
  if (!payload) return badRequest("上传初始化参数无效");

  const path = normalizeUploadPath(payload.path);
  if (!path) return badRequest("媒体路径无效");
  if (!isAllowedUploadPath(path, options)) return forbidden();

  const contentType = resolveStoredContentType(path, payload.contentType || "");
  const upload = await env.BLOG_BUCKET.createMultipartUpload(mediaKey(path), {
    httpMetadata: { contentType },
    customMetadata: {
      uploadedBy,
      originalSize: Number.isFinite(payload.size) ? String(payload.size) : "",
    },
  });

  return json({
    key: upload.key,
    path,
    url: mediaUrl(path),
    uploadId: upload.uploadId,
    partSize: MULTIPART_UPLOAD_PART_BYTES,
    maxPartSize: MULTIPART_UPLOAD_MAX_PART_BYTES,
    contentType,
  });
}

export async function uploadMultipartMediaPart(
  env: Env,
  request: Request,
  options: MultipartMediaUploadOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizeUploadPath(url.searchParams.get("path"));
  const uploadId = (url.searchParams.get("uploadId") || "").trim();
  const partNumber = Number(url.searchParams.get("partNumber") || "0");

  if (!path) return badRequest("媒体路径无效");
  if (!isAllowedUploadPath(path, options)) return forbidden();
  if (!uploadId) return badRequest("缺少 uploadId");
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return badRequest("分片序号无效");
  }
  if (!request.body) return badRequest("缺少上传内容");

  // content-length 头可以伪造或缺失（chunked），这里按实际字节校验上限。
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MULTIPART_UPLOAD_MAX_PART_BYTES) {
    return badRequest("单个分片不能超过 16MB");
  }

  const upload = env.BLOG_BUCKET.resumeMultipartUpload(mediaKey(path), uploadId);
  const part = await upload.uploadPart(partNumber, buffer);
  return json(part);
}

export async function completeMultipartMediaUpload(
  env: Env,
  request: Request,
  options: MultipartMediaUploadOptions = {},
): Promise<Response> {
  const payload = await readJson<CompleteUploadPayload>(request);
  if (!payload) return badRequest("完成上传参数无效");

  const path = normalizeUploadPath(payload.path);
  if (!path) return badRequest("媒体路径无效");
  if (!isAllowedUploadPath(path, options)) return forbidden();
  if (!payload.uploadId) return badRequest("缺少 uploadId");

  const parts = normalizeUploadedParts(payload.parts);
  if (!parts.length) return badRequest("缺少上传分片");

  const upload = env.BLOG_BUCKET.resumeMultipartUpload(mediaKey(path), payload.uploadId);
  const object = await upload.complete(parts);

  return json({
    key: object.key,
    url: mediaUrl(path),
    size: object.size,
    etag: object.etag,
    contentType: object.httpMetadata?.contentType || "",
  });
}

export async function abortMultipartMediaUpload(
  env: Env,
  request: Request,
  options: MultipartMediaUploadOptions = {},
): Promise<Response> {
  const payload = await readJson<AbortUploadPayload>(request);
  if (!payload) return badRequest("取消上传参数无效");

  const path = normalizeUploadPath(payload.path);
  if (!path) return badRequest("媒体路径无效");
  if (!isAllowedUploadPath(path, options)) return forbidden();
  if (!payload.uploadId) return badRequest("缺少 uploadId");

  const upload = env.BLOG_BUCKET.resumeMultipartUpload(mediaKey(path), payload.uploadId);
  await upload.abort();
  return json({ ok: true });
}

function normalizeUploadPath(value: unknown): string {
  const path = normalizeMediaPath(String(value || ""))
    .replace(/^\/+|\/+$/g, "")
    .replace(/^media\//, "");
  return isSafeMediaPath(path) ? path : "";
}

function isAllowedUploadPath(path: string, options: MultipartMediaUploadOptions): boolean {
  return options.allowPath ? options.allowPath(path) : true;
}

function normalizeUploadedParts(value: unknown): R2UploadedPart[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((part) => ({
      partNumber: Number(part?.partNumber || 0),
      etag: String(part?.etag || ""),
    }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
    .sort((a, b) => a.partNumber - b.partNumber);
}
