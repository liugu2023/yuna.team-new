// 站点公开接口客户端。只用公开接口，不需要任何密钥，也不写入线上数据。
import { style } from "./ui.js";

export const DEFAULT_BASE = "https://www.yuna.team";

export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    if (status !== undefined) this.status = status;
  }
}

export interface PostAuthor {
  name?: string;
  url?: string;
  avatar?: string;
}

/** `/api/posts` 与 `/api/posts/:slug` 返回的文章结构（服务端下划线命名）。 */
export interface PublicPost {
  id: number;
  slug: string;
  title: string;
  tag: string | null;
  excerpt: string | null;
  cover_url: string | null;
  status: "draft" | "published";
  kind: "article" | "knowledge";
  author_name: string | null;
  author_url: string | null;
  author_avatar: string | null;
  created_at: string | null;
  updated_at: string | null;
  published_at: string | null;
  view_count: number | null;
  coauthors?: PostAuthor[];
}

export interface SiteRecord {
  key: string;
  title: string;
  kind: "markdown" | "json";
  content: string;
  updated_at: string;
}

export interface ProjectEntry {
  id: string;
  title: string;
  category: string;
  status: "planning" | "building" | "maintaining" | "archived";
  network: "public" | "internal" | "unspecified";
  summary: string;
  owner: string;
  tags: string[];
  description: string;
  siteUrl: string;
  repoUrl: string;
}

export interface LessonEntry {
  date: string;
  session: string;
  topic: string;
  department: string;
  instructor: string;
  location: string;
  status: "planned" | "completed" | "cancelled";
  links: Array<{ label: string; url: string }>;
}

export interface LessonTerm {
  label: string;
  subtitle: string;
  order: number;
  lessons: LessonEntry[];
}

export interface LessonPlan {
  title: string;
  terms: LessonTerm[];
}

export interface ApiClientOptions {
  base?: string;
  timeoutMs?: number;
}

function normalizeBase(value: string): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_BASE;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export class YunaApi {
  readonly base: string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions = {}) {
    this.base = normalizeBase(options.base ?? process.env.YUNA_API_BASE ?? DEFAULT_BASE);
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /** 拼出站点页面地址（给 `yuna open` 和输出里的链接用）。 */
  url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(this.url(path));
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "yuna-cli" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? `请求超时（${this.timeoutMs}ms）` : String((error as Error)?.message ?? error);
      throw new ApiError(`无法连接 ${url.origin}：${reason}\n${style.dim("  提示：用 --base <地址> 或环境变量 YUNA_API_BASE 指定其它站点。")}`);
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(`接口返回了非 JSON 响应（HTTP ${response.status}）。`, response.status);
    }

    if (!response.ok) {
      const message = (payload as { error?: string } | null)?.error || `请求失败（HTTP ${response.status}）`;
      throw new ApiError(message, response.status);
    }
    return payload as T;
  }

  async listPosts(options: { kind?: string; limit?: number; page?: number } = {}): Promise<PublicPost[]> {
    const data = await this.get<{ posts?: PublicPost[] }>("/api/posts", {
      kind: options.kind,
      page: options.page,
      perPage: options.limit,
    });
    return data.posts ?? [];
  }

  async getPost(slug: string): Promise<{ post: PublicPost; markdown: string }> {
    const data = await this.get<{ post: PublicPost; markdown?: string }>(`/api/posts/${encodeURIComponent(slug)}`);
    return { post: data.post, markdown: data.markdown ?? "" };
  }

  async getRecords(keys: string[]): Promise<Record<string, SiteRecord | null>> {
    if (!keys.length) return {};
    const data = await this.get<{ records?: Record<string, SiteRecord | null> }>("/api/site", { keys: keys.join(",") });
    return data.records ?? {};
  }

  /** 读取一条 JSON 站点记录；记录不存在时返回 null（与页面“没有数据就展示空状态”一致）。 */
  async getJsonRecord<T>(key: string): Promise<T | null> {
    const records = await this.getRecords([key]);
    const record = records[key] ?? null;
    if (!record) return null;
    if (record.kind !== "json") throw new ApiError(`站点记录 ${key} 的类型不是 JSON。`);
    try {
      return JSON.parse(record.content || "null") as T;
    } catch {
      throw new ApiError(`站点记录 ${key} 的内容不是合法 JSON。`);
    }
  }
}
