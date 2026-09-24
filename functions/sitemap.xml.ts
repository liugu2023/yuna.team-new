import type { Env } from "./_shared/types";

// 静态页在这里手写一份：Pages Functions 运行时读不到静态资源目录，
// 没法自动枚举 public/*.html，新增独立页面时记得同步补进来。
// 路径一律不带 .html：Pages 会把 /x.html 308 到 /x，sitemap 里写会跳转的
// URL 等于让爬虫每条都多走一跳，且与 canonical 不一致。
const STATIC_ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/articles", changefreq: "daily", priority: "0.9" },
  { path: "/team", changefreq: "weekly", priority: "0.7" },
  { path: "/join", changefreq: "monthly", priority: "0.7" },
  { path: "/lesson-plan", changefreq: "weekly", priority: "0.7" },
  { path: "/departments", changefreq: "monthly", priority: "0.7" },
  { path: "/department-dev", changefreq: "monthly", priority: "0.6" },
  { path: "/department-ops", changefreq: "monthly", priority: "0.6" },
  { path: "/department-publicity", changefreq: "monthly", priority: "0.6" },
  { path: "/department-security", changefreq: "monthly", priority: "0.6" },
];

interface SitemapEntry {
  path: string;
  lastmod?: string | null;
  changefreq: string;
  priority: string;
}

interface PostRow {
  slug: string;
  lastmod: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  // 用 PUBLIC_BASE_URL 而不是请求域名：站点挂在多个 CNAME 上，
  // sitemap 必须只列 canonical 指向的那个域名，否则等于向 Google 提交重复站点。
  const base = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");

  // 不收录 /page?p=：仅存的 page 记录是 departments/*，而它们的内容已经由
  // /department-* 四个静态页渲染，两处提交等于重复收录。
  // D1 查询失败时降级成只有静态页的 sitemap，而不是整个 500——
  // 半份 sitemap 对搜索引擎仍然有效，返回错误则连首页都提交不上去。
  // 知识库已外链到 docs.yuna.team，本站只收 article。
  const posts = await env.BLOG_DB.prepare(
    `SELECT slug, COALESCE(published_at, updated_at) AS lastmod
       FROM posts
      WHERE kind = 'article' AND status = 'published'
      ORDER BY COALESCE(published_at, updated_at) DESC`,
  )
    .all<PostRow>()
    .catch(() => null);

  const entries: SitemapEntry[] = [
    ...STATIC_ENTRIES,
    ...(posts?.results ?? []).map((row) => ({
      path: `/post?slug=${encodeURIComponent(row.slug)}`,
      lastmod: row.lastmod,
      changefreq: "monthly",
      priority: "0.8",
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => renderUrl(base, entry)).join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};

function renderUrl(base: string, entry: SitemapEntry): string {
  const lastmod = toSitemapDate(entry.lastmod);
  return [
    "  <url>",
    `    <loc>${escapeXml(base + entry.path)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

// D1 里两种时间格式并存：应用写入的 ISO 字符串，和建表默认值 CURRENT_TIMESTAMP
// 产生的 "YYYY-MM-DD HH:MM:SS"（无时区）。统一只取日期部分：既是合法的
// W3C datetime，也绕开后者时区不明导致的偏差。
function toSitemapDate(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec((value || "").trim());
  return match ? match[1] : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
