// yuna join —— 招新与加入信息。
// 数据来自 join 页面的可编辑块（site_records 里 key = 块名的 JSON：{ fields, hrefs }），
// 与前端一致：记录里缺哪个字段就退回页面内置文案，所以没在后台填过也能正常输出。
import type { CommandContext } from "../context.js";
import { keyValueRows, sectionTitle, style, wrapText } from "../ui.js";

interface BlockContent {
  fields?: Record<string, string>;
  hrefs?: Record<string, string>;
}

const BLOCK_KEYS = [
  "join-hero-copy",
  "join-kpi-time",
  "join-kpi-target",
  "join-kpi-contact",
  "join-process-heading",
  "join-process-register",
  "join-process-briefing",
  "join-process-result",
  "join-contact-card",
];

/** 与 public/join.html 的内置文案保持一致，仅在 D1 里没有对应记录/字段时使用。 */
const FALLBACK: Record<string, BlockContent> = {
  "join-hero-copy": {
    fields: {
      eyebrow: "Join YUNA",
      title: "加入燕山大学大学生网络信息协会。",
      lead: "这里用于集中维护招新说明、报名入口、方向介绍和答疑安排。当前内容为占位，后续可由管理员直接在页面上编辑。",
      primaryAction: "报名与联系",
      secondaryAction: "先看看部门",
    },
    hrefs: { primaryAction: "#contact", secondaryAction: "/departments.html" },
  },
  "join-kpi-time": { fields: { title: "时间", body: "待补充" } },
  "join-kpi-target": { fields: { title: "对象", body: "面向在校同学" } },
  "join-kpi-contact": { fields: { title: "答疑", body: "待补充" } },
  "join-process-heading": {
    fields: {
      eyebrow: "Process",
      title: "招新流程。",
      note: "三步走完：报名、来聊一聊、选定方向。每一步的具体时间以这里和协会公告为准。",
    },
  },
  "join-process-register": {
    fields: { title: "报名入口", body: "这里放置报名方式、报名表链接或群聊入口。当前为占位内容。" },
  },
  "join-process-briefing": {
    fields: { title: "宣讲与答疑", body: "这里填写宣讲时间、地点、线上会议或答疑群信息。" },
  },
  "join-process-result": {
    fields: { title: "方向确认", body: "这里说明加入后的方向选择、后续通知和第一次活动安排。" },
  },
  "join-contact-card": {
    fields: {
      title: "联系与报名方式",
      body: "这里可以填写报名表链接、QQ群、负责人联系方式、截止时间和注意事项。当前为占位内容。",
      primaryAction: "先认识协会",
      secondaryAction: "看办公室位置",
    },
    hrefs: { primaryAction: "/team.html", secondaryAction: "/team.html#office" },
  },
};

const STEP_BLOCKS: Array<[string, string]> = [
  ["join-process-register", "01"],
  ["join-process-briefing", "02"],
  ["join-process-result", "03"],
];

const KPI_BLOCKS = ["join-kpi-time", "join-kpi-target", "join-kpi-contact"];

export async function runJoin(ctx: CommandContext): Promise<void> {
  const records = await ctx.api.getRecords(BLOCK_KEYS);
  const stored = new Map<string, BlockContent>();
  for (const key of BLOCK_KEYS) {
    const record = records[key];
    if (!record || record.kind !== "json") continue;
    try {
      const parsed = JSON.parse(record.content || "{}") as BlockContent;
      if (parsed && typeof parsed === "object") stored.set(key, parsed);
    } catch {
      // 内容坏了就退回内置文案，不影响命令可用
    }
  }

  const field = (key: string, name: string): string =>
    String(stored.get(key)?.fields?.[name] ?? FALLBACK[key]?.fields?.[name] ?? "").trim();
  const href = (key: string, name: string): string =>
    String(stored.get(key)?.hrefs?.[name] ?? FALLBACK[key]?.hrefs?.[name] ?? "").trim();

  const resolveHref = (value: string): string => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("#")) return `${ctx.api.base}/join${value}`;
    if (value.startsWith("/")) return `${ctx.api.base}${value}`;
    return `${ctx.api.base}/join/${value}`;
  };

  const actions: Array<{ label: string; url: string }> = [];
  for (const [key, name] of [
    ["join-hero-copy", "primaryAction"],
    ["join-hero-copy", "secondaryAction"],
    ["join-contact-card", "primaryAction"],
    ["join-contact-card", "secondaryAction"],
  ] as Array<[string, string]>) {
    const label = field(key, name);
    const url = resolveHref(href(key, name));
    if (!label || !url) continue;
    if (actions.some((action) => action.url === url && action.label === label)) continue;
    actions.push({ label, url });
  }

  if (ctx.flags.json) {
    ctx.out(
      JSON.stringify(
        {
          title: field("join-hero-copy", "title"),
          lead: field("join-hero-copy", "lead"),
          kpi: KPI_BLOCKS.map((key) => ({ label: field(key, "title"), value: field(key, "body") })),
          steps: STEP_BLOCKS.map(([key, number]) => ({ number, title: field(key, "title"), body: field(key, "body") })),
          contact: { title: field("join-contact-card", "title"), body: field("join-contact-card", "body") },
          actions,
          url: `${ctx.api.base}/join`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const out = ctx.out;
  const eyebrow = field("join-hero-copy", "eyebrow");
  out();
  out(`${style.bold(style.brand("YUNA"))} ${style.dim("· 燕山大学大学生网络信息协会")}${eyebrow ? style.dim(` · ${eyebrow}`) : ""}`);
  out();
  out(`  ${style.bold(field("join-hero-copy", "title"))}`);
  for (const line of wrapText(field("join-hero-copy", "lead"), ctx.width, "  ")) out(line);

  const kpiRows = KPI_BLOCKS.map((key) => [field(key, "title"), field(key, "body")] as [string, string]);
  const renderedKpi = keyValueRows(kpiRows, "  ");
  if (renderedKpi.length) {
    out();
    for (const line of renderedKpi) out(line);
  }

  const processTitle = field("join-process-heading", "title") || "招新流程";
  const steps = STEP_BLOCKS.map(([key, number]) => ({ number, title: field(key, "title"), body: field(key, "body") })).filter(
    (step) => step.title || step.body,
  );
  if (steps.length) {
    out();
    out(`  ${sectionTitle(processTitle)}`);
    const note = field("join-process-heading", "note");
    if (note) for (const line of wrapText(note, ctx.width, "  ")) out(style.dim(line));
    out();
    for (const step of steps) {
      out(`    ${style.brand(step.number)}  ${style.bold(step.title)}`);
      if (step.body) for (const line of wrapText(step.body, ctx.width, "        ")) out(style.dim(line));
    }
  }

  const contactBody = field("join-contact-card", "body");
  if (contactBody) {
    out();
    out(`  ${sectionTitle(field("join-contact-card", "title") || "联系与报名方式")}`);
    for (const line of wrapText(contactBody, ctx.width, "  ")) out(line);
  }

  if (actions.length) {
    out();
    for (const action of actions) out(`  ${style.dim("→")} ${action.label}  ${style.underline(action.url)}`);
  }

  out();
  out(style.dim("$ yuna join --with curiosity"));
  if (ctx.flags.with.includes("curiosity")) {
    out(style.dim("  好奇已到位 —— 官网上那行只是装饰，这条命令是真的。"));
  }
}
