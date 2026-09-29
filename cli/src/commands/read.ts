// yuna read <slug> —— 在终端读一篇文章（Markdown 渲染）。
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { formatCount, formatDate, joinParts } from "../context.js";
import { renderMarkdown } from "../markdown.js";
import { openInBrowser } from "../open.js";
import { keyValueRows, style, wrapText } from "../ui.js";

export async function runRead(ctx: CommandContext): Promise<void> {
  const slug = (ctx.positionals[0] ?? "").trim();
  if (!slug) throw new UsageError("用法：yuna read <slug>（slug 可以从 yuna posts 的输出里看到）");

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
