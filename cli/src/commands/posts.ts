// yuna posts —— 已发布文章列表。
import { positiveInt } from "../args.js";
import type { CommandContext } from "../context.js";
import { formatCount, formatDate, joinParts } from "../context.js";
import { style } from "../ui.js";
import { savePostHistory } from "../history.js";
import { selectPosts } from "../post-list.js";

export async function runPosts(ctx: CommandContext): Promise<void> {
  const limit = positiveInt(ctx.flags.limit, 10, "-n / --limit");
  const kind = ctx.flags.kind;
  const tag = (ctx.flags.tag ?? "").trim().toLocaleLowerCase();
  const filtered = await selectPosts(ctx.api, { kind, tag, limit: ctx.flags.all ? undefined : limit });
  const numbered = await savePostHistory(ctx.api.base, filtered.map((post) => post.slug));
  if (!numbered) process.stderr.write("无法保存本次列表编号，请使用 yuna read <slug> 阅读。\n");

  if (ctx.flags.json) {
    ctx.out(JSON.stringify(filtered, null, 2));
    return;
  }

  const out = ctx.out;
  out();
  out(`  ${style.bold(style.brand("文章"))}${tag ? style.dim(` · 标签含「${ctx.flags.tag}」`) : ""}${kind ? style.dim(` · ${kind === "knowledge" ? "资料" : "文章"}`) : ""}`);

  if (!filtered.length) {
    out();
    out(style.dim(tag ? "没有匹配该标签的文章。" : "还没有已发布的文章。"));
    out(style.dim(`  ${ctx.api.base}/articles`));
    return;
  }

  out();
  const pad = String(filtered.length).length;
  filtered.forEach((post, position) => {
    const meta = joinParts([
      formatDate(post.published_at ?? post.updated_at),
      post.tag,
      post.kind === "knowledge" ? "资料" : null,
      `${formatCount(post.view_count)} 次阅读`,
    ]);
    out(`  ${style.dim(numbered ? String(position + 1).padStart(pad, "0") : post.slug)}  ${style.bold(post.title)}`);
    if (meta) out(`      ${style.dim(meta)}`);
    out(`      ${style.underline(ctx.api.url(`/post?slug=${encodeURIComponent(post.slug)}`))}`);
    if (position !== filtered.length - 1) out();
  });

  out();
  out(style.dim(`共 ${filtered.length} 篇。${numbered ? "编号对应本次列表，用 yuna read <编号> 阅读。" : "用 yuna read <slug> 阅读全文。"}`));
}
