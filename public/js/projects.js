// 协会项目目录。复用站点 JSON 记录、Markdown 和通用弹窗，无需单独的数据表。
const PROJECT_CATALOG_KEY = "association-projects";
const PROJECT_STATUS_LABELS = {
  maintaining: "持续维护",
  building: "开发中",
  planning: "规划中",
  archived: "已归档",
};

const PROJECT_NETWORK_LABELS = { public: "公网项目", internal: "内网项目", unspecified: "待确认" };

function projectSafeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\\\u0000-\u0020]/.test(raw)) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function normalizeProjectCatalog(content) {
  const value = typeof content === "string" ? JSON.parse(content) : content;
  if (!value || !Array.isArray(value.projects)) throw new Error("项目数据格式有误，请联系管理员检查。");
  const ids = new Set();
  return value.projects.map((item) => {
    if (!item || typeof item !== "object" || !String(item.id || "").trim() || !String(item.title || "").trim()) {
      throw new Error("项目数据缺少名称或标识，请联系管理员检查。");
    }
    const id = String(item.id).trim();
    if (ids.has(id)) throw new Error("项目标识重复，请联系管理员检查。");
    ids.add(id);
    return {
      id, title: String(item.title).trim(), category: String(item.category || "协会项目").trim(),
      status: typeof item.status === "string" && Object.hasOwn(PROJECT_STATUS_LABELS, item.status) ? item.status : "planning",
      network: typeof item.network === "string" && Object.hasOwn(PROJECT_NETWORK_LABELS, item.network) ? item.network : "unspecified",
      summary: String(item.summary || ""), owner: String(item.owner || ""),
      tags: Array.isArray(item.tags) ? item.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 10) : [],
      description: String(item.description || ""), siteUrl: projectSafeUrl(item.siteUrl), repoUrl: projectSafeUrl(item.repoUrl),
    };
  });
}

async function readProjectCatalog() {
  const data = await fetchJson('/api/site?keys=' + PROJECT_CATALOG_KEY);
  if (!data.records || !Object.hasOwn(data.records, PROJECT_CATALOG_KEY)) throw new Error('项目接口返回的数据不完整，请重试。');
  const record = data.records[PROJECT_CATALOG_KEY];
  if (record === null) return null;
  if (!record || record.kind !== 'json') throw new Error('项目记录类型有误，请联系管理员检查。');
  return normalizeProjectCatalog(record.content);
}

function projectNetworkBadge(project) {
  return `<span class="project-network-badge is-${project.network}">${PROJECT_NETWORK_LABELS[project.network]}</span>`;
}

function projectExternalLink(url, label, { primary = false, compact = true } = {}) {
  const href = projectSafeUrl(url);
  if (!href) return "";
  const external = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a class="btn ${primary ? "primary" : "secondary"}${compact ? " compact" : ""}" href="${escapeHtml(href)}"${external}>${escapeHtml(label)}<span class="arrow" aria-hidden="true"></span></a>`;
}

async function renderProjectsPage() {
  const root = document.querySelector("[data-project-directory]");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  const params = new URLSearchParams(location.search);
  const state = { projects: [], admin: false, ready: false, busy: false, editor: null, closeModal: null,
    network: Object.hasOwn(PROJECT_NETWORK_LABELS, params.get("network")) ? params.get("network") : "all",
    query: params.get("q") || "", filter: Object.hasOwn(PROJECT_STATUS_LABELS, params.get("status")) ? params.get("status") : "all" };
  const grid = root.querySelector("[data-project-grid]");
  const search = root.querySelector("[data-project-search]");
  const filters = root.querySelector("[data-project-filters]");
  const networkFilters = root.querySelector("[data-project-network-filters]");
  const adminActions = root.querySelector("[data-project-admin-actions]");
  const message = root.querySelector("[data-project-message]");
  search.value = state.query;

  filters.innerHTML = Object.entries({ all: "全部项目", ...PROJECT_STATUS_LABELS }).map(([key, label]) =>
    `<button class="filter-chip" type="button" data-project-filter="${key}" aria-pressed="false">${label}<span data-project-filter-count="${key}"></span></button>`).join("");

  networkFilters.innerHTML = '<span class="projects-filter-label">访问范围</span>' + Object.entries({ all: "全部", ...PROJECT_NETWORK_LABELS }).map(([key, label]) =>
    `<button class="filter-chip" type="button" data-project-network="${key}" aria-pressed="false">${label}<span data-project-network-count="${key}"></span></button>`).join("");

  function updateUrl() {
    const url = new URL(location.href);
    for (const [key, value] of [["q", state.query.trim()], ["status", state.filter === "all" ? "" : state.filter], ["network", state.network === "all" ? "" : state.network]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    history.replaceState(null, "", url);
  }

  function paint() {
    const query = state.query.trim().toLocaleLowerCase();
    const items = state.projects.filter((project) => (state.filter === "all" || project.status === state.filter)
      && (state.network === "all" || project.network === state.network)
      && [project.title, project.summary, project.category, project.owner, PROJECT_NETWORK_LABELS[project.network], ...project.tags].join(" ").toLocaleLowerCase().includes(query));
    adminActions.hidden = !state.admin || !state.ready;
    root.querySelector("[data-project-count]").textContent = `显示 ${items.length} / ${state.projects.length} 个项目`;
    for (const button of filters.querySelectorAll("[data-project-filter]")) {
      const key = button.dataset.projectFilter;
      const selected = key === state.filter;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.querySelector("[data-project-filter-count]").textContent = String(key === "all" ? state.projects.length : state.projects.filter((p) => p.status === key).length);
    }
    for (const button of networkFilters.querySelectorAll("[data-project-network]")) {
      const key = button.dataset.projectNetwork;
      const count = key === "all" ? state.projects.length : state.projects.filter((p) => p.network === key).length;
      button.classList.toggle("is-active", key === state.network);
      button.setAttribute("aria-pressed", String(key === state.network));
      button.querySelector("[data-project-network-count]").textContent = String(count);
      button.hidden = key === "unspecified" && count === 0 && state.network !== key;
    }
    grid.innerHTML = items.length ? items.map((project) => `
      <article class="project-card surface-card">
        <div class="project-card-top"><span class="project-category">${escapeHtml(project.category)}</span><div class="project-card-badges">${projectNetworkBadge(project)}<span class="project-status tag">${PROJECT_STATUS_LABELS[project.status]}</span></div></div>
        <h3 class="project-title">${escapeHtml(project.title)}</h3>
        <p class="project-summary">${escapeHtml(project.summary || "项目介绍待补充。")}</p>
        ${project.tags.length ? `<div class="contact-row">${project.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        <div class="project-card-footer">
          <p class="project-owner meta">${escapeHtml(project.owner || "参与团队待补充")}</p>
          <div class="project-actions">
            <button class="btn primary compact" type="button" data-project-open="${escapeHtml(project.id)}" aria-label="查看${escapeHtml(project.title)}详情">项目详情<span class="arrow" aria-hidden="true"></span></button>
            ${projectExternalLink(project.siteUrl, "访问项目")}
            ${state.admin ? `<button class="btn ghost compact" type="button" data-project-edit="${escapeHtml(project.id)}">编辑</button>` : ""}
          </div>
        </div>
      </article>`).join("") : `<div class="empty-state"><p>${state.projects.length ? "没有找到符合条件的项目。" : "暂时还没有项目，欢迎之后再来看看。"}</p>${state.projects.length ? '<button class="btn secondary" type="button" data-project-reset>清空筛选</button>' : ""}</div>`;
  }

  async function load() {
    state.ready = false;
    adminActions.hidden = true;
    message.textContent = "";
    try {
      state.projects = (await readProjectCatalog()) ?? [];
      state.ready = true;
      paint();
    } catch (error) {
      root.querySelector("[data-project-count]").textContent = "项目加载失败";
      grid.innerHTML = '<div class="empty-state error"><p>暂时无法加载项目，请稍后重试。</p><button type="button" class="btn secondary" data-project-retry>重新加载</button></div>';
      message.textContent = error.message;
    }
  }

  function openModal(modal, initial, canClose = () => true) {
    const trigger = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    let teardown = () => {};
    const dialog = modal.querySelector('[role="dialog"]');
    dialog.tabIndex = -1;
    const close = (force = false) => {
      if (force !== true && !canClose()) return;
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      teardown();
      modal.removeEventListener("keydown", trapFocus);
      state.closeModal = null;
      if (trigger instanceof HTMLElement && trigger.isConnected && trigger.checkVisibility()) trigger.focus({ preventScroll: true });
      else search.focus({ preventScroll: true });
    };
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')].filter((e) => !e.disabled && e.checkVisibility());
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    teardown = setupModalDismiss(modal, () => close());
    modal.addEventListener("keydown", trapFocus);
    modal.querySelectorAll("[data-project-close]").forEach((button) => { button.onclick = () => close(); });
    state.closeModal = close;
    initial.focus({ preventScroll: true });
  }

  function openDetail(project) {
    const modal = document.querySelector("[data-project-detail]");
    const title = modal.querySelector("[data-project-detail-title]");
    title.textContent = project.title;
    modal.querySelector("[data-project-detail-meta]").innerHTML = projectNetworkBadge(project)
      + `<span>${escapeHtml(PROJECT_STATUS_LABELS[project.status] + " · " + project.category + " · " + (project.owner || "参与团队待补充"))}</span>`;
    modal.querySelector("[data-project-access-note]").textContent = project.network === "internal"
      ? "内网项目：请先连接项目指定的网络，访问方式以项目说明为准。"
      : project.network === "public" ? "公网项目：可通过公网访问，是否需要登录以项目要求为准。"
      : "访问范围尚未标注，请参考项目说明或联系维护团队。";
    const body = modal.querySelector("[data-project-detail-body]");
    body.innerHTML = markdownToHtml(project.description || project.summary || "项目介绍待补充。");
    enhanceArticleBody(body);
    modal.querySelector("[data-project-detail-links]").innerHTML = '<button class="btn secondary" type="button" data-project-close>关闭</button>'
      + projectExternalLink(project.repoUrl, "项目仓库", { primary: !project.siteUrl, compact: false })
      + projectExternalLink(project.siteUrl, "访问项目", { primary: true, compact: false });
    modal.querySelector(".modal-body").scrollTop = 0;
    openModal(modal, title);
  }

  const editor = document.querySelector("[data-project-editor]");
  const form = editor.querySelector("form");
  const editorMessage = editor.querySelector("[data-project-editor-message]");
  const fieldNames = ["title", "category", "status", "network", "summary", "owner", "tags", "description", "siteUrl", "repoUrl"];
  const formValues = () => Object.fromEntries(fieldNames.map((name) => [name, form.elements.namedItem(name).value]));

  function openEditor(project = null) {
    if (!state.admin || !state.ready) return;
    state.editor = { original: project, id: project ? project.id : crypto.randomUUID(), snapshot: "" };
    for (const name of fieldNames) form.elements.namedItem(name).value = name === "tags" ? (project?.tags || []).join("，") : project?.[name] || (name === "status" ? "planning" : "");
    state.editor.snapshot = JSON.stringify(formValues());
    editor.querySelector("[data-project-editor-title]").textContent = project ? "编辑项目" : "新增项目";
    editor.querySelector("[data-project-delete]").hidden = !state.editor.original;
    editorMessage.textContent = "";
    editor.querySelector(".modal-body").scrollTop = 0;
    openModal(editor, form.elements.namedItem("title"), () => !state.busy && (JSON.stringify(formValues()) === state.editor.snapshot || window.confirm("还有未保存的修改，确定关闭吗？")));
  }

  async function persist(remove = false) {
    if (!state.admin || !state.ready || state.busy || !state.editor) return;
    if (remove && !state.editor.original) return;
    if (!remove && !form.reportValidity()) return;
    if (remove && !window.confirm(`确定删除「${state.editor.original.title}」吗？`)) return;
    const values = formValues();
    for (const key of ["siteUrl", "repoUrl"]) {
      if (!remove && values[key].trim() && !projectSafeUrl(values[key])) { editorMessage.textContent = "链接请填写 http(s) 地址或以 / 开头的站内路径。"; form.elements.namedItem(key).focus(); return; }
    }
    if (!remove && !values.title.trim()) { editorMessage.textContent = "请填写项目名称。"; return; }
    if (!remove && !values.summary.trim()) { editorMessage.textContent = "请填写项目简介。"; return; }
    state.busy = true;
    editorMessage.textContent = remove ? "正在删除…" : "正在保存…";
    const controls = [...editor.querySelectorAll("button,input,select,textarea")];
    const previousFocus = document.activeElement;
    const dialog = editor.querySelector('[role="dialog"]');
    controls.forEach((control) => { control.disabled = true; });
    dialog.focus();
    try {
      // 先重新读取集合，保留其他项目的最新修改，并检查当前项目是否已被更改。
      const latest = await readProjectCatalog() ?? [];
      const original = state.editor.original;
      const current = latest.find((p) => p.id === state.editor.id);
      const project = remove ? null : normalizeProjectCatalog({ projects: [{ ...values, id: state.editor.id, tags: values.tags.split(/[,，\n]/) }] })[0];
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      let next;
      let write = true;
      // 响应丢失后重复提交保持幂等，不向集合添加重复标识。
      if (remove && !current || !remove && current && same(current, project)) {
        next = latest;
        write = false;
      } else {
        if (original && !same(current, original) || !original && current) throw new Error('这个项目已被其他人更新。请关闭窗口并刷新页面后重试。');
        next = remove ? latest.filter((p) => p.id !== original.id) : original ? latest.map((p) => p.id === original.id ? project : p) : [...latest, project];
      }
      next = normalizeProjectCatalog({ projects: next });
      if (write) await saveSiteJsonRecord(PROJECT_CATALOG_KEY, '协会项目', { version: 1, projects: next });
      state.projects = next;
      paint();
      message.textContent = remove ? "项目已删除。" : "项目已保存。";
      state.closeModal(true);
    } catch (error) { editorMessage.textContent = error.message || "保存失败，请重试。"; }
    finally {
      state.busy = false;
      controls.forEach((control) => { control.disabled = false; });
      if (!editor.hidden && (document.activeElement === dialog || !editor.contains(document.activeElement))) {
        if (previousFocus instanceof HTMLElement && editor.contains(previousFocus)) previousFocus.focus();
        else form.elements.namedItem('title').focus();
      }
    }
  }

  search.addEventListener("input", () => { state.query = search.value; updateUrl(); if (state.ready) paint(); });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-project-filter")) { state.filter = button.dataset.projectFilter; updateUrl(); if (state.ready) paint(); }
    if (button.hasAttribute("data-project-network")) { state.network = button.dataset.projectNetwork; updateUrl(); if (state.ready) paint(); }
    if (button.hasAttribute("data-project-reset")) { state.network = "all"; state.filter = "all"; state.query = ""; search.value = ""; updateUrl(); paint(); search.focus(); }
    if (button.hasAttribute("data-project-retry")) load();
    if (button.hasAttribute("data-project-add")) openEditor();
    const project = state.projects.find((p) => p.id === (button.dataset.projectOpen || button.dataset.projectEdit));
    if (project && button.hasAttribute("data-project-open")) openDetail(project);
    if (project && button.hasAttribute("data-project-edit")) openEditor(project);
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); persist(); });
  editor.querySelector("[data-project-delete]").addEventListener("click", () => persist(true));
  const auth = currentUser().then((me) => { state.admin = Boolean(me.admin); if (state.ready) paint(); }).catch(() => {});
  await Promise.all([load(), auth]);
}

Object.assign(window.blog, { renderProjectsPage });
