// yuna lesson —— 授课计划。数据是 site_records 里 key=lesson-plan 的 JSON 记录。
import type { LessonEntry, LessonPlan, LessonTerm } from "../api.js";
import { positiveInt, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { joinParts } from "../context.js";
import { resolveSafeLink } from "../links.js";
import { style, wrapText } from "../ui.js";

const LESSON_KEY = "lesson-plan";
const DEFAULT_TITLE = "授课计划";

const STATUS_LABELS: Record<LessonEntry["status"], string> = {
  planned: "待授课",
  completed: "已完成",
  cancelled: "已取消",
};

function normalizeLinks(value: unknown, base: string): Array<{ label: string; url: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = (item ?? {}) as Record<string, unknown>;
      const url = resolveSafeLink(raw.url, base, "/lesson-plan");
      return { label: String(raw.label ?? "").trim() || url, url };
    })
    .filter((link) => link.url);
}

/** 与 public/js/lesson-plan.js 的归一化保持一致：没有主题的课次丢弃，非法状态退回 planned。 */
function normalizePlan(value: unknown, base: string): LessonPlan {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const terms: LessonTerm[] = [];
  for (const item of Array.isArray(source.terms) ? source.terms : []) {
    const rawTerm = (item ?? {}) as Record<string, unknown>;
    const label = String(rawTerm.label ?? "").trim();
    if (!label) continue;
    const lessons: LessonEntry[] = [];
    for (const lesson of Array.isArray(rawTerm.lessons) ? rawTerm.lessons : []) {
      const rawLesson = (lesson ?? {}) as Record<string, unknown>;
      const topic = String(rawLesson.topic ?? "").trim();
      if (!topic) continue;
      const status = String(rawLesson.status ?? "").trim();
      lessons.push({
        date: String(rawLesson.date ?? "").trim(),
        session: String(rawLesson.session ?? rawLesson.week ?? "").trim(),
        topic,
        department: String(rawLesson.department ?? "").trim(),
        instructor: String(rawLesson.instructor ?? "").trim(),
        location: String(rawLesson.location ?? "").trim(),
        status: Object.hasOwn(STATUS_LABELS, status) ? (status as LessonEntry["status"]) : "planned",
        links: normalizeLinks(rawLesson.links, base),
      });
    }
    lessons.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.session.localeCompare(b.session, "zh-CN", { numeric: true }));
    terms.push({
      label,
      subtitle: String(rawTerm.subtitle ?? "").trim(),
      order: Number.isFinite(Number(rawTerm.order)) ? Number(rawTerm.order) : 0,
      lessons,
    });
  }
  terms.sort((a, b) => (b.order || 0) - (a.order || 0) || b.label.localeCompare(a.label, "zh-CN", { numeric: true }));
  return { title: String(source.title ?? "").trim() || DEFAULT_TITLE, terms };
}

function statusLabel(status: LessonEntry["status"]): string {
  const label = STATUS_LABELS[status];
  if (status === "completed") return style.green(label);
  if (status === "cancelled") return style.dim(label);
  return style.yellow(label);
}

export async function runLesson(ctx: CommandContext): Promise<void> {
  const status = (ctx.flags.status ?? "").trim();
  if (status && !Object.hasOwn(STATUS_LABELS, status)) {
    throw new UsageError(`--status 只支持 ${Object.keys(STATUS_LABELS).join(" | ")}。`);
  }

  const record = await ctx.api.getJsonRecord<unknown>(LESSON_KEY);
  const plan = normalizePlan(record ?? {}, ctx.api.base);
  const keyword = (ctx.flags.term ?? "").trim().toLocaleLowerCase();
  const limit = positiveInt(ctx.flags.limit, 0, "-n / --limit");

  let terms = plan.terms;
  if (keyword) {
    terms = terms.filter((term) => `${term.label} ${term.subtitle}`.toLocaleLowerCase().includes(keyword));
    if (!terms.length) {
      const available = plan.terms.map((term) => term.label).join("、") || "（还没有届次）";
      throw new UsageError(`没有找到匹配「${ctx.flags.term}」的届次。现有：${available}`);
    }
  } else if (!ctx.flags.all) {
    terms = terms.slice(0, 1);
  }

  const filtered = terms.map((term) => {
    const lessons = status ? term.lessons.filter((lesson) => lesson.status === status) : term.lessons;
    return { ...term, lessons: limit > 0 ? lessons.slice(0, limit) : lessons, total: lessons.length };
  });

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ title: plan.title, terms: filtered }, null, 2));
    return;
  }

  const out = ctx.out;
  const totalLessons = plan.terms.reduce((sum, term) => sum + term.lessons.length, 0);
  out();
  out(`  ${style.bold(style.brand(plan.title))}${style.dim(`  共 ${plan.terms.length} 个届次 / ${totalLessons} 次课`)}`);

  if (!plan.terms.length) {
    out();
    out(style.dim("课表还在整理中，之后再来看看。"));
    out(style.dim(`  ${ctx.api.base}/lesson-plan`));
    return;
  }

  for (const term of filtered) {
    out();
    out(`  ${style.bold(term.label)}${term.subtitle ? style.dim(`  ${term.subtitle}`) : ""}${style.dim(`  共 ${term.total} 次课`)}`);
    if (!term.lessons.length) {
      out(style.dim(status ? "  没有符合该状态的课次。" : "  这一届还没有排课。"));
      continue;
    }
    for (const lesson of term.lessons) {
      out();
      const heading = joinParts([lesson.session, lesson.date || "时间待定"]);
      out(`    ${style.bold(heading)}  ${statusLabel(lesson.status)}`);
      for (const line of wrapText(lesson.topic, ctx.width, "      ")) out(line);
      const details = joinParts([lesson.department, lesson.instructor ? `授课人 ${lesson.instructor}` : null, lesson.location]);
      if (details) out(`      ${style.dim(details)}`);
      for (const link of lesson.links) out(`      ${style.dim(link.label)}  ${style.underline(link.url)}`);
    }
    if (limit > 0 && term.total > term.lessons.length) {
      out();
      out(style.dim(`    只显示前 ${term.lessons.length} 次课；去掉 -n 可以看完整 ${term.total} 次。`));
    }
  }

  if (!keyword && !ctx.flags.all && plan.terms.length > 1) {
    out();
    out(style.dim(`只显示了最新一届。用 yuna lesson --all 看全部 ${plan.terms.length} 个届次，或 --term <关键词> 指定。`));
  }
}
