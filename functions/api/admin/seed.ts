import { json } from "../../_shared/http";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

const samplePosts = [
  {
    slug: "yuna-news-system-online",
    title: "YUNA 最新动态系统上线",
    excerpt: "协会官网新增动态发布系统，用于记录活动、课程和通知。",
    markdown: `# YUNA 最新动态系统上线

这是第一篇测试动态。当前系统使用 **Cloudflare Pages** 提供静态页面，使用 D1 保存文章元数据，并把 Markdown 正文存储在 R2。

后续可以继续加入标签、图片上传、RSS 和活动归档，让协会新闻和课程通知更容易维护。`,
  },
  {
    slug: "authentik-member-login",
    title: "成员登录接入 Authentik",
    excerpt: "动态管理后台通过 Authentik OIDC 登录，访问权限由协会统一账号系统控制。",
    markdown: `# 成员登录接入 Authentik

动态管理后台已经接入 Authentik。

- 首页默认显示成员登录入口
- 登录成功后显示管理后台入口
- 回调地址固定为 \`https://yuna.liugu.cc/auth/callback\`

本地系统只校验 OIDC 登录是否成功，具体谁能进入应用由 Authentik 侧配置。`,
  },
  {
    slug: "markdown-news-workflow",
    title: "动态内容采用 Markdown 编写",
    excerpt: "协会动态以 Markdown 文件形式写入 R2，方便成员协作和长期归档。",
    markdown: `# 动态内容采用 Markdown 编写

动态正文不会直接塞进数据库，而是以 \`.md\` 文件写入 R2。

D1 中只保存：

- 标题
- 链接标识
- 摘要
- 发布状态
- R2 对象路径

这样后续要做导出、版本管理或者图片资源关联都会更简单。`,
  },
];

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session.user_email)) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const created: PostRecord[] = [];
  const skipped: string[] = [];

  for (const sample of samplePosts) {
    const existing = await env.BLOG_DB.prepare("SELECT slug FROM posts WHERE slug = ?")
      .bind(sample.slug)
      .first<{ slug: string }>();

    if (existing) {
      skipped.push(sample.slug);
      continue;
    }

    const r2Key = `posts/${sample.slug}.md`;
    await env.BLOG_BUCKET.put(r2Key, sample.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { slug: sample.slug, title: sample.title },
    });

    const id = crypto.randomUUID();
    await env.BLOG_DB.prepare(
      `INSERT INTO posts
        (id, slug, title, excerpt, status, r2_key, author_email, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        sample.slug,
        sample.title,
        sample.excerpt,
        r2Key,
        session.user_email,
        now,
        now,
        now,
      )
      .run();

    const post = await env.BLOG_DB.prepare("SELECT * FROM posts WHERE id = ?")
      .bind(id)
      .first<PostRecord>();

    if (post) created.push(post);
  }

  return json({ created, skipped });
};
