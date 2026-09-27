// 授课计划页。依赖 core.js。

// ===== 授课计划 =====
// 一条 site_records 记录（key: lesson-plan, kind: json）承载整页数据，前台直接渲染成课表。
// 拆成两次赋值：先给 bindLessonPlanFilters 用，最后统一挂到 window.blog 上。
const LESSON_PLAN_KEY = "lesson-plan";

const DEFAULT_LESSON_PLAN_TITLE = "授课计划";

const LESSON_STATUS_LABELS = {
  planned: "待授课",
  completed: "已完成",
  cancelled: "已取消",
};

// 协会四个部门加公开课，顺序与部门一览页一致。
const LESSON_DEPARTMENTS = ["开发部", "网络安全部", "运维部", "组宣部", "公开课"];

// D1 里没有记录（或内容为空/解析失败）时使用的兜底数据：标题是文案，terms 为空则渲染兜底提示。
function defaultLessonPlan() {
  return { title: DEFAULT_LESSON_PLAN_TITLE, terms: [] };
}

function normalizeLessonLinks(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((link) => ({ label: String(link?.label || "").trim(), url: String(link?.url || "").trim() }))
    .filter((link) => link.url);
}

// 授课时间不是必填：还没定哪天上课的课次也能先排进计划里，date 为空即“时间待定”。
// 届次内的教学进度按“第几次课”记，不与学校教学周同步。
function normalizeLessonPlan(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const terms = (Array.isArray(source.terms) ? source.terms : [])
    .map((term) => {
      const rawTerm = term && typeof term === "object" ? term : {};
      const lessons = (Array.isArray(rawTerm.lessons) ? rawTerm.lessons : [])
        .map((lesson) => {
          const rawLesson = lesson && typeof lesson === "object" ? lesson : {};
          const topic = String(rawLesson.topic || "").trim();
          if (!topic) return null;
          const status = LESSON_STATUS_LABELS[String(rawLesson.status || "").trim()]
            ? String(rawLesson.status).trim()
            : "planned";
          return {
            date: lessonDateValue(rawLesson.date),
            session: String(rawLesson.session ?? rawLesson.week ?? "").trim(),
            topic,
            department: String(rawLesson.department || "").trim(),
            instructor: String(rawLesson.instructor || "").trim(),
            location: String(rawLesson.location || "").trim(),
            status,
            links: normalizeLessonLinks(rawLesson.links),
          };
        })
        .filter(Boolean);
      return {
        label: String(rawTerm.label || "").trim(),
        subtitle: String(rawTerm.subtitle || "").trim(),
        order: Number.isFinite(Number(rawTerm.order)) ? Number(rawTerm.order) : 0,
        editedOrder: 0,
        lessons,
      };
    })
    .filter((term) => term.label);

  return { title: String(source.title || "").trim() || DEFAULT_LESSON_PLAN_TITLE, terms };
}

// 只接受 YYYY-MM-DD：纯字典序即时间序，不受时区影响。
function lessonDateValue(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const loose = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(raw);
  if (!loose) return "";
  return `${loose[1]}-${loose[2].padStart(2, "0")}-${loose[3].padStart(2, "0")}`;
}

// 排课用的是自然日，不是时刻，因此按字符串逐段比较，避免 UTC 解析把跨零点的课挪到前一天。
function lessonToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function lessonDateWithWeekday(date) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(parsed);
  return `${date} ${weekday}`;
}

function lessonPlanHasContent(plan) {
  return plan.terms.some((term) => term.lessons.length > 0);
}

function termLessonCount(term) {
  return term.lessons.length;
}

function sortedLessonTerms(plan) {
  return [...plan.terms].sort((a, b) => {
    // editedOrder 是编辑弹窗里“从上到下”的序号（最上面最新），用于抵消标签的字典序。
    if (a.editedOrder !== b.editedOrder) return (a.editedOrder ?? 0) - (b.editedOrder ?? 0);
    if (a.order !== b.order) return (b.order || 0) - (a.order || 0);
    return b.label.localeCompare(a.label, "zh-Hans-CN", { numeric: true });
  });
}

// 每届内课次倒序（最近的在最前）；没有日期的排在有日期的后面，保持写入顺序。
function sortedTermLessons(term) {
  return [...term.lessons].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

async function loadLessonPlan() {
  let record;
  try {
    const data = await fetchSiteRecord(LESSON_PLAN_KEY);
    record = data.record;
  } catch (error) {
    // 记录不存在：按“还没排课”处理，页面继续显示兜底文案，不报错。
    if (isNotFoundError(error)) return defaultLessonPlan();
    throw error;
  }
  if (record?.kind !== "json") return defaultLessonPlan();

  let parsed;
  try {
    parsed = JSON.parse(record.content || "{}");
  } catch {
    // 内容损坏也走兜底：宁可显示“整理中”，也不要让整页只剩一条报错。
    return defaultLessonPlan();
  }

  const plan = normalizeLessonPlan(parsed);
  if (!lessonPlanHasContent(plan)) plan.title = String(record.title || "").trim() || plan.title;
  return plan;
}

async function renderLessonPlan() {
  const container = document.querySelector("[data-lesson-plan]");
  if (!container) return;

  let plan;
  try {
    plan = await loadLessonPlan();
  } catch (error) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    return;
  }

  paintLessonPlan(container, plan);
  await attachLessonPlanEditor(container, plan);
}

async function attachLessonPlanEditor(container, plan) {
  const slot = document.querySelector("[data-lesson-plan-admin]");
  if (!slot) return;

  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.admin) {
    slot.hidden = true;
    return;
  }

  slot.hidden = false;
  const emptyHint = container.querySelector("[data-lesson-plan-empty-hint]");
  if (emptyHint) emptyHint.hidden = false;
  slot.innerHTML = '<button type="button" class="btn secondary compact" data-edit-lesson-plan>编辑授课计划</button>';
  slot.querySelector("[data-edit-lesson-plan]")?.addEventListener("click", () => {
    openLessonPlanEditor(plan, (nextPlan) => {
      plan = nextPlan;
      paintLessonPlan(container, plan);
    });
  });
}

function paintLessonPlan(container, plan) {
  paintLessonKpi(plan);
  if (!lessonPlanHasContent(plan)) {
    container.innerHTML = lessonPlanEmptyHtml();
    // 空状态是 JS 插入的文案块（lesson-plan-empty），插入后补一次读取与编辑按钮绑定。
    window.blog.renderEditableBlocks?.();
    return;
  }

  const terms = sortedLessonTerms(plan);
  const activeTerm = terms[0];
  const highlight = highlightLesson(plan);
  const nextKey = highlight?.upcoming ? lessonKey(highlight.lesson.termLabel, highlight.lesson) : "";

  container.innerHTML = `
    ${renderLessonHighlight(highlight)}
    <div class="lesson-plan-toolbar">
      <div class="lesson-toolbar-group">
        <span class="lesson-toolbar-label" id="lesson-term-label">届次</span>
        <div class="team-term-switcher" role="group" aria-labelledby="lesson-term-label">
          ${terms
            .map((term) => {
              const count = termLessonCount(term);
              const active = term.label === activeTerm.label;
              return `<button class="team-term-button${active ? " is-active" : ""}" type="button" data-lesson-term-button="${escapeHtml(encodeURIComponent(term.label))}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(term.label)}<span>${count ? `${count.toLocaleString("zh-CN")} 次` : "暂无排课"}</span></button>`;
            })
            .join("")}
        </div>
      </div>
      <div class="lesson-toolbar-group">
        <span class="lesson-toolbar-label" id="lesson-department-label">部门</span>
        <div class="filter-chips lesson-department-filter" role="group" aria-labelledby="lesson-department-label" data-lesson-department-filter>
          <button type="button" class="filter-chip is-active" data-lesson-department-button="" aria-pressed="true">全部</button>
          ${LESSON_DEPARTMENTS.map((department) => `<button type="button" class="filter-chip" data-lesson-department-button="${escapeHtml(department)}" aria-pressed="false">${escapeHtml(department)}</button>`).join("")}
        </div>
      </div>
    </div>
    <div data-lesson-term-panels>
      ${terms
        .map((term) => {
          const active = term.label === activeTerm.label;
          const lessons = sortedTermLessons(term);
          return `
            <section class="lesson-term-panel" data-lesson-term-panel="${escapeHtml(term.label)}" aria-label="${escapeHtml(term.label)}" ${active ? "" : "hidden"}>
              <div class="lesson-term-head">
                <h2>${escapeHtml(term.label)}</h2>
                ${term.subtitle ? `<p class="lesson-term-note">${escapeHtml(term.subtitle)}</p>` : ""}
                ${lessons.length ? `<p class="lesson-term-stats">${lessonTermStats(lessons)}</p>` : ""}
              </div>
              ${
                lessons.length
                  ? `<ol class="lesson-list lesson-timeline">${lessons.map((lesson) => renderLessonCard(lesson, lessonKey(term.label, lesson) === nextKey)).join("")}</ol>`
                  : ""
              }
              <p class="empty-state lesson-term-empty" data-lesson-empty aria-live="polite" ${lessons.length ? "hidden" : ""}>这一届还没有安排课次。</p>
            </section>
          `;
        })
        .join("")}
    </div>
  `;

  bindLessonPlanFilters(container);
  container.querySelectorAll(".reveal").forEach((node) => node.classList.add("visible"));
}

function lessonKey(termLabel, lesson) {
  return `${termLabel}|${lesson.date}|${lesson.topic}`;
}

function lessonTermStats(lessons) {
  const count = (status) => lessons.filter((lesson) => lesson.status === status).length;
  const parts = [`共 ${lessons.length} 次`];
  const completed = count("completed");
  const planned = count("planned");
  const cancelled = count("cancelled");
  if (completed) parts.push(`已完成 ${completed}`);
  if (planned) parts.push(`待授课 ${planned}`);
  if (cancelled) parts.push(`已取消 ${cancelled}`);
  return parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("");
}

// 页头数据行：届次数 / 课次总数 / 已完成。数据为空时整行隐藏。
function paintLessonKpi(plan) {
  const slot = document.querySelector("[data-lesson-kpi]");
  if (!slot) return;
  const lessons = plan.terms.flatMap((term) => term.lessons);
  if (!lessons.length) {
    slot.hidden = true;
    slot.innerHTML = "";
    return;
  }
  const completed = lessons.filter((lesson) => lesson.status === "completed").length;
  const items = [
    [plan.terms.length, "届课表"],
    [lessons.length, "次课已排"],
    [completed, "次课已讲完"],
  ];
  slot.innerHTML = items
    .map(([value, label]) => `<div><strong><span data-count="${value}">${value}</span></strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
  slot.hidden = false;
}

function lessonPlanEmptyHtml() {
  // 兜底文案：数据没入库时访客看到的是这段静态说明（可在页内编辑，块名 lesson-plan-empty），管理员额外看到操作指引。
  return `
    <article class="lesson-plan-empty reveal visible" data-editable-block="lesson-plan-empty" data-editable-title="授课计划：还没排课时的说明">
      <span class="lesson-plan-empty-mark" aria-hidden="true"></span>
      <h2 data-block-field="title">还没排课。</h2>
      <p data-block-field="body">新学期的课表定下来就会更新在这一页。眼下想看点东西的话，往期的课件和录播都在知识库里。</p>
      <div class="hero-actions">
        <a class="btn primary" href="https://docs.yuna.team/" target="_blank" rel="noopener" data-block-field="primaryAction" data-block-href data-block-label="主按钮">去知识库看往期<span class="arrow" aria-hidden="true"></span></a>
        <a class="btn secondary" href="/departments.html" data-block-field="secondaryAction" data-block-href data-block-label="次按钮">先看看各部门在做什么</a>
      </div>
      <p class="lesson-plan-empty-hint" data-lesson-plan-empty-hint hidden>这个页面还没有数据。点页头的「编辑授课计划」排第一次课。</p>
    </article>
  `;
}

function lessonStatusLabel(status) {
  return LESSON_STATUS_LABELS[status] || LESSON_STATUS_LABELS.planned;
}

// 置顶卡：先找最近一节未开始（且未取消）的课；如果都上完了，就回落到最近一次已结束的课。
function highlightLesson(plan) {
  const candidates = plan.terms.flatMap((term) =>
    term.lessons.map((lesson) => ({ ...lesson, termLabel: term.label })),
  );
  const today = lessonToday();
  const dated = candidates.filter((lesson) => lesson.date);
  const upcoming = dated
    .filter((lesson) => lesson.date >= today && lesson.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (upcoming) return { lesson: upcoming, upcoming: true, today };
  const latest = dated.filter((lesson) => lesson.date < today).sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest ? { lesson: latest, upcoming: false, today } : null;
}

// 两个 YYYY-MM-DD 之间相差的自然日数（按 UTC 零点算，不受本地时区影响）。
function lessonDayDiff(from, to) {
  const toUtc = (value) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

function lessonDateParts(date) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = date.split("-");
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(parsed);
  return { year, month, day, weekday };
}

function lessonCountdownText(highlight) {
  const diff = lessonDayDiff(highlight.today, highlight.lesson.date);
  if (diff === 0) return "就在今天";
  if (diff === 1) return "明天开讲";
  if (diff > 1) return `还有 ${diff} 天`;
  return `${-diff} 天前`;
}

function renderLessonHighlight(highlight) {
  if (!highlight) return "";
  const lesson = highlight.lesson;
  const parts = lessonDateParts(lesson.date);
  return `
    <article class="lesson-highlight${highlight.upcoming ? " is-upcoming" : ""} reveal visible" aria-label="${highlight.upcoming ? "下一次课" : "最近一次课"}">
      <div class="lesson-highlight-date">
        <span class="lesson-highlight-month">${parts ? `${escapeHtml(parts.year)} · ${Number(parts.month)} 月` : ""}</span>
        <span class="lesson-highlight-day">${parts ? escapeHtml(parts.day) : "--"}</span>
        <span class="lesson-highlight-weekday">${parts ? escapeHtml(parts.weekday) : ""}</span>
        <span class="lesson-highlight-countdown">${escapeHtml(lessonCountdownText(highlight))}</span>
      </div>
      <div class="lesson-highlight-body">
        <div class="lesson-highlight-head">
          <p class="eyebrow">${highlight.upcoming ? "Next Lesson" : "Latest Lesson"}</p>
          <span class="lesson-status is-${escapeHtml(lesson.status)}">${escapeHtml(lessonStatusLabel(lesson.status))}</span>
        </div>
        <h2>${escapeHtml(lesson.topic)}</h2>
        <dl class="lesson-facts">
          ${lesson.date ? `<div class="lesson-fact"><dt>时间</dt><dd>${escapeHtml(lessonDateWithWeekday(lesson.date))}</dd></div>` : ""}
          ${lesson.session ? `<div class="lesson-fact"><dt>第几次</dt><dd>${escapeHtml(lesson.session)}</dd></div>` : ""}
          ${lesson.department ? `<div class="lesson-fact"><dt>部门</dt><dd>${escapeHtml(lesson.department)}</dd></div>` : ""}
          ${lesson.instructor ? `<div class="lesson-fact"><dt>授课人</dt><dd>${escapeHtml(lesson.instructor)}</dd></div>` : ""}
          ${lesson.location ? `<div class="lesson-fact"><dt>地点</dt><dd>${escapeHtml(lesson.location)}</dd></div>` : ""}
          <div class="lesson-fact"><dt>届次</dt><dd>${escapeHtml(lesson.termLabel)}</dd></div>
        </dl>
        ${renderLessonLinks(lesson.links)}
      </div>
    </article>
  `;
}

function renderLessonCard(lesson, isNext = false) {
  const topic = lesson.topic || "未命名课次";
  const parts = lessonDateParts(lesson.date);
  return `
    <li class="lesson-card is-${escapeHtml(lesson.status)}${isNext ? " is-next" : ""}" data-lesson-department="${escapeHtml(lesson.department || "")}">
      <div class="lesson-when">
        ${
          parts
            ? `<time class="lesson-date" datetime="${escapeHtml(lesson.date)}">${escapeHtml(parts.month)}.${escapeHtml(parts.day)}</time><span class="lesson-weekday">${escapeHtml(parts.weekday)} · ${escapeHtml(parts.year)}</span>`
            : `<span class="lesson-date is-tbd">待定</span><span class="lesson-weekday">时间未定</span>`
        }
      </div>
      <span class="lesson-node" aria-hidden="true"></span>
      <article class="lesson-card-body">
        <div class="lesson-card-top">
          <div class="lesson-card-tags">
            ${isNext ? '<span class="tag is-brand">下一次</span>' : ""}
            ${lesson.session ? `<span class="lesson-session">${escapeHtml(lesson.session)}</span>` : ""}
            ${lesson.department ? `<span class="tag">${escapeHtml(lesson.department)}</span>` : ""}
          </div>
          <span class="lesson-status is-${escapeHtml(lesson.status)}">${escapeHtml(lessonStatusLabel(lesson.status))}</span>
        </div>
        <h3>${lesson.status === "cancelled" ? `<s>${escapeHtml(topic)}</s>` : escapeHtml(topic)}</h3>
        ${
          lesson.instructor || lesson.location
            ? `<dl class="lesson-facts">
                ${lesson.instructor ? `<div class="lesson-fact"><dt>授课人</dt><dd>${escapeHtml(lesson.instructor)}</dd></div>` : ""}
                ${lesson.location ? `<div class="lesson-fact"><dt>地点</dt><dd>${escapeHtml(lesson.location)}</dd></div>` : ""}
              </dl>`
            : ""
        }
        ${renderLessonLinks(lesson.links)}
      </article>
    </li>
  `;
}

function renderLessonLinks(links) {
  const items = (Array.isArray(links) ? links : [])
    .map((link) => {
      const href = safeContactLinkUrl(link);
      if (!href) return "";
      const external = /^https?:/i.test(href);
      return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="lesson-link-label">${escapeHtml(link.label || href)}</span><span class="arrow" aria-hidden="true"></span></a>`;
    })
    .filter(Boolean);
  return items.length ? `<div class="lesson-links">${items.join("")}</div>` : "";
}

function bindLessonPlanFilters(container) {
  const buttons = Array.from(container.querySelectorAll("[data-lesson-term-button]"));
  const panels = Array.from(container.querySelectorAll("[data-lesson-term-panel]"));
  const departmentButtons = Array.from(container.querySelectorAll("[data-lesson-department-button]"));

  // 届次与部门两个筛选条件叠加生效：先切届次，再在届次内按部门过滤课次。
  const applyFilters = () => {
    const activeTerm = buttons.find((button) => button.classList.contains("is-active"))?.dataset.lessonTermButton || "";
    const activeLabel = activeTerm ? decodeURIComponent(activeTerm) : "";
    const department = departmentButtons.find((button) => button.classList.contains("is-active"))?.dataset.lessonDepartmentButton || "";

    panels.forEach((panel) => {
      const active = panel.dataset.lessonTermPanel === activeLabel;
      panel.hidden = !active;
      if (!active) return;

      let visible = 0;
      const total = panel.querySelectorAll("[data-lesson-department]").length;
      panel.querySelectorAll("[data-lesson-department]").forEach((card) => {
        const match = !department || card.dataset.lessonDepartment === department;
        card.hidden = !match;
        if (match) visible += 1;
      });

      const empty = panel.querySelector("[data-lesson-empty]");
      if (!empty) return;
      empty.hidden = visible > 0;
      if (total === 0) empty.textContent = "这一届还没有安排课次。";
      else if (department) empty.textContent = `这一届「${department}」还没有安排课次，换个部门看看？`;
      else empty.textContent = "这一届还没有安排课次。";
    });
  };

  const activate = (group, button) => {
    group.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    applyFilters();
  };

  buttons.forEach((button) => button.addEventListener("click", () => activate(buttons, button)));
  departmentButtons.forEach((button) => button.addEventListener("click", () => activate(departmentButtons, button)));

  applyFilters();
}

// ===== 授课计划：admin 内联编辑 =====
// 结构与“编辑文案”弹窗保持一致，只是字段改成课次行，整份 JSON 一次保存。
function ensureLessonPlanEditorModal() {
  let modal = document.querySelector("[data-lesson-plan-editor]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.lessonPlanEditor = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="授课计划编辑器">
      <div class="modal-head">
        <div>
          <h2>编辑授课计划</h2>
          <p class="meta">保存后写入 D1 数据库（lesson-plan 记录），并保留增量备份；前端页面直接读取这份数据。</p>
        </div>
        <button type="button" class="icon-button" data-lesson-plan-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form lesson-plan-editor">
          <label>
            页面标题
            <input class="admin-input" data-lesson-plan-title placeholder="授课计划" />
          </label>
          <div data-lesson-plan-terms></div>
          <div class="lesson-term-adder">
            <label>
              新增届次
              <input class="admin-input" data-lesson-plan-new-term placeholder="例如：第十届 · 2026 春" />
            </label>
            <label>
              届次说明（选填）
              <input class="admin-input" data-lesson-plan-new-term-note placeholder="例如：每周六 19:00，线上腾讯会议" />
            </label>
            <button type="button" class="btn secondary compact" data-lesson-plan-add-term>添加届次</button>
          </div>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-lesson-plan-save>保存授课计划</button>
          </div>
          <p class="meta" aria-live="polite" data-lesson-plan-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

function lessonEditorTermHtml(term) {
  const lessons = Array.isArray(term?.lessons) ? term.lessons : [];
  return `
    <fieldset class="lesson-term-editor" data-lesson-term>
      <legend>${escapeHtml(term?.label || "新届次")}</legend>
      <div class="grid">
        <label>届次名称<input class="admin-input" data-lesson-term-label value="${escapeHtml(term?.label || "")}" placeholder="第十届 · 2026 春" /></label>
        <label>届次说明<input class="admin-input" data-lesson-term-note value="${escapeHtml(term?.subtitle || "")}" placeholder="选填，例如上课时间与平台" /></label>
      </div>
      <div class="lesson-editor-list" data-lesson-rows>
        ${
          lessons.length
            ? lessons.map(lessonEditorRowHtml).join("")
            : '<p class="meta lesson-editor-empty" data-lesson-empty>这一届还没有课次，点下方按钮添加。</p>'
        }
      </div>
      <div class="editor-actions">
        <button type="button" class="btn secondary compact" data-add-lesson>添加课次</button>
        <button type="button" class="btn danger compact" data-remove-term>删除该届次</button>
      </div>
    </fieldset>
  `;
}

function lessonEditorRowHtml(lesson = {}) {
  const status = LESSON_STATUS_LABELS[lesson.status] ? lesson.status : "planned";
  const links = normalizeLessonLinks(lesson.links)
    .map((link) => `${link.label || "资料"}：${link.url}`)
    .join("\n");
  return `
    <div class="lesson-editor-row" data-lesson-row>
      <div class="lesson-editor-row-head">
        <span class="lesson-editor-row-index" aria-hidden="true"></span>
        <div class="lesson-editor-row-actions">
          <button type="button" class="btn ghost compact" data-lesson-move="up">上移</button>
          <button type="button" class="btn ghost compact" data-lesson-move="down">下移</button>
          <button type="button" class="btn danger compact" data-remove-lesson>删除课次</button>
        </div>
      </div>
      <label>主题<input class="admin-input" data-lesson-topic value="${escapeHtml(lesson.topic || "")}" placeholder="本次授课主题（必填）" /></label>
      <div class="grid">
        <label>授课时间（选填）<input class="admin-input" data-lesson-date type="date" value="${escapeHtml(lesson.date || "")}" /></label>
        <label>第几次课<input class="admin-input" data-lesson-session value="${escapeHtml(lesson.session || "")}" placeholder="第 3 次" /></label>
      </div>
      <div class="grid">
        <label>授课人<input class="admin-input" data-lesson-instructor value="${escapeHtml(lesson.instructor || "")}" placeholder="授课人" /></label>
        <label>地点<input class="admin-input" data-lesson-location value="${escapeHtml(lesson.location || "")}" placeholder="东区办公室 / 线上" /></label>
      </div>
      <div class="grid">
        <label>
          部门
          <select class="select-input" data-lesson-department>
            ${LESSON_DEPARTMENTS.map((department) => `<option value="${escapeHtml(department)}"${lesson.department === department ? " selected" : ""}>${escapeHtml(department)}</option>`).join("")}
          </select>
        </label>
        <label>
          状态
          <select class="select-input" data-lesson-status>
            <option value="planned"${status === "planned" ? " selected" : ""}>待授课</option>
            <option value="completed"${status === "completed" ? " selected" : ""}>已完成</option>
            <option value="cancelled"${status === "cancelled" ? " selected" : ""}>已取消</option>
          </select>
        </label>
      </div>
      <label>资源链接（每行一个，格式：名称：链接）<textarea class="admin-input" data-lesson-links rows="3" placeholder="录播：https://www.bilibili.com/video/BV...">${escapeHtml(links)}</textarea></label>
    </div>
  `;
}

function openLessonPlanEditor(plan, onSaved) {
  const modal = ensureLessonPlanEditorModal();
  const titleInput = modal.querySelector("[data-lesson-plan-title]");
  const termsContainer = modal.querySelector("[data-lesson-plan-terms]");
  const newTermInput = modal.querySelector("[data-lesson-plan-new-term]");
  const newTermNoteInput = modal.querySelector("[data-lesson-plan-new-term-note]");
  const message = modal.querySelector("[data-lesson-plan-message]");
  const saveButton = modal.querySelector("[data-lesson-plan-save]");

  titleInput.value = plan.title || DEFAULT_LESSON_PLAN_TITLE;
  // 倒序展示，和前台届次顺序一致，最新一届排在最前面。
  termsContainer.innerHTML = sortedLessonTerms(plan)
    .map((term) => lessonEditorTermHtml(term))
    .join("");
  newTermInput.value = "";
  newTermNoteInput.value = "";
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.toggle("error", isError);
  };

  const clearEmptyHint = (fieldset) => {
    fieldset.querySelector("[data-lesson-empty]")?.remove();
  };

  const bindTermFieldset = (fieldset) => {
    fieldset.querySelector("[data-add-lesson]").onclick = () => {
      clearEmptyHint(fieldset);
      fieldset.querySelector("[data-lesson-rows]").insertAdjacentHTML("beforeend", lessonEditorRowHtml());
    };
    fieldset.querySelector("[data-remove-term]").onclick = () => {
      const rows = fieldset.querySelectorAll("[data-lesson-row]").length;
      const label = fieldset.querySelector("[data-lesson-term-label]").value.trim() || "该届次";
      if (rows && !confirm(`「${label}」下还有 ${rows} 个课次，删除后一并移除，确认删除？`)) return;
      fieldset.remove();
      setMessage("已移除该届次，记得点保存。");
    };
    fieldset.querySelector("[data-lesson-rows]").addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest("[data-lesson-row]");
      if (!row) return;
      if (target.closest("[data-remove-lesson]")) {
        const list = row.parentElement;
        row.remove();
        // 删掉最后一个课次后补回空态提示，否则这一届看起来像“坏了”。
        if (list && !list.querySelector("[data-lesson-row]")) {
          list.insertAdjacentHTML("beforeend", '<p class="meta lesson-editor-empty" data-lesson-empty>这一届还没有课次，点下方按钮添加。</p>');
        }
        setMessage("已移除该课次，记得点保存。");
        return;
      }
      const move = target.closest("[data-lesson-move]")?.dataset.lessonMove;
      if (move === "up" && row.previousElementSibling) {
        row.parentElement.insertBefore(row, row.previousElementSibling);
      } else if (move === "down" && row.nextElementSibling) {
        row.parentElement.insertBefore(row.nextElementSibling, row);
      }
    });
  };

  termsContainer.querySelectorAll("[data-lesson-term]").forEach(bindTermFieldset);
  modal.querySelector("[data-lesson-plan-add-term]").onclick = () => {
    const label = newTermInput.value.trim();
    if (!label) {
      setMessage("请先填写届次名称。", true);
      return;
    }
    if (Array.from(termsContainer.querySelectorAll("[data-lesson-term-label]")).some((input) => input.value.trim() === label)) {
      setMessage(`届次「${label}」已存在，直接在里面添加课次即可。`, true);
      return;
    }
    const holder = document.createElement("div");
    holder.innerHTML = lessonEditorTermHtml({ label, subtitle: newTermNoteInput.value.trim(), lessons: [] });
    const fieldset = holder.firstElementChild;
    termsContainer.prepend(fieldset);
    bindTermFieldset(fieldset);
    newTermInput.value = "";
    newTermNoteInput.value = "";
    setMessage("已添加届次，记得点保存。");
  };

  modal.querySelector("[data-lesson-plan-close]").onclick = close;
  saveButton.onclick = async () => {
    if (saveButton.disabled) return;
    const fieldsets = Array.from(termsContainer.querySelectorAll("[data-lesson-term]"));
    if (!fieldsets.length) {
      setMessage("至少保留一个届次。", true);
      return;
    }

    const terms = [];
    for (const fieldset of fieldsets) {
      const label = fieldset.querySelector("[data-lesson-term-label]").value.trim();
      if (!label) {
        setMessage("届次名称不能为空。", true);
        return;
      }
      const lessons = [];
      for (const row of Array.from(fieldset.querySelectorAll("[data-lesson-row]"))) {
        const topic = row.querySelector("[data-lesson-topic]").value.trim();
        if (!topic) {
          setMessage("每个课次都要填主题；不用的课次行请先删除。", true);
          return;
        }
        const date = row.querySelector("[data-lesson-date]").value.trim();
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          setMessage(`课次「${topic}」的日期格式无效。`, true);
          return;
        }
        const links = [];
        for (const line of row.querySelector("[data-lesson-links]").value.split("\n").map((item) => item.trim()).filter(Boolean)) {
          const separator = line.search(/[：:]/);
          const linkLabel = (separator >= 0 ? line.slice(0, separator) : "").trim();
          const url = (separator >= 0 ? line.slice(separator + 1) : line).trim();
          if (!safeLinkUrl(url)) {
            setMessage(`课次「${topic}」的资源链接无效：${line}。只支持 http(s)、站内 / 路径或 mailto。`, true);
            return;
          }
          links.push({ label: linkLabel || "资料", url });
        }
        lessons.push({
          date,
          session: row.querySelector("[data-lesson-session]").value.trim(),
          topic,
          department: row.querySelector("[data-lesson-department]").value,
          instructor: row.querySelector("[data-lesson-instructor]").value.trim(),
          location: row.querySelector("[data-lesson-location]").value.trim(),
          status: row.querySelector("[data-lesson-status]").value,
          links,
        });
      }
      terms.push({
        label,
        subtitle: fieldset.querySelector("[data-lesson-term-note]").value.trim(),
        lessons,
      });
    }

    // terms 的数组顺序就是页面顺序：编辑框里最上面那届排最前，存库后不会被标签字典序打乱。
    const nextPlan = normalizeLessonPlan({ title: titleInput.value.trim(), terms });
    nextPlan.terms.forEach((term, index) => {
      term.order = nextPlan.terms.length - index;
    });
    setMessage("正在保存...");
    saveButton.disabled = true;
    try {
      await saveSiteJsonRecord(LESSON_PLAN_KEY, nextPlan.title, nextPlan);
      onSaved?.(nextPlan);
      close();
    } catch (error) {
      setMessage(`保存失败：${error.message}。页面显示的仍是旧数据，请重试。`, true);
    } finally {
      saveButton.disabled = false;
    }
  };
}

Object.assign(window.blog, {
  renderLessonPlan,
});
