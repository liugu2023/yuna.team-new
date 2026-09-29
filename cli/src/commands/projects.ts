// yuna projects —— 协会项目目录。数据是 site_records 里 key=association-projects 的 JSON 记录。
import type { ProjectEntry } from "../api.js";
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { joinParts } from "../context.js";
import { style, wrapText } from "../ui.js";

const PROJECT_KEY = "association-projects";

const STATUS_LABELS: Record<ProjectEntry["status"], string> = {
  maintaining: "持续维护",
  building: "开发中",
  planning: "规划中",
  archived: "已归档",
};

const NETWORK_LABELS: Record<ProjectEntry["network"], string> = {
  public: "公网项目",
  internal: "内网项目",
  unspecified: "待确认",
};

function safeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || /[\\\u0000-\u0020]/.test(raw)) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

/** 与 public/js/projects.js 的校验保持一致：缺名称或标识的条目直接忽略，非法枚举退回默认值。 */
function normalizeProjects(value: unknown): ProjectEntry[] {
  const source = value && typeof value === "object" ? (value as { projects?: unknown }).projects : null;
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const projects: ProjectEntry[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? "").trim();
    const title = String(raw.title ?? "").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const status = String(raw.status ?? "");
    const network = String(raw.network ?? "");
    projects.push({
      id,
      title,
      category: String(raw.category ?? "协会项目").trim(),
      status: Object.hasOwn(STATUS_LABELS, status) ? (status as ProjectEntry["status"]) : "planning",
      network: Object.hasOwn(NETWORK_LABELS, network) ? (network as ProjectEntry["network"]) : "unspecified",
      summary: String(raw.summary ?? ""),
      owner: String(raw.owner ?? "").trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 10) : [],
      description: String(raw.description ?? ""),
      siteUrl: safeUrl(raw.siteUrl),
      repoUrl: safeUrl(raw.repoUrl),
    });
  }
  return projects;
}

function networkBadge(network: ProjectEntry["network"]): string {
  const label = NETWORK_LABELS[network];
  if (network === "public") return style.green(`[${label}]`);
  if (network === "internal") return style.yellow(`[${label}]`);
  return style.dim(`[${label}]`);
}

function statusBadge(status: ProjectEntry["status"]): string {
  const label = STATUS_LABELS[status];
  return status === "maintaining" ? style.green(`[${label}]`) : style.brand(`[${label}]`);
}

export async function runProjects(ctx: CommandContext): Promise<void> {
  const network = (ctx.flags.network ?? "").trim();
  const status = (ctx.flags.status ?? "").trim();
  if (network && !Object.hasOwn(NETWORK_LABELS, network)) {
    throw new UsageError(`--network 只支持 ${Object.keys(NETWORK_LABELS).join(" | ")}。`);
  }
  if (status && !Object.hasOwn(STATUS_LABELS, status)) {
    throw new UsageError(`--status 只支持 ${Object.keys(STATUS_LABELS).join(" | ")}。`);
  }

  const record = await ctx.api.getJsonRecord<unknown>(PROJECT_KEY);
  const all = normalizeProjects(record ?? {});

  const keyword = (ctx.positionals[0] ?? "").trim().toLocaleLowerCase();
  const tag = (ctx.flags.tag ?? "").trim().toLocaleLowerCase();
  const matches = (project: ProjectEntry): boolean => {
    if (network && project.network !== network) return false;
    if (status && project.status !== status) return false;
    if (tag && ![...project.tags, project.category].join(" ").toLocaleLowerCase().includes(tag)) return false;
    if (keyword) {
      const haystack = [project.title, project.summary, project.category, project.owner, ...project.tags].join(" ").toLocaleLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  };
  const projects = all.filter(matches);

  if (ctx.flags.json) {
    ctx.out(JSON.stringify(projects, null, 2));
    return;
  }

  const out = ctx.out;
  out();

  if (!all.length) {
    out(`  ${style.bold(style.brand("协会项目"))}`);
    out();
    out(style.dim("暂时还没有项目，欢迎之后再来看看。"));
    out(style.dim(`  ${ctx.api.base}/projects`));
    return;
  }

  out(`  ${style.bold(style.brand("协会项目"))}${style.dim(`  显示 ${projects.length} / ${all.length} 个`)}`);
  if (!projects.length) {
    out();
    out(style.dim("没有符合条件的项目。"));
    return;
  }

  projects.forEach((project, position) => {
    out();
    out(`  ${style.bold(project.title)}  ${networkBadge(project.network)} ${statusBadge(project.status)}`);
    const meta = joinParts([project.category, project.owner || "参与团队待补充"]);
    if (meta) out(`    ${style.dim(meta)}`);
    if (project.summary) for (const line of wrapText(project.summary, ctx.width, "    ")) out(line);
    if (project.tags.length) out(`    ${style.dim("标签")}  ${project.tags.join(" · ")}`);
    for (const [label, url] of [["项目地址", project.siteUrl], ["项目仓库", project.repoUrl]] as Array<[string, string]>) {
      if (url) out(`    ${style.dim(label)}  ${style.underline(url.startsWith("/") ? ctx.api.url(url) : url)}`);
    }
    if (position === projects.length - 1) out();
  });
}
