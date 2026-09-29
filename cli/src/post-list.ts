import { ApiError, type PublicPost, type YunaApi } from "./api.js";
import { UsageError } from "./args.js";

export interface PostSelection { kind?: string; tag?: string; limit?: number }

/** 与网站分页上限一致；分页、筛选共用这一条路径，不丢弃第 50 / 500 篇后的内容。 */
export async function selectPosts(api: YunaApi, options: PostSelection = {}): Promise<PublicPost[]> {
  const { kind } = options;
  if (kind !== undefined && !["article", "knowledge"].includes(kind)) throw new UsageError("--kind 只支持 article 或 knowledge。");
  const tag = (options.tag ?? "").trim().toLocaleLowerCase();
  const wanted = options.limit ?? Number.POSITIVE_INFINITY;
  const selected: PublicPost[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await api.listPostPage({ kind, limit: 50, page });
    if (result.pagination && result.pagination.page !== page) throw new ApiError("文章接口返回的页码与请求不一致。");
    let added = 0;
    for (const post of result.posts) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      added++;
      if (!tag || String(post.tag ?? "").toLocaleLowerCase().includes(tag)) selected.push(post);
    }
    if (selected.length >= wanted) return selected.slice(0, wanted);
    // 错误接口反复返回同一页时明确失败，避免无限翻页或把部分结果说成全部。
    if (result.posts.length && !added) throw new ApiError("文章接口没有推进到下一页，无法取得完整列表。");
    if (result.pagination) {
      if (page >= result.pagination.totalPages) break;
      if (!result.posts.length) throw new ApiError("文章接口提前返回空页，分页信息不一致。");
    } else if (result.posts.length < 50) break;
  }
  return selected;
}
