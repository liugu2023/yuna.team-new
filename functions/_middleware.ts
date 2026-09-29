import { allowedOrigins } from "./_shared/oidc";
import { isRecruitmentClosed, renderRecruitmentRecap } from "./_shared/recruitment";
import type { Env } from "./_shared/types";

interface PostMetaRow {
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  status: string;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// 有对应静态详情页的部门。/page?p=departments/<key> 是旧站遗留的第二个入口，
// 与 /department-<key> 渲染同一条 D1 记录，需要 301 收口。列成白名单而不是
// 正则通配：将来多出一条没有静态页的 departments/* 记录时，不会跳到 404。
const DEPARTMENT_PAGES = new Set(["dev", "ops", "publicity", "security"]);

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

  // 部门旧入口 301 到静态详情页。用相对 Location 而不是拼绝对地址：
  // 站点挂在多个 CNAME 上，还可能经外部 CDN 回源，相对地址由客户端按
  // 实际访问的域名解析，不会把用户甩到另一个域名去。
  if (/^\/page(\.html)?$/.test(url.pathname) && request.method === "GET") {
    const department = /^departments\/([a-z]+)$/.exec((url.searchParams.get("p") || "").trim())?.[1];
    if (department && DEPARTMENT_PAGES.has(department)) {
      return new Response(null, {
        status: 301,
        headers: { location: `/department-${department}` },
      });
    }
  }

  // 收官页的正文显隐、索引与分享信息都由同一次状态读取决定。
  if (/^\/recap(\.html)?$/.test(url.pathname) && (request.method === "GET" || request.method === "HEAD")) {
    const assetRequest = new Request(request);
    assetRequest.headers.delete("if-none-match");
    assetRequest.headers.delete("if-modified-since");
    const response = await next(assetRequest);
    if (response.status !== 200 || !(response.headers.get("content-type") || "").includes("text/html")) return response;
    const closed = await isRecruitmentClosed(env);
    return renderRecruitmentRecap(response, closed, env.PUBLIC_BASE_URL || url.origin);
  }

  // /post.html：按 slug 把文章标题、摘要、封面注入 <head>，
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
  // Pages 会把 /post.html 308 到 /post，canonical 必须写跳转后的地址：
  // 指向一个会跳转的 URL 时 Google 会忽略 canonical，改用它自己解析的结果。
  const pageUrl = `${base}/post?slug=${encodeURIComponent(slug)}`;

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
    // canonical 必须逐篇指向自己：静态模板里所有文章共用一个 href，
    // 不改写的话搜索引擎会把全部文章折叠成同一个 URL，只收录其中一篇。
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", pageUrl);
      },
    })
    .transform(response);
};

function isAllowedOrigin(origin: string, url: URL, env: Env): boolean {
  if (origin === url.origin) return true;
  // 经外部 CDN 反代访问时浏览器的 Origin 是站点域名、回源 Host 是 pages.dev,
  // 两者不相等;凡在登录允许名单内的域名都视为本站,不算跨站写请求。
  return allowedOrigins(env).has(origin);
}
