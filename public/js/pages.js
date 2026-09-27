// 固定 Markdown 页面与部门页：读取、渲染和内容编辑者的在线编辑。依赖 core.js、markdown.js、page-editor.js、team.js（成员类 JSON 记录）。

async function renderStaticPage() {
  const container = document.querySelector("[data-static-page]");
  if (!container) return;

  const params = new URLSearchParams(location.search);
  const recordKey = params.get("record");
  if (recordKey) {
    await renderSiteRecord(container, recordKey);
    return;
  }

  const staticPage = resolveStaticMarkdownPage(params);
  if (!staticPage) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">页面路径无效。</p></div>';
    return;
  }

  try {
    const data = await fetchJson(pageApiPath(staticPage.key));
    const markdown = data.page.content || "";
    if (!markdown) throw new Error("页面不存在");

    const title = firstHeading(markdown) || data.page.title || staticPage.defaultTitle;
    document.title = `${title} · 燕山大学大学生网络信息协会`;
    updateStaticPageHero(title, staticPage.key);
    container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title,
      markdown,
    });
  } catch (error) {
    updateStaticPageHero(staticPage.defaultTitle, staticPage.key);
    container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title: staticPage.defaultTitle,
      markdown: `# ${staticPage.defaultTitle}\n\n`,
    });
  }
}

async function renderDepartmentMarkdownPage() {
  const containers = Array.from(document.querySelectorAll("[data-department-markdown-page]"));
  if (!containers.length) return;
  await Promise.all(containers.map(renderDepartmentMarkdownContainer));
}

async function renderDepartmentMarkdownContainer(container) {
  const page = container.dataset.departmentMarkdownPage || "";
  if (!isSafeMarkdownPath(page)) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">部门页面路径无效。</p></div>';
    return;
  }

  const defaultTitle = container.dataset.departmentMarkdownTitle || pageTitleFromPath(page);
  const defaultMarkdown =
    container.querySelector("[data-department-markdown-default]")?.textContent.trim()
    || `# ${defaultTitle}\n\n`;

  let title = defaultTitle;
  let markdown = defaultMarkdown;
  try {
    const data = await fetchJson(pageApiPath(page));
    const content = String(data.page?.content || "").trim();
    if (content) {
      markdown = content;
      title = firstHeading(markdown) || data.page.title || defaultTitle;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
      return;
    }
  }

  container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
  await attachStaticPageEditor(container, {
    page,
    title,
    markdown,
    editorTitle: `编辑${defaultTitle}详情`,
    editorHelper: "保存后会作为固定 Markdown 页面写入 D1，并纳入 Markdown 备份。",
  });
}

// 页头只由页面标题驱动；眉标与导语是页内文案块 page-hero-copy（默认值写在 page.html），这里不再覆盖。
function updateStaticPageHero(title, key) {
  const heroTitle = document.querySelector("[data-page-hero-title]");
  if (heroTitle) heroTitle.textContent = `${title}。`;
  void key;
}

function resolveStaticMarkdownPage(params) {
  const asset = params.get("asset");
  if (asset) {
    const decoded = decodeURIComponent(asset).replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
    if (!isSafeMarkdownPath(decoded)) return null;
    return {
      key: `asset/${utf8Hex(decoded)}`,
      defaultTitle: decoded.split("/").pop() || "资料页面",
    };
  }

  // 不再有默认页：原先兜底的 about-us/index 属于已废弃的旧站页面，已随其余
  // legacy 记录一起删除。缺 ?p= 时返回 null，交由调用方走"内容不存在"分支。
  const page = params.get("p");
  if (!page || !isSafeMarkdownPath(page)) return null;
  return {
    key: page,
    defaultTitle: pageTitleFromPath(page),
  };
}

function isSafeMarkdownPath(path) {
  return Boolean(path) && !path.includes("..") && /^[\w/\-\u4e00-\u9fa5\uff00-\uffef]+$/.test(path);
}

function pageTitleFromPath(path) {
  return path.split("/").pop() || "页面";
}

async function renderSiteRecord(container, key) {
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">内容标识无效。</p></div>';
    return;
  }

  try {
    const data = await fetchSiteRecord(key);
    document.title = `${data.record.title} · 燕山大学大学生网络信息协会`;
    updateStaticPageHero(data.record.title, key);
    container.innerHTML =
      data.record.kind === "json"
        ? renderStructuredRecord(data.record)
        : `<div class="article-body">${markdownToHtml(data.record.content)}</div>`;
  } catch (error) {
    container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
  }
}

function renderStructuredRecord(record) {
  let items;
  try {
    items = JSON.parse(record.content || "[]");
  } catch {
    return '<div class="article-body"><p class="empty-state error">内容数据格式有误。</p></div>';
  }
  if (!Array.isArray(items) || !items.length) return '<div class="article-body"><p class="empty-state">暂无内容。</p></div>';

  if (record.key === "members") {
    return renderMembersRecord(record, items);
  }

  return `
    <div class="record-view">
      <div class="record-head"><h2 class="record-title">${escapeHtml(record.title)}</h2></div>
      <div class="member-grid refined-member-grid${record.key === "hall-of-fame" ? " fame-grid" : ""}">
        ${items.map(record.key === "hall-of-fame" ? renderFameCard : renderProfileCard).join("")}
      </div>
    </div>
  `;
}

async function attachStaticPageEditor(container, pageState) {
  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.contentEditor) return;

  const toolbar = document.createElement("div");
  toolbar.className = "article-actions";
  toolbar.innerHTML = '<button type="button" class="btn secondary" data-edit-static-page>编辑页面</button>';
  container.prepend(toolbar);

  toolbar.querySelector("[data-edit-static-page]").addEventListener("click", () => {
    openStaticPageEditor(pageState, (nextState) => {
      pageState.title = nextState.title;
      pageState.markdown = nextState.markdown;
      document.title = `${nextState.title} · 燕山大学大学生网络信息协会`;
      const body = container.matches(".article-body") ? container : container.querySelector(".article-body");
      if (body) {
        body.innerHTML = markdownToHtml(nextState.markdown);
      } else {
        container.innerHTML = `<div class="article-body">${markdownToHtml(nextState.markdown)}</div>`;
        attachStaticPageEditor(container, pageState);
      }
    });
  });
}

function utf8Hex(value) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Object.assign(window.blog, {
  renderDepartmentMarkdownPage,
  renderStaticPage,
});
