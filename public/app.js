async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

let currentUserPromise;

async function currentUser() {
  if (!currentUserPromise) {
    currentUserPromise = fetchJson("/api/auth/me").catch((error) => {
      currentUserPromise = null;
      throw error;
    });
  }
  return currentUserPromise;
}

function formatDate(value) {
  if (!value) return "未发布";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function markdownToHtml(markdown) {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let paragraph = [];
  let listTag = "";
  let quote = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph
      .map((line) => {
        const hasBreak = /\s{2,}$/.test(line);
        return `${inlineMarkdown(escapeHtml(line.trimEnd()))}${hasBreak ? "<br>" : ""}`;
      })
      .join(" ");
    html.push(`<p>${content}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listTag) return;
    html.push(`</${listTag}>`);
    listTag = "";
  }

  function flushQuote() {
    if (quote.length === 0) return;
    html.push(`<blockquote>${quote.map((line) => `<p>${line}</p>`).join("")}</blockquote>`);
    quote = [];
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        flushParagraph();
        flushQuote();
        closeList();
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      flushQuote();
      continue;
    }

    if (line.trim() === "---") {
      flushParagraph();
      closeList();
      flushQuote();
      html.push("<hr>");
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      closeList();
      const content = quoteLine[1].trim();
      const admonitions = {
        "[!NOTE]": "提示",
        "[!IMPORTANT]": "重要",
        "[!WARNING]": "注意",
      };
      quote.push(admonitions[content] ? `<strong>${admonitions[content]}</strong>` : inlineMarkdown(escapeHtml(content)));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const unorderedItem = line.match(/^\s*-\s+(.*)$/);
    const orderedItem = line.match(/^\s*\d+\.\s+(.*)$/);
    const listItem = unorderedItem || orderedItem;
    if (listItem) {
      flushParagraph();
      flushQuote();
      const nextTag = unorderedItem ? "ul" : "ol";
      if (listTag && listTag !== nextTag) closeList();
      if (!listTag) {
        html.push(`<${nextTag}>`);
        listTag = nextTag;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(listItem[1]))}</li>`);
      continue;
    }

    closeList();
    flushQuote();
    paragraph.push(line.trimStart());
  }

  flushParagraph();
  closeList();
  flushQuote();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function inlineMarkdown(html) {
  return html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
      const safeSrc = normalizeAssetUrl(src);
      return `<img src="${safeSrc}" alt="${alt}" loading="lazy">`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label, href) => {
        const safeHref = href.startsWith("http") || href.startsWith("/") || href.startsWith("mailto:")
          ? normalizeInternalHref(href)
          : `/page.html?p=${href.replace(/^\.\//, "").replace(/\.html$/, "").replace(/\.md$/, "")}`;
        const rel = safeHref.startsWith("http") ? ' rel="noreferrer"' : "";
        const target = safeHref.startsWith("http") ? ' target="_blank"' : "";
        return `<a href="${safeHref}"${target}${rel}>${label}</a>`;
      },
    );
}

function normalizeInternalHref(href) {
  if (!href.startsWith("/") || href.startsWith("/page.html") || href.startsWith("/post.html") || href.startsWith("/media/")) {
    return href;
  }

  const markdownAsset = href.split(/[?#]/, 1)[0].match(/^\/(.+)\.md$/i);
  if (markdownAsset) {
    return `/media/${markdownAsset[1]}.md`;
  }

  const legacyPage = href.match(/^\/(about-us|lessons|join-us)\/(.+)\.html$/);
  if (legacyPage) {
    return `/page.html?p=${legacyPage[1]}/${legacyPage[2]}`;
  }

  return href;
}

function normalizeAssetUrl(value) {
  if (value.startsWith("http") || value.startsWith("/media/") || value.startsWith("/logo")) {
    return value;
  }
  if (value.startsWith("/avatars/")) return value.replace("/avatars/", "/media/avatars/");
  return value;
}

// 只允许安全协议的链接，阻断 javascript:/data: 等点击型 XSS。
// 后台填入的成员/名人堂联系方式会经过这里再渲染。
function safeLinkUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return "";
}

async function renderPostList({ admin = false } = {}) {
  const list = document.querySelector("[data-post-list]");
  const featureGrid = document.querySelector("[data-feature-grid]");
  if (!list) return;

  try {
    const data = await fetchJson(`/api/posts${admin ? "?drafts=1" : ""}`);
    if (!data.posts.length) {
      if (featureGrid && !admin) featureGrid.innerHTML = "";
      list.innerHTML = '<p class="empty">暂无文章。</p>';
      return;
    }

    if (featureGrid && !admin) {
      const featuredPosts = data.posts.slice(0, 3);
      featureGrid.innerHTML = featuredPosts
        .map(
          (post, index) => `
            <a class="feature-card${index === 0 ? " is-lead" : ""}" href="/post.html?slug=${encodeURIComponent(post.slug)}">
              <p class="meta">${index === 0 ? "最新" : "动态"} · ${formatDate(post.published_at || post.updated_at)}</p>
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.excerpt || "")}</p>
            </a>
          `,
        )
        .join("");
    }

    list.innerHTML = data.posts
      .map(
        (post) => `
          <article class="post-card feed-card">
            <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${formatDate(post.published_at || post.updated_at)}</p>
            <h2><a href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    if (featureGrid && !admin) featureGrid.innerHTML = "";
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderHomeHero() {
  const hero = document.querySelector("[data-home-hero]");
  if (!hero) return;

  try {
    const data = await fetchJson("/api/site/homepage-gallery");
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) return;

    const active = items.find((item) => item.active) || items[0];
    if (!active?.url) return;

    hero.style.setProperty("--hero-image", `url("${normalizeAssetUrl(active.url)}")`);
    hero.classList.add("has-background");
  } catch {
    hero.classList.remove("has-background");
  }
}

async function renderUserNav() {
  const navs = document.querySelectorAll("[data-user-nav]");
  if (!navs.length) return;

  try {
    const me = await currentUser();
    const html = me.admin
      ? '<a class="nav-link nav-admin" href="/admin/">管理后台</a><a class="nav-link nav-logout" href="#" data-logout>退出登录</a>'
      : me.authenticated
        ? '<a class="nav-link nav-logout" href="#" data-logout>退出登录</a>'
      : '<a class="nav-link nav-login" href="/api/auth/login">成员登录</a>';
    navs.forEach((nav) => {
      nav.innerHTML = nav.hasAttribute("data-side-nav")
        ? decorateSideNav(html)
        : html;
    });
  } catch {
    navs.forEach((nav) => {
      const html = '<a class="nav-link nav-login" href="/api/auth/login">成员登录</a>';
      nav.innerHTML = nav.hasAttribute("data-side-nav") ? decorateSideNav(html) : html;
    });
  }
}

function decorateSideNav(html) {
  return html.replaceAll('class="nav-link ', 'class="side-link ');
}

async function renderPost() {
  const article = document.querySelector("[data-article]");
  if (!article) return;

  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) {
    article.innerHTML = '<p class="error">缺少文章链接标识。</p>';
    return;
  }

  try {
    const data = await fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
    document.title = `${data.post.title} · 燕山大学大学生网络信息协会`;
    article.innerHTML = `
      <p class="meta">${formatDate(data.post.published_at || data.post.updated_at)}</p>
      <h1>${escapeHtml(data.post.title)}</h1>
      <div class="article-body">${markdownToHtml(data.markdown)}</div>
    `;
  } catch (error) {
    article.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

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
    container.innerHTML = '<p class="error">页面路径无效。</p>';
    return;
  }

  try {
    const data = await fetchJson(pageApiPath(staticPage.key));
    const markdown = data.page.content || "";
    if (!markdown) throw new Error("页面不存在");

    const title = firstHeading(markdown) || data.page.title || staticPage.defaultTitle;
    document.title = `${title} · 燕山大学大学生网络信息协会`;
    container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title,
      markdown,
    });
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title: staticPage.defaultTitle,
      markdown: `# ${staticPage.defaultTitle}\n\n`,
    });
  }
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

  const page = params.get("p") || "about-us/index";
  if (!isSafeMarkdownPath(page)) return null;
  return {
    key: page,
    defaultTitle: pageTitleFromPath(page),
  };
}

function isSafeMarkdownPath(path) {
  return Boolean(path) && !path.includes("..") && /^[\w/\-\u4e00-\u9fa5\uff00-\uffef]+$/.test(path);
}

function pageTitleFromPath(path) {
  const titles = {
    "about-us/index": "关于我们",
    "services/index": "相关服务",
    "lessons/index": "授课链接",
    "join-us/how-to": "加入我们",
    "contact-us/index": "联系我们",
  };
  return titles[path] || path.split("/").pop() || "页面";
}

async function renderSiteRecord(container, key) {
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    container.innerHTML = '<p class="error">内容标识无效。</p>';
    return;
  }

  try {
    const data = await fetchJson(`/api/site/${key}`);
    document.title = `${data.record.title} · 燕山大学大学生网络信息协会`;
    container.innerHTML =
      data.record.kind === "json"
        ? renderStructuredRecord(data.record)
        : `<div class="article-body">${markdownToHtml(data.record.content)}</div>`;
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderStructuredRecord(record) {
  let items;
  try {
    items = JSON.parse(record.content || "[]");
  } catch {
    return '<p class="error">内容数据格式有误。</p>';
  }
  if (!Array.isArray(items) || !items.length) return '<p class="empty">暂无内容。</p>';

  if (record.key === "members") {
    return renderMembersRecord(record, items);
  }

  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      <div class="profile-grid">
        ${items.map(renderProfileCard).join("")}
      </div>
    </div>
  `;
}

function renderMembersRecord(record, items) {
  const terms = [...new Set(items.map((item) => item.term || "未填写届数"))];
  const activeTerm = terms[0];
  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      <label class="inline-control">
        届数
        <select data-term-switch>
          ${terms.map((term) => `<option value="${escapeHtml(term)}">${escapeHtml(term)}</option>`).join("")}
        </select>
      </label>
      <div data-term-panels>
        ${terms.map((term) => renderMemberTerm(term, items.filter((item) => (item.term || "未填写届数") === term), term === activeTerm)).join("")}
      </div>
    </div>
  `;
}

function renderMemberTerm(term, items, active) {
  const departments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部", "秘书处"];
  return `
    <section data-term-panel="${escapeHtml(term)}" ${active ? "" : "hidden"}>
      ${departments
        .map((department) => {
          const departmentItems = items.filter((item) => (item.department || "未分组") === department);
          if (!departmentItems.length) return "";
          return `
            <h2>${escapeHtml(department)}</h2>
            <div class="profile-grid">
              ${departmentItems.map(renderProfileCard).join("")}
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderProfileCard(item) {
  const links = Array.isArray(item.links) ? item.links : [];
  return `
    <article class="profile-card">
      ${item.avatar ? `<img src="${normalizeAssetUrl(escapeHtml(item.avatar))}" alt="${escapeHtml(item.name)}" loading="lazy">` : ""}
      <div>
        <h3>${escapeHtml(item.name || "")}</h3>
        ${item.title ? `<p class="meta">${escapeHtml(item.title)}</p>` : ""}
        ${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ""}
        ${
          links.length
            ? `<p>${links
                .map((link) => {
                  const href = safeLinkUrl(link.url);
                  if (!href) return "";
                  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label || link.url)}</a>`;
                })
                .filter(Boolean)
                .join(" · ")}</p>`
            : ""
        }
      </div>
    </article>
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
  toolbar.innerHTML = '<button type="button" class="secondary" data-edit-static-page>编辑页面</button>';
  container.prepend(toolbar);

  toolbar.querySelector("[data-edit-static-page]").addEventListener("click", () => {
    openStaticPageEditor(pageState, (nextState) => {
      pageState.title = nextState.title;
      pageState.markdown = nextState.markdown;
      document.title = `${nextState.title} · 燕山大学大学生网络信息协会`;
      const body = container.querySelector(".article-body");
      if (body) {
        body.innerHTML = markdownToHtml(nextState.markdown);
      } else {
        container.innerHTML = `<div class="article-body">${markdownToHtml(nextState.markdown)}</div>`;
        attachStaticPageEditor(container, pageState);
      }
    });
  });
}

function openStaticPageEditor(pageState, onSaved) {
  const modal = ensureStaticPageEditorModal();
  const titleInput = modal.querySelector("[data-page-editor-title]");
  const markdownInput = modal.querySelector("[data-page-editor-markdown]");
  const message = modal.querySelector("[data-page-editor-message]");

  titleInput.value = pageState.title || firstHeading(pageState.markdown) || "";
  markdownInput.value = pageState.markdown || "";
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  markdownInput.focus();

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  modal.querySelector("[data-page-editor-close]").onclick = close;
  modal.querySelector("[data-page-editor-save]").onclick = async () => {
    const markdown = markdownInput.value;
    const title = titleInput.value.trim() || firstHeading(markdown) || "页面";
    message.textContent = "正在保存...";

    try {
      await fetchJson(pageApiPath(pageState.page), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          content: markdown,
        }),
      });
      message.textContent = "已保存";
      onSaved({ title, markdown });
      close();
    } catch (error) {
      message.textContent = error.message;
    }
  };

  modal.querySelector("[data-page-editor-upload]").onclick = async () => {
    const fileInput = modal.querySelector("[data-page-editor-image]");
    const file = fileInput.files?.[0];
    if (!file) {
      message.textContent = "请选择图片";
      return;
    }
    try {
      await insertStaticPageImage(pageState.page, markdownInput, file, message);
      fileInput.value = "";
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.onpaste = async (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.ondragover = (event) => {
    event.preventDefault();
    markdownInput.classList.add("is-dragover");
  };
  markdownInput.ondragleave = () => markdownInput.classList.remove("is-dragover");
  markdownInput.ondrop = async (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    markdownInput.classList.remove("is-dragover");
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function ensureStaticPageEditorModal() {
  let modal = document.querySelector("[data-page-editor-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.pageEditorModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="页面编辑器">
      <div class="modal-head">
        <div>
          <h2>编辑页面</h2>
          <p class="meta">保存后写入 D1 数据库。</p>
        </div>
        <button type="button" class="icon-button" data-page-editor-close aria-label="关闭编辑器">✕</button>
      </div>
      <div class="modal-body">
        <section class="editor">
          <label>
            标题
            <input data-page-editor-title placeholder="页面标题" />
          </label>
          <label>
            Markdown 内容（可粘贴或拖拽图片）
            <textarea data-page-editor-markdown placeholder="# 页面标题"></textarea>
          </label>
          <div class="inline-uploader">
            <label>
              图片
              <input data-page-editor-image type="file" accept="image/*" />
            </label>
            <button type="button" class="secondary" data-page-editor-upload>上传</button>
          </div>
          <div class="actions">
            <button type="button" data-page-editor-save>保存页面</button>
          </div>
          <p class="meta" data-page-editor-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

async function insertStaticPageImage(page, textarea, file, message) {
  message.textContent = "正在上传图片...";
  const filename = uploadFilename(file.name);
  const mediaPath = `pages/${page}/${Date.now()}-${filename}`;
  const response = await fetch(`/api/content/media/${mediaPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `上传失败：${response.status}`);

  insertAtCursor(textarea, `![${filename}](${data.url})`);
  message.textContent = "图片已上传";
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || start;
  const prefix = textarea.value.slice(0, start);
  const suffix = textarea.value.slice(end);
  const needsLeadingBreak = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const insert = `${needsLeadingBreak}${text}\n`;
  textarea.value = `${prefix}${insert}${suffix}`;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + insert.length;
}

function uploadFilename(name) {
  const fallback = "image.png";
  return (name || fallback)
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96) || fallback;
}

function pageApiPath(page) {
  return `/api/pages/${page.split("/").map(encodeURIComponent).join("/")}`;
}

function utf8Hex(value) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// 登出通过 POST 提交，配合后端只接受 POST 的 /api/auth/logout，防 CSRF 强制登出。
async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
}

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-logout]") : null;
  if (!trigger) return;
  event.preventDefault();
  logout();
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-term-switch]")) return;
  const term = event.target.value;
  document.querySelectorAll("[data-term-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.termPanel !== term;
  });
});

function firstHeading(markdown) {
  const match = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

window.blog = {
  fetchJson,
  formatDate,
  escapeHtml,
  markdownToHtml,
  normalizeAssetUrl,
  renderPostList,
  renderHomeHero,
  renderPost,
  renderUserNav,
  renderStaticPage,
};
