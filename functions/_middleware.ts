import type { Env } from "./_shared/types";

interface PostMetaRow {
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  status: string;
}

// 仅拦截 /post.html：按 slug 把文章标题、摘要、封面注入 <head>，
// 让搜索引擎与聊天工具分享卡片拿到真实内容。其余请求原样放行。
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  // Pages 的 pretty-URL 会把 /post.html 重定向到 /post，两种路径都要接住。
  if (!/^\/post(\.html)?$/.test(url.pathname) || request.method !== "GET") return next();

  const slug = url.searchParams.get("slug");
  const response = await next();
  if (!slug) return response;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

  let post: PostMetaRow | null = null;
  try {
    post = await env.BLOG_DB.prepare(
      "SELECT title, excerpt, cover_url, status FROM posts WHERE slug = ?",
    )
      .bind(slug)
      .first<PostMetaRow>();
  } catch {
    return response;
  }
  if (!post || post.status !== "published") return response;

  const base = (env.PUBLIC_BASE_URL || url.origin).replace(/\/+$/, "");
  const title = `${post.title} · 燕山大学大学生网络信息协会`;
  const description = (post.excerpt || "").trim().slice(0, 200) || "协会文章与学习记录。";
  const image = post.cover_url && /^(https?:\/\/|\/)/.test(post.cover_url)
    ? new URL(post.cover_url, `${base}/`).toString()
    : `${base}/images/og-image.png`;
  const pageUrl = `${base}/post.html?slug=${encodeURIComponent(slug)}`;

  const setContent = (value: string) => ({
    element(element: Element) {
      element.setAttribute("content", value);
    },
  });

  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', setContent(description))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:url"]', setContent(pageUrl))
    .on('meta[property="og:image"]', setContent(image))
    .on('meta[property="og:type"]', setContent("article"))
    .transform(response);
};
