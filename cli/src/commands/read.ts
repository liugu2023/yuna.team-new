// yuna read <编号|slug> —— 在终端读一篇文章（Markdown 渲染）。
import type { PublicPost } from "../api.js";
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { formatCount, formatDate, joinParts } from "../context.js";
import { renderMarkdown } from "../markdown.js";
import { openInBrowser } from "../open.js";
import { keyValueRows, style, wrapText } from "../ui.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/** 支持直接用 `yuna posts` 里的编号；编号按当前已发布列表的顺序解析。 */
async function resolveSlug(ctx: CommandContext, input: string): Promise<string> {
  if (!/^\d+$/.test(input)) return input;
  const index = Number(input);
  if (index < 1) throw new UsageError("编号从 1 开始。");

  const seen = new Set<string>();
  const posts: PublicPost[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await ctx.api.listPosts({ limit: PAGE_SIZE, page });
    for (const post of batch) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      posts.push(post);
    }
    if (batch.length < PAGE_SIZE || posts.length >= index) break;
  }

  const post = posts[index - 1];
  if (!post) {
    throw new UsageError(`没有第 ${index} 篇（当前共 ${posts.length} 篇已发布）。用 yuna posts 查看编号。`);
  }
  return post.slug;
}

export async function runRead(ctx: CommandContext): Promise<void> {
  const input = (ctx.positionals[0] ?? "").trim();
  if (!input) throw new UsageError("用法：yuna read <编号|slug>（编号来自 yuna posts 的列表）");

  const slug = await resolveSlug(ctx, input);
  const pageUrl = ctx.api.url(`/post?slug=${encodeURIComponent(slug)}`);

  if (ctx.flags.web) {
    ctx.out(pageUrl);
    const opened = await openInBrowser(pageUrl);
    if (!opened) ctx.out(style.dim("  没有找到可用的浏览器，请手动打开上面的地址。"));
    return;
  }

  const { post, markdown } = await ctx.api.getPost(slug);

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ post, markdown }, null, 2));
    return;
  }

  const out = ctx.out;
  const authors = joinParts([post.author_name, ...(post.coauthors ?? []).map((author) => author.name)]);
  out();
  for (const line of wrapText(style.bold(post.title), ctx.width, "  ")) out(line);
  out();
  for (const row of keyValueRows(
    [
      ["作者", authors],
      ["发布", formatDate(post.published_at ?? post.updated_at)],
      ["阅读", `${formatCount(post.view_count)} 次`],
      ["分类", joinParts([post.tag, post.kind === "knowledge" ? "资料" : null])],
      ["链接", pageUrl],
    ],
    "  ",
  )) {
    out(row);
  }
  out();
  out("  " + style.dim("─".repeat(Math.min(48, Math.max(8, ctx.width - 4)))));
  out();
  out(renderMarkdown(markdown || post.excerpt || "（这篇还没有正文）", ctx.width));
  out();
}
