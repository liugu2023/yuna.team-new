import type { Env } from "./types";

// 页面与 sitemap 共用同一解释规则；读不到有效开关时按进行中处理。
export async function isRecruitmentClosed(env: Env): Promise<boolean> {
  try {
    const record = await env.BLOG_DB.prepare("SELECT kind, content FROM site_records WHERE key = ?")
      .bind("recruitment-status")
      .first<{ kind: string; content: string }>();
    if (record?.kind !== "json") return false;
    const status = JSON.parse(record.content) as { closed?: boolean } | null;
    return status?.closed === true;
  } catch {
    return false;
  }
}

// 在 HTML 到达浏览器前处理状态，分享爬虫和禁用 JS 的访客也能得到正确内容。
export function renderRecruitmentRecap(response: Response, closed: boolean, base: string): Response {
  const title = closed ? "招新收官 · YUNA.BLOG" : "招新进行中 · YUNA.BLOG";
  const description = closed
    ? "YUNA 协会本届招新已经结束：这一届招新的记录、没赶上的三条参与路径，以及新成员接下来要做的事。"
    : "本届招新正在进行中，查看加入方式与公开课安排。";
  const robots = closed ? "index, follow" : "noindex, follow";
  const pageUrl = `${base.replace(/\/+$/, "")}/recap`;
  const result = new Response(response.body, response);
  result.headers.set("cache-control", "no-store");
  result.headers.set("x-robots-tag", robots);
  // 静态文件的校验值不能代表数据库里的开关状态。
  result.headers.delete("etag");
  result.headers.delete("last-modified");
  result.headers.delete("content-length");
  if (!result.body) return result;

  const content = (value: string) => ({
    element(element: Element) { element.setAttribute("content", value); },
  });
  const visibility = (visible: boolean) => ({
    element(element: Element) {
      if (visible) element.removeAttribute("hidden");
      else element.setAttribute("hidden", "");
    },
  });
  return new HTMLRewriter()
    .on("html", {
      element(element) { element.setAttribute("data-recruitment-rendered", closed ? "closed" : "open"); },
    })
    .on('[data-recruitment="open"]', visibility(!closed))
    .on('[data-recruitment="closed"]', visibility(closed))
    .on("title", { element(element) { element.setInnerContent(title); } })
    .on('meta[name="description"]', content(description))
    .on('meta[name="robots"]', content(robots))
    .on('meta[property="og:title"]', content(title))
    .on('meta[property="og:description"]', content(description))
    .on('meta[property="og:url"]', content(pageUrl))
    .on('link[rel="canonical"]', {
      element(element) { element.setAttribute("href", pageUrl); },
    })
    .transform(result);
}
