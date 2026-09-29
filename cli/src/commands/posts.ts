// yuna posts —— 已发布文章列表。
import type { PublicPost } from "../api.js";
import { positiveInt, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { formatCount, formatDate, joinParts } from "../context.js";
import { style } from "../ui.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export async function runPosts(ctx: CommandContext): Promise<void> {
  const limit = positiveInt(ctx.flags.limit, 10, "-n / --limit");
  const kind = ctx.flags.kind;
  if (kind && !["article", "knowledge"].includes(kind)) {
    throw new UsageError("--kind 只支持 article 或 knowledge。");
  }

  const tag = (ctx.flags.tag ?? "").trim().toLocaleLowerCase();
  const matchesTag = (post: PublicPost): boolean =>
    !tag || String(post.tag ?? "").toLocaleLowerCase().includes(tag);
  const wanted = ctx.flags.all ? Number.POSITIVE_INFINITY : limit;

  // 标签只能在本地过滤（接口不支持按标签查），所以带 --tag 时要先把页面翻够再截断，
  // 否则会先按 -n 取前几条、再把不匹配的丢掉，结果偏少。
  const collected: PublicPost[] = [];
  if (tag || ctx.flags.all) {
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await ctx.api.listPosts({ kind, limit: PAGE_SIZE, page });
      let added = 0;
      for (const post of batch) {
        if (seen.has(post.slug)) continue;
        seen.add(post.slug);
        collected.push(post);
        added += 1;
      }
      if (batch.length < PAGE_SIZE || added === 0) break;
      if (collected.filter(matchesTag).length >= wanted) break;
    }
  } else {
    collected.push(...(await ctx.api.listPosts({ kind, limit })));
  }

  const filtered = collected
    .filter(matchesTag)
    .slice(0, Number.isFinite(wanted) ? wanted : undefined);

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
    out(`  ${style.dim(String(position + 1).padStart(pad, "0"))}  ${style.bold(post.title)}`);
    if (meta) out(`      ${style.dim(meta)}`);
    out(`      ${style.underline(ctx.api.url(`/post?slug=${encodeURIComponent(post.slug)}`))}`);
    if (position !== filtered.length - 1) out();
  });

  out();
  out(style.dim(`共 ${filtered.length} 篇。用 yuna read <编号> 或 yuna read <slug> 阅读全文。`));
}
