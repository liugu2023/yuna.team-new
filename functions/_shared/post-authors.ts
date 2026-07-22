export interface PostAuthor {
  name: string;
  url: string;
  avatar: string;
}

const MAX_COAUTHORS = 12;

export function parsePostAuthors(value: unknown): PostAuthor[] {
  if (Array.isArray(value)) return readAuthors(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return readAuthors(JSON.parse(value));
  } catch {
    return [];
  }
}

export function normalizePostAuthors(value: unknown): PostAuthor[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_COAUTHORS) throw new Error(`协同作者最多 ${MAX_COAUTHORS} 位`);

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`第 ${index + 1} 位协同作者格式无效`);
    }
    const input = entry as Record<string, unknown>;
    const name = text(input.name);
    if (!name) throw new Error(`第 ${index + 1} 位协同作者缺少姓名`);
    if (name.length > 100) throw new Error(`第 ${index + 1} 位协同作者姓名过长`);
    const url = httpUrl(input.url, `第 ${index + 1} 位协同作者链接无效`);
    const avatar = avatarUrl(input.avatar, `第 ${index + 1} 位协同作者头像地址无效`);
    return { name, url, avatar };
  });
}

export function serializePostAuthors(authors: PostAuthor[]): string {
  return JSON.stringify(authors);
}

function readAuthors(value: unknown): PostAuthor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_COAUTHORS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const input = entry as Record<string, unknown>;
    const name = text(input.name);
    if (!name) return [];
    return [{ name, url: text(input.url), avatar: text(input.avatar) }];
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value: unknown, message: string): string {
  const raw = text(value);
  if (!raw) return "";
  if (raw.length > 2048) throw new Error(message);
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      throw new Error(message);
    }
    return url.href;
  } catch {
    throw new Error(message);
  }
}

function avatarUrl(value: unknown, message: string): string {
  const raw = text(value);
  if (!raw) return "";
  if (raw.length > 2048 || /[\0\r\n\\]/.test(raw)) throw new Error(message);
  if (raw.startsWith("/media/") && !raw.startsWith("/media//")) return raw;
  return httpUrl(raw, message);
}
