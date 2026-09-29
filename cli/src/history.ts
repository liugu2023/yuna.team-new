import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function historyPath(base: string): string {
  const defaultRoot = process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const root = process.env.YUNA_CACHE_DIR || path.join(defaultRoot, "yuna-team");
  return path.join(root, `posts-${createHash("sha256").update(base).digest("hex")}.json`);
}

/** 只存最近一次列表的 slug；新文章插入、标签筛选都不会改变已展示编号的含义。 */
export async function savePostHistory(base: string, slugs: string[]): Promise<boolean> {
  const target = historyPath(base);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ version: 1, base, slugs }), { mode: 0o600 });
    await rename(temporary, target);
    return true;
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    return false;
  }
}

export async function loadPostHistory(base: string): Promise<string[] | null> {
  try {
    const data = JSON.parse(await readFile(historyPath(base), "utf8"));
    if (data?.version !== 1 || data.base !== base || !Array.isArray(data.slugs) || !data.slugs.every((slug: unknown) => typeof slug === "string" && slug.length > 0)) return null;
    return data.slugs;
  } catch {
    return null;
  }
}
