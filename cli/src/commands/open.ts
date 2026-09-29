// yuna open <页面> —— 在默认浏览器里打开站点页面。
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { openInBrowser } from "../open.js";
import { style } from "../ui.js";

const PAGES: Record<string, string> = {
  home: "/",
  articles: "/articles",
  projects: "/projects",
  contribute: "/contribute",
  team: "/team",
  join: "/join",
  departments: "/departments",
  lesson: "/lesson-plan",
  "lesson-plan": "/lesson-plan",
  login: "/admin-login",
};

export async function runOpen(ctx: CommandContext): Promise<void> {
  const target = (ctx.positionals[0] ?? "").trim();
  if (!target) {
    throw new UsageError(
      `用法：yuna open <页面|路径|地址>\n  页面名：${Object.keys(PAGES).join(" / ")}\n  也可以：post:<slug>、page:<名字>、以 / 开头的路径、完整的 http(s) 地址`,
    );
  }

  let url: string;
  if (/^https?:\/\//i.test(target)) url = target;
  else if (target.startsWith("post:")) url = ctx.api.url(`/post?slug=${encodeURIComponent(target.slice(5))}`);
  else if (target.startsWith("page:")) url = ctx.api.url(`/page?p=${encodeURIComponent(target.slice(5))}`);
  else if (target.startsWith("/")) url = ctx.api.url(target);
  else if (PAGES[target.toLocaleLowerCase()]) url = ctx.api.url(PAGES[target.toLocaleLowerCase()] as string);
  else {
    throw new UsageError(
      `不认识的页面「${target}」。可用：${Object.keys(PAGES).join(" / ")}，或 post:<slug>、page:<名字>、以 / 开头的路径、完整 URL。`,
    );
  }

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ target, url }, null, 2));
    return;
  }
  ctx.out(url);
  const opened = await openInBrowser(url);
  if (!opened) ctx.out(style.dim("  没有找到可用的浏览器，请手动打开上面的地址。"));
}
