import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PACKET_RULESET } from "./packet-engine.js";

export interface PacketResult { score: number; moves: number; hints: number }
export interface PacketSeedRecords { best?: PacketResult; last?: PacketResult }
export type PacketRecords = Map<string, PacketSeedRecords>;

const MAX_SEEDS = 200;
const MAX_BYTES = 256 * 1024;
const corruptWarning = "本地成绩文件损坏或版本不兼容，已保留原文件；本局仍可游玩。";

function recordsPath(cacheDir?: string): string {
  const defaultRoot = process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const root = cacheDir ?? (process.env.YUNA_CACHE_DIR || path.join(defaultRoot, "yuna-team"));
  return path.join(root, "games", PACKET_RULESET, "records.json");
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validSeed = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const validResult = (value: unknown): value is PacketResult => isObject(value) && [value.score, value.moves, value.hints].every(number => Number.isSafeInteger(number) && (number as number) >= 0);
const copyResult = ({ score, moves, hints }: PacketResult): PacketResult => ({ score, moves, hints });

/** Score first; equal scores favor fewer hops, then fewer hints. */
export function isBetterPacketResult(candidate: PacketResult, previous?: PacketResult): boolean {
  return !previous || candidate.score > previous.score
    || (candidate.score === previous.score && (candidate.moves < previous.moves
      || (candidate.moves === previous.moves && candidate.hints < previous.hints)));
}

/** Windows can report ENOENT even when an intermediate path is a regular file. */
async function hasUsableParent(target: string): Promise<boolean> {
  let parent = path.dirname(target);
  for (;;) {
    try {
      const entry = await lstat(parent);
      if (!entry.isSymbolicLink()) return entry.isDirectory();
      return await stat(parent).then(value => value.isDirectory(), () => false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const ancestor = path.dirname(parent);
      if (ancestor === parent) return false;
      parent = ancestor;
    }
  }
}

async function readRecords(target: string): Promise<{ records: PacketRecords; warning?: string }> {
  try {
    if ((await stat(target)).size > MAX_BYTES) return { records: new Map(), warning: corruptWarning };
    const data: unknown = JSON.parse(await readFile(target, "utf8"));
    if (!isObject(data) || data.version !== 1 || data.ruleset !== PACKET_RULESET || !Array.isArray(data.entries) || data.entries.length > MAX_SEEDS) {
      return { records: new Map(), warning: corruptWarning };
    }
    const records: PacketRecords = new Map();
    for (const entry of data.entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validSeed(entry[0]) || !isObject(entry[1]) || records.has(entry[0])) {
        return { records: new Map(), warning: corruptWarning };
      }
      const [seed, record] = entry;
      if ((!record.best && !record.last) || (record.best !== undefined && !validResult(record.best)) || (record.last !== undefined && !validResult(record.last))) {
        return { records: new Map(), warning: corruptWarning };
      }
      if (record.last && (!record.best || isBetterPacketResult(record.last, record.best))) {
        return { records: new Map(), warning: corruptWarning };
      }
      records.set(seed, {
        ...(record.best ? { best: copyResult(record.best) } : {}),
        ...(record.last ? { last: copyResult(record.last) } : {}),
      });
    }
    return { records };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && await hasUsableParent(target)) return { records: new Map() };
    return { records: new Map(), warning: error instanceof SyntaxError ? corruptWarning : "本地成绩暂时无法读取，本局仍可游玩。" };
  }
}

/** Loading is read-only: JSON snapshots never need to create a cache directory. */
export function loadPacketRecords(cacheDir?: string): Promise<{ records: PacketRecords; warning?: string }> {
  return readRecords(recordsPath(cacheDir));
}

async function acquireLock(lockPath: string): Promise<(() => Promise<void>) | undefined> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close().catch(() => {});
        await rm(lockPath, { force: true }).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return undefined;
}

export type PacketSaveOutcome = { status: "saved" | "busy" | "invalid" | "unavailable"; message: string };

/** Merge under a short lock, then atomically replace the file; corrupt data stays untouched. */
export async function savePacketResultOutcome(seed: string, result: PacketResult, cacheDir?: string): Promise<PacketSaveOutcome> {
  if (!validSeed(seed) || !validResult(result)) return { status: "invalid", message: "成绩格式不正确，未写入本地文件。" };
  const target = recordsPath(cacheDir);
  const temporary = `${target}.${randomUUID()}.tmp`;
  let release: (() => Promise<void>) | undefined;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    release = await acquireLock(`${target}.lock`);
    if (!release) return {
      status: "busy",
      message: `成绩文件被占用。若关闭所有游戏后仍无法保存，请确认没有游戏运行，再移除锁文件：${target}.lock（保留 records.json）。`,
    };
    const { records, warning } = await readRecords(target);
    if (warning) return { status: "unavailable", message: warning };
    const previous = records.get(seed);
    const best = isBetterPacketResult(result, previous?.best) ? result : previous!.best!;
    // Map insertion order tracks the most recently completed seeds for bounded storage.
    records.delete(seed);
    records.set(seed, { best: copyResult(best), last: copyResult(result) });
    while (records.size > MAX_SEEDS) records.delete(records.keys().next().value!);
    await writeFile(temporary, JSON.stringify({ version: 1, ruleset: PACKET_RULESET, entries: [...records] }), { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
    return { status: "saved", message: "成绩已保存" };
  } catch {
    return { status: "unavailable", message: "无法写入本地成绩，请检查缓存目录是否可写；本局成绩仍在当前会话中保留。" };
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    await release?.();
  }
}

export async function savePacketResult(seed: string, result: PacketResult, cacheDir?: string): Promise<boolean> {
  return (await savePacketResultOutcome(seed, result, cacheDir)).status === "saved";
}
