// yuna read <编号|slug> —— 在终端读一篇文章（Markdown 渲染）。
import { positiveInt, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { formatCount, formatDate, joinParts } from "../context.js";
import { renderMarkdown } from "../markdown.js";
import { openInBrowser } from "../open.js";
import { keyValueRows, style, wrapText } from "../ui.js";
import { loadPostHistory } from "../history.js";
import { selectPosts } from "../post-list.js";

/** 无筛选时读取最近一次 posts 的快照；显式筛选则按相同规则查询当前结果。 */
async function resolveSlug(ctx: CommandContext, input: string): Promise<string> {
  if (ctx.flags.slug || !/^\d+$/.test(input)) {
    if (ctx.flags.tag !== undefined || ctx.flags.kind !== undefined) throw new UsageError("按 slug 阅读时不需要 --tag 或 --kind；筛选只用于编号查询。");
    return input;
  }
  const index = positiveInt(input, 1, "文章编号");
  if (ctx.flags.tag !== undefined || ctx.flags.kind !== undefined) {
    const posts = await selectPosts(ctx.api, { tag: ctx.flags.tag, kind: ctx.flags.kind, limit: index });
    const post = posts[index - 1];
    if (!post) throw new UsageError(`筛选结果中没有第 ${index} 篇（共 ${posts.length} 篇）。`);
    return post.slug;
  }
  const slugs = await loadPostHistory(ctx.api.base);
  if (!slugs) throw new UsageError("还没有本站的文章列表。请先运行 yuna posts，或使用 yuna read <slug>。");
  const slug = slugs[index - 1];
  if (!slug) throw new UsageError(`最近一次列表只有 ${slugs.length} 篇，没有编号 ${index}。运行 yuna posts --all 获取完整列表。`);
  return slug;
}

export async function runRead(ctx: CommandContext): Promise<void> {
  const input = (ctx.positionals[0] ?? "").trim();
  if (!input) throw new UsageError("用法：yuna read <编号|slug>（编号来自 yuna posts 的列表）");

  const slug = await resolveSlug(ctx, input);
  const pageUrl = ctx.api.url(`/post?slug=${encodeURIComponent(slug)}`);

  if (ctx.flags.web) {
    if (ctx.flags.json) {
      ctx.out(JSON.stringify({ slug, url: pageUrl }, null, 2));
      return;
    }
    ctx.out(pageUrl);
    const opened = await openInBrowser(pageUrl);
    if (!opened) throw new UsageError("无法打开浏览器，请手动访问上面的地址。");
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
