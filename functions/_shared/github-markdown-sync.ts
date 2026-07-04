import type { Env, PostRecord, SiteRecord } from "./types";

interface GithubBackupConfig {
  owner: string;
  repo: string;
  branch: string;
  prefix: string;
  token: string;
  authorName: string;
  authorEmail: string;
}

interface MarkdownDocument {
  path: string;
  source: "post" | "page";
  id: string;
  title: string;
  updatedAt: string;
  content: string;
}

interface GithubManifest {
  version: 1;
  files: Array<{
    path: string;
    source: string;
    id: string;
    title: string;
    updatedAt: string;
    sha256: string;
  }>;
}

interface GithubRef {
  object: { sha: string };
}

interface GithubCommit {
  sha: string;
  tree: { sha: string };
}

interface GithubTree {
  sha: string;
}

interface GithubContent {
  content?: string;
  encoding?: string;
}

export interface GithubSyncResult {
  skipped?: boolean;
  reason?: string;
  files?: number;
  commit?: string;
  branch?: string;
  repo?: string;
}

export function queueMarkdownGithubSync(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  reason: string,
  actor: string,
): void {
  waitUntil(
    syncMarkdownToGitHub(env, { reason, actor }).catch((error) => {
      console.error("GitHub Markdown sync failed", error);
    }),
  );
}

export async function syncMarkdownToGitHub(
  env: Env,
  trigger: { reason: string; actor: string },
): Promise<GithubSyncResult> {
  const config = githubBackupConfig(env);
  if (!config) {
    return { skipped: true, reason: "GitHub Markdown 备份未配置。" };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await performGithubSync(env, config, trigger);
    } catch (error) {
      if (attempt === 0 && isGitRefConflict(error)) continue;
      throw error;
    }
  }

  return { skipped: true, reason: "GitHub Markdown 同步重试失败。" };
}

async function performGithubSync(
  env: Env,
  config: GithubBackupConfig,
  trigger: { reason: string; actor: string },
): Promise<GithubSyncResult> {
  const documents = await buildMarkdownDocuments(env, config.prefix);
  const manifest = await buildManifest(documents);
  const manifestPath = prefixedPath(config.prefix, ".yuna-sync-manifest.json");
  const previousManifest = await readPreviousManifest(config, manifestPath);
  const currentPaths = new Set([...documents.map((doc) => doc.path), manifestPath]);
  const stalePaths = (previousManifest?.files || [])
    .map((file) => file.path)
    .filter((path) => path.startsWith(config.prefix ? `${config.prefix}/` : ""))
    .filter((path) => !currentPaths.has(path));

  const ref = await githubJson<GithubRef>(config, "GET", `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const baseCommit = await githubJson<GithubCommit>(config, "GET", `/repos/${config.owner}/${config.repo}/git/commits/${ref.object.sha}`);

  const tree = await githubJson<GithubTree>(config, "POST", `/repos/${config.owner}/${config.repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: [
      ...documents.map((document) => ({
        path: document.path,
        mode: "100644",
        type: "blob",
        content: document.content,
      })),
      {
        path: manifestPath,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(manifest, null, 2) + "\n",
      },
      ...stalePaths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: null,
      })),
    ],
  });

  if (tree.sha === baseCommit.tree.sha) {
    return {
      skipped: true,
      reason: "Markdown 备份没有变化。",
      files: documents.length,
      branch: config.branch,
      repo: `${config.owner}/${config.repo}`,
    };
  }

  const commit = await githubJson<GithubCommit>(config, "POST", `/repos/${config.owner}/${config.repo}/git/commits`, {
    message: `Sync YUNA Markdown backup: ${trigger.reason}`,
    tree: tree.sha,
    parents: [ref.object.sha],
    author: {
      name: config.authorName,
      email: config.authorEmail,
    },
    committer: {
      name: config.authorName,
      email: config.authorEmail,
    },
  });

  await githubJson(config, "PATCH", `/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    sha: commit.sha,
    force: false,
  });

  return {
    files: documents.length,
    commit: commit.sha,
    branch: config.branch,
    repo: `${config.owner}/${config.repo}`,
  };
}

async function buildMarkdownDocuments(env: Env, prefix: string): Promise<MarkdownDocument[]> {
  const [posts, pages] = await Promise.all([
    env.BLOG_DB.prepare(
      `SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC`,
    ).all<PostRecord>(),
    env.BLOG_DB.prepare(
      `SELECT * FROM site_records WHERE kind = 'markdown' ORDER BY key ASC`,
    ).all<SiteRecord>(),
  ]);

  const postDocuments = (posts.results || []).map((post) => ({
    path: prefixedPath(prefix, `${post.kind === "knowledge" ? "knowledge" : "posts"}/${safeGitPathSegment(post.slug)}.md`),
    source: "post" as const,
    id: post.slug,
    title: post.title,
    updatedAt: post.updated_at,
    content: withFrontmatter(
      {
        source: "post",
        slug: post.slug,
        title: post.title,
        tag: post.tag || "",
        cover_url: post.cover_url || "",
        kind: post.kind || "article",
        status: post.status,
        excerpt: post.excerpt,
        author_email: post.author_email,
        author_name: post.author_name || "",
        editor_name: post.editor_name || "",
        created_at: post.created_at,
        updated_at: post.updated_at,
        published_at: post.published_at || "",
        view_count: String(post.view_count ?? 0),
      },
      post.markdown_content || "",
    ),
  }));

  const pageDocuments = (pages.results || []).map((page) => {
    const pagePath = page.key.startsWith("page:")
      ? `pages/${safeGitPath(page.key.slice(5))}.md`
      : `pages/${safeGitPath(page.key)}.md`;
    return {
      path: prefixedPath(prefix, pagePath),
      source: "page" as const,
      id: page.key,
      title: page.title,
      updatedAt: page.updated_at,
      content: withFrontmatter(
        {
          source: "page",
          key: page.key,
          title: page.title,
          updated_by: page.updated_by,
          updated_at: page.updated_at,
        },
        page.content || "",
      ),
    };
  });

  return [...postDocuments, ...pageDocuments];
}

async function buildManifest(documents: MarkdownDocument[]): Promise<GithubManifest> {
  const files = [];
  for (const document of documents) {
    files.push({
      path: document.path,
      source: document.source,
      id: document.id,
      title: document.title,
      updatedAt: document.updatedAt,
      sha256: await sha256Hex(document.content),
    });
  }
  return { version: 1, files };
}

async function readPreviousManifest(
  config: GithubBackupConfig,
  manifestPath: string,
): Promise<GithubManifest | null> {
  const path = manifestPath.split("/").map(encodeURIComponent).join("/");
  const response = await githubFetch(config, "GET", `/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`);
  if (response.status === 404) return null;
  const content = await parseGithubResponse<GithubContent>(response);
  if (content.encoding !== "base64" || !content.content) return null;
  try {
    return JSON.parse(decodeBase64Utf8(content.content)) as GithubManifest;
  } catch {
    return null;
  }
}

function githubBackupConfig(env: Env): GithubBackupConfig | null {
  const repo = (env.GITHUB_BACKUP_REPO || "").trim();
  const token = (env.GITHUB_BACKUP_TOKEN || "").trim();
  if (!repo || !token || !repo.includes("/")) return null;

  const [owner, name] = repo.split("/", 2);
  if (!owner || !name) return null;

  return {
    owner,
    repo: name,
    token,
    branch: (env.GITHUB_BACKUP_BRANCH || "main").trim() || "main",
    prefix: cleanPrefix(env.GITHUB_BACKUP_PATH || "yuna-blog"),
    authorName: (env.GITHUB_BACKUP_AUTHOR_NAME || "YUNA Blog Bot").trim() || "YUNA Blog Bot",
    authorEmail: (env.GITHUB_BACKUP_AUTHOR_EMAIL || "yuna-blog-bot@example.invalid").trim() || "yuna-blog-bot@example.invalid",
  };
}

async function githubJson<T = unknown>(
  config: GithubBackupConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await githubFetch(config, method, path, body);
  return parseGithubResponse<T>(response);
}

async function githubFetch(
  config: GithubBackupConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      "user-agent": "yuna-team-blog",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parseGithubResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch((): unknown => ({}));
  if (!response.ok) {
    const message = getGithubErrorMessage(data) || `GitHub 请求失败：${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function getGithubErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object" || !("message" in data)) return "";
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function withFrontmatter(meta: Record<string, string>, markdown: string): string {
  const frontmatter = Object.entries(meta)
    .map(([key, value]) => `${key}: ${JSON.stringify(value || "")}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${markdown.trimEnd()}\n`;
}

function prefixedPath(prefix: string, path: string): string {
  return prefix ? `${prefix}/${path}` : path;
}

function safeGitPath(path: string): string {
  return path
    .split("/")
    .map(safeGitPathSegment)
    .filter(Boolean)
    .join("/");
}

function safeGitPathSegment(segment: string): string {
  return (segment || "untitled")
    .replace(/[\\\0\r\n:*?"<>|#%&{}$!`'@+=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "untitled";
}

function cleanPrefix(value: string): string {
  return safeGitPath(value.replace(/^\/+|\/+$/g, ""));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isGitRefConflict(error: unknown): boolean {
  return error instanceof Error && /reference update failed|not fast-forward|sha does not match/i.test(error.message);
}
