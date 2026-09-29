// yuna open <页面> —— 在默认浏览器里打开站点页面。
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { openInBrowser } from "../open.js";
import { resolveSafeLink } from "../links.js";

const PAGES: Record<string, string> = {
  home: "/",
  articles: "/articles",
  projects: "/projects",
  contribute: "/contribute",
  team: "/team",
  join: "/join",
  recap: "/recap",
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
  else if (target.startsWith("post:") && target.slice(5)) url = ctx.api.url(`/post?slug=${encodeURIComponent(target.slice(5))}`);
  else if (target.startsWith("page:") && target.slice(5)) url = ctx.api.url(`/page?p=${encodeURIComponent(target.slice(5))}`);
  else if (target.startsWith("/")) url = ctx.api.url(target);
  else if (Object.hasOwn(PAGES, target.toLocaleLowerCase())) url = ctx.api.url(PAGES[target.toLocaleLowerCase()] as string);
  else {
    throw new UsageError(
      `不认识的页面「${target}」。可用：${Object.keys(PAGES).join(" / ")}，或 post:<slug>、page:<名字>、以 / 开头的路径、完整 URL。`,
    );
  }

  url = resolveSafeLink(url, ctx.api.base);
  if (!/^https?:\/\//i.test(url)) throw new UsageError("要打开的地址必须是有效的 HTTP(S) 地址。");

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ target, url }, null, 2));
    return;
  }
  ctx.out(url);
  const opened = await openInBrowser(url);
  if (!opened) throw new UsageError("无法打开浏览器，请手动访问上面的地址。");
}
