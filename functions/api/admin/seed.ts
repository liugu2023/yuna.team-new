import { json } from "../../_shared/http";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

const samplePosts = [
  {
    slug: "yuna-blog-online",
    title: "Yuna 博客系统上线",
    excerpt: "新的博客系统已经迁移到 Cloudflare Pages、D1 和 R2。",
    markdown: `# Yuna 博客系统上线

这是第一篇测试动态。当前系统使用 **Cloudflare Pages** 提供静态页面，使用 D1 保存文章元数据，并把 Markdown 正文存储在 R2。

后续可以继续加入标签、图片上传、评论和 RSS。`,
  },
  {
    slug: "authentik-admin-login",
    title: "后台登录接入 Authentik",
    excerpt: "管理后台现在通过 Authentik OIDC 登录，权限交给 Authentik 应用侧控制。",
    markdown: `# 后台登录接入 Authentik

后台登录流程已经接入 Authentik。

- 登录入口在首页导航
- 登录成功后显示管理后台入口
- 回调地址固定为 \`https://yuna.liugu.cc/auth/callback\`

本地系统只校验 OIDC 登录是否成功，具体谁能进入应用由 Authentik 侧配置。`,
  },
  {
    slug: "markdown-r2-storage",
    title: "文章正文改用 Markdown 存储",
    excerpt: "文章正文以 Markdown 文件形式写入 R2，便于迁移、备份和后续扩展。",
    markdown: `# 文章正文改用 Markdown 存储

文章内容不会直接塞进数据库，而是以 \`.md\` 文件写入 R2。

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
