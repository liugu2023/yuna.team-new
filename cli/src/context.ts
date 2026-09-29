// 命令共用的上下文与格式化小工具。
import type { YunaApi } from "./api.js";
import type { CliFlags } from "./args.js";
import { style } from "./ui.js";

export interface CommandContext {
  api: YunaApi;
  flags: CliFlags;
  positionals: string[];
  width: number;
  out: (line?: string) => void;
}

/** 站点时间形如 "2026-09-20 12:00:00" / ISO，这里统一取日期部分。 */
export function formatDate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw;
}

export function formatCount(value: number | null | undefined): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "0";
}

export function joinParts(parts: Array<string | null | undefined>, separator = " · "): string {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(separator);
}

export function link(url: string): string {
  return url ? style.underline(url) : "";
}
