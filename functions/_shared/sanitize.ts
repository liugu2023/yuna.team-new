import type { PostRecord, SiteRecord } from "./types";

// 面向前台/通用接口输出时剥掉内部字段，避免公开响应暴露成员登录邮箱。
// 管理端导出（/api/admin/export）和 GitHub 备份仍使用完整记录。

export type PublicPost = Omit<PostRecord, "author_email">;

export function toPublicPost(post: PostRecord): PublicPost {
  const { author_email: _authorEmail, ...publicPost } = post;
  return publicPost;
}

export type PublicSiteRecord = Omit<SiteRecord, "updated_by">;

export function toPublicSiteRecord(record: SiteRecord): PublicSiteRecord {
  const { updated_by: _updatedBy, ...publicRecord } = record;
  return publicRecord;
}
