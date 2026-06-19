import { json } from "../../_shared/http";
import { getSession, isAllowedAdmin } from "../../_shared/session";
import type { Env, PostRecord } from "../../_shared/types";

const samplePosts = [
  {
    slug: "welcome-to-yuna-news",
    title: "欢迎来到 YUNA 最新动态",
    excerpt: "这里会记录协会新闻、活动回顾、课程通知和成员故事。",
    markdown: `# 欢迎来到 YUNA 最新动态

这里是燕山大学大学生网络信息协会的动态发布区。

我们会在这里记录：

- 协会新闻
- 活动回顾
- 公开课通知
- 成员故事

动态正文使用 Markdown 编写，方便维护，也方便长期归档。`,
  },
  {
    slug: "first-open-course-notice",
    title: "近期公开课安排示例",
    excerpt: "这是一篇测试动态，用于展示课程通知类内容的写法。",
    markdown: `# 近期公开课安排示例

这是一篇用于测试的课程通知动态。

## 时间

周六晚 19:30

## 内容

- Web 开发入门
- 网络安全学习路线
- Linux 与服务器基础

欢迎对技术感兴趣的同学参加。`,
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
