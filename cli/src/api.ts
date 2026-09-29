// 站点公开接口客户端。只用公开接口，不需要任何密钥，也不写入线上数据。
import { style } from "./ui.js";
import { fetchImpl } from "./net.js";

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
  id: string;
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

export interface PostPage {
  posts: PublicPost[];
  pagination?: { page: number; perPage: number; total: number; totalPages: number };
}

function normalizeBase(value: string): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_BASE;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new ApiError("站点地址无效：--base 需要 HTTP(S) 地址，不能包含登录凭据、查询参数或锚点。");
  }
}

/** 把 undici 藏在 error.cause 里的真实原因（ENOTFOUND / ECONNREFUSED / 证书错误…）拿出来。 */
function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") return `请求超时（${timeoutMs}ms）`;
  const details = new Set<string>();
  const seen = new Set<unknown>();
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const item = value as { code?: unknown; address?: unknown; cause?: unknown; errors?: unknown };
    if (typeof item.code === "string") details.add(item.code + (typeof item.address === "string" ? ` ${item.address}` : ""));
    visit(item.cause);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
  }
  visit(error);
  const message = (error instanceof Error ? error.message : String(error)) || "网络连接失败";
  return details.size ? `${message}（${[...details].slice(0, 6).join("；")}）` : message;
}

function networkHints(): string {
  return ["检查站点地址与 VPN / TUN 网络设置，也可用 --base <地址> 指向其它站点。", "本机需要代理时加 --proxy <地址>，例如 --proxy http://127.0.0.1:7890。"]
    .map((line) => style.dim(`  提示：${line}`))
    .join("\n");
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
    let text: string;
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      response = await fetchImpl()(url, {
        headers: { accept: "application/json", "user-agent": "yuna-cli" },
        signal,
      });
      text = await response.text();
    } catch (error) {
      const reason = signal.aborted ? `请求超时（总计 ${this.timeoutMs}ms）` : describeNetworkError(error, this.timeoutMs);
      throw new ApiError(`无法连接 ${url.href}：${reason}\n${networkHints()}`);
    }

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
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError("接口返回的数据格式无效，预期为 JSON 对象。", response.status);
    }
    return payload as T;
  }

  async listPosts(options: { kind?: string; limit?: number; page?: number } = {}): Promise<PublicPost[]> {
    return (await this.listPostPage(options)).posts;
  }

  async listPostPage(options: { kind?: string; limit?: number; page?: number } = {}): Promise<PostPage> {
    const data = await this.get<PostPage>("/api/posts", {
      kind: options.kind,
      page: options.page,
      perPage: options.limit,
    });
    if (!Array.isArray(data.posts) || data.posts.some((post) => !post || typeof post.slug !== "string" || typeof post.title !== "string")) {
      throw new ApiError("文章列表格式无效。");
    }
    if (data.pagination) {
      const { page, perPage, total, totalPages } = data.pagination;
      if (![page, perPage, totalPages].every((value) => Number.isSafeInteger(value) && value > 0) || !Number.isSafeInteger(total) || total < 0) {
        throw new ApiError("文章分页信息无效。");
      }
    }
    return data;
  }

  async getPost(slug: string): Promise<{ post: PublicPost; markdown: string }> {
    const data = await this.get<{ post: PublicPost; markdown?: string }>(`/api/posts/${encodeURIComponent(slug)}`);
    if (!data.post || typeof data.post.slug !== "string" || typeof data.post.title !== "string" || (data.markdown !== undefined && typeof data.markdown !== "string")) {
      throw new ApiError("文章详情格式无效。");
    }
    return { post: data.post, markdown: data.markdown ?? "" };
  }

  async getRecords(keys: string[]): Promise<Record<string, SiteRecord | null>> {
    if (!keys.length) return {};
    const data = await this.get<{ records?: Record<string, SiteRecord | null> }>("/api/site", { keys: keys.join(",") });
    if (!data.records || typeof data.records !== "object" || Array.isArray(data.records)) throw new ApiError("站点记录格式无效。");
    return data.records;
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
