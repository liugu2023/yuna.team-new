import type { Env } from "../_shared/types";

export const onRequestGet: PagesFunction<Env, "path"> = async ({ env, params }) => {
  const rawPath = String(params.path || "");
  if (!rawPath || rawPath.includes("..")) {
    return new Response("资源不存在", { status: 404 });
  }

  const key = `media/${rawPath}`;
  const object = await env.BLOG_BUCKET.get(key);
  if (!object) return new Response("资源不存在", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
};
