import type { Env } from "./_shared/types";

interface PostMetaRow {
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  status: string;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  // 写请求统一校验 Origin：浏览器发起的跨站写请求必带 Origin 头，
  // 与站点不符直接拒绝，作为会话 Cookie SameSite=Lax 之外的第二道 CSRF 防线。
  // 无 Origin 头的非浏览器客户端（curl、迁移脚本）放行，鉴权仍由各接口自己完成。
  if (STATE_CHANGING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && !isAllowedOrigin(origin, url, env)) {
      return new Response(JSON.stringify({ error: "跨站请求被拒绝" }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  }

  // 仅拦截 /post.html：按 slug 把文章标题、摘要、封面注入 <head>，
  // 让搜索引擎与聊天工具分享卡片拿到真实内容。其余请求原样放行。
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

function isAllowedOrigin(origin: string, url: URL, env: Env): boolean {
  if (origin === url.origin) return true;
  try {
    if (env.PUBLIC_BASE_URL && origin === new URL(env.PUBLIC_BASE_URL).origin) return true;
  } catch {
    // PUBLIC_BASE_URL 配置异常时忽略，仅按请求自身 origin 判断。
  }
  return false;
}
